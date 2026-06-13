/**
 * Curated list of companies that expose public ATS boards we can query
 * directly (free, no auth). Grouped by which ATS each company uses.
 *
 * The slug is what goes into the ATS's URL — these were verified by
 * checking each company's "careers" page. If a board ever moves or
 * disappears, the provider gracefully skips it.
 *
 * To add a new company: figure out their ATS from the URL when you
 * click "Apply" on a posting on their site, then add the slug here.
 *
 * Override at runtime via env vars (LEVER_BOARDS, WORKABLE_BOARDS,
 * SMARTRECRUITERS_BOARDS, RECRUITEE_BOARDS) — useful for testing.
 */

/** Lever — slug is what comes after jobs.lever.co/ in the URL. */
export const defaultLeverBoards = (): string[] => [
  // Indian ecosystem
  'cred',
  'razorpay',
  'setu',
  'innovaccer',
  'grofers',
  'browserstack',
  // Global tech with Indian openings
  'palantir',
  'attentive',
  'netflix',
  'figma',
  'github',
  'mixpanel',
  'segment',
];

/** Workable — slug is from apply.workable.com/<slug>/ */
export const defaultWorkableBoards = (): string[] => [
  // Indian ecosystem
  'curve-tomorrow',
  'klub',
  'gradeup',
  'wingify',
  // Global with India hires
  'remotebase',
  'toptal',
  'spotify',
];

/** SmartRecruiters — slug is the company-id in api.smartrecruiters.com/v1/companies/<slug>/postings */
export const defaultSmartRecruitersBoards = (): string[] => [
  'McDonalds',
  'BoschGroup',
  'Visa',
  'Atos',
  'AccentureIndia',
  'Wipro',
  'Capgemini',
];

/** Recruitee — slug is the subdomain in <slug>.recruitee.com */
export const defaultRecruiteeBoards = (): string[] => [
  // Indian ecosystem
  'turing',
  'springworks',
  'plivo',
  'chargebee',
  // Global with India hires
  'getyourguide',
  'typeform',
];
