import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServer } from "@/lib/supabase/server";
import { signOutAction } from "../(auth)/actions";
import { Logo } from "@/components/Logo";
import { evaluateTrial } from "@/lib/services/billing";
import { PostHogIdentifier } from "@/components/PostHogIdentifier";

/**
 * Authenticated app shell. Gates all (app)/* routes behind auth.
 * Also handles the trial-expired redirect.
 */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const sb = createSupabaseServer();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) redirect("/login");

  const { data: row } = await sb
    .from("users")
    .select("first_name, free_until, is_paying, is_active")
    .eq("id", user.id)
    .single();

  if (!row) redirect("/login");
  if (!row.is_active) {
    return (
      <div className="min-h-screen grid place-items-center p-10 text-center">
        <div>
          <h1 className="text-2xl font-bold">Your account is paused</h1>
          <p className="mt-2 text-ink-soft">
            Reach out to hello@relaunch.app if this is unexpected.
          </p>
        </div>
      </div>
    );
  }

  const trial = evaluateTrial({
    is_paying: row.is_paying ?? false,
    free_until: row.free_until as string,
  });

  return (
    <div className="min-h-screen flex flex-col">
      <nav className="flex items-center justify-between border-b border-line bg-surface px-7 py-3.5">
        <Link href="/dashboard">
          <Logo />
        </Link>
        <div className="flex items-center gap-3 text-sm text-ink-soft">
          {trial.status === "trial-active" && (
            <span className="hidden md:inline">
              Free for {trial.daysLeft} more{" "}
              {trial.daysLeft === 1 ? "day" : "days"}
            </span>
          )}
          {trial.status === "trial-expiring" && (
            <Link href="/billing" className="chip-accent">
              Trial ends in {trial.daysLeft} d → upgrade
            </Link>
          )}
          {trial.status === "trial-expired" && (
            <Link href="/billing" className="chip-accent">
              Upgrade to continue
            </Link>
          )}
          <Link href="/dashboard" className="hover:text-ink">
            Dashboard
          </Link>
          <Link href="/upskill" className="hover:text-ink">
            Upskill
          </Link>
          <Link href="/settings" className="hover:text-ink">
            Settings
          </Link>
          <form action={signOutAction}>
            <button className="btn-ghost text-xs">Sign out</button>
          </form>
        </div>
      </nav>
      <PostHogIdentifier userId={user.id} email={user.email!} />
      <main className="flex-1 bg-surface-page">{children}</main>
    </div>
  );
}
