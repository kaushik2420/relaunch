'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Thumbs up / thumbs down for a job card.
 * - Thumbs up → saved, dashboard's "Liked only" filter will show it
 * - Thumbs down → hidden from the dashboard going forward
 * - Click again to undo (cycles back to "")
 *
 * Optimistic UI: toggles instantly, then sync to /api/matches/react.
 * On failure, we revert the local state and show a brief error.
 */
export function ReactionButtons({
  company,
  role,
  initial,
}: {
  company: string;
  role: string;
  initial: '' | 'liked' | 'hidden';
}) {
  const router = useRouter();
  const [reaction, setReaction] = useState<'' | 'liked' | 'hidden'>(initial);
  const [, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  async function update(next: '' | 'liked' | 'hidden') {
    const previous = reaction;
    setReaction(next); // optimistic
    setError(null);
    try {
      const res = await fetch('/api/matches/react', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company, role, reaction: next }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed');
      // Refresh server data so a 👎 actually hides from the list
      startTransition(() => router.refresh());
    } catch (e) {
      setReaction(previous); // revert
      setError((e as Error).message);
      setTimeout(() => setError(null), 3000);
    }
  }

  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={() => update(reaction === 'liked' ? '' : 'liked')}
        aria-label="Like this job"
        title="Like — keeps it in your 'Liked' filter"
        className={`rounded px-2 py-1 text-sm transition ${
          reaction === 'liked'
            ? 'bg-success-soft text-success'
            : 'text-ink-mute hover:bg-surface-muted hover:text-ink'
        }`}
      >
        👍
      </button>
      <button
        type="button"
        onClick={() => update(reaction === 'hidden' ? '' : 'hidden')}
        aria-label="Hide this job"
        title="Hide — removes it from your list"
        className={`rounded px-2 py-1 text-sm transition ${
          reaction === 'hidden'
            ? 'bg-danger-soft text-danger'
            : 'text-ink-mute hover:bg-surface-muted hover:text-ink'
        }`}
      >
        👎
      </button>
      {error && <span className="ml-2 text-xs text-danger">{error}</span>}
    </div>
  );
}
