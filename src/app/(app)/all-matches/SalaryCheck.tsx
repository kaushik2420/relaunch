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
}

/**
 * Inline salary reality-check for a single job card. Collapsed by
 * default (a small chip). Click → fetches an estimate lazily from
 * /api/salary/estimate. Not pre-computed — we don't want to burn
 * Claude tokens for matches the user never opens.
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
          {loading && <p className="text-ink-soft">Building your estimate — 5–10 seconds…</p>}
          {error && <p className="text-warn">{error}</p>}
          {data && (
            <>
              <div className="flex flex-wrap items-baseline gap-3">
                <div className="text-lg font-bold text-ink">
                  {fmt(data.rangeLow, data.currency)} –{" "}
                  {fmt(data.rangeHigh, data.currency)}
                </div>
                <div className="text-xs text-ink-soft">
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
              <p className="mt-2 leading-relaxed text-ink">{data.explanation}</p>
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
