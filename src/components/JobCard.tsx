'use client';
import { useState, useTransition } from 'react';
import { ReactionButtons } from './ReactionButtons';
import { MatchBar } from './MatchBar';
import { markAppliedByUrlAction } from '@/app/(app)/all-matches/actions';
import type { SheetMatchRow } from '@/lib/providers/sheets/types';

/**
 * Client component because it owns its own "hidden" state — when the
 * user clicks 👎 we want the card to disappear instantly, well before
 * the server re-renders the dashboard. The reactionButtons API call
 * still happens in the background to persist 'hidden' to the Sheet.
 */
export function JobCard({ m }: { m: SheetMatchRow }) {
  const [hidden, setHidden] = useState(false);
  // Optimistic applied state — flip immediately, then server reconciles.
  const [applied, setApplied] = useState(!!m.applied);
  const [, startTransition] = useTransition();

  function handleMarkApplied() {
    const next = !applied;
    setApplied(next);
    startTransition(async () => {
      try {
        await markAppliedByUrlAction(m.jobUrl, m.role, m.company, !next);
      } catch {
        // Revert on error.
        setApplied(!next);
      }
    });
  }

  if (hidden) return null;

  return (
    <div className="card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-1.5">
            <h3 className="text-base font-semibold">{m.role}</h3>
            {m.watched && (
              <span
                className="chip text-[10px]"
                title="Company on your watchlist"
              >
                ⭐ Watched
              </span>
            )}
          </div>
          <p className="text-sm text-ink-soft">
            {m.company} · {m.location || 'Location unspecified'}
            {m.mode && m.mode !== 'unknown' ? ` · ${m.mode}` : ''}
          </p>
        </div>
        {m.matchPercent > 0 && <MatchBar percent={m.matchPercent} />}
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
        <button
          type="button"
          onClick={handleMarkApplied}
          className={
            applied
              ? 'inline-flex items-center rounded-full bg-success-soft px-3 py-1 text-xs font-semibold text-success hover:bg-success-soft/80'
              : 'inline-flex items-center rounded-full border border-line bg-surface px-3 py-1 text-xs font-semibold text-ink-soft hover:bg-cream-100'
          }
        >
          {applied ? '✓ Applied' : 'Mark as applied'}
        </button>
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
