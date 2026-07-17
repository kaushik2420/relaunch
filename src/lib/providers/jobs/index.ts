import { enabledJobProviders } from '@/lib/config';
import type { JobPosting } from '@/lib/types';
import type { JobProvider, JobSearchQuery } from './types';
import { AdzunaProvider } from './adzuna';
import { JoobleProvider } from './jooble';
import { GreenhouseProvider } from './greenhouse';
import { JSearchProvider } from './jsearch';
import { RemotiveProvider } from './remotive';
import { TheMuseProvider } from './themuse';
import { LeverProvider } from './lever';
import { WorkableProvider } from './workable';
import { SmartRecruitersProvider } from './smartrecruiters';
import { RecruiteeProvider } from './recruitee';
import { CoresignalProvider } from './coresignal';

const REGISTRY: Record<string, () => JobProvider> = {
  adzuna: () => new AdzunaProvider(),
  jooble: () => new JoobleProvider(),
  greenhouse: () => new GreenhouseProvider(),
  jsearch: () => new JSearchProvider(),
  remotive: () => new RemotiveProvider(),
  themuse: () => new TheMuseProvider(),
  lever: () => new LeverProvider(),
  workable: () => new WorkableProvider(),
  smartrecruiters: () => new SmartRecruitersProvider(),
  recruitee: () => new RecruiteeProvider(),
  coresignal: () => new CoresignalProvider(),
};

let _providers: JobProvider[] | undefined;
function providers(): JobProvider[] {
  if (_providers) return _providers;
  _providers = enabledJobProviders()
    .map((n) => REGISTRY[n]?.())
    .filter((p): p is JobProvider => Boolean(p));
  return _providers;
}

/**
 * Fan out to every enabled provider in parallel, dedupe by (company, title).
 * Errors in one provider don't sink the others.
 */
/** Per-provider diagnostic info — used by /api/run-now to surface
 *  why no jobs came back without digging through Vercel logs. */
export interface ProviderResult {
  name: string;
  count: number;
  error?: string;
  /** Human-readable summary of what we searched for. Shown in dashboard. */
  searched?: string;
}

/** Module-level: latest provider summary from the most recent fetch.
 *  Read once after fetchJobsFromAll() to get the breakdown. */
let _lastSummary: ProviderResult[] = [];
export function lastFetchSummary(): ProviderResult[] {
  return _lastSummary;
}

export async function fetchJobsFromAll(q: JobSearchQuery): Promise<JobPosting[]> {
  const ps = providers();
  const settled = await Promise.allSettled(ps.map((p) => p.search(q)));
  const all: JobPosting[] = [];

  // Human-readable "what we searched for" — same for every provider since
  // they all see the same JobSearchQuery. Individual providers may massage it
  // differently internally but this gives the user a clear picture.
  const searched =
    `"${q.query}"${q.roleFamily ? ` · ${q.roleFamily}` : ''} in ${q.locations.slice(0, 3).join(', ') || 'anywhere'}`;

  const summary: ProviderResult[] = settled.map((s, i) => {
    const name = ps[i]!.name;
    if (s.status === 'fulfilled') {
      all.push(...s.value);
      return { name, count: s.value.length, searched };
    }
    return { name, count: 0, error: (s.reason as Error).message, searched };
  });
  _lastSummary = summary;
  console.log('[jobs] per-provider counts:', summary);

  const deduped = dedupe(all);
  console.log(`[jobs] total ${all.length} → ${deduped.length} after dedup`);
  return deduped;
}

function dedupe(jobs: JobPosting[]): JobPosting[] {
  const seen = new Set<string>();
  const out: JobPosting[] = [];
  for (const j of jobs) {
    const key = `${j.company.toLowerCase()}::${j.title.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(j);
  }
  return out;
}

export type { JobProvider, JobSearchQuery } from './types';
