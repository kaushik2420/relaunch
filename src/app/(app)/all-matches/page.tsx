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
  searchParams: { show?: string };
}) {
  const sb = createSupabaseServer();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) redirect("/login");

  const showApplied = searchParams.show === "applied";

  const admin = supabaseAdmin();
  const baseQuery = admin
    .from("job_matches")
    .select(
      "id, apply_url, job_title, company, match_percent, verify_score, tailored_resume_text, cover_letter_text, applied_at, created_at",
    )
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .order("match_percent", { ascending: false, nullsFirst: false })
    .limit(200);

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
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">
            {showApplied ? "Applied matches" : "All your matches"}
          </h1>
          <p className="mt-1 text-sm text-ink-soft">
            {showApplied
              ? "Roles you've marked as applied. Switch back below to see what's still open to apply to."
              : "Every role Relaunch has surfaced for you, ranked by fit. The top 5 each day arrive fully tailored in your morning email. The rest are summary-only — open one to tailor it on demand."}
          </p>
        </div>
        <Link
          href={showApplied ? "/all-matches" : "/all-matches?show=applied"}
          className="btn-soft text-xs whitespace-nowrap"
        >
          {showApplied
            ? `Active matches (${otherCount ?? 0}) →`
            : `Applied (${otherCount ?? 0}) →`}
        </Link>
      </header>

      {all.length === 0 ? (
        <div className="card text-center">
          <h2 className="text-xl font-semibold">
            {showApplied ? "Nothing here yet" : "No matches yet"}
          </h2>
          <p className="mt-2 text-sm text-ink-soft">
            {showApplied
              ? "When you mark a match as applied, it'll move here."
              : "We'll pull fresh roles every morning. Run a search now from the dashboard if you want to seed your first batch."}
          </p>
          <Link href="/dashboard" className="btn-primary mt-4 inline-flex">
            Back to dashboard →
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
