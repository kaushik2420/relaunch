import { NextResponse, type NextRequest } from 'next/server';
import { createSupabaseServer } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { serverConfig } from '@/lib/config';
import { pickUsersForThisHour } from '@/lib/services/daily-runner';

export const runtime = 'nodejs';
export const maxDuration = 30;

/**
 * Cron + email diagnostic. Admin-only.
 *
 * Returns everything you need to answer "why haven't the 8 AM emails
 * been going out?" without digging through Vercel logs:
 *
 *   - env: which secrets are set (RESEND_API_KEY, CRON_SECRET, FROM_EMAIL)
 *   - jobRuns: last 7 days of job_runs bucketed by day + status.
 *     If a day shows 0 rows, the cron didn't fire that day. If it
 *     shows all 'error', runDailyForUser is throwing. If it shows
 *     all 'partial', matching returns 0 or send is failing.
 *   - lastErrors: the 10 most recent error messages from job_runs.
 *   - userPool: what pickUsersForThisHour would return right now,
 *     plus the reason each excluded user was skipped.
 *   - schemaCheck: probes the tables the daily-runner touches to
 *     confirm they exist (catches PGRST205 issues like the missing
 *     user_sessions migration).
 *
 * Usage (browser or curl):
 *   GET /api/admin/cron-diagnostic
 *   or with x-cron-secret header for terminal access.
 */
export async function GET(req: NextRequest) {
  const cfg = serverConfig();

  // Auth: admin session OR x-cron-secret header
  const cronSecret = req.headers.get('x-cron-secret') ?? '';
  const bearer = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  const hasCronAuth =
    (cronSecret && cronSecret === cfg.CRON_SECRET) ||
    (bearer && bearer === cfg.CRON_SECRET);

  if (!hasCronAuth) {
    const sb = createSupabaseServer();
    const { data: { user } } = await sb.auth.getUser();
    if (!user) {
      return NextResponse.json({
        error: 'not signed in',
        hint: 'Sign into Relaunch as admin, or pass `x-cron-secret: <CRON_SECRET>` header.',
      }, { status: 401 });
    }
    if ((user.email ?? '').toLowerCase() !== cfg.ADMIN_EMAIL.toLowerCase()) {
      return NextResponse.json({
        error: 'admin only',
        signedInAs: user.email,
        expectedAdmin: cfg.ADMIN_EMAIL,
      }, { status: 403 });
    }
  }

  const admin = supabaseAdmin();

  // 1. Env-var health check — most email failures trace back here.
  const env = {
    RESEND_API_KEY: Boolean(cfg.RESEND_API_KEY),
    RESEND_API_KEY_prefix: cfg.RESEND_API_KEY ? cfg.RESEND_API_KEY.slice(0, 6) + '…' : null,
    FROM_EMAIL: cfg.FROM_EMAIL,
    CRON_SECRET_set: Boolean(cfg.CRON_SECRET),
    ANTHROPIC_API_KEY: Boolean(cfg.ANTHROPIC_API_KEY),
    ADMIN_EMAIL: cfg.ADMIN_EMAIL,
    EMAIL_PROVIDER: cfg.EMAIL_PROVIDER,
    JOB_PROVIDERS: cfg.JOB_PROVIDERS,
  };

  // 2. Schema check — probe the tables daily-runner writes to.
  const schemaCheck = await runSchemaProbe(admin);

  // 3. Last 7 days of job_runs bucketed
  const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const { data: runRows, error: runsErr } = await admin
    .from('job_runs')
    .select('run_at, status, jobs_emailed, error')
    .gte('run_at', sevenDaysAgo)
    .order('run_at', { ascending: false });

  const jobRunsByDay: Record<string, { total: number; ok: number; partial: number; error: number; emailed: number }> = {};
  for (const r of runRows ?? []) {
    const day = (r.run_at as string).slice(0, 10);
    const b = jobRunsByDay[day] ??= { total: 0, ok: 0, partial: 0, error: 0, emailed: 0 };
    b.total++;
    if (r.status === 'ok') b.ok++;
    else if (r.status === 'partial') b.partial++;
    else if (r.status === 'error') b.error++;
    b.emailed += r.jobs_emailed ?? 0;
  }

  const lastErrors = (runRows ?? [])
    .filter((r) => r.status === 'error' && r.error)
    .slice(0, 10)
    .map((r) => ({ at: r.run_at, error: r.error }));

  // 4. Who would pickUsersForThisHour return right NOW?
  let userPool: { pickedNow: number; sampleIds: string[]; error?: string } = { pickedNow: 0, sampleIds: [] };
  try {
    const now = new Date();
    const picked = await pickUsersForThisHour(now);
    userPool = { pickedNow: picked.length, sampleIds: picked.slice(0, 5).map((u) => u.id) };
  } catch (err) {
    userPool = { pickedNow: 0, sampleIds: [], error: (err as Error).message };
  }

  // 5. User-side sanity: how many active users have a profile, how
  // many are trial-expired, how many are paused.
  const { count: totalActive } = await admin
    .from('users')
    .select('id', { count: 'exact', head: true })
    .eq('is_active', true);
  const { count: paused } = await admin
    .from('users')
    .select('id', { count: 'exact', head: true })
    .eq('is_active', true)
    .eq('email_frequency', 'paused');
  const { count: noProfile } = await admin
    .from('users')
    .select('id', { count: 'exact', head: true })
    .eq('is_active', true)
    .is('profile', null);
  const nowIso = new Date().toISOString();
  const { count: trialExpired } = await admin
    .from('users')
    .select('id', { count: 'exact', head: true })
    .eq('is_active', true)
    .eq('is_paying', false)
    .lt('free_until', nowIso);

  return NextResponse.json({
    now: new Date().toISOString(),
    env,
    schemaCheck,
    users: {
      totalActive: totalActive ?? 0,
      paused: paused ?? 0,
      noProfile: noProfile ?? 0,
      trialExpired: trialExpired ?? 0,
    },
    userPool,
    jobRunsByDay,
    lastErrors,
    runsError: runsErr?.message ?? null,
    verdict: diagnose({
      env,
      schemaCheck,
      jobRunsByDay,
      lastErrors,
      userPool,
      users: {
        totalActive: totalActive ?? 0,
        paused: paused ?? 0,
        noProfile: noProfile ?? 0,
        trialExpired: trialExpired ?? 0,
      },
    }),
  });
}

interface ProbeResult {
  ok: boolean;
  error?: string;
}

async function runSchemaProbe(admin: ReturnType<typeof supabaseAdmin>): Promise<Record<string, ProbeResult>> {
  const tables = ['users', 'job_runs', 'job_matches', 'user_sessions', 'polish_sessions'];
  const out: Record<string, ProbeResult> = {};
  for (const t of tables) {
    const { error } = await admin.from(t).select('*', { count: 'exact', head: true });
    out[t] = error ? { ok: false, error: error.message } : { ok: true };
  }
  return out;
}

function diagnose(x: {
  env: { RESEND_API_KEY: boolean; FROM_EMAIL: string; CRON_SECRET_set: boolean };
  schemaCheck: Record<string, ProbeResult>;
  jobRunsByDay: Record<string, { total: number; ok: number; error: number; emailed: number }>;
  lastErrors: { at: string; error: string | null }[];
  userPool: { pickedNow: number; error?: string };
  users: { totalActive: number; paused: number; noProfile: number; trialExpired: number };
}): string {
  if (!x.env.CRON_SECRET_set) {
    return 'CRON_SECRET missing — Vercel Cron calls are rejected at /api/cron/daily and never run.';
  }
  if (!x.env.RESEND_API_KEY) {
    return 'RESEND_API_KEY missing — the send step in runDailyForUser throws for every user.';
  }
  if (!x.env.FROM_EMAIL.endsWith('@get-relaunch.com')) {
    return `FROM_EMAIL is "${x.env.FROM_EMAIL}" — must be @get-relaunch.com (the domain verified in Resend), else Resend 400s every send.`;
  }
  for (const [t, r] of Object.entries(x.schemaCheck)) {
    if (!r.ok) {
      return `Schema probe failed for public.${t}: ${r.error}. That migration hasn't been applied to production Supabase — apply it in the SQL editor.`;
    }
  }
  const days = Object.keys(x.jobRunsByDay).sort();
  const totalRuns7d = Object.values(x.jobRunsByDay).reduce((s, b) => s + b.total, 0);
  const totalEmailed7d = Object.values(x.jobRunsByDay).reduce((s, b) => s + b.emailed, 0);
  const totalErrors7d = Object.values(x.jobRunsByDay).reduce((s, b) => s + b.error, 0);
  if (totalRuns7d === 0) {
    return `No job_runs rows in the last 7 days. Either the Vercel Cron is disabled/misconfigured, or the daily route is returning 401 on every call. Check vercel.json + Vercel dashboard → Settings → Cron Jobs.`;
  }
  if (days.length < 5) {
    return `Only ${days.length} distinct days in the last 7 have job_runs entries (${days.join(', ')}). Cron was down on the missing days — check Vercel dashboard for cron logs.`;
  }
  if (totalErrors7d > totalRuns7d * 0.5) {
    const sampleErr = x.lastErrors[0]?.error ?? '(none)';
    return `${totalErrors7d}/${totalRuns7d} runs errored in last 7 days. Most recent error: "${sampleErr}". Fix that + re-test.`;
  }
  if (totalEmailed7d === 0 && totalRuns7d > 0) {
    return `Cron ran ${totalRuns7d} times but 0 emails went out. Send is failing silently OR every run had 0 matches. Check lastErrors and env.FROM_EMAIL.`;
  }
  if (x.userPool.pickedNow === 0) {
    return `pickUsersForThisHour returned 0 for the current hour. Either no users have email_time in this timezone bucket, all are paused, or all are trial-expired. Check users.${JSON.stringify(x.users)}.`;
  }
  return `Looks healthy. ${totalRuns7d} runs in 7d, ${totalEmailed7d} emails sent, ${x.userPool.pickedNow} users queued for the current hour bucket.`;
}
