'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Spinner } from './Spinner';

interface ProviderResult {
  name: string;
  count: number;
  error?: string;
  searched?: string;
}

interface OpenAIRunStatus {
  jobsFound: number;
  cached: boolean;
  skipped: 'disabled' | 'no-key' | 'over-cap' | 'cached' | null;
  error: string | null;
  sourcesConsulted: number;
}

interface RunResponse {
  matchesFound?: number;
  emailed?: number;
  providers?: ProviderResult[];
  openai?: OpenAIRunStatus;
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
  const [openaiStatus, setOpenaiStatus] = useState<OpenAIRunStatus | null>(null);

  async function run() {
    setState('running');
    setMessage('Finding fresh matches…');
    setProviders([]);
    setOpenaiStatus(null);
    try {
      const res = await fetch('/api/run-now', { method: 'POST' });
      const data = (await res.json()) as RunResponse;
      if (!res.ok) {
        setState('error');
        setMessage(data.error ?? "Couldn't run a search just now.");
        return;
      }
      setState('success');
      const openaiSuffix =
        data.openai && data.openai.jobsFound > 0
          ? ` · +${data.openai.jobsFound} AI-discovered`
          : '';
      setMessage(
        data.emailed && data.emailed > 0
          ? `Scanned ${data.matchesFound} roles · tailored the top ${data.emailed}${openaiSuffix}`
          : `Quieter day on our side — no strong matches${openaiSuffix ? '.' + openaiSuffix : '. See breakdown below.'}`,
      );
      setProviders(data.providers ?? []);
      setOpenaiStatus(data.openai ?? null);
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
        {state === 'running' ? (
          <span className="inline-flex items-center justify-center gap-2">
            <Spinner size={14} />
            <span>Finding matches…</span>
          </span>
        ) : (
          '⚡ Find matches now'
        )}
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
          <OpenAIStatusRow status={openaiStatus} />
        </div>
      )}
    </div>
  );
}

function OpenAIStatusRow({ status }: { status: OpenAIRunStatus | null }) {
  if (!status) return null;
  const label = '✨ ai-search';
  let text: string;
  let tone: 'success' | 'warn' | 'danger' | 'muted';
  let title: string | undefined;

  if (status.error) {
    tone = 'danger';
    text = '✕ error';
    title = status.error;
  } else if (status.skipped === 'disabled') {
    tone = 'muted';
    text = 'disabled';
    title = 'OPENAI_WEB_SEARCH_ENABLED=false in Vercel';
  } else if (status.skipped === 'no-key') {
    tone = 'danger';
    text = 'no API key';
    title = 'OPENAI_API_KEY missing in Vercel env vars';
  } else if (status.skipped === 'over-cap') {
    tone = 'warn';
    text = 'daily cap hit';
    title = 'This user hit their daily OpenAI call cap. Try again tomorrow, or bump OPENAI_WEB_SEARCH_DAILY_CAP.';
  } else if (status.cached || status.skipped === 'cached') {
    tone = 'success';
    text = `${status.jobsFound} jobs (cached)`;
    title = 'Reused a cached response from the last 6 hours — no OpenAI spend';
  } else if (status.jobsFound === 0) {
    tone = 'warn';
    text = '0 jobs';
    title = 'OpenAI returned 0 jobs meeting the minimum_fit_score threshold. Try broader criteria or check /api/admin/openai-diagnostic.';
  } else {
    tone = 'success';
    text = `${status.jobsFound} jobs`;
    title = `Discovered from ${status.sourcesConsulted} sources on the live web`;
  }

  const toneClass =
    tone === 'success'
      ? 'text-success'
      : tone === 'warn'
        ? 'text-warn'
        : tone === 'danger'
          ? 'text-danger'
          : 'text-ink-mute';

  return (
    <div className="flex justify-between gap-2 border-t border-line pt-1 mt-1">
      <span className="text-ink-soft">{label}</span>
      <span className={toneClass} title={title}>
        {text}
      </span>
    </div>
  );
}
