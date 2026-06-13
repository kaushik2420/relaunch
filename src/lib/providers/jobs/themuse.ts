import type { JobPosting } from '@/lib/types';
import type { JobProvider, JobSearchQuery } from './types';

/**
 * The Muse — well-known tech-friendly aggregator. Free public API for
 * non-commercial use, ~5K active listings, decent India + US coverage.
 *
 *   https://www.themuse.com/api/public/jobs?category=<x>&location=<y>&page=<n>
 *
 * Pagination is by page (20/page). We pull a couple of pages and filter
 * locally on the user's keyword.
 */
export class TheMuseProvider implements JobProvider {
  readonly name = 'themuse';

  async search(q: JobSearchQuery): Promise<JobPosting[]> {
    const params = new URLSearchParams();
    if (q.locations.length > 0) {
      // The Muse takes comma-separated locations; "Remote" is valid.
      for (const loc of q.locations.slice(0, 5)) params.append('location', loc);
    }
    const wantsRemote =
      !q.workMode || q.workMode === 'remote' || q.workMode === 'any';
    if (wantsRemote && !q.locations.some((l) => /remote/i.test(l))) {
      params.append('location', 'Remote');
    }
    params.set('page', '0');
    params.set('descending', 'true');

    let data: { results?: TheMuseJob[] };
    try {
      const res = await fetch(
        `https://www.themuse.com/api/public/jobs?${params}`,
        { next: { revalidate: 1800 } }, // cache 30min
      );
      if (!res.ok) {
        throw new Error(`The Muse ${res.status}`);
      }
      data = await res.json();
    } catch (err) {
      console.error('[themuse] fetch failed', err);
      return [];
    }

    const needle = q.query.toLowerCase();
    const filtered = (data.results ?? [])
      .filter((j) => {
        if (!needle) return true;
        const t = (j.name ?? '').toLowerCase();
        const c = (j.contents ?? '').toLowerCase();
        return t.includes(needle) || c.includes(needle);
      })
      .map(mapTheMuse);
    console.log(`[themuse] ${filtered.length} jobs after keyword filter`);
    return filtered.slice(0, q.limit ?? 50);
  }
}

interface TheMuseJob {
  id: number;
  name: string;
  company: { name: string };
  locations: { name: string }[];
  publication_date: string;
  contents: string; // HTML
  refs: { landing_page: string };
  type?: string;
  categories?: { name: string }[];
}

function mapTheMuse(j: TheMuseJob): JobPosting {
  const loc = (j.locations ?? []).map((l) => l.name).join(' / ') || 'Unknown';
  return {
    id: `themuse:${j.id}`,
    source: 'themuse',
    title: j.name,
    company: j.company.name,
    location: loc,
    description: stripHtml(j.contents ?? ''),
    url: j.refs.landing_page,
    postedAt: j.publication_date,
    workMode: /remote/i.test(loc) ? 'remote' : 'unknown',
    keywords: (j.categories ?? []).map((c) => c.name),
  };
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
