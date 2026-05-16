import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { publicConfig, serverConfig } from '@/lib/config';

/**
 * BYPASSES Row Level Security. Use ONLY inside trusted server contexts
 * (cron, webhooks, admin scripts). NEVER expose to the client.
 *
 * We type the client loosely (any) because we haven't generated DB
 * type definitions yet. Once we do (`supabase gen types typescript`),
 * we can tighten this back to `SupabaseClient<Database>`.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _admin: SupabaseClient<any, 'public', any> | undefined;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function supabaseAdmin(): SupabaseClient<any, 'public', any> {
  _admin ??= createClient(
    publicConfig.NEXT_PUBLIC_SUPABASE_URL,
    serverConfig().SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: { persistSession: false, autoRefreshToken: false },
    }
  );
  return _admin;
}
