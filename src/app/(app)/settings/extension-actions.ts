"use server";
import crypto from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createSupabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { decrypt } from "@/lib/crypto";
import { sheets as sheetsProvider } from "@/lib/providers/sheets";
import { classifyAtsUrl } from "@/lib/ats-url";

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

/**
 * One-shot backfill: pulls every past match from the user's Google
 * Sheet and inserts it into job_matches so the Chrome extension can
 * find them.
 *
 * Limitations (forward-only nuance the UI calls out):
 *  - Tailored resume/cover-letter TEXT was never persisted before
 *    migration 0010, so text fields land as null. PDF URLs are
 *    preserved — the extension will offer "Download tailored PDF"
 *    even when text isn't available.
 *  - Profile fields (name, email, phone, LinkedIn) still fill from
 *    the user's profile, which is what most form fields care about.
 *
 * Idempotent: upsert on (user_id, apply_url). Safe to re-run.
 */
export async function syncMatchesFromSheetAction(): Promise<{
  ok: boolean;
  inserted?: number;
  skipped?: number;
  reason?: string;
}> {
  const sb = createSupabaseServer();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) redirect("/login");

  const { data: row } = await supabaseAdmin()
    .from("users")
    .select("user_sheet_id, google_refresh_token_enc")
    .eq("id", user.id)
    .single();
  if (!row?.user_sheet_id || !row.google_refresh_token_enc) {
    return {
      ok: false,
      reason:
        "You haven't connected Google yet. Connect a Google account on /onboarding/connect and let one daily run populate your Sheet, then come back.",
    };
  }

  let matches;
  try {
    const refreshToken = decrypt(row.google_refresh_token_enc);
    matches = await sheetsProvider().readMatches(
      row.user_sheet_id,
      refreshToken,
      500, // generous cap — sheets rarely exceed this
    );
  } catch (err) {
    console.error("[extension] sync: readMatches failed", err);
    return {
      ok: false,
      reason:
        "Couldn't read your Sheet — your Google token may need a refresh. Reconnect at /onboarding/connect and try again.",
    };
  }

  // Build job_matches rows. Skip rows missing the apply URL — they're
  // unusable for the extension since it matches by URL.
  const rowsToWrite = matches
    .filter((m) => m.jobUrl && m.jobUrl.startsWith("http"))
    .map((m) => {
      const cls = classifyAtsUrl(m.jobUrl);
      return {
        user_id: user.id,
        apply_url: cls.canonical,
        ats: cls.ats,
        ats_id: cls.atsId,
        job_title: m.role || "(untitled)",
        company: m.company || "(unknown)",
        match_percent: m.matchPercent ?? null,
        tailored_resume_text: null,
        tailored_resume_pdf_url: m.tailoredResumeUrl || null,
        tailored_resume_doc_url: m.tailoredResumeDocUrl || null,
        cover_letter_text: null,
        cover_letter_pdf_url: m.coverLetterUrl || null,
        cover_letter_doc_url: m.coverLetterDocUrl || null,
        why_this_role: null,
        summary: null,
        updated_at: new Date().toISOString(),
      };
    });

  if (rowsToWrite.length === 0) {
    return { ok: true, inserted: 0, skipped: matches.length };
  }

  const { error } = await supabaseAdmin()
    .from("job_matches")
    .upsert(rowsToWrite, { onConflict: "user_id,apply_url" });

  if (error) {
    console.error("[extension] sync: upsert failed", error);
    return { ok: false, reason: "Database error — see server logs." };
  }

  revalidatePath("/settings");
  return {
    ok: true,
    inserted: rowsToWrite.length,
    skipped: matches.length - rowsToWrite.length,
  };
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
