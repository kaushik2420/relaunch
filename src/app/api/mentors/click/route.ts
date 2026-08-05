import { NextResponse, type NextRequest } from 'next/server';
import { createSupabaseServer } from '@/lib/supabase/server';
import { logMentorClick } from '@/lib/services/mentors';

export const runtime = 'nodejs';

/**
 * Fire-and-forget click logger. Users click "Book a session" on the
 * /mentors page; the client sends this POST alongside opening the
 * calendar URL in a new tab. No response payload needed.
 *
 * We deliberately return 204 fast — the outbound click shouldn't be
 * blocked by our attribution logging.
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      mentorId?: string;
      fromPage?: string;
    };
    if (!body.mentorId) {
      return NextResponse.json({ error: 'mentorId required' }, { status: 400 });
    }
    const sb = createSupabaseServer();
    const { data: { user } } = await sb.auth.getUser();
    await logMentorClick({
      mentorId: body.mentorId,
      userId: user?.id ?? null,
      fromPage: body.fromPage ?? null,
    });
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    console.warn('[mentors] click log failed', err);
    // Still return 204 — we NEVER want to block the outbound click on
    // our logging succeeding.
    return new NextResponse(null, { status: 204 });
  }
}
