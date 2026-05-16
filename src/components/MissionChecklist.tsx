'use client';
import { useEffect, useState } from 'react';

/**
 * Today's-mission checklist that the user can actually tick off.
 *
 * State strategy: localStorage keyed by user.id + today's date.
 *   - Resets at midnight (new key each day)
 *   - Survives reloads
 *   - No server table needed — kept lean for our 30-user phase
 *
 * Some items auto-check based on real data (passed in via props):
 *   - "Review today's matches" auto-checks when matches > 0
 *   - "Apply to 2+ jobs" auto-checks based on the applied count we read
 *     from the Sheet (passed in)
 * Other items remain user-toggled (send InMail, upskill time).
 */

interface MissionItem {
  id: 'review' | 'apply' | 'inmail' | 'skill';
  label: string;
  /** If set, item is auto-checked (no toggle) based on real data */
  autoChecked?: boolean;
  hint?: string;
}

export function MissionChecklist({
  userId,
  matchesCount,
  applicationsSent,
}: {
  userId: string;
  matchesCount: number;
  applicationsSent: number;
}) {
  const todayKey = todayKeyFor(userId);

  // Manual checks live in localStorage; auto-checks come from props.
  const [manual, setManual] = useState<Record<string, boolean>>({});
  const [hydrated, setHydrated] = useState(false);

  // Hydrate from localStorage after mount (avoids SSR mismatch)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(todayKey);
      setManual(raw ? JSON.parse(raw) : {});
    } catch { /* corrupt JSON — start fresh */ }
    setHydrated(true);
  }, [todayKey]);

  function toggle(id: string) {
    setManual((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      try {
        localStorage.setItem(todayKey, JSON.stringify(next));
      } catch { /* private mode / quota — soldier on without persistence */ }
      return next;
    });
  }

  const items: MissionItem[] = [
    {
      id: 'review',
      label: "Review today's matches",
      autoChecked: matchesCount > 0,
      hint: matchesCount > 0 ? `${matchesCount} waiting` : 'Click "Find matches now" to pull a batch',
    },
    {
      id: 'apply',
      label: 'Apply to your top 2 picks',
      autoChecked: applicationsSent >= 2,
      hint:
        applicationsSent >= 2
          ? `${applicationsSent} sent — solid`
          : applicationsSent === 1
          ? '1 sent · 1 to go'
          : undefined,
    },
    {
      id: 'inmail',
      label: 'Send 1 InMail',
    },
    {
      id: 'skill',
      label: '20 min on a skill (optional)',
    },
  ];

  // Total completion = autoChecked OR manual[id] true
  const completed = items.filter((i) => i.autoChecked || manual[i.id]).length;
  const allDone = completed === items.length;

  return (
    <div className="card p-5">
      <div className="flex items-baseline justify-between mb-3">
        <h3 className="text-xs uppercase tracking-wider text-ink-soft">Today's mission</h3>
        <span className="text-xs text-ink-mute">{completed}/{items.length}</span>
      </div>

      <ul className="space-y-2">
        {items.map((item) => {
          const isAuto = item.autoChecked === true;
          const isChecked = isAuto || !!manual[item.id];
          return (
            <li key={item.id}>
              <label
                className={`flex items-start gap-2 text-sm ${isAuto ? 'cursor-default' : 'cursor-pointer'}`}
                title={isAuto ? 'Auto-tracked based on your activity' : 'Click to toggle'}
              >
                <input
                  type="checkbox"
                  className="mt-1 accent-brand-500 disabled:opacity-100"
                  checked={hydrated ? isChecked : false}
                  disabled={isAuto}
                  onChange={() => {
                    if (!isAuto) toggle(item.id);
                  }}
                />
                <span className="flex-1">
                  <span className={isChecked ? 'text-ink-soft line-through' : ''}>
                    {item.label}
                  </span>
                  {item.hint && (
                    <span className="ml-2 text-xs text-ink-mute">· {item.hint}</span>
                  )}
                </span>
              </label>
            </li>
          );
        })}
      </ul>

      {hydrated && allDone && (
        <div className="mt-3 rounded-lg bg-success-soft p-3 text-xs text-success">
          🌅 Solid day. Take a walk — truly.
        </div>
      )}
    </div>
  );
}

function todayKeyFor(userId: string): string {
  const today = new Date();
  // Use local date so the list resets at the user's midnight, not UTC midnight
  const d = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  return `relaunch-mission:${userId}:${d}`;
}
