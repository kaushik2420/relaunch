import { NextResponse, type NextRequest } from "next/server";
import {
  authenticateExtension,
  EXTENSION_CORS_HEADERS,
} from "@/lib/extension-auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { classifyAtsUrl } from "@/lib/ats-url";

export const runtime = "nodejs";

export function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: EXTENSION_CORS_HEADERS,
  });
}

/**
 * "Add this job to Relaunch" — user is on a job page (LinkedIn, a
 * wrapper, anywhere) and wants to save it as a tailorable match
 * without waiting for the daily cron to pick it up.
 *
 * We don't tailor here — that's an expensive Sonnet path, kept on
 * demand. The user clicks "Generate tailored content" in the popup
 * once the row is saved, exactly the same flow as backfilled matches.
 *
 * Body: { url, jobTitle, company, location?, description? }
 * Returns: { matchId }
 */
export async function POST(req: NextRequest) {
  const auth = await authenticateExtension(req.headers.get("authorization"));
  if (!auth.ok) {
    return NextResponse.json(
      { error: auth.message },
      { status: auth.status, headers: EXTENSION_CORS_HEADERS },
    );
  }

  let body: {
    url?: string;
    jobTitle?: string;
    company?: string;
    location?: string;
    description?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body." },
      { status: 400, headers: EXTENSION_CORS_HEADERS },
    );
  }

  const url = (body.url ?? "").trim();
  const jobTitle = (body.jobTitle ?? "").trim();
  const company = (body.company ?? "").trim();
  if (!url || !url.startsWith("http") || !jobTitle) {
    return NextResponse.json(
      {
        error:
          "Couldn't read enough from this page. We need at least a URL and a job title.",
      },
      { status: 400, headers: EXTENSION_CORS_HEADERS },
    );
  }

  const cls = classifyAtsUrl(url);

  // Upsert on (user_id, apply_url) — if the user clicks add on a page
  // we already know about, we don't blow away tailored content. We
  // also don't try to repopulate it; existing rows win.
  const admin = supabaseAdmin();
  const { data: existing } = await admin
    .from("job_matches")
    .select("id, tailored_resume_text")
    .eq("user_id", auth.userId)
    .eq("apply_url", cls.canonical)
    .maybeSingle();

  if (existing) {
    return NextResponse.json(
      { matchId: existing.id, alreadyExisted: true },
      { headers: EXTENSION_CORS_HEADERS },
    );
  }

  const { data: inserted, error } = await admin
    .from("job_matches")
    .insert({
      user_id: auth.userId,
      apply_url: cls.canonical,
      ats: cls.ats,
      ats_id: cls.atsId,
      job_title: jobTitle.slice(0, 240),
      company: (company || "(unknown company)").slice(0, 240),
      // No tailored content yet — user enriches on demand. No verify
      // score either — they manually trusted this match, so we skip
      // the LLM verification step.
      match_percent: null,
      verify_score: null,
      tailored_resume_text: null,
      tailored_resume_pdf_url: null,
      tailored_resume_doc_url: null,
      cover_letter_text: null,
      cover_letter_pdf_url: null,
      cover_letter_doc_url: null,
      why_this_role: null,
      summary: null,
      updated_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (error || !inserted) {
    console.error("[extension] add-match failed", error);
    return NextResponse.json(
      { error: "Couldn't save this job — please try again." },
      { status: 500, headers: EXTENSION_CORS_HEADERS },
    );
  }

  return NextResponse.json(
    { matchId: inserted.id, alreadyExisted: false },
    { headers: EXTENSION_CORS_HEADERS },
  );
}
