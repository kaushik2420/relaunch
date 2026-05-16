/**
 * 4-dot onboarding stepper. Shared by every /onboarding/* page so the
 * user always knows where they are in the flow.
 *
 * Lives outside /app/ on purpose: Next.js forbids non-page exports
 * from a page.tsx, so a normal component file is the right home.
 */
export function Stepper({ step }: { step: 1 | 2 | 3 | 4 }) {
  return (
    <div className="mb-7 flex justify-center gap-2">
      {[1, 2, 3, 4].map((n) => (
        <span
          key={n}
          className={`h-1 w-8 rounded-full ${
            n < step ? 'bg-success' : n === step ? 'bg-brand-500' : 'bg-line'
          }`}
        />
      ))}
    </div>
  );
}
