import { NextResponse } from 'next/server';
import { createSupabaseServer } from '@/lib/supabase/server';
import { serverConfig } from '@/lib/config';
import { debugGetToken } from '@/lib/services/reddit-crawler';

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

  const cfg = serverConfig();
  const oauthConfigured = !!(
    cfg.REDDIT_CLIENT_ID &&
    cfg.REDDIT_CLIENT_SECRET &&
    cfg.REDDIT_USERNAME &&
    cfg.REDDIT_PASSWORD
  );

  if (!oauthConfigured) {
    // Test the RSS fallback path directly so we know it's alive.
    const rssUrl = 'https://www.reddit.com/r/layoffs/new/.rss?limit=3';
    const startedAt = Date.now();
    let rssRes: Response;
    try {
      rssRes = await fetch(rssUrl, {
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'application/atom+xml, application/xml, text/xml',
        },
        cache: 'no-store',
      });
    } catch (err) {
      return NextResponse.json({
        ok: false,
        stage: 'rss-network',
        error: (err as Error).message,
        ms: Date.now() - startedAt,
        hint:
          'RSS fallback network error. The crawler runs in RSS mode when OAuth env vars are missing.',
      });
    }
    const rssBody = await rssRes.text();
    const entryCount = (rssBody.match(/<entry>/g) ?? []).length;
    const titleMatch = rssBody.match(/<entry>[\s\S]*?<title>([\s\S]*?)<\/title>/);
    return NextResponse.json({
      ok: rssRes.ok && entryCount > 0,
      stage: 'rss-fallback',
      mode: 'RSS (OAuth not configured)',
      status: rssRes.status,
      ms: Date.now() - startedAt,
      userAgent: USER_AGENT,
      entryCount,
      firstTitle: titleMatch ? titleMatch[1]?.slice(0, 160) : null,
      bodySnippet: rssBody.slice(0, 500).replace(/\s+/g, ' '),
      hint:
        rssRes.ok && entryCount > 0
          ? "RSS fallback is working. The crawler will use this path. Upgrade to OAuth later for engagement metrics (upvotes/comments) via docs/REDDIT_OAUTH.md."
          : 'RSS came back empty or errored. Rare — the URL usually works anonymously. Check the status + body snippet.',
      oauthConfigured: {
        REDDIT_CLIENT_ID: !!cfg.REDDIT_CLIENT_ID,
        REDDIT_CLIENT_SECRET: !!cfg.REDDIT_CLIENT_SECRET,
        REDDIT_USERNAME: !!cfg.REDDIT_USERNAME,
        REDDIT_PASSWORD: !!cfg.REDDIT_PASSWORD,
      },
    });
  }

  // Step 1: token exchange
  let tokenInfo: Awaited<ReturnType<typeof debugGetToken>>;
  try {
    tokenInfo = await debugGetToken();
  } catch (err) {
    return NextResponse.json({
      ok: false,
      stage: 'token-exchange',
      error: (err as Error).message,
      hint:
        "Token exchange failed. Common causes: wrong client_id/secret, script app not owned by REDDIT_USERNAME, 2FA on the reddit account (unsupported by password grant), or the app was deleted. Double-check reddit.com/prefs/apps.",
    });
  }

  // Step 2: hit a real subreddit with the token
  const url = 'https://oauth.reddit.com/r/layoffs/new?limit=3&raw_json=1';
  let res: Response;
  const startedAt = Date.now();
  try {
    res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${tokenInfo.token}`,
        'User-Agent': USER_AGENT,
        Accept: 'application/json',
      },
      cache: 'no-store',
    });
  } catch (err) {
    return NextResponse.json({
      ok: false,
      stage: 'network',
      error: (err as Error).message,
      ms: Date.now() - startedAt,
      tokenPreview: tokenInfo.masked,
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
    tokenPreview: tokenInfo.masked,
    tokenCachedForMs: tokenInfo.cachedForMs,
    childrenCount,
    firstTitle: parsedFirstTitle,
    bodySnippet: bodyText.slice(0, 500).replace(/\s+/g, ' '),
    hint:
      res.status === 401
        ? 'Token was accepted at exchange but rejected at fetch. Reddit sometimes rate-limits new script apps for the first few hours — try again in ~30 min. If it persists, regenerate the app secret at reddit.com/prefs/apps.'
        : res.status === 403
          ? 'OAuth token exchanged but subreddit access denied. Rare — likely the subreddit is private or your account is banned there.'
          : res.status === 429
            ? 'Rate limited. Reddit gives OAuth apps 600 req/10min — wait a minute.'
            : res.status === 200
              ? 'Reddit responded OK. If leads still show zero, the keyword pack isn\'t matching — check firstTitle + bodySnippet.'
              : null,
  });
}
