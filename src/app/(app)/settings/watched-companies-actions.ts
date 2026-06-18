"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createSupabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { probeCompany } from "@/lib/services/ats-probe";

const MAX_WATCHED = 20;

/**
 * Add a company to the user's watchlist. Synchronously runs ATS
 * auto-detect so the user sees the result immediately (we can move
 * this to a background job later if the probe gets slow).
 */
export async function addWatchedCompanyAction(formData: FormData) {
  const sb = createSupabaseServer();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) redirect("/login");

  const rawName = String(formData.get("name") ?? "").trim();
  if (!rawName) throw new Error("Company name is required.");
  if (rawName.length > 80) {
    throw new Error("That company name looks too long — please shorten it.");
  }

  // Cap at 20 — anything more than this slows the daily run badly.
  const admin = supabaseAdmin();
  const { count } = await admin
    .from("watched_companies")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id);
  if ((count ?? 0) >= MAX_WATCHED) {
    throw new Error(
      `You've already got ${MAX_WATCHED} watched companies. Remove one before adding another.`,
    );
  }

  // Insert as pending, then update with the probe result. Two-step so
  // we visibly land the row even if probe takes a few seconds.
  const { data: row, error: insertErr } = await admin
    .from("watched_companies")
    .insert({
      user_id: user.id,
      name: rawName,
      detection_status: "pending",
    })
    .select("id")
    .single();
  if (insertErr || !row) {
    if (insertErr?.code === "23505") {
      throw new Error("You're already watching this company.");
    }
    console.error("[watched-companies] insert failed", insertErr);
    throw new Error("Couldn't save — please try again.");
  }

  // Probe synchronously. Worst case ~5s timeout per ATS, but they
  // run in parallel so the whole thing is ~5s ceiling.
  let probe: Awaited<ReturnType<typeof probeCompany>> = null;
  try {
    probe = await probeCompany(rawName);
  } catch (err) {
    console.error("[watched-companies] probe error", err);
  }

  await admin
    .from("watched_companies")
    .update({
      detection_status: probe ? "detected" : "not_found",
      ats: probe?.ats ?? null,
      ats_slug: probe?.slug ?? null,
      detection_attempted_at: new Date().toISOString(),
    })
    .eq("id", row.id);

  revalidatePath("/settings");
}

export async function removeWatchedCompanyAction(formData: FormData) {
  const sb = createSupabaseServer();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) redirect("/login");

  const id = String(formData.get("id") ?? "").trim();
  if (!id) return;

  await supabaseAdmin()
    .from("watched_companies")
    .delete()
    .eq("user_id", user.id)
    .eq("id", id);

  revalidatePath("/settings");
}

/**
 * Manual fallback when ATS auto-detect can't find the company on any
 * supported system. The user pastes the company's careers page URL
 * (e.g. https://hubspot.com/careers/jobs) and we save it as a
 * "manual" entry. We don't yet actively scrape these — v2 will diff
 * the page's link set across days and surface new postings — but
 * collecting the URL today is a no-regrets first step.
 */
export async function setManualCareersUrlAction(formData: FormData) {
  const sb = createSupabaseServer();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) redirect("/login");

  const id = String(formData.get("id") ?? "").trim();
  const rawUrl = String(formData.get("careersUrl") ?? "").trim();
  if (!id || !rawUrl) {
    throw new Error("Careers page URL is required.");
  }

  // Light validation — has to look like a URL, but we don't probe
  // it here. If they typed something nonsensical, the link in the UI
  // will fail visibly and they can edit.
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("That doesn't look like a valid URL. Include https://");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Use an https:// (or http://) URL.");
  }

  const admin = supabaseAdmin();
  const { error } = await admin
    .from("watched_companies")
    .update({
      careers_url: url.toString(),
      detection_status: "manual",
      // Clear any prior ats/ats_slug from a failed probe — we're
      // explicitly choosing the manual path now.
      ats: null,
      ats_slug: null,
    })
    .eq("user_id", user.id)
    .eq("id", id);
  if (error) {
    console.error("[watched-companies] manual url save failed", error);
    throw new Error("Couldn't save the URL — please try again.");
  }
  revalidatePath("/settings");
}

export async function retryWatchedCompanyAction(formData: FormData) {
  const sb = createSupabaseServer();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) redirect("/login");

  const id = String(formData.get("id") ?? "").trim();
  if (!id) return;

  const admin = supabaseAdmin();
  const { data: row } = await admin
    .from("watched_companies")
    .select("id, name")
    .eq("user_id", user.id)
    .eq("id", id)
    .single();
  if (!row) return;

  let probe: Awaited<ReturnType<typeof probeCompany>> = null;
  try {
    probe = await probeCompany(row.name as string);
  } catch (err) {
    console.error("[watched-companies] retry probe error", err);
  }

  await admin
    .from("watched_companies")
    .update({
      detection_status: probe ? "detected" : "not_found",
      ats: probe?.ats ?? null,
      ats_slug: probe?.slug ?? null,
      detection_attempted_at: new Date().toISOString(),
    })
    .eq("id", id);

  revalidatePath("/settings");
}
