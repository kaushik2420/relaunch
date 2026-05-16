import type { JobPosting } from '@/lib/types';

export interface JobSearchQuery {
  /** Keywords / role */
  query: string;
  /** Locations to OR together */
  locations: string[];
  /** Remote / hybrid / onsite filter (provider may ignore) */
  workMode?: 'remote' | 'hybrid' | 'onsite' | 'any';
  /** Max results desired */
  limit?: number;
  /** Only roles posted within this many days */
  postedWithinDays?: number;
}

export interface JobProvider {
  /** A short, unique name; used for logging + dedup. */
  readonly name: string;
  /**
   * Fetch postings matching the query. MUST return canonical
   * JobPosting objects — implementations are responsible for mapping.
   */
  search(q: JobSearchQuery): Promise<JobPosting[]>;
}
