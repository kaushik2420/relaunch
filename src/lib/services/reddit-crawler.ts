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

const USER_AGENT = 'Relaunch/1.0 distribution-lead crawler by kaushikn2416';

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

async function fetchNewPosts(subreddit: string, limit: number): Promise<RedditPost[]> {
  const url = `https://www.reddit.com/r/${subreddit}/new.json?limit=${limit}&raw_json=1`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'application/json',
    },
    // No cache — we want the freshest posts every crawl.
    cache: 'no-store',
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} from Reddit`);
  }
  const json = (await res.json()) as {
    data?: { children?: { data: RedditPost }[] };
  };
  const children = json?.data?.children ?? [];
  return children.map((c) => c.data);
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
