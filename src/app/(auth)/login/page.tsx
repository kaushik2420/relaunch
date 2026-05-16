import Link from 'next/link';
import { signInAction } from '../actions';

export default function LoginPage({ searchParams }: { searchParams: { error?: string } }) {
  return (
    <div>
      <h2 className="text-2xl font-bold">Welcome back</h2>
      <p className="mt-1 text-sm text-ink-soft">Glad to see you again.</p>

      <form action={signInAction} className="mt-6 space-y-4">
        <div>
          <label className="label" htmlFor="email">Email</label>
          <input id="email" name="email" type="email" required className="input" autoComplete="email" />
        </div>
        <div>
          <label className="label" htmlFor="password">Password</label>
          <input id="password" name="password" type="password" required className="input" autoComplete="current-password" />
        </div>

        {searchParams.error && (
          <p className="text-sm text-danger">{decodeURIComponent(searchParams.error)}</p>
        )}

        <button type="submit" className="btn-primary w-full">Sign in</button>
      </form>

      <div className="mt-4 flex items-center justify-between text-sm">
        <Link href="/forgot" className="text-brand-700 hover:underline">Forgot password?</Link>
        <Link href="/signup" className="text-ink-soft hover:text-ink">Create account →</Link>
      </div>
    </div>
  );
}
