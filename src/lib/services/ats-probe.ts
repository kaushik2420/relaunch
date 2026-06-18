/**
 * Given a company name like "Stripe", figure out which ATS hosts
 * their careers page and what the slug is. We try the 6 ATSes we
 * support, in parallel, with a few slug variations per ATS.
 *
 * The winner is the ATS whose probe returned the most active
 * postings. Ties broken by ATS preference (Greenhouse → Lever →
 * Ashby → Workable → SmartRecruiters → Recruitee).
 */

export type AtsKey =
  | 'greenhouse'
  | 'lever'
  | 'ashby'
  | 'workable'
  | 'smartrecruiters'
  | 'recruitee';

export interface AtsProbeResult {
  ats: AtsKey;
  slug: string;
  jobCount: number;
}

/** Normalise a company name into candidate slugs to try. */
function slugCandidates(name: string): string[] {
  const trimmed = name.trim();
  const lower = trimmed.toLowerCase();
  const compact = lower.replace(/\s+/g, '');
  const hyphen = lower.replace(/\s+/g, '-');
  const noInc = compact.replace(/(?:inc|llc|ltd|corp|co)$/, '');
  return Array.from(
    new Set([compact, hyphen, noInc, trimmed, trimmed.replace(/\s+/g, '')]),
  ).filter(Boolean);
}

async function tryEndpoint(url: string): Promise<number> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(5000),
      next: { revalidate: 86400 }, // 1 day cache — slugs don't churn
    });
    if (!res.ok) return -1;
    const data: unknown = await res.json();
    // Each ATS uses a different shape; count whatever's there.
    if (Array.isArray((data as { jobs?: unknown[] })?.jobs)) {
      return (data as { jobs: unknown[] }).jobs.length;
    }
    if (Array.isArray((data as { results?: unknown[] })?.results)) {
      return (data as { results: unknown[] }).results.length;
    }
    if (Array.isArray((data as { content?: unknown[] })?.content)) {
      return (data as { content: unknown[] }).content.length;
    }
    if (Array.isArray((data as { offers?: unknown[] })?.offers)) {
      return (data as { offers: unknown[] }).offers.length;
    }
    if (Array.isArray(data)) return data.length; // Lever returns top-level array
    return -1;
  } catch {
    return -1;
  }
}

async function probeAts(
  ats: AtsKey,
  slug: string,
): Promise<{ ats: AtsKey; slug: string; jobCount: number } | null> {
  let url: string;
  switch (ats) {
    case 'greenhouse':
      url = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(slug)}/jobs`;
      break;
    case 'lever':
      url = `https://api.lever.co/v0/postings/${encodeURIComponent(slug)}?mode=json`;
      break;
    case 'workable':
      url = `https://apply.workable.com/api/v3/accounts/${encodeURIComponent(slug)}/jobs?state=published`;
      break;
    case 'smartrecruiters':
      url = `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(slug)}/postings?limit=10`;
      break;
    case 'recruitee':
      url = `https://${encodeURIComponent(slug)}.recruitee.com/api/offers/`;
      break;
    case 'ashby':
      // Ashby doesn't have a clean public listing endpoint; we just
      // check if the jobs page renders at all.
      url = `https://jobs.ashbyhq.com/${encodeURIComponent(slug)}`;
      break;
  }
  const count = await tryEndpoint(url);
  if (count <= 0) return null;
  return { ats, slug, jobCount: count };
}

const ATS_PREFERENCE: AtsKey[] = [
  'greenhouse',
  'lever',
  'ashby',
  'workable',
  'smartrecruiters',
  'recruitee',
];

/**
 * Run all probes in parallel and pick the winner. Returns null when
 * no ATS recognises the company across any slug variation.
 */
export async function probeCompany(
  companyName: string,
): Promise<AtsProbeResult | null> {
  const slugs = slugCandidates(companyName);
  const promises: Promise<{ ats: AtsKey; slug: string; jobCount: number } | null>[] = [];
  for (const ats of ATS_PREFERENCE) {
    for (const slug of slugs) {
      promises.push(probeAts(ats, slug));
    }
  }

  const results = await Promise.all(promises);
  const hits = results.filter((r): r is AtsProbeResult => r !== null);
  if (hits.length === 0) return null;

  // Sort by jobCount desc, then by ATS preference order. A company
  // that scores 30 jobs on Lever beats one that scores 5 on Greenhouse.
  hits.sort((a, b) => {
    if (b.jobCount !== a.jobCount) return b.jobCount - a.jobCount;
    return ATS_PREFERENCE.indexOf(a.ats) - ATS_PREFERENCE.indexOf(b.ats);
  });
  return hits[0] ?? null;
}
