import { NextResponse, type NextRequest } from "next/server";
import {
  authenticateExtension,
  EXTENSION_CORS_HEADERS,
} from "@/lib/extension-auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { llm } from "@/lib/providers/llm";
import type { UserProfile } from "@/lib/types";
import type { SmartFillField } from "@/lib/providers/llm/types";

export const runtime = "nodejs";
export const maxDuration = 30;

export function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: EXTENSION_CORS_HEADERS,
  });
}

/**
 * Smart-Fill: caller posts the structure of the form on the page,
 * we return Claude's best value for each field that's safe to fill.
 *
 * Sensitive-field denylist runs HERE, before the LLM call, so the
 * model never sees those fields at all. Even if the model misbehaves
 * and returns a value for one of them, the caller is also expected to
 * skip them — defense in depth.
 *
 * Body: { match_id, fields: SmartFillField[] }
 * Returns: { values: { [fieldId]: string | null }, skipped: string[] }
 */
const SENSITIVE_PATTERNS: RegExp[] = [
  // Compensation
  /\b(salary|ctc|compensation|expected.+(salary|pay|comp)|current.+(salary|pay|comp))\b/i,
  // Notice period / availability
  /\b(notice.?period|how.+(soon|quickly).+start|earliest.+start|joining.+date)\b/i,
  // Visa / sponsorship / work authorization
  /\b(visa|sponsor|work.+authoriz|legally.+work|h1-?b|opt|cpt)\b/i,
  // EEO — race / ethnicity
  /\b(race|ethnicity|ethnic|hispanic|latino|caucasian|asian|black|african)\b/i,
  // EEO — gender / sex
  /\b(gender|sex|pronoun|male.+female|transgender|non-?binary)\b/i,
  // EEO — disability
  /\b(disabilit(y|ies)|disabled|accommodat|impair)\b/i,
  // EEO — veteran
  /\b(veteran|military.+service|protected.+veteran)\b/i,
  // Date of birth / age
  /\b(date.+birth|dob|birthdate|age)\b/i,
  // Criminal history
  /\b(felony|criminal|conviction|background.+check)\b/i,
];

function isSensitiveField(f: SmartFillField): boolean {
  const blob = `${f.label} ${f.placeholder ?? ""} ${f.hint ?? ""}`.toLowerCase();
  return SENSITIVE_PATTERNS.some((re) => re.test(blob));
}

export async function POST(req: NextRequest) {
  const auth = await authenticateExtension(req.headers.get("authorization"));
  if (!auth.ok) {
    return NextResponse.json(
      { error: auth.message },
      { status: auth.status, headers: EXTENSION_CORS_HEADERS },
    );
  }

  let body: { match_id?: string; fields?: SmartFillField[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body." },
      { status: 400, headers: EXTENSION_CORS_HEADERS },
    );
  }

  const matchId = (body.match_id ?? "").trim();
  const allFields = Array.isArray(body.fields) ? body.fields : [];
  if (!matchId || allFields.length === 0) {
    return NextResponse.json(
      { error: "match_id and a non-empty fields array are required." },
      { status: 400, headers: EXTENSION_CORS_HEADERS },
    );
  }
  if (allFields.length > 80) {
    // Hard cap: if a page surfaces this many fields we'd rather chunk
    // (future work) than ship a 30K-token prompt.
    return NextResponse.json(
      { error: "Too many fields on this page — try the fast-fill button instead." },
      { status: 413, headers: EXTENSION_CORS_HEADERS },
    );
  }

  // Drop sensitive fields BEFORE the LLM ever sees them. Track them so
  // the client can tell the user "skipped on purpose".
  const skipped: string[] = [];
  const safeFields: SmartFillField[] = [];
  for (const f of allFields) {
    if (!f || typeof f.id !== "string" || typeof f.label !== "string") continue;
    if (isSensitiveField(f)) {
      skipped.push(f.id);
    } else {
      safeFields.push(f);
    }
  }

  if (safeFields.length === 0) {
    return NextResponse.json(
      { values: {}, skipped },
      { headers: EXTENSION_CORS_HEADERS },
    );
  }

  // Match owned by the caller, please.
  const admin = supabaseAdmin();
  const { data: match } = await admin
    .from("job_matches")
    .select("id, job_title, company, summary, cover_letter_text")
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
    const result = await llm().smartFillForm({
      profile,
      jobTitle: match.job_title as string,
      company: match.company as string,
      summary: (match.summary as string | null) ?? null,
      coverLetterText: (match.cover_letter_text as string | null) ?? null,
      fields: safeFields,
    });

    // Final safety pass: even if the LLM returned values for sensitive
    // fields (it shouldn't — they were never in its input), nuke them.
    for (const id of skipped) delete result.values[id];

    return NextResponse.json(
      { values: result.values, skipped },
      { headers: EXTENSION_CORS_HEADERS },
    );
  } catch (err) {
    console.error("[extension] smartfill failed", err);
    return NextResponse.json(
      { error: "Couldn't smart-fill this form — please try again or use fast-fill." },
      { status: 500, headers: EXTENSION_CORS_HEADERS },
    );
  }
}
