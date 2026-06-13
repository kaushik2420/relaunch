import { serverConfig } from '@/lib/config';
import type { JobPosting } from '@/lib/types';
import type { JobProvider, JobSearchQuery } from './types';
import { defaultLeverBoards } from '@/lib/ats-companies';

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

    const all: JobPosting[] = [];
    await Promise.all(
      boards.map(async (slug) => {
        try {
          const res = await fetch(
            `https://api.lever.co/v0/postings/${encodeURIComponent(slug)}?mode=json`,
            { next: { revalidate: 3600 } },
          );
          if (!res.ok) return;
          const postings: LeverPosting[] = await res.json();
          for (const p of postings) {
            if (!matchesQuery(p, q)) continue;
            all.push(mapLever(slug, p));
          }
        } catch {
          /* swallow single-board failure */
        }
      }),
    );

    const sliced = all.slice(0, q.limit ?? 50);
    console.log(`[lever] ${boards.length} boards → ${sliced.length} jobs after filter`);
    return sliced;
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
  const needle = q.query.toLowerCase();
  const title = (p.text ?? '').toLowerCase();
  const dept = (p.categories.department ?? '').toLowerCase();
  const team = (p.categories.team ?? '').toLowerCase();
  const desc = (p.descriptionPlain ?? p.description ?? '').toLowerCase();
  if (
    needle &&
    !title.includes(needle) &&
    !dept.includes(needle) &&
    !team.includes(needle) &&
    !desc.includes(needle)
  ) {
    return false;
  }

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
