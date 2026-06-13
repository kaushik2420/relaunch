import { serverConfig } from '@/lib/config';
import type { JobPosting } from '@/lib/types';
import type { JobProvider, JobSearchQuery } from './types';
import { defaultRecruiteeBoards } from '@/lib/ats-companies';
import { findRoleFamily } from '@/lib/role-families';

/**
 * Recruitee — public offers feed at the company's own subdomain.
 *
 *   https://<slug>.recruitee.com/api/offers/
 *
 * No auth. Each company has its own subdomain; we hit the offers
 * endpoint per slug.
 */
export class RecruiteeProvider implements JobProvider {
  readonly name = 'recruitee';

  async search(q: JobSearchQuery): Promise<JobPosting[]> {
    const envBoards = serverConfig()
      .RECRUITEE_BOARDS.split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const boards = envBoards.length > 0 ? envBoards : defaultRecruiteeBoards();
    console.log(`[recruitee] scanning ${boards.length} boards`);

    let httpOk = 0;
    let rawJobs = 0;
    const all: JobPosting[] = [];
    const failedSlugs: string[] = [];

    await Promise.all(
      boards.map(async (slug) => {
        try {
          const res = await fetch(
            `https://${encodeURIComponent(slug)}.recruitee.com/api/offers/`,
            { next: { revalidate: 3600 } },
          );
          if (!res.ok) {
            failedSlugs.push(`${slug}=${res.status}`);
            return;
          }
          httpOk++;
          const data: { offers?: RecruiteeOffer[] } = await res.json();
          rawJobs += data.offers?.length ?? 0;
          for (const o of data.offers ?? []) {
            if (!matchesQuery(o, q)) continue;
            all.push(mapRecruitee(slug, o));
          }
        } catch {
          failedSlugs.push(`${slug}=ERR`);
        }
      }),
    );

    console.log(
      `[recruitee] ${httpOk}/${boards.length} boards reachable · ${rawJobs} raw jobs · ${all.length} matched query+location`,
    );
    if (failedSlugs.length > 0) {
      console.log(`[recruitee] failed slugs: ${failedSlugs.join(', ')}`);
    }
    return all.slice(0, q.limit ?? 50);
  }
}

interface RecruiteeOffer {
  id: number;
  title: string;
  description?: string; // HTML
  requirements?: string;
  location?: string;
  city?: string;
  country?: string;
  remote?: boolean;
  hybrid?: boolean;
  created_at?: string;
  careers_url?: string;
  careers_apply_url?: string;
  department?: string;
  tags?: string[];
}

function matchesQuery(o: RecruiteeOffer, q: JobSearchQuery): boolean {
  const needle = q.query.toLowerCase();
  const title = (o.title ?? '').toLowerCase();
  const desc = (o.description ?? '').toLowerCase();
  const reqs = (o.requirements ?? '').toLowerCase();
  const haystack = `${title} ${desc} ${reqs}`;
  const exactHit = needle && haystack.includes(needle);
  const familyHit = q.roleFamily ? matchesFamily(haystack, q.roleFamily) : false;
  if (needle && !exactHit && !familyHit) return false;

  if (q.locations.length > 0) {
    const haystack = `${o.city ?? ''} ${o.country ?? ''} ${o.location ?? ''}`.toLowerCase();
    const ok = q.locations.some((l) => {
      if (l.toLowerCase() === 'remote') return o.remote === true || /remote/.test(haystack);
      return haystack.includes(l.toLowerCase());
    });
    if (!ok) return false;
  }
  return true;
}

function matchesFamily(haystack: string, family: string): boolean {
  const signals = findRoleFamily(family)?.greenhouseSignals ?? [];
  return signals.some((s) => haystack.includes(s));
}

function mapRecruitee(slug: string, o: RecruiteeOffer): JobPosting {
  const loc = [o.city, o.country].filter(Boolean).join(', ') || o.location || 'Unknown';
  return {
    id: `recruitee:${slug}:${o.id}`,
    source: 'recruitee',
    title: o.title,
    company: titleize(slug),
    location: loc,
    description: stripHtml(o.description ?? ''),
    url: o.careers_apply_url ?? o.careers_url ?? '',
    postedAt: o.created_at ?? new Date().toISOString(),
    workMode: o.remote ? 'remote' : o.hybrid ? 'hybrid' : 'unknown',
    keywords: [o.department, ...(o.tags ?? [])].filter(Boolean) as string[],
  };
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

function titleize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
