import { enabledJobProviders } from '@/lib/config';
import type { JobPosting } from '@/lib/types';
import type { JobProvider, JobSearchQuery } from './types';
import { AdzunaProvider } from './adzuna';
import { JoobleProvider } from './jooble';
import { GreenhouseProvider } from './greenhouse';

const REGISTRY: Record<string, () => JobProvider> = {
  adzuna: () => new AdzunaProvider(),
  jooble: () => new JoobleProvider(),
  greenhouse: () => new GreenhouseProvider(),
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
export async function fetchJobsFromAll(q: JobSearchQuery): Promise<JobPosting[]> {
  const settled = await Promise.allSettled(providers().map((p) => p.search(q)));
  const all: JobPosting[] = [];
  for (const s of settled) {
    if (s.status === 'fulfilled') all.push(...s.value);
  }
  return dedupe(all);
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
