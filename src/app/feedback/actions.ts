"use server";
import { createSupabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * Store a piece of feedback. Works whether or not the visitor is
 * signed in — if they are, we attach their user id + email.
 */
export async function submitFeedbackAction(formData: FormData) {
  const message = String(formData.get("message") ?? "").trim();
  if (!message) return;

  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const ratingRaw = Number(formData.get("rating"));
  const rating =
    Number.isInteger(ratingRaw) && ratingRaw >= 1 && ratingRaw <= 5
      ? ratingRaw
      : null;

  const sb = createSupabaseServer();
  const {
    data: { user },
  } = await sb.auth.getUser();

  await supabaseAdmin().from("feedback").insert({
    user_id: user?.id ?? null,
    name: name || null,
    email: email || user?.email || null,
    rating,
    message,
  });
}
