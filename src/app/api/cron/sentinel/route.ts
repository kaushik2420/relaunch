import { NextResponse, type NextRequest } from 'next/server';
import { serverConfig } from '@/lib/config';
import { runSentinel } from '@/lib/services/sentinel';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * Hourly sentinel — self-diagnosis of the Relaunch pipeline. See
 * src/lib/services/sentinel.ts for the full behaviour.
 *
 * Scheduled via vercel.json at ':05' every hour (offset from the
 * daily digest cron on ':00' so their signals don't overlap).
 */
export async function GET(req: NextRequest) {
  const cfg = serverConfig();
  const header = req.headers.get('authorization') ?? '';
  const secret = req.headers.get('x-cron-secret') ?? '';
  const expected = `Bearer ${cfg.CRON_SECRET}`;
  if (header !== expected && secret !== cfg.CRON_SECRET) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const result = await runSentinel();
  return NextResponse.json({
    ranAt: result.ranAt,
    durationMs: result.durationMs,
    severity: result.diagnosis.severity,
    headline: result.diagnosis.headline,
    notified: result.notified,
    alertId: result.alertId,
  });
}
