/**
 * Curated list of companies that publish their careers page on Greenhouse.
 *
 * Why this isn't an env var: Greenhouse has no global search API, so we
 * have to know each company's slug ahead of time. Hard-coding the list
 * in version control gives us:
 *   - useful defaults out of the box (no env setup required)
 *   - reviewable changes via PRs
 *   - the ability to add new companies as we spot them
 *
 * Override behaviour: if the GREENHOUSE_BOARDS env var is set, that
 * value WINS — handy for testing a narrow subset or pinning to a
 * single board. Empty env var → use this full list.
 *
 * Each slug must match the URL at https://boards.greenhouse.io/<slug>.
 * To verify a company is on Greenhouse: visit their /careers page and
 * see if it redirects to boards.greenhouse.io.
 *
 * Adding: keep grouped by category so PR diffs are scannable.
 * Last reviewed: 2026-05.
 */

export const GREENHOUSE_BOARDS_BY_CATEGORY: Record<string, string[]> = {
  // ---------- AI / ML ----------
  'AI & ML': [
    'anthropic',
    'openai',
    'scaleai',
    'perplexity',
    'cohere',
    'huggingface',
    'mistralai',
    'replit',
    'runway',
  ],

  // ---------- Developer tools / infra ----------
  'Developer Tools': [
    'vercel',
    'supabase',
    'linear',
    'notion',
    'figma',
    'sentry',
    'retool',
    'segment',
    'cloudflare',
    'datadog',
    'mongodb',
    'gitlab',
    'redis',
    'pinecone',
    'replicate',
    'temporal',
    'browserbase',
  ],

  // ---------- Fintech ----------
  'Fintech': [
    'stripe',
    'plaid',
    'robinhood',
    'coinbase',
    'wise',
    'brex',
    'mercury',
    'ramp',
    'chime',
    'razorpay',
    'cred',
    'navi',
    'jupiter',
  ],

  // ---------- Consumer / marketplace ----------
  'Consumer': [
    'airbnb',
    'doordash',
    'instacart',
    'pinterest',
    'reddit',
    'discord',
    'duolingo',
    'canva',
    'snap',
    'spotify',
    'roblox',
    'opensea',
    'lyft',
  ],

  // ---------- Enterprise / SaaS ----------
  'Enterprise SaaS': [
    'databricks',
    'snowflake',
    'gusto',
    'asana',
    'box',
    'twilio',
    'pagerduty',
    'okta',
    'auth0',
    'rippling',
    'attentive',
  ],

  // ---------- India tech ----------
  'India Tech': [
    'razorpay',  // dup of fintech — keeping for category clarity
    'cred',
    'navi',
    'swiggy',
    'zomato',
    'meesho',
    'unacademy',
    'jupiter',
    'phonepe',
    'flipkart',
  ],
};

/**
 * Flat, de-duplicated list of all Greenhouse slugs we know about.
 * This is what `GreenhouseProvider.search()` actually iterates.
 */
export function defaultGreenhouseBoards(): string[] {
  const seen = new Set<string>();
  for (const list of Object.values(GREENHOUSE_BOARDS_BY_CATEGORY)) {
    for (const slug of list) {
      seen.add(slug.toLowerCase());
    }
  }
  return [...seen];
}
