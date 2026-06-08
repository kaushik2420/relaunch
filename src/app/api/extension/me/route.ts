import { NextResponse, type NextRequest } from "next/server";
import {
  authenticateExtension,
  EXTENSION_CORS_HEADERS,
} from "@/lib/extension-auth";
import type { UserProfile } from "@/lib/types";

export const runtime = "nodejs";

/** Pre-flight for the extension's content-script CORS requests. */
export function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: EXTENSION_CORS_HEADERS,
  });
}

/**
 * Validate the extension token and return the user identity + profile.
 * The extension calls this on every load to decide whether to show the
 * "not connected" state or proceed to the per-page match lookup.
 */
export async function GET(req: NextRequest) {
  const auth = await authenticateExtension(req.headers.get("authorization"));
  if (!auth.ok) {
    return NextResponse.json(
      { error: auth.message },
      { status: auth.status, headers: EXTENSION_CORS_HEADERS },
    );
  }

  const profile = (auth.profile ?? {}) as Partial<UserProfile>;
  const links = profile.links ?? {};
  return NextResponse.json(
    {
      user: {
        id: auth.userId,
        email: auth.email,
        firstName: auth.firstName,
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
