import { supabaseAdmin } from '@/lib/supabase/admin';
import { runDailyForUser, type UserRow } from './daily-runner';

/**
 * Admin-triggered "run daily for everyone RIGHT NOW", regardless of the
 * per-user email_time / frequency / timezone gates.
 *
 * Purpose: recover from incidents. If the Anthropic key runs dry, Resend
 * has an outage, or a bug crashes the cron for a day, the operator hits
 * this to backfill the day's digest for every impacted user without
 * waiting for the next natural cron fire.
 *
 * Default mode ("missed only"): skip any user who already has a
 * successful (status='ok') job_run today. Idempotent — safe to hit
 * repeatedly without spamming users. Failed/absent runs get retried.
 *
 * Force mode: process everyone regardless. Use sparingly.
 *
 * Concurrency: PARALLEL is intentionally low (default 5). Every user's
 * run fires ~30 LLM calls + a Resend send + a Google Sheets write, and
 * we don't want a burst to trip provider rate limits on the same key.
 */

const PARALLEL = 5;

export interface BackfillSummary {
  considered: number;
  skipped: number;
  attempted: number;
  succeeded: number;
  failed: number;
  elapsedMs: number;
  failures: { userId: string; email: string; error: string }[];
  skippedUserIds: string[];
}

export async function runDailyForAllUsers(opts?: {
  force?: boolean;
}): Promise<BackfillSummary> {
  const force = opts?.force === true;
  const start = Date.now();
  const admin = supabaseAdmin();

  // 1. Pull every user who could plausibly receive a digest today.
  //    Same shape the cron uses in pickUsersForThisHour, but without
  //    the timezone-hour and frequency-cadence filters — this is a
  //    manual override.
  const { data: userData, error } = await admin
    .from('users')
    .select(
      'id, email, first_name, profile, locations, work_modes, target_ctc, phone, notice_period, notes, email_frequency, email_time, timezone, google_refresh_token_enc, user_sheet_id, last_run_at, free_until, is_paying, role_family, pivot_enabled, pivot_brief, search_query',
    )
    .eq('is_active', true)
    .neq('email_frequency', 'paused');
  if (error) throw error;

  const nowIso = new Date().toISOString();
  const eligible = (userData ?? []).filter((u) => {
    if (!u.profile || Object.keys(u.profile as object).length === 0) return false;
    if (!u.is_paying && new Date(u.free_until).getTime() < Date.now()) return false;
    return true;
  }) as UserRow[];

  // 2. "Missed only" filter — skip users who already got today's mail.
  //    A row with status='ok' AND jobs_emailed>0 today = we already
  //    delivered. Anything else (partial / error / absent) means retry.
  const skippedUserIds: string[] = [];
  let targets = eligible;
  if (!force) {
    const startOfToday = new Date();
    startOfToday.setUTCHours(0, 0, 0, 0);
    const { data: successRows } = await admin
      .from('job_runs')
      .select('user_id')
      .gte('run_at', startOfToday.toISOString())
      .eq('status', 'ok')
      .gt('jobs_emailed', 0);
    const alreadyDone = new Set(
      (successRows ?? []).map((r) => r.user_id as string),
    );
    targets = eligible.filter((u) => {
      if (alreadyDone.has(u.id)) {
        skippedUserIds.push(u.id);
        return false;
      }
      return true;
    });
  }

  // 3. Process in bounded-concurrency chunks so we don't burst LLM APIs.
  const failures: BackfillSummary['failures'] = [];
  let succeeded = 0;
  let failed = 0;

  for (let i = 0; i < targets.length; i += PARALLEL) {
    const chunk = targets.slice(i, i + PARALLEL);
    const results = await Promise.allSettled(
      chunk.map(async (u) => {
        const runStart = Date.now();
        try {
          const { matchesFound, emailed } = await runDailyForUser(u);
          await admin.from('job_runs').insert({
            user_id: u.id,
            jobs_found: matchesFound,
            jobs_emailed: emailed,
            status: emailed === 0 ? 'partial' : 'ok',
            duration_ms: Date.now() - runStart,
          });
          await admin
            .from('users')
            .update({ last_run_at: new Date().toISOString() })
            .eq('id', u.id);
          return { ok: true as const, u };
        } catch (err) {
          await admin.from('job_runs').insert({
            user_id: u.id,
            status: 'error',
            error: (err as Error).message,
            duration_ms: Date.now() - runStart,
          });
          return {
            ok: false as const,
            u,
            error: (err as Error).message,
          };
        }
      }),
    );
    for (const r of results) {
      if (r.status === 'fulfilled') {
        if (r.value.ok) {
          succeeded++;
        } else {
          failed++;
          failures.push({
            userId: r.value.u.id,
            email: r.value.u.email,
            error: r.value.error,
          });
        }
      } else {
        // Unexpected — the inner try/catch should have caught everything.
        failed++;
        failures.push({
          userId: 'unknown',
          email: 'unknown',
          error: (r.reason as Error).message,
        });
      }
    }
  }

  return {
    considered: eligible.length,
    skipped: skippedUserIds.length,
    attempted: targets.length,
    succeeded,
    failed,
    elapsedMs: Date.now() - start,
    failures,
    skippedUserIds,
  };
}
