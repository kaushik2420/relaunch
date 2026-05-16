import { serverConfig } from '@/lib/config';
import type { JobPosting } from '@/lib/types';
import type { JobProvider, JobSearchQuery } from './types';

/**
 * Greenhouse — many top tech companies expose a public board API at
 *   https://boards-api.greenhouse.io/v1/boards/<board>/jobs?content=true
 * No auth needed. We loop the boards listed in GREENHOUSE_BOARDS env
 * and filter locally.
 *
 * Same pattern works for Lever; create lever.ts when needed.
 */
export class GreenhouseProvider implements JobProvider {
  readonly name = 'greenhouse';

  async search(q: JobSearchQuery): Promise<JobPosting[]> {
    const boards = serverConfig().GREENHOUSE_BOARDS.split(',').map((s) => s.trim()).filter(Boolean);
    if (!boards.length) {
      console.warn('[greenhouse] GREENHOUSE_BOARDS env var is empty — set it to e.g. "razorpay,stripe,airbnb,vercel"');
      return [];
    }

    const allJobs: JobPosting[] = [];
    await Promise.all(
      boards.map(async (board) => {
        try {
          const res = await fetch(
            `https://boards-api.greenhouse.io/v1/boards/${board}/jobs?content=true`,
            { next: { revalidate: 3600 } } // cache 1hr at the edge
          );
          if (!res.ok) return;
          const data: { jobs?: GhJob[] } = await res.json();
          for (const j of data.jobs ?? []) {
            if (!matchesQuery(j, q)) continue;
            allJobs.push(mapGreenhouse(board, j));
          }
        } catch {
          /* ignore single-board failures */
        }
      })
    );
    const sliced = allJobs.slice(0, q.limit ?? 50);
    console.log(`[greenhouse] ${boards.length} boards scanned → ${sliced.length} jobs after filter`);
    return sliced;
  }
}

interface GhJob {
  id: number;
  title: string;
  location: { name: string };
  absolute_url: string;
  updated_at: string;
  content: string; // HTML
  company_name?: string;
  departments?: { name: string }[];
}

function matchesQuery(j: GhJob, q: JobSearchQuery): boolean {
  const needle = q.query.toLowerCase();
  if (!j.title.toLowerCase().includes(needle) && !j.content.toLowerCase().includes(needle)) {
    return false;
  }
  if (q.locations.length) {
    const haystack = j.location.name.toLowerCase();
    const anyMatch = q.locations.some((l) =>
      l === '' || haystack.includes(l.toLowerCase()) || l.toLowerCase() === 'remote' && /remote/.test(haystack)
    );
    if (!anyMatch) return false;
  }
  return true;
}

function mapGreenhouse(board: string, j: GhJob): JobPosting {
  return {
    id: `gh:${board}:${j.id}`,
    source: 'greenhouse',
    title: j.title,
    company: j.company_name || titleize(board),
    location: j.location.name,
    description: stripHtml(j.content),
    url: j.absolute_url,
    postedAt: j.updated_at,
    workMode: /remote/i.test(j.location.name) ? 'remote' : 'unknown',
    keywords: (j.departments ?? []).map((d) => d.name),
  };
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function titleize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
