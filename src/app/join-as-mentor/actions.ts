'use server';
import { redirect } from 'next/navigation';
import { submitPublicMentor } from '@/lib/services/mentors';
import { email as emailProvider } from '@/lib/providers/email';
import { serverConfig } from '@/lib/config';

function parseExpertise(raw: string): string[] {
  return Array.from(
    new Set(
      raw
        .split(/[\n,]+/)
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  );
}

/**
 * Public /join-as-mentor form action. No auth required. Rate-limited
 * implicitly by the honeypot field + basic sanity checks.
 *
 * On success:
 *   - insert mentor row with is_active=false + submission_source=
 *     'public_form' (needs admin approval before appearing on /mentors)
 *   - email admin so they know to review
 *   - redirect to /join-as-mentor?thanks=1
 */
export async function submitMentorApplicationAction(formData: FormData) {
  // Honeypot: real users leave hp_website empty. If it has content,
  // silently pretend success so the bot doesn't retry with a different
  // strategy.
  if (String(formData.get('hp_website') ?? '').trim().length > 0) {
    console.warn('[join-as-mentor] honeypot triggered');
    redirect('/join-as-mentor?thanks=1');
  }

  const name = String(formData.get('name') ?? '').trim();
  const headline = String(formData.get('headline') ?? '').trim();
  const calendarUrl = String(formData.get('calendarUrl') ?? '').trim();
  const submittedEmail = String(formData.get('submittedEmail') ?? '').trim();

  if (!name || !headline || !calendarUrl || !submittedEmail) {
    redirect(
      '/join-as-mentor?error=' +
        encodeURIComponent(
          'Name, email, headline, and calendar link are required.',
        ),
    );
  }
  if (!/^\S+@\S+\.\S+$/.test(submittedEmail)) {
    redirect(
      '/join-as-mentor?error=' +
        encodeURIComponent('That email address looks off — mind checking it?'),
    );
  }

  const bio = String(formData.get('bio') ?? '').trim() || undefined;
  const linkedinUrl = String(formData.get('linkedinUrl') ?? '').trim() || undefined;
  const expertise = parseExpertise(String(formData.get('expertise') ?? ''));
  const sessionLengthMinutes =
    Number(formData.get('sessionLengthMinutes')) || undefined;
  const sessionPriceNote =
    String(formData.get('sessionPriceNote') ?? '').trim() || undefined;
  const submissionNote =
    String(formData.get('submissionNote') ?? '').trim() || undefined;

  let mentorId: string;
  try {
    mentorId = await submitPublicMentor({
      name,
      headline,
      bio,
      calendarUrl,
      linkedinUrl,
      expertise,
      sessionLengthMinutes,
      sessionPriceNote,
      submittedEmail,
      submissionNote,
    });
  } catch (err) {
    if ((err as Error).message?.startsWith('NEXT_REDIRECT')) throw err;
    redirect(
      '/join-as-mentor?error=' +
        encodeURIComponent(
          `Couldn't save your application: ${(err as Error).message}`,
        ),
    );
  }

  // Notify admin so they know a review is waiting. Non-fatal — if the
  // email fails, the row is still in the DB and the /admin/mentors
  // page will surface it.
  try {
    const cfg = serverConfig();
    await emailProvider().send({
      to: cfg.ADMIN_EMAIL,
      subject: `[Relaunch] New mentor application — ${name}`,
      html: renderAdminNotificationHtml({
        name,
        headline,
        submittedEmail,
        bio,
        calendarUrl,
        linkedinUrl,
        expertise,
        sessionLengthMinutes,
        sessionPriceNote,
        submissionNote,
        mentorId,
      }),
    });
  } catch (err) {
    console.error('[join-as-mentor] admin notification failed', err);
  }

  redirect('/join-as-mentor?thanks=1');
}

function renderAdminNotificationHtml(args: {
  name: string;
  headline: string;
  submittedEmail: string;
  bio?: string;
  calendarUrl: string;
  linkedinUrl?: string;
  expertise: string[];
  sessionLengthMinutes?: number;
  sessionPriceNote?: string;
  submissionNote?: string;
  mentorId: string;
}): string {
  const esc = (s: string) =>
    s.replace(/[&<>"]/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c,
    );
  return `<!doctype html>
<html><body style="font-family:-apple-system,Segoe UI,sans-serif;background:#FAF5E9;padding:24px;color:#1C2220;">
<table style="max-width:600px;margin:0 auto;background:#fff;padding:24px;border-radius:14px;">
<tr><td>
  <div style="font-size:12px;color:#8C998F;text-transform:uppercase;letter-spacing:0.05em;">New mentor application</div>
  <h1 style="margin:6px 0 12px;font-size:22px;color:#1A3826;">${esc(args.name)}</h1>
  <p style="margin:0 0 4px;color:#58665C;">${esc(args.headline)}</p>
  <p style="margin:0 0 16px;color:#58665C;font-size:13px;">${esc(args.submittedEmail)}${args.linkedinUrl ? ` · <a href="${esc(args.linkedinUrl)}" style="color:#2C5239;">LinkedIn ↗</a>` : ''}</p>

  ${args.bio ? `<p style="margin:12px 0;font-size:14px;">${esc(args.bio)}</p>` : ''}

  ${args.expertise.length ? `<div style="margin:12px 0;">
    <div style="font-size:11px;color:#58665C;font-weight:600;text-transform:uppercase;">Expertise</div>
    <div style="margin-top:4px;">${args.expertise.map((e) => `<span style="display:inline-block;background:#F4ECD8;color:#1A3826;padding:2px 8px;border-radius:10px;font-size:12px;margin:2px 4px 2px 0;">${esc(e)}</span>`).join('')}</div>
  </div>` : ''}

  <table style="width:100%;font-size:13px;border-collapse:collapse;margin-top:12px;">
    <tr><td style="padding:4px 0;color:#58665C;">Calendar</td><td><a href="${esc(args.calendarUrl)}" style="color:#2C5239;">${esc(args.calendarUrl)} ↗</a></td></tr>
    ${args.sessionLengthMinutes ? `<tr><td style="padding:4px 0;color:#58665C;">Session length</td><td>${args.sessionLengthMinutes} min</td></tr>` : ''}
    ${args.sessionPriceNote ? `<tr><td style="padding:4px 0;color:#58665C;">Price</td><td>${esc(args.sessionPriceNote)}</td></tr>` : ''}
  </table>

  ${args.submissionNote ? `<div style="margin-top:16px;padding:12px;background:#FAF5E9;border-radius:8px;font-size:13px;">
    <div style="font-size:11px;color:#58665C;font-weight:600;text-transform:uppercase;">Note from applicant</div>
    <p style="margin:6px 0 0;">${esc(args.submissionNote)}</p>
  </div>` : ''}

  <p style="margin:24px 0 0;">
    <a href="https://www.get-relaunch.com/admin/mentors?edit=${args.mentorId}" style="background:#2C5239;color:#ffffff;text-decoration:none;padding:10px 20px;border-radius:10px;font-weight:600;display:inline-block;font-size:14px;">Review + approve →</a>
  </p>
</td></tr>
</table></body></html>`;
}
