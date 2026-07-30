"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { randomBytes } from "crypto";
import { createSupabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { serverConfig, publicConfig } from "@/lib/config";
import { email } from "@/lib/providers/email";
import { runDailyForAllUsers } from "@/lib/services/backfill-runner";
import { runSentinel } from "@/lib/services/sentinel";

/** Redirect away anyone who isn't the configured admin. */
async function requireAdmin() {
  const sb = createSupabaseServer();
  const {
    data: { user },
  } = await sb.auth.getUser();
  const adminEmail = serverConfig().ADMIN_EMAIL.toLowerCase();
  if (!user || (user.email ?? "").toLowerCase() !== adminEmail) {
    redirect("/login");
  }
}

function inviteEmailHtml(firstName: string | null, link: string): string {
  const hi = firstName ? `Hi ${firstName},` : "Hi there,";
  return `
  <div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;max-width:520px;margin:0 auto;color:#1f2430;line-height:1.55">
    <h2 style="color:#1f2430;margin-bottom:4px">You're in 🌱</h2>
    <p>${hi}</p>
    <p>We reviewed your request for Relaunch — and we'd love to have you in this first small group.</p>
    <p>Here's your private invite link to set up your account. It works once, and it's just for you:</p>
    <p style="margin:26px 0">
      <a href="${link}" style="background:#2c5239;color:#ffffff;text-decoration:none;padding:13px 24px;border-radius:10px;font-weight:600;display:inline-block">
        Set up my account
      </a>
    </p>
    <p style="font-size:13px;color:#5b6477">Or paste this link into your browser:<br>
      <a href="${link}" style="color:#2c5239">${link}</a>
    </p>
    <p style="font-size:13px;color:#5b6477;margin-top:24px">
      A tough chapter doesn't mean a tough story. We're glad you're here.<br>— The Relaunch team
    </p>
  </div>`;
}

/**
 * Approve a waitlist applicant: mint (or reuse) a single-use invite
 * token, email the invite link via Resend, and mark them invited.
 */
export async function approveAndInviteAction(formData: FormData) {
  await requireAdmin();
  const waitlistId = String(formData.get("waitlistId") ?? "").trim();
  if (!waitlistId) {
    redirect("/admin?error=" + encodeURIComponent("Missing applicant id"));
  }

  const admin = supabaseAdmin();
  const { data: wl } = await admin
    .from("waitlist")
    .select("id, email, first_name")
    .eq("id", waitlistId)
    .maybeSingle();
  if (!wl) {
    redirect("/admin?error=" + encodeURIComponent("Applicant not found"));
  }

  // Reuse an existing unused invite for this email, else mint a fresh one.
  const { data: existing } = await admin
    .from("invites")
    .select("token")
    .eq("email", wl.email)
    .is("used_at", null)
    .maybeSingle();

  let token: string | undefined = existing?.token;
  if (!token) {
    token = randomBytes(24).toString("base64url");
    await admin.from("invites").insert({
      token,
      email: wl.email,
      first_name: wl.first_name,
      waitlist_id: wl.id,
      expires_at: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
    });
  }

  const link = `${publicConfig.NEXT_PUBLIC_APP_URL}/signup?invite=${token}`;

  try {
    await email().send({
      to: wl.email,
      subject: "You're in — your Relaunch invite",
      html: inviteEmailHtml(wl.first_name, link),
      text: `You're invited to Relaunch. Set up your account: ${link}`,
    });
  } catch (e) {
    redirect(
      "/admin?error=" +
        encodeURIComponent(
          `Invite created but the email failed to send: ${(e as Error).message}`,
        ),
    );
  }

  await admin
    .from("waitlist")
    .update({ status: "invited", invited_at: new Date().toISOString() })
    .eq("id", wl.id);

  revalidatePath("/admin");
  redirect("/admin?invited=" + encodeURIComponent(wl.email));
}

/**
 * Recovery button: run today's digest for every eligible user right now.
 *
 * Default is "missed only" — skip users who already got a successful
 * digest today (idempotent, safe to hit multiple times). Pass a truthy
 * `force` field to re-run for everyone.
 *
 * Long-running: on Vercel Pro the maxDuration on the action route is 60s.
 * The underlying pipeline runs users 5-at-a-time; ~40 users takes ~2-3
 * minutes wall clock, which exceeds the default. The runDailyForAllUsers
 * result is written to job_runs regardless, so if the browser times out
 * the runs continue in the background and complete. Refresh /admin to
 * see the outcome.
 */
/**
 * On-demand sentinel triage — same code the hourly cron runs. Useful
 * for confirming the sentinel is alive after a code change, or after
 * you've applied a fix to see if the alert clears.
 */
export async function runSentinelNowAction() {
  await requireAdmin();
  try {
    const result = await runSentinel();
    revalidatePath("/admin");
    const flag = [
      result.diagnosis.severity,
      result.notified ? '1' : '0',
    ].join(',');
    redirect(`/admin?sentinel=${encodeURIComponent(flag)}`);
  } catch (err) {
    if ((err as Error).message?.startsWith("NEXT_REDIRECT")) throw err;
    redirect(
      "/admin?error=" +
        encodeURIComponent(`Sentinel failed: ${(err as Error).message}`),
    );
  }
}

export async function runDailyDigestForAllAction(formData: FormData) {
  await requireAdmin();
  const force = formData.get("force") === "1";
  try {
    const s = await runDailyForAllUsers({ force });
    // Encode a compact summary in the URL so the page can render a
    // green banner explaining what happened.
    const compact = [
      s.attempted,
      s.succeeded,
      s.failed,
      s.skipped,
      Math.round(s.elapsedMs / 1000),
    ].join(",");
    revalidatePath("/admin");
    redirect(`/admin?backfill=${encodeURIComponent(compact)}`);
  } catch (err) {
    // NEXT_REDIRECT is thrown internally by redirect() — must be re-thrown.
    if ((err as Error).message?.startsWith("NEXT_REDIRECT")) throw err;
    redirect(
      "/admin?error=" +
        encodeURIComponent(
          `Backfill failed: ${(err as Error).message}`,
        ),
    );
  }
}
