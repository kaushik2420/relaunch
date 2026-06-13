import { serverConfig } from '@/lib/config';
import type { JobPosting } from '@/lib/types';
import type { JobProvider, JobSearchQuery } from './types';
import { defaultSmartRecruitersBoards } from '@/lib/ats-companies';
import { findRoleFamily } from '@/lib/role-families';

/**
 * SmartRecruiters — public postings endpoint per company.
 *
 *   https://api.smartrecruiters.com/v1/companies/<slug>/postings
 *
 * No auth. Lots of enterprise customers (Visa, Bosch, etc) post here.
 */
export class SmartRecruitersProvider implements JobProvider {
  readonly name = 'smartrecruiters';

  async search(q: JobSearchQuery): Promise<JobPosting[]> {
    const envBoards = serverConfig()
      .SMARTRECRUITERS_BOARDS.split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const boards = envBoards.length > 0 ? envBoards : defaultSmartRecruitersBoards();
    console.log(`[smartrecruiters] scanning ${boards.length} boards`);

    let httpOk = 0;
    let rawJobs = 0;
    const all: JobPosting[] = [];
    const failedSlugs: string[] = [];

    await Promise.all(
      boards.map(async (slug) => {
        try {
          const res = await fetch(
            `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(slug)}/postings?limit=100`,
            { next: { revalidate: 3600 } },
          );
          if (!res.ok) {
            failedSlugs.push(`${slug}=${res.status}`);
            return;
          }
          httpOk++;
          const data: { content?: SmartRecPosting[] } = await res.json();
          rawJobs += data.content?.length ?? 0;
          for (const p of data.content ?? []) {
            if (!matchesQuery(p, q)) continue;
            all.push(mapSmartRec(slug, p));
          }
        } catch {
          failedSlugs.push(`${slug}=ERR`);
        }
      }),
    );

    console.log(
      `[smartrecruiters] ${httpOk}/${boards.length} boards reachable · ${rawJobs} raw jobs · ${all.length} matched query+location`,
    );
    if (failedSlugs.length > 0) {
      console.log(`[smartrecruiters] failed slugs: ${failedSlugs.join(', ')}`);
    }
    return all.slice(0, q.limit ?? 50);
  }
}

interface SmartRecPosting {
  id: string;
  uuid: string;
  name: string;
  jobAd?: { sections?: { jobDescription?: { text?: string } } };
  location?: { city?: string; country?: string; region?: string; remote?: boolean };
  releasedDate?: string;
  ref?: string;
  applyUrl?: string;
  postingUrl?: string;
  department?: { label?: string };
  function?: { label?: string };
}

function matchesQuery(p: SmartRecPosting, q: JobSearchQuery): boolean {
  const needle = q.query.toLowerCase();
  const title = (p.name ?? '').toLowerCase();
  const dept = (p.department?.label ?? '').toLowerCase();
  const fn = (p.function?.label ?? '').toLowerCase();
  const desc = (p.jobAd?.sections?.jobDescription?.text ?? '').toLowerCase();
  const haystack = `${title} ${dept} ${fn} ${desc}`;
  const exactHit = needle && haystack.includes(needle);
  const familyHit = q.roleFamily ? matchesFamily(haystack, q.roleFamily) : false;
  if (needle && !exactHit && !familyHit) return false;

  if (q.locations.length > 0) {
    const haystack = `${p.location?.city ?? ''} ${p.location?.region ?? ''} ${p.location?.country ?? ''}`.toLowerCase();
    const ok = q.locations.some((l) => {
      if (l.toLowerCase() === 'remote') return p.location?.remote === true || /remote/.test(haystack);
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

function mapSmartRec(slug: string, p: SmartRecPosting): JobPosting {
  const loc =
    [p.location?.city, p.location?.region, p.location?.country].filter(Boolean).join(', ') ||
    'Unknown';
  const url = p.applyUrl ?? p.postingUrl ?? `https://jobs.smartrecruiters.com/${slug}/${p.id}`;
  return {
    id: `smartrec:${slug}:${p.id}`,
    source: 'smartrecruiters',
    title: p.name,
    company: slug,
    location: loc,
    description: stripHtml(p.jobAd?.sections?.jobDescription?.text ?? ''),
    url,
    postedAt: p.releasedDate ?? new Date().toISOString(),
    workMode: p.location?.remote ? 'remote' : 'unknown',
    keywords: [p.department?.label, p.function?.label].filter(Boolean) as string[],
  };
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}
