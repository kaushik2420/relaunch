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

  // Sanitize ILIKE wildcards in the user's input so they're treated as
  // literal characters (a user typing "100%" wouldn't accidentally hit
  // "match anything").
  const safe = q.replace(/[%_]/g, "\\$&");
  const pattern = `%${safe}%`;

  // Two separate .ilike() queries beats a single .or() call: the
  // PostgREST .or() syntax is finicky about escaping when the value
  // contains %, commas, or dots — the way ours always does — and was
  // throwing a 500 in production. Two short queries are also still
  // O(1) round-trips when run in parallel.
  const admin = supabaseAdmin();
  const COLUMNS =
    "id, apply_url, ats, ats_id, job_title, company, match_percent, created_at";
  const [byTitle, byCompany] = await Promise.all([
    admin
      .from("job_matches")
      .select(COLUMNS)
      .eq("user_id", auth.userId)
      .ilike("job_title", pattern)
      .order("created_at", { ascending: false })
      .limit(limit),
    admin
      .from("job_matches")
      .select(COLUMNS)
      .eq("user_id", auth.userId)
      .ilike("company", pattern)
      .order("created_at", { ascending: false })
      .limit(limit),
  ]);

  if (byTitle.error || byCompany.error) {
    console.error("[extension] search failed", {
      titleErr: byTitle.error,
      companyErr: byCompany.error,
    });
    return NextResponse.json(
      { error: "Search failed — please try again." },
      { status: 500, headers: EXTENSION_CORS_HEADERS },
    );
  }

  // Merge, dedupe by id (title and company hits often overlap), sort
  // by match_percent desc then created_at desc, then cap to limit.
  const merged = new Map<string, (typeof byTitle.data extends (infer T)[] ? T : never)>();
  for (const row of byTitle.data ?? []) merged.set(row.id, row);
  for (const row of byCompany.data ?? []) {
    if (!merged.has(row.id)) merged.set(row.id, row);
  }
  const sorted = Array.from(merged.values()).sort((a, b) => {
    const am = a.match_percent ?? -1;
    const bm = b.match_percent ?? -1;
    if (bm !== am) return bm - am;
    return (b.created_at ?? "").localeCompare(a.created_at ?? "");
  });

  return NextResponse.json(
    {
      query: q,
      results: sorted.slice(0, limit).map((r) => ({
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
