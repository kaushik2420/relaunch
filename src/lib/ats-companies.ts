/**
 * Curated companies-per-ATS lists.
 *
 * Honest note: the first version of this file had a lot of guesses
 * about which Indian-tech companies use which ATS. Most of them turned
 * out to be wrong, which is why those providers were returning 0
 * matches. This pass replaces the speculative entries with slugs I'm
 * confident about, biased toward US/global tech companies with strong
 * India hiring (which tends to also surface India-located roles
 * because they keep one board across geographies).
 *
 * Each slug is what comes after the ATS's base URL — e.g. for
 * Lever's `jobs.lever.co/cred`, the slug is `cred`.
 *
 * If a board ever 404s or restructures, the provider just skips it
 * gracefully and logs the failure (see per-board logs in each
 * provider).
 *
 * Override at runtime via env vars (LEVER_BOARDS, WORKABLE_BOARDS,
 * SMARTRECRUITERS_BOARDS, RECRUITEE_BOARDS) — comma-separated slugs.
 * That's how you'd customise this list per your hiring focus without
 * editing code.
 */

/** Lever — `jobs.lever.co/<slug>`. */
export const defaultLeverBoards = (): string[] => [
  // Indian tech (verified)
  'razorpay',
  'browserstack',
  // Global with strong India presence
  'attentive',
  'figma',
  'github',
  'mixpanel',
  'segment',
  'netflix',
  'palantir',
  'eventbrite',
  'quora',
  'lever',
  'hashicorp',
  'plaid',
  'stitch-fix',
  'twitch',
  'shopify',
];

/** Workable — `apply.workable.com/<slug>/`. */
export const defaultWorkableBoards = (): string[] => [
  // Workable's customer base skews to small/mid startups. Hard to
  // hard-code Indian companies that consistently post here. Keeping
  // the list short + global; users can extend via env var.
  'spotify',
  'toptal',
  'remotebase',
  'persona',
  'workable',
];

/** SmartRecruiters — `api.smartrecruiters.com/v1/companies/<slug>/`. */
export const defaultSmartRecruitersBoards = (): string[] => [
  // SmartRecruiters customers tend to be larger enterprises; many
  // have significant India hiring.
  'McDonalds',
  'BoschGroup',
  'Visa',
  'IKEA',
  'PublicisGroupe',
  'Equinix',
  'AvanadeFranceSAS',
];

/** Recruitee — `<slug>.recruitee.com/`. */
export const defaultRecruiteeBoards = (): string[] => [
  // Recruitee skews European startups; Indian footprint is limited
  // but a few globals on it do hire here.
  'typeform',
  'getyourguide',
  'miro',
  'chargebee', // Indian SaaS, has Recruitee careers page
];
