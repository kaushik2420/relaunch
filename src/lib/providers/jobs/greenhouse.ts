import { serverConfig } from '@/lib/config';
import type { JobPosting } from '@/lib/types';
import type { JobProvider, JobSearchQuery } from './types';
import { defaultGreenhouseBoards } from '@/lib/greenhouse-boards';

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
    // Env var wins if explicitly set (testing override). Otherwise use
    // the curated in-code list — that means Greenhouse "just works" without
    // any env setup.
    const envBoards = serverConfig().GREENHOUSE_BOARDS.split(',').map((s) => s.trim()).filter(Boolean);
    const boards = envBoards.length > 0 ? envBoards : defaultGreenhouseBoards();
    console.log(`[greenhouse] scanning ${boards.length} boards (source: ${envBoards.length ? 'env override' : 'curated default'})`);

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
  // Two-pass keyword match: if exact query doesn't hit, try role family
  // signal words (e.g. roleFamily=product → "product", "pm", "growth").
  // This way users with quirky resume titles still see real matches.
  const titleLower = j.title.toLowerCase();
  const contentLower = j.content.toLowerCase();
  const needle = q.query.toLowerCase();
  const exactHit = titleLower.includes(needle) || contentLower.includes(needle);
  const familyHit = q.roleFamily ? matchesFamily(titleLower, q.roleFamily) : false;
  if (!exactHit && !familyHit) return false;

  if (q.locations.length) {
    const haystack = j.location.name.toLowerCase();
    const anyMatch = q.locations.some(
      (l) =>
        l === '' ||
        haystack.includes(l.toLowerCase()) ||
        (l.toLowerCase() === 'remote' && /remote/.test(haystack)),
    );
    if (!anyMatch) return false;
  }
  return true;
}

/**
 * Family-keyword signals — what shows up in titles across boards.
 * Title-only check (cheap); content match would balloon the result set.
 */
function matchesFamily(titleLower: string, family: string): boolean {
  const signals: Record<string, string[]> = {
    engineering: ['engineer', 'developer', 'sde', 'software', 'backend', 'frontend', 'fullstack', 'platform', 'devops', 'sre', 'infrastructure', 'mobile', 'ios', 'android'],
    product: ['product manager', 'product owner', 'pm,', 'pm ', 'growth pm', 'principal product'],
    design: ['designer', 'ux', 'ui', 'product design', 'visual design'],
    data: ['data scientist', 'data analyst', 'data engineer', 'analytics', 'machine learning', 'ml ', 'ai ', 'mlops'],
    marketing: ['marketing', 'growth marketer', 'content', 'brand', 'demand gen', 'lifecycle'],
    operations: ['operations', 'ops', 'program manager', 'project manager', 'chief of staff'],
    sales: ['sales', 'account executive', 'ae,', 'sdr', 'bdr', 'revenue', 'business development'],
  };
  const list = signals[family] ?? [];
  return list.some((s) => titleLower.includes(s));
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
