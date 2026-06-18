import type { JobPosting } from '@/lib/types';
import type { AtsKey } from './ats-probe';
import { supabaseAdmin } from '@/lib/supabase/admin';

/**
 * Fetch jobs from every detected watched company for a single user.
 * Returns a flat JobPosting[] that the daily-runner merges into the
 * regular ranked pool BEFORE LLM verification.
 *
 * We don't keyword-filter here — the user explicitly chose to track
 * this company, so we want all their roles surfaced. The embedding
 * ranker + LLM verifier in the daily-runner are responsible for
 * pruning irrelevant ones (e.g. marketing roles for an engineer).
 */
export async function fetchWatchedCompanyJobs(userId: string): Promise<JobPosting[]> {
  const { data: companies } = await supabaseAdmin()
    .from('watched_companies')
    .select('name, ats, ats_slug')
    .eq('user_id', userId)
    .eq('detection_status', 'detected');

  if (!companies || companies.length === 0) return [];

  const all: JobPosting[] = [];
  await Promise.all(
    companies.map(async (c) => {
      const ats = c.ats as AtsKey | null;
      const slug = c.ats_slug as string | null;
      if (!ats || !slug) return;
      try {
        const jobs = await fetchOneAtsBoard(ats, slug, c.name as string);
        all.push(...jobs);
      } catch (err) {
        console.error(`[watched] fetch failed for ${c.name} via ${ats}`, err);
      }
    }),
  );
  console.log(
    `[watched] ${companies.length} companies → ${all.length} jobs pulled before ranking`,
  );
  return all;
}

/** One ATS board → JobPosting[]. Mirrors the per-board logic in the
 *  global provider files, kept lightweight here because we only want
 *  the raw listing (no per-provider keyword filter). */
async function fetchOneAtsBoard(
  ats: AtsKey,
  slug: string,
  companyName: string,
): Promise<JobPosting[]> {
  switch (ats) {
    case 'greenhouse': {
      const res = await fetch(
        `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(slug)}/jobs?content=true`,
        { next: { revalidate: 3600 } },
      );
      if (!res.ok) return [];
      const data: { jobs?: GhJob[] } = await res.json();
      return (data.jobs ?? []).map((j) => ({
        id: `gh:${slug}:${j.id}`,
        source: 'greenhouse',
        title: j.title,
        company: companyName,
        location: j.location?.name ?? 'Unknown',
        description: stripHtml(j.content ?? ''),
        url: j.absolute_url,
        postedAt: j.updated_at,
        workMode: /remote/i.test(j.location?.name ?? '') ? 'remote' : 'unknown',
        keywords: (j.departments ?? []).map((d) => d.name),
      }));
    }
    case 'lever': {
      const res = await fetch(
        `https://api.lever.co/v0/postings/${encodeURIComponent(slug)}?mode=json`,
        { next: { revalidate: 3600 } },
      );
      if (!res.ok) return [];
      const data: LeverJob[] = await res.json();
      return data.map((p) => ({
        id: `lever:${slug}:${p.id}`,
        source: 'lever',
        title: p.text,
        company: companyName,
        location: p.categories?.location ?? 'Unknown',
        description: p.descriptionPlain ?? stripHtml(p.description ?? ''),
        url: p.applyUrl ?? p.hostedUrl,
        postedAt: new Date(p.createdAt).toISOString(),
        workMode:
          p.workplaceType === 'remote'
            ? 'remote'
            : p.workplaceType === 'hybrid'
              ? 'hybrid'
              : 'unknown',
      }));
    }
    case 'workable': {
      const res = await fetch(
        `https://apply.workable.com/api/v3/accounts/${encodeURIComponent(slug)}/jobs?state=published`,
        { next: { revalidate: 3600 } },
      );
      if (!res.ok) return [];
      const data: { results?: WorkableJob[] } = await res.json();
      return (data.results ?? []).map((j) => ({
        id: `workable:${slug}:${j.shortcode}`,
        source: 'workable',
        title: j.title,
        company: companyName,
        location:
          [j.location?.city, j.location?.country].filter(Boolean).join(', ') ||
          'Unknown',
        description: stripHtml(j.description ?? ''),
        url:
          j.application_url ??
          `https://apply.workable.com/${slug}/j/${j.shortcode}`,
        postedAt: j.published_on ?? new Date().toISOString(),
        workMode: j.remote ? 'remote' : 'unknown',
      }));
    }
    case 'smartrecruiters': {
      const res = await fetch(
        `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(slug)}/postings?limit=100`,
        { next: { revalidate: 3600 } },
      );
      if (!res.ok) return [];
      const data: { content?: SmartRecJob[] } = await res.json();
      return (data.content ?? []).map((p) => ({
        id: `smartrec:${slug}:${p.id}`,
        source: 'smartrecruiters',
        title: p.name,
        company: companyName,
        location:
          [p.location?.city, p.location?.country].filter(Boolean).join(', ') ||
          'Unknown',
        description: stripHtml(p.jobAd?.sections?.jobDescription?.text ?? ''),
        url:
          p.applyUrl ??
          p.postingUrl ??
          `https://jobs.smartrecruiters.com/${slug}/${p.id}`,
        postedAt: p.releasedDate ?? new Date().toISOString(),
        workMode: p.location?.remote ? 'remote' : 'unknown',
      }));
    }
    case 'recruitee': {
      const res = await fetch(
        `https://${encodeURIComponent(slug)}.recruitee.com/api/offers/`,
        { next: { revalidate: 3600 } },
      );
      if (!res.ok) return [];
      const data: { offers?: RecruiteeOffer[] } = await res.json();
      return (data.offers ?? []).map((o) => ({
        id: `recruitee:${slug}:${o.id}`,
        source: 'recruitee',
        title: o.title,
        company: companyName,
        location: [o.city, o.country].filter(Boolean).join(', ') || 'Unknown',
        description: stripHtml(o.description ?? ''),
        url: o.careers_apply_url ?? o.careers_url ?? '',
        postedAt: o.created_at ?? new Date().toISOString(),
        workMode: o.remote ? 'remote' : o.hybrid ? 'hybrid' : 'unknown',
      }));
    }
    case 'ashby':
      // Ashby has no clean public listing endpoint we can query; we
      // detect via the careers page but don't iterate roles here.
      // TODO: GraphQL endpoint if/when it stabilises.
      return [];
  }
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Minimal shapes — we keep them local to avoid leaking ATS-specific
// types into the rest of the codebase.
interface GhJob {
  id: number;
  title: string;
  location: { name: string };
  absolute_url: string;
  updated_at: string;
  content: string;
  departments?: { name: string }[];
}
interface LeverJob {
  id: string;
  text: string;
  categories?: { location?: string };
  createdAt: number;
  hostedUrl: string;
  applyUrl?: string;
  descriptionPlain?: string;
  description?: string;
  workplaceType?: 'on-site' | 'remote' | 'hybrid';
}
interface WorkableJob {
  shortcode: string;
  title: string;
  description?: string;
  location?: { city?: string; country?: string };
  remote?: boolean;
  published_on?: string;
  application_url?: string;
}
interface SmartRecJob {
  id: string;
  name: string;
  jobAd?: { sections?: { jobDescription?: { text?: string } } };
  location?: { city?: string; country?: string; remote?: boolean };
  releasedDate?: string;
  applyUrl?: string;
  postingUrl?: string;
}
interface RecruiteeOffer {
  id: number;
  title: string;
  description?: string;
  city?: string;
  country?: string;
  remote?: boolean;
  hybrid?: boolean;
  created_at?: string;
  careers_url?: string;
  careers_apply_url?: string;
}
