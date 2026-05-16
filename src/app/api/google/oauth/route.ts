import { NextResponse, type NextRequest } from 'next/server';
import { google } from 'googleapis';
import { serverConfig } from '@/lib/config';
import { createSupabaseServer } from '@/lib/supabase/server';

/**
 * Start Google OAuth — scope-minimal:
 *   drive.file  → only the sheets we create
 *   gmail.send  → only send (no read)
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
      'https://www.googleapis.com/auth/gmail.send',
      'https://www.googleapis.com/auth/userinfo.email',
    ],
    state: user.id,
  });
  return NextResponse.redirect(url);
}
