import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { PolishClient } from "./PolishClient";
import type { PolishSession, PolishSessionSummary, PolishFeedback } from "./actions";
import type { UserProfile } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * "Polish my résumé" — Claude reads each bullet the user has on their
 * profile, calls out weak ones, and suggests an outcome-focused rewrite
 * they can accept or skip. No changes happen without the user's click.
 */
export default async function PolishPage() {
  const sb = createSupabaseServer();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) redirect("/login");

  const { data: row } = await sb
    .from("users")
    .select("profile, first_name")
    .eq("id", user.id)
    .single();
  const profile = (row?.profile ?? null) as UserProfile | null;

  if (!profile || !profile.fullName) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-10">
        <div className="card text-center">
          <h1 className="text-2xl font-bold">Upload your résumé first</h1>
          <p className="mt-2 text-sm text-ink-soft">
            We need your parsed profile to run the polish check. It only
            takes a minute.
          </p>
          <Link href="/onboarding/upload" className="btn-primary mt-6 inline-flex">
            Upload résumé →
          </Link>
        </div>
      </div>
    );
  }

  // Flatten to (experienceIndex, bulletIndex, role, company, text) for
  // the client component. Passing raw profile avoids leaking too much.
  const bullets: {
    experienceIndex: number;
    bulletIndex: number;
    role: string;
    company: string;
    text: string;
  }[] = [];
  profile.experience?.forEach((exp, ei) => {
    exp.bullets?.forEach((b, bi) => {
      bullets.push({
        experienceIndex: ei,
        bulletIndex: bi,
        role: exp.title,
        company: exp.company,
        text: b,
      });
    });
  });

  const totalBullets = bullets.length;

  // Pull the last 5 polish sessions + the most recent one's feedback
  // so the client can hydrate without re-running Claude. If the table
  // is empty (user has never analysed before), both are null.
  const admin = supabaseAdmin();
  const { data: sessionRows } = await admin
    .from("polish_sessions")
    .select("id, created_at, total_bullets, weak_bullets, accepted_count, feedback")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(5);
  const rows = (sessionRows ?? []) as Array<{
    id: string;
    created_at: string;
    total_bullets: number;
    weak_bullets: number;
    accepted_count: number;
    feedback: PolishFeedback[];
  }>;

  const sessions: PolishSessionSummary[] = rows.map((r) => ({
    id: r.id,
    createdAt: r.created_at,
    totalBullets: r.total_bullets,
    weakBullets: r.weak_bullets,
    acceptedCount: r.accepted_count,
  }));

  const latestSession: PolishSession | null = rows[0]
    ? {
        id: rows[0].id,
        createdAt: rows[0].created_at,
        totalBullets: rows[0].total_bullets,
        weakBullets: rows[0].weak_bullets,
        acceptedCount: rows[0].accepted_count,
        feedback: rows[0].feedback ?? [],
      }
    : null;

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <header className="mb-6">
        <h1 className="text-3xl font-bold">Polish my résumé</h1>
        <p className="mt-2 text-sm text-ink-soft">
          Relaunch reads every bullet on your résumé, calls out weak
          patterns (activities vs outcomes, missing metrics, buzzwords),
          and suggests a rewrite. You review each one — nothing changes
          until you accept it.
        </p>
        <p className="mt-2 text-xs text-ink-mute">
          Your résumé has {totalBullets} bullet{totalBullets === 1 ? "" : "s"} across{" "}
          {profile.experience?.length ?? 0}{" "}
          {profile.experience?.length === 1 ? "role" : "roles"}.
        </p>
      </header>

      {totalBullets === 0 ? (
        <div className="card text-center">
          <p className="text-sm text-ink-soft">
            No bullets found on your parsed résumé. Upload a version with
            role-level accomplishments listed as bullet points and try
            again.
          </p>
        </div>
      ) : (
        <PolishClient
          initialBullets={bullets}
          initialSessions={sessions}
          initialSession={latestSession}
        />
      )}
    </div>
  );
}
