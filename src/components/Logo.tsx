/**
 * Relaunch wordmark — 'R' on a forest-green plate that matches the
 * Backyard SaaS parent brand. Cream 'R' on a top-to-bottom forest
 * gradient (#1A3826 → #2C5239), mirroring the sprout-mark plate used
 * across the Backyard site + logo lockups.
 */
export function Logo({ size = 30 }: { size?: number }) {
  return (
    <span className="inline-flex items-center gap-2.5 font-bold text-lg">
      <span
        className="grid place-items-center font-extrabold"
        style={{
          width: size,
          height: size,
          borderRadius: size / 3.5,
          background: 'linear-gradient(180deg, #1A3826, #2C5239)',
          color: '#F0E5CE',
          fontSize: size / 2.2,
          letterSpacing: '-0.02em',
        }}
      >
        R
      </span>
      Relaunch
    </span>
  );
}
