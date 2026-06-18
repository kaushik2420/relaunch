import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { MatchAppliedButton } from "./MatchAppliedButton";

export const dynamic = "force-dynamic";

interface MatchRow {
  id: string;
  apply_url: string;
  job_title: string;
  company: string;
  match_percent: number | null;
  verify_score: number | null;
  tailored_resume_text: string | null;
  cover_letter_text: string | null;
  applied_at: string | null;
  created_at: string;
}

/**
 * Full ranked list of every match Relaunch has saved for this user.
 *
 * Default view hides matches the user has marked as "applied" — toggle
 * via the ?show=applied query param. Today's top 5 are fully tailored
 * (and arrived in the morning email); the rest are summary-only.
 */
export default async function AllMatchesPage({
  searchParams,
}: {
  searchParams: { show?: string; from?: string };
}) {
  const sb = createSupabaseServer();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) redirect("/login");

  const showApplied = searchParams.show === "applied";
  const watchlistOnly = searchParams.from === "watchlist";

  const admin = supabaseAdmin();

  // Pull watched-company names so we can filter the matches list
  // by ILIKE-OR if the watchlist filter is on. Always pulled (cheap)
  // so we can also show 'No companies watched yet' empty state.
  const { data: watchedRows } = await admin
    .from("watched_companies")
    .select("name")
    .eq("user_id", user.id);
  const watchedNames = (watchedRows ?? []).map(
    (r) => (r.name as string).trim(),
  );

  let baseQuery = admin
    .from("job_matches")
    .select(
      "id, apply_url, job_title, company, match_percent, verify_score, tailored_resume_text, cover_letter_text, applied_at, created_at",
    )
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .order("match_percent", { ascending: false, nullsFirst: false })
    .limit(200);

  // OR together one ILIKE per watched company. PostgREST `.or()` takes
  // a comma-separated list of conditions — escape commas in names just
  // in case ("Procter, Gamble" etc).
  if (watchlistOnly && watchedNames.length > 0) {
    const orExpr = watchedNames
      .map((n) => `company.ilike.%${n.replace(/,/g, "\\,").replace(/\(/g, "\\(").replace(/\)/g, "\\)")}%`)
      .join(",");
    baseQuery = baseQuery.or(orExpr);
  }

  const { data: rows } = showApplied
    ? await baseQuery.not("applied_at", "is", null)
    : await baseQuery.is("applied_at", null);

  // Count the other bucket so we can label the toggle accurately.
  const counterBase = admin
    .from("job_matches")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id);
  const { count: otherCount } = showApplied
    ? await counterBase.is("applied_at", null)
    : await counterBase.not("applied_at", "is", null);

  const all = (rows ?? []) as MatchRow[];
  const groups = groupByDay(all);

  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <header className="mb-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold">
              {showApplied ? "Applied matches" : "All your matches"}
            </h1>
            <p className="mt-1 text-sm text-ink-soft">
              {showApplied
                ? "Roles you've marked as applied. Switch back below to see what's still open to apply to."
                : "Every role Relaunch has surfaced for you, ranked by fit. The top 5 each day arrive fully tailored in your morning email."}
            </p>
          </div>
          <Link
            href={preserveOtherParams({ showApplied: !showApplied, watchlistOnly })}
            className="btn-soft text-xs whitespace-nowrap"
          >
            {showApplied
              ? `Active matches (${otherCount ?? 0}) →`
              : `Applied (${otherCount ?? 0}) →`}
          </Link>
        </div>

        {/* Filter chips */}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="text-xs uppercase tracking-wider text-ink-mute">
            Filter:
          </span>
          <Link
            href={preserveOtherParams({ showApplied, watchlistOnly: false })}
            className={
              !watchlistOnly
                ? "rounded-full bg-brand-500 px-3 py-1 text-xs font-semibold text-white"
                : "rounded-full border border-line bg-white px-3 py-1 text-xs font-semibold text-ink-soft hover:bg-cream-100"
            }
          >
            All sources
          </Link>
          <Link
            href={preserveOtherParams({ showApplied, watchlistOnly: true })}
            className={
              watchlistOnly
                ? "rounded-full bg-brand-500 px-3 py-1 text-xs font-semibold text-white"
                : "rounded-full border border-line bg-white px-3 py-1 text-xs font-semibold text-ink-soft hover:bg-cream-100"
            }
          >
            ⭐ Watchlist only ({watchedNames.length})
          </Link>
        </div>
      </header>

      {all.length === 0 ? (
        <div className="card text-center">
          <h2 className="text-xl font-semibold">
            {watchlistOnly && watchedNames.length === 0
              ? "No watchlist yet"
              : watchlistOnly
                ? "No matches from your watchlist yet"
                : showApplied
                  ? "Nothing here yet"
                  : "No matches yet"}
          </h2>
          <p className="mt-2 text-sm text-ink-soft">
            {watchlistOnly && watchedNames.length === 0 ? (
              <>
                Add companies you&apos;re actively interested in (Stripe,
                Razorpay, Cred…) in Settings, and we&apos;ll pull from their
                career pages in every daily run.
              </>
            ) : watchlistOnly ? (
              <>
                We haven&apos;t found matching roles at your watched
                companies yet. They&apos;ll appear here as soon as the next
                daily run picks them up.
              </>
            ) : showApplied ? (
              "When you mark a match as applied, it'll move here."
            ) : (
              "We'll pull fresh roles every morning. Run a search now from the dashboard if you want to seed your first batch."
            )}
          </p>
          <Link
            href={
              watchlistOnly && watchedNames.length === 0
                ? "/settings"
                : "/dashboard"
            }
            className="btn-primary mt-4 inline-flex"
          >
            {watchlistOnly && watchedNames.length === 0
              ? "Manage watchlist →"
              : "Back to dashboard →"}
          </Link>
        </div>
      ) : (
        <div className="space-y-6">
          {groups.map(({ label, items }) => (
            <section key={label}>
              <h2 className="text-xs font-semibold uppercase tracking-wider text-brand-700">
                {label} · {items.length} {items.length === 1 ? "role" : "roles"}
              </h2>
              <div className="mt-3 space-y-2">
                {items.map((m) => (
                  <MatchRowCard key={m.id} match={m} showApplied={showApplied} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function MatchRowCard({
  match,
  showApplied,
}: {
  match: MatchRow;
  showApplied: boolean;
}) {
  const isTailored =
    !!match.tailored_resume_text || !!match.cover_letter_text;
  const pct = match.match_percent ?? 0;
  return (
    <div className="rounded-xl border border-line bg-surface p-4 shadow-card transition-shadow hover:shadow-lg">
      <div className="flex items-start justify-between gap-3">
        <a
          href={match.apply_url}
          target="_blank"
          rel="noreferrer"
          className="min-w-0 flex-1"
        >
          <div className="font-bold text-ink truncate">{match.job_title}</div>
          <div className="text-sm text-ink-soft truncate">{match.company}</div>
        </a>
        <div className="text-right shrink-0">
          <div className="text-lg font-bold text-brand-500">{pct}%</div>
          <div className="text-[10px] uppercase tracking-wider text-ink-mute">
            match
          </div>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
        {isTailored ? (
          <span className="inline-flex items-center rounded-full bg-success-soft px-2 py-0.5 font-semibold text-success">
            ✓ Tailored
          </span>
        ) : match.verify_score != null ? (
          <span className="inline-flex items-center rounded-full bg-brand-50 px-2 py-0.5 font-semibold text-brand-700">
            ✓ Verified · tailor on the apply page
          </span>
        ) : (
          <span className="inline-flex items-center rounded-full bg-cream-100 px-2 py-0.5 font-semibold text-ink-soft">
            Discovered — worth a look
          </span>
        )}
        <MatchAppliedButton matchId={match.id} appliedAt={match.applied_at} />
        <a
          href={match.apply_url}
          target="_blank"
          rel="noreferrer"
          className="ml-auto text-ink-mute hover:text-ink"
        >
          View role →
        </a>
      </div>
    </div>
  );
}

/** Build a /all-matches URL with the given toggle state, preserving
 *  the orthogonal toggle. Lets users flip one filter without losing
 *  their other selection. */
function preserveOtherParams({
  showApplied,
  watchlistOnly,
}: {
  showApplied: boolean;
  watchlistOnly: boolean;
}): string {
  const params = new URLSearchParams();
  if (showApplied) params.set("show", "applied");
  if (watchlistOnly) params.set("from", "watchlist");
  const qs = params.toString();
  return qs ? `/all-matches?${qs}` : "/all-matches";
}

function groupByDay(rows: MatchRow[]): { label: string; items: MatchRow[] }[] {
  const today = new Date().toDateString();
  const yesterday = new Date(Date.now() - 86400000).toDateString();
  const buckets = new Map<string, MatchRow[]>();
  for (const r of rows) {
    const d = new Date(r.created_at).toDateString();
    if (!buckets.has(d)) buckets.set(d, []);
    buckets.get(d)!.push(r);
  }
  return Array.from(buckets.entries()).map(([d, items]) => {
    let label: string;
    if (d === today) label = "Today";
    else if (d === yesterday) label = "Yesterday";
    else
      label = new Date(d).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      });
    return { label, items };
  });
}
