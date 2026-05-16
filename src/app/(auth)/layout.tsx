import { Logo } from '@/components/Logo';
import Link from 'next/link';
import { pickQuotes, type Quote } from '@/lib/quotes';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  // Two real, attributed quotes — picked deterministically per day so the
  // pair rotates daily. No fake user testimonials (see docs/EMPATHY.md).
  const quotes = pickQuotes(2);

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
          {quotes.map((q, i) => (
            <QuoteCard key={i} q={q} />
          ))}
        </div>
      </aside>

      <section className="flex items-center justify-center p-8 md:p-14">
        <div className="w-full max-w-md">{children}</div>
      </section>
    </main>
  );
}

function QuoteCard({ q }: { q: Quote }) {
  return (
    <div className="rounded-lg bg-white/70 backdrop-blur p-4 text-sm">
      <p className="leading-relaxed">"{q.text}"</p>
      <p className="mt-1.5 text-xs font-semibold text-brand-700">
        — {q.attribution}
        {q.source && <span className="font-normal text-ink-soft"> · {q.source}</span>}
      </p>
    </div>
  );
}
