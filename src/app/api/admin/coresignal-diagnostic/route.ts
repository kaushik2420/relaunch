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

  return NextResponse.json({
    ok: true,
    stage: jobs.length > 0 ? 'success' : 'empty',
    query: { q, loc, postedWithinDays: 14, limit: 20 },
    ms,
    resultCount: jobs.length,
    // Approx credit cost: 1 search + up to 20 collects if search
    // returned only IDs. If search returned _source docs, just 1.
    approxCreditsUsed: jobs.length > 0 ? `~${1 + Math.min(jobs.length, 20)}` : '~1',
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
    hint:
      jobs.length === 0
        ? "No hits. Try a broader query (?q=engineer) or check if the trial plan includes India coverage. Coresignal's search is strict on title matching."
        : `Got ${jobs.length} matches in ${ms}ms. If the preview looks good, add 'coresignal' to your JOB_PROVIDERS env var to enable it in the daily run.`,
  });
}
