import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createSupabaseServer } from '@/lib/supabase/server';
import { EmpathyBanner } from '@/components/EmpathyBanner';
import { RunNowButton } from '@/components/RunNowButton';
import { MissionChecklist } from '@/components/MissionChecklist';
import { MatchesView } from '@/components/MatchesView';
import { getTodayQuote } from '@/lib/quotes';
import { nextOnboardingStep } from '@/lib/services/onboarding-route';
import { sheets } from '@/lib/providers/sheets';
import { decrypt } from '@/lib/crypto';
import type { SheetMatchRow } from '@/lib/providers/sheets/types';

export const dynamic = 'force-dynamic'; // never cache — Sheet content changes every day

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: { filter?: string };
}) {
  const sb = createSupabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect('/login');
  const showLikedOnly = searchParams.filter === 'liked';

  const { data: row } = await sb
    .from('users')
    .select('first_name, signup_position, cohort, last_run_at, user_sheet_id, profile, locations, google_refresh_token_enc, timezone')
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
  // Greeting follows the user's preferred timezone so "Good morning" still
  // feels right when they open the app from anywhere.
  const tz = (row?.timezone as string | null) || 'Asia/Kolkata';
  const greeting = greetingFor(new Date(), tz);
  const lastRunAt = row?.last_run_at ? new Date(row.last_run_at) : null;

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <header className="flex flex-wrap items-end justify-between gap-4 mb-6">
        <div>
          <h1 className="text-3xl font-bold">{greeting}, {row?.first_name ?? 'friend'} 💼</h1>
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
        <Stat
          highlight
          num={`${stats.profileStrength}%`}
          label="Profile strength"
          sub={stats.profileStrengthHint}
          tooltip="Built from your profile completeness: parsed resume, skills count, preferences saved, and Google connected. Update your profile in Settings to lift this."
        />
        <Stat
          num={String(stats.matchesThisWeek)}
          label="Matches (last 7d)"
          sub={stats.matchesThisWeek > 0 ? '🔍 ranked for you' : 'No matches yet'}
          tooltip="Counts rows added to your Google Sheet in the last 7 days. We pull fresh roles each morning — or hit 'Find matches now' on the right."
        />
        <Stat
          num={String(stats.applicationsSent)}
          label="Applications sent"
          sub={stats.applicationsSent > 0 ? `${stats.awaiting} awaiting reply` : 'Tracked by you'}
          tooltip="Counts rows where the 'Applied' column in your Google Sheet is TRUE. Tick that column as you apply and this updates the next time the dashboard loads."
        />
        <Stat
          num={String(stats.interviews)}
          label="Interviews"
          sub={stats.interviews > 0 ? '🎉 keep going' : "They're ahead"}
          tooltip="Counts rows whose 'Outcome' column in your Sheet mentions interview, screen, or onsite. Type your status in that column as the process moves."
        />
      </div>

      <DailyQuote />


      <div className="grid gap-6 md:grid-cols-[280px_1fr]">
        <aside className="space-y-4">
          <MissionChecklist
            userId={user.id}
            matchesCount={matches.length}
            applicationsSent={stats.applicationsSent}
          />


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
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <h2 className="text-xl font-semibold">
              {showLikedOnly ? 'Your liked roles' : "Today's matches for you"}
            </h2>
            <div className="flex items-center gap-1 text-xs">
              <Link
                href="/dashboard"
                className={`px-3 py-1 rounded-full ${
                  !showLikedOnly ? 'bg-brand-50 text-brand-700 font-semibold' : 'text-ink-soft hover:text-ink'
                }`}
              >
                All
              </Link>
              <Link
                href="/dashboard?filter=liked"
                className={`px-3 py-1 rounded-full ${
                  showLikedOnly ? 'bg-brand-50 text-brand-700 font-semibold' : 'text-ink-soft hover:text-ink'
                }`}
              >
                👍 Liked
              </Link>
            </div>
          </div>

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

          {(() => {
            // Liked-filter + date sort happen server-side; the client
            // <MatchesView> handles view toggle + per-criterion filters
            // + pagination for snappy interaction.
            const visible = matches
              .filter((m) =>
                showLikedOnly ? m.reaction === 'liked' : m.reaction !== 'hidden',
              )
              .sort((a, b) => {
                const da = new Date(a.date).getTime();
                const db = new Date(b.date).getTime();
                if (db !== da) return db - da;
                return b.matchPercent - a.matchPercent;
              });

            if (visible.length === 0 && showLikedOnly) {
              return (
                <p className="mt-4 text-sm text-ink-soft">
                  No liked roles yet. Hit 👍 on a job card to save it here.
                </p>
              );
            }

            if (visible.length === 0) return null;

            return <MatchesView matches={visible} />;
          })()}
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

/** Daily-rotating quote — real attributed sources, no fake testimonials. */
function DailyQuote() {
  const q = getTodayQuote();
  return (
    <div className="rounded-lg bg-gradient-to-br from-brand-500 to-brand-700 p-5 text-white mb-6">
      <p className="text-sm leading-relaxed">"{q.text}"</p>
      <p className="text-xs opacity-80 mt-2">
        — {q.attribution}
        {q.source && <span className="opacity-80"> · {q.source}</span>}
      </p>
    </div>
  );
}


function Stat({
  num,
  label,
  sub,
  highlight,
  tooltip,
}: {
  num: string;
  label: string;
  sub?: string;
  highlight?: boolean;
  tooltip?: string;
}) {
  return (
    <div
      className={`group relative card p-4 ${highlight ? 'bg-gradient-to-br from-brand-500 to-brand-700 text-white border-transparent' : ''}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="text-2xl font-bold">{num}</div>
        {tooltip && (
          <span
            tabIndex={0}
            aria-label={tooltip}
            className={`mt-1 inline-flex h-4 w-4 cursor-help items-center justify-center rounded-full text-[10px] font-bold ${
              highlight
                ? 'bg-white/25 text-white hover:bg-white/35'
                : 'bg-surface-muted text-ink-soft hover:bg-line'
            }`}
          >
            ?
          </span>
        )}
      </div>
      <div className={`text-xs mt-0.5 ${highlight ? 'opacity-90' : 'text-ink-soft'}`}>{label}</div>
      {sub && (
        <div className={`text-xs mt-1 font-semibold ${highlight ? 'opacity-90' : 'text-success'}`}>{sub}</div>
      )}
      {tooltip && (
        // CSS-only tooltip: shown on hover/focus-within of the parent.
        // Positioned below so it doesn't get clipped by the stats row.
        <div
          role="tooltip"
          className="pointer-events-none absolute left-3 right-3 top-full z-10 mt-2 rounded-lg border border-line bg-surface px-3 py-2 text-xs text-ink shadow-lg opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
        >
          {tooltip}
        </div>
      )}
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

/**
 * Greeting in the user's preferred timezone. We use Intl to extract the
 * hour-of-day in that TZ so server clock doesn't matter — a user in
 * Bengaluru opening the app at 10am IST always sees "Good morning"
 * even though the server may be UTC 04:30.
 *
 * Falls back to server-local hour if the timezone string is invalid.
 */
function greetingFor(d: Date, timezone: string): string {
  let h: number;
  try {
    const hourStr = new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      hour12: false,
      timeZone: timezone,
    }).format(d);
    h = Number(hourStr);
    if (!Number.isFinite(h)) h = d.getHours();
  } catch {
    h = d.getHours();
  }
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
