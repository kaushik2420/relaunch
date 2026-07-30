import type { JobPosting } from '@/lib/types';

/**
 * Post-fetch title guardrail — drops obvious wrong-role postings before
 * they reach the ranker.
 *
 * Why this exists: job APIs fuzzy-match on tokens, so a "product manager"
 * search happily returns Product Marketing Manager, Project Manager,
 * Program Manager, Product Designer, etc. The ranker + LLM verifier are
 * supposed to catch these, but:
 *   - Ranker uses embeddings, and these titles ARE embedding-close
 *   - Verifier only runs on the top 25; ranks 26-50 slip into the
 *     long-tail dashboard pool with no filter.
 * A cheap deterministic title check upstream removes them for free.
 *
 * Rules format:
 *   - positive: at least one pattern must match (keeps only real roles
 *     for this family)
 *   - negative: any match is a hard reject (kills common false positives)
 *
 * The keys here are role-family ids from src/lib/role-families.ts. Only
 * families that empirically show noise get rules — everything else falls
 * through unchanged.
 */

interface TitleGuardRule {
  positive: RegExp[];
  negative: RegExp[];
}

const TITLE_GUARDS: Record<string, TitleGuardRule> = {
  // ------------- Product Management -------------
  product: {
    positive: [
      // Canonical: "Product Manager", "Sr Product Manager, X", etc.
      /\bproduct\s+(manager|management|owner|lead)\b/i,
      // Seniority-prefixed forms where "product" is the noun that follows
      /\b(associate|senior|sr\.?|staff|principal|group|lead|head|director|vp|chief)\s+product\s+(manager|owner|lead)\b/i,
      // Abbreviations used in ATS titles: APM, GPM, TPM, SPM as standalone tokens
      /\b(a|g|s|t)pm\b/i,
      /\bpm\s*[,\-–—]/i, // "PM, Growth" / "PM - Payments"
    ],
    negative: [
      // The single biggest source of noise — marketing role wearing "product"
      /\bproduct\s+marketing\b/i,
      /\bpmm\b/i,
      // Adjacent-but-wrong roles that share tokens
      /\bproduct\s+(designer|engineer|analyst|specialist|support|architect|consultant|coordinator|assistant)\b/i,
      /\bproject\s+manager\b/i,
      /\bprogram\s+manager\b/i,
      /\bportfolio\s+manager\b/i,
      // Retail / non-tech "product" roles
      /\bassistant\s+(store\s+)?manager\b/i,
      /\bcategory\s+manager\b/i,
      /\bbrand\s+manager\b/i,
      // Ops/HR that sometimes have "manager" high in title
      /\baccount\s+manager\b/i,
      /\bproperty\s+manager\b/i,
      /\bsales\s+manager\b/i,
    ],
  },
  // Alias to the same rules — user may have picked the more specific
  // growth/technical PM families but the same false positives apply.
  'growth-pm': {
    positive: [
      /\b(growth\s+)?product\s+(manager|owner|lead)\b/i,
      /\bgrowth\s+pm\b/i,
    ],
    negative: [
      /\bproduct\s+marketing\b/i,
      /\bproduct\s+(designer|engineer|analyst|specialist)\b/i,
      /\bproject\s+manager\b/i,
      /\bprogram\s+manager\b/i,
      /\bgrowth\s+marketing\b/i,
    ],
  },
  'technical-pm': {
    positive: [
      /\b(technical\s+)?product\s+(manager|owner|lead)\b/i,
      /\btpm\b/i,
    ],
    negative: [
      /\bproduct\s+marketing\b/i,
      /\bproduct\s+(designer|engineer|analyst|specialist)\b/i,
      /\bproject\s+manager\b/i,
      /\bprogram\s+manager\b/i,
    ],
  },
};

/**
 * Filter jobs by role-family title rules. Returns the input unchanged if
 * the role family has no configured guards (safe default — never over-
 * filters unfamiliar families).
 */
export function applyTitleGuard(
  jobs: JobPosting[],
  roleFamilyId: string | null | undefined,
): { kept: JobPosting[]; dropped: JobPosting[] } {
  if (!roleFamilyId) return { kept: jobs, dropped: [] };
  const rule = TITLE_GUARDS[roleFamilyId];
  if (!rule) return { kept: jobs, dropped: [] };

  const kept: JobPosting[] = [];
  const dropped: JobPosting[] = [];
  for (const j of jobs) {
    const title = j.title ?? '';
    const passesPositive = rule.positive.some((re) => re.test(title));
    const hitsNegative = rule.negative.some((re) => re.test(title));
    if (passesPositive && !hitsNegative) {
      kept.push(j);
    } else {
      dropped.push(j);
    }
  }
  return { kept, dropped };
}
