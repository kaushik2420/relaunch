"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createSupabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { classifyAtsUrl } from "@/lib/ats-url";
import { sheets as sheetsProvider } from "@/lib/providers/sheets";
import { decrypt } from "@/lib/crypto";

/**
 * Toggle a match's "applied" state. Defaults to marking-as-applied;
 * pass undo=true to clear it.
 *
 * The dashboard + /all-matches default-filter on applied_at IS NULL,
 * so this is how a match disappears from "still to apply" lists.
 */
export async function markAppliedAction(matchId: string, undo = false) {
  const sb = createSupabaseServer();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) redirect("/login");

  const { error } = await supabaseAdmin()
    .from("job_matches")
    .update({
      applied_at: undo ? null : new Date().toISOString(),
    })
    .eq("user_id", user.id)
    .eq("id", matchId);

  if (error) {
    console.error("[mark-applied] failed", error);
    throw new Error("Couldn't update — please try again.");
  }
  revalidatePath("/all-matches");
  revalidatePath("/dashboard");
}

/**
 * Mark applied state via the apply URL (not match id). Used by the
 * dashboard's JobCard, where matches come from the Google Sheet
 * (which doesn't carry a job_matches id).
 *
 * If a job_matches row exists for this URL → flips applied_at.
 * If not → creates a minimal row so the state is captured (sheet
 * matches from before migration 0010 don't have a corresponding
 * job_matches row).
 */
export async function markAppliedByUrlAction(
  url: string,
  title: string,
  company: string,
  undo = false,
) {
  const sb = createSupabaseServer();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) redirect("/login");

  const cls = classifyAtsUrl(url);
  const admin = supabaseAdmin();
  const newAppliedAt = undo ? null : new Date().toISOString();

  // Upsert on (user_id, apply_url). If no row exists we create a
  // summary row with no tailored content; if one exists, only the
  // applied_at + updated_at are touched (text fields untouched).
  const { error } = await admin
    .from("job_matches")
    .upsert(
      {
        user_id: user.id,
        apply_url: cls.canonical,
        ats: cls.ats,
        ats_id: cls.atsId,
        job_title: title.slice(0, 240),
        company: (company || "(unknown company)").slice(0, 240),
        applied_at: newAppliedAt,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,apply_url" },
    );

  if (error) {
    console.error("[mark-applied-by-url] failed", error);
    throw new Error("Couldn't update — please try again.");
  }

  // Best-effort: also update the Google Sheet's "Applied?" column (L)
  // so users who track in the Sheet see the same state. Failure here
  // is non-fatal — the DB write is the source of truth, the Sheet is
  // a mirror.
  try {
    const { data: userRow } = await admin
      .from("users")
      .select("user_sheet_id, google_refresh_token_enc")
      .eq("id", user.id)
      .single();
    if (userRow?.user_sheet_id && userRow.google_refresh_token_enc) {
      const refreshToken = decrypt(userRow.google_refresh_token_enc);
      await sheetsProvider().setApplied({
        spreadsheetId: userRow.user_sheet_id,
        refreshToken,
        company,
        role: title,
        applied: !undo,
      });
    }
  } catch (err) {
    console.error("[mark-applied-by-url] sheet sync failed (non-fatal)", err);
  }

  revalidatePath("/dashboard");
  revalidatePath("/all-matches");
}
