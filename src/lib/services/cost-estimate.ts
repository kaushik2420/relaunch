/**
 * Rough cost model for running Relaunch.
 *
 * IMPORTANT: these are ESTIMATES. There is no single "credits" feed —
 * every provider bills separately in its own console. Use this for a
 * quick "am I within budget" read, and tune the rates below once you've
 * seen a few days of real usage on the Anthropic / Resend dashboards.
 *
 * To adjust: edit the numbers in COST_RATES and redeploy.
 */
export const COST_RATES = {
  /**
   * Average cost to fully tailor ONE job match — that's ~3 Claude calls:
   * resume tailoring + cover letter + InMail draft. Check your Anthropic
   * usage page and divide by the number of tailored matches.
   */
  perTailoredMatchUsd: 0.08,

  /** One-time resume parse when a new user onboards (~1 Claude call). */
  perResumeParseUsd: 0.03,

  /**
   * Per digest email. Resend's free tier covers 3,000 emails/month, so
   * for ~40 users this is effectively 0 until you outgrow the free tier.
   */
  perEmailUsd: 0,

  /**
   * Flat monthly cost you pay regardless of usage: Supabase, Vercel,
   * domain, and any job-search API subscriptions. Set this to your real
   * total once you know it (e.g. Supabase Pro 25 + Vercel Pro 20 = 45).
   */
  fixedMonthlyUsd: 0,
};

export interface CostInputs {
  activeUsers: number;
  tailoredMatches: number; // sum of jobs_emailed across runs in the window
  emails: number; // runs that sent a digest
  newUsers: number; // users created in the window
  /** Actual (not estimated) spend on the OpenAI web-search provider,
   *  summed from openai_websearch_calls.cost_estimate_usd. Populated
   *  by /admin from a Postgres query. */
  openaiWebSearchUsd?: number;
}

export interface CostEstimate {
  llmCost: number;
  parseCost: number;
  emailCost: number;
  openaiWebSearchCost: number;
  variableCost: number;
  fixedMonthly: number;
  monthlyBurn: number;
  perActiveUser: number;
  projectedAt40: number;
}

/** Estimate ~monthly cost from the last ~30 days of activity. */
export function estimateMonthlyCost(i: CostInputs): CostEstimate {
  const r = COST_RATES;
  const llmCost = i.tailoredMatches * r.perTailoredMatchUsd;
  const parseCost = i.newUsers * r.perResumeParseUsd;
  const emailCost = i.emails * r.perEmailUsd;
  const openaiWebSearchCost = i.openaiWebSearchUsd ?? 0;
  const variableCost = llmCost + parseCost + emailCost + openaiWebSearchCost;
  const monthlyBurn = variableCost + r.fixedMonthlyUsd;
  const perActiveUser = i.activeUsers > 0 ? variableCost / i.activeUsers : 0;
  const projectedAt40 = perActiveUser * 40 + r.fixedMonthlyUsd;
  return {
    llmCost,
    parseCost,
    emailCost,
    openaiWebSearchCost,
    variableCost,
    fixedMonthly: r.fixedMonthlyUsd,
    monthlyBurn,
    perActiveUser,
    projectedAt40,
  };
}
