"use client";
import { useState } from "react";
import { joinWaitlistAction } from "../actions";
import posthog from "posthog-js";

export function WaitlistForm() {
  const [done, setDone] = useState(false);
  if (done) {
    return (
      <div className="rounded-lg bg-success-soft border border-success/30 p-4 text-sm">
        ✅ You're on the list. We'll email you the moment a spot opens.
      </div>
    );
  }
  return (
    <form
      action={async (fd) => {
        const email = fd.get("email") as string;
        const firstName = fd.get("firstName") as string;
        await joinWaitlistAction(fd);
        posthog.capture("waitlist_joined", {
          email,
          first_name: firstName || undefined,
        });
        setDone(true);
      }}
      className="space-y-3"
    >
      <input
        name="email"
        type="email"
        required
        placeholder="you@email.com"
        className="input"
      />
      <input
        name="firstName"
        placeholder="First name (optional)"
        className="input"
      />
      <textarea
        name="reason"
        rows={3}
        placeholder="A line about your situation (optional). Helps us prioritise."
        className="input"
      />
      <button type="submit" className="btn-primary w-full">
        Join the waitlist
      </button>
    </form>
  );
}
