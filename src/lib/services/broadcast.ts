import { supabaseAdmin } from '@/lib/supabase/admin';
import { email as emailProvider } from '@/lib/providers/email';

/**
 * Broadcast email — one-shot send to a curated audience.
 *
 * Audience buckets:
 *   - active_user   : users.is_active = true (and NOT paused via
 *                     email_frequency='paused' — respects user prefs)
 *   - invited       : waitlist.status='invited' with no matching users
 *                     row yet (they got the invite email but haven't
 *                     activated their account)
 *   - pending       : waitlist.status='pending' (haven't been approved
 *                     yet — sent only when audience='everyone')
 *
 * Audience presets:
 *   - "active"           : active_user only
 *   - "active_invitees"  : active_user + invited (default for feature
 *                          announcements — active AND people we
 *                          promised early access to)
 *   - "everyone"         : active_user + invited + pending
 *
 * Dedup: recipients are unique-by-email within a single broadcast. If
 * the same email is both a waitlist row and a users row, we send once
 * and mark it as active_user (highest-priority bucket).
 *
 * Concurrency: send in batches of PARALLEL to avoid bursting Resend.
 */

export interface BroadcastRecipient {
  email: string;
  firstName: string | null;
  audienceBucket: 'active_user' | 'invited' | 'pending';
}

export type BroadcastAudience = 'active' | 'active_invitees' | 'everyone';

export interface BroadcastResult {
  broadcastId: string;
  recipientCount: number;
  succeeded: number;
  failed: number;
  durationMs: number;
  failures: { email: string; error: string }[];
}

const PARALLEL = 5;

/**
 * Compute the recipient list for a given audience. Read-only —
 * doesn't send anything. Useful for the preview UI so the admin
 * knows how many people they're about to email.
 */
export async function collectRecipients(
  audience: BroadcastAudience,
): Promise<BroadcastRecipient[]> {
  const admin = supabaseAdmin();
  const byEmail = new Map<string, BroadcastRecipient>();

  // 1. Active users (highest priority — added first, wins on dedup).
  //    Skip anyone who paused their notifications.
  const { data: activeUsers } = await admin
    .from('users')
    .select('email, first_name')
    .eq('is_active', true)
    .neq('email_frequency', 'paused');
  for (const u of activeUsers ?? []) {
    const em = (u.email as string).toLowerCase().trim();
    if (!em || byEmail.has(em)) continue;
    byEmail.set(em, {
      email: u.email as string,
      firstName: u.first_name as string | null,
      audienceBucket: 'active_user',
    });
  }

  // 2. Invitees — 'invited' waitlist rows without a users row yet.
  if (audience === 'active_invitees' || audience === 'everyone') {
    const { data: invited } = await admin
      .from('waitlist')
      .select('email, first_name')
      .eq('status', 'invited');
    for (const w of invited ?? []) {
      const em = (w.email as string).toLowerCase().trim();
      if (!em || byEmail.has(em)) continue;
      byEmail.set(em, {
        email: w.email as string,
        firstName: w.first_name as string | null,
        audienceBucket: 'invited',
      });
    }
  }

  // 3. Pending waitlist (only for 'everyone').
  if (audience === 'everyone') {
    const { data: pending } = await admin
      .from('waitlist')
      .select('email, first_name')
      .eq('status', 'pending');
    for (const w of pending ?? []) {
      const em = (w.email as string).toLowerCase().trim();
      if (!em || byEmail.has(em)) continue;
      byEmail.set(em, {
        email: w.email as string,
        firstName: w.first_name as string | null,
        audienceBucket: 'pending',
      });
    }
  }

  return Array.from(byEmail.values());
}

/**
 * Send a broadcast. Persists one broadcast_emails row + one
 * broadcast_recipients row per recipient (with per-recipient send
 * status), even on partial failure.
 *
 * The body_html is interpolated with a very small template — {{firstName}}
 * gets replaced per-recipient with their first name (or "friend" when
 * absent). No other variables.
 */
export async function sendBroadcast(input: {
  subject: string;
  bodyHtml: string;
  audience: BroadcastAudience;
  sentBy: string;
}): Promise<BroadcastResult> {
  const start = Date.now();
  const admin = supabaseAdmin();
  const recipients = await collectRecipients(input.audience);

  // 1. Insert the broadcast row up front so we can attach recipients
  //    to it as we go.
  const { data: broadcast, error: bErr } = await admin
    .from('broadcast_emails')
    .insert({
      sent_by: input.sentBy,
      subject: input.subject,
      body_html: input.bodyHtml,
      audience: input.audience,
      recipient_count: recipients.length,
    })
    .select('id')
    .single();
  if (bErr || !broadcast) {
    throw new Error(`Failed to create broadcast row: ${bErr?.message ?? 'unknown'}`);
  }
  const broadcastId = broadcast.id as string;

  // 2. Send in bounded-concurrency chunks.
  const failures: BroadcastResult['failures'] = [];
  let succeeded = 0;
  let failed = 0;

  for (let i = 0; i < recipients.length; i += PARALLEL) {
    const chunk = recipients.slice(i, i + PARALLEL);
    const results = await Promise.allSettled(
      chunk.map(async (r) => {
        const firstName = (r.firstName ?? '').trim() || 'friend';
        const bodyForR = input.bodyHtml.replace(/\{\{\s*firstName\s*\}\}/g, escapeHtml(firstName));
        try {
          await emailProvider().send({
            to: r.email,
            subject: input.subject,
            html: bodyForR,
          });
          return { ok: true as const, r };
        } catch (err) {
          return {
            ok: false as const,
            r,
            error: (err as Error).message,
          };
        }
      }),
    );
    // Persist per-recipient status in one INSERT per chunk.
    const rows = results.map((res, idx) => {
      const r = chunk[idx]!;
      if (res.status === 'fulfilled') {
        if (res.value.ok) {
          succeeded++;
          return {
            broadcast_id: broadcastId,
            email: r.email,
            first_name: r.firstName,
            audience_bucket: r.audienceBucket,
            status: 'sent' as const,
            error: null,
          };
        }
        failed++;
        failures.push({ email: r.email, error: res.value.error });
        return {
          broadcast_id: broadcastId,
          email: r.email,
          first_name: r.firstName,
          audience_bucket: r.audienceBucket,
          status: 'failed' as const,
          error: res.value.error.slice(0, 400),
        };
      }
      failed++;
      const msg = (res.reason as Error)?.message ?? 'unknown';
      failures.push({ email: r.email, error: msg });
      return {
        broadcast_id: broadcastId,
        email: r.email,
        first_name: r.firstName,
        audience_bucket: r.audienceBucket,
        status: 'failed' as const,
        error: msg.slice(0, 400),
      };
    });
    await admin.from('broadcast_recipients').insert(rows);
  }

  const durationMs = Date.now() - start;

  // 3. Finalise the broadcast row with the summary counts.
  await admin
    .from('broadcast_emails')
    .update({
      succeeded,
      failed,
      duration_ms: durationMs,
    })
    .eq('id', broadcastId);

  return {
    broadcastId,
    recipientCount: recipients.length,
    succeeded,
    failed,
    durationMs,
    failures,
  };
}

/**
 * Ad-hoc send: hand it a raw list of email addresses and it delivers
 * the same subject + body_html to each one. Used for retrying failed
 * recipients from an earlier broadcast, or one-off sends to a curated
 * list the admin typed in.
 *
 * Persists to the same broadcast_emails / broadcast_recipients tables
 * as sendBroadcast(), with audience='manual_list' so it's clearly
 * distinguishable from the audience-preset broadcasts.
 *
 * Tries to look up the first_name for each email so the {{firstName}}
 * substitution still works — checks users.first_name first, then
 * waitlist.first_name.
 */
export async function sendBroadcastToEmails(input: {
  emails: string[];
  subject: string;
  bodyHtml: string;
  sentBy: string;
}): Promise<BroadcastResult> {
  const start = Date.now();
  const admin = supabaseAdmin();

  // Dedup + normalise. Filter obvious junk so we don't waste a
  // broadcast row on empty strings.
  const clean = Array.from(
    new Set(
      input.emails
        .map((e) => e.trim().toLowerCase())
        .filter((e) => /^\S+@\S+\.\S+$/.test(e)),
    ),
  );

  // Best-effort first-name lookup per email so {{firstName}} still
  // works. Falls back to 'friend' when we don't recognize the email.
  const firstNameByEmail = new Map<string, string | null>();
  if (clean.length > 0) {
    const [{ data: userRows }, { data: waitlistRows }] = await Promise.all([
      admin.from('users').select('email, first_name').in('email', clean),
      admin.from('waitlist').select('email, first_name').in('email', clean),
    ]);
    for (const r of userRows ?? []) {
      firstNameByEmail.set(
        (r.email as string).toLowerCase(),
        (r.first_name as string | null) ?? null,
      );
    }
    for (const r of waitlistRows ?? []) {
      const k = (r.email as string).toLowerCase();
      if (!firstNameByEmail.has(k)) {
        firstNameByEmail.set(k, (r.first_name as string | null) ?? null);
      }
    }
  }

  const recipients: BroadcastRecipient[] = clean.map((email) => ({
    email,
    firstName: firstNameByEmail.get(email) ?? null,
    audienceBucket: 'manual' as unknown as BroadcastRecipient['audienceBucket'],
  }));

  const { data: broadcast, error: bErr } = await admin
    .from('broadcast_emails')
    .insert({
      sent_by: input.sentBy,
      subject: input.subject,
      body_html: input.bodyHtml,
      audience: 'manual_list',
      recipient_count: recipients.length,
    })
    .select('id')
    .single();
  if (bErr || !broadcast) {
    throw new Error(`Failed to create broadcast row: ${bErr?.message ?? 'unknown'}`);
  }
  const broadcastId = broadcast.id as string;

  const failures: BroadcastResult['failures'] = [];
  let succeeded = 0;
  let failed = 0;

  for (let i = 0; i < recipients.length; i += PARALLEL) {
    const chunk = recipients.slice(i, i + PARALLEL);
    const results = await Promise.allSettled(
      chunk.map(async (r) => {
        const firstName = (r.firstName ?? '').trim() || 'friend';
        const bodyForR = input.bodyHtml.replace(
          /\{\{\s*firstName\s*\}\}/g,
          escapeHtml(firstName),
        );
        try {
          await emailProvider().send({
            to: r.email,
            subject: input.subject,
            html: bodyForR,
          });
          return { ok: true as const, r };
        } catch (err) {
          return { ok: false as const, r, error: (err as Error).message };
        }
      }),
    );
    const rows = results.map((res, idx) => {
      const r = chunk[idx]!;
      if (res.status === 'fulfilled' && res.value.ok) {
        succeeded++;
        return {
          broadcast_id: broadcastId,
          email: r.email,
          first_name: r.firstName,
          audience_bucket: 'manual',
          status: 'sent' as const,
          error: null,
        };
      }
      const errMsg: string =
        res.status === 'fulfilled' && !res.value.ok
          ? res.value.error
          : res.status === 'rejected'
            ? (res.reason as Error)?.message ?? 'unknown'
            : 'unknown';
      failed++;
      failures.push({ email: r.email, error: errMsg });
      return {
        broadcast_id: broadcastId,
        email: r.email,
        first_name: r.firstName,
        audience_bucket: 'manual',
        status: 'failed' as const,
        error: errMsg.slice(0, 400),
      };
    });
    if (rows.length > 0) {
      await admin.from('broadcast_recipients').insert(rows);
    }
  }

  const durationMs = Date.now() - start;
  await admin
    .from('broadcast_emails')
    .update({ succeeded, failed, duration_ms: durationMs })
    .eq('id', broadcastId);

  return {
    broadcastId,
    recipientCount: recipients.length,
    succeeded,
    failed,
    durationMs,
    failures,
  };
}

/**
 * Fetch the list of emails that failed on the most recent broadcast.
 * Used by the admin UI to pre-fill the manual-resend textarea.
 */
export async function getLastBroadcastFailures(): Promise<{
  broadcastId: string | null;
  subject: string | null;
  emails: string[];
}> {
  const admin = supabaseAdmin();
  const { data: latest } = await admin
    .from('broadcast_emails')
    .select('id, subject, failed')
    .gt('failed', 0)
    .order('sent_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!latest) return { broadcastId: null, subject: null, emails: [] };
  const { data: rows } = await admin
    .from('broadcast_recipients')
    .select('email')
    .eq('broadcast_id', latest.id)
    .eq('status', 'failed');
  return {
    broadcastId: latest.id as string,
    subject: (latest.subject as string) ?? null,
    emails: (rows ?? []).map((r) => r.email as string),
  };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as Record<string, string>
    )[c] ?? c,
  );
}
