"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createSupabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

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
