import { supabaseAdmin } from "@/lib/supabase/admin";
import { isExtensionUnlocked } from "@/lib/extension-gate";

export interface ExtensionAuthOk {
  ok: true;
  userId: string;
  email: string;
  firstName: string | null;
  profile: Record<string, unknown> | null;
}
export interface ExtensionAuthErr {
  ok: false;
  status: 401 | 500;
  message: string;
}

/**
 * Validate a `Bearer <token>` header and return the user it belongs to.
 *
 * Used by every /api/extension/* route. We deliberately don't use the
 * cookie-based session here — extensions run in their own origin
 * (chrome-extension://) and have no Supabase cookies, so the token is
 * the only identity signal we can rely on.
 */
export async function authenticateExtension(
  authHeader: string | null,
): Promise<ExtensionAuthOk | ExtensionAuthErr> {
  if (!authHeader) {
    return {
      ok: false,
      status: 401,
      message: "Missing Authorization header.",
    };
  }
  const m = authHeader.match(/^Bearer\s+(rx_[A-Za-z0-9_-]{20,})$/);
  if (!m) {
    return {
      ok: false,
      status: 401,
      message:
        "Bad token format. Generate a fresh one in Relaunch → Settings → Browser extension.",
    };
  }
  const token = m[1];

  const { data, error } = await supabaseAdmin()
    .from("users")
    .select("id, email, first_name, profile, is_active")
    .eq("extension_token", token)
    .maybeSingle();

  if (error) {
    console.error("[extension-auth] db error", error);
    return { ok: false, status: 500, message: "Server error." };
  }
  if (!data) {
    return {
      ok: false,
      status: 401,
      message:
        "Token not recognised. Regenerate it in Relaunch → Settings → Browser extension.",
    };
  }
  if (!data.is_active) {
    return {
      ok: false,
      status: 401,
      message: "Account is paused. Reach out to hello@get-relaunch.com.",
    };
  }

  // Allowlist gate — the extension feature is beta-only for now. We
  // still validate the token first (so we don't leak which emails are
  // allowlisted) but reject with a generic "feature unavailable"
  // message if the account isn't in the allowlist.
  if (!isExtensionUnlocked(data.email as string)) {
    return {
      ok: false,
      status: 401,
      message:
        "The Relaunch Chrome extension is in private beta. Reach out at hello@get-relaunch.com if you'd like access.",
    };
  }

  return {
    ok: true,
    userId: data.id as string,
    email: data.email as string,
    firstName: (data.first_name as string | null) ?? null,
    profile: (data.profile as Record<string, unknown> | null) ?? null,
  };
}

/**
 * Shared CORS headers. Chrome extension content scripts hit our API from
 * the host page's origin (e.g. https://boards.greenhouse.io), so we have
 * to allow * — but the token requirement means an attacker without the
 * token can still do nothing useful.
 */
export const EXTENSION_CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Max-Age": "86400",
} as const;
