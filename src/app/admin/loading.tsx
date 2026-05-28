import { Spinner } from "@/components/Spinner";

export default function Loading() {
  return (
    <div className="grid min-h-screen place-items-center text-ink-soft">
      <div className="flex items-center gap-3">
        <Spinner size={20} className="text-brand-500" />
        <span className="text-sm">Loading admin…</span>
      </div>
    </div>
  );
}
