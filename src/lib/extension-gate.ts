/**
 * Allowlist for the Browser-extension feature.
 *
 * The extension is a beta we're keeping private to specific accounts
 * until it's stable. Mirrored intent (and code shape) as the
 * isBoostUnlocked gate, but with no time component — pure allowlist.
 *
 * To open it up to everyone, either remove this file's callers OR change
 * `isExtensionUnlocked` to always return `true`. The allowlist set is
 * the single source of truth across:
 *   - /settings (hides the Browser-extension card)
 *   - /api/extension/me + /api/extension/job (returns 401 if not gated in)
 */
export const EXTENSION_ALLOWLIST: ReadonlySet<string> = new Set([
  "kaushikn2416@gmail.com",
]);

export function isExtensionUnlocked(email: string | null | undefined): boolean {
  if (!email) return false;
  return EXTENSION_ALLOWLIST.has(email.trim().toLowerCase());
}
