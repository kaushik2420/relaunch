import { NextResponse, type NextRequest } from 'next/server';
import { createSupabaseServer } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { parseCtcToNumber } from '@/lib/utils/parse-ctc';

export const runtime = 'nodejs';

/**
 * Save the user's current CTC from the SalaryCheck inline form. Called
 * once — after this the salary-check response will include a hike %
 * against the current CTC.
 *
 * Body: { currentCtc: string }  (e.g. "18L", "22 LPA", "$140k")
 * Returns { ok, currentCtc } on success.
 *
 * We accept free-form text and parse it here to validate that the
 * input is at least *interpretable*. If parseCtcToNumber returns null,
 * we reject with 400 so the user can fix the input rather than
 * silently storing garbage.
 */
export async function POST(req: NextRequest) {
  const sb = createSupabaseServer();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
  }

  let body: { currentCtc?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 });
  }

  const raw = (body.currentCtc ?? '').trim();
  if (!raw) {
    return NextResponse.json(
      { error: 'Please enter your current CTC.' },
      { status: 400 },
    );
  }

  const parsed = parseCtcToNumber(raw);
  if (!parsed) {
    return NextResponse.json(
      {
        error:
          "Couldn't read that — try something like '18L', '22 LPA', or '$140k'.",
      },
      { status: 400 },
    );
  }

  const { error } = await supabaseAdmin()
    .from('users')
    .update({ current_ctc: raw })
    .eq('id', user.id);

  if (error) {
    console.error('[current-ctc] db update failed', error);
    return NextResponse.json(
      { error: "Couldn't save your CTC — please try again." },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, currentCtc: raw });
}
