import { NextResponse, type NextRequest } from "next/server";
import {
  authenticateExtension,
  EXTENSION_CORS_HEADERS,
} from "@/lib/extension-auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { llm } from "@/lib/providers/llm";
import type { UserProfile } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 30;

export function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: EXTENSION_CORS_HEADERS,
  });
}

/**
 * Enrich a backfilled match: generate summary, why-this-role, and
 * cover-letter text using just the profile + jobTitle + company as
 * context (no JD available for matches synced from the old Sheet).
 *
 * Persists results back to job_matches so the next fetch returns
 * the enriched content without re-paying for the LLM call.
 *
 * Idempotent in the sense that re-running just overwrites the text.
 */
export async function POST(req: NextRequest) {
  const auth = await authenticateExtension(req.headers.get("authorization"));
  if (!auth.ok) {
    return NextResponse.json(
      { error: auth.message },
      { status: auth.status, headers: EXTENSION_CORS_HEADERS },
    );
  }

  let body: { match_id?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body." },
      { status: 400, headers: EXTENSION_CORS_HEADERS },
    );
  }

  const matchId = (body.match_id ?? "").trim();
  if (!matchId) {
    return NextResponse.json(
      { error: "match_id is required." },
      { status: 400, headers: EXTENSION_CORS_HEADERS },
    );
  }

  const admin = supabaseAdmin();
  const { data: match } = await admin
    .from("job_matches")
    .select("id, job_title, company")
    .eq("user_id", auth.userId)
    .eq("id", matchId)
    .maybeSingle();
  if (!match) {
    return NextResponse.json(
      { error: "Match not found." },
      { status: 404, headers: EXTENSION_CORS_HEADERS },
    );
  }

  const profile = (auth.profile ?? null) as unknown as UserProfile | null;
  if (!profile || !profile.fullName) {
    return NextResponse.json(
      { error: "Upload your résumé in Relaunch first." },
      { status: 400, headers: EXTENSION_CORS_HEADERS },
    );
  }

  try {
    const enriched = await llm().enrichBackfilledMatch({
      profile,
      jobTitle: match.job_title as string,
      company: match.company as string,
    });

    // Persist so the next /job lookup returns the enriched content
    // without paying the LLM cost again.
    await admin
      .from("job_matches")
      .update({
        summary: enriched.summary,
        why_this_role: enriched.whyThisRole,
        cover_letter_text: enriched.coverLetterText,
        updated_at: new Date().toISOString(),
      })
      .eq("id", matchId)
      .eq("user_id", auth.userId);

    return NextResponse.json(
      {
        summary: enriched.summary,
        whyThisRole: enriched.whyThisRole,
        coverLetterText: enriched.coverLetterText,
      },
      { headers: EXTENSION_CORS_HEADERS },
    );
  } catch (err) {
    console.error("[extension] enrich failed", err);
    return NextResponse.json(
      { error: "Couldn't generate tailored content — please try again." },
      { status: 500, headers: EXTENSION_CORS_HEADERS },
    );
  }
}
