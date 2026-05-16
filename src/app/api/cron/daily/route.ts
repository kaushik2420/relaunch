import { NextResponse, type NextRequest } from 'next/server';
import { serverConfig } from '@/lib/config';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { pickUsersForThisHour, runDailyForUser } from '@/lib/services/daily-runner';

export const runtime = 'nodejs';
export const maxDuration = 300; // Vercel: up to 5 min on Pro; 60s on Hobby

/**
 * Hourly cron — picks users whose local email_time falls in this hour
 * and runs the daily pipeline for each. The fan-out is small at 0-500
 * users so we process inline. At scale, switch to a queue (Inngest,
 * Trigger.dev, or QStash) — same `runDailyForUser` function.
 */
export async function GET(req: NextRequest) {
  // Auth: Vercel Cron sends a Bearer header; we also accept x-cron-secret for manual triggers.
  const header = req.headers.get('authorization') ?? '';
  const secret = req.headers.get('x-cron-secret') ?? '';
  const cfg = serverConfig();
  const expected = `Bearer ${cfg.CRON_SECRET}`;
  if (header !== expected && secret !== cfg.CRON_SECRET) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const start = Date.now();
  const users = await pickUsersForThisHour();
  const admin = supabaseAdmin();

  const results = await Promise.allSettled(
    users.map(async (u) => {
      const runStart = Date.now();
      try {
        const { matchesFound, emailed } = await runDailyForUser(u);
        await admin.from('job_runs').insert({
          user_id: u.id,
          jobs_found: matchesFound,
          jobs_emailed: emailed,
          status: emailed === 0 ? 'partial' : 'ok',
          duration_ms: Date.now() - runStart,
        });
        await admin.from('users').update({ last_run_at: new Date().toISOString() }).eq('id', u.id);
        return { user: u.id, ok: true };
      } catch (err) {
        await admin.from('job_runs').insert({
          user_id: u.id,
          status: 'error',
          error: (err as Error).message,
          duration_ms: Date.now() - runStart,
        });
        return { user: u.id, ok: false, error: (err as Error).message };
      }
    })
  );

  return NextResponse.json({
    pickedUp: users.length,
    succeeded: results.filter((r) => r.status === 'fulfilled' && (r.value as { ok: boolean }).ok).length,
    failed: results.filter((r) => r.status === 'rejected' || !(r as PromiseFulfilledResult<{ ok: boolean }>).value?.ok).length,
    elapsedMs: Date.now() - start,
  });
}
