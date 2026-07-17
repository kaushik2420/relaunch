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

    const dsl = buildDsl(q);
    let ids: number[] = [];
    let hydrated: RawJob[] = [];

    // ES DSL search. Coresignal usually returns an array of numeric IDs;
    // some deployments return full _source docs — handle both shapes.
    try {
      const res = await fetch(`${BASE}/v2/job_multi_source/search/es_dsl`, {
        method: 'POST',
        headers: {
          apikey: cfg.CORESIGNAL_API_KEY,
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
        // Common 4xx meanings — surface them plainly so Vercel logs
        // aren't a puzzle:
        //   401 → wrong / missing API key
        //   403 → key valid but Multi-source Jobs isn't in your plan
        //   404 → wrong endpoint (should never happen; hardcoded)
        //   429 → rate limited (we send 1 search per call — unlikely)
        return [];
      }
      const parsed = (await res.json()) as unknown;
      const [maybeIds, maybeHydrated] = normaliseSearchResponse(parsed);
      ids = maybeIds;
      hydrated = maybeHydrated;
      console.log(
        `[coresignal] search "${q.query}" @ ${q.locations.join('/')} → ${ids.length} IDs, ${hydrated.length} hydrated`,
      );
      if (ids.length === 0 && hydrated.length === 0) {
        // Print the DSL we sent so it's easy to grab from Vercel logs
        // and paste into Postman / the Coresignal search-preview tool
        console.warn(
          '[coresignal] zero hits — DSL was:',
          JSON.stringify(dsl),
        );
      }
    } catch (err) {
      console.error('[coresignal] search failed', err);
      return [];
    }

    // Path A: search returned full docs → skip collect entirely
    if (hydrated.length > 0) {
      const mapped = hydrated.map(toJobPosting).filter(nonNull);
      console.log(`[coresignal] hydrated ${mapped.length} jobs (no collect)`);
      return mapped;
    }

    // Path B: search returned IDs → collect up to COLLECT_CAP of them
    const trimmed = ids.slice(0, COLLECT_CAP);
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
      `[coresignal] search → ${ids.length} IDs, collected ${trimmed.length}, mapped ${jobs.length}`,
    );
    return jobs;
  }
}

/* ------------------------- helpers ------------------------- */

/**
 * Build the ES DSL body. Deliberately loose:
 *   - MUST: title match on the user's query keywords
 *   - SHOULD (soft-boost, not required): country match, city match,
 *     recent date_posted, status=active
 * Sort by date_posted DESC when present, tiebreak by ES score.
 *
 * The previous version filtered on status=1 + date_posted range +
 * country all as MUST, which zero-ed out real matches — many
 * Coresignal jobs have date_posted=null (see their docs) and would
 * have been excluded by the range filter alone.
 */
function buildDsl(q: JobSearchQuery): unknown {
  const days = q.postedWithinDays ?? 14;
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
  const size = Math.min(q.limit ?? 25, 50);

  const countryFilter = detectCountry(q.locations);
  const cityShoulds = q.locations
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 6)
    .map((city) => ({ match_phrase: { city } }));

  // MUST — the only hard requirement is that the title/description
  // matches the user's query at all. Everything else is a soft boost.
  const must: unknown[] = [
    {
      multi_match: {
        query: q.query,
        fields: ['title^3', 'functions^2', 'description'],
        // Fuzzy zero — Coresignal's tokenizer already handles stems
        operator: 'or',
      },
    },
  ];

  const should: unknown[] = [
    // Prefer active jobs but don't exclude inactive ones (recall matters
    // more than perfection at search-only stage; we won't re-collect
    // deleted ones anyway because their URLs 404 downstream).
    { term: { status: 1 } },
    // Fresh > stale — but don't hard-filter, since Coresignal reports
    // many records with date_posted=null. Range as a should still lifts
    // dated-recent hits above older/undated ones.
    { range: { date_posted: { gte: cutoff } } },
  ];

  if (countryFilter) should.push({ match_phrase: { country: countryFilter } });
  if (cityShoulds.length > 0) should.push(...cityShoulds);

  return {
    query: { bool: { must, should } },
    sort: [
      // date_posted first if present, ES score as tiebreak
      { date_posted: { order: 'desc', missing: '_last' } },
      '_score',
    ],
    size,
  };
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
