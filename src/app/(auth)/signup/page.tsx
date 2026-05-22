import Link from "next/link";
import { evaluateCohortCapacity } from "@/lib/services/billing";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { signUpAction } from "../actions";
import { EmpathyBanner } from "@/components/EmpathyBanner";

/**
 * Signup is invite-only. A valid `?invite=<token>` is required — the
 * public route in is the waitlist on the landing page. Without a valid
 * token we show an invite-only message instead of the form.
 */
type Invite = {
  email: string;
  first_name: string | null;
  used_at: string | null;
  expires_at: string | null;
};

export default async function SignupPage({
  searchParams,
}: {
  searchParams: { error?: string; invite?: string };
}) {
  const token = (searchParams.invite ?? "").trim();

  let invite: Invite | null = null;
  if (token) {
    const { data } = await supabaseAdmin()
      .from("invites")
      .select("email, first_name, used_at, expires_at")
      .eq("token", token)
      .maybeSingle();
    invite = (data as Invite | null) ?? null;
  }

  const inviteValid =
    !!invite &&
    !invite.used_at &&
    (!invite.expires_at || new Date(invite.expires_at) > new Date());

  // ---- No / invalid invite → invite-only screen.
  if (!inviteValid) {
    const used = !!invite?.used_at;
    return (
      <div>
        <h2 className="text-2xl font-bold">Relaunch is invite-only right now 🌱</h2>
        <p className="mt-2 text-sm text-ink-soft">
          {used
            ? "This invite link has already been used. If that was you, just sign in below."
            : "We're opening seats in small batches so we can give every person real attention. Request early access and we'll email your personal invite link soon."}
        </p>
        <Link href="/#join" className="btn-primary mt-6 inline-flex">
          Request early access →
        </Link>
        <p className="mt-5 text-sm text-ink-soft">
          Already have an account?{" "}
          <Link href="/login" className="font-medium text-brand-700 hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    );
  }

  // ---- Valid invite → signup form, email locked to the invite.
  const capacity = await evaluateCohortCapacity();
  const cohortCopy =
    capacity.state === "waitlist"
      ? "Your free trial begins the moment you finish setting up."
      : capacity.cohort === "founder"
        ? `You'll be one of our first ${capacity.trialDays}-day-free founders.`
        : `Your first ${capacity.trialDays} days are free. ₹399/month after that.`;

  return (
    <div>
      <h2 className="text-2xl font-bold">Welcome in — let&apos;s set you up</h2>
      <p className="mt-1 text-sm text-ink-soft">
        Your early-access invite is confirmed. {cohortCopy}
      </p>

      <div className="mt-5">
        <EmpathyBanner icon="🌱" title="You were reviewed and chosen by a human.">
          No crowd, no noise — just a calm space to find your next role.
        </EmpathyBanner>
      </div>

      <form action={signUpAction} className="mt-6 space-y-4">
        <input type="hidden" name="invite" value={token} />
        <div>
          <label className="label" htmlFor="firstName">First name</label>
          <input
            id="firstName"
            name="firstName"
            required
            defaultValue={invite!.first_name ?? ""}
            className="input"
            autoComplete="given-name"
          />
        </div>
        <div>
          <label className="label" htmlFor="email">Email</label>
          <input
            id="email"
            name="email"
            type="email"
            required
            readOnly
            defaultValue={invite!.email}
            className="input cursor-not-allowed bg-surface-page text-ink-soft"
          />
          <p className="mt-1 text-xs text-ink-mute">
            Your invite is tied to this email address.
          </p>
        </div>
        <div>
          <label className="label" htmlFor="password">Create password</label>
          <input
            id="password"
            name="password"
            type="password"
            minLength={8}
            required
            className="input"
            autoComplete="new-password"
          />
          <p className="mt-1 text-xs text-ink-mute">At least 8 characters.</p>
        </div>

        {/* Voluntary layoff declaration */}
        <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-line bg-surface-page p-3 text-sm">
          <input
            type="checkbox"
            name="affectedByLayoff"
            value="true"
            className="mt-0.5 h-4 w-4 accent-brand-500"
          />
          <span>
            <strong className="block">
              I&apos;m currently affected by a layoff and looking for my next role.
            </strong>
            <span className="mt-0.5 block text-ink-soft">
              Voluntary — won&apos;t affect your access. Never shared, never sold.
            </span>
          </span>
        </label>

        {searchParams.error && (
          <p className="text-sm text-danger">
            {decodeURIComponent(searchParams.error)}
          </p>
        )}

        <button type="submit" className="btn-primary w-full">
          Create account
        </button>

        <p className="text-xs text-ink-mute">
          By signing up you agree to our{" "}
          <Link href="/legal/terms" className="underline">Terms</Link> &amp;{" "}
          <Link href="/legal/privacy" className="underline">Privacy</Link>. We
          never sell your data.
        </p>
      </form>

      <p className="mt-4 text-center text-sm text-ink-soft">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-brand-700 hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
