import { NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { serverConfig } from "@/lib/config";
import {
  generateWeeklyBrief,
  type BoostUserRow,
} from "@/lib/services/boost-engine";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Weekly LinkedIn Boost generation. Runs Monday mornings (vercel.json).
 *
 * Eligibility: is_active = true, has a parsed profile, and either still
 * in their free trial OR holds an active Boost add-on (boost_enabled =
 * true with boost_until in the future).
 *
 * Idempotent — generateWeeklyBrief returns an existing brief if one
 * already exists for the user + week, so re-runs are safe.
 */
export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  const expected = `Bearer ${serverConfig().CRON_SECRET}`;
  if (auth !== expected) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = supabaseAdmin();
  const { data: users, error } = await admin
    .from("users")
    .select(
      "id, profile, role_family, pivot_enabled, pivot_brief, search_query, free_until, boost_enabled, boost_until",
    )
    .eq("is_active", true);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const now = Date.now();
  const eligible = (users ?? []).filter((u) => {
    if (!u.profile || Object.keys(u.profile as object).length === 0)
      return false;
    const inTrial =
      u.free_until && new Date(u.free_until as string).getTime() > now;
    const paidBoost =
      u.boost_enabled &&
      u.boost_until &&
      new Date(u.boost_until as string).getTime() > now;
    return inTrial || paidBoost;
  });

  let ok = 0;
  let failed = 0;
  for (const u of eligible) {
    try {
      await generateWeeklyBrief(u as BoostUserRow);
      ok++;
    } catch (err) {
      console.error("[boost-weekly] failed for user", u.id, err);
      failed++;
    }
  }

  return NextResponse.json({
    ranAt: new Date().toISOString(),
    eligible: eligible.length,
    ok,
    failed,
  });
}
