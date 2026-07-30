import { NextResponse, type NextRequest } from 'next/server';
import { createSupabaseServer } from '@/lib/supabase/server';
import { serverConfig } from '@/lib/config';
import { runSentinel } from '@/lib/services/sentinel';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * Fire the sentinel triage on demand (bypasses the hourly schedule).
 * Same auth pattern as the other /api/admin/* endpoints.
 *
 * Returns the full diagnosis + signals + whether an email fired. Useful
 * to sanity-check the sentinel itself is alive without waiting for the
 * next :05 cron.
 */
export async function POST(req: NextRequest) {
  const cfg = serverConfig();
  const cronSecret = req.headers.get('x-cron-secret') ?? '';
  const bearer = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  const hasCronAuth =
    (cronSecret && cronSecret === cfg.CRON_SECRET) ||
    (bearer && bearer === cfg.CRON_SECRET);

  if (!hasCronAuth) {
    const sb = createSupabaseServer();
    const { data: { user } } = await sb.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'not signed in' }, { status: 401 });
    }
    if ((user.email ?? '').toLowerCase() !== cfg.ADMIN_EMAIL.toLowerCase()) {
      return NextResponse.json({ error: 'admin only' }, { status: 403 });
    }
  }

  const result = await runSentinel();
  return NextResponse.json(result);
}
