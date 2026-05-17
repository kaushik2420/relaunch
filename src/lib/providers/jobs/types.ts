import type { JobPosting } from '@/lib/types';

export type RoleFamily =
  | 'engineering'
  | 'product'
  | 'design'
  | 'data'
  | 'marketing'
  | 'operations'
  | 'sales'
  | 'other';

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
  /** Role family — used by providers to translate to their own category schema */
  roleFamily?: RoleFamily;
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
