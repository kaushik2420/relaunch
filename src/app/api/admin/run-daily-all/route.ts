import { NextResponse, type NextRequest } from 'next/server';
import { createSupabaseServer } from '@/lib/supabase/server';
import { serverConfig } from '@/lib/config';
import { runDailyForAllUsers } from '@/lib/services/backfill-runner';

export const runtime = 'nodejs';
export const maxDuration = 300;

/**
 * Admin-triggered backfill of the daily digest for every eligible user.
 * Ignores the per-user email_time / timezone gates the hourly cron uses.
 *
 * Auth: admin session OR x-cron-secret header (same pattern as the
 * other admin endpoints).
 *
 * Query params:
 *   ?force=1  — process every eligible user (default: only those who
 *               haven't already gotten a successful digest today).
 *
 * Response: full BackfillSummary with per-failure details.
 *
 * Curl example (after Vercel deploy):
 *   curl -X POST -H "x-cron-secret: $CRON_SECRET" \
 *     https://www.get-relaunch.com/api/admin/run-daily-all
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
      return NextResponse.json({
        error: 'not signed in',
        hint: 'Sign in as admin, or pass x-cron-secret header.',
      }, { status: 401 });
    }
    if ((user.email ?? '').toLowerCase() !== cfg.ADMIN_EMAIL.toLowerCase()) {
      return NextResponse.json({
        error: 'admin only',
        signedInAs: user.email,
        expectedAdmin: cfg.ADMIN_EMAIL,
      }, { status: 403 });
    }
  }

  const force = req.nextUrl.searchParams.get('force') === '1';
  const summary = await runDailyForAllUsers({ force });
  return NextResponse.json(summary);
}
