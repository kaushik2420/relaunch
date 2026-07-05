import { NextResponse } from 'next/server';
import { createSupabaseServer } from '@/lib/supabase/server';
import { serverConfig } from '@/lib/config';

export const runtime = 'nodejs';

const USER_AGENT = 'web:relaunch-distribution:v1.0.0 (by /u/kaushikn2416)';

/**
 * Raw peek at what Reddit is returning to our Vercel functions.
 * Hit /api/admin/reddit-diagnostic to see the exact status code,
 * headers, and body snippet — makes silent 403s obvious.
 *
 * Admin-only. Returns JSON so you can inspect it directly in the
 * browser tab or from the terminal via curl.
 */
export async function GET() {
  const sb = createSupabaseServer();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
  }
  if ((user.email ?? '').toLowerCase() !== serverConfig().ADMIN_EMAIL.toLowerCase()) {
    return NextResponse.json({ error: 'Admin only.' }, { status: 403 });
  }

  const url = 'https://www.reddit.com/r/layoffs/new.json?limit=3&raw_json=1';
  let res: Response;
  const startedAt = Date.now();
  try {
    res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      cache: 'no-store',
    });
  } catch (err) {
    return NextResponse.json({
      ok: false,
      stage: 'network',
      error: (err as Error).message,
      ms: Date.now() - startedAt,
      hint:
        "Vercel couldn't reach reddit.com at all. Rare — usually means an outage or a DNS-layer block.",
    });
  }

  const ms = Date.now() - startedAt;
  const bodyText = await res.text();
  let parsedFirstTitle: string | null = null;
  let childrenCount = 0;
  try {
    const json = JSON.parse(bodyText) as {
      data?: { children?: { data: { title?: string } }[] };
    };
    childrenCount = json?.data?.children?.length ?? 0;
    parsedFirstTitle = json?.data?.children?.[0]?.data?.title ?? null;
  } catch {
    // non-JSON body — probably an HTML rate-limit page
  }

  return NextResponse.json({
    ok: res.ok,
    stage: res.ok ? 'success' : 'rejected',
    status: res.status,
    statusText: res.statusText,
    ms,
    userAgent: USER_AGENT,
    childrenCount,
    firstTitle: parsedFirstTitle,
    bodySnippet: bodyText.slice(0, 500).replace(/\s+/g, ' '),
    hint:
      res.status === 403
        ? "Reddit is blocking our anonymous request. Fix: switch to a script-app OAuth token (register at reddit.com/prefs/apps, then set REDDIT_CLIENT_ID / REDDIT_CLIENT_SECRET env vars)."
        : res.status === 429
          ? 'Rate limited. Wait a few minutes and retry, or switch to OAuth for the 600/10min rate limit.'
          : res.status === 200
            ? 'Reddit responded OK. If leads still show zero, the keyword pack isn\'t matching — check body of first post below.'
            : null,
  });
}
