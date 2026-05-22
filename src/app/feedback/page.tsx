import Link from "next/link";
import { createSupabaseServer } from "@/lib/supabase/server";
import { Logo } from "@/components/Logo";
import { FeedbackForm } from "@/components/FeedbackForm";

export const metadata = {
  title: "Send feedback — Relaunch",
  description: "Tell us what's working and what could be better in Relaunch.",
};

export default async function FeedbackPage() {
  const sb = createSupabaseServer();
  const {
    data: { user },
  } = await sb.auth.getUser();

  let name = "";
  if (user) {
    const { data } = await sb
      .from("users")
      .select("first_name")
      .eq("id", user.id)
      .maybeSingle();
    name = (data?.first_name as string | null) ?? "";
  }

  return (
    <main className="min-h-screen bg-surface-page">
      <nav className="flex items-center justify-between border-b border-line bg-surface px-6 py-3.5">
        <Link href="/">
          <Logo />
        </Link>
        <Link
          href={user ? "/dashboard" : "/"}
          className="text-sm text-ink-soft hover:text-ink"
        >
          {user ? "Back to dashboard" : "Back to home"}
        </Link>
      </nav>

      <div className="mx-auto max-w-xl px-6 py-12">
        <h1 className="text-2xl font-bold">Tell us what you think</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Relaunch is early, and honest feedback is how it gets better. A bug, a
          rough edge, something you wish it did — it all helps, and it all
          reaches the founder directly.
        </p>
        <div className="card mt-6">
          <FeedbackForm defaultName={name} defaultEmail={user?.email ?? ""} />
        </div>
      </div>
    </main>
  );
}
