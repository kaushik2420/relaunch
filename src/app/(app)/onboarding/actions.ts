"use server";
import { redirect } from "next/navigation";
import { createSupabaseServer } from "@/lib/supabase/server";
import { getPostHogClient } from "@/lib/posthog-server";

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

  const locations = String(formData.get("locations") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const workModes = formData.getAll("workModes").map(String);

  const emailFrequency = String(formData.get("emailFrequency") ?? "daily");
  const timezone = String(formData.get("timezone") ?? "Asia/Kolkata");

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
    },
  });
  await posthog.shutdown();

  redirect("/onboarding/connect");
}
