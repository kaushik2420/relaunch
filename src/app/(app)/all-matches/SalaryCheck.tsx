"use client";
import { useState } from "react";

interface SalaryEstimate {
  rangeLow: number;
  rangeMid: number;
  rangeHigh: number;
  currency: string;
  confidence: "low" | "medium" | "high";
  explanation: string;
  sampleSize: number;
  verifyLinks: { label: string; url: string }[];
  disclaimer: string;
  hasCurrentCtc: boolean;
  hike: {
    currentCtc: string;
    currentAmount: number;
    currency: string;
    lowPct: number | null;
    midPct: number | null;
    highPct: number | null;
  } | null;
}

/**
 * Inline salary reality-check for a single job card.
 *
 * Collapsed by default (a small chip). Click → fetches an estimate
 * lazily from /api/salary/estimate. If the user has recorded a
 * current CTC, we also show a hike% ("Realistic hike: 28-45%").
 *
 * When current CTC is not yet set, we show a compact inline form
 * inside the expanded card — one-time entry, then all future salary
 * checks automatically show hike %.
 */
export function SalaryCheck({
  jobTitle,
  company,
  location,
}: {
  jobTitle: string;
  company: string;
  location: string;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<SalaryEstimate | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    if (open && data) {
      setOpen(false);
      return;
    }
    setOpen(true);
    if (data) return; // already fetched — just re-expand
    await fetchEstimate();
  }

  async function fetchEstimate() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/salary/estimate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobTitle, company, location }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? "Couldn't build the estimate.");
      }
      const json = (await res.json()) as SalaryEstimate;
      setData(json);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        className={
          open
            ? "inline-flex items-center rounded-full bg-brand-500 px-3 py-1 text-xs font-semibold text-white"
            : "inline-flex items-center rounded-full border border-line bg-white px-3 py-1 text-xs font-semibold text-ink-soft hover:bg-cream-100"
        }
      >
        {loading ? "Estimating…" : open ? "Hide salary check" : "Salary check"}
      </button>
      {open && (
        <div className="mt-3 w-full rounded-lg border border-line bg-cream-50 p-3 text-xs">
          {loading && (
            <p className="text-ink-soft">
              Building your estimate — 5–10 seconds…
            </p>
          )}
          {error && <p className="text-warn">{error}</p>}
          {data && (
            <>
              {/* Hike header — the value-add. Shows first if we have it,
                  otherwise a compact "add your CTC" prompt appears in the
                  same slot. */}
              {data.hike ? (
                <HikeHeader hike={data.hike} data={data} />
              ) : (
                <CurrentCtcInlineForm onSaved={fetchEstimate} />
              )}

              <div className="mt-3 flex flex-wrap items-baseline gap-3 border-t border-line pt-3">
                <div className="text-sm font-semibold text-ink">
                  Market range:{" "}
                  {fmt(data.rangeLow, data.currency)} –{" "}
                  {fmt(data.rangeHigh, data.currency)}
                </div>
                <div className="text-[11px] text-ink-soft">
                  Midpoint {fmt(data.rangeMid, data.currency)} ·
                  <span
                    className={
                      data.confidence === "high"
                        ? " text-success"
                        : data.confidence === "medium"
                          ? " text-brand-700"
                          : " text-warn"
                    }
                  >
                    {" "}
                    {data.confidence} confidence
                  </span>
                  {data.sampleSize > 0 && (
                    <span> · {data.sampleSize} postings</span>
                  )}
                </div>
              </div>
              <p className="mt-2 leading-relaxed text-ink">
                {data.explanation}
              </p>
              <p className="mt-2 text-ink-mute">{data.disclaimer}</p>
              {data.verifyLinks.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  <span className="text-ink-mute">Verify:</span>
                  {data.verifyLinks.map((l) => (
                    <a
                      key={l.url}
                      href={l.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-brand-700 underline underline-offset-2 hover:text-brand-500"
                    >
                      {l.label}
                    </a>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </>
  );
}

/**
 * Hike badge — the headline number when we have a current CTC to compare
 * against. Rendered inside the expanded salary card, at the top.
 */
function HikeHeader({
  hike,
  data,
}: {
  hike: NonNullable<SalaryEstimate["hike"]>;
  data: SalaryEstimate;
}) {
  const lo = hike.lowPct;
  const mid = hike.midPct;
  const hi = hike.highPct;

  // Pick a sensible "realistic" range: low to high, capped so we don't
  // scream "300% hike" from a single outlier posting.
  const range =
    lo != null && hi != null
      ? `${Math.max(-100, Math.min(200, lo))}% – ${Math.max(-100, Math.min(200, hi))}%`
      : null;

  // Sentiment tint: green if midPct is meaningfully positive, warn if
  // negative (this role would be a pay cut), neutral otherwise.
  const tint =
    mid == null
      ? "bg-cream-100 text-ink"
      : mid >= 20
        ? "bg-success-soft text-success"
        : mid >= 5
          ? "bg-accent-500/30 text-brand-700"
          : mid >= -5
            ? "bg-cream-100 text-ink"
            : "bg-warn-soft text-warn";

  return (
    <div className={`rounded-lg px-3 py-2 ${tint}`}>
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="text-[10px] uppercase tracking-wide font-semibold opacity-70">
          Realistic hike
        </span>
        {range ? (
          <span className="text-base font-bold">{range}</span>
        ) : (
          <span className="text-sm">—</span>
        )}
        {mid != null && (
          <span className="text-[11px] opacity-80">
            midpoint {mid >= 0 ? "+" : ""}
            {mid}%
          </span>
        )}
      </div>
      <p className="mt-0.5 text-[11px] opacity-80">
        From your current {hike.currentCtc} → this role's{" "}
        {fmt(data.rangeLow, data.currency)}–
        {fmt(data.rangeHigh, data.currency)} range.
      </p>
    </div>
  );
}

/**
 * One-time inline form to capture the user's current CTC when it's
 * not yet on file. Compact — sits at the top of the salary card in
 * place of the hike badge. Once submitted, the parent re-fetches the
 * estimate and the hike badge takes over.
 */
function CurrentCtcInlineForm({ onSaved }: { onSaved: () => void }) {
  const [val, setVal] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!val.trim()) return;
    setSaving(true);
    setErr(null);
    try {
      const res = await fetch("/api/salary/current-ctc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentCtc: val.trim() }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? "Couldn't save.");
      }
      onSaved();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-lg border border-dashed border-brand-500/40 bg-brand-500/5 px-3 py-2"
    >
      <p className="text-[11px] font-semibold text-brand-700">
        💡 See a realistic hike % for every match
      </p>
      <p className="text-[11px] text-ink-soft">
        Tell us your current CTC once — we'll compute the expected hike for
        this role and every future match.
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input
          value={val}
          onChange={(e) => setVal(e.target.value)}
          placeholder="e.g. 18L, 22 LPA, $140k"
          className="min-w-[140px] flex-1 rounded-md border border-line bg-white px-2 py-1 text-xs"
          disabled={saving}
        />
        <button
          type="submit"
          disabled={saving || !val.trim()}
          className="rounded-md bg-brand-500 px-3 py-1 text-xs font-semibold text-white hover:bg-brand-600 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
      {err && <p className="mt-1 text-[11px] text-warn">{err}</p>}
      <p className="mt-1 text-[10px] text-ink-mute">
        Stored on your account only. You can update it anytime in Settings.
      </p>
    </form>
  );
}

function fmt(amount: number, currency: string): string {
  // Indian rupees look better in lakhs when the number is 6+ figures.
  if (currency === "INR" && amount >= 100000) {
    return `₹${(amount / 100000).toFixed(1)} L`;
  }
  const symbols: Record<string, string> = {
    INR: "₹",
    USD: "$",
    GBP: "£",
    EUR: "€",
    AUD: "A$",
    CAD: "C$",
    SGD: "S$",
  };
  const s = symbols[currency] ?? currency + " ";
  return `${s}${Math.round(amount).toLocaleString()}`;
}
