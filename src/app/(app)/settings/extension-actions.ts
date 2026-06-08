"use server";
import crypto from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createSupabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * Generate a fresh extension token for the signed-in user. Replaces any
 * existing token — if a token leaks, the user just hits "Generate" again
 * and the old one stops working immediately.
 *
 * Token format: `rx_<32 url-safe random bytes>`. Stored verbatim — same
 * security level as a session cookie. The unique index in 0009 means
 * collisions are caught at insert time.
 */
export async function generateExtensionTokenAction() {
  const sb = createSupabaseServer();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) redirect("/login");

  const token = `rx_${crypto.randomBytes(32).toString("base64url")}`;

  // Service-role write — RLS would silently no-op the update from the
  // user-scoped client (same pattern as savePreferencesAction).
  const { error } = await supabaseAdmin()
    .from("users")
    .update({ extension_token: token })
    .eq("id", user.id);

  if (error) {
    console.error("[settings] failed to write extension token", error);
    throw new Error("Couldn't generate token — please try again.");
  }

  revalidatePath("/settings");
}

export async function revokeExtensionTokenAction() {
  const sb = createSupabaseServer();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) redirect("/login");

  const { error } = await supabaseAdmin()
    .from("users")
    .update({ extension_token: null })
    .eq("id", user.id);

  if (error) {
    console.error("[settings] failed to revoke extension token", error);
    throw new Error("Couldn't revoke token — please try again.");
  }
  revalidatePath("/settings");
}
