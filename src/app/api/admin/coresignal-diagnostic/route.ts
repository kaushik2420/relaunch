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
  const sb = createSupabaseServer();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'not signed in' }, { status: 401 });
  if ((user.email ?? '').toLowerCase() !== serverConfig().ADMIN_EMAIL.toLowerCase()) {
    return NextResponse.json({ error: 'admin only' }, { status: 403 });
  }

  const cfg = serverConfig();
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
