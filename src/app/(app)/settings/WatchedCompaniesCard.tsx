import {
  addWatchedCompanyAction,
  removeWatchedCompanyAction,
  retryWatchedCompanyAction,
} from "./watched-companies-actions";

interface WatchedRow {
  id: string;
  name: string;
  ats: string | null;
  ats_slug: string | null;
  detection_status: "pending" | "detected" | "manual" | "not_found";
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
            <li
              key={r.id}
              className="flex items-center justify-between gap-3 rounded-lg border border-line bg-white px-3 py-2"
            >
              <div className="min-w-0">
                <div className="font-semibold text-ink truncate">{r.name}</div>
                <StatusLine row={r} />
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {r.detection_status === "not_found" && (
                  <form action={retryWatchedCompanyAction}>
                    <input type="hidden" name="id" value={r.id} />
                    <button className="btn-soft text-xs">Retry</button>
                  </form>
                )}
                <form action={removeWatchedCompanyAction}>
                  <input type="hidden" name="id" value={r.id} />
                  <button
                    className="btn-ghost text-xs text-rose-700 hover:bg-rose-50"
                    type="submit"
                    aria-label={`Remove ${r.name}`}
                  >
                    Remove
                  </button>
                </form>
              </div>
            </li>
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
  if (row.detection_status === "not_found") {
    return (
      <div className="mt-0.5 text-xs">
        <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 font-semibold text-amber-800">
          Not found on supported ATSes
        </span>
        <span className="ml-2 text-ink-mute">
          They may use a custom careers page or a system we don&apos;t
          track yet.
        </span>
      </div>
    );
  }
  return null;
}
