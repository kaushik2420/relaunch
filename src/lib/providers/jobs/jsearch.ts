import type { JobPosting } from '@/lib/types';
import type { JobProvider, JobSearchQuery } from './types';

/**
 * JSearch via RapidAPI — gives us LinkedIn, Indeed, Glassdoor jobs in
 * one shot. Free tier on RapidAPI is small (~25 reqs/mo); paid plans
 * start at $10/mo for ~10k reqs which is plenty for 500 users.
 *
 * Setup:
 *   1. Sign up at https://rapidapi.com
 *   2. Subscribe to "JSearch" by Letscrape (free or basic tier)
 *   3. Copy your X-RapidAPI-Key from any sample request
 *   4. Set env: JSEARCH_API_KEY=<your-key>
 *   5. Add `jsearch` to JOB_PROVIDERS, e.g. JOB_PROVIDERS=adzuna,jooble,greenhouse,jsearch
 *   6. Redeploy. Done.
 *
 * https://rapidapi.com/letscrape-6bRBa3QguO5/api/jsearch
 */
export class JSearchProvider implements JobProvider {
  readonly name = 'jsearch';

  async search(q: JobSearchQuery): Promise<JobPosting[]> {
    const apiKey = process.env.JSEARCH_API_KEY;
    if (!apiKey) return []; // Not configured — silently no-op

    const location = q.locations[0] ?? '';
    const query = location ? `${q.query} in ${location}` : q.query;
    const params = new URLSearchParams({
      query,
      page: '1',
      num_pages: '1',
      date_posted: this.mapDate(q.postedWithinDays ?? 7),
    });
    if (q.workMode === 'remote') params.set('work_from_home', 'true');

    const res = await fetch(`https://jsearch.p.rapidapi.com/search?${params}`, {
      headers: {
        'X-RapidAPI-Key': apiKey,
        'X-RapidAPI-Host': 'jsearch.p.rapidapi.com',
      },
      // JSearch's CDN sets long cache TTLs — let Vercel cache for 30 min
      next: { revalidate: 1800 },
    });
    if (!res.ok) return [];

    const json: { data?: JSearchJob[] } = await res.json();
    return (json.data ?? []).map(mapJSearch).filter((j): j is JobPosting => j !== null);
  }

  private mapDate(days: number): string {
    if (days <= 1) return 'today';
    if (days <= 3) return '3days';
    if (days <= 7) return 'week';
    return 'month';
  }
}

interface JSearchJob {
  job_id: string;
  employer_name?: string;
  job_title: string;
  job_description?: string;
  job_apply_link?: string;
  job_city?: string;
  job_state?: string;
  job_country?: string;
  job_is_remote?: boolean;
  job_posted_at_datetime_utc?: string;
  job_min_salary?: number;
  job_max_salary?: number;
  job_salary_currency?: string;
  job_salary_period?: string;
  job_publisher?: string;
}

function mapJSearch(j: JSearchJob): JobPosting | null {
  if (!j.job_title || !j.employer_name) return null;
  const location = [j.job_city, j.job_state, j.job_country].filter(Boolean).join(', ');
  return {
    id: `jsearch:${j.job_id}`,
    source: 'jsearch',
    title: j.job_title,
    company: j.employer_name,
    location: location || 'Unspecified',
    description: j.job_description ?? '',
    url: j.job_apply_link ?? '',
    postedAt: j.job_posted_at_datetime_utc ?? new Date().toISOString(),
    workMode: j.job_is_remote ? 'remote' : 'unknown',
    salary:
      j.job_min_salary && j.job_max_salary
        ? {
            min: j.job_min_salary,
            max: j.job_max_salary,
            currency: j.job_salary_currency ?? 'USD',
            cadence: j.job_salary_period === 'YEAR' ? 'yearly' : 'monthly',
          }
        : undefined,
    keywords: j.job_publisher ? [j.job_publisher] : [],
  };
}
