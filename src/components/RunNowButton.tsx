'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface ProviderResult {
  name: string;
  count: number;
  error?: string;
  searched?: string;
}

interface RunResponse {
  matchesFound?: number;
  emailed?: number;
  providers?: ProviderResult[];
  error?: string;
}

/**
 * On-demand button that triggers /api/run-now.
 * After running, shows a per-provider breakdown so you can spot which
 * job sources are silent (env var missing, API rate-limited, etc.)
 * without digging through Vercel logs.
 */
export function RunNowButton() {
  const router = useRouter();
  const [state, setState] = useState<'idle' | 'running' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const [providers, setProviders] = useState<ProviderResult[]>([]);

  async function run() {
    setState('running');
    setMessage('Finding fresh matches…');
    setProviders([]);
    try {
      const res = await fetch('/api/run-now', { method: 'POST' });
      const data = (await res.json()) as RunResponse;
      if (!res.ok) {
        setState('error');
        setMessage(data.error ?? "Couldn't run a search just now.");
        return;
      }
      setState('success');
      setMessage(
        data.emailed && data.emailed > 0
          ? `Found ${data.matchesFound} roles · emailed your top ${data.emailed} 🌅`
          : 'Quieter day on our side — no strong matches. See breakdown below.',
      );
      setProviders(data.providers ?? []);
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

      {/* Per-provider diagnostic breakdown */}
      {providers.length > 0 && (
        <div className="mt-3 rounded-lg bg-surface-page p-2 text-[11px] space-y-1">
          <div className="text-ink-mute uppercase tracking-wider mb-1">Sources</div>
          {providers[0]?.searched && (
            <div className="text-ink-soft mb-2 italic">Searched: {providers[0].searched}</div>
          )}
          {providers.map((p) => (
            <div key={p.name} className="flex justify-between gap-2">
              <span className="text-ink-soft">{p.name}</span>
              <span
                className={
                  p.error
                    ? 'text-danger'
                    : p.count === 0
                    ? 'text-warn'
                    : 'text-success'
                }
                title={p.error ?? ''}
              >
                {p.error ? '✕ error' : `${p.count} jobs`}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
