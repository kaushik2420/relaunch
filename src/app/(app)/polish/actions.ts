"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createSupabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { llm } from "@/lib/providers/llm";
import type { UserProfile } from "@/lib/types";

/**
 * Run polishResume for the current user. Returns the per-bullet
 * feedback array — the page renders it into a UI where the user
 * accepts/rejects rewrites individually.
 */
export async function analyseResumeAction() {
  const sb = createSupabaseServer();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) redirect("/login");

  const { data: row } = await sb
    .from("users")
    .select("profile")
    .eq("id", user.id)
    .single();
  const profile = (row?.profile ?? null) as UserProfile | null;
  if (!profile || !profile.fullName) {
    throw new Error("Upload your résumé first — Settings → Your résumé & profile.");
  }

  const { bullets } = await llm().polishResume({ profile });
  return { bullets };
}

/**
 * Apply an accepted rewrite: update the specified experience[].bullets[]
 * entry in the user's profile. One bullet at a time so users can accept
 * some and skip others.
 */
export async function acceptRewriteAction(
  experienceIndex: number,
  bulletIndex: number,
  newText: string,
) {
  const sb = createSupabaseServer();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) redirect("/login");

  const admin = supabaseAdmin();
  const { data: row } = await admin
    .from("users")
    .select("profile")
    .eq("id", user.id)
    .single();
  const profile = (row?.profile ?? null) as UserProfile | null;
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

  const { error } = await admin
    .from("users")
    .update({ profile })
    .eq("id", user.id);
  if (error) {
    console.error("[polish] accept rewrite failed", error);
    throw new Error("Couldn't save — please try again.");
  }
  revalidatePath("/polish");
}
