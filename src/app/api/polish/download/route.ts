import { NextResponse } from 'next/server';
import { createSupabaseServer } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { renderResumePdf } from '@/lib/resume/render-pdf';
import type { UserProfile, TailoredResume } from '@/lib/types';

export const runtime = 'nodejs';
export const maxDuration = 20;

/**
 * Download the user's current polished résumé as a PDF.
 *
 * Reads the user's profile (which already reflects any accepted
 * rewrites — acceptRewriteAction writes directly into
 * profile.experience[].bullets), builds an "identity" TailoredResume
 * (no per-job tailoring, just the profile as-is), then reuses the
 * existing render-pdf pipeline so styling matches the tailored PDFs
 * we generate per match.
 *
 * The response is streamed as an attachment. Filename embeds the user's
 * full name so downloads don't collide when they save several versions.
 */
export async function GET() {
  const sb = createSupabaseServer();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
  }

  const { data: row } = await supabaseAdmin()
    .from('users')
    .select('profile')
    .eq('id', user.id)
    .single();
  const profile = (row?.profile ?? null) as UserProfile | null;

  if (!profile || !profile.fullName) {
    return NextResponse.json(
      { error: 'Upload your résumé first — Settings → Your résumé & profile.' },
      { status: 400 },
    );
  }

  // Build an identity TailoredResume from the profile. summary is
  // deliberately empty so the render skips the Summary section entirely
  // — this download is the polished base résumé, not a per-role pitch.
  const tailored: TailoredResume = {
    summary: '',
    highlightedSkills: [], // empty → render falls back to profile.skills
    experienceBullets: (profile.experience ?? []).map((e) => ({
      company: e.company,
      title: e.title,
      bullets: e.bullets ?? [],
    })),
    rationale: '',
    removedSections: [],
  };

  let pdf: Buffer;
  try {
    pdf = await renderResumePdf(profile, tailored);
  } catch (err) {
    console.error('[polish/download] PDF render failed', err);
    return NextResponse.json(
      { error: "Couldn't build the PDF — please try again." },
      { status: 500 },
    );
  }

  const safeName = profile.fullName
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 60) || 'resume';
  const filename = `${safeName}_Relaunch_polished.pdf`;

  // Buffer → Uint8Array so NextResponse accepts it as a BodyInit.
  const body = new Uint8Array(pdf);
  return new NextResponse(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(body.byteLength),
      // No cache — the PDF reflects live profile state.
      'Cache-Control': 'no-store',
    },
  });
}
