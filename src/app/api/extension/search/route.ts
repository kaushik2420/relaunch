import { NextResponse, type NextRequest } from "next/server";
import {
  authenticateExtension,
  EXTENSION_CORS_HEADERS,
} from "@/lib/extension-auth";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: EXTENSION_CORS_HEADERS,
  });
}

/**
 * Fallback search for when the URL auto-lookup misses (most common
 * cause: stored URLs are Adzuna/Jooble redirects but the user is on
 * the underlying ATS page). The user types/pastes the job title (and
 * optionally the company) and we surface candidates from their
 * existing job_matches.
 *
 * Implementation: ILIKE on job_title and company. We don't need
 * pg_trgm here — the user is searching their own (small) list of
 * matches, so a substring match is more than enough.
 */
export async function GET(req: NextRequest) {
  const auth = await authenticateExtension(req.headers.get("authorization"));
  if (!auth.ok) {
    return NextResponse.json(
      { error: auth.message },
      { status: auth.status, headers: EXTENSION_CORS_HEADERS },
    );
  }

  const u = new URL(req.url);
  const q = (u.searchParams.get("q") ?? "").trim();
  const limit = Math.min(
    Math.max(parseInt(u.searchParams.get("limit") ?? "5", 10) || 5, 1),
    20,
  );

  if (q.length < 2) {
    return NextResponse.json(
      { error: "Query must be at least 2 characters.", results: [] },
      { status: 400, headers: EXTENSION_CORS_HEADERS },
    );
  }

  // Sanitize for ILIKE — escape % and _ so user-typed values aren't
  // accidentally treated as wildcards.
  const safe = q.replace(/[\\%_]/g, "\\$&");
  const pattern = `%${safe}%`;

  const { data, error } = await supabaseAdmin()
    .from("job_matches")
    .select(
      "id, apply_url, ats, ats_id, job_title, company, match_percent, created_at",
    )
    .eq("user_id", auth.userId)
    .or(`job_title.ilike.${pattern},company.ilike.${pattern}`)
    .order("match_percent", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("[extension] search failed", error);
    return NextResponse.json(
      { error: "Search failed — please try again." },
      { status: 500, headers: EXTENSION_CORS_HEADERS },
    );
  }

  return NextResponse.json(
    {
      query: q,
      results: (data ?? []).map((r) => ({
        id: r.id,
        jobTitle: r.job_title,
        company: r.company,
        applyUrl: r.apply_url,
        matchPercent: r.match_percent ?? 0,
      })),
    },
    { headers: EXTENSION_CORS_HEADERS },
  );
}
