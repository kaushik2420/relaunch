import { redirect } from "next/navigation";
import { createSupabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { serverConfig } from "@/lib/config";
import { Logo } from "@/components/Logo";
import { approveAndInviteAction } from "./actions";
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
  searchParams: { error?: string; invited?: string };
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

  const usage = {
    activeUsers: activeUsers ?? 0,
    runs: runRows.length,
    tailoredMatches,
    emails,
    newUsers: newUsers ?? 0,
  };
  const cost = estimateMonthlyCost(usage);

  return (
    <main className="min-h-screen bg-surface-page">
      <nav className="flex items-center justify-between border-b border-line bg-surface px-6 py-3.5">
        <Logo />
        <span className="text-sm text-ink-soft">Admin</span>
      </nav>

      <div className="mx-auto max-w-5xl px-6 py-10">
        <h1 className="text-2xl font-bold">Relaunch admin</h1>

        <CostPanel cost={cost} usage={usage} />

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
