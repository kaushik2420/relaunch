import { serverConfig } from '@/lib/config';

/**
 * Fetch Adzuna's salary histogram for (country, keyword, location).
 * Returns the market's posted-salary distribution — the raw signal that
 * llm.estimateSalary personalises into a candidate-specific range.
 *
 * Adzuna's documented endpoint (verified against docs, June 2026):
 *   https://api.adzuna.com/v1/api/jobs/{country}/histogram?
 *     app_id=…&app_key=…
 *     &location0={country_name}
 *     &location1={city_optional}
 *     &what={keyword_url_encoded}
 *     &content-type=application/json
 *
 * Notes:
 *   - location is HIERARCHICAL — location0 is the country name (e.g.
 *     "India", "UK"), location1 is the city. We derive both from the
 *     free-text location string, cleaning obvious decorations first.
 *   - `where` (used by the search endpoint) is NOT supported on the
 *     histogram endpoint — using it silently returns 4xx.
 *   - Currency is inferred from the country code.
 */

const COUNTRY_CURRENCY: Record<string, { currency: string; name: string }> = {
  in: { currency: 'INR', name: 'India' },
  us: { currency: 'USD', name: 'United States' },
  gb: { currency: 'GBP', name: 'UK' },
  au: { currency: 'AUD', name: 'Australia' },
  ca: { currency: 'CAD', name: 'Canada' },
  de: { currency: 'EUR', name: 'Germany' },
  fr: { currency: 'EUR', name: 'France' },
  it: { currency: 'EUR', name: 'Italy' },
  es: { currency: 'EUR', name: 'Spain' },
  nl: { currency: 'EUR', name: 'Netherlands' },
  sg: { currency: 'SGD', name: 'Singapore' },
  za: { currency: 'ZAR', name: 'South Africa' },
};

export function inferCountryFromLocation(location: string): {
  country: string;
  currency: string;
  countryName: string;
} {
  const l = (location ?? '').toLowerCase();
  if (
    /\b(india|bangalore|bengaluru|mumbai|delhi|pune|hyderabad|chennai|noida|gurugram|gurgaon|kolkata|ahmedabad)\b/.test(
      l,
    )
  ) {
    return { country: 'in', currency: 'INR', countryName: 'India' };
  }
  if (/\b(united kingdom|london|manchester|edinburgh|uk|gb)\b/.test(l)) {
    return { country: 'gb', currency: 'GBP', countryName: 'UK' };
  }
  if (
    /\b(united states|usa|us|new york|san francisco|seattle|austin|boston|remote.+us)\b/.test(
      l,
    )
  ) {
    return { country: 'us', currency: 'USD', countryName: 'United States' };
  }
  if (/\b(singapore|sg)\b/.test(l)) {
    return { country: 'sg', currency: 'SGD', countryName: 'Singapore' };
  }
  if (/\b(canada|toronto|vancouver|ca)\b/.test(l)) {
    return { country: 'ca', currency: 'CAD', countryName: 'Canada' };
  }
  if (/\b(australia|sydney|melbourne|au)\b/.test(l)) {
    return { country: 'au', currency: 'AUD', countryName: 'Australia' };
  }
  // Default to India — Relaunch's primary user base.
  return { country: 'in', currency: 'INR', countryName: 'India' };
}

/**
 * Extract a clean city from a decorated location string like
 * "Bangalore · Remote-friendly" or "Mumbai / Hybrid · India". Returns
 * the first plausibly-city-sized segment we can find, or an empty
 * string if there's nothing usable (in which case we skip location1
 * and let Adzuna use the country-wide histogram).
 */
export function extractCityFromLocation(location: string): string {
  if (!location) return '';
  // Split on common separators: middot, comma, slash, dash, pipe
  const parts = location
    .split(/[·•|/,\-–—]|\s+·\s+|\s+•\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const SKIP = /^(remote|remote-friendly|hybrid|onsite|on-site|anywhere|any|india|uk|us|usa|united\s+states)$/i;

  for (const p of parts) {
    if (SKIP.test(p)) continue;
    // A city segment is usually 2-30 chars, mostly letters + spaces.
    if (p.length >= 2 && p.length <= 40 && /[a-zA-Z]/.test(p)) {
      return p;
    }
  }
  return '';
}

export async function fetchAdzunaHistogram(input: {
  jobTitle: string;
  location: string;
}): Promise<{
  histogram: { salary: number; vacancies: number }[];
  totalVacancies: number;
  country: string;
  currency: string;
}> {
  const cfg = serverConfig();
  if (!cfg.ADZUNA_APP_ID || !cfg.ADZUNA_APP_KEY) {
    throw new Error(
      'Adzuna credentials not set — salary estimate needs ADZUNA_APP_ID + ADZUNA_APP_KEY.',
    );
  }

  const { country, currency, countryName } = inferCountryFromLocation(
    input.location,
  );
  const city = extractCityFromLocation(input.location);

  // Build query. location0 = country name, location1 = city (only if
  // we found a plausible one). Skipping location1 falls back to a
  // country-wide histogram which still gives useful signal.
  const params = new URLSearchParams({
    app_id: cfg.ADZUNA_APP_ID,
    app_key: cfg.ADZUNA_APP_KEY,
    what: input.jobTitle,
    location0: countryName,
    'content-type': 'application/json',
  });
  if (city) params.set('location1', city);

  const url = `https://api.adzuna.com/v1/api/jobs/${country}/histogram?${params}`;

  let res: Response;
  try {
    res = await fetch(url, {
      signal: AbortSignal.timeout(10000),
      next: { revalidate: 3600 }, // cache 1h at the edge
    });
  } catch (err) {
    console.error('[adzuna-salary] network error', err);
    throw new Error("Couldn't reach the salary data source. Try again in a moment.");
  }

  if (!res.ok) {
    let body = '';
    try {
      body = (await res.text()).slice(0, 500);
    } catch {
      // ignore
    }
    console.error(
      `[adzuna-salary] HTTP ${res.status} for ${input.jobTitle} @ ${input.location} ` +
        `(country=${country}, city=${city || '(none)'}) — body: ${body}`,
    );
    // 400s from Adzuna usually mean unknown location or empty query.
    // Retry once WITHOUT location1 if we sent one — the country-wide
    // histogram is a valid fallback.
    if (res.status === 400 && city) {
      const fallbackParams = new URLSearchParams({
        app_id: cfg.ADZUNA_APP_ID,
        app_key: cfg.ADZUNA_APP_KEY,
        what: input.jobTitle,
        location0: countryName,
        'content-type': 'application/json',
      });
      const fallbackUrl = `https://api.adzuna.com/v1/api/jobs/${country}/histogram?${fallbackParams}`;
      const retry = await fetch(fallbackUrl, {
        signal: AbortSignal.timeout(10000),
        next: { revalidate: 3600 },
      });
      if (retry.ok) {
        console.log(
          `[adzuna-salary] country-wide fallback succeeded for ${input.jobTitle}`,
        );
        res = retry;
      } else {
        throw new Error(
          `Adzuna returned ${res.status} for this role. We may not have salary data for '${input.jobTitle}' in this region yet.`,
        );
      }
    } else {
      throw new Error(
        `Adzuna returned ${res.status} for this role. We may not have salary data for '${input.jobTitle}' in this region yet.`,
      );
    }
  }

  let data: { histogram?: Record<string, number | string> };
  try {
    data = await res.json();
  } catch (err) {
    console.error('[adzuna-salary] JSON parse failed', err);
    throw new Error("Couldn't parse the salary data. Try again in a moment.");
  }

  const raw = data.histogram ?? {};
  const histogram = Object.entries(raw)
    .map(([salary, vacancies]) => ({
      salary: Number(salary),
      vacancies: Number(vacancies),
    }))
    .filter((h) => Number.isFinite(h.salary) && h.vacancies > 0)
    .sort((a, b) => a.salary - b.salary);

  const totalVacancies = histogram.reduce((s, h) => s + h.vacancies, 0);

  console.log(
    `[adzuna-salary] ${input.jobTitle} @ ${countryName}${city ? '/' + city : ''}: ${totalVacancies} postings across ${histogram.length} buckets`,
  );

  return { histogram, totalVacancies, country, currency };
}
