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
 * Answer an application question using the candidate's profile + the
 * tailored content for the specific job they're applying to.
 *
 * Body: { match_id: uuid, question: string }
 * Returns: { answer: string }
 *
 * Costs Claude tokens per call — entitlement gate (allowlist) is the
 * primary cost control today. Future-proofed by reading from a job_match
 * the user owns (so an attacker with a token can't burn our tokens
 * against arbitrary job context — they're limited to their own matches).
 */
export async function POST(req: NextRequest) {
  const auth = await authenticateExtension(req.headers.get("authorization"));
  if (!auth.ok) {
    return NextResponse.json(
      { error: auth.message },
      { status: auth.status, headers: EXTENSION_CORS_HEADERS },
    );
  }

  let body: { match_id?: string; question?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body." },
      { status: 400, headers: EXTENSION_CORS_HEADERS },
    );
  }

  const matchId = (body.match_id ?? "").trim();
  const question = (body.question ?? "").trim();
  if (!matchId || !question) {
    return NextResponse.json(
      { error: "match_id and question are required." },
      { status: 400, headers: EXTENSION_CORS_HEADERS },
    );
  }
  if (question.length < 6) {
    return NextResponse.json(
      { error: "Please ask a more specific question (at least 6 characters)." },
      { status: 400, headers: EXTENSION_CORS_HEADERS },
    );
  }
  if (question.length > 600) {
    return NextResponse.json(
      { error: "Question is too long — please tighten it under 600 characters." },
      { status: 400, headers: EXTENSION_CORS_HEADERS },
    );
  }

  // Look up the match — must belong to the authenticated user.
  const admin = supabaseAdmin();
  const { data: match, error: matchErr } = await admin
    .from("job_matches")
    .select("id, job_title, company, summary, cover_letter_text")
    .eq("user_id", auth.userId)
    .eq("id", matchId)
    .maybeSingle();
  if (matchErr || !match) {
    return NextResponse.json(
      { error: "Match not found." },
      { status: 404, headers: EXTENSION_CORS_HEADERS },
    );
  }

  const profile = (auth.profile ?? null) as unknown as UserProfile | null;
  if (!profile || !profile.fullName) {
    return NextResponse.json(
      {
        error:
          "We don't have your profile parsed yet — upload your résumé on Relaunch first.",
      },
      { status: 400, headers: EXTENSION_CORS_HEADERS },
    );
  }

  try {
    const { answer } = await llm().answerApplicationQuestion({
      profile,
      question,
      jobTitle: match.job_title as string,
      company: match.company as string,
      summary: (match.summary as string | null) ?? null,
      coverLetterText: (match.cover_letter_text as string | null) ?? null,
    });
    return NextResponse.json(
      { question, answer },
      { headers: EXTENSION_CORS_HEADERS },
    );
  } catch (err) {
    console.error("[extension] answer failed", err);
    return NextResponse.json(
      { error: "Couldn't generate an answer — please try again in a moment." },
      { status: 500, headers: EXTENSION_CORS_HEADERS },
    );
  }
}
