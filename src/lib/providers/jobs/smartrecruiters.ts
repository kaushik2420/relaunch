import { serverConfig } from '@/lib/config';
import type { JobPosting } from '@/lib/types';
import type { JobProvider, JobSearchQuery } from './types';
import { defaultSmartRecruitersBoards } from '@/lib/ats-companies';

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

    const all: JobPosting[] = [];
    await Promise.all(
      boards.map(async (slug) => {
        try {
          const res = await fetch(
            `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(slug)}/postings?limit=100`,
            { next: { revalidate: 3600 } },
          );
          if (!res.ok) return;
          const data: { content?: SmartRecPosting[] } = await res.json();
          for (const p of data.content ?? []) {
            if (!matchesQuery(p, q)) continue;
            all.push(mapSmartRec(slug, p));
          }
        } catch {
          /* skip */
        }
      }),
    );

    const sliced = all.slice(0, q.limit ?? 50);
    console.log(`[smartrecruiters] ${boards.length} boards → ${sliced.length} after filter`);
    return sliced;
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
  if (needle && !title.includes(needle) && !dept.includes(needle) && !fn.includes(needle) && !desc.includes(needle))
    return false;

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
