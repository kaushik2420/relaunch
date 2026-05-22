import { NextResponse, type NextRequest } from 'next/server';
import { google } from 'googleapis';
import { serverConfig } from '@/lib/config';
import { createSupabaseServer } from '@/lib/supabase/server';
import { signOAuthState } from '@/lib/oauth-state';

/**
 * Start Google OAuth — scope-minimal:
 *   drive.file      → only the sheets we create (per-file Drive access)
 *   userinfo.email  → confirm which Google account was connected
 *
 * We deliberately do NOT request gmail.send: the daily digest is sent
 * via Resend, so staying on drive.file (a non-restricted scope) lets the
 * app pass Google verification without a restricted-scope security
 * assessment.
 */
export async function GET(_req: NextRequest) {
  const sb = createSupabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.redirect(new URL('/login', _req.url));

  const cfg = serverConfig();
  const oauth2 = new google.auth.OAuth2(
    cfg.GOOGLE_CLIENT_ID,
    cfg.GOOGLE_CLIENT_SECRET,
    cfg.GOOGLE_OAUTH_REDIRECT
  );
  const url = oauth2.generateAuthUrl({
    access_type: 'offline',          // refresh_token
    prompt: 'consent',               // force refresh_token issuance
    scope: [
      'https://www.googleapis.com/auth/drive.file',
      'https://www.googleapis.com/auth/userinfo.email',
    ],
    // Signed HMAC state — lets the callback identify the user without
    // depending on a Supabase session surviving the Google round-trip.
    state: signOAuthState(user.id),
  });
  return NextResponse.redirect(url);
}
