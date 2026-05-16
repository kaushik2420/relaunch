import { Logo } from '@/components/Logo';
import Link from 'next/link';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen grid md:grid-cols-2">
      <aside className="hidden md:flex flex-col justify-center p-14 bg-gradient-to-br from-brand-50 to-accent-50 relative overflow-hidden">
        <Link href="/" className="absolute top-7 left-7">
          <Logo />
        </Link>
        <h1 className="text-4xl font-bold leading-tight max-w-md">
          Your next chapter,<br />found daily.
        </h1>
        <p className="mt-4 max-w-md text-ink-soft">
          A calm, daily co-pilot for tech folks finding their next role after a layoff.
          No spam, no hustle-bro. Just one good lead a day — with everything you need to act on it.
        </p>
        <div className="mt-9 space-y-3 max-w-md">
          <Quote name="Anya, ex-Twitter PM">
            "It found me 3 referrers I'd never have spotted. Two replied. One led to my offer."
          </Quote>
          <Quote name="Sameer, ex-Stripe engineer">
            "The tailored resume saved me hours every day. I just had to show up."
          </Quote>
        </div>
      </aside>

      <section className="flex items-center justify-center p-8 md:p-14">
        <div className="w-full max-w-md">{children}</div>
      </section>
    </main>
  );
}

function Quote({ name, children }: { name: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg bg-white/70 backdrop-blur p-4 text-sm">
      <p>"{children}"</p>
      <p className="mt-1 text-xs font-semibold text-brand-700">— {name}</p>
    </div>
  );
}
