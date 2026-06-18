"use client";
import { useState, useTransition } from "react";
import { markAppliedAction } from "./actions";

/**
 * Per-row Applied? toggle. Optimistic UX — the card visually marks
 * itself, then the server action runs in the background and the page
 * re-renders via revalidatePath when it returns.
 */
export function MatchAppliedButton({
  matchId,
  appliedAt,
}: {
  matchId: string;
  appliedAt: string | null;
}) {
  const [pending, startTransition] = useTransition();
  const [localApplied, setLocalApplied] = useState(!!appliedAt);

  function handleClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const willBeApplied = !localApplied;
    setLocalApplied(willBeApplied);
    startTransition(async () => {
      try {
        await markAppliedAction(matchId, !willBeApplied);
      } catch {
        // Revert on error.
        setLocalApplied(!willBeApplied);
      }
    });
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={pending}
      className={
        localApplied
          ? "inline-flex items-center rounded-full bg-success-soft px-2 py-0.5 text-xs font-semibold text-success hover:bg-success-soft/80"
          : "inline-flex items-center rounded-full border border-line bg-white px-2 py-0.5 text-xs font-semibold text-ink-soft hover:bg-cream-100"
      }
    >
      {localApplied ? "✓ Applied" : "Mark as applied"}
    </button>
  );
}
