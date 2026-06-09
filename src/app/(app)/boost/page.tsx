import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { hasBoostAccess, mondayOf } from "@/lib/services/boost-engine";
import { CopyButton } from "./CopyButton";
import { GenerateBriefButton } from "./GenerateBriefButton";

export const dynamic = "force-dynamic";

export default async function BoostPage() {
  const sb = createSupabaseServer();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) redirect("/login");

  const admin = supabaseAdmin();
  const { data: row } = await admin
    .from("users")
    .select(
      "id, profile, free_until, is_paying, boost_enabled, boost_until",
    )
    .eq("id", user.id)
    .single();
  if (!row) redirect("/login");

  // No profile yet → ask them to upload résumé first
  if (!row.profile || Object.keys(row.profile as object).length === 0) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-10">
        <div className="card text-center">
          <h1 className="text-2xl font-bold">Upload your résumé first</h1>
          <p className="mt-2 text-sm text-ink-soft">
            LinkedIn Boost is personalised to your background, so we need your
            résumé before we can write the first brief.
          </p>
          <Link
            href="/onboarding/upload"
            className="btn-primary mt-6 inline-flex"
          >
            Upload résumé →
          </Link>
        </div>
      </div>
    );
  }

  const access = hasBoostAccess({
    free_until: row.free_until as string | null,
    is_paying: row.is_paying as boolean | null,
    boost_enabled: row.boost_enabled as boolean | null,
    boost_until: row.boost_until as string | null,
  });

  if (!access) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-10">
        <div className="card text-center">
          <h1 className="text-2xl font-bold">LinkedIn Boost</h1>
          <p className="mt-3 text-sm text-ink-soft">
            A weekly coaching brief — one tailored post you could write, one
            concrete profile move, two communities to consider, and the best
            time to post.
          </p>
          <p className="mt-3 text-sm text-ink-soft">
            Coming soon as a paid add-on (₹199/month on top of your
            subscription). It&apos;s included free while you&apos;re still in
            your trial — extend your subscription to keep it.
          </p>
          <Link href="/billing" className="btn-primary mt-6 inline-flex">
            Manage subscription
          </Link>
        </div>
      </div>
    );
  }

  // Fetch this week's brief, falling back to the most recent one (e.g. the
  // user opens /boost on a Sunday before Monday's regeneration).
  const weekStarting = mondayOf();
  const { data: thisWeek } = await admin
    .from("boost_briefs")
    .select("week_starting, post_idea, profile_nudge, group_suggestions, timing_tip")
    .eq("user_id", user.id)
    .eq("week_starting", weekStarting)
    .maybeSingle();

  const brief = thisWeek
    ? thisWeek
    : (
        await admin
          .from("boost_briefs")
          .select(
            "week_starting, post_idea, profile_nudge, group_suggestions, timing_tip",
          )
          .eq("user_id", user.id)
          .order("week_starting", { ascending: false })
          .limit(1)
          .maybeSingle()
      ).data;

  if (!brief) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-10">
        <header className="mb-6">
          <h1 className="text-3xl font-bold">LinkedIn Boost</h1>
          <p className="mt-1 text-sm text-ink-soft">
            Your weekly coaching brief — one post idea, one profile move, two
            communities, one timing tip. Tailored to your background.
          </p>
        </header>
        <div className="card text-center">
          <h2 className="text-xl font-semibold">No brief generated yet</h2>
          <p className="mt-2 text-sm text-ink-soft">
            Briefs arrive automatically every Monday. Pull yours now — it takes
            about 10 seconds.
          </p>
          <GenerateBriefButton />
        </div>
      </div>
    );
  }

  const post = brief.post_idea as {
    topic: string;
    angle: string;
    draftMarkdown: string;
  };
  const nudge = brief.profile_nudge as { action: string; how: string };
  const groups = brief.group_suggestions as {
    name: string;
    whyItFits: string;
  }[];
  const timing = brief.timing_tip as {
    day: string;
    timeWindow: string;
    rationale: string;
  };

  const isStale = brief.week_starting !== weekStarting;

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <header className="mb-6">
        <h1 className="text-3xl font-bold">LinkedIn Boost</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Your brief for the week of {fmtDate(brief.week_starting as string)}.
          {isStale && (
            <>
              {" "}This week&apos;s hasn&apos;t generated yet —{" "}
              <span className="text-ink">pull a fresh one below.</span>
            </>
          )}
        </p>
      </header>

      {isStale && (
        <div className="card mb-4 text-center">
          <p className="text-sm text-ink-soft">
            Showing your last brief. Generate a fresh one for this week.
          </p>
          <GenerateBriefButton />
        </div>
      )}

      {/* 1 — Post idea */}
      <section className="card">
        <h2 className="text-xs uppercase tracking-wider text-brand-700">
          This week&apos;s post
        </h2>
        <h3 className="mt-1 text-xl font-bold">{post.topic}</h3>
        <p className="mt-1 text-sm text-ink-soft">{post.angle}</p>
        <pre className="mt-4 whitespace-pre-wrap rounded-lg border border-line bg-surface-page p-4 font-sans text-sm text-ink">
          {post.draftMarkdown}
        </pre>
        <div className="mt-3 flex flex-wrap gap-2">
          <CopyButton text={post.draftMarkdown} label="Copy draft" />
          <a
            href="https://www.linkedin.com/feed/?shareActive=true"
            target="_blank"
            rel="noreferrer"
            className="btn-soft text-xs"
          >
            Open LinkedIn composer ↗
          </a>
        </div>
      </section>

      {/* 2 — Profile move */}
      <section className="card mt-4">
        <h2 className="text-xs uppercase tracking-wider text-brand-700">
          Profile move of the week
        </h2>
        <h3 className="mt-1 text-xl font-bold">{nudge.action}</h3>
        <p className="mt-2 whitespace-pre-line text-sm text-ink">{nudge.how}</p>
      </section>

      {/* 3 — Groups */}
      <section className="card mt-4">
        <h2 className="text-xs uppercase tracking-wider text-brand-700">
          Two communities worth a look
        </h2>
        <ul className="mt-3 space-y-3">
          {groups.map((g, i) => (
            <li key={i}>
              <p className="font-semibold">{g.name}</p>
              <p className="text-sm text-ink-soft">{g.whyItFits}</p>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-ink-mute">
          Search the name on LinkedIn and request to join — group pages move
          around, so the exact title may vary slightly.
        </p>
      </section>

      {/* 4 — Timing */}
      <section className="card mt-4">
        <h2 className="text-xs uppercase tracking-wider text-brand-700">
          Best time to post
        </h2>
        <p className="mt-1 text-lg">
          <strong>{timing.day}</strong>, {timing.timeWindow}
        </p>
        <p className="mt-1 text-sm text-ink-soft">{timing.rationale}</p>
      </section>

      <p className="mt-8 text-center text-xs text-ink-mute">
        Generated by Relaunch, tailored to your profile. Nothing is auto-posted —
        you stay in control.
      </p>
    </div>
  );
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return Number.isFinite(d.getTime())
    ? d.toLocaleDateString(undefined, { month: "short", day: "numeric" })
    : iso;
}
