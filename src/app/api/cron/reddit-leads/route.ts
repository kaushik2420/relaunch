import { NextResponse, type NextRequest } from 'next/server';
import { serverConfig } from '@/lib/config';
import { crawlRedditLeads } from '@/lib/services/reddit-crawler';

export const runtime = 'nodejs';
export const maxDuration = 300;

/**
 * Daily crawler for the Reddit distribution pipeline. Fan-out is small
 * (6 subreddits, one HTTP call each with pacing) so we run inline.
 *
 * Auth: Vercel Cron sends a Bearer header; we also accept x-cron-secret
 * for manual triggers (curl-tested from local dev).
 */
export async function GET(req: NextRequest) {
  const header = req.headers.get('authorization') ?? '';
  const secret = req.headers.get('x-cron-secret') ?? '';
  const cfg = serverConfig();
  const expected = `Bearer ${cfg.CRON_SECRET}`;
  if (header !== expected && secret !== cfg.CRON_SECRET) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const start = Date.now();
  const summary = await crawlRedditLeads();
  const durationMs = Date.now() - start;

  return NextResponse.json({
    ok: true,
    durationMs,
    ...summary,
  });
}
