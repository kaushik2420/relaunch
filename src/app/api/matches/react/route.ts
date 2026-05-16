import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { createSupabaseServer } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { decrypt } from '@/lib/crypto';
import { sheets } from '@/lib/providers/sheets';

export const runtime = 'nodejs';

const Body = z.object({
  company: z.string().min(1).max(200),
  role: z.string().min(1).max(200),
  reaction: z.enum(['liked', 'hidden', '']),
});

/**
 * Set the user's reaction on a job match — 👍 liked / 👎 hidden / cleared.
 * Updates the user's Google Sheet (column O). The dashboard then filters
 * hidden matches out by default and offers a "Liked only" filter.
 */
export async function POST(req: NextRequest) {
  const sb = createSupabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const json = await req.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }

  // Read user's sheet id + refresh token via admin client (we trust user.id from session)
  const { data: row } = await supabaseAdmin()
    .from('users')
    .select('user_sheet_id, google_refresh_token_enc')
    .eq('id', user.id)
    .single();

  if (!row?.user_sheet_id || !row.google_refresh_token_enc) {
    return NextResponse.json(
      { error: 'Connect Google first to use reactions' },
      { status: 400 },
    );
  }

  const refreshToken = decrypt(row.google_refresh_token_enc as string);
  try {
    await sheets().setReaction({
      spreadsheetId: row.user_sheet_id as string,
      refreshToken,
      company: parsed.data.company,
      role: parsed.data.role,
      reaction: parsed.data.reaction,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
