import { NextResponse, type NextRequest } from "next/server";
import { google, type Auth } from "googleapis";
import { serverConfig } from "@/lib/config";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { encrypt } from "@/lib/crypto";
import { sheets } from "@/lib/providers/sheets";
import { verifyOAuthState } from "@/lib/oauth-state";
import { getPostHogClient } from "@/lib/posthog-server";

/**
 * Google OAuth callback.
 *
 * IMPORTANT: We do NOT call sb.auth.getUser() here. Reason: the
 * Supabase session cookie can be stale or partially missing after
 * the Google round-trip (Route Handlers can't reliably refresh
 * cookies, and Google's redirect occasionally trips cookie quirks).
 *
 * Instead, we verify the signed `state` we minted in /api/google/oauth
 * and use that to identify the user. The signature stops anyone from
 * forging a state for a different user id.
 *
 * After completing the work, we redirect to /onboarding/connect with
 * a success flag rather than /dashboard, so a stale-cookie user sees a
 * confirmation page (with a fresh sign-in link if needed) instead of
 * being bounced to /login mid-flow.
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) {
    return NextResponse.redirect(
      new URL("/onboarding/connect?error=oauth", req.url),
    );
  }

  const verified = verifyOAuthState(state);
  if (!verified) {
    return NextResponse.redirect(
      new URL("/onboarding/connect?error=state_invalid", req.url),
    );
  }
  const userId = verified.userId;

  const cfg = serverConfig();
  const oauth2 = new google.auth.OAuth2(
    cfg.GOOGLE_CLIENT_ID,
    cfg.GOOGLE_CLIENT_SECRET,
    cfg.GOOGLE_OAUTH_REDIRECT,
  );

  let tokens: Auth.Credentials;
  try {
    const result = await oauth2.getToken(code);
    tokens = result.tokens;
  } catch {
    return NextResponse.redirect(
      new URL("/onboarding/connect?error=token_exchange", req.url),
    );
  }

  const refreshToken = tokens.refresh_token;
  if (!refreshToken) {
    return NextResponse.redirect(
      new URL("/onboarding/connect?error=no_refresh_token", req.url),
    );
  }
  oauth2.setCredentials(tokens);

  const oauth2Api = google.oauth2({ version: "v2", auth: oauth2 });
  const userinfo = await oauth2Api.userinfo.get();

  // Use the admin client so we don't depend on Supabase session cookies
  // having survived the OAuth round-trip.
  const admin = supabaseAdmin();
  const { data: row } = await admin
    .from("users")
    .select("first_name")
    .eq("id", userId)
    .single();
  const firstName = (row?.first_name as string | null) ?? "You";

  let sheetId: string;
  try {
    sheetId = await sheets().createUserSheet(firstName, refreshToken);
  } catch {
    return NextResponse.redirect(
      new URL("/onboarding/connect?error=sheet_create", req.url),
    );
  }

  await admin
    .from("users")
    .update({
      google_refresh_token_enc: encrypt(refreshToken),
      google_email: userinfo.data.email ?? null,
      user_sheet_id: sheetId,
    })
    .eq("id", userId);

  // Best-effort analytics — never crash the flow on this
  try {
    const posthog = getPostHogClient();
    posthog.capture({
      distinctId: userId,
      event: "google_connected",
      properties: {
        google_email: userinfo.data.email ?? undefined,
        sheet_id: sheetId,
      },
    });
    await posthog.shutdown();
  } catch {
    /* swallow */
  }

  // Land on the connect page with success — NOT /dashboard. If the
  // user's session cookie went stale during the OAuth detour, the
  // dashboard would bounce them to /login mid-celebration. The connect
  // page handles both cases gracefully (signed-in → continue; signed-out
  // → asks them to sign in once, data is preserved).
  return NextResponse.redirect(
    new URL("/onboarding/connect?status=connected", req.url),
  );
}
