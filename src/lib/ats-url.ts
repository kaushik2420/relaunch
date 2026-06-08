/**
 * Detect which ATS hosts a given job URL and extract a stable source-side
 * job ID where possible. The extension uses these to match a wrapper URL
 * (e.g. `careers.datadoghq.com/detail/123/?gh_jid=123`) to the canonical
 * Greenhouse / Lever / Ashby record stored in `job_matches`.
 *
 * Returning `{ ats: null, atsId: null }` is fine — the extension falls
 * back to host+path matching.
 */
export type AtsKey = "greenhouse" | "lever" | "ashby" | "linkedin";

export interface AtsHit {
  ats: AtsKey | null;
  atsId: string | null;
  /** Normalized URL — protocol + host + path, lowercased host, no query
   *  or hash — used as a stable secondary match key. */
  canonical: string;
}

export function classifyAtsUrl(rawUrl: string): AtsHit {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return { ats: null, atsId: null, canonical: rawUrl.toLowerCase() };
  }
  const host = u.hostname.toLowerCase();
  const path = u.pathname;
  const canonical = `${u.protocol}//${host}${stripTrailingSlash(path)}`;

  // ---- Greenhouse --------------------------------------------------
  // Direct: boards.greenhouse.io/<co>/jobs/<id>
  // Embedded under any company careers page exposes ?gh_jid=<id>.
  if (host === "boards.greenhouse.io" || host.endsWith(".greenhouse.io")) {
    const m = path.match(/\/jobs\/(\d+)/);
    if (m && m[1]) return { ats: "greenhouse", atsId: m[1], canonical };
  }
  const ghJid = u.searchParams.get("gh_jid");
  if (ghJid) {
    return { ats: "greenhouse", atsId: ghJid, canonical };
  }

  // ---- Lever -------------------------------------------------------
  // jobs.lever.co/<co>/<uuid>[/apply]
  if (host === "jobs.lever.co") {
    const parts = path.split("/").filter(Boolean);
    // /<co>/<uuid>  (uuid is 36 chars, hyphen-segmented)
    const second = parts[1];
    if (second && /^[a-z0-9-]{8,}$/i.test(second)) {
      return { ats: "lever", atsId: second, canonical };
    }
  }

  // ---- Ashby -------------------------------------------------------
  // jobs.ashbyhq.com/<co>/<uuid>[/application]
  if (host === "jobs.ashbyhq.com" || host.endsWith(".ashbyhq.com")) {
    const parts = path.split("/").filter(Boolean);
    if (parts.length >= 2) {
      // Prefer the last UUID-looking segment.
      const uuid = [...parts].reverse().find((p) => /^[a-z0-9-]{20,}$/i.test(p));
      if (uuid) return { ats: "ashby", atsId: uuid, canonical };
    }
  }

  // ---- LinkedIn ----------------------------------------------------
  // linkedin.com/jobs/view/<id>
  if (host === "www.linkedin.com" || host.endsWith(".linkedin.com")) {
    const m = path.match(/\/jobs\/view\/(\d+)/);
    if (m && m[1]) return { ats: "linkedin", atsId: m[1], canonical };
  }

  return { ats: null, atsId: null, canonical };
}

function stripTrailingSlash(p: string): string {
  return p.length > 1 && p.endsWith("/") ? p.slice(0, -1) : p;
}
