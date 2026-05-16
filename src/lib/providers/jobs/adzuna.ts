import { serverConfig } from '@/lib/config';
import type { JobPosting } from '@/lib/types';
import type { JobProvider, JobSearchQuery } from './types';

/**
 * Adzuna — free tier: 1k calls/day, decent India + global coverage.
 * https://developer.adzuna.com/docs
 */
export class AdzunaProvider implements JobProvider {
  readonly name = 'adzuna';

  // ISO-like country codes Adzuna supports. We default to India ('in').
  // If the user's preferred location matches a known country, we use it.
  private countryFor(loc: string): string {
    const lower = loc.toLowerCase();
    if (/india|mumbai|delhi|bengaluru|hyderabad|pune|chennai/.test(lower)) return 'in';
    if (/united states|usa|new york|sf|san francisco|seattle/.test(lower)) return 'us';
    if (/london|uk|united kingdom/.test(lower)) return 'gb';
    if (/singapore/.test(lower)) return 'sg';
    if (/australia|sydney|melbourne/.test(lower)) return 'au';
    if (/germany|berlin/.test(lower)) return 'de';
    return 'in';
  }

  async search(q: JobSearchQuery): Promise<JobPosting[]> {
    const cfg = serverConfig();
    if (!cfg.ADZUNA_APP_ID || !cfg.ADZUNA_APP_KEY) {
      console.warn('[adzuna] ADZUNA_APP_ID/ADZUNA_APP_KEY not set — skipping');
      return [];
    }

    // Pick the CANONICAL location per country so we don't fire 10+ calls
    // when the user has multiple spelling aliases (Bengaluru / Bangalore / BLR).
    // Group by country, take one representative city each, max 3 countries.
    const groups = new Map<string, string>();
    for (const loc of q.locations.length ? q.locations : ['']) {
      const country = this.countryFor(loc);
      if (!groups.has(country)) groups.set(country, loc);
      if (groups.size >= 3) break;
    }
    if (groups.size === 0) groups.set('in', '');

    const results: JobPosting[] = [];
    for (const [country, loc] of groups) {
      const params = new URLSearchParams({
        app_id: cfg.ADZUNA_APP_ID,
        app_key: cfg.ADZUNA_APP_KEY,
        what: q.query,
        where: loc,
        results_per_page: String(Math.min(q.limit ?? 20, 50)),
        max_days_old: String(q.postedWithinDays ?? 7),
        content_type: 'application/json',
      });
      const url = `https://api.adzuna.com/v1/api/jobs/${country}/search/1?${params}`;
      try {
        const res = await fetch(url);
        if (!res.ok) {
          console.warn(`[adzuna] ${country}/${loc} → HTTP ${res.status}`);
          continue;
        }
        const data: { results: AdzunaResult[] } = await res.json();
        const mapped = (data.results ?? []).map(mapAdzuna);
        console.log(`[adzuna] ${country}/${loc || '*'} → ${mapped.length} jobs`);
        results.push(...mapped);
      } catch (err) {
        console.warn(`[adzuna] ${country}/${loc} → ${(err as Error).message}`);
      }
    }
    return results;
  }
}

interface AdzunaResult {
  id: string;
  title: string;
  description: string;
  company: { display_name: string };
  location: { display_name: string };
  redirect_url: string;
  created: string;
  salary_min?: number;
  salary_max?: number;
  contract_time?: string;
}

function mapAdzuna(r: AdzunaResult): JobPosting {
  return {
    id: `adzuna:${r.id}`,
    source: 'adzuna',
    title: r.title,
    company: r.company.display_name,
    location: r.location.display_name,
    description: r.description,
    url: r.redirect_url,
    postedAt: r.created,
    salary:
      r.salary_min && r.salary_max
        ? { min: r.salary_min, max: r.salary_max, currency: 'INR', cadence: 'yearly' }
        : undefined,
    workMode: 'unknown',
    keywords: [],
  };
}
