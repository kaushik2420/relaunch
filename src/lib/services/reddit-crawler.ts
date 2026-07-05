/**
 * Reddit distribution-lead crawler.
 *
 * Hits the public .json feeds for a curated subreddit set, filters
 * for posts that hit our laid-off / job-hunting keyword pack, and
 * upserts them into distribution_leads.
 *
 * We're deliberately using anonymous .json endpoints (not OAuth) —
 * with a proper User-Agent + low request cadence (a few hundred/day),
 * Reddit's public feed remains accessible. If they start rate-limiting
 * us, upgrading to a script-type OAuth app is straightforward.
 *
 * Called from the /api/cron/reddit-leads endpoint daily.
 */
import { supabaseAdmin } from '@/lib/supabase/admin';
import { serverConfig } from '@/lib/config';

/**
 * Reddit's docs require this exact User-Agent format:
 *   <platform>:<app_id>:<version> (by /u/<reddit_username>)
 */
const USER_AGENT = 'web:relaunch-distribution:v1.0.0 (by /u/kaushikn2416)';

/**
 * Reddit OAuth (script app, password grant). See docs/REDDIT_OAUTH.md
 * for how to register the app + set the env vars. As of 2023 Reddit
 * has effectively killed anonymous .json access — every request now
 * needs a bearer token.
 *
 * Tokens last ~24h. We cache in-memory per warm serverless instance;
 * a cold start just fetches a fresh one, which costs one HTTP round-
 * trip (~200ms).
 */
let cachedToken: { token: string; expiresAt: number } | null = null;

async function getRedditToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now + 60_000) {
    return cachedToken.token;
  }

  const cfg = serverConfig();
  if (
    !cfg.REDDIT_CLIENT_ID ||
    !cfg.REDDIT_CLIENT_SECRET ||
    !cfg.REDDIT_USERNAME ||
    !cfg.REDDIT_PASSWORD
  ) {
    throw new Error(
      'Reddit OAuth is not configured. Set REDDIT_CLIENT_ID / _SECRET / _USERNAME / _PASSWORD in Vercel env vars. See docs/REDDIT_OAUTH.md.',
    );
  }

  const basic = Buffer.from(
    `${cfg.REDDIT_CLIENT_ID}:${cfg.REDDIT_CLIENT_SECRET}`,
  ).toString('base64');
  const body = new URLSearchParams({
    grant_type: 'password',
    username: cfg.REDDIT_USERNAME,
    password: cfg.REDDIT_PASSWORD,
  });

  const res = await fetch('https://www.reddit.com/api/v1/access_token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': USER_AGENT,
    },
    body: body.toString(),
    cache: 'no-store',
  });

  if (!res.ok) {
    const snippet = (await res.text()).slice(0, 240).replace(/\s+/g, ' ');
    throw new Error(`token exchange failed · HTTP ${res.status} · ${snippet}`);
  }

  const json = (await res.json()) as {
    access_token?: string;
    expires_in?: number;
    error?: string;
  };
  if (!json.access_token) {
    throw new Error(`token exchange gave no access_token · ${JSON.stringify(json)}`);
  }
  const expiresInMs = (json.expires_in ?? 3600) * 1000;
  cachedToken = { token: json.access_token, expiresAt: now + expiresInMs };
  return cachedToken.token;
}

/** Exposed for the diagnostic endpoint. Returns the raw token — the
 *  caller is responsible for masking before echoing back to the UI. */
export async function debugGetToken(): Promise<{
  token: string;
  masked: string;
  cachedForMs: number;
}> {
  const token = await getRedditToken();
  return {
    token,
    masked: token.slice(0, 6) + '…' + token.slice(-4),
    cachedForMs: cachedToken ? cachedToken.expiresAt - Date.now() : 0,
  };
}

/**
 * Subreddits we scan. Ordered by signal quality — r/layoffs is the
 * clearest cohort (people actively venting about being let go);
 * r/developersIndia + r/cscareerquestions cover the India / tech
 * career-search conversation; r/ExperiencedDevs skews senior IC.
 */
const SUBREDDITS = [
  'layoffs',
  'developersIndia',
  'cscareerquestions',
  'ExperiencedDevs',
  'IndianStreetBets', // occasional layoff / severance discussions in FI/RE thread
  'india',            // broad — filtered hard by keyword pack
];

/**
 * Keyword pack — matched case-insensitively against title + body.
 * A single hit qualifies; we store the specific keywords that matched
 * so the admin UI can show *why* the post was surfaced.
 *
 * Multi-word entries use word boundaries in the matcher to avoid
 * accidental matches (`laid off` should not fire on `laid-back office`).
 */
const KEYWORDS = [
  'laid off',
  'been let go',
  'lost my job',
  'severance',
  'open to work',
  '#opentowork',
  'looking for a role',
  'looking for a new role',
  'looking for a job',
  'looking for work',
  'job search',
  'job hunt',
  'job hunting',
  'unemployed',
  'between jobs',
  'need a job',
  'need work',
  'newly unemployed',
  'layoff impacted',
  'affected by layoffs',
  'was part of the layoff',
];

/**
 * Reddit post as returned by /r/{sub}/new.json under data.children[].data.
 * We only care about the fields we actually persist.
 */
interface RedditPost {
  id: string;
  name: string;             // t3_<id>
  title: string;
  selftext: string;
  author: string;
  permalink: string;
  url: string;
  created_utc: number;      // unix seconds
  score: number;
  num_comments: number;
  subreddit: string;
  subreddit_name_prefixed: string;
  over_18: boolean;
  removed_by_category: string | null;
  is_self: boolean;
  stickied: boolean;
}

interface CrawlSummary {
  scanned: number;
  matched: number;
  inserted: number;
  perSubreddit: Record<string, { scanned: number; matched: number; inserted: number }>;
  errors: string[];
}

/**
 * Do a single crawl pass across all subreddits and return a summary.
 * Idempotent — re-running the same day just no-ops on existing leads.
 */
export async function crawlRedditLeads(): Promise<CrawlSummary> {
  const summary: CrawlSummary = {
    scanned: 0,
    matched: 0,
    inserted: 0,
    perSubreddit: {},
    errors: [],
  };

  for (const sub of SUBREDDITS) {
    summary.perSubreddit[sub] = { scanned: 0, matched: 0, inserted: 0 };
    try {
      const posts = await fetchNewPosts(sub, 100);
      summary.perSubreddit[sub].scanned = posts.length;
      summary.scanned += posts.length;

      for (const p of posts) {
        if (p.stickied || p.removed_by_category) continue;

        const matches = matchKeywords(p.title, p.selftext);
        if (matches.length === 0) continue;

        summary.matched += 1;
        summary.perSubreddit[sub].matched += 1;

        const inserted = await upsertLead(p, matches);
        if (inserted) {
          summary.inserted += 1;
          summary.perSubreddit[sub].inserted += 1;
        }
      }
    } catch (err) {
      const msg = `${sub}: ${(err as Error).message}`;
      console.error('[reddit-crawler]', msg);
      summary.errors.push(msg);
    }

    // Gentle pacing between subreddits — Reddit rate-limits per-second,
    // and we're not in a hurry.
    await sleep(1500);
  }

  return summary;
}

/**
 * Fetch newest posts from a subreddit. Uses OAuth when configured,
 * falls back to public RSS otherwise. Both paths produce the same
 * RedditPost[] shape so downstream matching + persistence code
 * doesn't care which one was used.
 *
 * Signals we lose in the RSS path:
 *  - `score` (upvotes) — RSS envelope doesn't include it. We default
 *    to 0, which means engagement will look flat in the lead score;
 *    recency + keyword hits still drive ranking.
 *  - `num_comments` — same story.
 *  - `stickied` / `removed_by_category` — RSS omits these too, but
 *    they're rare on /new anyway.
 */
async function fetchNewPosts(subreddit: string, limit: number): Promise<RedditPost[]> {
  const cfg = serverConfig();
  const oauthConfigured = !!(
    cfg.REDDIT_CLIENT_ID &&
    cfg.REDDIT_CLIENT_SECRET &&
    cfg.REDDIT_USERNAME &&
    cfg.REDDIT_PASSWORD
  );

  if (oauthConfigured) {
    return fetchViaOAuth(subreddit, limit);
  }
  return fetchViaRss(subreddit, limit);
}

/** OAuth path — full-fidelity JSON with score + comment count. */
async function fetchViaOAuth(subreddit: string, limit: number): Promise<RedditPost[]> {
  const token = await getRedditToken();
  const url = `https://oauth.reddit.com/r/${subreddit}/new?limit=${limit}&raw_json=1`;

  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        'User-Agent': USER_AGENT,
        Accept: 'application/json',
      },
      cache: 'no-store',
    });
  } catch (err) {
    throw new Error(`network error: ${(err as Error).message}`);
  }

  if (res.status === 401) {
    cachedToken = null;
    const snippet = (await res.text()).slice(0, 240).replace(/\s+/g, ' ');
    throw new Error(`401 unauthorized · token rejected · ${snippet}`);
  }

  if (!res.ok) {
    let bodySnippet = '';
    try {
      bodySnippet = (await res.text()).slice(0, 240).replace(/\s+/g, ' ');
    } catch {
      // ignore
    }
    throw new Error(`HTTP ${res.status} · ${bodySnippet || '(empty body)'}`);
  }

  let json: { data?: { children?: { data: RedditPost }[] } };
  try {
    json = (await res.json()) as typeof json;
  } catch (err) {
    throw new Error(`invalid JSON: ${(err as Error).message}`);
  }
  const children = json?.data?.children ?? [];
  return children.map((c) => c.data);
}

/**
 * RSS fallback — hits /r/{sub}/.rss anonymously. Reddit still serves
 * this without gating because RSS predates their app-platform push.
 * Parsed with a lightweight regex extractor (no XML parser dep —
 * Reddit's RSS format is stable enough for this).
 */
async function fetchViaRss(subreddit: string, limit: number): Promise<RedditPost[]> {
  const url = `https://www.reddit.com/r/${subreddit}/new/.rss?limit=${limit}`;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/atom+xml, application/xml, text/xml',
      },
      cache: 'no-store',
    });
  } catch (err) {
    throw new Error(`RSS network error: ${(err as Error).message}`);
  }

  if (!res.ok) {
    const snippet = (await res.text()).slice(0, 240).replace(/\s+/g, ' ');
    throw new Error(`RSS HTTP ${res.status} · ${snippet || '(empty body)'}`);
  }

  const xml = await res.text();
  return parseRedditRss(xml, subreddit);
}

/**
 * Parse Reddit's Atom-flavoured RSS feed into RedditPost[]. Reddit's
 * feed uses <entry> nodes with these fields we care about:
 *   <id>t3_abc123</id>
 *   <title>Just got laid off from...</title>
 *   <content type="html">...HTML-escaped body...</content>
 *   <author><name>/u/username</name></author>
 *   <updated>2026-07-05T12:34:56+00:00</updated>
 *   <link href="https://www.reddit.com/r/layoffs/comments/abc123/..."/>
 *
 * We avoid pulling in an XML parser dep — regex extraction is fine
 * for a stable format and keeps the bundle lean.
 */
function parseRedditRss(xml: string, subreddit: string): RedditPost[] {
  const entries: RedditPost[] = [];
  const entryPattern = /<entry>([\s\S]*?)<\/entry>/g;
  let match: RegExpExecArray | null;

  while ((match = entryPattern.exec(xml)) !== null) {
    const entry = match[1];
    if (!entry) continue;
    const idFull = pickTag(entry, 'id') || '';           // e.g. "t3_abc123"
    const id = idFull.replace(/^t3_/, '');
    if (!id) continue;

    const title = decodeXml(pickTag(entry, 'title') || '').trim();
    const author = pickTag(entry, 'name')?.replace(/^\/u\//, '') || '';
    const updated = pickTag(entry, 'updated') || '';
    const link = pickAttr(entry, 'link', 'href') || '';

    // <content type="html">…</content> is HTML-escaped. Strip tags +
    // decode entities so keyword matching sees plain text.
    const contentHtml = pickTag(entry, 'content') || '';
    const body = decodeXml(contentHtml)
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const createdSec = Math.floor(new Date(updated).getTime() / 1000);
    if (!Number.isFinite(createdSec) || createdSec <= 0) continue;

    entries.push({
      id,
      name: `t3_${id}`,
      title,
      selftext: body,
      author,
      permalink: link.replace(/^https?:\/\/[^/]+/, ''),
      url: link,
      created_utc: createdSec,
      score: 0,                    // RSS doesn't expose it
      num_comments: 0,             // ditto
      subreddit,
      subreddit_name_prefixed: `r/${subreddit}`,
      over_18: false,
      removed_by_category: null,
      is_self: true,
      stickied: false,
    });
  }
  return entries;
}

function pickTag(source: string, tag: string): string | null {
  // Non-greedy; handles both <tag>x</tag> and <tag type="…">x</tag>
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`);
  const m = source.match(re);
  return m ? m[1] ?? null : null;
}

function pickAttr(source: string, tag: string, attr: string): string | null {
  const re = new RegExp(`<${tag}[^>]*\\s${attr}="([^"]*)"`);
  const m = source.match(re);
  return m ? m[1] ?? null : null;
}

function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/**
 * Case-insensitive keyword matcher. Multi-word entries are matched
 * with word-boundary regex so `laid off` won't match `laid offer`.
 * Returns the list of specific keywords that hit so the admin UI can
 * show why the post surfaced.
 */
function matchKeywords(title: string, body: string): string[] {
  const haystack = `${title}\n${body}`.toLowerCase();
  const hits: string[] = [];
  for (const kw of KEYWORDS) {
    const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Word boundary at start; end can be non-word (post-modifiers ok).
    const re = new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i');
    if (re.test(haystack)) hits.push(kw);
  }
  return hits;
}

/**
 * Upsert one lead. Returns true if a new row was inserted; false if
 * the source_id already existed (idempotent re-run).
 */
async function upsertLead(post: RedditPost, matched: string[]): Promise<boolean> {
  const admin = supabaseAdmin();
  const permalinkUrl = `https://www.reddit.com${post.permalink}`;
  const postedAt = new Date(post.created_utc * 1000);
  const leadScore = scoreLead(post, matched);

  // Body is capped — we don't need the whole novel, and Postgres text
  // is fine but the admin table will show a snippet anyway.
  const body = (post.selftext ?? '').slice(0, 4000);

  const { data, error } = await admin
    .from('distribution_leads')
    .upsert(
      {
        source: 'reddit',
        source_id: post.name, // t3_<id> — globally unique
        community: `r/${post.subreddit}`,
        author: post.author,
        title: post.title.slice(0, 500),
        body,
        url: permalinkUrl,
        posted_at: postedAt.toISOString(),
        score: post.score,
        num_comments: post.num_comments,
        matched_keywords: matched,
        lead_score: leadScore,
      },
      { onConflict: 'source,source_id', ignoreDuplicates: true },
    )
    .select('id');

  if (error) {
    console.warn('[reddit-crawler] upsert failed', post.name, error.message);
    return false;
  }
  return (data?.length ?? 0) > 0;
}

/**
 * Composite lead score — higher = surface higher on the admin page.
 *
 * We reward recency (fresh posts are actionable — people still
 * engaged in the thread), engagement (upvotes + comments = it's not
 * buried), and richer keyword matches (multi-hit posts are less
 * likely to be false positives).
 */
function scoreLead(post: RedditPost, matched: string[]): number {
  const ageHours = (Date.now() - post.created_utc * 1000) / 3600_000;
  const recency = Math.max(0, 48 - ageHours) / 48; // 1.0 at t=0, 0 after 48h
  const engagement = Math.log1p(Math.max(0, post.score)) + Math.log1p(post.num_comments);
  const kwBoost = Math.min(3, matched.length);
  return recency * 3 + engagement + kwBoost;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
