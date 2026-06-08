import { NextResponse, type NextRequest } from "next/server";
import {
  authenticateExtension,
  EXTENSION_CORS_HEADERS,
} from "@/lib/extension-auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { classifyAtsUrl } from "@/lib/ats-url";
import type { UserProfile } from "@/lib/types";

export const runtime = "nodejs";

export function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: EXTENSION_CORS_HEADERS,
  });
}

/**
 * Look up the tailored Relaunch match for the job URL the user is
 * currently viewing.
 *
 * Lookup order (most specific → most permissive):
 *   1. Exact `apply_url` match against the URL's canonical form
 *      (protocol + host + path, lowercased, query-stripped).
 *   2. Match by `(ats, ats_id)` — handles wrapper URLs like
 *      `careers.datadoghq.com/detail/123/?gh_jid=123` which carry the
 *      Greenhouse job id even though they live on a different host.
 *   3. (Future) host+path prefix — useful for ATSes whose URLs are
 *      stable but where we couldn't extract a stable id.
 *
 * If multiple matches qualify (rare), the most recent wins.
 */
export async function GET(req: NextRequest) {
  const auth = await authenticateExtension(req.headers.get("authorization"));
  if (!auth.ok) {
    return NextResponse.json(
      { error: auth.message },
      { status: auth.status, headers: EXTENSION_CORS_HEADERS },
    );
  }

  const params = new URL(req.url).searchParams;
  const rawUrl = params.get("url");
  const matchId = params.get("match_id");
  if (!rawUrl && !matchId) {
    return NextResponse.json(
      { error: "Missing `url` or `match_id` parameter." },
      { status: 400, headers: EXTENSION_CORS_HEADERS },
    );
  }

  const admin = supabaseAdmin();
  const COLUMNS =
    "id, apply_url, ats, ats_id, job_title, company, match_percent, verify_score, tailored_resume_text, tailored_resume_pdf_url, cover_letter_text, cover_letter_pdf_url, why_this_role, summary, created_at";

  let hit = null;

  // Lookup 0 — explicit match_id (from the manual search fallback).
  // User picked this row deliberately, so we trust it over URL guessing.
  if (matchId) {
    const { data } = await admin
      .from("job_matches")
      .select(COLUMNS)
      .eq("user_id", auth.userId)
      .eq("id", matchId)
      .maybeSingle();
    hit = data;
  }

  // Lookup 1 — exact canonical URL
  let cls = rawUrl ? classifyAtsUrl(rawUrl) : null;
  if (!hit && cls) {
    const { data } = await admin
      .from("job_matches")
      .select(COLUMNS)
      .eq("user_id", auth.userId)
      .eq("apply_url", cls.canonical)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    hit = data;
  }

  // Lookup 2 — by ATS + id (covers wrapper URLs)
  if (!hit && cls && cls.ats && cls.atsId) {
    const { data } = await admin
      .from("job_matches")
      .select(COLUMNS)
      .eq("user_id", auth.userId)
      .eq("ats", cls.ats)
      .eq("ats_id", cls.atsId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    hit = data;
  }

  if (!hit) {
    return NextResponse.json(
      { error: "No match found for this URL." },
      { status: 404, headers: EXTENSION_CORS_HEADERS },
    );
  }

  // Shape into the contract the extension's widget expects.
  const profile = (auth.profile ?? {}) as Partial<UserProfile>;
  const links = profile.links ?? {};
  return NextResponse.json(
    {
      match: {
        id: hit.id,
        jobTitle: hit.job_title,
        company: hit.company,
        applyUrl: hit.apply_url,
        matchPercent: hit.match_percent ?? 0,
        verifyScore: hit.verify_score ?? 0,
      },
      tailored: {
        resumeText: hit.tailored_resume_text,
        resumePdfUrl: hit.tailored_resume_pdf_url,
        coverLetterText: hit.cover_letter_text,
        coverLetterPdfUrl: hit.cover_letter_pdf_url,
        whyThisRole: hit.why_this_role,
        summary: hit.summary,
      },
      profile: {
        fullName: profile.fullName ?? null,
        email: links.email ?? auth.email,
        phone: links.phone ?? null,
        location: profile.location ?? null,
        linkedinUrl: links.linkedin ?? null,
        githubUrl: links.github ?? null,
        portfolioUrl: links.portfolio ?? null,
        yearsExperience: profile.yearsExperience ?? null,
      },
    },
    { headers: EXTENSION_CORS_HEADERS },
  );
}
