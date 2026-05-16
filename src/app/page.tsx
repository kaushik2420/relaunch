import Link from 'next/link';
import { Logo } from '@/components/Logo';

export default function Landing() {
  return (
    <main className="min-h-screen">
      <nav className="flex items-center justify-between border-b border-line bg-surface px-7 py-3.5">
        <Logo />
        <div className="flex items-center gap-3 text-sm">
          <Link href="/login" className="text-ink-soft hover:text-ink">
            Sign in
          </Link>
          <Link href="/signup" className="btn-primary">
            Get started
          </Link>
        </div>
      </nav>

      <section className="mx-auto max-w-3xl px-6 py-20 text-center">
        <span className="inline-block rounded-full bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-700">
          Free for the first 500 people who need help
        </span>
        <h1 className="mt-4 text-4xl md:text-5xl font-bold tracking-tight">
          Tough chapter doesn't mean tough story.
        </h1>
        <p className="mt-4 text-lg text-ink-soft">
          Every morning, Relaunch finds the best jobs for you, tailors your resume to each, names a
          person inside who could help, and writes the InMail. You bring the courage.
        </p>
        <div className="mt-8 flex justify-center gap-3">
          <Link href="/signup" className="btn-primary">
            Start your search →
          </Link>
          <Link href="/login" className="btn-ghost">
            I already have an account
          </Link>
        </div>
        <p className="mt-6 text-xs text-ink-mute">
          We never store your resume or job data. Everything lives in your own Google Sheet.
        </p>
      </section>
    </main>
  );
}
