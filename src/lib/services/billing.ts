import { serverConfig } from '@/lib/config';
import { supabaseAdmin } from '@/lib/supabase/admin';

/**
 * Centralized billing/cohort logic. The trigger handles signup_position
 * assignment, but everything else (eligibility, trial state, capacity)
 * routes through here so a single change re-tunes the rollout.
 */

export type CohortState =
  | { state: 'open'; cohort: 'founder' | 'early'; trialDays: number }
  | { state: 'waitlist' };

/**
 * Decide what to do with a brand-new signup attempt BEFORE writing the row.
 * Reads cohort_counts (server-only) to enforce TOTAL_CAP.
 */
export async function evaluateCohortCapacity(): Promise<CohortState> {
  const cfg = serverConfig();
  const { data, error } = await supabaseAdmin().from('cohort_counts').select('*').single();
  if (error) throw error;
  const total = (data?.total_count ?? 0) as number;
  if (total >= cfg.TOTAL_CAP) return { state: 'waitlist' };
  const cohort = total < cfg.FOUNDER_CAP ? 'founder' : 'early';
  const trialDays = cohort === 'founder' ? cfg.FREE_TRIAL_FOUNDER_DAYS : cfg.FREE_TRIAL_DEFAULT_DAYS;
  return { state: 'open', cohort, trialDays };
}

export interface TrialStatus {
  isPaying: boolean;
  freeUntil: Date;
  daysLeft: number;
  status: 'trial-active' | 'trial-expiring' | 'trial-expired' | 'paying' | 'inactive';
}

export function evaluateTrial(user: { is_paying: boolean; free_until: string }): TrialStatus {
  if (user.is_paying) {
    return { isPaying: true, freeUntil: new Date(user.free_until), daysLeft: 0, status: 'paying' };
  }
  const freeUntil = new Date(user.free_until);
  const now = new Date();
  const daysLeft = Math.ceil((freeUntil.getTime() - now.getTime()) / 86_400_000);
  let status: TrialStatus['status'];
  if (daysLeft <= 0) status = 'trial-expired';
  else if (daysLeft <= 3) status = 'trial-expiring';
  else status = 'trial-active';
  return { isPaying: false, freeUntil, daysLeft: Math.max(daysLeft, 0), status };
}

export function priceLabel(): string {
  return `₹${serverConfig().MONTHLY_PRICE_INR}/month`;
}
