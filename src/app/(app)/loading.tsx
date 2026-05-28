import { Spinner } from "@/components/Spinner";

/**
 * Default loading UI for every (app)/* page — shows while a server
 * component is still fetching its data on navigation.
 */
export default function Loading() {
  return (
    <div className="grid min-h-[60vh] place-items-center text-ink-soft">
      <div className="flex items-center gap-3">
        <Spinner size={20} className="text-brand-500" />
        <span className="text-sm">Loading…</span>
      </div>
    </div>
  );
}
