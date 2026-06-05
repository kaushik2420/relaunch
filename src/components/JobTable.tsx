'use client';
import { useState } from 'react';
import { ReactionButtons } from './ReactionButtons';
import { MatchBar } from './MatchBar';
import type { SheetMatchRow } from '@/lib/providers/sheets/types';

/**
 * Compact tabular view of matches — for users who'd rather scan rows
 * than read cards. Same data, denser layout. Owns per-row "hidden"
 * state so 👎 removes the row instantly (mirrors JobCard).
 */
export function JobTable({ matches }: { matches: SheetMatchRow[] }) {
  return (
    <div className="card overflow-x-auto p-0">
      <table className="w-full text-sm">
        <thead className="bg-surface-muted text-left">
          <tr className="text-xs uppercase tracking-wider text-ink-soft">
            <th className="px-3 py-2 font-semibold">Role</th>
            <th className="px-3 py-2 font-semibold">Company</th>
            <th className="px-3 py-2 font-semibold">Match</th>
            <th className="px-3 py-2 font-semibold">Location</th>
            <th className="px-3 py-2 font-semibold">Mode</th>
            <th className="px-3 py-2 font-semibold">CTC</th>
            <th className="px-3 py-2 font-semibold">Date</th>
            <th className="px-3 py-2 font-semibold text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {matches.map((m, i) => (
            <JobRow key={`${m.company}::${m.role}::${i}`} m={m} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function JobRow({ m }: { m: SheetMatchRow }) {
  const [hidden, setHidden] = useState(false);
  if (hidden) return null;

  return (
    <tr className="border-t border-line hover:bg-surface-muted/50">
      <td className="px-3 py-2.5 font-medium">
        {m.jobUrl ? (
          <a href={m.jobUrl} target="_blank" rel="noreferrer" className="hover:underline">
            {m.role}
          </a>
        ) : (
          m.role
        )}
        {m.applied && <span className="ml-2 chip-accent text-[10px]">Applied</span>}
      </td>
      <td className="px-3 py-2.5 text-ink-soft">{m.company}</td>
      <td className="px-3 py-2.5">
        {m.matchPercent > 0 ? (
          <MatchBar percent={m.matchPercent} />
        ) : (
          <span className="text-ink-mute text-xs">—</span>
        )}
      </td>
      <td className="px-3 py-2.5 text-ink-soft text-xs">{m.location || '—'}</td>
      <td className="px-3 py-2.5 text-ink-soft text-xs capitalize">
        {m.mode && m.mode !== 'unknown' ? m.mode : '—'}
      </td>
      <td className="px-3 py-2.5 text-ink-soft text-xs">{m.expectedCtc || '—'}</td>
      <td className="px-3 py-2.5 text-ink-mute text-xs whitespace-nowrap">{formatDate(m.date)}</td>
      <td className="px-3 py-2.5">
        <div className="flex items-center justify-end gap-2">
          {m.tailoredResumeUrl && (
            <a
              href={m.tailoredResumeUrl}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-brand-700 hover:underline whitespace-nowrap"
              title="Résumé (PDF)"
            >
              📄
            </a>
          )}
          {m.coverLetterUrl && (
            <a
              href={m.coverLetterUrl}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-brand-700 hover:underline whitespace-nowrap"
              title="Cover letter (PDF)"
            >
              ✉️
            </a>
          )}
          <ReactionButtons
            company={m.company}
            role={m.role}
            initial={m.reaction}
            onHide={() => setHidden(true)}
          />
        </div>
      </td>
    </tr>
  );
}

function formatDate(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
