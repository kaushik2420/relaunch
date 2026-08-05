'use client';
import { useMemo, useState } from 'react';
import type { Mentor } from '@/lib/services/mentors';

interface Props {
  mentors: Mentor[];
}

/**
 * Client component so we can:
 *   1. Filter locally by expertise tag (no server round-trip)
 *   2. Fire a click-log POST on "Book a session" alongside the
 *      window.open() — attribution stays best-effort and never blocks
 *      the actual link opening.
 */
export function MentorsGrid({ mentors }: Props) {
  const [activeTag, setActiveTag] = useState<string | null>(null);

  // Distinct tags across all currently-active mentors, sorted by
  // frequency descending. Filter chip UI at the top.
  const tagOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const m of mentors) {
      for (const t of m.expertise) {
        counts.set(t, (counts.get(t) ?? 0) + 1);
      }
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [mentors]);

  const filtered = useMemo(() => {
    if (!activeTag) return mentors;
    return mentors.filter((m) => m.expertise.includes(activeTag));
  }, [mentors, activeTag]);

  async function onBookClick(mentor: Mentor) {
    // Open the calendar tab immediately so browsers don't block it as
    // a pop-up. The click-log POST is fire-and-forget in parallel.
    window.open(mentor.calendarUrl, '_blank', 'noopener,noreferrer');
    try {
      await fetch('/api/mentors/click', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mentorId: mentor.id, fromPage: '/mentors' }),
        keepalive: true,
      });
    } catch {
      // best-effort; ignore
    }
  }

  return (
    <>
      {tagOptions.length > 1 && (
        <div className="mb-6 flex flex-wrap items-center gap-2">
          <span className="text-xs uppercase tracking-wider text-ink-mute">
            Filter:
          </span>
          <button
            type="button"
            onClick={() => setActiveTag(null)}
            className={
              activeTag === null
                ? 'rounded-full bg-brand-500 px-3 py-1 text-xs font-semibold text-white'
                : 'rounded-full border border-line bg-surface px-3 py-1 text-xs font-semibold text-ink-soft hover:bg-cream-100'
            }
          >
            All ({mentors.length})
          </button>
          {tagOptions.map(([tag, count]) => (
            <button
              key={tag}
              type="button"
              onClick={() => setActiveTag(tag)}
              className={
                activeTag === tag
                  ? 'rounded-full bg-brand-500 px-3 py-1 text-xs font-semibold text-white'
                  : 'rounded-full border border-line bg-surface px-3 py-1 text-xs font-semibold text-ink-soft hover:bg-cream-100'
              }
            >
              {tag} ({count})
            </button>
          ))}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((m) => (
          <MentorCard key={m.id} mentor={m} onBook={onBookClick} />
        ))}
      </div>

      {filtered.length === 0 && (
        <p className="mt-6 text-center text-sm text-ink-soft">
          No mentors match that expertise right now. Try another tag.
        </p>
      )}
    </>
  );
}

function MentorCard({
  mentor,
  onBook,
}: {
  mentor: Mentor;
  onBook: (m: Mentor) => void;
}) {
  const initials = mentor.name
    .split(/\s+/)
    .slice(0, 2)
    .map((n) => n[0]?.toUpperCase())
    .join('');
  return (
    <div className="flex flex-col rounded-xl border border-line bg-surface p-5 shadow-card transition-shadow hover:shadow-lg">
      <div className="flex items-start gap-3">
        {mentor.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={mentor.avatarUrl}
            alt=""
            className="h-14 w-14 rounded-full object-cover"
          />
        ) : (
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-brand-500 text-lg font-semibold text-white">
            {initials || '?'}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="font-semibold">{mentor.name}</div>
          <div className="mt-0.5 text-sm text-ink-soft">{mentor.headline}</div>
        </div>
      </div>

      {mentor.bio && (
        <p className="mt-3 text-sm text-ink">{mentor.bio}</p>
      )}

      {mentor.expertise.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {mentor.expertise.slice(0, 4).map((t) => (
            <span
              key={t}
              className="rounded-full bg-cream-100 px-2 py-0.5 text-[11px] font-medium text-ink-soft"
            >
              {t}
            </span>
          ))}
        </div>
      )}

      {(mentor.sessionLengthMinutes || mentor.sessionPriceNote) && (
        <div className="mt-3 text-xs text-ink-mute">
          {mentor.sessionLengthMinutes ? (
            <span>{mentor.sessionLengthMinutes} min</span>
          ) : null}
          {mentor.sessionLengthMinutes && mentor.sessionPriceNote ? ' · ' : ''}
          {mentor.sessionPriceNote}
        </div>
      )}

      <div className="mt-4 flex items-center gap-2">
        <button
          type="button"
          onClick={() => onBook(mentor)}
          className="btn-primary flex-1 justify-center text-sm"
        >
          Book a session →
        </button>
        {mentor.linkedinUrl && (
          <a
            href={mentor.linkedinUrl}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-brand-700 hover:underline"
            title="LinkedIn profile"
          >
            LinkedIn ↗
          </a>
        )}
      </div>
    </div>
  );
}
