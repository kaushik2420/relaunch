import { supabaseAdmin } from '@/lib/supabase/admin';
import { decrypt } from '@/lib/crypto';
import { fetchJobsFromAll, lastFetchSummary, type ProviderResult } from '@/lib/providers/jobs';
import { rankJobs } from './job-matcher';
import { llm } from '@/lib/providers/llm';
import { sheets } from '@/lib/providers/sheets';
import { email as emailProvider } from '@/lib/providers/email';
import { findReferrers, buildConnectionsSearchUrl } from './referrer-finder';
import { canonicalLocationLabels } from '@/lib/locations';
import {
  findRoleFamily,
  queryMatchesFamily,
  familyQuery,
} from '@/lib/role-families';
import { classifyAtsUrl } from '@/lib/ats-url';
import { fetchWatchedCompanyJobs } from './watched-fetch';
import { monitorManualWatched } from './manual-careers-monitor';
import { applyTitleGuard } from './title-guard';
import type { TailoredJobMatch, UserProfile, UserPreferences, PivotBrief, TailoredResume, CoverLetter, JobPosting } from '@/lib/types';

/**
 * Process a single user's daily run.
 * Stateless — call this in a loop or fan out as parallel function invocations.
 */
export async function runDailyForUser(userRow: UserRow): Promise<{ matchesFound: number; emailed: number; providers: ProviderResult[] }> {
  const profile = userRow.profile as UserProfile;
  const prefs: UserPreferences = {
    locations: userRow.locations ?? [],
    workModes: (userRow.work_modes ?? []) as UserPreferences['workModes'],
    targetCtc: userRow.target_ctc ?? undefined,
    phone: userRow.phone ?? undefined,
    noticePeriod: userRow.notice_period ?? undefined,
    notes: userRow.notes ?? undefined,
    emailFrequency: (userRow.email_frequency ?? 'daily') as UserPreferences['emailFrequency'],
    emailTime: userRow.email_time ?? '08:30',
    timezone: userRow.timezone ?? 'Asia/Kolkata',
  };

  // Career-pivot: if the user turned on pivot mode and we have a
  // synthesized brief, the search is driven by the brief — not their
  // resume history. role_family was already set to the pivot target
  // when preferences were saved.
  const pivotBrief = parsePivotBrief(userRow);

  // 1. Pull jobs across all enabled providers.
  //
  // Query strategy: the job APIs (Adzuna, Jooble, JSearch) want SHORT
  // keyword phrases like "Product Manager", not full headlines like
  // "Senior Product Manager with 7 years in fintech driving 0->1 launches".
  // For pivot users we use the brief's searchQuery; otherwise we derive
  // a clean role title from the most recent experience entry, strip
  // seniority words, and cap to ~40 chars.
  // Query resolution order: pivot brief > explicit search_query > résumé.
  const userSearchQuery = (userRow.search_query ?? '').trim();
  let query =
    pivotBrief?.searchQuery?.trim() ||
    userSearchQuery ||
    deriveJobQuery(profile);
  // If the user picked a role family AND nothing explicit was supplied AND
  // the résumé-derived query doesn't hint at the family, the résumé is out
  // of date / mid-career-change — trust the dropdown instead.
  const rf = userRow.role_family ? findRoleFamily(userRow.role_family) : undefined;
  if (rf && !pivotBrief && !userSearchQuery && !queryMatchesFamily(query, rf)) {
    const override = familyQuery(rf);
    console.log(
      `[daily-runner] query "${query}" doesn't match role_family "${rf.id}" — using "${override}" instead`,
    );
    query = override;
  }
  console.log(`[daily-runner] query="${query}" pivot=${pivotBrief ? 'on' : 'off'} roleFamily=${userRow.role_family ?? '(none)'} locations=${(prefs.locations.length ? prefs.locations : ['India']).join(',')}`);
  // Providers want one clean city name per request, not the expanded
  // alias list we store for substring filtering. Convert before sending.
  const queryLocations = prefs.locations.length
    ? canonicalLocationLabels(prefs.locations)
    : ['India'];
  const [jobsFromProviders, jobsFromWatched] = await Promise.all([
    fetchJobsFromAll({
      query,
      locations: queryLocations,
      workMode: prefs.workModes[0] ?? 'any',
      roleFamily: (userRow.role_family as 'engineering' | 'product' | 'design' | 'data' | 'marketing' | 'operations' | 'sales' | 'other' | null) ?? undefined,
      limit: 60,
      postedWithinDays: 7,
    }),
    // User-curated watchlist: pulls from every detected company's
    // ATS board, all roles (no keyword filter — the ranker decides).
    fetchWatchedCompanyJobs(userRow.id),
  ]);
  // Merge — let the embedding ranker decide which watched-company
  // roles are actually a fit. Dedupe in fetchJobsFromAll is by
  // (company, title); we rely on the rest of the pipeline for it.
  const rawJobs = [...jobsFromProviders, ...jobsFromWatched];

  // 1b. Title guardrail — strip obvious wrong-role postings the fuzzy
  // providers dragged in (e.g. "Product Marketing Manager" for a PM
  // search). See src/lib/services/title-guard.ts for the family-by-
  // family rules. No-op for families without configured rules.
  const { kept: jobs, dropped: guardDropped } = applyTitleGuard(
    rawJobs,
    userRow.role_family ?? null,
  );
  if (guardDropped.length > 0) {
    console.log(
      `[daily-runner] title-guard(${userRow.role_family}): dropped ${guardDropped.length}/${rawJobs.length} — samples: ${guardDropped.slice(0, 5).map((j) => `"${j.title}"`).join(', ')}`,
    );
  }

  // 2. Rank + filter; take the top N (configurable)
  const ranked = await rankJobs(jobs, profile, prefs);
  if (!ranked.length) {
    return { matchesFound: 0, emailed: 0, providers: lastFetchSummary() };
  }

  // 2b. Embedding rank is fast but coarse. Take the top 25 candidates,
  // then ask Claude (Haiku) to verify each is actually about the kind of
  // role this user wants. Drops obvious mismatches before we spend
  // Sonnet tokens tailoring them.
  //
  // Why 25 not 10: at 10 the LLM-verified pool was producing only
  // 5-8 matches surfaced per user per day. Users have asked for more
  // to apply to. Haiku verify calls are ~$0.0005 each, so 25 per user
  // per day = ~$0.01/user/day = ~$0.30/user/month.
  const shortlist = ranked.slice(0, 25);
  const verified = await Promise.all(
    shortlist.map(async (r) => {
      // Fast path: OpenAI Web Search already scored this job with the
      // full context of the profile + criteria. Trust it and skip the
      // Haiku call. Saves ~$0.0005/verify × the count of OpenAI-sourced
      // jobs in the shortlist.
      if (
        r.job.discoverySource === 'openai_web' &&
        typeof r.job.preVerifiedFitScore === 'number'
      ) {
        return {
          ...r,
          verifyScore: r.job.preVerifiedFitScore,
          verifyReason:
            r.job.matchReasons?.[0] ?? 'Pre-scored by OpenAI web search',
        };
      }
      try {
        const v = await llm().verifyJobMatch({
          profile,
          job: r.job,
          targetRoleFamily: rf?.id,
          pivotBrief: pivotBrief ?? undefined,
        });
        return { ...r, verifyScore: v.score, verifyReason: v.reason };
      } catch (err) {
        console.error('[daily-runner] verifyJobMatch failed', err);
        return { ...r, verifyScore: 50, verifyReason: '' };
      }
    }),
  );
  // Lower threshold to 30 (from 40) — keeps marginal-but-plausible
  // matches in the pool. The user sees them in the /all-matches view;
  // only the top 5 still get full tailoring in the email digest.
  const passed = verified.filter((r) => r.verifyScore >= 30);

  // Dedupe against anything we've already surfaced to this user in
  // the past 7 days — same job shouldn't appear in the digest two
  // days in a row. We compare on canonical apply_url so wrapper-vs-
  // direct URL variants are treated as the same role.
  const sevenDaysAgo = new Date(
    Date.now() - 7 * 24 * 60 * 60 * 1000,
  ).toISOString();
  const { data: recentRows } = await supabaseAdmin()
    .from('job_matches')
    .select('apply_url')
    .eq('user_id', userRow.id)
    .gte('created_at', sevenDaysAgo);
  const recentUrls = new Set(
    (recentRows ?? []).map((r) => r.apply_url as string),
  );

  const fresh = passed.filter((r) => {
    const canonical = classifyAtsUrl(r.job.url).canonical;
    return !recentUrls.has(canonical);
  });
  // If every match passed the 7-day dedupe, we have nothing fresh —
  // fall back to the full passed set rather than emailing nothing.
  const usable = fresh.length > 0 ? fresh : passed.length ? passed : verified;
  usable.sort(
    (a, b) =>
      (b.matchPercent + b.verifyScore) / 2 -
      (a.matchPercent + a.verifyScore) / 2,
  );
  // Email digest grew from 5 → 10: top 5 fully tailored (sent below),
  // bottom 5 surfaced as link-only previews so the user has more to
  // scan without us doubling Claude spend.
  const top = usable.slice(0, 5);
  const digestPreviews = usable.slice(5, 10);
  // Everything beyond the top 5 — persisted to job_matches as
  // summary-only rows (no tailored text). The dashboard surfaces them,
  // and the user can enrich any one via the extension or a dashboard
  // 'Tailor this' action.
  const rest = usable.slice(5);
  console.log(
    `[daily-runner] verified shortlist: kept ${passed.length}/${shortlist.length}, top scores ${top.map((t) => `${t.matchPercent}/${t.verifyScore}`).join(', ')}`,
  );

  // We may need the Google refresh token both for writing the Sheet AND
  // for creating tailored-resume Docs. Decode once, share between steps.
  const refreshToken =
    userRow.user_sheet_id && userRow.google_refresh_token_enc
      ? decrypt(userRow.google_refresh_token_enc)
      : null;

  // 3. For each top match, in parallel:
  //    (a) tailor the resume + draft a cover letter via Claude
  //    (b) render both to Drive (PDF + editable .docx each)
  //    (c) look up 1-2 potential referrers (Proxycurl; no-op if no key)
  //    (d) draft an InMail addressed to the referrer (or generic if none)
  // Each step is wrapped in try/catch — a single failure shouldn't kill
  // the whole match. Better to ship a partial row than nothing.
  const matches: (TailoredJobMatch & { verifyScore?: number | null })[] = await Promise.all(
    top.map(async ({ job, matchPercent, reasons, verifyScore }) => {
      // (a) Resume tailoring + cover letter — independent Claude calls,
      //     run them together. tailorResume is required (throw kills the
      //     match); a cover-letter failure just drops the letter.
      const [tailored, coverLetter] = await Promise.all([
        llm().tailorResume({ profile, job, pivotBrief: pivotBrief ?? undefined }),
        llm()
          .draftCoverLetter({ profile, job, pivotBrief: pivotBrief ?? undefined })
          .catch((err) => {
            console.error('draftCoverLetter failed', err);
            return undefined;
          }),
      ]);

      // (b) Save the resume to Drive — polished PDF + editable .docx.
      let tailoredResumeUrl: string | undefined;
      let tailoredResumeDocUrl: string | undefined;
      let coverLetterUrl: string | undefined;
      let coverLetterDocUrl: string | undefined;
      if (refreshToken) {
        try {
          const r = await sheets().createTailoredResume({
            refreshToken,
            company: job.company,
            role: job.title,
            profile,
            tailored,
          });
          tailoredResumeUrl = r.pdfUrl;
          tailoredResumeDocUrl = r.docUrl;
        } catch (err) {
          console.error('createTailoredResume failed', err);
        }

        // Cover letter to Drive — also PDF + editable .docx.
        if (coverLetter) {
          try {
            const c = await sheets().createCoverLetter({
              refreshToken,
              company: job.company,
              role: job.title,
              profile,
              letter: coverLetter,
            });
            coverLetterUrl = c.pdfUrl;
            coverLetterDocUrl = c.docUrl;
          } catch (err) {
            console.error('createCoverLetter failed', err);
          }
        }
      }

      // (c) Build a LinkedIn deep-link to the user's 2nd-degree network
      //     at this company. Free, more private, more useful than paid APIs.
      const connectionsSearchUrl = buildConnectionsSearchUrl({
        company: job.company,
        title: job.title,
      });

      // Optional: if a future LinkedIn data API is wired, this populates names.
      // For now this always returns [] (no API cost). Kept so the pipeline
      // gracefully starts using names the moment a provider is plugged in.
      let referrers: TailoredJobMatch['referrers'] = [];
      try {
        referrers = await findReferrers({ profile, job, limit: 2 });
      } catch (err) {
        console.error('findReferrers failed', err);
      }

      // (d) InMail — always draft. If we ever have a specific referrer
      // (e.g. LinkedIn OAuth populates it later), use the first one.
      let inmailDraft: TailoredJobMatch['inmailDraft'] | undefined;
      try {
        inmailDraft = await llm().draftInmail({
          profile,
          job,
          referrer: referrers[0],
        });
      } catch (err) {
        console.error('draftInmail failed', err);
      }

      return {
        job,
        matchPercent,
        reasons,
        tailored,
        tailoredResumeUrl,
        tailoredResumeDocUrl,
        coverLetter,
        coverLetterUrl,
        coverLetterDocUrl,
        referrers,
        connectionsSearchUrl,
        inmailDraft,
        verifyScore,
      };
    })
  );

  // 4. Append to user's Sheet (if connected)
  if (userRow.user_sheet_id && refreshToken) {
    await sheets().appendMatches(userRow.user_sheet_id, refreshToken, matches);
  }

  // 4b. Persist each match to job_matches so the Chrome extension can
  //     read tailored content on the apply page. Forward-only — no
  //     backfill, so users only see matches generated after migration
  //     0010 lands. Failure here is non-fatal (the sheet + email are
  //     already out the door).
  try {
    await persistJobMatches(userRow.id, matches);
  } catch (err) {
    console.error('[daily-runner] persistJobMatches failed', err);
  }

  // 4c. ALSO persist the rest of today's ranked matches (those ranked
  //     6..N that passed verify) as summary-only rows. No tailored
  //     text, just URL + title + company + match score. The dashboard
  //     "All matches" view surfaces these so users have a bigger pool
  //     to scan, and they can enrich any one via the extension or the
  //     in-dashboard "Tailor this match" button.
  try {
    await persistMatchSummaries(
      userRow.id,
      rest.map((r) => ({
        job: r.job,
        matchPercent: r.matchPercent,
        verifyScore: r.verifyScore,
      })),
    );
  } catch (err) {
    console.error('[daily-runner] persistMatchSummaries failed', err);
  }

  // 4d. The "long tail" — jobs that the embedding ranker liked but that
  // we didn't have budget to LLM-verify (ranks 26..50 of the full
  // ranked list). Filtered to >=45% match so the bottom of the pool
  // doesn't surface obvious garbage. Was 35 — bumped after PM users
  // reported wrong-role postings ("Product Marketing Manager" etc.)
  // leaking through. verify_score stays null so the dashboard chips
  // these as "Discovered" rather than "Verified".
  try {
    const longTail = ranked
      .slice(25, 50)
      .filter((r) => r.matchPercent >= 45);
    await persistMatchSummaries(
      userRow.id,
      longTail.map((r) => ({
        job: r.job,
        matchPercent: r.matchPercent,
        verifyScore: null,
      })),
    );
    console.log(
      `[daily-runner] long-tail pool persisted: ${longTail.length} jobs (ranks 26-50, >=35%)`,
    );
  } catch (err) {
    console.error('[daily-runner] persistLongTail failed', err);
  }

  // 4e. Manual watchlist monitoring — for companies where ATS auto-
  // detect failed and the user pasted a careers URL, fetch the page,
  // diff <a href> links against last_seen_urls, upsert anything new
  // into job_matches. First-fetch is capped at 10 inserts to avoid
  // flooding the dashboard on Day 1.
  try {
    const summary = await monitorManualWatched(userRow.id);
    if (summary.newJobsFound > 0) {
      console.log(
        `[daily-runner] manual-monitor surfaced ${summary.newJobsFound} new postings across ${summary.companiesChecked} manual companies`,
      );
    }
  } catch (err) {
    console.error('[daily-runner] monitorManualWatched failed', err);
  }

  // 5. Email digest — top 5 fully tailored + 5 link-only previews
  // for a total of up to 10 fresh roles per email.
  const totalInDigest = matches.length + digestPreviews.length;
  await emailProvider().send({
    to: userRow.email,
    subject: `${totalInDigest} fresh roles for you today 🌅`,
    html: renderDigestHtml(
      userRow.first_name ?? 'friend',
      matches,
      digestPreviews.map((p) => ({
        title: p.job.title,
        company: p.job.company,
        location: p.job.location,
        url: p.job.url,
        matchPercent: p.matchPercent,
      })),
    ),
  });

  return { matchesFound: ranked.length, emailed: matches.length, providers: lastFetchSummary() };
}

/**
 * Pick the cleanest short keyword phrase to send to job-search APIs.
 *
 * Priority:
 *   1. Most recent job title — that's almost always what they want next
 *   2. Strip seniority prefixes ("Senior", "Lead", "Principal") — APIs
 *      filter on these inconsistently and they shrink the result pool
 *   3. Strip trailing department/team noise ("Growth", "Platform") if
 *      title is still long after step 2
 *   4. Cap at 40 chars to stay friendly to all APIs
 *
 * Examples:
 *   "Senior Product Manager, Growth"        → "Product Manager Growth"
 *   "Staff Software Engineer at Flipkart"   → "Software Engineer"
 *   "Principal Designer, Platform"          → "Designer Platform"
 *   undefined                               → "engineer" (safe default)
 */
function deriveJobQuery(profile: UserProfile): string {
  const recent = profile.experience?.[0]?.title ?? '';
  let q = recent.trim();
  if (!q) return 'engineer';

  // Drop common seniority prefixes
  q = q.replace(/^(senior|sr\.?|junior|jr\.?|lead|staff|principal|head of|vp,?\s+)\s+/i, '');

  // Drop common suffixes that hurt match counts ("at Company")
  q = q.replace(/\s+(at|@)\s+.+$/i, '');

  // Collapse "Role - Department" / "Role, Department" to spaces
  q = q.replace(/[,\-–—]/g, ' ').replace(/\s+/g, ' ').trim();

  // Cap length
  if (q.length > 40) q = q.slice(0, 40).trim();
  return q || 'engineer';
}

/**
 * Returns the user's pivot brief only if pivot mode is on AND the brief
 * is usable (has a search query). pivot_brief comes back from Supabase
 * as already-parsed jsonb. Returns null otherwise so callers fall back
 * to the normal resume-derived behaviour.
 */
function parsePivotBrief(userRow: UserRow): PivotBrief | null {
  if (!userRow.pivot_enabled || !userRow.pivot_brief) return null;
  const b = userRow.pivot_brief as Partial<PivotBrief> | null;
  if (b && typeof b.searchQuery === 'string' && b.searchQuery.trim()) {
    return b as PivotBrief;
  }
  return null;
}

interface DigestPreview {
  title: string;
  company: string;
  location: string;
  url: string;
  matchPercent: number;
}

function renderDigestHtml(
  name: string,
  matches: TailoredJobMatch[],
  previews: DigestPreview[] = [],
): string {
  const total = matches.length + previews.length;
  const tailoredItems = matches
    .map(
      (m) => `
        <tr><td style="padding:14px 0;border-top:1px solid #E8DFC7;">
          <div style="font-size:16px;font-weight:600;">${escapeHtml(m.job.title)}</div>
          <div style="color:#58665C;font-size:13px;">${escapeHtml(m.job.company)} · ${escapeHtml(m.job.location)}</div>
          <div style="margin-top:6px;font-size:13px;color:#0F172A;">${escapeHtml(m.tailored.summary)}</div>
          <a href="${escapeHtml(m.job.url)}" style="display:inline-block;margin-top:8px;color:#2C5239;font-weight:600;">View role →</a>
        </td></tr>`,
    )
    .join('');

  // Bottom-5 link-only previews — kept visually lighter so the eye
  // doesn't read them as "another 5 tailored". Density over depth.
  const previewItems = previews.length === 0 ? '' : `
    <tr><td style="padding:18px 0 6px;border-top:2px solid #E8DFC7;">
      <div style="font-size:12px;text-transform:uppercase;letter-spacing:0.05em;color:#1A3826;font-weight:600;">Also worth a look</div>
      <div style="font-size:12px;color:#58665C;margin-top:2px;">${previews.length} more roles you can tailor on demand via the extension or your dashboard.</div>
    </td></tr>
    ${previews
      .map(
        (p) => `
        <tr><td style="padding:10px 0;border-top:1px solid #F4ECD8;">
          <div style="font-size:14px;font-weight:600;">${escapeHtml(p.title)}</div>
          <div style="color:#58665C;font-size:12px;margin-top:1px;">
            ${escapeHtml(p.company)} · ${escapeHtml(p.location)} ·
            <span style="color:#1A3826;font-weight:600;">${p.matchPercent}% match</span>
          </div>
          <a href="${escapeHtml(p.url)}" style="display:inline-block;margin-top:4px;color:#2C5239;font-size:12px;">View role →</a>
        </td></tr>`,
      )
      .join('')}
  `;

  return `<!doctype html>
<html><body style="font-family:-apple-system,Segoe UI,sans-serif;background:#FAF5E9;padding:24px;color:#1C2220;">
<table style="max-width:560px;margin:0 auto;background:#fff;padding:24px;border-radius:14px;">
  <tr><td>
    <h1 style="margin:0 0 6px;font-size:22px;">Good morning, ${escapeHtml(name)} 🌅</h1>
    <p style="margin:0 0 14px;color:#58665C;font-size:14px;">${total} roles picked for you today — top ${matches.length} are fully tailored below.</p>
    <table style="width:100%;border-collapse:collapse;">${tailoredItems}${previewItems}</table>
    <p style="color:#8C998F;font-size:12px;margin-top:18px;">All saved to your Google Sheet. <a href="https://www.get-relaunch.com/all-matches" style="color:#2C5239;">See all matches</a>. Reply STOP to pause emails.</p>
  </td></tr>
</table></body></html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
}

// ---------------------------------------------------------------
// Fetch the batch of users to process this hour
// ---------------------------------------------------------------
export async function pickUsersForThisHour(now = new Date()) {
  // Convert to UTC hour bucket — we'll match users whose (email_time, timezone)
  // resolves to this hour. We do this in SQL via a server function in v2;
  // for v1 we pull active users and filter in JS.
  const { data, error } = await supabaseAdmin()
    .from('users')
    .select(
      'id, email, first_name, profile, locations, work_modes, target_ctc, phone, notice_period, notes, email_frequency, email_time, timezone, google_refresh_token_enc, user_sheet_id, last_run_at, free_until, is_paying, role_family, pivot_enabled, pivot_brief, search_query'
    )
    .eq('is_active', true)
    .neq('email_frequency', 'paused');
  if (error) throw error;

  return (data ?? []).filter((u) => {
    if (!u.profile || Object.keys(u.profile as object).length === 0) return false;
    if (!shouldRunForFrequency(u as UserRow, now)) return false;
    if (!u.is_paying && new Date(u.free_until).getTime() < now.getTime()) return false;
    return matchesTimezoneHour(u as UserRow, now);
  }) as UserRow[];
}

function shouldRunForFrequency(u: UserRow, now: Date): boolean {
  if (!u.last_run_at) return true;
  const last = new Date(u.last_run_at).getTime();
  const hoursSince = (now.getTime() - last) / 3_600_000;
  switch (u.email_frequency) {
    case 'daily': return hoursSince >= 23;
    case '2days': return hoursSince >= 47;
    case 'weekly': return hoursSince >= 167;
    case 'realtime': return true;
    default: return false;
  }
}

function matchesTimezoneHour(u: UserRow, now: Date): boolean {
  try {
    const fmt = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hour12: false, timeZone: u.timezone ?? 'Asia/Kolkata' });
    const localHour = parseInt(fmt.format(now), 10);
    const targetHour = parseInt((u.email_time ?? '08:30').split(':')[0]!, 10);
    return localHour === targetHour;
  } catch {
    return false;
  }
}

export interface UserRow {
  id: string;
  email: string;
  first_name: string | null;
  profile: unknown;
  locations: string[] | null;
  work_modes: string[] | null;
  target_ctc: string | null;
  phone: string | null;
  notice_period: string | null;
  notes: string | null;
  email_frequency: string | null;
  email_time: string | null;
  timezone: string | null;
  google_refresh_token_enc: string | null;
  user_sheet_id: string | null;
  last_run_at: string | null;
  free_until: string;
  is_paying: boolean | null;
  role_family?: string | null;
  pivot_enabled?: boolean | null;
  pivot_brief?: unknown;
  search_query?: string | null;
}

// ====================================================================
// job_matches persistence — drives the Chrome extension's per-page lookup.
// ====================================================================

/** Plain-text serialization of a tailored résumé so the extension can
 *  paste it into "paste your résumé" textareas. PDFs go via pdf_url. */
function flattenTailoredResume(t: TailoredResume): string {
  const parts: string[] = [];
  if (t.summary) parts.push(t.summary);
  if (t.highlightedSkills?.length) {
    parts.push('Skills: ' + t.highlightedSkills.join(', '));
  }
  for (const exp of t.experienceBullets ?? []) {
    parts.push(`\n${exp.title} — ${exp.company}`);
    for (const b of exp.bullets ?? []) parts.push(`• ${b}`);
  }
  return parts.join('\n').trim();
}

/** Plain-text serialization of the cover letter for textarea fill. */
function flattenCoverLetter(cl: CoverLetter): string {
  return [cl.greeting, ...(cl.paragraphs ?? []), cl.closing, '— Your name']
    .filter(Boolean)
    .join('\n\n');
}

/** Extension's "Why this role?" answer. We use the first body paragraph
 *  of the cover letter — that's where the why-this-role pitch lives. */
function deriveWhyThisRole(cl: CoverLetter | undefined): string | null {
  if (!cl?.paragraphs?.length) return null;
  return cl.paragraphs[0] ?? null;
}

async function persistJobMatches(
  userId: string,
  matches: (TailoredJobMatch & { verifyScore?: number | null })[],
): Promise<void> {
  if (!matches.length) return;
  const rows = matches.map((m) => {
    const cls = classifyAtsUrl(m.job.url);
    const tailoredText = flattenTailoredResume(m.tailored);
    const coverText = m.coverLetter
      ? flattenCoverLetter(m.coverLetter)
      : null;
    return {
      user_id: userId,
      apply_url: cls.canonical,
      ats: cls.ats,
      ats_id: cls.atsId,
      job_title: m.job.title,
      company: m.job.company,
      match_percent: m.matchPercent ?? null,
      verify_score: m.verifyScore ?? null,
      tailored_resume_text: tailoredText,
      tailored_resume_pdf_url: m.tailoredResumeUrl ?? null,
      tailored_resume_doc_url: m.tailoredResumeDocUrl ?? null,
      cover_letter_text: coverText,
      cover_letter_pdf_url: m.coverLetterUrl ?? null,
      cover_letter_doc_url: m.coverLetterDocUrl ?? null,
      why_this_role: deriveWhyThisRole(m.coverLetter),
      summary: m.tailored.summary ?? null,
      updated_at: new Date().toISOString(),
    };
  });

  // Upsert on (user_id, apply_url) — re-running the daily runner for the
  // same job updates the row instead of inserting a duplicate.
  const { error } = await supabaseAdmin()
    .from('job_matches')
    .upsert(rows, { onConflict: 'user_id,apply_url' });
  if (error) {
    console.error('[daily-runner] upsert job_matches failed', error);
  }
}

/**
 * Persist matches that we haven't paid to tailor (ranked 6..N). Same
 * shape as persistJobMatches but with the text + PDF fields null. The
 * dashboard's "All today's matches" view surfaces these, and the user
 * can enrich any one on demand via the extension or a 'Tailor this'
 * action. Dedup-safe — upsert on (user_id, apply_url) means re-running
 * the daily run for the same job doesn't blow away an already-tailored
 * row (the existing text fields are preserved on conflict because we
 * only set them to null in the INSERT path; on UPDATE we... actually
 * Supabase upsert overwrites by default, so we have to skip rows
 * where the canonical URL is already present in the tailored set).
 */
async function persistMatchSummaries(
  userId: string,
  summaries: {
    job: JobPosting;
    matchPercent: number;
    verifyScore?: number | null;
  }[],
): Promise<void> {
  if (!summaries.length) return;

  // Dedup by canonical URL within this batch (rare but safe).
  const byUrl = new Map<string, (typeof summaries)[number]>();
  for (const s of summaries) {
    const c = classifyAtsUrl(s.job.url).canonical;
    if (!byUrl.has(c)) byUrl.set(c, s);
  }

  // Skip any URL we've already tailored for this user — we don't want
  // to overwrite a tailored row with nulls. Cheap pre-check.
  const canonicals = Array.from(byUrl.keys());
  const { data: existing } = await supabaseAdmin()
    .from('job_matches')
    .select('apply_url, tailored_resume_text')
    .eq('user_id', userId)
    .in('apply_url', canonicals);
  const tailoredAlready = new Set(
    (existing ?? [])
      .filter((r) => (r.tailored_resume_text as string | null) != null)
      .map((r) => r.apply_url as string),
  );

  const rows = Array.from(byUrl.entries())
    .filter(([url]) => !tailoredAlready.has(url))
    .map(([url, s]) => {
      const cls = classifyAtsUrl(s.job.url);
      return {
        user_id: userId,
        apply_url: cls.canonical,
        ats: cls.ats,
        ats_id: cls.atsId,
        job_title: s.job.title,
        company: s.job.company,
        match_percent: s.matchPercent ?? null,
        verify_score: s.verifyScore ?? null,
        // Text + PDF columns intentionally null — these are summary-only.
        tailored_resume_text: null,
        tailored_resume_pdf_url: null,
        tailored_resume_doc_url: null,
        cover_letter_text: null,
        cover_letter_pdf_url: null,
        cover_letter_doc_url: null,
        why_this_role: null,
        summary: null,
        updated_at: new Date().toISOString(),
      };
    });

  if (rows.length === 0) return;
  const { error } = await supabaseAdmin()
    .from('job_matches')
    .upsert(rows, { onConflict: 'user_id,apply_url' });
  if (error) {
    console.error('[daily-runner] upsert summary job_matches failed', error);
  }
}
