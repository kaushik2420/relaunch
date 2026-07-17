'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { JobCard } from './JobCard';
import { JobTable } from './JobTable';
import type { SheetMatchRow } from '@/lib/providers/sheets/types';

/**
 * Wraps the matches listing in a client component so users can filter,
 * sort, switch between Card and Table views, and paginate — all
 * without a page reload.
 *
 * Filter model (as of the redesign):
 *   • Everything collapses under a single Filter icon-button.
 *   • Sub-sections: Source, Mode, Match, Location, Include applied.
 *   • Multi-select WITHIN a section combines with OR (pick "Remote"
 *     and "Hybrid" → show both).
 *   • Cross-section combines with AND (Remote OR Hybrid AND Watchlist
 *     AND 75%+).
 *   • "Match" is a threshold, so it stays single-select.
 *   • Sort lives in a separate icon-button; single-select.
 *
 * View preference (cards vs table) persists in localStorage. Filters
 * reset on each visit — daily job search is meant to feel fresh.
 */
const PAGE_SIZE = 20;
const VIEW_KEY = 'relaunch.matches.view';

type ViewMode = 'cards' | 'table';
type ModeOption = 'remote' | 'hybrid' | 'onsite';
type SortKey = 'best' | 'newest';

export function MatchesView({ matches }: { matches: SheetMatchRow[] }) {
  const [view, setView] = useState<ViewMode>('cards');

  // Multi-select filter state. Empty set = "no filter" (show all).
  const [modeSet, setModeSet] = useState<Set<ModeOption>>(new Set());
  const [sourceWatchlist, setSourceWatchlist] = useState(false);
  const [locationSet, setLocationSet] = useState<Set<string>>(new Set());
  const [providerSet, setProviderSet] = useState<Set<string>>(new Set());
  // Match is a *threshold* not a set — you'd never say "roles between
  // 75-89%". 0 means no floor.
  const [matchThreshold, setMatchThreshold] = useState<0 | 60 | 75 | 90>(0);
  const [hideApplied, setHideApplied] = useState(true);

  const [sortBy, setSortBy] = useState<SortKey>('best');
  const [page, setPage] = useState(1);

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
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(VIEW_KEY, view);
  }, [view]);

  // Reset to page 1 whenever any filter changes.
  useEffect(() => {
    setPage(1);
  }, [modeSet, sourceWatchlist, locationSet, providerSet, matchThreshold, hideApplied, sortBy]);

  const locationOptions = useMemo(() => {
    const set = new Set<string>();
    for (const m of matches) {
      if (m.location && m.location.trim()) set.add(m.location.trim());
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [matches]);

  // Providers that actually surfaced matches in the current list —
  // pointless to show a `coresignal` filter option if the user has
  // zero coresignal-sourced rows. Sorted by count desc so the biggest
  // contributor floats to the top.
  const providerOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const m of matches) {
      const src = (m.source ?? '').trim().toLowerCase();
      if (!src) continue;
      counts.set(src, (counts.get(src) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name, count }));
  }, [matches]);

  const filtered = useMemo(() => {
    return matches.filter((m) => {
      if (hideApplied && m.applied) return false;
      if (sourceWatchlist && !m.watched) return false;

      // Mode: OR within category — empty set = pass.
      if (modeSet.size > 0) {
        const mode = (m.mode || '').toLowerCase();
        const matched = Array.from(modeSet).some((k) => mode.includes(k));
        if (!matched) return false;
      }

      // Location: OR within category — empty set = pass.
      if (locationSet.size > 0) {
        const loc = (m.location || '').trim();
        if (!locationSet.has(loc)) return false;
      }

      // Provider: OR within category — empty set = pass. Rows with
      // empty source (pre-source-column history) always pass so we
      // don't accidentally hide legitimate matches.
      if (providerSet.size > 0) {
        const src = (m.source ?? '').trim().toLowerCase();
        if (src && !providerSet.has(src)) return false;
      }

      // Match threshold.
      if (matchThreshold > 0 && m.matchPercent < matchThreshold) return false;
      return true;
    });
  }, [matches, modeSet, sourceWatchlist, locationSet, providerSet, matchThreshold, hideApplied]);

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

  // Count of active filters — drives the badge on the Filter icon.
  const activeCount =
    modeSet.size +
    locationSet.size +
    providerSet.size +
    (sourceWatchlist ? 1 : 0) +
    (matchThreshold > 0 ? 1 : 0) +
    (!hideApplied && appliedCount > 0 ? 1 : 0);

  function resetFilters() {
    setModeSet(new Set());
    setSourceWatchlist(false);
    setLocationSet(new Set());
    setProviderSet(new Set());
    setMatchThreshold(0);
    setHideApplied(true);
  }

  return (
    <div>
      {/* Filter + Sort + View toggle bar */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <FilterMenu
          activeCount={activeCount}
          onReset={resetFilters}
          hasAnyWatched={hasAnyWatched}
          appliedCount={appliedCount}
          sourceWatchlist={sourceWatchlist}
          onSourceChange={setSourceWatchlist}
          modeSet={modeSet}
          onModeToggle={(v) => {
            const next = new Set(modeSet);
            if (next.has(v)) next.delete(v);
            else next.add(v);
            setModeSet(next);
          }}
          matchThreshold={matchThreshold}
          onMatchChange={setMatchThreshold}
          locationOptions={locationOptions}
          locationSet={locationSet}
          onLocationToggle={(v) => {
            const next = new Set(locationSet);
            if (next.has(v)) next.delete(v);
            else next.add(v);
            setLocationSet(next);
          }}
          providerOptions={providerOptions}
          providerSet={providerSet}
          onProviderToggle={(v) => {
            const next = new Set(providerSet);
            if (next.has(v)) next.delete(v);
            else next.add(v);
            setProviderSet(next);
          }}
          hideApplied={hideApplied}
          onHideAppliedChange={setHideApplied}
        />

        <SortMenu value={sortBy} onChange={setSortBy} />

        {/* Active filter summary — a quick read of what's on. */}
        {activeCount > 0 && (
          <ActiveFilterSummary
            modeSet={modeSet}
            sourceWatchlist={sourceWatchlist}
            locationSet={locationSet}
            providerSet={providerSet}
            matchThreshold={matchThreshold}
            hideApplied={hideApplied}
            appliedCount={appliedCount}
            onClear={resetFilters}
          />
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

/* -------------------------- Filter icon-button ------------------------ */

function FilterMenu({
  activeCount,
  onReset,
  hasAnyWatched,
  appliedCount,
  sourceWatchlist,
  onSourceChange,
  modeSet,
  onModeToggle,
  matchThreshold,
  onMatchChange,
  locationOptions,
  locationSet,
  onLocationToggle,
  providerOptions,
  providerSet,
  onProviderToggle,
  hideApplied,
  onHideAppliedChange,
}: {
  activeCount: number;
  onReset: () => void;
  hasAnyWatched: boolean;
  appliedCount: number;
  sourceWatchlist: boolean;
  onSourceChange: (v: boolean) => void;
  modeSet: Set<ModeOption>;
  onModeToggle: (v: ModeOption) => void;
  matchThreshold: 0 | 60 | 75 | 90;
  onMatchChange: (v: 0 | 60 | 75 | 90) => void;
  locationOptions: string[];
  locationSet: Set<string>;
  onLocationToggle: (v: string) => void;
  providerOptions: Array<{ name: string; count: number }>;
  providerSet: Set<string>;
  onProviderToggle: (v: string) => void;
  hideApplied: boolean;
  onHideAppliedChange: (v: boolean) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onEsc);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition ${
          activeCount > 0 || open
            ? 'border-brand-500 bg-brand-50 text-brand-700'
            : 'border-line bg-surface text-ink-soft hover:border-brand-500/40'
        }`}
      >
        <FilterIcon />
        Filter
        {activeCount > 0 && (
          <span className="inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-brand-500 px-1 text-[10px] font-bold text-white">
            {activeCount}
          </span>
        )}
      </button>
      {open && (
        <div
          role="menu"
          className="absolute left-0 z-20 mt-1 w-[320px] rounded-lg border border-line bg-white p-3 shadow-lg"
        >
          <div className="flex items-center justify-between border-b border-line pb-2">
            <p className="text-xs font-semibold text-ink">Filters</p>
            {activeCount > 0 && (
              <button
                type="button"
                onClick={onReset}
                className="text-[11px] text-brand-700 hover:underline"
              >
                Reset all
              </button>
            )}
          </div>

          {hasAnyWatched && (
            <FilterSection label="Source">
              <CheckboxRow
                checked={sourceWatchlist}
                onChange={(v) => onSourceChange(v)}
              >
                ⭐ Watchlist only
              </CheckboxRow>
            </FilterSection>
          )}

          <FilterSection label="Work mode">
            {(
              [
                ['remote', '🌐 Remote'],
                ['hybrid', '🏢 Hybrid'],
                ['onsite', '🪑 On-site'],
              ] as [ModeOption, string][]
            ).map(([v, label]) => (
              <CheckboxRow
                key={v}
                checked={modeSet.has(v)}
                onChange={() => onModeToggle(v)}
              >
                {label}
              </CheckboxRow>
            ))}
          </FilterSection>

          <FilterSection label="Match strength">
            {(
              [
                [0, 'Any match'],
                [90, '90%+ only'],
                [75, '75%+'],
                [60, '60%+'],
              ] as [0 | 60 | 75 | 90, string][]
            ).map(([v, label]) => (
              <RadioRow
                key={v}
                checked={matchThreshold === v}
                onChange={() => onMatchChange(v)}
              >
                {label}
              </RadioRow>
            ))}
          </FilterSection>

          {locationOptions.length > 1 && (
            <FilterSection label={`Location (${locationSet.size || 'all'})`}>
              <div className="max-h-40 overflow-y-auto pr-1">
                {locationOptions.map((loc) => (
                  <CheckboxRow
                    key={loc}
                    checked={locationSet.has(loc)}
                    onChange={() => onLocationToggle(loc)}
                  >
                    {loc}
                  </CheckboxRow>
                ))}
              </div>
            </FilterSection>
          )}

          {providerOptions.length > 1 && (
            <FilterSection
              label={`Source provider (${providerSet.size || 'all'})`}
            >
              <div className="max-h-40 overflow-y-auto pr-1">
                {providerOptions.map((p) => (
                  <CheckboxRow
                    key={p.name}
                    checked={providerSet.has(p.name)}
                    onChange={() => onProviderToggle(p.name)}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="capitalize">{p.name}</span>
                      <span className="text-[10px] text-ink-mute">{p.count}</span>
                    </span>
                  </CheckboxRow>
                ))}
              </div>
            </FilterSection>
          )}

          {appliedCount > 0 && (
            <FilterSection label="Applied roles">
              <CheckboxRow
                checked={!hideApplied}
                onChange={(v) => onHideAppliedChange(!v)}
              >
                Include roles you already applied to ({appliedCount})
              </CheckboxRow>
            </FilterSection>
          )}
        </div>
      )}
    </div>
  );
}

/* --------------------------- Sort icon-button ------------------------- */

function SortMenu({
  value,
  onChange,
}: {
  value: SortKey;
  onChange: (v: SortKey) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onEsc);
    };
  }, [open]);

  const label = value === 'best' ? '🏆 Best match' : '🕒 Newest';

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition ${
          open
            ? 'border-brand-500 bg-brand-50 text-brand-700'
            : 'border-line bg-surface text-ink-soft hover:border-brand-500/40'
        }`}
      >
        <SortIcon />
        Sort · <span className="font-semibold">{label}</span>
      </button>
      {open && (
        <div
          role="menu"
          className="absolute left-0 z-20 mt-1 min-w-[180px] rounded-lg border border-line bg-white p-1 shadow-lg"
        >
          <RadioRow
            checked={value === 'best'}
            onChange={() => {
              onChange('best');
              setOpen(false);
            }}
          >
            🏆 Best match
          </RadioRow>
          <RadioRow
            checked={value === 'newest'}
            onChange={() => {
              onChange('newest');
              setOpen(false);
            }}
          >
            🕒 Newest
          </RadioRow>
        </div>
      )}
    </div>
  );
}

/* --------------------------- Shared pieces --------------------------- */

function FilterSection({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-2 border-b border-line/60 pb-2 last:border-b-0 last:pb-0">
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-ink-mute">
        {label}
      </p>
      {children}
    </div>
  );
}

function CheckboxRow({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-xs text-ink hover:bg-cream-50">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-3.5 w-3.5 accent-brand-500"
      />
      <span>{children}</span>
    </label>
  );
}

function RadioRow({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: () => void;
  children: React.ReactNode;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-xs text-ink hover:bg-cream-50">
      <input
        type="radio"
        checked={checked}
        onChange={onChange}
        className="h-3.5 w-3.5 accent-brand-500"
      />
      <span>{children}</span>
    </label>
  );
}

function ActiveFilterSummary({
  modeSet,
  sourceWatchlist,
  locationSet,
  providerSet,
  matchThreshold,
  hideApplied,
  appliedCount,
  onClear,
}: {
  modeSet: Set<ModeOption>;
  sourceWatchlist: boolean;
  locationSet: Set<string>;
  providerSet: Set<string>;
  matchThreshold: 0 | 60 | 75 | 90;
  hideApplied: boolean;
  appliedCount: number;
  onClear: () => void;
}) {
  const bits: string[] = [];
  if (sourceWatchlist) bits.push('watchlist');
  if (modeSet.size > 0) bits.push(Array.from(modeSet).join(' / '));
  if (matchThreshold > 0) bits.push(`${matchThreshold}%+`);
  if (providerSet.size > 0) {
    bits.push(
      providerSet.size <= 2
        ? Array.from(providerSet).join(' / ')
        : `${providerSet.size} providers`,
    );
  }
  if (locationSet.size > 0) {
    bits.push(
      locationSet.size <= 2
        ? Array.from(locationSet).join(' / ')
        : `${locationSet.size} locations`,
    );
  }
  if (!hideApplied && appliedCount > 0) bits.push(`+ ${appliedCount} applied`);

  if (bits.length === 0) return null;

  return (
    <div className="flex items-center gap-1 text-xs text-ink-soft">
      <span className="opacity-70">Filtering:</span>
      <span className="font-medium text-ink">{bits.join(' · ')}</span>
      <button
        type="button"
        onClick={onClear}
        className="ml-1 underline underline-offset-2 hover:text-ink"
      >
        clear
      </button>
    </div>
  );
}

function FilterIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z" />
    </svg>
  );
}

function SortIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M3 6h13M3 12h9M3 18h5M17 8l4 4-4 4" />
    </svg>
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
