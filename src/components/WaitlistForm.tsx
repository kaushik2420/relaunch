"use client";
import { useState } from "react";
import { joinWaitlistAction } from "@/app/(auth)/actions";
import { SubmitButton } from "@/components/SubmitButton";
import posthog from "posthog-js";

/**
 * Early-access request form on the public landing page.
 * Collects the essentials we need to review someone (name, email,
 * LinkedIn) — the actual signup happens later, via an invite link.
 */
export function WaitlistForm() {
  const [done, setDone] = useState(false);

  if (done) {
    return (
      <div className="rounded-xl border border-success/30 bg-success-soft p-5 text-sm">
        <p className="font-semibold text-ink">🌱 You're on the list.</p>
        <p className="mt-1 text-ink-soft">
          We review every request personally. If it's a fit, a private invite
          link will land in your inbox over the next few days — keep an eye out.
        </p>
      </div>
    );
  }

  return (
    <form
      action={async (fd) => {
        try {
          await joinWaitlistAction(fd);
          posthog.capture("waitlist_joined", {
            email: (fd.get("email") as string) || undefined,
          });
        } finally {
          setDone(true);
        }
      }}
      className="space-y-3"
    >
      <div>
        <label className="label" htmlFor="wl-first">First name</label>
        <input
          id="wl-first"
          name="firstName"
          required
          className="input"
          autoComplete="given-name"
          placeholder="Priya"
        />
      </div>
      <div>
        <label className="label" htmlFor="wl-email">Email</label>
        <input
          id="wl-email"
          name="email"
          type="email"
          required
          className="input"
          autoComplete="email"
          placeholder="you@email.com"
        />
      </div>
      <div>
        <label className="label" htmlFor="wl-linkedin">LinkedIn profile</label>
        <input
          id="wl-linkedin"
          name="linkedin"
          type="text"
          required
          className="input"
          placeholder="linkedin.com/in/your-handle"
        />
        <p className="mt-1 text-xs text-ink-mute">
          So we can review your background before sending an invite.
        </p>
      </div>
      <SubmitButton className="btn-primary w-full" pendingLabel="Sending your request…">
        Request early access
      </SubmitButton>
      <p className="text-center text-xs text-ink-mute">
        No spam, ever. We only email you if there's a seat.
      </p>
    </form>
  );
}
