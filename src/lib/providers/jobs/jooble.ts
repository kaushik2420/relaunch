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

    // One call per city — joining a comma-separated list confuses Jooble's
    // parser and yields a single noisy result set. Capped at 6 cities.
    const MAX = 6;
    const locs = q.locations.length ? q.locations.slice(0, MAX) : [''];
    const perCall = Math.max(Math.ceil((q.limit ?? 20) / locs.length), 5);

    const url = `https://jooble.org/api/${cfg.JOOBLE_API_KEY}`;
    const results: JobPosting[] = [];
    for (const loc of locs) {
      const body = {
        keywords: q.query,
        location: loc,
        page: 1,
        ResultOnPage: perCall,
        datecreatedfrom: daysAgo(q.postedWithinDays ?? 7),
      };
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          console.warn(`[jooble] ${loc || '*'} → HTTP ${res.status}`);
          continue;
        }
        const data: { jobs?: JoobleResult[] } = await res.json();
        const mapped = (data.jobs ?? []).map(mapJooble);
        console.log(`[jooble] ${loc || '*'} → ${mapped.length} jobs`);
        results.push(...mapped);
      } catch (err) {
        console.warn(`[jooble] ${loc || '*'} → ${(err as Error).message}`);
      }
    }
    return results;
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
