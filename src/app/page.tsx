import Link from "next/link";
import { Logo } from "@/components/Logo";
import { WaitlistForm } from "@/components/WaitlistForm";

export const metadata = {
  title: "Relaunch — your next role, found for you every morning",
  description:
    "Laid off? Relaunch finds roles that genuinely fit you, tailors your resume and cover letter to each, and names someone who could refer you — every morning. Request early access.",
};

const STEPS = [
  {
    n: "1",
    t: "Upload your resume once",
    d: "We read your skills, experience and seniority — then never store the file.",
  },
  {
    n: "2",
    t: "We search every morning",
    d: "Relaunch scans fresh openings, ranks them by real fit, and tailors a resume + cover letter for each.",
  },
  {
    n: "3",
    t: "You just apply",
    d: "Open your Google Sheet, review the matches, reach out to a referral, and hit apply.",
  },
];

const POINTS = [
  "Fresh, well-matched roles delivered every morning",
  "A resume + cover letter tailored to every single posting",
  "Everything tracked in your own Google Sheet — we store nothing",
];

export default function Landing() {
  return (
    <main className="min-h-screen bg-surface">
      {/* nav */}
      <nav className="flex items-center justify-between border-b border-line px-6 py-3.5 md:px-10">
        <Logo />
        <Link href="/login" className="text-sm text-ink-soft hover:text-ink">
          Sign in
        </Link>
      </nav>

      {/* hero */}
      <section className="mx-auto grid max-w-6xl items-center gap-10 px-6 py-12 md:grid-cols-2 md:px-10 md:py-20">
        <div>
          <span className="inline-block rounded-full bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-700">
            Early access · first 40 seats
          </span>
          <h1 className="mt-4 text-4xl font-bold leading-tight tracking-tight md:text-5xl">
            A tough chapter doesn&apos;t
            <br />
            mean a tough story.
          </h1>
          <p className="mt-4 text-lg text-ink-soft">
            Relaunch is a calm, daily job-search companion for tech folks
            navigating a layoff. Every morning it finds roles that genuinely fit
            you, tailors your resume and cover letter to each, and names a person
            who could refer you in.
          </p>
          <ul className="mt-6 space-y-2 text-sm text-ink">
            {POINTS.map((t) => (
              <li key={t} className="flex items-start gap-2">
                <span className="mt-0.5 font-bold text-brand-700">✓</span>
                <span>{t}</span>
              </li>
            ))}
          </ul>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link href="#join" className="btn-primary">
              Request early access →
            </Link>
            <span className="text-xs text-ink-mute">
              We review every profile personally.
            </span>
          </div>
        </div>

        {/* explainer video */}
        <div className="overflow-hidden rounded-2xl border border-line shadow-lg">
          <video
            className="block w-full bg-ink"
            src="/relaunch-walkthrough.mp4"
            poster="/relaunch-poster.png"
            controls
            playsInline
            preload="metadata"
          />
        </div>
      </section>

      {/* how it works */}
      <section className="border-y border-line bg-surface-page py-14">
        <div className="mx-auto max-w-5xl px-6 md:px-10">
          <h2 className="text-center text-2xl font-bold">How Relaunch works</h2>
          <p className="mt-2 text-center text-sm text-ink-soft">
            You bring the courage. We handle the legwork.
          </p>
          <div className="mt-8 grid gap-5 md:grid-cols-3">
            {STEPS.map((s) => (
              <div key={s.n} className="card">
                <div className="grid h-9 w-9 place-items-center rounded-full bg-brand-50 font-bold text-brand-700">
                  {s.n}
                </div>
                <h3 className="mt-3 font-semibold">{s.t}</h3>
                <p className="mt-1 text-sm text-ink-soft">{s.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* join / waitlist */}
      <section id="join" className="mx-auto max-w-5xl px-6 py-16 md:px-10">
        <div className="grid items-center gap-10 md:grid-cols-2">
          <div>
            <h2 className="text-3xl font-bold tracking-tight">
              Be one of the first 40.
            </h2>
            <p className="mt-3 text-ink-soft">
              We&apos;re opening Relaunch slowly, on purpose. Request early
              access and we&apos;ll personally review your profile. If it&apos;s
              a fit, we&apos;ll email you a private invite link to set up your
              account — no public signup, no crowd.
            </p>
            <p className="mt-3 text-sm text-ink-mute">
              Built for people in tech impacted by a layoff. If that&apos;s you,
              you&apos;re exactly who this is for.
            </p>
          </div>
          <div className="card">
            <h3 className="text-lg font-bold">Request early access</h3>
            <p className="mt-1 text-sm text-ink-soft">
              Takes 30 seconds. We&apos;ll be in touch soon.
            </p>
            <div className="mt-4">
              <WaitlistForm />
            </div>
          </div>
        </div>
      </section>

      {/* footer */}
      <footer className="border-t border-line px-6 py-8 md:px-10">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 text-xs text-ink-mute md:flex-row">
          <Logo />
          <p className="text-center">
            We never store your resume or job data — everything lives in your
            own Google Sheet.
          </p>
          <div className="flex items-center gap-4">
            <Link href="/feedback" className="hover:text-ink">
              Feedback
            </Link>
            <span>© {new Date().getFullYear()} Relaunch</span>
          </div>
        </div>
      </footer>
    </main>
  );
}
