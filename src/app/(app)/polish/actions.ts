"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createSupabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { llm } from "@/lib/providers/llm";
import type { UserProfile } from "@/lib/types";

/**
 * The shape stored in polish_sessions.feedback and passed to the client.
 * accepted/edited are session-local — the profile row is the source of
 * truth for what a user's résumé actually says.
 */
export interface PolishFeedback {
  experienceIndex: number;
  bulletIndex: number;
  role: string;
  company: string;
  original: string;
  feedback: string;
  suggested: string;
  isWeak: boolean;
  accepted?: boolean;
}

export interface PolishSessionSummary {
  id: string;
  createdAt: string;
  totalBullets: number;
  weakBullets: number;
  acceptedCount: number;
}

export interface PolishSession extends PolishSessionSummary {
  feedback: PolishFeedback[];
}

const MAX_VERSIONS = 5;

async function requireUserId(): Promise<string> {
  const sb = createSupabaseServer();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) redirect("/login");
  return user.id;
}

/**
 * Run Claude's polish analysis and persist the result as a new
 * polish_sessions row. Returns the session so the client can hydrate
 * without a second round-trip.
 *
 * If the user already has 5 sessions, the oldest is deleted before
 * this one is created — rolling window, no stale forever-growing table.
 */
export async function analyseResumeAction(): Promise<PolishSession> {
  const userId = await requireUserId();
  const admin = supabaseAdmin();

  const { data: row } = await admin
    .from("users")
    .select("profile")
    .eq("id", userId)
    .single();
  const profile = (row?.profile ?? null) as UserProfile | null;
  if (!profile || !profile.fullName) {
    throw new Error("Upload your résumé first — Settings → Your résumé & profile.");
  }

  const { bullets } = await llm().polishResume({ profile });

  // Enrich each feedback item with role/company from the profile so
  // the client doesn't have to re-join. Keeps the version history
  // panel + card display cheap.
  const feedback: PolishFeedback[] = (bullets ?? []).map((b) => {
    const exp = profile.experience?.[b.experienceIndex];
    return {
      experienceIndex: b.experienceIndex,
      bulletIndex: b.bulletIndex,
      role: exp?.title ?? "",
      company: exp?.company ?? "",
      original: b.original,
      feedback: b.feedback,
      suggested: b.suggested,
      isWeak: b.isWeak,
      accepted: false,
    };
  });

  const totalBullets = feedback.length;
  const weakBullets = feedback.filter((b) => b.isWeak).length;

  const { data: inserted, error } = await admin
    .from("polish_sessions")
    .insert({
      user_id: userId,
      feedback,
      total_bullets: totalBullets,
      weak_bullets: weakBullets,
      accepted_count: 0,
    })
    .select("id, created_at")
    .single();

  if (error || !inserted) {
    console.error("[polish] insert session failed", error);
    throw new Error("Couldn't save the analysis — please try again.");
  }

  await enforceVersionCap(userId);

  revalidatePath("/polish");
  return {
    id: inserted.id,
    createdAt: inserted.created_at as string,
    totalBullets,
    weakBullets,
    acceptedCount: 0,
    feedback,
  };
}

/**
 * Delete all but the 5 most recent sessions for this user. Called after
 * every successful analyseResumeAction so the table stays trim.
 */
async function enforceVersionCap(userId: string): Promise<void> {
  const admin = supabaseAdmin();
  const { data: keepers } = await admin
    .from("polish_sessions")
    .select("id")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(MAX_VERSIONS);
  const keepIds = (keepers ?? []).map((r) => r.id as string);
  if (keepIds.length === 0) return;

  const { error } = await admin
    .from("polish_sessions")
    .delete()
    .eq("user_id", userId)
    .not("id", "in", `(${keepIds.map((id) => `"${id}"`).join(",")})`);
  if (error) {
    console.warn("[polish] enforceVersionCap delete failed", error);
    // Non-fatal — user still sees the latest 5 due to LIMIT elsewhere.
  }
}

/**
 * Apply an accepted rewrite: update the profile bullet AND mark the
 * feedback entry in the session as accepted. Both writes go through
 * the admin client so RLS doesn't get in the way.
 */
export async function acceptRewriteAction(
  sessionId: string,
  experienceIndex: number,
  bulletIndex: number,
  newText: string,
): Promise<void> {
  const userId = await requireUserId();
  const admin = supabaseAdmin();

  // Update the profile bullet — the résumé source of truth.
  const { data: userRow } = await admin
    .from("users")
    .select("profile")
    .eq("id", userId)
    .single();
  const profile = (userRow?.profile ?? null) as UserProfile | null;
  if (!profile || !profile.experience) {
    throw new Error("No profile found.");
  }
  const exp = profile.experience[experienceIndex];
  if (!exp || !exp.bullets) {
    throw new Error("Bullet not found — profile may have changed since analysis.");
  }
  if (bulletIndex < 0 || bulletIndex >= exp.bullets.length) {
    throw new Error("Bullet index out of range.");
  }
  exp.bullets[bulletIndex] = newText.slice(0, 400);

  const { error: profileErr } = await admin
    .from("users")
    .update({ profile })
    .eq("id", userId);
  if (profileErr) {
    console.error("[polish] profile update failed", profileErr);
    throw new Error("Couldn't save — please try again.");
  }

  // Mark the corresponding feedback entry as accepted in the session row.
  const { data: sessionRow } = await admin
    .from("polish_sessions")
    .select("feedback, accepted_count")
    .eq("id", sessionId)
    .eq("user_id", userId)
    .single();
  if (!sessionRow) {
    // Silent — profile was updated, session was maybe rolled off. Not
    // worth surfacing an error to the user.
    revalidatePath("/polish");
    return;
  }

  const feedback = (sessionRow.feedback ?? []) as PolishFeedback[];
  let acceptedDelta = 0;
  for (const item of feedback) {
    if (
      item.experienceIndex === experienceIndex &&
      item.bulletIndex === bulletIndex &&
      !item.accepted
    ) {
      item.accepted = true;
      item.original = newText.slice(0, 400);
      acceptedDelta = 1;
      break;
    }
  }

  await admin
    .from("polish_sessions")
    .update({
      feedback,
      accepted_count: (sessionRow.accepted_count ?? 0) + acceptedDelta,
      updated_at: new Date().toISOString(),
    })
    .eq("id", sessionId);

  revalidatePath("/polish");
}

/**
 * List the user's last 5 polish sessions — summary only (no feedback
 * blob) so the panel loads instantly.
 */
export async function listPolishSessionsAction(): Promise<PolishSessionSummary[]> {
  const userId = await requireUserId();
  const admin = supabaseAdmin();
  const { data } = await admin
    .from("polish_sessions")
    .select("id, created_at, total_bullets, weak_bullets, accepted_count")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(MAX_VERSIONS);
  return (data ?? []).map((r) => ({
    id: r.id as string,
    createdAt: r.created_at as string,
    totalBullets: r.total_bullets as number,
    weakBullets: r.weak_bullets as number,
    acceptedCount: r.accepted_count as number,
  }));
}

/**
 * Load a specific session with its full feedback array. Used when the
 * user clicks View on a past version in the history panel.
 */
export async function loadPolishSessionAction(
  sessionId: string,
): Promise<PolishSession | null> {
  const userId = await requireUserId();
  const admin = supabaseAdmin();
  const { data } = await admin
    .from("polish_sessions")
    .select("id, created_at, total_bullets, weak_bullets, accepted_count, feedback")
    .eq("id", sessionId)
    .eq("user_id", userId)
    .single();
  if (!data) return null;
  return {
    id: data.id as string,
    createdAt: data.created_at as string,
    totalBullets: data.total_bullets as number,
    weakBullets: data.weak_bullets as number,
    acceptedCount: data.accepted_count as number,
    feedback: (data.feedback ?? []) as PolishFeedback[],
  };
}
