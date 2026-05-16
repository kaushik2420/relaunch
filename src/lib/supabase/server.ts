import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { publicConfig } from '@/lib/config';

/**
 * Use in Server Components, Server Actions, Route Handlers.
 * Honors the user's session via cookies (RLS-enforced reads/writes).
 *
 * Typed loosely until we generate DB types (`supabase gen types typescript`).
 */
export function createSupabaseServer() {
  const cookieStore = cookies();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return createServerClient<any, 'public', any>(
    publicConfig.NEXT_PUBLIC_SUPABASE_URL,
    publicConfig.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          try {
            cookieStore.set({ name, value, ...options });
          } catch {
            // ignore — called from a Server Component
          }
        },
        remove(name: string, options: CookieOptions) {
          try {
            cookieStore.set({ name, value: '', ...options });
          } catch {
            // ignore
          }
        },
      },
    }
  );
}
