import {
  addWatchedCompanyAction,
  removeWatchedCompanyAction,
  retryWatchedCompanyAction,
  setManualCareersUrlAction,
} from "./watched-companies-actions";

interface WatchedRow {
  id: string;
  name: string;
  ats: string | null;
  ats_slug: string | null;
  detection_status: "pending" | "detected" | "manual" | "not_found";
  careers_url: string | null;
  last_checked_at: string | null;
  created_at: string;
}

const MAX_WATCHED = 20;

export function WatchedCompaniesCard({ rows }: { rows: WatchedRow[] }) {
  const count = rows.length;
  const remaining = Math.max(0, MAX_WATCHED - count);

  return (
    <div className="card">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold">Watched companies</h2>
          <p className="mt-1 text-sm text-ink-soft">
            Pick companies you&apos;re actively interested in — we&apos;ll
            track their career pages and surface new openings in your daily
            digest, even if the global job APIs miss them.
          </p>
        </div>
        <span className="chip text-xs whitespace-nowrap">
          {count}/{MAX_WATCHED}
        </span>
      </div>

      {/* Add form */}
      <form action={addWatchedCompanyAction} className="mt-4 flex gap-2">
        <input
          type="text"
          name="name"
          placeholder="e.g. Stripe, Razorpay, Cred"
          required
          maxLength={80}
          disabled={remaining === 0}
          className="field flex-1"
        />
        <button
          type="submit"
          className="btn-primary text-sm whitespace-nowrap"
          disabled={remaining === 0}
        >
          {remaining === 0 ? "Max reached" : "Add company"}
        </button>
      </form>

      {count === 0 ? (
        <p className="mt-4 text-sm text-ink-mute">
          No companies watched yet. Start with 2–3 you&apos;d love to work at.
        </p>
      ) : (
        <ul className="mt-4 space-y-2">
          {rows.map((r) => (
            <WatchedRowItem key={r.id} row={r} />
          ))}
        </ul>
      )}

      <details className="mt-4 text-xs text-ink-soft">
        <summary className="cursor-pointer font-semibold hover:text-ink">
          How does this work?
        </summary>
        <p className="mt-2 leading-relaxed">
          When you add a company, Relaunch checks Greenhouse, Lever, Ashby,
          Workable, SmartRecruiters, and Recruitee in parallel to find which
          ATS hosts their careers page. The next daily run pulls postings
          from that company&apos;s board too, in addition to the global job
          aggregators. Companies whose ATS we can&apos;t detect stay on
          your list with a &quot;Not found&quot; tag — click Retry if they
          publish on a new platform later.
        </p>
      </details>
    </div>
  );
}

/** One row in the watchlist — shows status, allows
 *  retry/remove/url-fallback inline based on detection_status. */
function WatchedRowItem({ row }: { row: WatchedRow }) {
  return (
    <li className="rounded-lg border border-line bg-white px-3 py-2">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="font-semibold text-ink truncate">{row.name}</div>
          <StatusLine row={row} />
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {row.detection_status === "not_found" && (
            <form action={retryWatchedCompanyAction}>
              <input type="hidden" name="id" value={row.id} />
              <button className="btn-soft text-xs">Retry auto-detect</button>
            </form>
          )}
          <form action={removeWatchedCompanyAction}>
            <input type="hidden" name="id" value={row.id} />
            <button
              className="btn-ghost text-xs text-rose-700 hover:bg-rose-50"
              type="submit"
              aria-label={`Remove ${row.name}`}
            >
              Remove
            </button>
          </form>
        </div>
      </div>

      {/* Inline fallback form for not_found — let the user paste a
          careers page URL we'll track manually. */}
      {row.detection_status === "not_found" && (
        <form
          action={setManualCareersUrlAction}
          className="mt-2 flex flex-wrap gap-2 rounded-md bg-brand-50/60 p-2"
        >
          <input type="hidden" name="id" value={row.id} />
          <input
            type="url"
            name="careersUrl"
            placeholder={`https://${row.name.toLowerCase()}.com/careers`}
            required
            className="field flex-1 min-w-[160px] text-xs"
          />
          <button type="submit" className="btn-soft text-xs whitespace-nowrap">
            Track via this URL →
          </button>
        </form>
      )}
    </li>
  );
}

function StatusLine({ row }: { row: WatchedRow }) {
  if (row.detection_status === "detected") {
    return (
      <div className="mt-0.5 text-xs">
        <span className="inline-flex items-center rounded-full bg-success-soft px-2 py-0.5 font-semibold text-success">
          ✓ Tracking via {row.ats}
        </span>
      </div>
    );
  }
  if (row.detection_status === "pending") {
    return (
      <div className="mt-0.5 text-xs text-ink-mute">Auto-detecting ATS…</div>
    );
  }
  if (row.detection_status === "manual") {
    const checked = row.last_checked_at
      ? formatRelative(new Date(row.last_checked_at))
      : null;
    return (
      <div className="mt-0.5 text-xs">
        <span className="inline-flex items-center rounded-full bg-brand-50 px-2 py-0.5 font-semibold text-brand-700">
          📌 Manual tracking
        </span>
        {row.careers_url && (
          <a
            href={row.careers_url}
            target="_blank"
            rel="noreferrer"
            className="ml-2 text-brand-700 hover:underline break-all"
          >
            Visit careers page →
          </a>
        )}
        {checked && (
          <span className="ml-2 text-ink-mute">· Last checked {checked}</span>
        )}
      </div>
    );
  }
  if (row.detection_status === "not_found") {
    return (
      <div className="mt-0.5 text-xs">
        <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 font-semibold text-amber-800">
          Not found on supported ATSes
        </span>
        <p className="mt-1 text-ink-soft">
          We couldn&apos;t auto-detect them. Paste their careers page URL
          below to keep tracking them manually.
        </p>
      </div>
    );
  }
  return null;
}

/** Coarse "5 min ago" / "2 hours ago" / "yesterday" formatter. */
function formatRelative(d: Date): string {
  const diffMs = Date.now() - d.getTime();
  if (diffMs < 60_000) return "just now";
  const m = Math.round(diffMs / 60_000);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
  const days = Math.round(h / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  return d.toLocaleDateString();
}
