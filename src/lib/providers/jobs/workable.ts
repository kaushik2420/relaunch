import { serverConfig } from '@/lib/config';
import type { JobPosting } from '@/lib/types';
import type { JobProvider, JobSearchQuery } from './types';
import { defaultWorkableBoards } from '@/lib/ats-companies';
import { findRoleFamily } from '@/lib/role-families';

/**
 * Workable — public board feed per account slug.
 *
 *   https://apply.workable.com/api/v3/accounts/<slug>/jobs
 *
 * No auth. Returns active postings only.
 */
export class WorkableProvider implements JobProvider {
  readonly name = 'workable';

  async search(q: JobSearchQuery): Promise<JobPosting[]> {
    const envBoards = serverConfig()
      .WORKABLE_BOARDS.split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const boards = envBoards.length > 0 ? envBoards : defaultWorkableBoards();
    console.log(`[workable] scanning ${boards.length} boards`);

    let httpOk = 0;
    let rawJobs = 0;
    const all: JobPosting[] = [];
    const failedSlugs: string[] = [];

    await Promise.all(
      boards.map(async (slug) => {
        try {
          const res = await fetch(
            `https://apply.workable.com/api/v3/accounts/${encodeURIComponent(slug)}/jobs?state=published`,
            { next: { revalidate: 3600 } },
          );
          if (!res.ok) {
            failedSlugs.push(`${slug}=${res.status}`);
            return;
          }
          httpOk++;
          const data: { results?: WorkableJob[] } = await res.json();
          rawJobs += data.results?.length ?? 0;
          for (const j of data.results ?? []) {
            if (!matchesQuery(j, q)) continue;
            all.push(mapWorkable(slug, j));
          }
        } catch {
          failedSlugs.push(`${slug}=ERR`);
        }
      }),
    );

    console.log(
      `[workable] ${httpOk}/${boards.length} boards reachable · ${rawJobs} raw jobs · ${all.length} matched query+location`,
    );
    if (failedSlugs.length > 0) {
      console.log(`[workable] failed slugs: ${failedSlugs.join(', ')}`);
    }
    return all.slice(0, q.limit ?? 50);
  }
}

interface WorkableJob {
  id: string;
  shortcode: string;
  title: string;
  full_title?: string;
  description?: string;
  location?: { city?: string; country?: string; region?: string; workplace?: string };
  remote?: boolean;
  published_on?: string;
  application_url?: string;
  url?: string;
  department?: string;
}

function matchesQuery(j: WorkableJob, q: JobSearchQuery): boolean {
  const needle = q.query.toLowerCase();
  const title = (j.title ?? '').toLowerCase();
  const desc = (j.description ?? '').toLowerCase();
  const haystack = `${title} ${desc}`;
  const exactHit = needle && haystack.includes(needle);
  const familyHit = q.roleFamily ? matchesFamily(haystack, q.roleFamily) : false;
  if (needle && !exactHit && !familyHit) return false;

  if (q.locations.length > 0) {
    const city = (j.location?.city ?? '').toLowerCase();
    const country = (j.location?.country ?? '').toLowerCase();
    const region = (j.location?.region ?? '').toLowerCase();
    const haystack = `${city} ${region} ${country}`;
    const ok = q.locations.some((l) => {
      if (l.toLowerCase() === 'remote') return j.remote === true;
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

function mapWorkable(slug: string, j: WorkableJob): JobPosting {
  const loc =
    [j.location?.city, j.location?.region, j.location?.country].filter(Boolean).join(', ') ||
    'Unknown';
  return {
    id: `workable:${slug}:${j.shortcode}`,
    source: 'workable',
    title: j.title,
    company: titleize(slug.replace(/-/g, ' ')),
    location: loc,
    description: stripHtml(j.description ?? ''),
    url: j.application_url ?? j.url ?? `https://apply.workable.com/${slug}/j/${j.shortcode}`,
    postedAt: j.published_on ?? new Date().toISOString(),
    workMode: j.remote ? 'remote' : (j.location?.workplace as JobPosting['workMode']) ?? 'unknown',
    keywords: j.department ? [j.department] : [],
  };
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

function titleize(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}
