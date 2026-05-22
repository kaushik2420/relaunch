"use client";
import { useState } from "react";
import { submitFeedbackAction } from "@/app/feedback/actions";

/**
 * Quick in-app feedback form. Rating is optional; message is required.
 * Works signed in or out — the page passes name/email when it can.
 */
export function FeedbackForm({
  defaultName = "",
  defaultEmail = "",
}: {
  defaultName?: string;
  defaultEmail?: string;
}) {
  const [done, setDone] = useState(false);
  const [rating, setRating] = useState(0);

  if (done) {
    return (
      <div className="rounded-xl border border-success/30 bg-success-soft p-5 text-sm">
        <p className="font-semibold text-ink">🌱 Thank you — really.</p>
        <p className="mt-1 text-ink-soft">
          Your feedback goes straight to the founder and genuinely shapes what
          Relaunch becomes next.
        </p>
      </div>
    );
  }

  return (
    <form
      action={async (fd) => {
        if (rating) fd.set("rating", String(rating));
        try {
          await submitFeedbackAction(fd);
        } finally {
          setDone(true);
        }
      }}
      className="space-y-4"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="fb-name">Name</label>
          <input
            id="fb-name"
            name="name"
            defaultValue={defaultName}
            className="input"
            placeholder="Optional"
            autoComplete="name"
          />
        </div>
        <div>
          <label className="label" htmlFor="fb-email">Email</label>
          <input
            id="fb-email"
            name="email"
            type="email"
            defaultValue={defaultEmail}
            className="input"
            placeholder="Optional — for a reply"
            autoComplete="email"
          />
        </div>
      </div>

      <div>
        <span className="label">How&apos;s your experience so far?</span>
        <div className="mt-1 flex gap-2">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              type="button"
              key={n}
              onClick={() => setRating(n === rating ? 0 : n)}
              aria-label={`${n} out of 5`}
              className={`h-10 w-10 rounded-lg border text-sm font-semibold transition ${
                rating >= n
                  ? "border-brand-500 bg-brand-50 text-brand-700"
                  : "border-line text-ink-mute hover:border-brand-500"
              }`}
            >
              {n}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="label" htmlFor="fb-message">Your feedback</label>
        <textarea
          id="fb-message"
          name="message"
          required
          rows={5}
          className="input"
          placeholder="What's working? What's missing? What would make Relaunch more useful for you?"
        />
      </div>

      <button type="submit" className="btn-primary w-full">
        Send feedback
      </button>
      <p className="text-center text-xs text-ink-mute">
        Goes straight to the founder. Thank you for helping shape Relaunch.
      </p>
    </form>
  );
}
