'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { MatchBar } from './MatchBar';
import { OverflowMenu, OverflowMenuLink, OverflowMenuButton } from './OverflowMenu';
import { markAppliedByUrlAction } from '@/app/(app)/all-matches/actions';
import { SalaryCheck } from '@/app/(app)/all-matches/SalaryCheck';
import type { SheetMatchRow } from '@/lib/providers/sheets/types';

/**
 * Client component because it owns its own "hidden" state — when the
 * user picks "Hide" from the overflow menu we want the card to
 * disappear instantly, well before the server re-renders the
 * dashboard. The reaction API call still happens in the background.
 *
 * Layout (redesigned to reduce clutter):
 *   ┌──────────────────────────────────────────────────────┐
 *   │  Role  ★ Watched         89% match                   │
 *   │  Company · Location · Mode                           │
 *   │  💰 Expected CTC                                     │
 *   │  👋 Referrers                                        │
 *   │                                                      │
 *   │  [View role ↗] [Mark applied] [Salary check]    ⋯    │
 *   │                                                      │
 *   │  (Salary check card expands here when opened)        │
 *   └──────────────────────────────────────────────────────┘
 *
 * Overflow menu ⋯ contains:
 *   • Résumé PDF        (download link, if generated)
 *   • Cover letter PDF  (download link, if generated)
 *   • Editable copies   (Google Docs, if generated)
 *   • 👍 Like  /  👎 Hide
 */
export function JobCard({ m }: { m: SheetMatchRow }) {
  const router = useRouter();
  const [hidden, setHidden] = useState(false);
  // Optimistic applied state — flip immediately, then server reconciles.
  const [applied, setApplied] = useState(!!m.applied);
  const [reaction, setReaction] = useState<'' | 'liked' | 'hidden'>(m.reaction);
  const [, startTransition] = useTransition();

  function handleMarkApplied() {
    const next = !applied;
    setApplied(next);
    startTransition(async () => {
      try {
        await markAppliedByUrlAction(m.jobUrl, m.role, m.company, !next);
      } catch {
        setApplied(!next);
      }
    });
  }

  async function handleReact(next: '' | 'liked' | 'hidden') {
    const previous = reaction;
    setReaction(next);
    if (next === 'hidden') setHidden(true); // instant hide, before API
    try {
      const res = await fetch('/api/matches/react', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company: m.company, role: m.role, reaction: next }),
      });
      if (!res.ok) throw new Error('Failed');
      startTransition(() => router.refresh());
    } catch {
      setReaction(previous);
      if (next === 'hidden') setHidden(false);
    }
  }

  if (hidden) return null;

  const hasDownloads = !!(
    m.tailoredResumeUrl ||
    m.coverLetterUrl ||
    m.tailoredResumeDocUrl ||
    m.coverLetterDocUrl
  );

  return (
    <div className="card">
      {/* Header row: title + match% */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
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
            {reaction === 'liked' && (
              <span className="chip text-[10px] bg-success-soft text-success" title="You liked this">
                👍 Liked
              </span>
            )}
            {applied && (
              <span className="chip text-[10px] bg-success-soft text-success">
                ✓ Applied
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

      {/* Meta lines — CTC, referrers, outcome. */}
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

      {m.outcome && (
        <p className="mt-2">
          <span className="chip text-[10px]">{m.outcome}</span>
        </p>
      )}

      {/* Action row — 3 primary buttons, then ⋯ overflow on the right. */}
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
        <SalaryCheck
          jobTitle={m.role}
          company={m.company}
          location={m.location}
        />
        <div className="ml-auto">
          <OverflowMenu label="More actions for this role">
            {(close) => (
              <>
                {hasDownloads && (
                  <div className="border-b border-line pb-1 mb-1">
                    <p className="px-3 pt-1.5 text-[10px] uppercase tracking-wide text-ink-mute">
                      Documents
                    </p>
                    {m.tailoredResumeUrl && (
                      <OverflowMenuLink href={m.tailoredResumeUrl}>
                        📄 Tailored résumé (PDF)
                      </OverflowMenuLink>
                    )}
                    {m.coverLetterUrl && (
                      <OverflowMenuLink href={m.coverLetterUrl}>
                        ✉️ Cover letter (PDF)
                      </OverflowMenuLink>
                    )}
                    {m.tailoredResumeDocUrl && (
                      <OverflowMenuLink href={m.tailoredResumeDocUrl}>
                        ✏️ Edit résumé (Google Docs)
                      </OverflowMenuLink>
                    )}
                    {m.coverLetterDocUrl && (
                      <OverflowMenuLink href={m.coverLetterDocUrl}>
                        ✏️ Edit cover letter (Google Docs)
                      </OverflowMenuLink>
                    )}
                  </div>
                )}
                <p className="px-3 pt-1.5 text-[10px] uppercase tracking-wide text-ink-mute">
                  Feedback
                </p>
                <OverflowMenuButton
                  onClick={() => {
                    handleReact(reaction === 'liked' ? '' : 'liked');
                    close();
                  }}
                >
                  {reaction === 'liked' ? '↺ Unlike' : '👍 Like — keeps in your feed'}
                </OverflowMenuButton>
                <OverflowMenuButton
                  variant="danger"
                  onClick={() => {
                    handleReact('hidden');
                    close();
                  }}
                >
                  👎 Not a fit — hide this
                </OverflowMenuButton>
              </>
            )}
          </OverflowMenu>
        </div>
      </div>
    </div>
  );
}
