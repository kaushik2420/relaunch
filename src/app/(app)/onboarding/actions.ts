"use server";
import { redirect } from "next/navigation";
import { createSupabaseServer } from "@/lib/supabase/server";
import { getPostHogClient } from "@/lib/posthog-server";
import { expandToMatchTerms } from "@/lib/locations";
import { ROLE_FAMILY_IDS } from "@/lib/role-families";
import type { PivotBrief } from "@/lib/types";

export async function saveProfileAction(formData: FormData) {
  const sb = createSupabaseServer();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) redirect("/login");

  // Merge user edits back into the profile jsonb (don't clobber nested fields we don't show)
  const { data: row } = await sb
    .from("users")
    .select("profile")
    .eq("id", user.id)
    .single();
  const existing = (row?.profile ?? {}) as Record<string, unknown>;

  const skillsCsv = String(formData.get("skillsCsv") ?? "");
  const merged = {
    ...existing,
    fullName: String(formData.get("fullName") ?? ""),
    headline: String(formData.get("headline") ?? ""),
    seniority: String(formData.get("seniority") ?? "senior"),
    yearsExperience: Number(formData.get("yearsExperience") ?? 0),
    location: String(formData.get("location") ?? ""),
    skills: skillsCsv
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    links: {
      ...(existing.links as object | undefined),
      linkedin: String(formData.get("linkedin") ?? "") || undefined,
      github: String(formData.get("github") ?? "") || undefined,
    },
  };

  await sb.from("users").update({ profile: merged }).eq("id", user.id);

  const posthog = getPostHogClient();
  posthog.capture({
    distinctId: user.id,
    event: "profile_saved",
    properties: {
      seniority: merged.seniority,
      skills_count: merged.skills.length,
      has_linkedin: !!merged.links.linkedin,
      has_github: !!merged.links.github,
    },
  });
  await posthog.shutdown();

  redirect("/onboarding/preferences");
}

export async function savePreferencesAction(formData: FormData) {
  const sb = createSupabaseServer();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) redirect("/login");

  // New picker-based form: posts one `locationIds` hidden input per selected
  // option. Expand each id to its full list of match terms (e.g. "Bengaluru"
  // → ["Bengaluru", "Bangalore", "BLR"]) so the job matcher catches every
  // common spelling without us touching the filter logic.
  const locationIds = formData.getAll("locationIds").map(String);
  const locations = expandToMatchTerms(locationIds);

  const workModes = formData.getAll("workModes").map(String);

  const emailFrequency = String(formData.get("emailFrequency") ?? "daily");
  const timezone = String(formData.get("timezone") ?? "Asia/Kolkata");
  const roleFamilyRaw = String(formData.get("roleFamily") ?? "").trim();
  const roleFamily = ROLE_FAMILY_IDS.has(roleFamilyRaw) ? roleFamilyRaw : null;

  // Career-pivot fields (from PivotPanel). pivot_brief is a JSON blob;
  // parse defensively — a malformed brief shouldn't break saving prefs.
  const pivotEnabled = String(formData.get("pivotEnabled") ?? "") === "true";
  let pivotBrief: PivotBrief | null = null;
  const pivotBriefRaw = String(formData.get("pivotBrief") ?? "").trim();
  if (pivotEnabled && pivotBriefRaw) {
    try {
      const parsed = JSON.parse(pivotBriefRaw) as PivotBrief;
      if (parsed && typeof parsed.searchQuery === "string") {
        pivotBrief = parsed;
      }
    } catch {
      /* malformed brief — pivot stays on but unrefined; runner falls back */
    }
  }

  // When pivoting with a synthesized role family, that wins over the
  // dropdown — the whole point of pivot mode is to search elsewhere.
  const effectiveRoleFamily =
    pivotEnabled &&
    pivotBrief?.suggestedRoleFamily &&
    ROLE_FAMILY_IDS.has(pivotBrief.suggestedRoleFamily)
      ? pivotBrief.suggestedRoleFamily
      : roleFamily;

  await sb
    .from("users")
    .update({
      locations,
      work_modes: workModes,
      target_ctc: String(formData.get("targetCtc") ?? "") || null,
      notice_period: String(formData.get("noticePeriod") ?? "") || null,
      email_time: String(formData.get("emailTime") ?? "08:30"),
      timezone,
      email_frequency: emailFrequency,
      notes: String(formData.get("notes") ?? "") || null,
      role_family: effectiveRoleFamily,
      pivot_enabled: pivotEnabled,
      pivot_brief: pivotBrief,
    })
    .eq("id", user.id);

  const posthog = getPostHogClient();
  posthog.capture({
    distinctId: user.id,
    event: "preferences_saved",
    properties: {
      locations_count: locations.length,
      work_modes: workModes,
      email_frequency: emailFrequency,
      timezone,
      pivot_enabled: pivotEnabled,
    },
  });
  await posthog.shutdown();

  redirect("/onboarding/connect");
}
