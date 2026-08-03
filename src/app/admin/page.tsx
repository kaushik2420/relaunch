import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { serverConfig } from "@/lib/config";
import { Logo } from "@/components/Logo";
import {
  approveAndInviteAction,
  previewBroadcastAction,
  runDailyDigestForAllAction,
  runSentinelNowAction,
  sendBroadcastAction,
} from "./actions";
import {
  estimateMonthlyCost,
  type CostEstimate,
} from "@/lib/services/cost-estimate";
import { SubmitButton } from "@/components/SubmitButton";

export const dynamic = "force-dynamic";

type Row = {
  id: string;
  email: string;
  first_name: string | null;
  linkedin_url: string | null;
  status: string;
  created_at: string;
  invited_at: string | null;
};

type FeedbackRow = {
  id: string;
  name: string | null;
  email: string | null;
  rating: number | null;
  message: string;
  created_at: string;
};

export default async function AdminPage({
  searchParams,
}: {
  searchParams: {
    error?: string;
    invited?: string;
    backfill?: string;
    sentinel?: string;
    bcpreview?: string;
    bcresult?: string;
  };
}) {
  const sb = createSupabaseServer();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) redirect("/login");
  if (
    (user.email ?? "").toLowerCase() !==
    serverConfig().ADMIN_EMAIL.toLowerCase()
  ) {
    redirect("/dashboard");
  }

  const { data } = await supabaseAdmin()
    .from("waitlist")
    .select("id, email, first_name, linkedin_url, status, created_at, invited_at")
    .order("created_at", { ascending: false });
  const rows = (data ?? []) as Row[];

  const { data: fbData } = await supabaseAdmin()
    .from("feedback")
    .select("id, name, email, rating, message, created_at")
    .order("created_at", { ascending: false });
  const feedback = (fbData ?? []) as FeedbackRow[];

  const count = (s: string) => rows.filter((r) => r.status === s).length;

  // ---- Cost & usage: aggregate the last 30 days of activity ----
  const since = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
  const { data: runData } = await supabaseAdmin()
    .from("job_runs")
    .select("jobs_emailed, run_at")
    .gte("run_at", since);
  const runRows = (runData ?? []) as { jobs_emailed: number | null }[];
  const tailoredMatches = runRows.reduce(
    (s, r) => s + (Number(r.jobs_emailed) || 0),
    0,
  );
  const emails = runRows.filter((r) => (Number(r.jobs_emailed) || 0) > 0).length;

  const { count: activeUsers } = await supabaseAdmin()
    .from("users")
    .select("id", { count: "exact", head: true })
    .eq("is_active", true);
  const { count: newUsers } = await supabaseAdmin()
    .from("users")
    .select("id", { count: "exact", head: true })
    .gte("created_at", since);

  // OpenAI Web Search actual spend (last 30 days) — pulled from the
  // audit table populated by /api/run-now. Cached rows contribute $0.
  const { data: openaiCostRows } = await supabaseAdmin()
    .from("openai_websearch_calls")
    .select("cost_estimate_usd")
    .gte("created_at", since);
  const openaiWebSearchUsd = (openaiCostRows ?? []).reduce(
    (s, r) => s + (Number(r.cost_estimate_usd) || 0),
    0,
  );

  const usage = {
    activeUsers: activeUsers ?? 0,
    runs: runRows.length,
    tailoredMatches,
    emails,
    newUsers: newUsers ?? 0,
    openaiWebSearchUsd,
  };
  const cost = estimateMonthlyCost(usage);

  // ---- User activity: last login + total active time per user ----
  // last_login_at is stamped on the first heartbeat of every new tab.
  // Active time is the sum of (last_seen_at - started_at) across all
  // sessions — computed here in JS after pulling the raw rows. Cheap
  // for our current user count (<200); revisit as a materialised view
  // when the table grows past ~10k sessions.
  const { data: userData } = await supabaseAdmin()
    .from("users")
    .select("id, email, first_name, last_login_at, created_at, is_paying")
    .order("last_login_at", { ascending: false, nullsFirst: false });
  const userRows = (userData ?? []) as Array<{
    id: string;
    email: string;
    first_name: string | null;
    last_login_at: string | null;
    created_at: string;
    is_paying: boolean | null;
  }>;

  const { data: sessionData } = await supabaseAdmin()
    .from("user_sessions")
    .select("user_id, started_at, last_seen_at");
  const sessionRows = (sessionData ?? []) as Array<{
    user_id: string;
    started_at: string;
    last_seen_at: string;
  }>;

  // Aggregate: total active seconds + session count per user.
  const activityByUser = new Map<
    string,
    { seconds: number; sessions: number }
  >();
  for (const s of sessionRows) {
    const start = new Date(s.started_at).getTime();
    const end = new Date(s.last_seen_at).getTime();
    // Ignore malformed rows and negative deltas defensively.
    const seconds = Math.max(0, Math.round((end - start) / 1000));
    const cur = activityByUser.get(s.user_id) ?? { seconds: 0, sessions: 0 };
    cur.seconds += seconds;
    cur.sessions += 1;
    activityByUser.set(s.user_id, cur);
  }

  const activityRows = userRows.map((u) => ({
    ...u,
    activeSeconds: activityByUser.get(u.id)?.seconds ?? 0,
    sessionCount: activityByUser.get(u.id)?.sessions ?? 0,
  }));

  // ---- Sentinel: open alerts (unresolved) + last 5 runs ----
  const { data: openAlerts } = await supabaseAdmin()
    .from("sentinel_alerts")
    .select("id, headline, severity, root_cause, suggested_fix, first_detected, last_seen_at, occurrence_count")
    .is("resolved_at", null)
    .order("severity", { ascending: false })
    .order("last_seen_at", { ascending: false })
    .limit(5);
  const { data: recentRuns } = await supabaseAdmin()
    .from("sentinel_runs")
    .select("id, ran_at, severity, headline, notified")
    .order("ran_at", { ascending: false })
    .limit(5);
  const sentinelAlerts = (openAlerts ?? []) as Array<{
    id: string;
    headline: string;
    severity: number;
    root_cause: string | null;
    suggested_fix: string | null;
    first_detected: string;
    last_seen_at: string;
    occurrence_count: number;
  }>;
  const sentinelRuns = (recentRuns ?? []) as Array<{
    id: string;
    ran_at: string;
    severity: number;
    headline: string;
    notified: boolean;
  }>;

  return (
    <main className="min-h-screen bg-surface-page">
      <nav className="flex items-center justify-between border-b border-line bg-surface px-6 py-3.5">
        <Logo />
        <span className="text-sm text-ink-soft">Admin</span>
      </nav>

      <div className="mx-auto max-w-5xl px-6 py-10">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h1 className="text-2xl font-bold">Relaunch admin</h1>
          <Link
            href="/admin/leads"
            className="text-sm font-semibold text-brand-700 hover:underline"
          >
            Distribution leads →
          </Link>
        </div>

        <SentinelPanel
          alerts={sentinelAlerts}
          recentRuns={sentinelRuns}
          justRan={searchParams.sentinel}
        />

        <CostPanel cost={cost} usage={usage} />

        {/* ---- Ops: manual triggers (recovery panel) ---- */}
        <div className="mt-8 rounded-xl border border-line bg-surface p-5">
          <div className="flex items-baseline justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold">Send today's digest to all users</h2>
              <p className="mt-1 text-sm text-ink-soft">
                Runs the full pipeline for every eligible user right now, ignoring
                each user's email_time window. Idempotent by default — users who
                already got today's digest are skipped. Use after an incident
                (e.g. Anthropic credits expired) to backfill missed sends.
              </p>
            </div>
          </div>

          {searchParams.backfill && (
            <BackfillBanner encoded={searchParams.backfill} />
          )}

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <form action={runDailyDigestForAllAction}>
              <SubmitButton
                className="btn-primary"
                pendingLabel="Running… (may take 2-3 min)"
              >
                Backfill missed users
              </SubmitButton>
            </form>
            <form action={runDailyDigestForAllAction}>
              <input type="hidden" name="force" value="1" />
              <SubmitButton
                className="btn-soft"
                pendingLabel="Running… (may take 2-3 min)"
              >
                Force re-run everyone
              </SubmitButton>
            </form>
            <span className="text-xs text-ink-mute">
              Long-running: if the browser times out the runs continue in the
              background. Refresh this page to see final counts in the cost
              panel above.
            </span>
          </div>
        </div>

        <BroadcastPanel
          preview={searchParams.bcpreview}
          result={searchParams.bcresult}
        />

        {/* ---- Users & activity ---- */}
        <div className="mt-12 flex items-baseline gap-3">
          <h2 className="text-xl font-bold">Users &amp; activity</h2>
          <span className="text-sm text-ink-soft">
            {activityRows.length} total
          </span>
        </div>
        <p className="mt-1 text-sm text-ink-soft">
          Last login and total active time (sum of session heartbeats,
          idle time excluded). Newest logins first.
        </p>

        <div className="mt-4 overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="w-full text-sm">
            <thead className="bg-surface-page text-left text-xs uppercase tracking-wide text-ink-soft">
              <tr>
                <th className="px-4 py-3 font-semibold">User</th>
                <th className="px-4 py-3 font-semibold">Signed up</th>
                <th className="px-4 py-3 font-semibold">Last login</th>
                <th className="px-4 py-3 font-semibold">Active time</th>
                <th className="px-4 py-3 text-right font-semibold">Sessions</th>
              </tr>
            </thead>
            <tbody>
              {activityRows.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-ink-soft">
                    No users yet.
                  </td>
                </tr>
              )}
              {activityRows.map((u) => (
                <tr key={u.id} className="border-t border-line align-middle">
                  <td className="px-4 py-3">
                    <div className="font-medium">
                      {u.first_name || "—"}
                      {u.is_paying && (
                        <span className="ml-2 rounded-full bg-accent-500/30 px-2 py-0.5 text-[10px] font-semibold text-brand-700">
                          Paying
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-ink-mute">{u.email}</div>
                  </td>
                  <td className="px-4 py-3 text-ink-mute">
                    {fmtDate(u.created_at)}
                  </td>
                  <td className="px-4 py-3">
                    {u.last_login_at ? (
                      <>
                        <div>{fmtRelative(u.last_login_at)}</div>
                        <div className="text-xs text-ink-mute">
                          {fmtDateTime(u.last_login_at)}
                        </div>
                      </>
                    ) : (
                      <span className="text-ink-mute">Never</span>
                    )}
                  </td>
                  <td className="px-4 py-3 font-medium">
                    {fmtDuration(u.activeSeconds)}
                  </td>
                  <td className="px-4 py-3 text-right text-ink-mute">
                    {u.sessionCount}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <h2 className="mt-12 text-xl font-bold">Early-access waitlist</h2>
        <p className="mt-1 text-sm text-ink-soft">
          Review each applicant&apos;s LinkedIn, then approve to email them a
          private, single-use invite link.
        </p>

        <div className="mt-4 flex flex-wrap gap-3 text-sm">
          <Stat label="Pending" value={count("pending")} />
          <Stat label="Invited" value={count("invited")} />
          <Stat label="Joined" value={count("joined")} />
        </div>

        {searchParams.invited && (
          <p className="mt-4 rounded-lg border border-success/30 bg-success-soft p-3 text-sm">
            ✅ Invite emailed to {decodeURIComponent(searchParams.invited)}.
          </p>
        )}
        {searchParams.error && (
          <p className="mt-4 rounded-lg border border-danger/30 bg-danger-soft p-3 text-sm text-danger">
            {decodeURIComponent(searchParams.error)}
          </p>
        )}

        <div className="mt-6 overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="w-full text-sm">
            <thead className="bg-surface-page text-left text-xs uppercase tracking-wide text-ink-soft">
              <tr>
                <th className="px-4 py-3 font-semibold">Name</th>
                <th className="px-4 py-3 font-semibold">Email</th>
                <th className="px-4 py-3 font-semibold">LinkedIn</th>
                <th className="px-4 py-3 font-semibold">Requested</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 text-right font-semibold">Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-ink-soft">
                    No early-access requests yet.
                  </td>
                </tr>
              )}
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-line align-middle">
                  <td className="px-4 py-3 font-medium">{r.first_name || "—"}</td>
                  <td className="px-4 py-3 text-ink-soft">{r.email}</td>
                  <td className="px-4 py-3">
                    {r.linkedin_url ? (
                      <a
                        href={normalizeUrl(r.linkedin_url)}
                        target="_blank"
                        rel="noreferrer"
                        className="text-brand-700 hover:underline"
                      >
                        View profile ↗
                      </a>
                    ) : (
                      <span className="text-ink-mute">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-ink-mute">
                    {fmtDate(r.created_at)}
                  </td>
                  <td className="px-4 py-3">
                    <StatusChip status={r.status} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    {r.status === "joined" ? (
                      <span className="text-xs text-ink-mute">Signed up ✓</span>
                    ) : (
                      <form action={approveAndInviteAction}>
                        <input type="hidden" name="waitlistId" value={r.id} />
                        <SubmitButton
                          className={
                            r.status === "invited"
                              ? "btn-ghost text-xs"
                              : "btn-primary text-xs"
                          }
                          pendingLabel={
                            r.status === "invited" ? "Resending…" : "Sending…"
                          }
                        >
                          {r.status === "invited"
                            ? "Resend invite"
                            : "Approve & send invite"}
                        </SubmitButton>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* ---- Feedback ---- */}
        <div className="mt-12 flex items-baseline gap-3">
          <h2 className="text-xl font-bold">Feedback</h2>
          <span className="text-sm text-ink-soft">{feedback.length} total</span>
        </div>
        <p className="mt-1 text-sm text-ink-soft">
          What people are telling us — newest first.
        </p>

        {feedback.length === 0 ? (
          <p className="mt-4 rounded-lg border border-line bg-surface p-4 text-sm text-ink-soft">
            No feedback yet.
          </p>
        ) : (
          <div className="mt-4 space-y-3">
            {feedback.map((f) => (
              <div
                key={f.id}
                className="rounded-xl border border-line bg-surface p-4"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-semibold">
                    {f.name || f.email || "Anonymous"}
                  </span>
                  <span className="flex items-center gap-2 text-xs text-ink-mute">
                    {f.rating ? (
                      <span className="rounded-full bg-brand-50 px-2 py-0.5 font-semibold text-brand-700">
                        {f.rating}/5
                      </span>
                    ) : null}
                    {fmtDate(f.created_at)}
                  </span>
                </div>
                <p className="mt-1.5 whitespace-pre-wrap text-sm text-ink">
                  {f.message}
                </p>
                {f.email && (
                  <p className="mt-2 text-xs text-ink-mute">{f.email}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}

function usd(n: number): string {
  return "$" + (Math.round(n * 100) / 100).toFixed(2);
}

function CostPanel({
  cost,
  usage,
}: {
  cost: CostEstimate;
  usage: {
    activeUsers: number;
    runs: number;
    tailoredMatches: number;
    emails: number;
    newUsers: number;
  };
}) {
  return (
    <div className="mt-6 rounded-xl border border-line bg-surface p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-xl font-bold">Cost &amp; usage</h2>
        <span className="text-xs text-ink-mute">Estimate · last 30 days</span>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <BigStat label="Est. monthly burn" value={usd(cost.monthlyBurn)} tone="ink" />
        <BigStat
          label="Projected at 40 users"
          value={usd(cost.projectedAt40)}
          tone="brand"
        />
        <BigStat
          label="Per active user / month"
          value={usd(cost.perActiveUser)}
          tone="ink"
        />
      </div>

      <div className="mt-4 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
        <CostLine label="Claude — resume, cover letter, InMail" value={usd(cost.llmCost)} />
        <CostLine label="Resume parsing — new sign-ups" value={usd(cost.parseCost)} />
        <CostLine label="Email — Resend digests" value={usd(cost.emailCost)} />
        <CostLine
          label="OpenAI web search (actual)"
          value={usd(cost.openaiWebSearchCost)}
        />
        <CostLine label="Fixed monthly — infra + job APIs" value={usd(cost.fixedMonthly)} />
      </div>

      <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-xs text-ink-soft">
        <span><strong className="text-ink">{usage.activeUsers}</strong> active users</span>
        <span><strong className="text-ink">{usage.runs}</strong> daily runs</span>
        <span><strong className="text-ink">{usage.tailoredMatches}</strong> tailored matches</span>
        <span><strong className="text-ink">{usage.emails}</strong> digest emails</span>
        <span><strong className="text-ink">{usage.newUsers}</strong> new sign-ups</span>
      </div>

      <p className="mt-4 text-xs text-ink-mute">
        Estimate only — tune the per-unit rates in{" "}
        <code className="rounded bg-surface-page px-1">
          src/lib/services/cost-estimate.ts
        </code>
        . Authoritative numbers live in each provider&apos;s console:
      </p>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
        <a
          href="https://console.anthropic.com/settings/usage"
          target="_blank"
          rel="noreferrer"
          className="text-brand-700 hover:underline"
        >
          Anthropic usage ↗
        </a>
        <a
          href="https://resend.com/overview"
          target="_blank"
          rel="noreferrer"
          className="text-brand-700 hover:underline"
        >
          Resend ↗
        </a>
        <a
          href="https://supabase.com/dashboard/project/_/settings/billing"
          target="_blank"
          rel="noreferrer"
          className="text-brand-700 hover:underline"
        >
          Supabase billing ↗
        </a>
        <a
          href="https://vercel.com/dashboard/usage"
          target="_blank"
          rel="noreferrer"
          className="text-brand-700 hover:underline"
        >
          Vercel usage ↗
        </a>
      </div>
    </div>
  );
}

function BigStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "ink" | "brand";
}) {
  return (
    <div className="rounded-lg border border-line bg-surface-page px-4 py-3">
      <div
        className={`text-2xl font-bold ${
          tone === "brand" ? "text-brand-700" : "text-ink"
        }`}
      >
        {value}
      </div>
      <div className="mt-0.5 text-xs text-ink-soft">{label}</div>
    </div>
  );
}

function CostLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-line py-1.5">
      <span className="text-ink-soft">{label}</span>
      <span className="font-semibold text-ink">{value}</span>
    </div>
  );
}

/** Broadcast panel — draft + send an announcement email to a chosen
 *  audience (active users, active + invitees, or everyone). Pre-fills
 *  a launch template for the AI-discovered feature. Preview shows the
 *  recipient count before sending. Long-running: send happens
 *  server-side, redirects back with a summary banner. */
function BroadcastPanel({
  preview,
  result,
}: {
  preview?: string;
  result?: string;
}) {
  // Preview format: "audience|total:N,active:N,invited:N,pending:N"
  let previewAudience = '';
  let previewCounts: Record<string, number> = {};
  if (preview) {
    const [aud, summary] = decodeURIComponent(preview).split('|');
    previewAudience = aud ?? '';
    for (const kv of (summary ?? '').split(',')) {
      const [k, v] = kv.split(':');
      if (k && v) previewCounts[k] = Number(v) || 0;
    }
  }
  // Result format: "recipientCount,succeeded,failed,seconds"
  let sentSummary: {
    recipients: number;
    succeeded: number;
    failed: number;
    seconds: number;
  } | null = null;
  if (result) {
    const parts = decodeURIComponent(result).split(',').map((n) => Number(n) || 0);
    sentSummary = {
      recipients: parts[0] ?? 0,
      succeeded: parts[1] ?? 0,
      failed: parts[2] ?? 0,
      seconds: parts[3] ?? 0,
    };
  }

  return (
    <div className="mt-8 rounded-xl border border-line bg-surface p-5">
      <h2 className="text-lg font-bold">Broadcast email</h2>
      <p className="mt-1 text-sm text-ink-soft">
        Draft and send an announcement to your audience. Use{" "}
        <code className="rounded bg-surface-page px-1 text-xs">{`{{firstName}}`}</code>{" "}
        in the body — it gets replaced with the recipient&apos;s first name
        (or &ldquo;friend&rdquo; when absent). Sends via Resend, one row
        per recipient logged to broadcast_recipients.
      </p>

      {sentSummary && (
        <div
          className={`mt-3 rounded-lg border p-3 text-sm ${
            sentSummary.failed === 0
              ? "border-success/30 bg-success-soft text-ink"
              : "border-warn/30 bg-warn-soft text-ink"
          }`}
        >
          {sentSummary.failed === 0
            ? `✅ Broadcast sent — ${sentSummary.succeeded}/${sentSummary.recipients} succeeded in ${sentSummary.seconds}s.`
            : `⚠️ Broadcast partial — ${sentSummary.succeeded} sent, ${sentSummary.failed} failed in ${sentSummary.seconds}s. Check broadcast_recipients for errors.`}
        </div>
      )}

      {preview && Object.keys(previewCounts).length > 0 && (
        <div className="mt-3 rounded-lg border border-brand-100 bg-brand-50/50 p-3 text-sm">
          <div className="font-semibold text-brand-700">
            📬 Would send to {previewCounts.total ?? 0} recipients ({previewAudience})
          </div>
          <div className="mt-1 text-xs text-ink-soft">
            Active users: {previewCounts.active ?? 0} · Invited: {previewCounts.invited ?? 0}
            {" · "}Pending waitlist: {previewCounts.pending ?? 0}
          </div>
        </div>
      )}

      <form action={sendBroadcastAction} className="mt-4 space-y-3">
        <div>
          <label className="label">Audience</label>
          <select
            name="audience"
            className="input"
            defaultValue="active_invitees"
            form=""
          >
            <option value="active">Active users only</option>
            <option value="active_invitees">
              Active users + invitees (recommended for feature launches)
            </option>
            <option value="everyone">
              Everyone (active + invited + pending waitlist)
            </option>
          </select>
        </div>

        <div>
          <label className="label">Subject</label>
          <input
            name="subject"
            type="text"
            className="input"
            defaultValue={AI_DISCOVERED_TEMPLATE.subject}
            required
          />
        </div>

        <div>
          <label className="label">Body (HTML)</label>
          <textarea
            name="bodyHtml"
            className="input font-mono text-xs"
            rows={16}
            defaultValue={AI_DISCOVERED_TEMPLATE.body}
            required
          />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <SubmitButton
            className="btn-primary"
            pendingLabel="Sending… (may take 30-90s)"
          >
            Send broadcast
          </SubmitButton>
          <span className="text-xs text-ink-mute">
            No confirmation dialog — click sends immediately to the selected audience.
          </span>
        </div>
      </form>

      {/* Preview button lives in a SEPARATE form so it doesn't require
          subject/body — just posts audience for the count. */}
      <form action={previewBroadcastAction} className="mt-3">
        <details className="text-xs text-ink-soft">
          <summary className="cursor-pointer hover:text-ink">
            Not sure how many people this reaches? Preview recipient count →
          </summary>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <select
              name="audience"
              className="input"
              defaultValue="active_invitees"
            >
              <option value="active">Active users only</option>
              <option value="active_invitees">Active + invitees</option>
              <option value="everyone">Everyone</option>
            </select>
            <SubmitButton className="btn-soft" pendingLabel="Counting…">
              Preview count
            </SubmitButton>
          </div>
        </details>
      </form>
    </div>
  );
}

const AI_DISCOVERED_TEMPLATE = {
  subject: "New in Relaunch: AI-discovered jobs from the live web ✨",
  body: `<div style="font-family:-apple-system,Segoe UI,sans-serif;max-width:560px;margin:0 auto;color:#1C2220;line-height:1.55;">
  <h2 style="color:#1A3826;margin:0 0 12px;">Hey {{firstName}},</h2>

  <p>A few of you told us the daily match feed felt too narrow &mdash; missing the roles you were actually finding on LinkedIn or company career pages. Fair. We fixed it.</p>

  <p><strong>New feature: ✨ AI-discovered jobs.</strong></p>

  <p>Click <strong>Find matches now</strong> on your dashboard and, alongside our existing 11 job sources, Relaunch now asks OpenAI to search the live web for you &mdash; LinkedIn Jobs, Indeed, employer career pages, ATS listings &mdash; reads 30-50 sources per search, and ranks them against your profile. Each result comes with:</p>

  <ul style="padding-left:20px;">
    <li>A fit score and match reasoning</li>
    <li>Visible evidence links so you can see where we found it</li>
    <li>A direct apply URL (usually the employer's own page)</li>
  </ul>

  <p style="margin:20px 0;">
    <a href="https://www.get-relaunch.com/dashboard?utm_source=email&amp;utm_campaign=ai-discovered-launch"
       style="background:#2C5239;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:600;display:inline-block;">
      Try it now &rarr;
    </a>
  </p>

  <p style="font-size:13px;color:#58665C;">Look for the <strong style="color:#2C5239;">✨ AI-discovered</strong> chip on job cards in your dashboard.</p>

  <p style="font-size:13px;color:#58665C;margin-top:24px;">
    Have feedback? Just reply to this email &mdash; I read every one.<br/>
    &mdash; Kaushik
  </p>
</div>`,
};

/** Sentinel panel — open-alerts list + last runs + "run now" button.
 *  Sits at the very top of /admin so problems are the first thing you
 *  see when you log in. */
function SentinelPanel({
  alerts,
  recentRuns,
  justRan,
}: {
  alerts: Array<{
    id: string;
    headline: string;
    severity: number;
    root_cause: string | null;
    suggested_fix: string | null;
    first_detected: string;
    last_seen_at: string;
    occurrence_count: number;
  }>;
  recentRuns: Array<{
    id: string;
    ran_at: string;
    severity: number;
    headline: string;
    notified: boolean;
  }>;
  justRan?: string;
}) {
  const hasAlerts = alerts.length > 0;
  const lastRun = recentRuns[0] ?? null;
  const [justRanSev, justRanNotified] = (justRan ?? '').split(',');
  return (
    <div
      className={`mt-6 rounded-xl border p-5 ${
        hasAlerts
          ? "border-danger/30 bg-danger-soft"
          : "border-line bg-surface"
      }`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">
            {hasAlerts ? "🚨 " : ""}Sentinel
            <span className="ml-2 text-xs font-normal text-ink-soft">
              hourly self-diagnosis
            </span>
          </h2>
          {lastRun ? (
            <p className="mt-1 text-xs text-ink-mute">
              Last ran {fmtRelative(lastRun.ran_at)} · severity {lastRun.severity}
              {lastRun.notified ? " · notified" : ""}
              {" · "}
              <span className="text-ink-soft">{lastRun.headline}</span>
            </p>
          ) : (
            <p className="mt-1 text-xs text-ink-mute">
              No runs yet. Hourly cron fires at :05 past every hour after next deploy.
            </p>
          )}
        </div>
        <form action={runSentinelNowAction}>
          <SubmitButton className="btn-soft" pendingLabel="Triaging…">
            Run sentinel now
          </SubmitButton>
        </form>
      </div>

      {justRan && (
        <p className="mt-3 rounded-lg border border-line bg-surface p-2 text-xs">
          {justRanSev === "0"
            ? `✅ Triage complete — all clear.`
            : `Triage complete — severity ${justRanSev}${justRanNotified === "1" ? ", admin notified" : ""}. Details below.`}
        </p>
      )}

      {hasAlerts && (
        <div className="mt-4 space-y-3">
          {alerts.map((a) => (
            <div
              key={a.id}
              className="rounded-lg border border-danger/30 bg-surface p-4"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-danger/15 px-2 py-0.5 text-xs font-semibold text-danger">
                    sev {a.severity}
                  </span>
                  <span className="font-semibold">{a.headline}</span>
                </div>
                <span className="text-xs text-ink-mute">
                  {a.occurrence_count}× · first {fmtRelative(a.first_detected)}
                </span>
              </div>
              {a.root_cause && (
                <div className="mt-2 text-sm text-ink">
                  <span className="text-xs font-semibold text-ink-soft">
                    Root cause:
                  </span>{" "}
                  {a.root_cause}
                </div>
              )}
              {a.suggested_fix && (
                <div className="mt-2 rounded-md bg-brand-50 p-2 text-sm text-brand-700">
                  <span className="font-semibold">Fix:</span> {a.suggested_fix}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {!hasAlerts && recentRuns.length > 0 && (
        <details className="mt-3 text-xs text-ink-soft">
          <summary className="cursor-pointer">
            Last {recentRuns.length} sentinel runs (all clear)
          </summary>
          <table className="mt-2 w-full">
            <tbody>
              {recentRuns.map((r) => (
                <tr key={r.id} className="border-t border-line">
                  <td className="py-1 pr-2 text-ink-mute">
                    {fmtDateTime(r.ran_at)}
                  </td>
                  <td className="py-1 pr-2">sev {r.severity}</td>
                  <td className="py-1">{r.headline}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </div>
  );
}

/** Renders the "N attempted, N succeeded, N failed, N skipped" summary
 *  after a backfill run. Encoded as a compact comma-string in the URL
 *  so we don't need to round-trip through JSON. */
function BackfillBanner({ encoded }: { encoded: string }) {
  const parts = decodeURIComponent(encoded).split(",").map((n) => Number(n));
  const [attempted = 0, succeeded = 0, failed = 0, skipped = 0, seconds = 0] = parts;
  const allOk = failed === 0 && attempted > 0;
  const tone = allOk
    ? "border-success/30 bg-success-soft text-ink"
    : failed > 0
      ? "border-warn/30 bg-warn-soft text-ink"
      : "border-line bg-surface-page text-ink-soft";
  return (
    <div className={`mt-4 rounded-lg border ${tone} p-3 text-sm`}>
      <div className="font-semibold">
        {allOk
          ? `✅ Backfill complete — ${succeeded} digest${succeeded === 1 ? "" : "s"} sent in ${seconds}s.`
          : failed > 0
            ? `⚠️ Backfill finished with issues — ${succeeded}/${attempted} succeeded, ${failed} failed in ${seconds}s.`
            : `ℹ️ Nothing to do — every eligible user had already received today's digest.`}
      </div>
      <div className="mt-1 text-xs text-ink-mute">
        Attempted {attempted}, succeeded {succeeded}, failed {failed}, skipped {skipped}.
        {failed > 0 && " Check Vercel logs for per-user error details."}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-line bg-surface px-4 py-2">
      <span className="font-bold">{value}</span>{" "}
      <span className="text-ink-soft">{label}</span>
    </div>
  );
}

function StatusChip({ status }: { status: string }) {
  const tone: Record<string, string> = {
    pending: "bg-surface-page text-ink-soft",
    invited: "bg-brand-50 text-brand-700",
    joined: "bg-success-soft text-success",
  };
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-semibold capitalize ${
        tone[status] ?? "bg-surface-page text-ink-soft"
      }`}
    >
      {status}
    </span>
  );
}

function normalizeUrl(u: string): string {
  return /^https?:\/\//i.test(u) ? u : `https://${u}`;
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return Number.isFinite(d.getTime())
    ? d.toLocaleDateString(undefined, { month: "short", day: "numeric" })
    : iso;
}

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function fmtRelative(iso: string): string {
  const d = new Date(iso).getTime();
  if (!Number.isFinite(d)) return iso;
  const diff = Math.max(0, Date.now() - d);
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

/**
 * Human-friendly duration: shows two units at most.
 *   45s  → "45s"
 *   140s → "2m 20s"
 *   3900 → "1h 5m"
 *   90_000 → "25h"
 *   360_000 → "4d 4h"
 */
function fmtDuration(seconds: number): string {
  if (seconds <= 0) return "—";
  const d = Math.floor(seconds / 86_400);
  const h = Math.floor((seconds % 86_400) / 3_600);
  const m = Math.floor((seconds % 3_600) / 60);
  const s = seconds % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}
