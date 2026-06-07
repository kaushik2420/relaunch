"use server";
import { revalidatePath } from "next/cache";
import { createSupabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  generateWeeklyBrief,
  hasBoostAccess,
  type BoostUserRow,
} from "@/lib/services/boost-engine";

/**
 * On-demand brief generation — used when the user lands on /boost
 * before the weekly cron has run (typical: first visit during a week).
 * Re-entrant: generateWeeklyBrief is idempotent.
 */
export async function generateMyBriefAction() {
  const sb = createSupabaseServer();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return;

  const { data: row } = await supabaseAdmin()
    .from("users")
    .select(
      "id, profile, role_family, pivot_enabled, pivot_brief, search_query, free_until, is_paying, boost_enabled, boost_until",
    )
    .eq("id", user.id)
    .single();
  if (!row) return;
  if (
    !hasBoostAccess({
      free_until: row.free_until as string | null,
      is_paying: row.is_paying as boolean | null,
      boost_enabled: row.boost_enabled as boolean | null,
      boost_until: row.boost_until as string | null,
    })
  ) {
    return;
  }
  await generateWeeklyBrief(row as BoostUserRow);
  revalidatePath("/boost");
}
