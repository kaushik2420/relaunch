'use client';
import { createBrowserClient } from '@supabase/ssr';
import { publicConfig } from '@/lib/config';

let _client: ReturnType<typeof createBrowserClient> | undefined;
export function supabaseBrowser() {
  _client ??= createBrowserClient(
    publicConfig.NEXT_PUBLIC_SUPABASE_URL,
    publicConfig.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
  return _client;
}
