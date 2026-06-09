import { supabaseAdmin } from "@/lib/supabase/admin";
import { llm } from "@/lib/providers/llm";
import { findRoleFamily } from "@/lib/role-families";
import type { BoostBrief, PivotBrief, UserProfile } from "@/lib/types";

/**
 * Returns the ISO date (YYYY-MM-DD) of the Monday on or before `d`.
 * Used as the canonical week key for boost briefs — one row per
 * user per ISO week.
 */
export function mondayOf(d: Date = new Date()): string {
  const dt = new Date(d);
  dt.setUTCHours(0, 0, 0, 0);
  const day = dt.getUTCDay(); // 0=Sun, 1=Mon, ... 6=Sat
  const offsetToMonday = (day + 6) % 7; // 0 for Mon, ... 6 for Sun
  dt.setUTCDate(dt.getUTCDate() - offsetToMonday);
  return dt.toISOString().slice(0, 10);
}

/** Minimum fields the brief generator needs from a users row. */
export interface BoostUserRow {
  id: string;
  profile: unknown;
  role_family?: string | null;
  pivot_enabled?: boolean | null;
  pivot_brief?: unknown;
  search_query?: string | null;
}

/**
 * Generate this week's brief for a user and save it. Idempotent — if a
 * brief already exists for the user + week we just return it without
 * re-running the LLM, so re-running the cron is safe.
 */
export async function generateWeeklyBrief(
  user: BoostUserRow,
): Promise<BoostBrief | null> {
  const profile = user.profile as UserProfile | null;
  if (!profile || Object.keys(profile).length === 0) return null;
  const weekStarting = mondayOf();
  const admin = supabaseAdmin();

  // Already have one for this week? Return it without re-calling Claude.
  const { data: existing } = await admin
    .from("boost_briefs")
    .select("post_idea, profile_nudge, group_suggestions, timing_tip")
    .eq("user_id", user.id)
    .eq("week_starting", weekStarting)
    .maybeSingle();

  if (existing) {
    return {
      postIdea: existing.post_idea as BoostBrief["postIdea"],
      profileNudge: existing.profile_nudge as BoostBrief["profileNudge"],
      groupSuggestions:
        existing.group_suggestions as BoostBrief["groupSuggestions"],
      timingTip: existing.timing_tip as BoostBrief["timingTip"],
    };
  }

  const rf = user.role_family ? findRoleFamily(user.role_family) : undefined;
  const pivotBrief =
    user.pivot_enabled && user.pivot_brief
      ? (user.pivot_brief as PivotBrief)
      : undefined;
  const searchQuery = (user.search_query ?? "").trim() || undefined;

  const brief = await llm().generateBoostBrief({
    profile,
    roleFamilyLabel: rf?.label,
    pivotBrief,
    searchQuery,
    weekStarting,
  });

  await admin.from("boost_briefs").insert({
    user_id: user.id,
    week_starting: weekStarting,
    post_idea: brief.postIdea,
    profile_nudge: brief.profileNudge,
    group_suggestions: brief.groupSuggestions,
    timing_tip: brief.timingTip,
  });

  return brief;
}

/**
 * Is this user entitled to Boost right now? During the free trial,
 * everyone is. After trial, only paying add-on subscribers (with a valid
 * boost_until window) get access.
 */
export function hasBoostAccess(user: {
  free_until?: string | null;
  is_paying?: boolean | null;
  boost_enabled?: boolean | null;
  boost_until?: string | null;
}): boolean {
  if (user.free_until && new Date(user.free_until) > new Date()) return true;
  if (
    user.boost_enabled &&
    user.boost_until &&
    new Date(user.boost_until) > new Date()
  ) {
    return true;
  }
  return false;
}

// (Boost launch gate removed 2026-06-09 — feature is public. Access is
// now governed entirely by hasBoostAccess() above: free trial OR active
// paid add-on. If we ever need to private-beta something again, use
// the same isBoostUnlocked pattern that lived here in git history.)
