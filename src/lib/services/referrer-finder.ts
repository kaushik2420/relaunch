import type { Referrer, UserProfile, JobPosting } from '@/lib/types';

/**
 * Find 1–2 people at the target company who could potentially help the
 * user get noticed. Uses Proxycurl's Person Search API.
 *
 * Setup:
 *   1. Sign up at https://nubela.co/proxycurl
 *   2. Add a $5 credit pack (gives ~1000 lookups @ $0.005 each)
 *   3. Copy your API key from dashboard
 *   4. Set env: PROXYCURL_API_KEY=<your-key>
 *   5. Redeploy. Done — referrers will start showing up in the daily Sheet.
 *
 * Falls back gracefully (returns []) if no key is set, so the rest of
 * the pipeline keeps working.
 *
 * https://nubela.co/proxycurl/docs#people-api-person-search-endpoint
 */
export async function findReferrers(input: {
  profile: UserProfile;
  job: JobPosting;
  limit?: number;
}): Promise<Referrer[]> {
  const apiKey = process.env.PROXYCURL_API_KEY;
  if (!apiKey) return [];

  const { profile, job, limit = 2 } = input;

  // Build a search: people at the target company in roles related to the JD
  // We avoid asking for the candidate's exact title — we want hiring managers
  // and engineers one level above the target, who are more likely to help.
  const titleHint = inferTargetReferrerTitle(profile, job);
  const params = new URLSearchParams({
    page_size: String(Math.min(limit * 3, 10)), // overfetch + filter
    current_company_name: job.company,
    current_role_title: titleHint,
    enrich_profiles: 'enrich',
  });

  try {
    const res = await fetch(`https://nubela.co/proxycurl/api/v2/search/person/?${params}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      // Same lookup is fine to cache for a few days
      next: { revalidate: 86400 },
    });
    if (!res.ok) return [];

    const json: { results?: ProxycurlSearchResult[] } = await res.json();
    const results = (json.results ?? []).slice(0, limit);

    return results.map((r): Referrer => {
      const p = r.profile ?? {};
      return {
        name: p.full_name || r.profile_name || 'Someone at the company',
        role: p.occupation || titleHint,
        linkedinUrl: r.linkedin_profile_url || undefined,
        sharedContext: deriveSharedContext(profile, p),
      };
    });
  } catch {
    return [];
  }
}

function inferTargetReferrerTitle(profile: UserProfile, job: JobPosting): string {
  const title = job.title.toLowerCase();
  // Aim one level above for engineers / PMs / designers
  if (/principal|staff|head|director|vp/i.test(profile.seniority)) return 'Director';
  if (/senior/i.test(profile.seniority)) return 'Engineering Manager';
  if (/engineer|developer/.test(title)) return 'Senior Engineer';
  if (/product manager|pm\b/.test(title)) return 'Senior Product Manager';
  if (/designer/.test(title)) return 'Senior Designer';
  return 'Senior';
}

interface ProxycurlPersonProfile {
  full_name?: string;
  occupation?: string;
  experiences?: { company?: string; title?: string; starts_at?: { year?: number } }[];
  education?: { school?: string }[];
  city?: string;
}

interface ProxycurlSearchResult {
  linkedin_profile_url?: string;
  profile_name?: string;
  profile?: ProxycurlPersonProfile;
}

/**
 * Look for a shared signal the user can lead the InMail with — same
 * past employer, same school, same city. Returns undefined if nothing
 * compelling is found (better to lead with the role than a weak link).
 */
function deriveSharedContext(profile: UserProfile, p: ProxycurlPersonProfile): string | undefined {
  // Same past company
  const userCompanies = new Set(profile.experience?.map((e) => e.company.toLowerCase()) ?? []);
  const theirCompanies = (p.experiences ?? []).map((e) => e.company?.toLowerCase()).filter(Boolean) as string[];
  for (const c of theirCompanies) {
    if (userCompanies.has(c)) {
      return `Both worked at ${capitalize(c)}`;
    }
  }
  // Same school
  const userSchools = new Set(profile.education?.map((e) => e.school.toLowerCase()) ?? []);
  for (const e of p.education ?? []) {
    if (e.school && userSchools.has(e.school.toLowerCase())) {
      return `Both studied at ${e.school}`;
    }
  }
  // Same city
  if (p.city && profile.location && p.city.toLowerCase() === profile.location.toLowerCase()) {
    return `Both based in ${p.city}`;
  }
  return undefined;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
