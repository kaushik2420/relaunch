import { NextResponse, type NextRequest } from 'next/server';
import { createSupabaseServer } from '@/lib/supabase/server';

/**
 * Supabase email-link callback (verification + magic-link sign-in).
 * Exchanges the code for a session and routes the user onward.
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const next = url.searchParams.get('next') ?? '/onboarding/upload';
  if (!code) return NextResponse.redirect(new URL('/login', req.url));

  const sb = createSupabaseServer();
  const { error } = await sb.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(error.message)}`, req.url));
  }
  return NextResponse.redirect(new URL(next, req.url));
}
