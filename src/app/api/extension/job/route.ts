import { NextResponse, type NextRequest } from "next/server";
import {
  authenticateExtension,
  EXTENSION_CORS_HEADERS,
} from "@/lib/extension-auth";

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
 * STUB: Returns 404 until migration 0010 (job_matches table) and the
 * daily-runner write are in place. The extension already handles 404
 * gracefully ("This page isn't a Relaunch match yet"), so connecting
 * the extension still works end-to-end via /me — users just won't see
 * per-match content until this is filled in.
 *
 * Final implementation will:
 *  1. Parse the host + path from the `url` query param (ignore query
 *     strings, hashes, and case).
 *  2. Look up the most recent `job_matches` row for this user where
 *     normalize(apply_url) matches.
 *  3. Return { match, tailored, profile } per the spec.
 */
export async function GET(req: NextRequest) {
  const auth = await authenticateExtension(req.headers.get("authorization"));
  if (!auth.ok) {
    return NextResponse.json(
      { error: auth.message },
      { status: auth.status, headers: EXTENSION_CORS_HEADERS },
    );
  }

  const url = new URL(req.url).searchParams.get("url");
  if (!url) {
    return NextResponse.json(
      { error: "Missing `url` parameter." },
      { status: 400, headers: EXTENSION_CORS_HEADERS },
    );
  }

  // Stub — per-match storage doesn't exist yet (migration 0010 + daily-
  // runner write are tracked in the extension v1 ship checklist).
  return NextResponse.json(
    {
      error: "No match found for this URL.",
      note:
        "Per-match storage is still being wired in. The extension's /me endpoint works, so connection + profile data flow through; per-job tailored payloads will follow shortly.",
    },
    { status: 404, headers: EXTENSION_CORS_HEADERS },
  );
}
