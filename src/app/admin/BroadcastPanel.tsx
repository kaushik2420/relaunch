'use client';
import { useState } from 'react';
import { SubmitButton } from '@/components/SubmitButton';
import {
  previewBroadcastAction,
  sendBroadcastAction,
  sendBroadcastToListAction,
} from './actions';

const AI_DISCOVERED_TEMPLATE = {
  subject: 'New in Relaunch: AI-discovered jobs from the live web ✨',
  body: `<div style="font-family:-apple-system,Segoe UI,sans-serif;max-width:560px;margin:0 auto;color:#1C2220;line-height:1.55;">
  <h2 style="color:#1A3826;margin:0 0 12px;">Hey {{firstName}},</h2>

  <p>A few of you told us the daily match feed felt too narrow &mdash; missing the roles you were actually finding on LinkedIn or company career pages. Fair. We fixed it.</p>

  <p><strong>New feature: ✨ AI-discovered jobs.</strong></p>

  <p>Click <strong>Find matches now</strong> on your dashboard and, alongside our existing 11 job sources, Relaunch now asks OpenAI to search the live web for you &mdash; LinkedIn Jobs, Indeed, employer career pages, ATS listings &mdash; reads 30-50 sources per search, and ranks them against your profile. Each result comes with:</p>

  <ul style="padding-left:20px;">
    <li>A fit score and match reasoning</li>
    <li>Visible evidence links so you can see where we found it</li>
    <li>A direct apply URL (usually the employer's own page)</li>
  </ul>

  <p style="margin:20px 0;">
    <a href="https://www.get-relaunch.com/dashboard?utm_source=email&amp;utm_campaign=ai-discovered-launch"
       style="background:#2C5239;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:600;display:inline-block;">
      Try it now &rarr;
    </a>
  </p>

  <p style="font-size:13px;color:#58665C;">Look for the <strong style="color:#2C5239;">✨ AI-discovered</strong> chip on job cards in your dashboard.</p>

  <p style="font-size:13px;color:#58665C;margin-top:24px;">
    Have feedback? Just reply to this email &mdash; I read every one.<br/>
    &mdash; Kaushik
  </p>
</div>`,
};

interface Props {
  countPreview?: string;
  result?: string;
  /** Emails that failed in the most recent broadcast — pre-fills the
   *  "Send to specific emails" textarea so retrying takes one click. */
  lastFailedEmails?: string[];
  /** Subject of that broadcast, shown alongside the load-failed button
   *  so the admin can tell which broadcast it refers to. */
  lastFailedSubject?: string | null;
}

/**
 * Client component so we can offer a LIVE inline preview of the
 * rendered email as the admin edits subject + body. The two server
 * actions (send + count-preview) still run server-side via form
 * submits — this component just adds the visual preview affordance
 * on top.
 */
export function BroadcastPanel({
  countPreview,
  result,
  lastFailedEmails = [],
  lastFailedSubject = null,
}: Props) {
  const [subject, setSubject] = useState(AI_DISCOVERED_TEMPLATE.subject);
  const [bodyHtml, setBodyHtml] = useState(AI_DISCOVERED_TEMPLATE.body);
  const [previewFirstName, setPreviewFirstName] = useState('Kaushik');
  const [showPreview, setShowPreview] = useState(false);
  const [manualEmails, setManualEmails] = useState('');
  const parsedManualCount = manualEmails
    .split(/[\s,;]+/)
    .map((e) => e.trim())
    .filter((e) => /^\S+@\S+\.\S+$/.test(e)).length;

  // Simple client-side {{firstName}} interpolation for the preview.
  // Server does the real substitution per-recipient at send time.
  const previewHtml = bodyHtml.replace(
    /\{\{\s*firstName\s*\}\}/g,
    escapeHtml(previewFirstName || 'friend'),
  );

  // Parse the server-round-tripped count preview + result banner.
  let previewAudience = '';
  const previewCounts: Record<string, number> = {};
  if (countPreview) {
    const [aud, summary] = decodeURIComponent(countPreview).split('|');
    previewAudience = aud ?? '';
    for (const kv of (summary ?? '').split(',')) {
      const [k, v] = kv.split(':');
      if (k && v) previewCounts[k] = Number(v) || 0;
    }
  }

  let sentSummary: {
    recipients: number;
    succeeded: number;
    failed: number;
    seconds: number;
  } | null = null;
  if (result) {
    const parts = decodeURIComponent(result)
      .split(',')
      .map((n) => Number(n) || 0);
    sentSummary = {
      recipients: parts[0] ?? 0,
      succeeded: parts[1] ?? 0,
      failed: parts[2] ?? 0,
      seconds: parts[3] ?? 0,
    };
  }

  return (
    <div className="mt-8 rounded-xl border border-line bg-surface p-5">
      <h2 className="text-lg font-bold">Broadcast email</h2>
      <p className="mt-1 text-sm text-ink-soft">
        Draft and send an announcement to your audience. Use{' '}
        <code className="rounded bg-surface-page px-1 text-xs">{`{{firstName}}`}</code>{' '}
        in the body — it gets replaced with the recipient&apos;s first name
        (or &ldquo;friend&rdquo; when absent). Sends via Resend, one row
        per recipient logged to broadcast_recipients.
      </p>

      {sentSummary && (
        <div
          className={`mt-3 rounded-lg border p-3 text-sm ${
            sentSummary.failed === 0
              ? 'border-success/30 bg-success-soft text-ink'
              : 'border-warn/30 bg-warn-soft text-ink'
          }`}
        >
          {sentSummary.failed === 0
            ? `✅ Broadcast sent — ${sentSummary.succeeded}/${sentSummary.recipients} succeeded in ${sentSummary.seconds}s.`
            : `⚠️ Broadcast partial — ${sentSummary.succeeded} sent, ${sentSummary.failed} failed in ${sentSummary.seconds}s. Check broadcast_recipients for errors.`}
        </div>
      )}

      {countPreview && Object.keys(previewCounts).length > 0 && (
        <div className="mt-3 rounded-lg border border-brand-100 bg-brand-50/50 p-3 text-sm">
          <div className="font-semibold text-brand-700">
            📬 Would send to {previewCounts.total ?? 0} recipients ({previewAudience})
          </div>
          <div className="mt-1 text-xs text-ink-soft">
            Active users: {previewCounts.active ?? 0} · Invited: {previewCounts.invited ?? 0}
            {' · '}Pending waitlist: {previewCounts.pending ?? 0}
          </div>
        </div>
      )}

      <form action={sendBroadcastAction} className="mt-4 space-y-3">
        <div>
          <label className="label">Audience</label>
          <select
            name="audience"
            className="input"
            defaultValue="active_invitees"
          >
            <option value="active">Active users only</option>
            <option value="active_invitees">
              Active users + invitees (recommended for feature launches)
            </option>
            <option value="everyone">
              Everyone (active + invited + pending waitlist)
            </option>
          </select>
        </div>

        <div>
          <label className="label">Subject</label>
          <input
            name="subject"
            type="text"
            className="input"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            required
          />
        </div>

        <div>
          <label className="label">Body (HTML)</label>
          <textarea
            name="bodyHtml"
            className="input font-mono text-xs"
            rows={16}
            value={bodyHtml}
            onChange={(e) => setBodyHtml(e.target.value)}
            required
          />
        </div>

        {/* Live email preview — client-side render, {{firstName}}
            interpolated with the sample name below. Toggle in/out with
            the button so the panel stays compact when not needed. */}
        <div className="rounded-lg border border-line bg-surface-page p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs font-semibold uppercase tracking-wider text-ink-soft">
              Email preview
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-ink-soft">
                Preview as{' '}
                <input
                  type="text"
                  value={previewFirstName}
                  onChange={(e) => setPreviewFirstName(e.target.value)}
                  className="ml-1 w-28 rounded border border-line bg-surface px-1.5 py-0.5 text-xs"
                  placeholder="firstName"
                />
              </label>
              <button
                type="button"
                onClick={() => setShowPreview((s) => !s)}
                className="btn-soft text-xs"
              >
                {showPreview ? 'Hide preview' : 'Show preview'}
              </button>
            </div>
          </div>

          {showPreview && (
            <div className="mt-3">
              <div className="rounded-md border border-line bg-surface p-3 text-sm">
                <div className="text-xs text-ink-mute">Subject</div>
                <div className="font-semibold">{subject}</div>
              </div>
              <div className="mt-2 rounded-md border border-line bg-white p-2">
                <iframe
                  title="Email preview"
                  srcDoc={previewHtml}
                  className="h-96 w-full border-0"
                  sandbox=""
                />
              </div>
              <p className="mt-2 text-xs text-ink-mute">
                Rendered in a sandboxed iframe. Links inside the preview are
                inert on purpose — click&apos;s a security risk from user-authored
                HTML. When sent, links work normally in the recipient&apos;s inbox.
              </p>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <SubmitButton
            className="btn-primary"
            pendingLabel="Sending… (may take 30-90s)"
          >
            Send broadcast
          </SubmitButton>
          <span className="text-xs text-ink-mute">
            No confirmation dialog — click sends immediately to the selected audience.
          </span>
        </div>
      </form>

      {/* ---- Send to specific emails (manual list / retry) ----
          Shares the subject + body_html from the main form above, so
          you edit once and retry / send to a curated list without
          re-typing content. Uses hidden inputs to forward the current
          state into this form's submit. */}
      <div className="mt-6 rounded-lg border border-line bg-surface-page p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold">Send to specific emails</h3>
            <p className="mt-0.5 text-xs text-ink-soft">
              Comma-, space-, or newline-separated list. Uses the subject
              + body from above. Skip audience — sends to exactly the
              emails you type.
            </p>
          </div>
          {lastFailedEmails.length > 0 && (
            <button
              type="button"
              onClick={() => setManualEmails(lastFailedEmails.join(', '))}
              className="btn-soft text-xs whitespace-nowrap"
              title={
                lastFailedSubject
                  ? `Failed on: "${lastFailedSubject}"`
                  : 'Load failed emails from the last broadcast'
              }
            >
              Load {lastFailedEmails.length} failed from last broadcast ↩
            </button>
          )}
        </div>

        <form action={sendBroadcastToListAction} className="mt-3 space-y-2">
          <input type="hidden" name="subject" value={subject} />
          <input type="hidden" name="bodyHtml" value={bodyHtml} />
          <textarea
            name="emails"
            className="input font-mono text-xs"
            rows={5}
            placeholder={`user1@example.com, user2@example.com\nor one per line`}
            value={manualEmails}
            onChange={(e) => setManualEmails(e.target.value)}
            required
          />
          <div className="flex flex-wrap items-center gap-3">
            <SubmitButton
              className="btn-primary text-sm"
              pendingLabel="Sending…"
            >
              Send to these {parsedManualCount > 0 ? parsedManualCount : ''} email{parsedManualCount === 1 ? '' : 's'}
            </SubmitButton>
            <span className="text-xs text-ink-mute">
              {parsedManualCount > 0
                ? `Parsed ${parsedManualCount} valid address${parsedManualCount === 1 ? '' : 'es'}. Uses the subject + body from the form above.`
                : 'Type or paste email addresses above.'}
            </span>
          </div>
        </form>
      </div>

      {/* Recipient count preview lives in a separate form so it doesn't
          require subject/body. */}
      <form action={previewBroadcastAction} className="mt-3">
        <details className="text-xs text-ink-soft">
          <summary className="cursor-pointer hover:text-ink">
            Not sure how many people this reaches? Preview recipient count →
          </summary>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <select
              name="audience"
              className="input"
              defaultValue="active_invitees"
            >
              <option value="active">Active users only</option>
              <option value="active_invitees">Active + invitees</option>
              <option value="everyone">Everyone</option>
            </select>
            <SubmitButton className="btn-soft" pendingLabel="Counting…">
              Preview count
            </SubmitButton>
          </div>
        </details>
      </form>
    </div>
  );
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as Record<
        string,
        string
      >
    )[c] ?? c,
  );
}
