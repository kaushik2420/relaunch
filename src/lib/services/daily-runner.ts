import { supabaseAdmin } from '@/lib/supabase/admin';
import { decrypt } from '@/lib/crypto';
import { fetchJobsFromAll, lastFetchSummary, type ProviderResult } from '@/lib/providers/jobs';
import { rankJobs } from './job-matcher';
import { llm } from '@/lib/providers/llm';
import { sheets } from '@/lib/providers/sheets';
import { email as emailProvider } from '@/lib/providers/email';
import { findReferrers, buildConnectionsSearchUrl } from './referrer-finder';
import type { TailoredJobMatch, UserProfile, UserPreferences, PivotBrief } from '@/lib/types';

/**
 * Process a single user's daily run.
 * Stateless — call this in a loop or fan out as parallel function invocations.
 */
export async function runDailyForUser(userRow: UserRow): Promise<{ matchesFound: number; emailed: number; providers: ProviderResult[] }> {
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

  // Career-pivot: if the user turned on pivot mode and we have a
  // synthesized brief, the search is driven by the brief — not their
  // resume history. role_family was already set to the pivot target
  // when preferences were saved.
  const pivotBrief = parsePivotBrief(userRow);

  // 1. Pull jobs across all enabled providers.
  //
  // Query strategy: the job APIs (Adzuna, Jooble, JSearch) want SHORT
  // keyword phrases like "Product Manager", not full headlines like
  // "Senior Product Manager with 7 years in fintech driving 0->1 launches".
  // For pivot users we use the brief's searchQuery; otherwise we derive
  // a clean role title from the most recent experience entry, strip
  // seniority words, and cap to ~40 chars.
  const query = pivotBrief?.searchQuery?.trim() || deriveJobQuery(profile);
  console.log(`[daily-runner] query="${query}" pivot=${pivotBrief ? 'on' : 'off'} roleFamily=${userRow.role_family ?? '(none)'} locations=${(prefs.locations.length ? prefs.locations : ['India']).join(',')}`);
  const jobs = await fetchJobsFromAll({
    query,
    locations: prefs.locations.length ? prefs.locations : ['India'],
    workMode: prefs.workModes[0] ?? 'any',
    roleFamily: (userRow.role_family as 'engineering' | 'product' | 'design' | 'data' | 'marketing' | 'operations' | 'sales' | 'other' | null) ?? undefined,
    limit: 60,
    postedWithinDays: 7,
  });

  // 2. Rank + filter; take the top N (configurable)
  const ranked = await rankJobs(jobs, profile, prefs);
  const top = ranked.slice(0, 5);
  if (!top.length) {
    return { matchesFound: 0, emailed: 0, providers: lastFetchSummary() };
  }

  // We may need the Google refresh token both for writing the Sheet AND
  // for creating tailored-resume Docs. Decode once, share between steps.
  const refreshToken =
    userRow.user_sheet_id && userRow.google_refresh_token_enc
      ? decrypt(userRow.google_refresh_token_enc)
      : null;

  // 3. For each top match, in parallel:
  //    (a) tailor the resume + draft a cover letter via Claude
  //    (b) render both to Drive (PDF + editable .docx each)
  //    (c) look up 1-2 potential referrers (Proxycurl; no-op if no key)
  //    (d) draft an InMail addressed to the referrer (or generic if none)
  // Each step is wrapped in try/catch — a single failure shouldn't kill
  // the whole match. Better to ship a partial row than nothing.
  const matches: TailoredJobMatch[] = await Promise.all(
    top.map(async ({ job, matchPercent, reasons }) => {
      // (a) Resume tailoring + cover letter — independent Claude calls,
      //     run them together. tailorResume is required (throw kills the
      //     match); a cover-letter failure just drops the letter.
      const [tailored, coverLetter] = await Promise.all([
        llm().tailorResume({ profile, job, pivotBrief: pivotBrief ?? undefined }),
        llm()
          .draftCoverLetter({ profile, job, pivotBrief: pivotBrief ?? undefined })
          .catch((err) => {
            console.error('draftCoverLetter failed', err);
            return undefined;
          }),
      ]);

      // (b) Save the resume to Drive — polished PDF + editable .docx.
      let tailoredResumeUrl: string | undefined;
      let tailoredResumeDocUrl: string | undefined;
      let coverLetterUrl: string | undefined;
      let coverLetterDocUrl: string | undefined;
      if (refreshToken) {
        try {
          const r = await sheets().createTailoredResume({
            refreshToken,
            company: job.company,
            role: job.title,
            profile,
            tailored,
          });
          tailoredResumeUrl = r.pdfUrl;
          tailoredResumeDocUrl = r.docUrl;
        } catch (err) {
          console.error('createTailoredResume failed', err);
        }

        // Cover letter to Drive — also PDF + editable .docx.
        if (coverLetter) {
          try {
            const c = await sheets().createCoverLetter({
              refreshToken,
              company: job.company,
              role: job.title,
              profile,
              letter: coverLetter,
            });
            coverLetterUrl = c.pdfUrl;
            coverLetterDocUrl = c.docUrl;
          } catch (err) {
            console.error('createCoverLetter failed', err);
          }
        }
      }

      // (c) Build a LinkedIn deep-link to the user's 2nd-degree network
      //     at this company. Free, more private, more useful than paid APIs.
      const connectionsSearchUrl = buildConnectionsSearchUrl({
        company: job.company,
        title: job.title,
      });

      // Optional: if a future LinkedIn data API is wired, this populates names.
      // For now this always returns [] (no API cost). Kept so the pipeline
      // gracefully starts using names the moment a provider is plugged in.
      let referrers: TailoredJobMatch['referrers'] = [];
      try {
        referrers = await findReferrers({ profile, job, limit: 2 });
      } catch (err) {
        console.error('findReferrers failed', err);
      }

      // (d) InMail — always draft. If we ever have a specific referrer
      // (e.g. LinkedIn OAuth populates it later), use the first one.
      let inmailDraft: TailoredJobMatch['inmailDraft'] | undefined;
      try {
        inmailDraft = await llm().draftInmail({
          profile,
          job,
          referrer: referrers[0],
        });
      } catch (err) {
        console.error('draftInmail failed', err);
      }

      return {
        job,
        matchPercent,
        reasons,
        tailored,
        tailoredResumeUrl,
        tailoredResumeDocUrl,
        coverLetter,
        coverLetterUrl,
        coverLetterDocUrl,
        referrers,
        connectionsSearchUrl,
        inmailDraft,
      };
    })
  );

  // 4. Append to user's Sheet (if connected)
  if (userRow.user_sheet_id && refreshToken) {
    await sheets().appendMatches(userRow.user_sheet_id, refreshToken, matches);
  }

  // 5. Email digest
  await emailProvider().send({
    to: userRow.email,
    subject: `${matches.length} fresh roles for you today 🌅`,
    html: renderDigestHtml(userRow.first_name ?? 'friend', matches),
  });

  return { matchesFound: ranked.length, emailed: matches.length, providers: lastFetchSummary() };
}

/**
 * Pick the cleanest short keyword phrase to send to job-search APIs.
 *
 * Priority:
 *   1. Most recent job title — that's almost always what they want next
 *   2. Strip seniority prefixes ("Senior", "Lead", "Principal") — APIs
 *      filter on these inconsistently and they shrink the result pool
 *   3. Strip trailing department/team noise ("Growth", "Platform") if
 *      title is still long after step 2
 *   4. Cap at 40 chars to stay friendly to all APIs
 *
 * Examples:
 *   "Senior Product Manager, Growth"        → "Product Manager Growth"
 *   "Staff Software Engineer at Flipkart"   → "Software Engineer"
 *   "Principal Designer, Platform"          → "Designer Platform"
 *   undefined                               → "engineer" (safe default)
 */
function deriveJobQuery(profile: UserProfile): string {
  const recent = profile.experience?.[0]?.title ?? '';
  let q = recent.trim();
  if (!q) return 'engineer';

  // Drop common seniority prefixes
  q = q.replace(/^(senior|sr\.?|junior|jr\.?|lead|staff|principal|head of|vp,?\s+)\s+/i, '');

  // Drop common suffixes that hurt match counts ("at Company")
  q = q.replace(/\s+(at|@)\s+.+$/i, '');

  // Collapse "Role - Department" / "Role, Department" to spaces
  q = q.replace(/[,\-–—]/g, ' ').replace(/\s+/g, ' ').trim();

  // Cap length
  if (q.length > 40) q = q.slice(0, 40).trim();
  return q || 'engineer';
}

/**
 * Returns the user's pivot brief only if pivot mode is on AND the brief
 * is usable (has a search query). pivot_brief comes back from Supabase
 * as already-parsed jsonb. Returns null otherwise so callers fall back
 * to the normal resume-derived behaviour.
 */
function parsePivotBrief(userRow: UserRow): PivotBrief | null {
  if (!userRow.pivot_enabled || !userRow.pivot_brief) return null;
  const b = userRow.pivot_brief as Partial<PivotBrief> | null;
  if (b && typeof b.searchQuery === 'string' && b.searchQuery.trim()) {
    return b as PivotBrief;
  }
  return null;
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
      'id, email, first_name, profile, locations, work_modes, target_ctc, phone, notice_period, notes, email_frequency, email_time, timezone, google_refresh_token_enc, user_sheet_id, last_run_at, free_until, is_paying, role_family, pivot_enabled, pivot_brief'
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
  role_family?: string | null;
  pivot_enabled?: boolean | null;
  pivot_brief?: unknown;
}
