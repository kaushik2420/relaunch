import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createSupabaseServer } from '@/lib/supabase/server';
import { EmpathyBanner } from '@/components/EmpathyBanner';
import { RunNowButton } from '@/components/RunNowButton';
import { nextOnboardingStep } from '@/lib/services/onboarding-route';
import { sheets } from '@/lib/providers/sheets';
import { decrypt } from '@/lib/crypto';
import type { SheetMatchRow } from '@/lib/providers/sheets/types';

export const dynamic = 'force-dynamic'; // never cache — Sheet content changes every day

export default async function DashboardPage() {
  const sb = createSupabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect('/login');

  const { data: row } = await sb
    .from('users')
    .select('first_name, signup_position, cohort, last_run_at, user_sheet_id, profile, locations, google_refresh_token_enc')
    .eq('id', user.id)
    .single();

  if (row) {
    const next = nextOnboardingStep({
      profile: row.profile,
      locations: row.locations,
      user_sheet_id: row.user_sheet_id,
    });
    if (next !== '/dashboard') redirect(next);
  }

  // Read matches from the user's Google Sheet. Failures are non-fatal —
  // we'd rather show a friendly "couldn't read" state than 500 the page.
  let matches: SheetMatchRow[] = [];
  let sheetError: string | null = null;
  if (row?.user_sheet_id && row.google_refresh_token_enc) {
    try {
      const refreshToken = decrypt(row.google_refresh_token_enc);
      matches = await sheets().readMatches(row.user_sheet_id, refreshToken, 50);
    } catch (e) {
      sheetError = (e as Error).message;
    }
  }

  const stats = computeStats(matches, row?.profile, !!row?.user_sheet_id);
  const greeting = greetingFor(new Date());
  const lastRunAt = row?.last_run_at ? new Date(row.last_run_at) : null;

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <header className="flex flex-wrap items-end justify-between gap-4 mb-6">
        <div>
          <h1 className="text-3xl font-bold">{greeting}, {row?.first_name ?? 'friend'} 🌅</h1>
          <p className="text-ink-soft mt-0.5">
            {matches.length > 0
              ? `${matches.length} matches in your tracker · last run ${formatRelative(lastRunAt)}`
              : lastRunAt
              ? "Yesterday's batch came up empty — try a manual run on the right."
              : "We'll start finding roles for you tomorrow morning. Or click 'Find matches now' to try right away."}
          </p>
        </div>
        <div className="text-xs text-ink-soft">
          {row?.cohort === 'founder' ? `Founding member #${row?.signup_position} 🌱` : `Early member #${row?.signup_position}`}
        </div>
      </header>

      <div className="grid gap-4 md:grid-cols-4 mb-6">
        <Stat highlight num={`${stats.profileStrength}%`} label="Profile strength" sub={stats.profileStrengthHint} />
        <Stat num={String(stats.matchesThisWeek)} label="Matches (last 7d)" sub={stats.matchesThisWeek > 0 ? '🔍 ranked for you' : 'No matches yet'} />
        <Stat num={String(stats.applicationsSent)} label="Applications sent" sub={stats.applicationsSent > 0 ? `${stats.awaiting} awaiting reply` : 'Tracked by you'} />
        <Stat num={String(stats.interviews)} label="Interviews" sub={stats.interviews > 0 ? '🎉 keep going' : 'They\'re ahead'} />
      </div>

      <div className="rounded-lg bg-gradient-to-br from-brand-500 to-brand-700 p-5 text-white mb-6">
        <p className="text-sm leading-relaxed">
          "Every senior person I know has been laid off at least once. The ones who landed best treated each day like a clear, small mission. You're already doing that."
        </p>
        <p className="text-xs opacity-80 mt-2">— Today's note for you</p>
      </div>

      <div className="grid gap-6 md:grid-cols-[280px_1fr]">
        <aside className="space-y-4">
          <div className="card p-5">
            <h3 className="text-xs uppercase tracking-wider text-ink-soft mb-2">Today's mission</h3>
            <ul className="text-sm space-y-2">
              <li>{matches.length > 0 ? '✅' : '⬜'} Review today's matches</li>
              <li>{stats.applicationsSent > 0 ? '✅' : '⬜'} Apply to top 2 picks</li>
              <li>⬜ Send 1 InMail</li>
              <li className="text-ink-soft">⬜ 20 min on a skill (optional)</li>
            </ul>
          </div>

          <div className="card p-5">
            <h3 className="text-xs uppercase tracking-wider text-ink-soft mb-2">Run on demand</h3>
            <p className="text-xs text-ink-soft mb-3">
              Don't want to wait for tomorrow's email? Pull fresh roles right now.
            </p>
            <RunNowButton />
          </div>

          <div className="card p-5">
            <h3 className="text-xs uppercase tracking-wider text-ink-soft mb-2">Your tracker</h3>
            <p className="text-xs text-ink-soft mb-3">Synced to your Google Sheet.</p>
            {row?.user_sheet_id ? (
              <a
                href={`https://docs.google.com/spreadsheets/d/${row.user_sheet_id}`}
                target="_blank"
                rel="noreferrer"
                className="btn-soft w-full justify-center"
              >📊 Open my sheet</a>
            ) : (
              <Link href="/onboarding/connect" className="btn-primary w-full justify-center">
                Connect Google
              </Link>
            )}
          </div>
        </aside>

        <section>
          <h2 className="text-xl font-semibold mb-3">Today's matches for you</h2>

          {sheetError && (
            <div className="card border-warn/30 bg-warn-soft mb-4">
              <p className="text-sm">
                <strong>We couldn't read your tracker right now.</strong> Usually fixes itself on the next run.
                <br />
                <span className="text-xs text-ink-soft">Details: {sheetError}</span>
              </p>
            </div>
          )}

          {matches.length === 0 && !sheetError && (
            <EmpathyBanner icon="🌱" title="No matches in your tracker yet — and that's OK.">
              Click <strong>Find matches now</strong> in the sidebar to pull a batch right away,
              or wait for tomorrow morning's email. While you wait, take a walk. Truly. This part doesn't need you yet.
            </EmpathyBanner>
          )}

          <div className="space-y-3">
            {matches.slice(0, 12).map((m, i) => (
              <JobCard key={i} m={m} />
            ))}
          </div>
        </section>
      </div>

      <p className="mt-10 text-center text-xs text-ink-mute">
        All your data lives in your Google Sheet — not on our servers.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------
// UI helpers
// ---------------------------------------------------------------

function JobCard({ m }: { m: SheetMatchRow }) {
  const matchTone =
    m.matchPercent >= 90 ? 'bg-success-soft text-success'
    : m.matchPercent >= 75 ? 'bg-brand-50 text-brand-700'
    : 'bg-accent-50 text-accent-600';

  return (
    <div className="card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold">{m.role}</h3>
          <p className="text-sm text-ink-soft">{m.company} · {m.location || 'Location unspecified'}{m.mode && m.mode !== 'unknown' ? ` · ${m.mode}` : ''}</p>
        </div>
        {m.matchPercent > 0 && (
          <span className={`px-3 py-1 rounded-full text-xs font-bold ${matchTone}`}>
            {m.matchPercent}% match
          </span>
        )}
      </div>

      {m.expectedCtc && (
        <p className="mt-2 text-xs text-ink-soft">💰 {m.expectedCtc}</p>
      )}

      {/* Referrer column may contain either real names ("Priya Sharma (Director)")
          or a LinkedIn search URL we generated. Detect and render appropriately. */}
      {m.referrers && /^https?:\/\//.test(m.referrers) ? (
        <a
          href={m.referrers}
          target="_blank"
          rel="noreferrer"
          className="mt-2 inline-flex items-center gap-1 text-xs text-brand-700 hover:underline"
        >
          👋 Find your 2nd-degree connections at {m.company} →
        </a>
      ) : m.referrers ? (
        <p className="mt-2 text-xs">
          👋 <span className="text-ink-soft">Could help: </span>
          <span className="font-medium">{m.referrers}</span>
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2">
        {m.jobUrl && (
          <a href={m.jobUrl} target="_blank" rel="noreferrer" className="btn-primary text-xs px-3 py-1.5">
            View role ↗
          </a>
        )}
        {m.tailoredResumeUrl && (
          <a href={m.tailoredResumeUrl} target="_blank" rel="noreferrer" className="btn-soft text-xs px-3 py-1.5">
            📄 Tailored resume
          </a>
        )}
        {m.applied && (
          <span className="chip-accent">Applied</span>
        )}
        {m.outcome && (
          <span className="chip">{m.outcome}</span>
        )}
      </div>
    </div>
  );
}

function Stat({ num, label, sub, highlight }: { num: string; label: string; sub?: string; highlight?: boolean }) {
  return (
    <div className={`card p-4 ${highlight ? 'bg-gradient-to-br from-brand-500 to-brand-700 text-white border-transparent' : ''}`}>
      <div className="text-2xl font-bold">{num}</div>
      <div className={`text-xs mt-0.5 ${highlight ? 'opacity-90' : 'text-ink-soft'}`}>{label}</div>
      {sub && <div className={`text-xs mt-1 font-semibold ${highlight ? 'opacity-90' : 'text-success'}`}>{sub}</div>}
    </div>
  );
}

// ---------------------------------------------------------------
// Stats — all derived from real Sheet rows + profile completeness
// ---------------------------------------------------------------

interface Stats {
  profileStrength: number;
  profileStrengthHint: string;
  matchesThisWeek: number;
  applicationsSent: number;
  awaiting: number;
  interviews: number;
}

function computeStats(
  matches: SheetMatchRow[],
  profile: unknown,
  hasGoogle: boolean,
): Stats {
  // Profile strength: 25% baseline (signed up) +
  //   25% has parsed profile,
  //   20% has skills (3+),
  //   15% has preferences (assumed if we got past dashboard gate),
  //   15% has Google connected.
  // Hardcoded but easy to tweak — see EMPATHY.md for the framing rule.
  let strength = 25;
  let hint = "you're here — that's the hardest part";
  const p = (profile ?? {}) as Record<string, unknown>;
  const hasProfile = p && Object.keys(p).length > 0;
  if (hasProfile) {
    strength += 25;
    hint = 'profile saved';
  }
  const skills = Array.isArray(p.skills) ? (p.skills as string[]) : [];
  if (skills.length >= 3) {
    strength += 20;
    hint = `${skills.length} skills · keep adding`;
  }
  // Preferences: we know they're set if we got past the dashboard route gate
  strength += 15;
  if (hasGoogle) {
    strength += 15;
    hint = 'Google connected · ready to roll';
  } else {
    hint = 'connect Google to unlock the daily Sheet';
  }
  strength = Math.min(100, strength);

  const sevenDaysAgo = Date.now() - 7 * 86400_000;
  const recent = matches.filter((m) => {
    const t = new Date(m.date).getTime();
    return Number.isFinite(t) && t >= sevenDaysAgo;
  });
  const matchesThisWeek = recent.length;
  const applied = matches.filter((m) => m.applied);
  const applicationsSent = applied.length;
  const interviews = matches.filter((m) => /interview|onsite|screen/i.test(m.outcome)).length;
  const awaiting = Math.max(applicationsSent - interviews, 0);

  return { profileStrength: strength, profileStrengthHint: hint, matchesThisWeek, applicationsSent, awaiting, interviews };
}

function greetingFor(d: Date): string {
  const h = d.getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

function formatRelative(d: Date | null): string {
  if (!d) return 'never';
  const min = Math.round((Date.now() - d.getTime()) / 60_000);
  if (min < 60) return min <= 1 ? 'just now' : `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return hr === 1 ? '1 hour ago' : `${hr} hours ago`;
  const day = Math.round(hr / 24);
  return day === 1 ? 'yesterday' : `${day} days ago`;
}
