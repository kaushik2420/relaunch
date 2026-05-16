'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * On-demand button that triggers /api/run-now and reloads the dashboard
 * when matches are written. Friendly states: idle / running / success /
 * error. Empathy-first error messages.
 */
export function RunNowButton() {
  const router = useRouter();
  const [state, setState] = useState<'idle' | 'running' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState('');

  async function run() {
    setState('running');
    setMessage('Finding fresh matches…');
    try {
      const res = await fetch('/api/run-now', { method: 'POST' });
      const data = (await res.json()) as { matchesFound?: number; emailed?: number; error?: string };
      if (!res.ok) {
        setState('error');
        setMessage(data.error ?? "Couldn't run a search just now.");
        return;
      }
      setState('success');
      setMessage(
        data.emailed && data.emailed > 0
          ? `Found ${data.matchesFound} roles · emailed your top ${data.emailed} 🌅`
          : 'Quieter day on our side — no strong matches right now. Tomorrow might be bigger.',
      );
      // Refresh server data so the dashboard shows the new rows
      router.refresh();
    } catch {
      setState('error');
      setMessage('Network hiccup. Mind trying once more?');
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={run}
        disabled={state === 'running'}
        className="btn-primary w-full justify-center disabled:opacity-60"
      >
        {state === 'running' ? '⏳ Running…' : '⚡ Find matches now'}
      </button>
      {message && (
        <p
          className={`mt-2 text-xs ${
            state === 'error' ? 'text-danger' : state === 'success' ? 'text-success' : 'text-ink-soft'
          }`}
        >
          {message}
        </p>
      )}
    </div>
  );
}
