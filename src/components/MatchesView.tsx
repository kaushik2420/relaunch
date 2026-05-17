'use client';
import { useEffect, useMemo, useState } from 'react';
import { JobCard } from './JobCard';
import { JobTable } from './JobTable';
import type { SheetMatchRow } from '@/lib/providers/sheets/types';

/**
 * Wraps the matches listing in a client component so users can switch
 * between Card and Table views, filter by work mode / location /
 * match-percent, and paginate — all without a page reload.
 *
 * Parent does the "liked only" filtering + date sort server-side; this
 * component handles the rest.
 *
 * View preference persists in localStorage (key: relaunch.matches.view).
 * Filters reset on each visit (intentional — most users want a fresh
 * scan of today's batch). Page resets to 1 whenever any filter changes.
 */
const PAGE_SIZE = 20;
const VIEW_KEY = 'relaunch.matches.view';

type ViewMode = 'cards' | 'table';
type ModeFilter = 'all' | 'remote' | 'hybrid' | 'onsite';
type MatchFilter = 'all' | '90' | '75' | '60';

export function MatchesView({ matches }: { matches: SheetMatchRow[] }) {
  const [view, setView] = useState<ViewMode>('cards');
  const [modeFilter, setModeFilter] = useState<ModeFilter>('all');
  const [locationFilter, setLocationFilter] = useState<string>('all');
  const [matchFilter, setMatchFilter] = useState<MatchFilter>('all');
  const [page, setPage] = useState(1);

  // Hydrate view preference from localStorage on first render.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const saved = window.localStorage.getItem(VIEW_KEY);
    if (saved === 'cards' || saved === 'table') setView(saved);
  }, []);

  // Persist on change.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(VIEW_KEY, view);
  }, [view]);

  // Reset to page 1 whenever filters change.
  useEffect(() => {
    setPage(1);
  }, [modeFilter, locationFilter, matchFilter]);

  // Unique locations present in the result set — derived from data so we
  // don't show options that filter to zero rows.
  const locationOptions = useMemo(() => {
    const set = new Set<string>();
    for (const m of matches) {
      if (m.location && m.location.trim()) set.add(m.location.trim());
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [matches]);

  const filtered = useMemo(() => {
    return matches.filter((m) => {
      // Work mode
      if (modeFilter !== 'all') {
        const mode = (m.mode || '').toLowerCase();
        if (!mode.includes(modeFilter)) return false;
      }
      // Location (exact match against the set we derived)
      if (locationFilter !== 'all') {
        if ((m.location || '').trim() !== locationFilter) return false;
      }
      // Match-percent range
      if (matchFilter !== 'all') {
        const min = Number(matchFilter);
        if (m.matchPercent < min) return false;
      }
      return true;
    });
  }, [matches, modeFilter, locationFilter, matchFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * PAGE_SIZE;
  const slice = filtered.slice(start, start + PAGE_SIZE);

  const anyFilterActive =
    modeFilter !== 'all' || locationFilter !== 'all' || matchFilter !== 'all';

  return (
    <div>
      {/* Filter + view toggle bar */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <FilterChips
          label="Mode"
          value={modeFilter}
          onChange={(v) => setModeFilter(v as ModeFilter)}
          options={[
            { v: 'all', label: 'All' },
            { v: 'remote', label: '🌐 Remote' },
            { v: 'hybrid', label: '🏢 Hybrid' },
            { v: 'onsite', label: '🪑 On-site' },
          ]}
        />

        <FilterChips
          label="Match"
          value={matchFilter}
          onChange={(v) => setMatchFilter(v as MatchFilter)}
          options={[
            { v: 'all', label: 'Any' },
            { v: '90', label: '90%+' },
            { v: '75', label: '75%+' },
            { v: '60', label: '60%+' },
          ]}
        />

        {locationOptions.length > 1 && (
          <div className="flex items-center gap-1.5">
            <span className="text-xs uppercase tracking-wider text-ink-mute">Location</span>
            <select
              value={locationFilter}
              onChange={(e) => setLocationFilter(e.target.value)}
              className="text-xs rounded-full border border-line bg-surface px-3 py-1 hover:border-brand-500/40"
            >
              <option value="all">All</option>
              {locationOptions.map((loc) => (
                <option key={loc} value={loc}>
                  {loc}
                </option>
              ))}
            </select>
          </div>
        )}

        {anyFilterActive && (
          <button
            type="button"
            onClick={() => {
              setModeFilter('all');
              setLocationFilter('all');
              setMatchFilter('all');
            }}
            className="text-xs text-ink-soft hover:text-ink underline"
          >
            Clear filters
          </button>
        )}

        {/* View toggle pushed to the right */}
        <div className="ml-auto inline-flex items-center rounded-full border border-line bg-surface p-0.5">
          <button
            type="button"
            onClick={() => setView('cards')}
            className={`px-3 py-1 text-xs rounded-full transition ${
              view === 'cards' ? 'bg-brand-50 text-brand-700 font-semibold' : 'text-ink-soft'
            }`}
            aria-pressed={view === 'cards'}
          >
            🗂 Cards
          </button>
          <button
            type="button"
            onClick={() => setView('table')}
            className={`px-3 py-1 text-xs rounded-full transition ${
              view === 'table' ? 'bg-brand-50 text-brand-700 font-semibold' : 'text-ink-soft'
            }`}
            aria-pressed={view === 'table'}
          >
            📋 Table
          </button>
        </div>
      </div>

      {/* Listing */}
      {filtered.length === 0 ? (
        <div className="card text-center py-8">
          <p className="text-sm text-ink-soft">
            No matches fit those filters. Try widening them.
          </p>
        </div>
      ) : view === 'cards' ? (
        <div className="space-y-3">
          {slice.map((m, i) => (
            <JobCard key={`${m.company}::${m.role}::${start + i}`} m={m} />
          ))}
        </div>
      ) : (
        <JobTable matches={slice} />
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <Pagination
          page={safePage}
          totalPages={totalPages}
          visibleCount={filtered.length}
          onPrev={() => setPage((p) => Math.max(1, p - 1))}
          onNext={() => setPage((p) => Math.min(totalPages, p + 1))}
        />
      )}
    </div>
  );
}

function FilterChips<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: { v: T; label: string }[];
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-xs uppercase tracking-wider text-ink-mute">{label}</span>
      <div className="flex flex-wrap gap-1">
        {options.map((o) => (
          <button
            key={o.v}
            type="button"
            onClick={() => onChange(o.v)}
            className={`text-xs rounded-full border px-3 py-1 transition ${
              value === o.v
                ? 'border-brand-500 bg-brand-50 text-brand-700 font-semibold'
                : 'border-line bg-surface text-ink-soft hover:border-brand-500/40'
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function Pagination({
  page,
  totalPages,
  visibleCount,
  onPrev,
  onNext,
}: {
  page: number;
  totalPages: number;
  visibleCount: number;
  onPrev: () => void;
  onNext: () => void;
}) {
  const canPrev = page > 1;
  const canNext = page < totalPages;
  return (
    <div className="mt-6 flex items-center justify-between gap-2 text-sm">
      <div className="text-xs text-ink-mute">
        Page {page} of {totalPages} · {visibleCount} matches
      </div>
      <div className="flex gap-1">
        <button
          type="button"
          onClick={onPrev}
          disabled={!canPrev}
          className={`btn-soft px-3 py-1.5 text-xs ${canPrev ? '' : 'opacity-40 cursor-not-allowed'}`}
        >
          ← Prev
        </button>
        <button
          type="button"
          onClick={onNext}
          disabled={!canNext}
          className={`btn-soft px-3 py-1.5 text-xs ${canNext ? '' : 'opacity-40 cursor-not-allowed'}`}
        >
          Next →
        </button>
      </div>
    </div>
  );
}
