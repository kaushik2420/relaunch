import Link from 'next/link';
import { Logo } from '@/components/Logo';
import { SubmitButton } from '@/components/SubmitButton';
import { ALL_EXPERTISE_TAGS } from '@/lib/services/mentors';
import { submitMentorApplicationAction } from './actions';

export const dynamic = 'force-dynamic';

/**
 * Public mentor signup form. Anyone with the link can fill it out —
 * no auth required. Submissions default to inactive until admin
 * approves them via /admin/mentors.
 *
 * Kept intentionally outside the (app) layout so it doesn't require
 * login, and off the /mentors path so users don't stumble into a
 * mentor-only signup by accident.
 */
export default function JoinAsMentorPage({
  searchParams,
}: {
  searchParams: { thanks?: string; error?: string };
}) {
  if (searchParams.thanks === '1') {
    return (
      <main className="min-h-screen bg-surface-page">
        <nav className="border-b border-line bg-surface px-6 py-3.5">
          <Logo />
        </nav>
        <div className="mx-auto max-w-2xl px-6 py-16 text-center">
          <h1 className="text-3xl font-bold">Thanks for signing up 🌿</h1>
          <p className="mt-4 text-ink-soft">
            We&apos;ll review your details and add you to the Mentors
            directory within a day or two. If we need anything else,
            we&apos;ll email you at the address you provided.
          </p>
          <p className="mt-6 text-sm text-ink-soft">
            Meanwhile — feel free to check out{' '}
            <Link href="/" className="text-brand-700 hover:underline">
              what Relaunch is
            </Link>
            .
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-surface-page">
      <nav className="border-b border-line bg-surface px-6 py-3.5">
        <Logo />
      </nav>
      <div className="mx-auto max-w-2xl px-6 py-10">
        <h1 className="text-3xl font-bold">Become a Relaunch mentor</h1>
        <p className="mt-2 text-ink-soft">
          Relaunch helps laid-off tech workers land their next role. If
          you&apos;ve been through it — or you just want to help people
          who are going through it now — offer a 1:1 session and
          we&apos;ll surface you to our community. You keep your own
          calendar; we&apos;re just the directory.
        </p>

        {searchParams.error && (
          <p className="mt-4 rounded-lg border border-danger/30 bg-danger-soft p-3 text-sm text-danger">
            {decodeURIComponent(searchParams.error)}
          </p>
        )}

        <form
          action={submitMentorApplicationAction}
          className="mt-8 space-y-4 rounded-xl border border-line bg-surface p-6"
        >
          {/* Honeypot — real users leave this empty, spam bots fill it. */}
          <div className="hidden">
            <label htmlFor="hp-website">Website (leave blank)</label>
            <input
              id="hp-website"
              name="hp_website"
              type="text"
              autoComplete="off"
              tabIndex={-1}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label">Your name*</label>
              <input name="name" type="text" className="input" required />
            </div>
            <div>
              <label className="label">Your email*</label>
              <input
                name="submittedEmail"
                type="email"
                className="input"
                required
                placeholder="you@example.com"
              />
              <p className="mt-1 text-xs text-ink-mute">
                Not shown publicly. We&apos;ll use this to reach out.
              </p>
            </div>
          </div>

          <div>
            <label className="label">Headline*</label>
            <input
              name="headline"
              type="text"
              className="input"
              required
              placeholder="e.g. Ex-VP Product at Flipkart · 15 years scaling PM teams"
            />
            <p className="mt-1 text-xs text-ink-mute">
              A short one-liner that shows on your mentor card.
            </p>
          </div>

          <div>
            <label className="label">Short bio</label>
            <textarea
              name="bio"
              className="input"
              rows={4}
              placeholder="2-4 sentences. What have you done, what will you help with, why do you want to help this cohort?"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label">Calendar link*</label>
              <input
                name="calendarUrl"
                type="url"
                className="input"
                required
                placeholder="https://calendly.com/you/30min"
              />
              <p className="mt-1 text-xs text-ink-mute">
                Calendly, Cal.com, SavvyCal — anywhere users can book.
              </p>
            </div>
            <div>
              <label className="label">LinkedIn</label>
              <input
                name="linkedinUrl"
                type="url"
                className="input"
                placeholder="https://linkedin.com/in/you"
              />
            </div>
          </div>

          <div>
            <label className="label">Expertise (comma or newline separated)</label>
            <textarea
              name="expertise"
              className="input"
              rows={2}
              placeholder="Product Management, Layoff Recovery, Interview Prep"
            />
            <div className="mt-1 flex flex-wrap gap-1">
              <span className="text-xs text-ink-mute">Suggestions:</span>
              {ALL_EXPERTISE_TAGS.slice(0, 12).map((t) => (
                <span
                  key={t}
                  className="rounded-full bg-cream-100 px-2 py-0.5 text-[11px] text-ink-soft"
                >
                  {t}
                </span>
              ))}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label">Session length (minutes)</label>
              <input
                name="sessionLengthMinutes"
                type="number"
                className="input"
                defaultValue={30}
                min={15}
                max={120}
              />
            </div>
            <div>
              <label className="label">Session price note</label>
              <input
                name="sessionPriceNote"
                type="text"
                className="input"
                defaultValue="Free"
                placeholder="Free · ₹500 · Donation-based …"
              />
            </div>
          </div>

          <div>
            <label className="label">Anything else you want us to know?</label>
            <textarea
              name="submissionNote"
              className="input"
              rows={3}
              placeholder="Optional. Availability, preferred cohort, personal story — anything that helps us decide."
            />
          </div>

          <div className="pt-2">
            <SubmitButton
              className="btn-primary w-full sm:w-auto"
              pendingLabel="Submitting…"
            >
              Submit application
            </SubmitButton>
            <p className="mt-3 text-xs text-ink-mute">
              We&apos;ll review your details and get back within a day or two.
              Nothing goes live on the Mentors page until we&apos;ve reviewed.
            </p>
          </div>
        </form>
      </div>
    </main>
  );
}
