import type { JobPosting } from '@/lib/types';

/**
 * Build a LinkedIn people-search URL that opens the user's
 * **2nd-degree connections** at the target company, filtered by a title
 * keyword guess. This is our default "find a referrer" experience — no
 * API cost, no data sharing, and the user sees their actual network.
 *
 * Why not Proxycurl/Apollo: those APIs run $0.005–0.05 per lookup, which
 * scales linearly with users. At 500 users that's $750/mo just to show
 * names. The deep-link gives the user MORE useful info (their actual
 * 2nd-degree network, not strangers) at $0 cost.
 *
 * When the user clicks this in the Sheet, LinkedIn opens in a new tab.
 * If they're logged in, they see 2nd-degree connections at the company.
 * If they're not, they see a generic people search and can filter further.
 */
export function buildConnectionsSearchUrl(input: {
  company: string;
  title: string;
}): string {
  const titleKeywords = inferReferrerTitleKeywords(input.title);
  // LinkedIn's people-search accepts keywords + network filter
  // network=["S"] → 2nd-degree only (1st = "F"). We omit "F" because if
  // they already have 1st-degree contacts they'd probably reach out directly.
  const keywords = `${input.company} ${titleKeywords}`;
  const url = new URL('https://www.linkedin.com/search/results/people/');
  url.searchParams.set('keywords', keywords);
  url.searchParams.set('network', '["S"]');
  url.searchParams.set('origin', 'FACETED_SEARCH');
  return url.toString();
}

/**
 * Map the job title to one or two referrer titles. We aim ~one level
 * UP from the candidate's likely target (Director if they're applying for
 * Senior, Hiring Manager if they're applying as IC, etc.) because that's
 * who can actually move a referral.
 */
function inferReferrerTitleKeywords(targetTitle: string): string {
  const t = targetTitle.toLowerCase();
  if (/principal|staff|head|director|vp/.test(t)) {
    return 'VP OR Director';
  }
  if (/senior|sr\b/.test(t)) {
    return '"Engineering Manager" OR Director';
  }
  if (/manager|lead/.test(t)) {
    return 'Director OR "Senior Manager"';
  }
  if (/engineer|developer/.test(t)) {
    return '"Engineering Manager" OR "Senior Engineer"';
  }
  if (/product manager|pm\b/.test(t)) {
    return '"Senior Product Manager" OR "Director of Product"';
  }
  if (/designer/.test(t)) {
    return '"Design Manager" OR "Senior Designer"';
  }
  return 'Manager OR Director';
}

/**
 * Legacy signature kept for backwards compatibility — returns an empty
 * array since we no longer hit a paid API. If you later want to wire
 * Proxycurl, Apollo, or LinkedIn OAuth, return real Referrer[] here and
 * the rest of the pipeline picks them up automatically.
 */
export async function findReferrers(_input: {
  profile: unknown;
  job: JobPosting;
  limit?: number;
}): Promise<[]> {
  return [];
}
