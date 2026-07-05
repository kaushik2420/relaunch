/**
 * Parse a free-form CTC string into a normalised numeric value.
 *
 * Handles the input shapes users actually type:
 *   "18L", "18 L", "18 lakh", "18 LPA"   → 1800000 (INR)
 *   "22 lpa", "22.5 L"                    → 2250000 (INR)
 *   "1,800,000", "18,00,000"              → 1800000 (INR)
 *   "$140k", "140k USD", "140,000 usd"    → 140000 (USD)
 *   "£85,000"                             → 85000 (GBP)
 *   "1.2 cr", "1.2 crore"                 → 12000000 (INR)
 *
 * Returns { amount, currency } where amount is annual figure in the
 * detected currency's base unit. Returns null when the input is empty
 * or unparseable — the caller should handle that as "no baseline".
 */
export function parseCtcToNumber(
  raw: string | null | undefined,
): { amount: number; currency: 'INR' | 'USD' | 'GBP' | 'EUR' } | null {
  if (!raw) return null;
  const s = raw.trim().toLowerCase();
  if (!s) return null;

  // Detect currency from symbol / keyword. Default to INR (our primary
  // market) if the input has L/lakh/crore/LPA — those are unambiguous
  // India-only markers.
  let currency: 'INR' | 'USD' | 'GBP' | 'EUR' = 'INR';
  if (/\$|\busd\b/.test(s)) currency = 'USD';
  else if (/£|\bgbp\b/.test(s)) currency = 'GBP';
  else if (/€|\beur\b/.test(s)) currency = 'EUR';
  // ₹, "L", "lakh", "LPA", "cr", "crore", "inr" all → INR (default)

  // Extract the leading number. Handles "1,800,000", "18,00,000",
  // "22.5", "1.2".
  const numMatch = s.match(/(-?\d[\d,]*\.?\d*)/);
  if (!numMatch || !numMatch[1]) return null;
  const num = parseFloat(numMatch[1].replace(/,/g, ''));
  if (!Number.isFinite(num) || num <= 0) return null;

  // Detect scale multiplier from suffix.
  let multiplier = 1;
  if (/\b(cr|crore)s?\b/.test(s)) multiplier = 10_000_000;   // 1 cr = 1 crore rupees
  else if (/\b(l|lakh|lac|lpa)s?\b/.test(s)) multiplier = 100_000; // 1 L = 1 lakh = 100k
  else if (/\bk\b|\d\s*k\b/.test(s)) multiplier = 1_000;     // 140k = 140,000

  const amount = Math.round(num * multiplier);
  return { amount, currency };
}

/**
 * Format a currency amount for display, matching the existing
 * SalaryCheck formatter (INR shown as lakhs when 6+ figures).
 */
export function formatCtc(amount: number, currency: string): string {
  if (currency === 'INR' && amount >= 100_000) {
    return `₹${(amount / 100_000).toFixed(1)} L`;
  }
  const symbols: Record<string, string> = {
    INR: '₹',
    USD: '$',
    GBP: '£',
    EUR: '€',
  };
  const s = symbols[currency] ?? currency + ' ';
  return `${s}${Math.round(amount).toLocaleString()}`;
}

/**
 * Compute the hike percentage from `current` to `target`, rounded to
 * the nearest integer. Returns null if current is zero or the numbers
 * are nonsensical.
 */
export function hikePercent(current: number, target: number): number | null {
  if (!current || current <= 0 || !Number.isFinite(current)) return null;
  if (!target || target <= 0 || !Number.isFinite(target)) return null;
  return Math.round(((target - current) / current) * 100);
}
