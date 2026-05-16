"use server";
import { redirect } from "next/navigation";
import { createSupabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { evaluateCohortCapacity } from "@/lib/services/billing";
import { publicConfig } from "@/lib/config";
import { getPostHogClient } from "@/lib/posthog-server";
import { nextOnboardingStep } from "@/lib/services/onboarding-route";

/**
 * All auth server actions live in one file so the (auth)/* pages stay
 * thin and presentational.
 */

export async function signInAction(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const sb = createSupabaseServer();
  const { data: signInData, error } = await sb.auth.signInWithPassword({
    email,
    password,
  });
  if (error) redirect(`/login?error=${encodeURIComponent(error.message)}`);
  await sb
    .from("users")
    .update({ last_login_at: new Date().toISOString() })
    .eq("email", email);
  const posthog = getPostHogClient();
  posthog.capture({
    distinctId: signInData.user!.id,
    event: "signed_in",
    properties: { email },
  });
  posthog.identify({ distinctId: signInData.user!.id, properties: { email } });
  await posthog.shutdown();

  // Smart routing: take the user to the step they haven't completed yet,
  // not just /dashboard. So if they signed up but never uploaded a resume,
  // logging back in drops them on /onboarding/upload.
  const { data: row } = await sb
    .from("users")
    .select("profile, locations, user_sheet_id")
    .eq("id", signInData.user!.id)
    .single();
  redirect(nextOnboardingStep(row ?? { profile: null, locations: null, user_sheet_id: null }));
}

export async function signUpAction(formData: FormData) {
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const password = String(formData.get("password") ?? "");
  const firstName = String(formData.get("firstName") ?? "").trim();
  const affected = formData.get("affectedByLayoff") === "true";

  if (!email || !password || !firstName) {
    redirect(
      "/signup?error=" + encodeURIComponent("Please fill in all fields"),
    );
  }

  // Cohort check BEFORE we create an auth user, to avoid orphan rows.
  const capacity = await evaluateCohortCapacity();
  if (capacity.state === "waitlist") {
    redirect("/signup"); // page re-renders waitlist UI
  }

  const sb = createSupabaseServer();
  const { data, error } = await sb.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: `${publicConfig.NEXT_PUBLIC_APP_URL}/api/auth/callback`,
      data: { first_name: firstName },
    },
  });
  if (error) redirect(`/signup?error=${encodeURIComponent(error.message)}`);
  if (!data.user)
    redirect(
      "/signup?error=" + encodeURIComponent("Unknown error creating account"),
    );

  // Create the public.users row (the trigger assigns signup_position + cohort + free_until).
  // We use the admin client so RLS doesn't trip the insert before the user's session is set.
  const admin = supabaseAdmin();
  const { error: insertErr } = await admin.from("users").insert({
    id: data.user.id,
    email,
    first_name: firstName,
    affected_by_layoff: affected,
    declared_at: new Date().toISOString(),
  });
  if (insertErr)
    redirect(`/signup?error=${encodeURIComponent(insertErr.message)}`);

  const posthog = getPostHogClient();
  posthog.capture({
    distinctId: data.user.id,
    event: "signed_up",
    properties: { email, first_name: firstName, affected_by_layoff: affected },
  });
  posthog.identify({
    distinctId: data.user.id,
    properties: { email, first_name: firstName },
  });
  await posthog.shutdown();

  redirect("/onboarding/upload");
}

export async function sendResetAction(formData: FormData) {
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const sb = createSupabaseServer();
  await sb.auth.resetPasswordForEmail(email, {
    redirectTo: `${publicConfig.NEXT_PUBLIC_APP_URL}/reset`,
  });
  // Always redirect to "sent" even if email doesn't exist (privacy).
  redirect("/forgot?sent=1");
}

export async function setNewPasswordAction(formData: FormData) {
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");
  if (password !== confirm) {
    redirect("/reset?error=" + encodeURIComponent("Passwords don't match"));
  }
  const sb = createSupabaseServer();
  const { error } = await sb.auth.updateUser({ password });
  if (error) redirect(`/reset?error=${encodeURIComponent(error.message)}`);
  redirect("/dashboard");
}

export async function signOutAction() {
  const sb = createSupabaseServer();
  const {
    data: { user },
  } = await sb.auth.getUser();
  await sb.auth.signOut();
  if (user) {
    const posthog = getPostHogClient();
    posthog.capture({ distinctId: user.id, event: "signed_out" });
    await posthog.shutdown();
  }
  redirect("/login");
}

export async function joinWaitlistAction(formData: FormData) {
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const firstName = String(formData.get("firstName") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim();
  await supabaseAdmin()
    .from("waitlist")
    .insert({ email, first_name: firstName, reason });
}
