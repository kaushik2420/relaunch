import { serverConfig } from '@/lib/config';
import type { JobPosting } from '@/lib/types';
import type { JobProvider, JobSearchQuery } from './types';

/**
 * Jooble — aggregates many job boards. Free API key on request.
 * https://jooble.org/api/about
 */
export class JoobleProvider implements JobProvider {
  readonly name = 'jooble';

  async search(q: JobSearchQuery): Promise<JobPosting[]> {
    const cfg = serverConfig();
    if (!cfg.JOOBLE_API_KEY) throw new Error('JOOBLE_API_KEY not set');

    const url = `https://jooble.org/api/${cfg.JOOBLE_API_KEY}`;
    const body = {
      keywords: q.query,
      location: q.locations.join(', '),
      page: 1,
      ResultOnPage: q.limit ?? 20,
      datecreatedfrom: daysAgo(q.postedWithinDays ?? 7),
    };
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) return [];
    const data: { jobs?: JoobleResult[] } = await res.json();
    return (data.jobs ?? []).map(mapJooble);
  }
}

interface JoobleResult {
  id: number;
  title: string;
  location: string;
  snippet: string;
  salary?: string;
  source: string;
  type?: string;
  link: string;
  company?: string;
  updated: string;
}

function mapJooble(r: JoobleResult): JobPosting {
  return {
    id: `jooble:${r.id}`,
    source: 'jooble',
    title: r.title,
    company: r.company || r.source,
    location: r.location,
    description: r.snippet,
    url: r.link,
    postedAt: r.updated,
    workMode: 'unknown',
    keywords: [],
  };
}

function daysAgo(days: number): string {
  const d = new Date(Date.now() - days * 86400_000);
  return d.toISOString().slice(0, 10);
}
