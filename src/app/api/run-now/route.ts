import { NextResponse, type NextRequest } from "next/server";
import { createHash } from "node:crypto";
import { createSupabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { serverConfig } from "@/lib/config";
import { runDailyForUser, type UserRow } from "@/lib/services/daily-runner";
import {
  OpenAIWebSearchProvider,
  type OpenAIWebSearchResult,
} from "@/lib/providers/jobs/openai-web-search";
import type { JobPosting, UserProfile } from "@/lib/types";
import { canonicalLocationLabels } from "@/lib/locations";
import { findRoleFamily } from "@/lib/role-families";
import { tailorMatch } from "@/lib/services/tailor-match";
import { decrypt } from "@/lib/crypto";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * On-demand daily pipeline for the currently-authenticated user.
 *
 * TWO discovery sources run in parallel:
 *   1. Aggregator providers (Adzuna, JSearch, Greenhouse, Coresignal
 *      etc.) — same code the nightly cron uses. Cheap, fast.
 *   2. OpenAI Web Search (NEW) — live public-web discovery via
 *      Responses API with the hosted web_search tool. Expensive
 *      (~$0.04/call), slow (15-30s), high signal.
 *
 * OpenAI's results merge into the same pool that the aggregator jobs
 * feed. Downstream pipeline (rank → verify → tailor) treats them
 * uniformly, with one exception: the verify step trusts OpenAI's
 * pre-computed fit_score directly instead of calling Haiku again.
 *
 * Cost/abuse controls on the OpenAI side:
 *   - per-user daily cap (OPENAI_WEB_SEARCH_DAILY_CAP, default 3)
 *   - 6h cache keyed on (user_id, criteria hash)
 *   - kill switch: OPENAI_WEB_SEARCH_ENABLED=false disables silently
 *   - 30s hard timeout inside the provider
 *
 * All OpenAI calls (fresh, cached, or blocked) log a row to
 * openai_websearch_calls for cost telemetry + audit.
 *
 * Rate limits: existing 20 runs/hr per user (via RUN_NOW_HOURLY_LIMIT
 * env) still applies to the whole endpoint.
 */
export async function POST(_req: NextRequest) {
  const sb = createSupabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = supabaseAdmin();

  // Endpoint-level rate limit (existing).
  const hourlyLimit = Number(process.env.RUN_NOW_HOURLY_LIMIT ?? 20);
  const oneHourAgo = new Date(Date.now() - 60 * 60_000).toISOString();
  const { count } = await admin
    .from("job_runs")
    .select("*", { count: "exact", head: true })
    .eq("user_id", user.id)
    .gte("run_at", oneHourAgo);

  if (typeof count === "number" && count >= hourlyLimit) {
    return NextResponse.json(
      { error: `You've hit ${hourlyLimit} runs this hour. Take 5, then try again.` },
      { status: 429 },
    );
  }

  const { data: row, error } = await admin
    .from("users")
    .select(
      "id, email, first_name, profile, locations, work_modes, target_ctc, phone, notice_period, notes, email_frequency, email_time, timezone, google_refresh_token_enc, user_sheet_id, last_run_at, free_until, is_paying, role_family, pivot_enabled, pivot_brief, search_query",
    )
    .eq("id", user.id)
    .single();

  if (error || !row) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }
  if (!row.profile || Object.keys(row.profile as object).length === 0) {
    return NextResponse.json(
      { error: "Upload your resume first — we need a profile to match against." },
      { status: 400 },
    );
  }

  const userRow = row as UserRow;

  // ---- OpenAI Web Search — fire in parallel with the daily pipeline. ----
  // Runs on a separate promise so aggregator results aren't held up if
  // OpenAI is slow. Results are merged into the user's dashboard after
  // both complete.
  const openaiPromise = runOpenAIWebSearch(userRow);

  const runStart = Date.now();
  try {
    const { matchesFound, emailed, providers } = await runDailyForUser(userRow);
    const openaiResult = await openaiPromise;

    // Persist OpenAI jobs to job_matches so they show up on the
    // dashboard alongside the aggregator matches. Kept separate from
    // runDailyForUser's own persistence path so the two flows don't
    // fight over the same rows.
    let tailoredOpenAICount = 0;
    if (openaiResult.jobs.length > 0) {
      await persistOpenAIJobs(userRow.id, openaiResult.jobs);
      // Auto-tailor the top OPENAI_AUTO_TAILOR_CAP jobs (default 3):
      // Sonnet-tailored resume + cover letter + InMail draft + Drive
      // PDFs. Same treatment as the top-5 aggregator matches get in
      // the nightly digest. Runs after persist so if tailoring fails
      // the row still exists as a summary.
      tailoredOpenAICount = await tailorTopOpenAIJobs(
        userRow,
        openaiResult.jobs,
      );
    }

    await admin.from("job_runs").insert({
      user_id: user.id,
      jobs_found: matchesFound + openaiResult.jobs.length,
      jobs_emailed: emailed,
      status: emailed === 0 ? "partial" : "ok",
      duration_ms: Date.now() - runStart,
    });
    await admin
      .from("users")
      .update({ last_run_at: new Date().toISOString() })
      .eq("id", user.id);

    return NextResponse.json({
      matchesFound: matchesFound + openaiResult.jobs.length,
      emailed,
      providers,
      openai: {
        jobsFound: openaiResult.jobs.length,
        jobsTailored: tailoredOpenAICount,
        cached: openaiResult.skipped === "cached",
        skipped: openaiResult.skipped ?? null,
        error: openaiResult.error ?? null,
        sourcesConsulted: openaiResult.sources.length,
      },
    });
  } catch (err) {
    await admin.from("job_runs").insert({
      user_id: user.id,
      status: "error",
      error: (err as Error).message,
      duration_ms: Date.now() - runStart,
    });
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}

// ==================================================================
// OpenAI Web Search integration
// ==================================================================

/**
 * Run OpenAI web search for this user, honoring:
 *   - env kill switch (OPENAI_WEB_SEARCH_ENABLED=false)
 *   - per-user daily cap (default 3)
 *   - 6h cache on identical criteria
 * Every code path writes exactly one row to openai_websearch_calls
 * for cost telemetry and auditability.
 */
async function runOpenAIWebSearch(
  userRow: UserRow,
): Promise<OpenAIWebSearchResult> {
  const cfg = serverConfig();
  const admin = supabaseAdmin();

  if (!cfg.OPENAI_WEB_SEARCH_ENABLED) {
    return { jobs: [], sources: [], openaiResponseId: null, skipped: "disabled" };
  }
  if (!cfg.OPENAI_API_KEY) {
    return { jobs: [], sources: [], openaiResponseId: null, skipped: "no-key" };
  }

  // Build the same JobSearchQuery the aggregator pipeline uses so the
  // OpenAI provider sees identical intent. Simplified: no pivot brief
  // support for now — we can add if it proves valuable.
  const profile = userRow.profile as UserProfile;
  const query =
    (userRow.search_query ?? "").trim() ||
    profile.experience?.[0]?.title?.trim() ||
    "engineer";
  const locations = (userRow.locations ?? []).length
    ? canonicalLocationLabels(userRow.locations ?? [])
    : ["India"];
  const workMode = ((userRow.work_modes ?? [])[0] ?? "any") as
    | "remote"
    | "hybrid"
    | "onsite"
    | "any";

  const jobSearchQuery = {
    query,
    locations,
    workMode,
    limit: 10,
    postedWithinDays: 14,
  };

  const criteriaHash = hashCriteria(jobSearchQuery);

  // Cache check — reuse the last successful (non-cached, no-error)
  // response with the same criteria hash within the last 6 hours.
  const sixHoursAgo = new Date(Date.now() - 6 * 3600_000).toISOString();
  const { data: cacheRow } = await admin
    .from("openai_websearch_calls")
    .select("cached_jobs, cached_sources")
    .eq("user_id", userRow.id)
    .eq("criteria_hash", criteriaHash)
    .gte("created_at", sixHoursAgo)
    .is("error", null)
    .not("cached_jobs", "is", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (cacheRow?.cached_jobs) {
    // Log the cache hit (zero cost, no OpenAI call).
    await admin.from("openai_websearch_calls").insert({
      user_id: userRow.id,
      criteria_hash: criteriaHash,
      criteria_snapshot: jobSearchQuery,
      cached: true,
      openai_response_id: null,
      duration_ms: 0,
      jobs_returned: (cacheRow.cached_jobs as JobPosting[]).length,
      cost_estimate_usd: 0,
      cached_jobs: cacheRow.cached_jobs,
      cached_sources: cacheRow.cached_sources ?? [],
    });
    return {
      jobs: cacheRow.cached_jobs as JobPosting[],
      sources: (cacheRow.cached_sources ?? []) as OpenAIWebSearchResult["sources"],
      openaiResponseId: null,
      skipped: "cached",
    };
  }

  // Per-user daily cap check. Count only calls that actually hit
  // OpenAI (cached rows don't count against the cap).
  const startOfToday = new Date();
  startOfToday.setUTCHours(0, 0, 0, 0);
  const { count: todaysCallCount } = await admin
    .from("openai_websearch_calls")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userRow.id)
    .eq("cached", false)
    .gte("created_at", startOfToday.toISOString());

  if ((todaysCallCount ?? 0) >= cfg.OPENAI_WEB_SEARCH_DAILY_CAP) {
    await admin.from("openai_websearch_calls").insert({
      user_id: userRow.id,
      criteria_hash: criteriaHash,
      criteria_snapshot: jobSearchQuery,
      cached: false,
      openai_response_id: null,
      duration_ms: 0,
      jobs_returned: 0,
      cost_estimate_usd: 0,
      error: `Daily cap reached (${cfg.OPENAI_WEB_SEARCH_DAILY_CAP})`,
    });
    return {
      jobs: [],
      sources: [],
      openaiResponseId: null,
      skipped: "over-cap",
    };
  }

  // Fire the actual OpenAI call. Pass profile context so the model can
  // do proper semantic title expansion — otherwise a bare query like
  // "Solutions" makes the model guess and we get 1 hit out of 47
  // sources. See src/lib/providers/jobs/openai-web-search.ts buildCriteria().
  const rf = userRow.role_family ? findRoleFamily(userRow.role_family) : undefined;
  const start = Date.now();
  const provider = new OpenAIWebSearchProvider();
  const result = await provider.searchWithEnvelope(jobSearchQuery, {
    profile,
    roleFamilyLabel: rf?.label,
    careerGoal: profile.headline,
  });
  const durationMs = Date.now() - start;

  // Rough cost estimate — see docs: $10/1K web search calls + tokens.
  // We can't measure tokens without a follow-up API call, so approximate
  // by (jobs*80 output tokens + 2000 input tokens) at Terra rates
  // (~$1/M in, $5/M out; check the live pricing page). Total per call:
  //   $10/1000 = $0.010 + tokens (~$0.02) = ~$0.03 ceiling.
  const costEstimate = result.error
    ? 0
    : 0.010 + (result.jobs.length * 80 + 2000) * (1 / 1_000_000) * 3;

  await admin.from("openai_websearch_calls").insert({
    user_id: userRow.id,
    criteria_hash: criteriaHash,
    criteria_snapshot: jobSearchQuery,
    cached: false,
    openai_response_id: result.openaiResponseId,
    duration_ms: durationMs,
    jobs_returned: result.jobs.length,
    cost_estimate_usd: Number(costEstimate.toFixed(4)),
    error: result.error ?? null,
    cached_jobs: result.error ? null : result.jobs,
    cached_sources: result.error ? null : result.sources,
  });

  return result;
}

/**
 * Bump this when we change the OpenAI request shape in a way that
 * would meaningfully alter results (new prompt, new schema fields,
 * loosened thresholds, added profile context). Every cache row is
 * keyed on the version, so a bump silently invalidates the old cache
 * without needing a DB migration or a manual delete.
 *
 * v2 (2026-08-01): passing profile context + lowered min_fit_score
 * 65 -> 50 + max_results 10 -> 20. v1 results were too narrow.
 */
const CACHE_KEY_VERSION = 'v2';

/**
 * Sha1-fingerprint of the criteria that meaningfully affect results.
 * Two calls with the same fingerprint reuse the same response body.
 */
function hashCriteria(q: {
  query: string;
  locations: string[];
  workMode: string;
  limit: number;
  postedWithinDays: number;
}): string {
  const canonical = JSON.stringify({
    v: CACHE_KEY_VERSION,
    query: q.query.toLowerCase().trim(),
    locations: [...q.locations].sort(),
    workMode: q.workMode,
    limit: q.limit,
    postedWithinDays: q.postedWithinDays,
  });
  return createHash("sha1").update(canonical).digest("hex");
}

/**
 * Persist OpenAI-sourced jobs into job_matches so they render on
 * the dashboard alongside aggregator matches. Marked as summary-only
 * (no tailored resume yet) — the existing "Tailor this match" flow
 * on the dashboard can enrich them on demand.
 */
async function persistOpenAIJobs(
  userId: string,
  jobs: JobPosting[],
): Promise<void> {
  if (jobs.length === 0) return;
  const admin = supabaseAdmin();
  const rows = jobs.map((j) => ({
    user_id: userId,
    apply_url: j.url,
    ats: 'openai_web',
    ats_id: j.id,
    job_title: j.title,
    company: j.company,
    match_percent: j.preVerifiedFitScore ?? null,
    verify_score: j.preVerifiedFitScore ?? null,
    tailored_resume_text: null,
    tailored_resume_pdf_url: null,
    tailored_resume_doc_url: null,
    cover_letter_text: null,
    cover_letter_pdf_url: null,
    cover_letter_doc_url: null,
    why_this_role: j.matchReasons?.[0] ?? null,
    summary: j.description?.slice(0, 500) ?? null,
    // AI-discovery enrichment: rendered as chip + expandable panel on
    // /all-matches. Aggregator-sourced rows leave this column null.
    openai_metadata: {
      match_level: j.matchLevel,
      match_reasons: j.matchReasons ?? [],
      potential_gaps: j.potentialGaps ?? [],
      evidence_urls: j.evidenceUrls ?? [],
      location: j.location,
      work_mode: j.workMode,
    },
    updated_at: new Date().toISOString(),
  }));
  const { error } = await admin
    .from("job_matches")
    .upsert(rows, { onConflict: "user_id,apply_url" });
  if (error) {
    console.error("[run-now] persistOpenAIJobs failed", error);
  }
}

/**
 * Auto-tailor the top OpenAI-discovered jobs. For each: tailor the
 * résumé + draft a cover letter + draft an InMail + save PDF/Doc to
 * the user's Drive (if OAuth connected). Persists the results back
 * to the same job_matches row so /all-matches renders them with a
 * ✓ Tailored chip and working download buttons.
 *
 * Bounded by OPENAI_AUTO_TAILOR_CAP (default 3) so a run-now call
 * doesn't spend $2 in Sonnet on 20 tailored résumés.
 *
 * Each job's tailor step runs in parallel — Sonnet handles that fine
 * and users have already waited 20-40s for the search. Individual
 * failures are caught and logged; other jobs still succeed.
 */
async function tailorTopOpenAIJobs(
  userRow: UserRow,
  jobs: JobPosting[],
): Promise<number> {
  const cfg = serverConfig();
  const cap = cfg.OPENAI_AUTO_TAILOR_CAP;
  if (cap === 0 || jobs.length === 0) return 0;

  const profile = userRow.profile as UserProfile;
  const admin = supabaseAdmin();

  // Highest fit_score first — tailor the ones users are most likely
  // to actually apply to.
  const sorted = [...jobs].sort(
    (a, b) => (b.preVerifiedFitScore ?? 0) - (a.preVerifiedFitScore ?? 0),
  );
  const toTailor = sorted.slice(0, cap);

  const refreshToken =
    userRow.user_sheet_id && userRow.google_refresh_token_enc
      ? decrypt(userRow.google_refresh_token_enc)
      : null;

  const results = await Promise.allSettled(
    toTailor.map(async (job) => {
      const match = await tailorMatch({
        profile,
        job,
        refreshToken,
      });
      // Update the persisted job_matches row with tailored content.
      // Use the same apply_url the persist step wrote so we hit the
      // right upsert.
      const tailoredText = [
        match.tailored.summary,
        match.tailored.highlightedSkills?.length
          ? 'Skills: ' + match.tailored.highlightedSkills.join(', ')
          : null,
        ...(match.tailored.experienceBullets ?? []).flatMap((exp) => [
          `\n${exp.title} — ${exp.company}`,
          ...(exp.bullets ?? []).map((b) => `• ${b}`),
        ]),
      ]
        .filter(Boolean)
        .join('\n')
        .trim();
      const coverText = match.coverLetter
        ? [
            match.coverLetter.greeting,
            ...(match.coverLetter.paragraphs ?? []),
            match.coverLetter.closing,
            '— Your name',
          ]
            .filter(Boolean)
            .join('\n\n')
        : null;

      await admin
        .from('job_matches')
        .update({
          tailored_resume_text: tailoredText,
          tailored_resume_pdf_url: match.tailoredResumeUrl ?? null,
          tailored_resume_doc_url: match.tailoredResumeDocUrl ?? null,
          cover_letter_text: coverText,
          cover_letter_pdf_url: match.coverLetterUrl ?? null,
          cover_letter_doc_url: match.coverLetterDocUrl ?? null,
          why_this_role:
            match.coverLetter?.paragraphs?.[0] ??
            job.matchReasons?.[0] ??
            null,
          summary: match.tailored.summary ?? null,
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', userRow.id)
        .eq('apply_url', job.url);
      return true;
    }),
  );
  const succeeded = results.filter(
    (r) => r.status === 'fulfilled' && r.value === true,
  ).length;
  const failed = results.length - succeeded;
  if (failed > 0) {
    console.warn(
      `[run-now] openai auto-tailor: ${succeeded} succeeded, ${failed} failed of ${toTailor.length}`,
    );
  }
  return succeeded;
}
