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
type SortKey = 'best' | 'newest';

export function MatchesView({ matches }: { matches: SheetMatchRow[] }) {
  const [view, setView] = useState<ViewMode>('cards');
  const [modeFilter, setModeFilter] = useState<ModeFilter>('all');
  const [locationFilter, setLocationFilter] = useState<string>('all');
  const [matchFilter, setMatchFilter] = useState<MatchFilter>('all');
  const [sortBy, setSortBy] = useState<SortKey>('best');
  const [page, setPage] = useState(1);
  // New filters: hide applied by default, and source = all|watchlist
  const [hideApplied, setHideApplied] = useState(true);
  const [source, setSource] = useState<'all' | 'watchlist'>('all');

  // Watchlist-aware: does the data even contain any watched companies?
  // If not, the source filter is meaningless — hide it.
  const hasAnyWatched = useMemo(
    () => matches.some((m) => m.watched === true),
    [matches],
  );
  const appliedCount = useMemo(
    () => matches.filter((m) => m.applied).length,
    [matches],
  );

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

  // Reset to page 1 whenever filters or sort change.
  useEffect(() => {
    setPage(1);
  }, [modeFilter, locationFilter, matchFilter, sortBy, hideApplied, source]);

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
      // Hide applied (default ON — user can toggle off to see them)
      if (hideApplied && m.applied) return false;
      // Source filter — watchlist only?
      if (source === 'watchlist' && !m.watched) return false;
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
  }, [matches, modeFilter, locationFilter, matchFilter, hideApplied, source]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    if (sortBy === 'newest') {
      arr.sort((a, b) => {
        const da = new Date(a.date).getTime();
        const db = new Date(b.date).getTime();
        return (Number.isFinite(db) ? db : 0) - (Number.isFinite(da) ? da : 0);
      });
    } else {
      arr.sort((a, b) => b.matchPercent - a.matchPercent);
    }
    return arr;
  }, [filtered, sortBy]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * PAGE_SIZE;
  const slice = sorted.slice(start, start + PAGE_SIZE);

  const anyFilterActive =
    modeFilter !== 'all' || locationFilter !== 'all' || matchFilter !== 'all';

  return (
    <div>
      {/* Filter + view toggle bar */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {/* Hide applied — default ON, only shown if there's anything
            applied to hide. */}
        {appliedCount > 0 && (
          <button
            type="button"
            onClick={() => setHideApplied((v) => !v)}
            className={`text-xs rounded-full border px-3 py-1 transition ${
              hideApplied
                ? 'border-brand-500 bg-brand-50 text-brand-700 font-semibold'
                : 'border-line bg-surface text-ink-soft hover:border-brand-500/40'
            }`}
            aria-pressed={hideApplied}
          >
            {hideApplied
              ? `🙈 Hiding ${appliedCount} applied`
              : `👀 Showing applied (${appliedCount})`}
          </button>
        )}

        {/* Source = all | watchlist — only if user has any watched
            matches in the current list. */}
        {hasAnyWatched && (
          <FilterChips
            label="Source"
            value={source}
            onChange={(v) => setSource(v as 'all' | 'watchlist')}
            options={[
              { v: 'all', label: 'All sources' },
              { v: 'watchlist', label: '⭐ Watchlist only' },
            ]}
          />
        )}

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

        <FilterChips
          label="Sort"
          value={sortBy}
          onChange={(v) => setSortBy(v as SortKey)}
          options={[
            { v: 'best', label: '🏆 Best match' },
            { v: 'newest', label: '🕒 Newest' },
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
      {sorted.length === 0 ? (
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
          visibleCount={sorted.length}
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
