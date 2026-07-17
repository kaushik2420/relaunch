import { serverConfig } from '@/lib/config';
import type { JobPosting } from '@/lib/types';
import type { JobProvider, JobSearchQuery } from './types';

/**
 * Coresignal Multi-source Jobs API — professional data platform with
 * strong India coverage. Deduped across LinkedIn, Indeed, Glassdoor,
 * and other sources, enriched with company + salary + tech metadata.
 *
 * Two-step API:
 *   1. POST /v2/job_multi_source/search/es_dsl  → returns job IDs
 *      (or full source docs if the ES query hydrates them)
 *   2. GET  /v2/job_multi_source/collect/{id}   → returns full job doc
 *
 * Both steps cost 1 credit. To conserve trial credits, we cap the
 * number of collect requests per fetch to COLLECT_CAP (default 20) —
 * that keeps a normal daily run at ~21 credits.
 *
 * Docs: https://docs.coresignal.com/jobs-api/multi-source-jobs-api
 * Auth: header `apikey: <CORESIGNAL_API_KEY>`
 */
const BASE = 'https://api.coresignal.com/cdapi';
const COLLECT_CAP = 20;

export class CoresignalProvider implements JobProvider {
  readonly name = 'coresignal';

  async search(q: JobSearchQuery): Promise<JobPosting[]> {
    const cfg = serverConfig();
    if (!cfg.CORESIGNAL_API_KEY) {
      console.warn('[coresignal] CORESIGNAL_API_KEY not set — skipping');
      return [];
    }

    // First pass: strict — includes country filter in MUST for
    // location relevance.
    let result = await runSearch(cfg.CORESIGNAL_API_KEY, q, {
      skipCountryFilter: false,
    });

    // Fallback: if the strict query drew a blank AND we had a country
    // filter to begin with, retry without it. Costs one extra search
    // call (~1 credit) but rescues niche titles in low-coverage
    // regions.
    if (
      result.ids.length === 0 &&
      result.hydrated.length === 0 &&
      detectCountry(q.locations) !== null
    ) {
      console.warn(
        `[coresignal] strict query returned 0 for "${q.query}" @ ${q.locations.join('/')} — retrying without country filter`,
      );
      result = await runSearch(cfg.CORESIGNAL_API_KEY, q, {
        skipCountryFilter: true,
      });
    }

    // Path A: search returned full docs → skip collect entirely
    if (result.hydrated.length > 0) {
      const mapped = result.hydrated.map(toJobPosting).filter(nonNull);
      console.log(`[coresignal] hydrated ${mapped.length} jobs (no collect)`);
      return mapped;
    }

    // Path B: search returned IDs → collect up to COLLECT_CAP of them
    const trimmed = result.ids.slice(0, COLLECT_CAP);
    const collected = await Promise.allSettled(
      trimmed.map((id) => collectOne(cfg.CORESIGNAL_API_KEY!, id)),
    );
    const jobs: JobPosting[] = [];
    for (const r of collected) {
      if (r.status === 'fulfilled' && r.value) {
        const mapped = toJobPosting(r.value);
        if (mapped) jobs.push(mapped);
      }
    }
    console.log(
      `[coresignal] search → ${result.ids.length} IDs, collected ${trimmed.length}, mapped ${jobs.length}`,
    );
    return jobs;
  }
}

/**
 * Single search invocation. Returns whichever shape Coresignal
 * responded with (IDs or hydrated docs), or empty arrays on error.
 * Called at most twice per search — once strict, once loose.
 */
async function runSearch(
  apiKey: string,
  q: JobSearchQuery,
  opts: { skipCountryFilter: boolean },
): Promise<{ ids: number[]; hydrated: RawJob[] }> {
  const dsl = buildDsl(q, opts);
  try {
    const res = await fetch(`${BASE}/v2/job_multi_source/search/es_dsl`, {
      method: 'POST',
      headers: {
        apikey: apiKey,
        'Content-Type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify(dsl),
      cache: 'no-store',
    });
    if (!res.ok) {
      const snippet = (await res.text()).slice(0, 400).replace(/\s+/g, ' ');
      console.error(
        `[coresignal] search HTTP ${res.status} · body: ${snippet}`,
      );
      //   401 → wrong / missing API key
      //   403 → plan doesn't include Multi-source Jobs
      //   422 → DSL body has a field their Pydantic schema forbids
      //   429 → rate limited
      return { ids: [], hydrated: [] };
    }
    const parsed = (await res.json()) as unknown;
    const [ids, hydrated] = normaliseSearchResponse(parsed);
    const label = opts.skipCountryFilter ? 'loose' : 'strict';
    console.log(
      `[coresignal] ${label} search "${q.query}" @ ${q.locations.join('/')} → ${ids.length} IDs, ${hydrated.length} hydrated`,
    );
    if (ids.length === 0 && hydrated.length === 0) {
      console.warn('[coresignal] zero hits — DSL was:', JSON.stringify(dsl));
    }
    return { ids, hydrated };
  } catch (err) {
    console.error('[coresignal] search failed', err);
    return { ids: [], hydrated: [] };
  }
}

/* ------------------------- helpers ------------------------- */

/**
 * Build the ES DSL body.
 *
 *   - MUST:   { match: { title: q } } + { match_phrase: { country } }
 *             Plain `match` on title works (proven via probes: 1000+
 *             hits). Country MUST-filter is critical because
 *             Coresignal returns a globally-ranked ID list and we
 *             only hydrate the top COLLECT_CAP (20). Without a hard
 *             country filter, "engineer" in the US/UK/Malaysia drowns
 *             out Bangalore roles in the top slice.
 *   - SHOULD: match_phrase on city — pure scoring boost so Bangalore
 *             ranks above other Indian cities in the hydrated slice.
 *
 * Deliberately dropped from the request:
 *   - `size`, `sort`, `from`, `_source` — Pydantic schema returns
 *     HTTP 422 "extra_forbidden" on any body field other than `query`.
 *   - `multi_match` with field boosts (title^3) — silently 0-hits.
 *   - `status=1` + date_posted range — didn't help recall and every
 *     extra clause is a compatibility risk with their ES wrapper.
 *     Rely on Coresignal's own dedup + freshness.
 *
 * Fallback path: if the country-filtered query returns 0 results
 * (rare — e.g. very niche title in a country with little coverage),
 * the caller retries without country. See search() below.
 */
function buildDsl(q: JobSearchQuery, opts?: { skipCountryFilter?: boolean }): unknown {
  const countryFilter = opts?.skipCountryFilter ? null : detectCountry(q.locations);
  const cityShoulds = q.locations
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 6)
    .map((city) => ({ match_phrase: { city } }));

  const must: unknown[] = [
    { match: { title: q.query } },
  ];
  if (countryFilter) {
    must.push({ match_phrase: { country: countryFilter } });
  }

  const should: unknown[] = [];
  if (cityShoulds.length > 0) should.push(...cityShoulds);

  const boolClause: Record<string, unknown> = { must };
  if (should.length > 0) boolClause.should = should;

  return { query: { bool: boolClause } };
}

function detectCountry(locations: string[]): string | null {
  const joined = locations.join(' ').toLowerCase();
  if (/india|bengaluru|bangalore|mumbai|delhi|hyderabad|pune|chennai|noida|gurgaon|gurugram/.test(joined)) {
    return 'India';
  }
  if (/united states|usa|new york|san francisco|seattle|austin/.test(joined)) return 'United States';
  if (/london|uk|united kingdom/.test(joined)) return 'United Kingdom';
  if (/singapore/.test(joined)) return 'Singapore';
  if (/australia|sydney|melbourne/.test(joined)) return 'Australia';
  return null;
}

/**
 * Normalise the two shapes Coresignal's search endpoint can return:
 *   Shape 1 — bare IDs: `[123, 456, 789]`
 *   Shape 2 — ES-hits envelope: `{ hits: { hits: [{ _id, _source: {...} }] } }`
 * Returns [ids, hydratedDocs]. Only one array will be non-empty.
 */
function normaliseSearchResponse(raw: unknown): [number[], RawJob[]] {
  if (Array.isArray(raw) && raw.length > 0 && typeof raw[0] === 'number') {
    return [raw as number[], []];
  }
  if (typeof raw === 'object' && raw !== null) {
    const obj = raw as { hits?: { hits?: Array<{ _id?: number; _source?: RawJob }> } };
    const hits = obj.hits?.hits ?? [];
    const docs: RawJob[] = [];
    const ids: number[] = [];
    for (const h of hits) {
      if (h._source) docs.push(h._source);
      else if (typeof h._id === 'number') ids.push(h._id);
    }
    return [ids, docs];
  }
  return [[], []];
}

async function collectOne(apiKey: string, id: number): Promise<RawJob | null> {
  const res = await fetch(`${BASE}/v2/job_multi_source/collect/${id}`, {
    headers: { apikey: apiKey, accept: 'application/json' },
    cache: 'no-store',
  });
  if (!res.ok) {
    console.warn(`[coresignal] collect ${id} → HTTP ${res.status}`);
    return null;
  }
  return (await res.json()) as RawJob;
}

function toJobPosting(raw: RawJob): JobPosting | null {
  const title = raw.title?.trim();
  const company = raw.company_name?.trim();
  const activeSrc =
    (raw.job_sources ?? []).find((s) => s.status === 'active') ??
    (raw.job_sources ?? [])[0];
  const url = activeSrc?.url ?? raw.external_url ?? '';
  if (!title || !company || !url) return null;

  const location =
    raw.location ??
    [raw.city, raw.state, raw.country].filter(Boolean).join(', ');

  const posted =
    raw.date_posted ?? raw.updated_at ?? raw.created_at ?? new Date().toISOString();

  // Salary: prefer YEAR entries; fall back to first. Convert hourly →
  // annual by * 2080 so downstream range comparisons work.
  let salary: JobPosting['salary'];
  const s = pickSalary(raw.salary ?? []);
  if (s) {
    salary = {
      min: s.type === 'HOUR' ? Math.round(s.min_value * 2080) : Math.round(s.min_value),
      max: s.type === 'HOUR' ? Math.round(s.max_value * 2080) : Math.round(s.max_value),
      currency: s.currency,
      cadence: 'yearly',
    };
  }

  const workMode: JobPosting['workMode'] = raw.accepts_remote
    ? 'remote'
    : /hybrid/i.test(location)
      ? 'hybrid'
      : location
        ? 'onsite'
        : 'unknown';

  const keywords: string[] = [];
  for (const fn of raw.functions ?? []) keywords.push(fn);
  for (const t of raw.company_technologies ?? []) {
    if (t.technology) keywords.push(t.technology);
  }

  return {
    id: `coresignal:${raw.id}`,
    source: 'coresignal',
    title,
    company,
    location,
    description: (raw.description ?? '').slice(0, 6000),
    url,
    postedAt: posted,
    salary,
    workMode,
    keywords: keywords.slice(0, 40),
  };
}

function pickSalary(salaries: RawSalary[]): RawSalary | null {
  if (salaries.length === 0) return null;
  const year = salaries.find((s) => s.type === 'YEAR');
  if (year) return year;
  return salaries[0] ?? null;
}

function nonNull<T>(v: T | null | undefined): v is T {
  return v !== null && v !== undefined;
}

/* ------------------ raw response shapes ------------------ */

interface RawJob {
  id: number;
  title?: string;
  description?: string;
  company_name?: string;
  location?: string;
  city?: string;
  state?: string;
  country?: string;
  date_posted?: string | null;
  updated_at?: string;
  created_at?: string;
  external_url?: string | null;
  accepts_remote?: boolean;
  employment_type?: string;
  seniority?: string;
  functions?: string[];
  job_sources?: Array<{
    source_id: string;
    source: string;
    updated_at: string;
    url: string;
    status: 'active' | 'inactive' | 'deleted';
  }>;
  salary?: RawSalary[];
  company_technologies?: Array<{ technology: string }>;
}

interface RawSalary {
  min_value: number;
  max_value: number;
  currency: string;
  type: 'YEAR' | 'MONTH' | 'WEEK' | 'DAY' | 'HOUR';
  text: string;
  source: string;
}
