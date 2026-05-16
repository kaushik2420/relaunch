'use client';
import { useMemo, useState } from 'react';
import { locationsByRegion, type LocationOption } from '@/lib/locations';

/**
 * Multi-select chip picker for preferred locations.
 *
 * UX:
 *  - Groups options by region (India / US / EU / APAC / Anywhere)
 *  - Type to filter — search matches the label OR any spelling alias
 *    (so typing "BLR" finds "Bengaluru")
 *  - Click a chip to toggle. Selected chips have a brand-tinted background.
 *  - Shows selection count at the top.
 *
 * Form submission: emits hidden inputs named `locationIds` (one per
 * selected option). The server action then expands these to match terms
 * before saving to users.locations.
 */
export function LocationPicker({ initialSelectedIds }: { initialSelectedIds: string[] }) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set(initialSelectedIds));
  const [filter, setFilter] = useState('');

  const groups = useMemo(() => locationsByRegion(), []);

  // Filter on label + matchTerms so users can search for any common spelling
  const filteredGroups = useMemo(() => {
    if (!filter.trim()) return groups;
    const needle = filter.toLowerCase().trim();
    return groups
      .map((g) => ({
        ...g,
        options: g.options.filter(
          (o) =>
            o.label.toLowerCase().includes(needle) ||
            o.matchTerms.some((t) => t.toLowerCase().includes(needle)),
        ),
      }))
      .filter((g) => g.options.length > 0);
  }, [groups, filter]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <label className="label !mb-0">Preferred locations</label>
        <span className="text-xs text-ink-mute">
          {selected.size === 0 ? 'None selected' : `${selected.size} selected`}
        </span>
      </div>

      <input
        type="text"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder='Search "Bengaluru", "Remote", "SF"…'
        className="input mb-3"
      />

      <div className="space-y-3 max-h-72 overflow-y-auto pr-1">
        {filteredGroups.map((g) => (
          <div key={g.region}>
            <h4 className="text-[11px] uppercase tracking-wider text-ink-mute mb-1.5">
              {g.region}
            </h4>
            <div className="flex flex-wrap gap-1.5">
              {g.options.map((opt) => (
                <Chip
                  key={opt.id}
                  opt={opt}
                  selected={selected.has(opt.id)}
                  onClick={() => toggle(opt.id)}
                />
              ))}
            </div>
          </div>
        ))}
        {filteredGroups.length === 0 && (
          <p className="text-sm text-ink-soft">
            No locations match "{filter}". Need one we don't have? Email hello@get-relaunch.com.
          </p>
        )}
      </div>

      {/* Hidden inputs — what gets posted to the server action */}
      {Array.from(selected).map((id) => (
        <input key={id} type="hidden" name="locationIds" value={id} />
      ))}
    </div>
  );
}

function Chip({
  opt,
  selected,
  onClick,
}: {
  opt: LocationOption;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-3 py-1 text-xs transition ${
        selected
          ? 'border-brand-500 bg-brand-50 text-brand-700 font-semibold'
          : 'border-line bg-surface text-ink-soft hover:border-brand-500 hover:text-ink'
      }`}
    >
      {opt.isRemote && '🌐 '}
      {opt.label}
    </button>
  );
}
