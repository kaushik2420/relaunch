import type { JobPosting } from '@/lib/types';
import type { JobProvider, JobSearchQuery } from './types';

/**
 * Remotive — fully-remote job aggregator. Free, no auth, no rate-limit
 * documented. Single endpoint returns the full active listings; we
 * filter locally.
 *
 *   https://remotive.com/api/remote-jobs?search=<q>&limit=<n>
 *
 * Only fires if at least one of the user's workModes is 'remote' or
 * 'any' — burning a call when they want strictly on-site/hybrid would
 * be wasted.
 */
export class RemotiveProvider implements JobProvider {
  readonly name = 'remotive';

  async search(q: JobSearchQuery): Promise<JobPosting[]> {
    // Only fire if the user is open to remote — otherwise we waste a
    // call. Default (no workMode set) is treated as 'open to anything'.
    const wantsRemote = !q.workMode || q.workMode === 'remote' || q.workMode === 'any';
    if (!wantsRemote) return [];

    const params = new URLSearchParams();
    if (q.query) params.set('search', q.query);
    params.set('limit', String(q.limit ?? 50));

    let data: { jobs?: RemotiveJob[] };
    try {
      const res = await fetch(
        `https://remotive.com/api/remote-jobs?${params}`,
        { next: { revalidate: 1800 } }, // cache 30min at the edge
      );
      if (!res.ok) {
        throw new Error(`Remotive ${res.status}`);
      }
      data = await res.json();
    } catch (err) {
      console.error('[remotive] fetch failed', err);
      return [];
    }

    const jobs = (data.jobs ?? []).map(mapRemotive);
    console.log(`[remotive] returned ${jobs.length} remote jobs`);
    return jobs.slice(0, q.limit ?? 50);
  }
}

interface RemotiveJob {
  id: number;
  url: string;
  title: string;
  company_name: string;
  category: string;
  job_type?: string;
  publication_date: string;
  candidate_required_location: string;
  salary?: string;
  description: string;
  tags?: string[];
}

function mapRemotive(j: RemotiveJob): JobPosting {
  return {
    id: `remotive:${j.id}`,
    source: 'remotive',
    title: j.title,
    company: j.company_name,
    location: j.candidate_required_location || 'Remote',
    description: stripHtml(j.description ?? ''),
    url: j.url,
    postedAt: j.publication_date,
    workMode: 'remote',
    keywords: j.tags ?? [],
  };
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
