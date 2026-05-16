import { createClient } from '@supabase/supabase-js';
import { publicConfig, serverConfig } from '@/lib/config';

/**
 * BYPASSES Row Level Security. Use ONLY inside trusted server contexts
 * (cron, webhooks, admin scripts). NEVER expose to the client.
 */
let _admin: ReturnType<typeof createClient> | undefined;
export function supabaseAdmin() {
  _admin ??= createClient(
    publicConfig.NEXT_PUBLIC_SUPABASE_URL,
    serverConfig().SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: { persistSession: false, autoRefreshToken: false },
    }
  );
  return _admin;
}
