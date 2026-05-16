import { NextResponse, type NextRequest } from "next/server";
import { google } from "googleapis";
import { serverConfig } from "@/lib/config";
import { createSupabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { encrypt } from "@/lib/crypto";
import { sheets } from "@/lib/providers/sheets";
import { getPostHogClient } from "@/lib/posthog-server";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state"); // user id
  if (!code || !state)
    return NextResponse.redirect(
      new URL("/onboarding/connect?error=oauth", req.url),
    );

  const sb = createSupabaseServer();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user || user.id !== state) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  const cfg = serverConfig();
  const oauth2 = new google.auth.OAuth2(
    cfg.GOOGLE_CLIENT_ID,
    cfg.GOOGLE_CLIENT_SECRET,
    cfg.GOOGLE_OAUTH_REDIRECT,
  );

  const { tokens } = await oauth2.getToken(code);
  if (!tokens.refresh_token) {
    // User has previously consented — re-issuing refresh_token requires prompt=consent
    return NextResponse.redirect(
      new URL("/onboarding/connect?error=no_refresh_token", req.url),
    );
  }
  oauth2.setCredentials(tokens);

  // Get the user's Google email for display in Settings
  const oauth2Api = google.oauth2({ version: "v2", auth: oauth2 });
  const userinfo = await oauth2Api.userinfo.get();

  // Create the Sheet now so we never need this token in band-aid mode later.
  const { data: row } = await sb
    .from("users")
    .select("first_name")
    .eq("id", user.id)
    .single();
  const firstName = row?.first_name ?? "You";
  const sheetId = await sheets().createUserSheet(
    firstName,
    tokens.refresh_token,
  );

  await supabaseAdmin()
    .from("users")
    .update({
      google_refresh_token_enc: encrypt(tokens.refresh_token),
      google_email: userinfo.data.email ?? null,
      user_sheet_id: sheetId,
    })
    .eq("id", user.id);

  const posthog = getPostHogClient();
  posthog.capture({
    distinctId: user.id,
    event: "google_connected",
    properties: {
      google_email: userinfo.data.email ?? undefined,
      sheet_id: sheetId,
    },
  });
  await posthog.shutdown();

  return NextResponse.redirect(new URL("/dashboard?welcome=1", req.url));
}
