import { supabaseAdmin } from '@/lib/supabase/admin';
import { decrypt } from '@/lib/crypto';
import { fetchJobsFromAll } from '@/lib/providers/jobs';
import { rankJobs } from './job-matcher';
import { llm } from '@/lib/providers/llm';
import { sheets } from '@/lib/providers/sheets';
import { email as emailProvider } from '@/lib/providers/email';
import type { TailoredJobMatch, UserProfile, UserPreferences } from '@/lib/types';

/**
 * Process a single user's daily run.
 * Stateless — call this in a loop or fan out as parallel function invocations.
 */
export async function runDailyForUser(userRow: UserRow): Promise<{ matchesFound: number; emailed: number }> {
  const profile = userRow.profile as UserProfile;
  const prefs: UserPreferences = {
    locations: userRow.locations ?? [],
    workModes: (userRow.work_modes ?? []) as UserPreferences['workModes'],
    targetCtc: userRow.target_ctc ?? undefined,
    phone: userRow.phone ?? undefined,
    noticePeriod: userRow.notice_period ?? undefined,
    notes: userRow.notes ?? undefined,
    emailFrequency: (userRow.email_frequency ?? 'daily') as UserPreferences['emailFrequency'],
    emailTime: userRow.email_time ?? '08:30',
    timezone: userRow.timezone ?? 'Asia/Kolkata',
  };

  // 1. Pull jobs across all enabled providers
  const query = (profile.headline ?? `${profile.experience?.[0]?.title ?? 'engineer'}`).slice(0, 60);
  const jobs = await fetchJobsFromAll({
    query,
    locations: prefs.locations.length ? prefs.locations : ['India'],
    workMode: prefs.workModes[0] ?? 'any',
    limit: 60,
    postedWithinDays: 7,
  });

  // 2. Rank + filter; take the top N (configurable)
  const ranked = await rankJobs(jobs, profile, prefs);
  const top = ranked.slice(0, 5);
  if (!top.length) return { matchesFound: 0, emailed: 0 };

  // 3. Tailor each top match (parallel, capped to avoid LLM rate limits)
  const matches: TailoredJobMatch[] = await Promise.all(
    top.map(async ({ job, matchPercent, reasons }) => {
      const tailored = await llm().tailorResume({ profile, job });
      // Referrers + InMail are best-effort — skip silently if no Proxycurl key
      let referrers: TailoredJobMatch['referrers'] = [];
      let inmail: TailoredJobMatch['inmailDraft'] | undefined;
      try {
        // referrer lookup deferred — implement /lib/services/referrer-finder.ts
      } catch { /* swallow */ }
      return { job, matchPercent, reasons, tailored, referrers, inmailDraft: inmail };
    })
  );

  // 4. Append to user's Sheet (if connected)
  if (userRow.user_sheet_id && userRow.google_refresh_token_enc) {
    const refreshToken = decrypt(userRow.google_refresh_token_enc);
    await sheets().appendMatches(userRow.user_sheet_id, refreshToken, matches);
  }

  // 5. Email digest
  await emailProvider().send({
    to: userRow.email,
    subject: `${matches.length} fresh roles for you today 🌅`,
    html: renderDigestHtml(userRow.first_name ?? 'friend', matches),
  });

  return { matchesFound: ranked.length, emailed: matches.length };
}

function renderDigestHtml(name: string, matches: TailoredJobMatch[]): string {
  const items = matches
    .map(
      (m) => `
        <tr><td style="padding:14px 0;border-top:1px solid #ECE7DD;">
          <div style="font-size:16px;font-weight:600;">${escapeHtml(m.job.title)}</div>
          <div style="color:#5B6477;font-size:13px;">${escapeHtml(m.job.company)} · ${escapeHtml(m.job.location)}</div>
          <div style="margin-top:6px;font-size:13px;color:#0F172A;">${escapeHtml(m.tailored.summary)}</div>
          <a href="${escapeHtml(m.job.url)}" style="display:inline-block;margin-top:8px;color:#5B6CFF;font-weight:600;">View role →</a>
        </td></tr>`
    )
    .join('');
  return `<!doctype html>
<html><body style="font-family:-apple-system,Segoe UI,sans-serif;background:#FAF8F4;padding:24px;color:#1C2230;">
<table style="max-width:560px;margin:0 auto;background:#fff;padding:24px;border-radius:14px;">
  <tr><td>
    <h1 style="margin:0 0 6px;font-size:22px;">Good morning, ${escapeHtml(name)} 🌅</h1>
    <p style="margin:0 0 14px;color:#5B6477;font-size:14px;">${matches.length} roles picked for you today.</p>
    <table style="width:100%;border-collapse:collapse;">${items}</table>
    <p style="color:#8A93A6;font-size:12px;margin-top:18px;">All saved to your Google Sheet. Reply STOP to pause emails.</p>
  </td></tr>
</table></body></html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
}

// ---------------------------------------------------------------
// Fetch the batch of users to process this hour
// ---------------------------------------------------------------
export async function pickUsersForThisHour(now = new Date()) {
  // Convert to UTC hour bucket — we'll match users whose (email_time, timezone)
  // resolves to this hour. We do this in SQL via a server function in v2;
  // for v1 we pull active users and filter in JS.
  const { data, error } = await supabaseAdmin()
    .from('users')
    .select(
      'id, email, first_name, profile, locations, work_modes, target_ctc, phone, notice_period, notes, email_frequency, email_time, timezone, google_refresh_token_enc, user_sheet_id, last_run_at, free_until, is_paying'
    )
    .eq('is_active', true)
    .neq('email_frequency', 'paused');
  if (error) throw error;

  return (data ?? []).filter((u) => {
    if (!u.profile || Object.keys(u.profile as object).length === 0) return false;
    if (!shouldRunForFrequency(u as UserRow, now)) return false;
    if (!u.is_paying && new Date(u.free_until).getTime() < now.getTime()) return false;
    return matchesTimezoneHour(u as UserRow, now);
  }) as UserRow[];
}

function shouldRunForFrequency(u: UserRow, now: Date): boolean {
  if (!u.last_run_at) return true;
  const last = new Date(u.last_run_at).getTime();
  const hoursSince = (now.getTime() - last) / 3_600_000;
  switch (u.email_frequency) {
    case 'daily': return hoursSince >= 23;
    case '2days': return hoursSince >= 47;
    case 'weekly': return hoursSince >= 167;
    case 'realtime': return true;
    default: return false;
  }
}

function matchesTimezoneHour(u: UserRow, now: Date): boolean {
  try {
    const fmt = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hour12: false, timeZone: u.timezone ?? 'Asia/Kolkata' });
    const localHour = parseInt(fmt.format(now), 10);
    const targetHour = parseInt((u.email_time ?? '08:30').split(':')[0]!, 10);
    return localHour === targetHour;
  } catch {
    return false;
  }
}

export interface UserRow {
  id: string;
  email: string;
  first_name: string | null;
  profile: unknown;
  locations: string[] | null;
  work_modes: string[] | null;
  target_ctc: string | null;
  phone: string | null;
  notice_period: string | null;
  notes: string | null;
  email_frequency: string | null;
  email_time: string | null;
  timezone: string | null;
  google_refresh_token_enc: string | null;
  user_sheet_id: string | null;
  last_run_at: string | null;
  free_until: string;
  is_paying: boolean | null;
}
