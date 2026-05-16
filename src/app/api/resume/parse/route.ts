import { NextResponse, type NextRequest } from 'next/server';
import { createSupabaseServer } from '@/lib/supabase/server';
import { parseResumeFile } from '@/lib/services/resume-parser';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * Parse a resume in-memory and save the extracted profile JSON to the
 * user's row. The file itself is never persisted.
 *
 * Per-user rate-limit (5/day) enforced by Supabase trigger — TODO.
 */
export async function POST(req: NextRequest) {
  const sb = createSupabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const form = await req.formData();
  const file = form.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
  }
  if (file.size > 10 * 1024 * 1024) {
    return NextResponse.json({ error: 'File too large (max 10 MB)' }, { status: 400 });
  }

  let profile;
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    profile = await parseResumeFile({ buffer, mime: file.type });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }

  const { error } = await sb.from('users').update({ profile }).eq('id', user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
