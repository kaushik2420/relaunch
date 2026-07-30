import Anthropic from '@anthropic-ai/sdk';
import { createHash } from 'crypto';
import { serverConfig } from '@/lib/config';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { email as emailProvider } from '@/lib/providers/email';

/**
 * Sentinel — hourly self-diagnosis for the Relaunch pipeline.
 *
 * What it does
 * -------------
 * Once per hour, collect signals from Postgres (job_runs, job_matches,
 * users), pack them into a prompt, ask Haiku "you're an on-call SRE,
 * triage this". Store the result in sentinel_runs. If Claude returns
 * severity >= 3, ensure an open row exists in sentinel_alerts (deduped
 * by problem signature) and email the admin — but only on FIRST
 * detection, not every subsequent hour the same problem persists.
 *
 * What it catches
 * ---------------
 * - Anthropic / OpenAI / Google API outages (elevated error rate in
 *   job_runs.error text)
 * - Cron itself down (0 job_runs rows for >2 consecutive hourly windows)
 * - Job-provider silent zero-return (job_matches insert count drops)
 * - New failure patterns unknown to the hardcoded diagnostic rules
 *   (Claude reads the raw error samples)
 *
 * What it does NOT catch (yet)
 * ----------------------------
 * - Slow performance (only status/count signals; no latency histogram)
 * - Client-side errors (no browser-side telemetry)
 * - Third-party downstream failures with no in-DB signal (Resend
 *   deliverability, Google Sheet quota etc.)
 * The hooks are trivial to add — just push more signal into
 * `gatherSignals()` and the LLM auto-includes them in triage.
 */

const HAIKU_MODEL = 'claude-haiku-4-5-20251001';

// If the last N sentinel_runs already flagged the same problem_sig,
// suppress the email on this run — we've already notified.
const SUPPRESS_AFTER_N_REPEATS = 1; // 1 = notify only on FIRST detection

export interface SentinelDiagnosis {
  severity: 0 | 1 | 2 | 3 | 4 | 5;
  headline: string;
  rootCause: string;
  suggestedFix: string;
  problemSig: string | null; // null when severity=0
}

export interface SentinelRunResult {
  ranAt: string;
  durationMs: number;
  signals: SentinelSignals;
  diagnosis: SentinelDiagnosis;
  notified: boolean;
  alertId: string | null;
}

interface SentinelSignals {
  now: string;
  window1h: {
    totalRuns: number;
    ok: number;
    partial: number;
    error: number;
    emailed: number;
    topErrors: { message: string; count: number }[];
  };
  window24h: {
    totalRuns: number;
    ok: number;
    partial: number;
    error: number;
    emailed: number;
    distinctUsersRun: number;
    distinctUsersEmailed: number;
    topErrors: { message: string; count: number }[];
  };
  jobMatchesInserted24h: number;
  users: {
    active: number;
    withProfile: number;
    paying: number;
    trialActive: number;
    loggedIn24h: number;
  };
  consecutiveHoursWithZeroRuns: number;
}

/**
 * Run one sentinel pass. Idempotent-ish: safe to invoke repeatedly (each
 * run logs a fresh sentinel_runs row).
 */
export async function runSentinel(): Promise<SentinelRunResult> {
  const start = Date.now();
  const ranAt = new Date().toISOString();
  const signals = await gatherSignals();
  const diagnosis = await triageWithHaiku(signals);

  const admin = supabaseAdmin();

  // ---- Dedup / alert lifecycle ----
  let alertId: string | null = null;
  let notified = false;

  if (diagnosis.severity >= 3 && diagnosis.problemSig) {
    // 1. Upsert into sentinel_alerts — one open row per problem_sig.
    const { data: existing } = await admin
      .from('sentinel_alerts')
      .select('id, occurrence_count, resolved_at')
      .eq('problem_sig', diagnosis.problemSig)
      .maybeSingle();

    if (existing && !existing.resolved_at) {
      // Already-open alert — bump the counter, update last_seen_at.
      const { data: updated } = await admin
        .from('sentinel_alerts')
        .update({
          last_seen_at: ranAt,
          occurrence_count: existing.occurrence_count + 1,
          severity: diagnosis.severity,
          headline: diagnosis.headline,
          root_cause: diagnosis.rootCause,
          suggested_fix: diagnosis.suggestedFix,
        })
        .eq('id', existing.id)
        .select('id')
        .single();
      alertId = updated?.id ?? existing.id;

      // Only re-notify if severity escalated OR count crossed a
      // multiple-of-24 threshold (i.e. still going after a day).
      if (existing.occurrence_count + 1 === 24) {
        notified = await sendAlertEmail(diagnosis, signals, ranAt, 'day-old');
      }
    } else {
      // Brand new alert (or reopening a resolved one).
      const { data: inserted } = await admin
        .from('sentinel_alerts')
        .upsert(
          {
            problem_sig: diagnosis.problemSig,
            first_detected: ranAt,
            last_seen_at: ranAt,
            severity: diagnosis.severity,
            headline: diagnosis.headline,
            root_cause: diagnosis.rootCause,
            suggested_fix: diagnosis.suggestedFix,
            occurrence_count: 1,
            resolved_at: null,
            resolved_reason: null,
          },
          { onConflict: 'problem_sig' },
        )
        .select('id')
        .single();
      alertId = inserted?.id ?? null;
      notified = await sendAlertEmail(diagnosis, signals, ranAt, 'new');
    }
  } else {
    // No active problem this run. Resolve any open alerts that haven't
    // been seen for at least 2 hours (self-healed).
    const twoHoursAgo = new Date(Date.now() - 2 * 3600_000).toISOString();
    await admin
      .from('sentinel_alerts')
      .update({
        resolved_at: ranAt,
        resolved_reason: 'sentinel detected all-clear',
      })
      .is('resolved_at', null)
      .lt('last_seen_at', twoHoursAgo);
  }

  // ---- Audit row ----
  await admin.from('sentinel_runs').insert({
    ran_at: ranAt,
    window_start: signals.window1h ? new Date(Date.now() - 3600_000).toISOString() : ranAt,
    window_end: ranAt,
    signals,
    severity: diagnosis.severity,
    headline: diagnosis.headline,
    root_cause: diagnosis.rootCause,
    suggested_fix: diagnosis.suggestedFix,
    problem_sig: diagnosis.problemSig,
    notified,
    duration_ms: Date.now() - start,
  });

  return {
    ranAt,
    durationMs: Date.now() - start,
    signals,
    diagnosis,
    notified,
    alertId,
  };
}

// ==================================================================
// Signal gathering — reads-only Postgres queries. No mutations.
// ==================================================================

async function gatherSignals(): Promise<SentinelSignals> {
  const admin = supabaseAdmin();
  const now = new Date();
  const oneHourAgo = new Date(now.getTime() - 3600_000);
  const twentyFourHoursAgo = new Date(now.getTime() - 24 * 3600_000);

  // job_runs — last 1h and last 24h.
  const { data: rows1h } = await admin
    .from('job_runs')
    .select('status, jobs_emailed, error, user_id')
    .gte('run_at', oneHourAgo.toISOString());
  const { data: rows24h } = await admin
    .from('job_runs')
    .select('status, jobs_emailed, error, user_id')
    .gte('run_at', twentyFourHoursAgo.toISOString());

  const bucketize = (rows: JobRunRow[]) => {
    const ok = rows.filter((r) => r.status === 'ok').length;
    const partial = rows.filter((r) => r.status === 'partial').length;
    const error = rows.filter((r) => r.status === 'error').length;
    const emailed = rows.reduce((s, r) => s + (r.jobs_emailed ?? 0), 0);
    return { totalRuns: rows.length, ok, partial, error, emailed };
  };

  const topErrors = (rows: JobRunRow[]) => {
    const counts = new Map<string, number>();
    for (const r of rows) {
      if (!r.error) continue;
      // Normalise the error to a short fingerprint so slight
      // variations (request IDs) don't split the count.
      const key = fingerprintError(r.error);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([message, count]) => ({ message, count }));
  };

  const w1h = bucketize(rows1h ?? []);
  const w24h = bucketize(rows24h ?? []);
  const uniqueUserIds = (rows: JobRunRow[]) =>
    new Set(rows.map((r) => r.user_id)).size;

  // job_matches inserted in last 24h — if this drops to 0 while users
  // are active, some provider(s) or the ranker is silently failing.
  const { count: jobMatchesInserted24h } = await admin
    .from('job_matches')
    .select('id', { count: 'exact', head: true })
    .gte('updated_at', twentyFourHoursAgo.toISOString());

  // Users health
  const nowIso = now.toISOString();
  const [
    { count: active },
    { count: withProfile },
    { count: paying },
    { count: trialActive },
    { count: loggedIn24h },
  ] = await Promise.all([
    admin.from('users').select('id', { count: 'exact', head: true }).eq('is_active', true),
    admin
      .from('users')
      .select('id', { count: 'exact', head: true })
      .eq('is_active', true)
      .not('profile', 'is', null),
    admin.from('users').select('id', { count: 'exact', head: true }).eq('is_paying', true),
    admin
      .from('users')
      .select('id', { count: 'exact', head: true })
      .eq('is_active', true)
      .eq('is_paying', false)
      .gte('free_until', nowIso),
    admin
      .from('users')
      .select('id', { count: 'exact', head: true })
      .gte('last_login_at', twentyFourHoursAgo.toISOString()),
  ]);

  // "Consecutive hours with zero runs" — how many past hourly buckets
  // going back from now had 0 job_runs. If >= 2, the cron itself is
  // probably down (a natural hour with 0 users queued is normal; two
  // in a row is suspicious).
  const consecutiveHoursWithZeroRuns = await countConsecutiveZeroHours(6);

  return {
    now: now.toISOString(),
    window1h: { ...w1h, topErrors: topErrors(rows1h ?? []) },
    window24h: {
      ...w24h,
      distinctUsersRun: uniqueUserIds(rows24h ?? []),
      distinctUsersEmailed: uniqueUserIds(
        (rows24h ?? []).filter((r) => (r.jobs_emailed ?? 0) > 0),
      ),
      topErrors: topErrors(rows24h ?? []),
    },
    jobMatchesInserted24h: jobMatchesInserted24h ?? 0,
    users: {
      active: active ?? 0,
      withProfile: withProfile ?? 0,
      paying: paying ?? 0,
      trialActive: trialActive ?? 0,
      loggedIn24h: loggedIn24h ?? 0,
    },
    consecutiveHoursWithZeroRuns,
  };
}

interface JobRunRow {
  status: string;
  jobs_emailed: number | null;
  error: string | null;
  user_id: string;
}

async function countConsecutiveZeroHours(lookback: number): Promise<number> {
  const admin = supabaseAdmin();
  const now = Date.now();
  let count = 0;
  for (let i = 0; i < lookback; i++) {
    const end = new Date(now - i * 3600_000).toISOString();
    const start = new Date(now - (i + 1) * 3600_000).toISOString();
    const { count: c } = await admin
      .from('job_runs')
      .select('id', { count: 'exact', head: true })
      .gte('run_at', start)
      .lt('run_at', end);
    if ((c ?? 0) === 0) count++;
    else break; // consecutive counter — stop at first non-zero hour
  }
  return count;
}

/**
 * Strip request IDs, timestamps, and hex fingerprints so semantically-
 * identical errors from different invocations hash to the same string.
 */
function fingerprintError(msg: string): string {
  return msg
    .replace(/req_[a-zA-Z0-9]{16,}/g, 'req_XXX')
    .replace(/\b[a-f0-9]{16,}\b/g, 'HEX_XXX')
    .replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z?/g, 'TS_XXX')
    .replace(/\s+/g, ' ')
    .slice(0, 240);
}

// ==================================================================
// LLM triage
// ==================================================================

async function triageWithHaiku(
  signals: SentinelSignals,
): Promise<SentinelDiagnosis> {
  const cfg = serverConfig();
  if (!cfg.ANTHROPIC_API_KEY) {
    // Graceful degrade — if Claude is offline, run a very simple
    // rules-based triage. Sentinel's whole point is to notice outages
    // so it should still work when Claude itself is out.
    return rulesBasedTriage(signals);
  }
  const client = new Anthropic({ apiKey: cfg.ANTHROPIC_API_KEY });

  const prompt = `You are an on-call SRE for a job-search app called Relaunch. Once per hour we hand you fresh signals from the production Postgres. Your job: decide if anything is wrong, and if so, how severe.

Severity rubric:
- 0 = all clear. Signals are within normal bounds.
- 1 = anomaly worth noting, no user impact yet.
- 2 = single user impact, or a soft error rate elevation (<20% errors).
- 3 = multiple users impacted, or elevated error rate (20-50%), or a specific feature broken.
- 4 = many users blocked (>50% error rate, or 0 emails going out despite active cron).
- 5 = full outage — cron itself down, or 100% of runs failing.

Signals (JSON):
${JSON.stringify(signals, null, 2)}

Reasoning hints (don't include in output):
- window1h.error > window1h.ok by a lot → provider outage in progress
- window24h.emailed == 0 with distinctUsersRun > 0 → send failing OR every run has 0 matches
- consecutiveHoursWithZeroRuns >= 2 → cron itself down or CRON_SECRET broken
- jobMatchesInserted24h == 0 with users.loggedIn24h > 5 → providers silently failing
- topErrors[0].count / totalRuns > 0.5 → THAT specific error is the culprit; name it
- Users with profile but no run in 24h despite active status → user selection query issue

Output STRICT JSON only, no prose:
{
  "severity": <0-5>,
  "headline": "<one short sentence: what's wrong or 'all clear'>",
  "rootCause": "<one paragraph: WHY, referencing specific signals>",
  "suggestedFix": "<concrete action(s) to take, or 'no action needed' if severity=0>",
  "problemSig": "<short hash-friendly string identifying THIS problem, e.g. 'anthropic-credit-out' or 'cron-not-firing' or 'coresignal-zero-hits'. null if severity=0.>"
}`;

  try {
    const msg = await client.messages.create({
      model: HAIKU_MODEL,
      max_tokens: 500,
      messages: [{ role: 'user', content: prompt }],
    });
    const text = msg.content
      .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
      .map((c) => c.text)
      .join('');
    // Extract JSON block (Haiku sometimes wraps in ```json)
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('no JSON in Haiku response');
    const parsed = JSON.parse(match[0]) as {
      severity: number;
      headline: string;
      rootCause: string;
      suggestedFix: string;
      problemSig: string | null;
    };
    const severity = Math.max(0, Math.min(5, Math.round(Number(parsed.severity) || 0))) as SentinelDiagnosis['severity'];
    const problemSig =
      severity > 0
        ? (parsed.problemSig ?? autoSignature(parsed.headline)).slice(0, 120)
        : null;
    return {
      severity,
      headline: (parsed.headline ?? '').slice(0, 200) || 'no headline',
      rootCause: (parsed.rootCause ?? '').slice(0, 1000),
      suggestedFix: (parsed.suggestedFix ?? '').slice(0, 1000),
      problemSig,
    };
  } catch (err) {
    console.error('[sentinel] Haiku triage failed, falling back to rules', err);
    return rulesBasedTriage(signals);
  }
}

/**
 * Fallback for when Claude itself is down / no key. Cover the
 * highest-severity failure modes we've actually seen in production.
 */
function rulesBasedTriage(signals: SentinelSignals): SentinelDiagnosis {
  const { window1h, window24h, consecutiveHoursWithZeroRuns } = signals;

  if (consecutiveHoursWithZeroRuns >= 2) {
    return {
      severity: 5,
      headline: `Cron hasn't fired in ${consecutiveHoursWithZeroRuns} consecutive hours`,
      rootCause: 'No rows in job_runs for the past 2+ hours. Vercel cron is either disabled, mis-scheduled, or failing auth (401).',
      suggestedFix: 'Check Vercel dashboard → Cron Jobs. Verify CRON_SECRET matches. Re-hit /api/admin/cron-diagnostic for detail.',
      problemSig: 'cron-not-firing',
    };
  }
  if (window24h.totalRuns > 10 && window24h.error / window24h.totalRuns > 0.5) {
    const top = window24h.topErrors[0];
    return {
      severity: 4,
      headline: `${Math.round((window24h.error / window24h.totalRuns) * 100)}% of runs errored in 24h`,
      rootCause: `Top error (${top?.count ?? 0}× hits): ${top?.message ?? 'unknown'}`,
      suggestedFix: 'Investigate the top error above. Check /api/admin/cron-diagnostic for correlated signals.',
      problemSig: `high-error-rate:${top?.message ? autoSignature(top.message) : 'unknown'}`,
    };
  }
  if (window1h.totalRuns > 0 && window1h.error / window1h.totalRuns > 0.5) {
    return {
      severity: 3,
      headline: `Elevated error rate in last hour (${window1h.error}/${window1h.totalRuns})`,
      rootCause: `Top hourly error: ${window1h.topErrors[0]?.message ?? 'unknown'}`,
      suggestedFix: 'Fresh spike — check Vercel logs for the last 60 minutes.',
      problemSig: `hourly-error-spike:${autoSignature(window1h.topErrors[0]?.message ?? '')}`,
    };
  }
  return {
    severity: 0,
    headline: 'All clear',
    rootCause: 'Rules-based triage found nothing anomalous.',
    suggestedFix: 'no action needed',
    problemSig: null,
  };
}

function autoSignature(s: string): string {
  return createHash('sha1').update(s.toLowerCase()).digest('hex').slice(0, 12);
}

// ==================================================================
// Email
// ==================================================================

async function sendAlertEmail(
  d: SentinelDiagnosis,
  s: SentinelSignals,
  ranAt: string,
  kind: 'new' | 'day-old',
): Promise<boolean> {
  const cfg = serverConfig();
  const sevEmoji = ['⚪', 'ℹ️', '🟡', '🟠', '🔴', '🚨'][d.severity] ?? '⚪';
  const subjectPrefix = kind === 'day-old' ? '[still active 24h] ' : '';
  const subject = `${subjectPrefix}${sevEmoji} Relaunch sentinel: ${d.headline}`;

  try {
    await emailProvider().send({
      to: cfg.ADMIN_EMAIL,
      subject,
      html: renderAlertHtml(d, s, ranAt),
    });
    return true;
  } catch (err) {
    console.error('[sentinel] alert email failed', err);
    return false;
  }
}

function renderAlertHtml(
  d: SentinelDiagnosis,
  s: SentinelSignals,
  ranAt: string,
): string {
  const topErrors = s.window24h.topErrors
    .slice(0, 3)
    .map(
      (e) => `
      <tr>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;">${escapeHtml(e.message)}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right;font-variant-numeric:tabular-nums;">${e.count}</td>
      </tr>`,
    )
    .join('');
  return `<!doctype html>
<html><body style="font-family:-apple-system,Segoe UI,sans-serif;background:#FAF5E9;padding:24px;color:#1C2220;">
<table style="max-width:640px;margin:0 auto;background:#fff;padding:24px;border-radius:14px;">
<tr><td>
  <div style="font-size:12px;color:#8C998F;text-transform:uppercase;letter-spacing:0.05em;">Sentinel · sev ${d.severity} · ${ranAt.slice(0, 16)}</div>
  <h1 style="margin:6px 0 4px;font-size:22px;color:#1A3826;">${escapeHtml(d.headline)}</h1>
  <p style="margin:12px 0 4px;font-size:13px;color:#58665C;font-weight:600;">Root cause</p>
  <p style="margin:0;font-size:14px;line-height:1.55;">${escapeHtml(d.rootCause)}</p>
  <p style="margin:16px 0 4px;font-size:13px;color:#58665C;font-weight:600;">Suggested fix</p>
  <p style="margin:0;font-size:14px;line-height:1.55;color:#1A3826;font-weight:500;">${escapeHtml(d.suggestedFix)}</p>
  <p style="margin:20px 0 4px;font-size:13px;color:#58665C;font-weight:600;">Signals — last 24h</p>
  <table style="width:100%;font-size:13px;border-collapse:collapse;">
    <tr>
      <td style="padding:6px 10px;color:#58665C;">Runs</td>
      <td style="padding:6px 10px;text-align:right;">${s.window24h.totalRuns} (ok: ${s.window24h.ok}, err: ${s.window24h.error}, part: ${s.window24h.partial})</td>
    </tr>
    <tr>
      <td style="padding:6px 10px;color:#58665C;">Emails sent</td>
      <td style="padding:6px 10px;text-align:right;">${s.window24h.emailed} to ${s.window24h.distinctUsersEmailed} users</td>
    </tr>
    <tr>
      <td style="padding:6px 10px;color:#58665C;">Job matches persisted</td>
      <td style="padding:6px 10px;text-align:right;">${s.jobMatchesInserted24h}</td>
    </tr>
    <tr>
      <td style="padding:6px 10px;color:#58665C;">Active users</td>
      <td style="padding:6px 10px;text-align:right;">${s.users.active} (${s.users.loggedIn24h} logged in 24h)</td>
    </tr>
    <tr>
      <td style="padding:6px 10px;color:#58665C;">Zero-run hours (consecutive)</td>
      <td style="padding:6px 10px;text-align:right;">${s.consecutiveHoursWithZeroRuns}</td>
    </tr>
  </table>
  ${
    topErrors
      ? `<p style="margin:20px 0 4px;font-size:13px;color:#58665C;font-weight:600;">Top error patterns — last 24h</p>
    <table style="width:100%;font-size:12px;border-collapse:collapse;background:#FAF5E9;">
      ${topErrors}
    </table>`
      : ''
  }
  <p style="margin:20px 0 4px;">
    <a href="https://www.get-relaunch.com/admin" style="color:#2C5239;text-decoration:none;font-weight:600;">Open /admin →</a>
    &nbsp;·&nbsp;
    <a href="https://www.get-relaunch.com/api/admin/cron-diagnostic" style="color:#2C5239;text-decoration:none;font-weight:600;">Full diagnostic ↗</a>
  </p>
</td></tr>
</table></body></html>`;
}

function escapeHtml(s: string): string {
  return (s ?? '').replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c,
  );
}
