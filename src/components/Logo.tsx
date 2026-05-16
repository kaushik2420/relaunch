export function Logo({ size = 30 }: { size?: number }) {
  return (
    <span className="inline-flex items-center gap-2.5 font-bold text-lg">
      <span
        className="grid place-items-center text-white font-extrabold"
        style={{
          width: size,
          height: size,
          borderRadius: size / 3.5,
          background: 'linear-gradient(135deg, #5B6CFF, #F8A170)',
          fontSize: size / 2.2,
        }}
      >
        R
      </span>
      Relaunch
    </span>
  );
}
