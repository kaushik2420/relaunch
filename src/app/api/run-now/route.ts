import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { runDailyForUser, type UserRow } from "@/lib/services/daily-runner";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * On-demand version of the daily cron — runs the full pipeline for
 * the currently authenticated user RIGHT NOW, ignoring email_time and
 * frequency settings. Used by the "Run my matches now" button on the
 * dashboard so users (and you) can see results without waiting for the
 * morning batch.
 *
 * Rate-limited at the user level: max 5 runs per hour (enforced via
 * job_runs lookups — see check below).
 */
export async function POST(_req: NextRequest) {
  const sb = createSupabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = supabaseAdmin();

  // Soft rate limit — env-configurable. Default 20/hr is generous enough
  // for active testing but still caps runaway loops. Set RUN_NOW_HOURLY_LIMIT
  // in Vercel env if you want to tune it without a code change.
  const hourlyLimit = Number(process.env.RUN_NOW_HOURLY_LIMIT ?? 20);
  const oneHourAgo = new Date(Date.now() - 60 * 60_000).toISOString();
  const { count } = await admin
    .from("job_runs")
    .select("*", { count: "exact", head: true })
    .eq("user_id", user.id)
    .gte("run_at", oneHourAgo);

  if (typeof count === "number" && count >= hourlyLimit) {
    return NextResponse.json(
      { error: `You've hit ${hourlyLimit} runs this hour. Take 5, then try again.` },
      { status: 429 },
    );
  }

  // Pull the full user row — runDailyForUser needs it complete
  const { data: row, error } = await admin
    .from("users")
    .select(
      "id, email, first_name, profile, locations, work_modes, target_ctc, phone, notice_period, notes, email_frequency, email_time, timezone, google_refresh_token_enc, user_sheet_id, last_run_at, free_until, is_paying, role_family",
    )
    .eq("id", user.id)
    .single();

  if (error || !row) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }
  if (!row.profile || Object.keys(row.profile as object).length === 0) {
    return NextResponse.json(
      { error: "Upload your resume first — we need a profile to match against." },
      { status: 400 },
    );
  }

  const runStart = Date.now();
  try {
    const { matchesFound, emailed, providers } = await runDailyForUser(row as UserRow);
    await admin.from("job_runs").insert({
      user_id: user.id,
      jobs_found: matchesFound,
      jobs_emailed: emailed,
      status: emailed === 0 ? "partial" : "ok",
      duration_ms: Date.now() - runStart,
    });
    await admin
      .from("users")
      .update({ last_run_at: new Date().toISOString() })
      .eq("id", user.id);
    return NextResponse.json({ matchesFound, emailed, providers });
  } catch (err) {
    await admin.from("job_runs").insert({
      user_id: user.id,
      status: "error",
      error: (err as Error).message,
      duration_ms: Date.now() - runStart,
    });
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}
