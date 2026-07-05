import { NextResponse, type NextRequest } from 'next/server';
import { createSupabaseServer } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { llm } from '@/lib/providers/llm';
import { fetchAdzunaHistogram } from '@/lib/services/adzuna-salary';
import type { UserProfile } from '@/lib/types';

export const runtime = 'nodejs';
export const maxDuration = 20;

/**
 * Salary reality-check for a specific role. Cheap and lazy — called
 * on demand when the user clicks "Salary check" on a match card, not
 * pre-computed for every match.
 *
 * Body: { jobTitle, company, location }
 * Returns { rangeLow, rangeMid, rangeHigh, currency, confidence,
 *           explanation, sampleSize, verifyLinks[] }
 *
 * Cost per call: ~1 Adzuna hit (we already pay for their key) +
 * ~$0.005 Sonnet call. Negligible.
 */
export async function POST(req: NextRequest) {
  const sb = createSupabaseServer();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
  }

  let body: { jobTitle?: string; company?: string; location?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 });
  }

  const jobTitle = (body.jobTitle ?? '').trim();
  const company = (body.company ?? '').trim();
  const location = (body.location ?? '').trim();
  if (!jobTitle) {
    return NextResponse.json({ error: 'jobTitle required.' }, { status: 400 });
  }

  // Fetch profile — the personalisation is only meaningful if we know
  // the user's seniority + years.
  const { data: row } = await supabaseAdmin()
    .from('users')
    .select('profile')
    .eq('id', user.id)
    .single();
  const profile = (row?.profile ?? null) as UserProfile | null;
  if (!profile || !profile.fullName) {
    return NextResponse.json(
      { error: 'Upload your résumé in Relaunch first — we need it to personalise the estimate.' },
      { status: 400 },
    );
  }

  // Step 1: Adzuna histogram
  let histogramResult;
  try {
    histogramResult = await fetchAdzunaHistogram({
      jobTitle,
      location: location || profile.location || 'India',
    });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message ?? 'Salary data source is temporarily unavailable.' },
      { status: 502 },
    );
  }

  // Step 2: Claude synthesises the histogram + profile into a range
  let estimate;
  try {
    estimate = await llm().estimateSalary({
      profile,
      jobTitle,
      company: company || 'this company',
      location: location || profile.location || '',
      histogram: histogramResult.histogram,
      currency: histogramResult.currency,
    });
  } catch (err) {
    console.error('[salary-estimate] LLM failed', err);
    return NextResponse.json(
      { error: "Couldn't build the estimate — please try again." },
      { status: 500 },
    );
  }

  // Verify links — send users to authoritative sources to double-check.
  const q = encodeURIComponent(jobTitle);
  const verifyLinks: { label: string; url: string }[] = [];
  if (histogramResult.country === 'in') {
    verifyLinks.push({
      label: 'AmbitionBox',
      url: `https://www.ambitionbox.com/salaries/${company ? company.toLowerCase().replace(/\s+/g, '-') + '-salaries' : ''}?title=${q}`,
    });
    verifyLinks.push({
      label: 'Levels.fyi (tech-only)',
      url: `https://www.levels.fyi/t/${q}/locations/india`,
    });
  } else {
    verifyLinks.push({
      label: 'Levels.fyi',
      url: `https://www.levels.fyi/t/${q}`,
    });
    verifyLinks.push({
      label: 'Glassdoor',
      url: `https://www.glassdoor.com/Salaries/${q}-salary-SRCH_KO0,${jobTitle.length}.htm`,
    });
  }

  return NextResponse.json({
    ...estimate,
    verifyLinks,
    poweredBy: 'Adzuna market data + Relaunch',
    disclaimer:
      "This is a directional estimate based on posted salaries + your profile — not an offer. Always verify on the sources linked below before you accept.",
  });
}
