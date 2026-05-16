/**
 * Decide where in the onboarding flow a user should land based on
 * what they've already completed. Single source of truth — called
 * by signInAction (after login), the auth callback (after email
 * confirmation), and the dashboard page (which bounces incomplete
 * users to the right step).
 *
 * Flow order:
 *   1. /onboarding/upload         — no profile parsed yet
 *   2. /onboarding/profile        — profile parsed but no edits saved
 *   3. /onboarding/preferences    — preferences missing
 *   4. /onboarding/connect        — Google not connected
 *   5. /dashboard                 — fully onboarded
 *
 * "Fully onboarded" is intentionally lenient — we only require a
 * parsed profile + at least one location preference. Google connect
 * is encouraged but not required (the dashboard nudges to complete it).
 */

export type OnboardingRow = {
  profile: unknown | null;
  locations: string[] | null;
  user_sheet_id: string | null;
};

export function nextOnboardingStep(row: OnboardingRow): string {
  const hasProfile =
    !!row.profile &&
    typeof row.profile === "object" &&
    Object.keys(row.profile as Record<string, unknown>).length > 0;

  if (!hasProfile) return "/onboarding/upload";

  // Profile exists. Did they finish reviewing + setting preferences?
  if (!row.locations || row.locations.length === 0) {
    return "/onboarding/preferences";
  }

  // Preferences saved. Google connected?
  if (!row.user_sheet_id) {
    return "/onboarding/connect";
  }

  return "/dashboard";
}
