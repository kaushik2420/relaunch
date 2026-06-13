import { serverConfig } from '@/lib/config';
import type { JobPosting } from '@/lib/types';
import type { JobProvider, JobSearchQuery } from './types';
import { defaultLeverBoards } from '@/lib/ats-companies';
import { findRoleFamily } from '@/lib/role-families';

/**
 * Lever — same pattern as the Greenhouse provider, just a different
 * ATS. Each Lever customer has a public posting feed at:
 *
 *   https://api.lever.co/v0/postings/<slug>?mode=json
 *
 * No auth needed. We loop the slugs in LEVER_BOARDS env (override) or
 * the curated default list and filter locally.
 */
export class LeverProvider implements JobProvider {
  readonly name = 'lever';

  async search(q: JobSearchQuery): Promise<JobPosting[]> {
    const envBoards = serverConfig()
      .LEVER_BOARDS.split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const boards = envBoards.length > 0 ? envBoards : defaultLeverBoards();
    console.log(
      `[lever] scanning ${boards.length} boards (source: ${envBoards.length ? 'env override' : 'curated default'})`,
    );

    // Per-board diagnostic: how many slugs returned valid responses,
    // how many raw jobs came back, how many passed the filter. Logged
    // in aggregate so we can spot bad slugs without spamming.
    let httpOk = 0;
    let rawJobs = 0;
    const all: JobPosting[] = [];
    const failedSlugs: string[] = [];

    await Promise.all(
      boards.map(async (slug) => {
        try {
          const res = await fetch(
            `https://api.lever.co/v0/postings/${encodeURIComponent(slug)}?mode=json`,
            { next: { revalidate: 3600 } },
          );
          if (!res.ok) {
            failedSlugs.push(`${slug}=${res.status}`);
            return;
          }
          httpOk++;
          const postings: LeverPosting[] = await res.json();
          rawJobs += postings.length;
          for (const p of postings) {
            if (!matchesQuery(p, q)) continue;
            all.push(mapLever(slug, p));
          }
        } catch (err) {
          failedSlugs.push(`${slug}=ERR`);
        }
      }),
    );

    console.log(
      `[lever] ${httpOk}/${boards.length} boards reachable · ${rawJobs} raw jobs · ${all.length} matched query+location`,
    );
    if (failedSlugs.length > 0) {
      console.log(`[lever] failed slugs: ${failedSlugs.join(', ')}`);
    }
    return all.slice(0, q.limit ?? 50);
  }
}

interface LeverPosting {
  id: string;
  text: string; // job title
  categories: {
    team?: string;
    department?: string;
    commitment?: string;
    location?: string;
    allLocations?: string[];
  };
  createdAt: number; // unix ms
  descriptionPlain?: string;
  description?: string; // HTML
  hostedUrl: string;
  applyUrl?: string;
  workplaceType?: 'on-site' | 'remote' | 'hybrid';
}

function matchesQuery(p: LeverPosting, q: JobSearchQuery): boolean {
  // Two-pass keyword match (same shape as Greenhouse): exact query
  // first, then fall back to role-family signal words so users with
  // quirky résumé titles still see real matches at these companies.
  const needle = q.query.toLowerCase();
  const title = (p.text ?? '').toLowerCase();
  const dept = (p.categories.department ?? '').toLowerCase();
  const team = (p.categories.team ?? '').toLowerCase();
  const desc = (p.descriptionPlain ?? p.description ?? '').toLowerCase();
  const haystack = `${title} ${dept} ${team} ${desc}`;
  const exactHit = needle && haystack.includes(needle);
  const familyHit = q.roleFamily ? matchesFamily(haystack, q.roleFamily) : false;
  if (needle && !exactHit && !familyHit) return false;

  if (q.locations.length > 0) {
    const haystack = [
      p.categories.location ?? '',
      ...(p.categories.allLocations ?? []),
    ]
      .join(' ')
      .toLowerCase();
    const ok = q.locations.some((l) => {
      if (l.toLowerCase() === 'remote') return p.workplaceType === 'remote' || /remote/.test(haystack);
      return haystack.includes(l.toLowerCase());
    });
    if (!ok) return false;
  }
  return true;
}

function matchesFamily(haystack: string, family: string): boolean {
  const signals = findRoleFamily(family)?.greenhouseSignals ?? [];
  return signals.some((s) => haystack.includes(s));
}

function mapLever(slug: string, p: LeverPosting): JobPosting {
  const location =
    p.categories.location ??
    (p.categories.allLocations ?? []).join(' / ') ??
    'Unknown';
  const desc = p.descriptionPlain ?? stripHtml(p.description ?? '');
  return {
    id: `lever:${slug}:${p.id}`,
    source: 'lever',
    title: p.text,
    company: titleize(slug),
    location,
    description: desc,
    url: p.applyUrl ?? p.hostedUrl,
    postedAt: new Date(p.createdAt).toISOString(),
    workMode:
      p.workplaceType === 'remote'
        ? 'remote'
        : p.workplaceType === 'hybrid'
          ? 'hybrid'
          : p.workplaceType === 'on-site'
            ? 'onsite'
            : 'unknown',
    keywords: [p.categories.team, p.categories.department].filter(Boolean) as string[],
  };
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function titleize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
