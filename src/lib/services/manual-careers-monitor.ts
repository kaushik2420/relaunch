import { supabaseAdmin } from '@/lib/supabase/admin';
import { classifyAtsUrl } from '@/lib/ats-url';

/**
 * Phase 2 of the watchlist feature: actively diff manual-tracked
 * careers pages each daily run.
 *
 * For each watched company with detection_status='manual' and a
 * careers_url, we:
 *   1. GET the page (no JS rendering — fast, polite, plain HTTP)
 *   2. Extract every <a href> matching common "job-like" URL patterns
 *   3. Diff against last_seen_urls
 *   4. Upsert any new URLs into job_matches as summary-only entries
 *      (company = watched name; title derived from the URL slug)
 *   5. Update last_seen_urls + last_checked_at
 *
 * First-fetch is special: we don't want to dump dozens of historic
 * postings into the user's dashboard on Day 1. We cap inserts at 10
 * and write the FULL link set to last_seen so subsequent diffs are
 * tiny and signal-rich.
 */

const FIRST_FETCH_CAP = 10;
const SUBSEQUENT_CAP = 30;

interface ManualWatchedRow {
  id: string;
  name: string;
  careers_url: string;
  last_seen_urls: string[] | null;
  last_checked_at: string | null;
}

export async function monitorManualWatched(userId: string): Promise<{
  companiesChecked: number;
  newJobsFound: number;
}> {
  const admin = supabaseAdmin();
  const { data: rows } = await admin
    .from('watched_companies')
    .select('id, name, careers_url, last_seen_urls, last_checked_at')
    .eq('user_id', userId)
    .eq('detection_status', 'manual')
    .not('careers_url', 'is', null);

  const manual = (rows ?? []) as ManualWatchedRow[];
  if (manual.length === 0) {
    return { companiesChecked: 0, newJobsFound: 0 };
  }

  let newJobsFound = 0;

  await Promise.all(
    manual.map(async (w) => {
      try {
        const newCount = await checkOne(userId, w);
        newJobsFound += newCount;
      } catch (err) {
        console.error(
          `[manual-monitor] check failed for ${w.name} (${w.careers_url})`,
          err,
        );
      }
    }),
  );

  console.log(
    `[manual-monitor] checked ${manual.length} companies, found ${newJobsFound} new postings`,
  );
  return { companiesChecked: manual.length, newJobsFound };
}

async function checkOne(
  userId: string,
  w: ManualWatchedRow,
): Promise<number> {
  // Fetch the careers page (HTTP only — modern SPAs that need JS to
  // render listings will yield few links; we'll log a warning).
  let html: string;
  try {
    const res = await fetch(w.careers_url, {
      signal: AbortSignal.timeout(10000),
      headers: {
        // Pretend to be a normal browser so servers don't 403 us
        'User-Agent':
          'Mozilla/5.0 (compatible; RelaunchBot/1.0; +https://www.get-relaunch.com)',
      },
      next: { revalidate: 1800 }, // 30-min cache at the edge
    });
    if (!res.ok) {
      console.warn(`[manual-monitor] ${w.name} returned ${res.status}`);
      return 0;
    }
    html = await res.text();
  } catch (err) {
    console.warn(`[manual-monitor] fetch failed for ${w.name}`, err);
    return 0;
  }

  const links = extractJobLinks(html, w.careers_url);
  if (links.length === 0) {
    console.warn(
      `[manual-monitor] ${w.name}: 0 job-like links found — page may be JS-rendered`,
    );
  }

  const admin = supabaseAdmin();
  const isFirstCheck = w.last_checked_at == null;
  const lastSeen = new Set<string>(w.last_seen_urls ?? []);
  const newUrls = links.filter((u) => !lastSeen.has(u));

  const toInsert = newUrls.slice(0, isFirstCheck ? FIRST_FETCH_CAP : SUBSEQUENT_CAP);

  if (toInsert.length > 0) {
    const rows = toInsert.map((url) => {
      const cls = classifyAtsUrl(url);
      return {
        user_id: userId,
        apply_url: cls.canonical,
        ats: cls.ats,
        ats_id: cls.atsId,
        job_title: titleFromUrl(url) || '(View on careers page)',
        company: w.name,
        match_percent: null,
        verify_score: null,
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
    const { error } = await admin
      .from('job_matches')
      .upsert(rows, { onConflict: 'user_id,apply_url' });
    if (error) {
      console.error(`[manual-monitor] upsert failed for ${w.name}`, error);
    } else {
      console.log(
        `[manual-monitor] ${w.name}: ${toInsert.length} new postings persisted${
          isFirstCheck ? ' (first check — capped)' : ''
        }`,
      );
    }
  }

  // Always update the baseline + timestamp, even when nothing
  // changed — so the next diff sees the right "last_seen" set and
  // we record when we tried.
  await admin
    .from('watched_companies')
    .update({
      last_seen_urls: links,
      last_checked_at: new Date().toISOString(),
    })
    .eq('id', w.id);

  return toInsert.length;
}

// ====================================================================
// Link extraction — pure-JS, no external HTML parser. Plenty good for
// the "extract <a href>" job; we don't need DOM semantics.
// ====================================================================

const SKIP_NON_JOB_PATTERN =
  /(privacy|terms|cookie|legal|contact|about|press|blog|news|investor|partner|customer|product|pricing|gdpr|sitemap|login|signup|register|^\/$)/i;

const SKIP_EXTENSION_PATTERN =
  /\.(css|js|mjs|png|jpe?g|gif|svg|webp|ico|woff2?|ttf|pdf|mp4|webm)(\?|#|$)/i;

const JOB_LIKE_PATH_PATTERN =
  /\/(jobs?|careers?|roles?|positions?|openings?|vacancies|apply|posting|postings|opportunit(?:y|ies)|hire|hiring|join-us|work-with-us)\//i;

const NUMERIC_JOB_ID_PATTERN = /\/(p|r|j)?\d{4,}(?:[/?#]|$)/i;

export function extractJobLinks(html: string, baseUrl: string): string[] {
  let baseHost: string;
  try {
    baseHost = new URL(baseUrl).hostname;
  } catch {
    return [];
  }

  const hrefRegex = /href\s*=\s*["']([^"']+)["']/gi;
  const out = new Set<string>();

  let match: RegExpExecArray | null;
  while ((match = hrefRegex.exec(html)) !== null) {
    const raw = match[1];
    if (!raw) continue;
    if (/^(mailto:|tel:|javascript:|#)/i.test(raw)) continue;
    if (SKIP_EXTENSION_PATTERN.test(raw)) continue;

    let abs: URL;
    try {
      abs = new URL(raw, baseUrl);
    } catch {
      continue;
    }

    // Same-host only (subdomain ok). Cross-domain links on a careers
    // page usually go to social/marketing, not roles.
    if (
      abs.hostname !== baseHost &&
      !abs.hostname.endsWith(`.${baseHost}`) &&
      !baseHost.endsWith(`.${abs.hostname}`)
    ) {
      continue;
    }

    const path = abs.pathname || '/';

    // Must look job-like — either path-pattern OR numeric-id pattern.
    const looksJobLike =
      JOB_LIKE_PATH_PATTERN.test(path) || NUMERIC_JOB_ID_PATTERN.test(path);
    if (!looksJobLike) continue;

    // Skip obvious non-job paths that share the keyword (/blog/careers-tips etc).
    if (SKIP_NON_JOB_PATTERN.test(path)) continue;

    // Skip the careers-index page itself (the URL we're fetching).
    if (path === new URL(baseUrl).pathname) continue;

    // Strip fragment + normalize trailing slash.
    abs.hash = '';
    out.add(abs.toString().replace(/\/+$/, ''));
  }

  return Array.from(out);
}

/** Derive a human-readable title from a job URL's path. */
function titleFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const segs = u.pathname.split('/').filter(Boolean);
    // Last meaningful (non-numeric, length > 3) segment.
    for (let i = segs.length - 1; i >= 0; i--) {
      const s = segs[i];
      if (!s || /^\d+$/.test(s) || s.length <= 3) continue;
      return s
        .replace(/[-_]+/g, ' ')
        .replace(/\b\w/g, (c) => c.toUpperCase())
        .slice(0, 100);
    }
    return '';
  } catch {
    return '';
  }
}
