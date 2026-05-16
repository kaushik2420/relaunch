import Link from 'next/link';
import { evaluateCohortCapacity } from '@/lib/services/billing';
import { signUpAction } from '../actions';
import { EmpathyBanner } from '@/components/EmpathyBanner';
import { WaitlistForm } from './WaitlistForm';

export default async function SignupPage({ searchParams }: { searchParams: { error?: string } }) {
  const capacity = await evaluateCohortCapacity();

  if (capacity.state === 'waitlist') {
    return (
      <div>
        <h2 className="text-2xl font-bold">We're at capacity 🌱</h2>
        <p className="mt-2 text-sm text-ink-soft">
          Relaunch's first 500 spots are taken. We'll open more soon — leave your email and we'll
          let you know the moment a seat opens.
        </p>
        <div className="mt-6">
          <WaitlistForm />
        </div>
      </div>
    );
  }

  const cohortCopy =
    capacity.cohort === 'founder'
      ? `You'll be one of our first ${capacity.trialDays}-day-free founders.`
      : `Free for your first ${capacity.trialDays} days. ₹399/month after that.`;

  return (
    <div>
      <h2 className="text-2xl font-bold">A fresh start, on us</h2>
      <p className="mt-1 text-sm text-ink-soft">{cohortCopy}</p>

      <div className="mt-5">
        <EmpathyBanner icon="🌱" title="Relaunch's first 500 spots are for people who need help.">
          We built this for folks in tech impacted by layoffs. If that's you, you're in the
          right place.
        </EmpathyBanner>
      </div>

      <form action={signUpAction} className="mt-6 space-y-4">
        <div>
          <label className="label" htmlFor="firstName">First name</label>
          <input id="firstName" name="firstName" required className="input" autoComplete="given-name" />
        </div>
        <div>
          <label className="label" htmlFor="email">Email</label>
          <input id="email" name="email" type="email" required className="input" autoComplete="email" />
        </div>
        <div>
          <label className="label" htmlFor="password">Create password</label>
          <input
            id="password"
            name="password"
            type="password"
            minLength={8}
            required
            className="input"
            autoComplete="new-password"
          />
          <p className="mt-1 text-xs text-ink-mute">At least 8 characters.</p>
        </div>

        {/* Voluntary layoff declaration */}
        <label className="flex items-start gap-3 rounded-lg border border-line bg-surface-page p-3 text-sm cursor-pointer">
          <input
            type="checkbox"
            name="affectedByLayoff"
            value="true"
            className="mt-0.5 h-4 w-4 accent-brand-500"
          />
          <span>
            <strong className="block">I'm currently affected by a layoff and looking for my next role.</strong>
            <span className="block text-ink-soft mt-0.5">
              Voluntary — won't affect your access. We ask only to make sure our first 500 spots go to
              people who need them most. Never shared, never sold.
            </span>
          </span>
        </label>

        {searchParams.error && (
          <p className="text-sm text-danger">{decodeURIComponent(searchParams.error)}</p>
        )}

        <button type="submit" className="btn-primary w-full">Create account</button>

        <p className="text-xs text-ink-mute">
          By signing up you agree to our <Link href="/legal/terms" className="underline">Terms</Link>{' '}
          &amp; <Link href="/legal/privacy" className="underline">Privacy</Link>. We never sell your data.
        </p>
      </form>

      <p className="mt-4 text-sm text-center text-ink-soft">
        Already have an account?{' '}
        <Link href="/login" className="text-brand-700 hover:underline font-medium">
          Sign in
        </Link>
      </p>
    </div>
  );
}
