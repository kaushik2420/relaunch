import { NextResponse, type NextRequest } from 'next/server';
import { createSupabaseServer } from '@/lib/supabase/server';
import { serverConfig } from '@/lib/config';
import { CoresignalProvider } from '@/lib/providers/jobs/coresignal';

export const runtime = 'nodejs';
export const maxDuration = 30;

/**
 * Coresignal trial diagnostic. Admin-only.
 *
 * Hits the search + collect pipeline live and returns:
 *   - whether the API key is set
 *   - what query we sent (from the ?q / ?loc params)
 *   - how many results came back
 *   - a preview of the first 3 mapped JobPosting objects
 *   - approximate credit consumption
 *
 * Usage:
 *   GET /api/admin/coresignal-diagnostic?q=product+manager&loc=Bangalore
 *
 * Defaults: q="senior software engineer", loc="Bangalore". These are
 * chosen because they hit high-volume India tech job clusters, so
 * even a barely-working setup should return >0 results.
 */
export async function GET(req: NextRequest) {
  const cfg = serverConfig();

  // Two auth paths:
  //  1. Browser session with the ADMIN_EMAIL user (default).
  //  2. Header `x-cron-secret: <CRON_SECRET>` — lets you hit this
  //     from curl/Postman when the browser session isn't cooperating.
  const cronSecret = req.headers.get('x-cron-secret') ?? '';
  const bearer = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  const hasCronAuth =
    (cronSecret && cronSecret === cfg.CRON_SECRET) ||
    (bearer && bearer === cfg.CRON_SECRET);

  if (!hasCronAuth) {
    const sb = createSupabaseServer();
    const {
      data: { user },
    } = await sb.auth.getUser();
    if (!user) {
      return NextResponse.json({
        error: 'not signed in',
        hint: 'Sign into Relaunch first, or pass `x-cron-secret: <CRON_SECRET>` header.',
      }, { status: 401 });
    }
    if ((user.email ?? '').toLowerCase() !== cfg.ADMIN_EMAIL.toLowerCase()) {
      return NextResponse.json({
        error: 'admin only',
        hint: `Signed in as "${user.email}", but ADMIN_EMAIL is "${cfg.ADMIN_EMAIL}". Sign in with the admin email, update ADMIN_EMAIL in Vercel, or use x-cron-secret header.`,
        signedInAs: user.email,
        expectedAdmin: cfg.ADMIN_EMAIL,
      }, { status: 403 });
    }
  }

  if (!cfg.CORESIGNAL_API_KEY) {
    return NextResponse.json({
      ok: false,
      stage: 'not-configured',
      hint: 'Set CORESIGNAL_API_KEY in Vercel env vars. See docs/SETUP_CORESIGNAL.md.',
    });
  }

  const url = new URL(req.url);
  const q = url.searchParams.get('q') || 'senior software engineer';
  const loc = url.searchParams.get('loc') || 'Bangalore';

  const provider = new CoresignalProvider();
  const start = Date.now();
  const jobs = await provider.search({
    query: q,
    locations: [loc],
    limit: 20,
    postedWithinDays: 14,
  });
  const ms = Date.now() - start;

  // If the primary query returned 0 hits, fire two probes to isolate
  // the root cause without wasting a token bothering the user again:
  //   probeMatchAll   → returns literally 1 job with no filters.
  //                     If THIS is 0, the trial plan has no data.
  //   probeTitleOnly  → returns matches on title only (no country,
  //                     no functions, no description). If matchAll
  //                     works but this is 0, the multi_match syntax
  //                     is the issue.
  let probeMatchAll: ProbeResult | null = null;
  let probeTitleOnly: ProbeResult | null = null;
  if (jobs.length === 0) {
    // Coresignal's schema rejects any body field other than `query`
    // (size / sort / from all return HTTP 422). Both probes here send
    // only { query: ... } and rely on the default page size.
    probeMatchAll = await rawProbe(cfg.CORESIGNAL_API_KEY, {
      query: { match_all: {} },
    });
    probeTitleOnly = await rawProbe(cfg.CORESIGNAL_API_KEY, {
      query: { match: { title: q } },
    });
  }

  return NextResponse.json({
    ok: true,
    stage: jobs.length > 0 ? 'success' : 'empty',
    query: { q, loc, postedWithinDays: 14, limit: 20 },
    ms,
    resultCount: jobs.length,
    approxCreditsUsed:
      jobs.length > 0
        ? `~${1 + Math.min(jobs.length, 20)}`
        : `~${1 + (probeMatchAll ? 1 : 0) + (probeTitleOnly ? 1 : 0)}`,
    preview: jobs.slice(0, 3).map((j) => ({
      title: j.title,
      company: j.company,
      location: j.location,
      workMode: j.workMode,
      postedAt: j.postedAt,
      url: j.url,
      salary: j.salary,
      keywords: (j.keywords ?? []).slice(0, 8),
      snippet: (j.description ?? '').slice(0, 240),
    })),
    probes: jobs.length === 0
      ? {
          matchAll: probeMatchAll,
          titleOnly: probeTitleOnly,
          verdict: diagnoseProbes(probeMatchAll, probeTitleOnly),
        }
      : undefined,
    hint:
      jobs.length > 0
        ? `Got ${jobs.length} matches in ${ms}ms. If the preview looks good, add 'coresignal' to your JOB_PROVIDERS env var to enable it in the daily run.`
        : 'Zero hits — see probes.verdict below for the specific cause.',
  });
}

interface ProbeResult {
  status: number;
  hits: number;
  firstTitle: string | null;
  bodySnippet: string;
}

/** Fire a raw ES DSL request bypassing our provider's mapping so
 *  we can see exactly what Coresignal returned. Used only when the
 *  primary query returned 0 hits. */
async function rawProbe(apiKey: string, dsl: unknown): Promise<ProbeResult> {
  const res = await fetch(
    'https://api.coresignal.com/cdapi/v2/job_multi_source/search/es_dsl',
    {
      method: 'POST',
      headers: {
        apikey: apiKey,
        'Content-Type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify(dsl),
      cache: 'no-store',
    },
  );
  const text = await res.text();
  let hits = 0;
  let firstTitle: string | null = null;
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) {
      hits = parsed.length;
    } else if (parsed?.hits?.hits) {
      hits = parsed.hits.hits.length;
      firstTitle = parsed.hits.hits[0]?._source?.title ?? null;
    }
  } catch {
    /* HTML error page — bodySnippet will show it */
  }
  return {
    status: res.status,
    hits,
    firstTitle,
    bodySnippet: text.slice(0, 400).replace(/\s+/g, ' '),
  };
}

function diagnoseProbes(
  matchAll: ProbeResult | null,
  titleOnly: ProbeResult | null,
): string {
  if (!matchAll) return 'no probe run';
  if (matchAll.status !== 200) {
    return `Multi-source Jobs endpoint returned HTTP ${matchAll.status} on a bare match_all — trial plan likely doesn't include this dataset. Check dashboard.coresignal.com plan details or ask their support to enable Multi-source Jobs on the trial key.`;
  }
  if (matchAll.hits === 0) {
    return "match_all returned 0 hits at status 200. The endpoint is reachable but the dataset is empty for your key. Almost certainly a plan-scope issue — the trial doesn't include Multi-source Jobs data. Contact Coresignal support.";
  }
  if (titleOnly && titleOnly.hits > 0) {
    return `Data is present (match_all found jobs; title-only match on "${titleOnly.firstTitle ?? '???'}" also worked). Our production query is too strict — the multi_match fields boost syntax (title^3) or the country filter is likely the problem. Loosen the ES DSL in src/lib/providers/jobs/coresignal.ts buildDsl(). Consider using a simple { match: { title: q } } as MUST.`;
  }
  return `match_all works (${matchAll.hits} hits, first: "${matchAll.firstTitle ?? '???'}"), but title match returned 0. Coresignal's title field may need exact-phrase matching or a different query type. Try match_phrase in the provider.`;
}
