import { NextResponse, type NextRequest } from 'next/server';
import { createSupabaseServer } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';

export const runtime = 'nodejs';

/**
 * Session heartbeat. Called from <SessionHeartbeat /> on the client
 * every ~60 seconds while a Relaunch tab is active. Two shapes:
 *
 *   1. First heartbeat of a tab — body { sessionId: null }
 *        Creates a new user_sessions row, stamps users.last_login_at,
 *        returns { sessionId } which the client stashes for later pings.
 *
 *   2. Subsequent heartbeats — body { sessionId: '<uuid>' }
 *        Updates that row's last_seen_at to now().
 *
 * Safety:
 *   - Auth check: 401 if not signed in.
 *   - The session row is looked up by (id, user_id) — a user can't
 *     bump another user's session even if they guess an id.
 *   - Cheap: one row read/write per minute per active tab.
 */
export async function POST(req: NextRequest) {
  const sb = createSupabaseServer();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
  }

  let body: { sessionId?: string | null };
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const sessionId = body.sessionId ?? null;
  const admin = supabaseAdmin();

  if (sessionId) {
    // Existing session — bump last_seen_at. RLS-equivalent guard by
    // matching user_id so a leaked sessionId can't be used to poke
    // another user's row.
    const { error } = await admin
      .from('user_sessions')
      .update({ last_seen_at: new Date().toISOString() })
      .eq('id', sessionId)
      .eq('user_id', user.id);
    if (error) {
      console.error('[session/heartbeat] update failed', error);
      return NextResponse.json({ error: 'Update failed.' }, { status: 500 });
    }
    return NextResponse.json({ ok: true, sessionId });
  }

  // New session — insert a row and stamp users.last_login_at.
  const ua = req.headers.get('user-agent')?.slice(0, 500) ?? null;
  const { data: newRow, error: insertErr } = await admin
    .from('user_sessions')
    .insert({ user_id: user.id, user_agent: ua })
    .select('id')
    .single();
  if (insertErr || !newRow) {
    console.error('[session/heartbeat] insert failed', insertErr);
    return NextResponse.json({ error: 'Insert failed.' }, { status: 500 });
  }

  await admin
    .from('users')
    .update({ last_login_at: new Date().toISOString() })
    .eq('id', user.id);

  return NextResponse.json({ ok: true, sessionId: newRow.id });
}
