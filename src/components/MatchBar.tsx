/**
 * Visual match-score indicator — a filled bar coloured by tier, with the
 * percentage spelled out alongside. Reads more at-a-glance than a bare
 * "94%" pill. Shared between JobCard and JobTable.
 */
export function MatchBar({ percent }: { percent: number }) {
  if (!percent || percent <= 0) {
    return <span className="text-xs text-ink-mute">—</span>;
  }
  const tier =
    percent >= 88
      ? "high"
      : percent >= 75
        ? "mid"
        : percent >= 60
          ? "low"
          : "muted";
  const fillClass = {
    high: "bg-success",
    mid: "bg-brand-500",
    low: "bg-accent-500",
    muted: "bg-ink-mute",
  }[tier];
  const textClass = {
    high: "text-success",
    mid: "text-brand-700",
    low: "text-accent-600",
    muted: "text-ink-soft",
  }[tier];
  // Tiny minimum so even very low scores leave a visible nub.
  const width = Math.max(Math.min(percent, 100), 6);
  return (
    <span
      className="inline-flex items-center gap-2"
      aria-label={`${percent} percent match`}
    >
      <span className="relative h-2 w-24 overflow-hidden rounded-full bg-line">
        <span
          className={`absolute inset-y-0 left-0 ${fillClass}`}
          style={{ width: `${width}%` }}
        />
      </span>
      <span className={`text-xs font-bold ${textClass}`}>{percent}%</span>
    </span>
  );
}
