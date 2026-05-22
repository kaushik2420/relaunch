import { redirect } from "next/navigation";
import { createSupabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { serverConfig } from "@/lib/config";
import { Logo } from "@/components/Logo";
import { approveAndInviteAction } from "./actions";

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

  const count = (s: string) => rows.filter((r) => r.status === s).length;

  return (
    <main className="min-h-screen bg-surface-page">
      <nav className="flex items-center justify-between border-b border-line bg-surface px-6 py-3.5">
        <Logo />
        <span className="text-sm text-ink-soft">Admin · Waitlist</span>
      </nav>

      <div className="mx-auto max-w-5xl px-6 py-10">
        <h1 className="text-2xl font-bold">Early-access waitlist</h1>
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
                        <button
                          className={
                            r.status === "invited"
                              ? "btn-ghost text-xs"
                              : "btn-primary text-xs"
                          }
                        >
                          {r.status === "invited"
                            ? "Resend invite"
                            : "Approve & send invite"}
                        </button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </main>
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
