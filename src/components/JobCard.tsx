'use client';
import { useState } from 'react';
import { ReactionButtons } from './ReactionButtons';
import type { SheetMatchRow } from '@/lib/providers/sheets/types';

/**
 * Client component because it owns its own "hidden" state — when the
 * user clicks 👎 we want the card to disappear instantly, well before
 * the server re-renders the dashboard. The reactionButtons API call
 * still happens in the background to persist 'hidden' to the Sheet.
 */
export function JobCard({ m }: { m: SheetMatchRow }) {
  const [hidden, setHidden] = useState(false);
  if (hidden) return null;

  const matchTone =
    m.matchPercent >= 90
      ? 'bg-success-soft text-success'
      : m.matchPercent >= 75
      ? 'bg-brand-50 text-brand-700'
      : 'bg-accent-50 text-accent-600';

  return (
    <div className="card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold">{m.role}</h3>
          <p className="text-sm text-ink-soft">
            {m.company} · {m.location || 'Location unspecified'}
            {m.mode && m.mode !== 'unknown' ? ` · ${m.mode}` : ''}
          </p>
        </div>
        {m.matchPercent > 0 && (
          <span className={`px-3 py-1 rounded-full text-xs font-bold ${matchTone}`}>
            {m.matchPercent}% match
          </span>
        )}
      </div>

      {m.expectedCtc && (
        <p className="mt-2 text-xs text-ink-soft">💰 {m.expectedCtc}</p>
      )}

      {m.referrers && /^https?:\/\//.test(m.referrers) ? (
        <a
          href={m.referrers}
          target="_blank"
          rel="noreferrer"
          className="mt-2 inline-flex items-center gap-1 text-xs text-brand-700 hover:underline"
        >
          👋 Find your 2nd-degree connections at {m.company} →
        </a>
      ) : m.referrers ? (
        <p className="mt-2 text-xs">
          👋 <span className="text-ink-soft">Could help: </span>
          <span className="font-medium">{m.referrers}</span>
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {m.jobUrl && (
          <a
            href={m.jobUrl}
            target="_blank"
            rel="noreferrer"
            className="btn-primary text-xs px-3 py-1.5"
          >
            View role ↗
          </a>
        )}
        {m.tailoredResumeUrl && (
          <a
            href={m.tailoredResumeUrl}
            target="_blank"
            rel="noreferrer"
            className="btn-soft text-xs px-3 py-1.5"
          >
            📄 Résumé
          </a>
        )}
        {m.coverLetterUrl && (
          <a
            href={m.coverLetterUrl}
            target="_blank"
            rel="noreferrer"
            className="btn-soft text-xs px-3 py-1.5"
          >
            ✉️ Cover letter
          </a>
        )}
        {m.applied && <span className="chip-accent">Applied</span>}
        {m.outcome && <span className="chip">{m.outcome}</span>}
        <div className="ml-auto">
          <ReactionButtons
            company={m.company}
            role={m.role}
            initial={m.reaction}
            onHide={() => setHidden(true)}
          />
        </div>
      </div>

      {(m.tailoredResumeDocUrl || m.coverLetterDocUrl) && (
        <p className="mt-2 text-xs text-ink-soft">
          Editable copies:{' '}
          {m.tailoredResumeDocUrl && (
            <a
              href={m.tailoredResumeDocUrl}
              target="_blank"
              rel="noreferrer"
              className="text-brand-700 hover:underline"
            >
              résumé
            </a>
          )}
          {m.tailoredResumeDocUrl && m.coverLetterDocUrl && ' · '}
          {m.coverLetterDocUrl && (
            <a
              href={m.coverLetterDocUrl}
              target="_blank"
              rel="noreferrer"
              className="text-brand-700 hover:underline"
            >
              cover letter
            </a>
          )}
        </p>
      )}
    </div>
  );
}
