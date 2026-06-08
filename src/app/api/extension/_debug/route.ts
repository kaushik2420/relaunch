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
 * Diagnostic: given a URL, return the canonical form, extracted ats/
 * ats_id, lookup result against job_matches, and a sample of what's
 * actually in the user's job_matches table for visual comparison.
 *
 * Allowlist-gated (extension auth + EXTENSION_ALLOWLIST). Safe to call
 * from the popup with the same Authorization header as /me.
 */
export async function GET(req: NextRequest) {
  const auth = await authenticateExtension(req.headers.get("authorization"));
  if (!auth.ok) {
    return NextResponse.json(
      { error: auth.message },
      { status: auth.status, headers: EXTENSION_CORS_HEADERS },
    );
  }

  const rawUrl = new URL(req.url).searchParams.get("url");
  if (!rawUrl) {
    return NextResponse.json(
      { error: "Missing `url` parameter." },
      { status: 400, headers: EXTENSION_CORS_HEADERS },
    );
  }

  const cls = classifyAtsUrl(rawUrl);
  const admin = supabaseAdmin();

  const [exact, byAtsId, recent, total] = await Promise.all([
    admin
      .from("job_matches")
      .select("id, apply_url, ats, ats_id, job_title, company, created_at")
      .eq("user_id", auth.userId)
      .eq("apply_url", cls.canonical)
      .maybeSingle()
      .then((r) => r.data),
    cls.ats && cls.atsId
      ? admin
          .from("job_matches")
          .select("id, apply_url, ats, ats_id, job_title, company, created_at")
          .eq("user_id", auth.userId)
          .eq("ats", cls.ats)
          .eq("ats_id", cls.atsId)
          .maybeSingle()
          .then((r) => r.data)
      : Promise.resolve(null),
    admin
      .from("job_matches")
      .select("apply_url, ats, ats_id, job_title, company, created_at")
      .eq("user_id", auth.userId)
      .order("created_at", { ascending: false })
      .limit(5)
      .then((r) => r.data ?? []),
    admin
      .from("job_matches")
      .select("id", { count: "exact", head: true })
      .eq("user_id", auth.userId)
      .then((r) => r.count ?? 0),
  ]);

  return NextResponse.json(
    {
      input: rawUrl,
      classified: {
        canonical: cls.canonical,
        ats: cls.ats,
        atsId: cls.atsId,
      },
      lookups: {
        byCanonicalUrl: exact ? "HIT" : "MISS",
        byAtsId: cls.ats && cls.atsId ? (byAtsId ? "HIT" : "MISS") : "n/a — no ats_id extractable",
      },
      hit: exact ?? byAtsId ?? null,
      youHaveTotalMatches: total,
      yourFiveMostRecentStoredMatches: recent,
      note:
        exact || byAtsId
          ? "A match exists; the regular /api/extension/job should also return it."
          : "No match in either index. Compare the 'canonical' URL above to the 'apply_url' values in 'yourFiveMostRecentStoredMatches' — most-common causes are (a) the stored URL is a redirect URL (adzuna.in / jooble.org) while you're on the underlying ATS page, or (b) the ats_id couldn't be extracted from either side.",
    },
    { headers: EXTENSION_CORS_HEADERS },
  );
}
