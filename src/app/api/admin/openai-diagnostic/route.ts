import { NextResponse, type NextRequest } from 'next/server';
import { createSupabaseServer } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { serverConfig } from '@/lib/config';
import { OpenAIWebSearchProvider } from '@/lib/providers/jobs/openai-web-search';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * OpenAI Web Search diagnostic. Admin-only.
 *
 * Answers "why is AI-discovered not returning anything?" without
 * digging through Vercel logs. Fires a canned query at the Responses
 * API, returns:
 *
 *   - env: which OpenAI-related knobs are actually set + effective values
 *   - liveCall: fresh call outcome — status, duration, job count,
 *               source count, first 3 preview jobs, response id
 *   - rawProbe: bypasses our provider mapping and shows the raw HTTP
 *               response (status + body snippet). Catches model-name
 *               issues, org quota, schema rejection, etc.
 *   - recentCalls: last 10 rows from openai_websearch_calls (all users)
 *                  with error text so you can spot patterns
 *   - verdict: one-line diagnosis
 *
 * Usage:
 *   GET /api/admin/openai-diagnostic?q=product+manager&loc=Bangalore
 * Or with x-cron-secret header for curl access.
 */
export async function GET(req: NextRequest) {
  const cfg = serverConfig();

  const cronSecret = req.headers.get('x-cron-secret') ?? '';
  const bearer = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  const hasCronAuth =
    (cronSecret && cronSecret === cfg.CRON_SECRET) ||
    (bearer && bearer === cfg.CRON_SECRET);

  if (!hasCronAuth) {
    const sb = createSupabaseServer();
    const { data: { user } } = await sb.auth.getUser();
    if (!user) {
      return NextResponse.json({
        error: 'not signed in',
        hint: 'Sign in as admin, or pass x-cron-secret header.',
      }, { status: 401 });
    }
    if ((user.email ?? '').toLowerCase() !== cfg.ADMIN_EMAIL.toLowerCase()) {
      return NextResponse.json({
        error: 'admin only',
        signedInAs: user.email,
        expectedAdmin: cfg.ADMIN_EMAIL,
      }, { status: 403 });
    }
  }

  const env = {
    OPENAI_API_KEY_set: Boolean(cfg.OPENAI_API_KEY),
    OPENAI_API_KEY_prefix: cfg.OPENAI_API_KEY
      ? cfg.OPENAI_API_KEY.slice(0, 8) + '…'
      : null,
    OPENAI_MODEL_JOB_SEARCH: cfg.OPENAI_MODEL_JOB_SEARCH,
    OPENAI_WEB_SEARCH_ENABLED: cfg.OPENAI_WEB_SEARCH_ENABLED,
    OPENAI_WEB_SEARCH_DAILY_CAP: cfg.OPENAI_WEB_SEARCH_DAILY_CAP,
  };

  if (!cfg.OPENAI_API_KEY) {
    return NextResponse.json({
      ok: false,
      env,
      verdict: 'OPENAI_API_KEY is not set in Vercel. Add it and redeploy.',
    });
  }

  const url = new URL(req.url);
  const q = url.searchParams.get('q') || 'product manager';
  const loc = url.searchParams.get('loc') || 'Bangalore';

  // 1. Live provider call — this is what /api/run-now would actually invoke.
  const provider = new OpenAIWebSearchProvider();
  const liveStart = Date.now();
  const live = await provider.searchWithEnvelope({
    query: q,
    locations: [loc],
    workMode: 'any',
    limit: 5,
    postedWithinDays: 14,
  });
  const liveMs = Date.now() - liveStart;

  // 2. Raw HTTP probe — bypasses our provider mapping to catch issues
  //    at the OpenAI layer (auth, model not found, schema rejection).
  //    Small query so we don't burn tokens if the live call above worked.
  const raw = await rawProbe(cfg.OPENAI_API_KEY, cfg.OPENAI_MODEL_JOB_SEARCH, q);

  // 3. Recent audit rows — surface any pattern of failures.
  const admin = supabaseAdmin();
  const { data: recent } = await admin
    .from('openai_websearch_calls')
    .select('id, created_at, user_id, cached, openai_response_id, duration_ms, jobs_returned, cost_estimate_usd, error, criteria_snapshot')
    .order('created_at', { ascending: false })
    .limit(10);

  const recentCalls = (recent ?? []).map((r) => ({
    id: r.id,
    at: r.created_at,
    user_id: r.user_id,
    cached: r.cached,
    duration_ms: r.duration_ms,
    jobs_returned: r.jobs_returned,
    cost_usd: r.cost_estimate_usd,
    error: r.error,
    query: (r.criteria_snapshot as { query?: string })?.query ?? null,
  }));

  return NextResponse.json({
    ok: true,
    env,
    query: { q, loc },
    liveCall: {
      durationMs: liveMs,
      jobsReturned: live.jobs.length,
      sourcesConsulted: live.sources.length,
      openaiResponseId: live.openaiResponseId,
      skipped: live.skipped ?? null,
      error: live.error ?? null,
      preview: live.jobs.slice(0, 3).map((j) => ({
        title: j.title,
        company: j.company,
        location: j.location,
        fit_score: j.preVerifiedFitScore,
        match_level: j.matchLevel,
        url: j.url,
        why_match: (j.matchReasons ?? []).slice(0, 2),
      })),
      // Populated only when jobs.length === 0. Shows the raw
      // output_text OpenAI returned, and — if it parsed — how many
      // jobs came out and why they got dropped in mapping.
      debug: live.debug ?? null,
    },
    rawProbe: raw,
    recentCalls,
    verdict: diagnose(env, live, raw, recentCalls),
  });
}

interface RawProbeResult {
  status: number;
  ok: boolean;
  bodySnippet: string;
  outputText: string | null;
  jobsInOutput: number | null;
}

async function rawProbe(
  apiKey: string,
  model: string,
  q: string,
): Promise<RawProbeResult> {
  try {
    const res = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        tools: [
          { type: 'web_search', search_context_size: 'low' },
        ],
        tool_choice: 'required',
        input: [
          {
            role: 'user',
            content: `Search the web and list 2 currently-open "${q}" jobs. Respond in plain text.`,
          },
        ],
      }),
      cache: 'no-store',
    });
    const text = await res.text();
    let outputText: string | null = null;
    let jobsInOutput: number | null = null;
    try {
      const parsed = JSON.parse(text) as {
        output_text?: string;
        output?: Array<{ type: string; content?: Array<{ text?: string }> }>;
      };
      outputText = parsed.output_text ?? null;
      // Rough "did we get anything" signal — number of lines mentioning http.
      if (outputText) {
        jobsInOutput = (outputText.match(/https?:\/\//g) ?? []).length;
      }
    } catch {
      /* body wasn't JSON — surfaced in bodySnippet */
    }
    return {
      status: res.status,
      ok: res.ok,
      bodySnippet: text.slice(0, 500).replace(/\s+/g, ' '),
      outputText,
      jobsInOutput,
    };
  } catch (err) {
    return {
      status: 0,
      ok: false,
      bodySnippet: `network error: ${(err as Error).message}`,
      outputText: null,
      jobsInOutput: null,
    };
  }
}

function diagnose(
  env: { OPENAI_WEB_SEARCH_ENABLED: boolean; OPENAI_MODEL_JOB_SEARCH: string },
  live: Awaited<ReturnType<OpenAIWebSearchProvider['searchWithEnvelope']>>,
  raw: RawProbeResult,
  recentCalls: Array<{ error: string | null }>,
): string {
  if (!env.OPENAI_WEB_SEARCH_ENABLED) {
    return 'OPENAI_WEB_SEARCH_ENABLED=false in Vercel. Provider is silently disabled. Flip to true (or delete the var) and redeploy.';
  }
  if (raw.status === 401 || raw.status === 403) {
    return `OpenAI returned HTTP ${raw.status} on a bare probe. API key is invalid, revoked, or lacks Responses API + web_search access. Rotate key at https://platform.openai.com/api-keys.`;
  }
  if (raw.status === 404 && raw.bodySnippet.toLowerCase().includes('model')) {
    return `Model "${env.OPENAI_MODEL_JOB_SEARCH}" not found. The handoff doc names gpt-5.6-terra; OpenAI may have renamed or your org may not have access. Try setting OPENAI_MODEL_JOB_SEARCH=gpt-4.1 or gpt-5 in Vercel.`;
  }
  if (raw.status >= 400 && raw.bodySnippet.toLowerCase().includes('web_search')) {
    return `The web_search tool was rejected (HTTP ${raw.status}). Your org may not be enrolled for web-search. Enable at https://platform.openai.com/settings/organization/limits.`;
  }
  if (raw.status >= 400) {
    return `Raw probe failed HTTP ${raw.status}. Body: ${raw.bodySnippet.slice(0, 200)}`;
  }
  if (live.error) {
    return `Structured call errored: ${live.error}. Raw probe was HTTP ${raw.status} (${raw.ok ? 'ok' : 'not ok'}), so the endpoint is reachable — likely a schema or query issue.`;
  }
  if (live.jobs.length === 0 && live.debug) {
    if (live.debug.outputTextRaw === null) {
      return `Live call succeeded (${live.openaiResponseId}) but output_text was empty. The response likely finished via web_search calls without producing a text output — model may be timing out mid-search or the schema is being rejected silently. Check liveCall.debug for the response shape.`;
    }
    if (live.debug.parsedJobsCount === null) {
      return `output_text was present but JSON.parse failed: ${live.debug.firstMapFailure}. The model didn't honor the strict schema. Try shortening the system prompt or lowering search_context_size.`;
    }
    if (live.debug.parsedJobsCount === 0) {
      return `Model returned {jobs: []} — it searched (${live.sources.length} sources) but nothing met minimum_fit_score=65. Lower the threshold in openai-web-search.ts buildCriteria() to 45, or try a more common role query.`;
    }
    if (live.debug.firstMapFailure) {
      return `Model returned ${live.debug.parsedJobsCount} jobs but ALL were dropped in mapping. First failure: ${live.debug.firstMapFailure}. Likely missing title/company/url in the response. Inspect liveCall.debug.outputTextRaw to see the actual returned shape.`;
    }
    return `Model returned ${live.debug.parsedJobsCount} jobs but none survived mapping. Unusual — inspect liveCall.debug.outputTextRaw.`;
  }
  if (live.jobs.length === 0 && raw.jobsInOutput && raw.jobsInOutput > 0) {
    return `Structured schema returned 0 jobs even though the raw probe surfaced ${raw.jobsInOutput} URLs. Likely the minimum_fit_score=65 filter is too strict for this query, OR the model isn't filling the strict JSON schema properly. Try a broader query, or lower minimum_fit_score.`;
  }
  if (live.jobs.length === 0) {
    return 'Both the structured call and the raw probe returned no findable jobs for this query. Try a more common role/location, or check if OpenAI web search is actually reaching the sites you expect.';
  }
  const failCount = recentCalls.filter((r) => r.error).length;
  if (failCount >= 3) {
    return `Live call succeeded (${live.jobs.length} jobs), but ${failCount} of the last 10 calls errored. Check recentCalls[].error for patterns.`;
  }
  return `Healthy — live call returned ${live.jobs.length} jobs in ${env.OPENAI_MODEL_JOB_SEARCH}. If users still don't see the "AI-discovered" chip, they may be looking at /dashboard instead of /all-matches (OpenAI results only appear on /all-matches).`;
}
