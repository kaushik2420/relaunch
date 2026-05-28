import Link from 'next/link';
import { sendResetAction } from '../actions';
import { SubmitButton } from '@/components/SubmitButton';

export default function ForgotPage({ searchParams }: { searchParams: { sent?: string; error?: string } }) {
  if (searchParams.sent === '1') {
    return (
      <div>
        <h2 className="text-2xl font-bold">Check your inbox 📬</h2>
        <p className="mt-2 text-sm text-ink-soft">
          We sent a secure link to set a new password. The link is good for 1 hour.
        </p>
        <Link href="/login" className="btn-soft mt-6 inline-flex">← Back to sign in</Link>
      </div>
    );
  }
  return (
    <div>
      <h2 className="text-2xl font-bold">Reset your password</h2>
      <p className="mt-1 text-sm text-ink-soft">It happens. We'll send you a link to set a new one.</p>
      <form action={sendResetAction} className="mt-6 space-y-4">
        <div>
          <label className="label">Email</label>
          <input name="email" type="email" required className="input" autoComplete="email" />
        </div>
        {searchParams.error && <p className="text-sm text-danger">{decodeURIComponent(searchParams.error)}</p>}
        <SubmitButton className="btn-primary w-full" pendingLabel="Sending link…">
          Send reset link
        </SubmitButton>
      </form>
      <p className="mt-4 text-sm text-center">
        <Link href="/login" className="text-brand-700 hover:underline">← Back to sign in</Link>
      </p>
    </div>
  );
}
