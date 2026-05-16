import { type NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';

/**
 * Middleware-light: refresh the Supabase session cookie on every request.
 * Route-level auth checks live in (app)/layout.tsx — middleware only
 * keeps the session fresh so getUser() works inside server components.
 */
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request: { headers: request.headers } });
  const sb = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get: (n) => request.cookies.get(n)?.value,
        set: (n, v, opts) => {
          request.cookies.set({ name: n, value: v, ...opts });
          response = NextResponse.next({ request: { headers: request.headers } });
          response.cookies.set({ name: n, value: v, ...opts });
        },
        remove: (n, opts) => {
          request.cookies.set({ name: n, value: '', ...opts });
          response = NextResponse.next({ request: { headers: request.headers } });
          response.cookies.set({ name: n, value: '', ...opts });
        },
      },
    }
  );
  await sb.auth.getUser();
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/razorpay/webhook).*)'],
};
