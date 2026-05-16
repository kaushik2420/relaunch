import { enabledJobProviders } from '@/lib/config';
import type { JobPosting } from '@/lib/types';
import type { JobProvider, JobSearchQuery } from './types';
import { AdzunaProvider } from './adzuna';
import { JoobleProvider } from './jooble';
import { GreenhouseProvider } from './greenhouse';
import { JSearchProvider } from './jsearch';

const REGISTRY: Record<string, () => JobProvider> = {
  adzuna: () => new AdzunaProvider(),
  jooble: () => new JoobleProvider(),
  greenhouse: () => new GreenhouseProvider(),
  jsearch: () => new JSearchProvider(),
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
  const ps = providers();
  const settled = await Promise.allSettled(ps.map((p) => p.search(q)));
  const all: JobPosting[] = [];

  // Per-provider summary line — easy to scan in Vercel logs to spot
  // which sources are returning 0.
  const summary: Record<string, number | string> = {};
  settled.forEach((s, i) => {
    const name = ps[i]!.name;
    if (s.status === 'fulfilled') {
      summary[name] = s.value.length;
      all.push(...s.value);
    } else {
      summary[name] = `ERROR: ${(s.reason as Error).message}`;
    }
  });
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
