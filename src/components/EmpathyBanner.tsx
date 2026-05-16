/**
 * Standardized empathy banner — please use this anywhere we want to reach
 * out to the user warmly. Don't ship one-off copy that contradicts the
 * principles in docs/EMPATHY.md.
 */
export function EmpathyBanner({
  icon = '💛',
  title,
  children,
}: {
  icon?: string;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="empathy">
      <div className="text-xl leading-none">{icon}</div>
      <div className="text-sm leading-relaxed">
        {title && <strong className="block mb-0.5 text-ink">{title}</strong>}
        {children}
      </div>
    </div>
  );
}
