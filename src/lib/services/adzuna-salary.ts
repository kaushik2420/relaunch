import { serverConfig } from '@/lib/config';

/**
 * Fetch Adzuna's salary histogram for (country, keyword, location).
 * Returns the market's posted-salary distribution — the raw signal that
 * llm.estimateSalary personalises into a candidate-specific range.
 *
 * Adzuna documented endpoint:
 *   https://api.adzuna.com/v1/api/jobs/{country}/histogram?
 *     app_id=…&app_key=…&what=…&where=…
 *
 * Returns { salary_floor: vacancy_count } — we convert to a sortable
 * array. Currency is inferred from country code.
 */

const COUNTRY_CURRENCY: Record<string, string> = {
  in: 'INR',
  us: 'USD',
  gb: 'GBP',
  au: 'AUD',
  ca: 'CAD',
  de: 'EUR',
  fr: 'EUR',
  it: 'EUR',
  es: 'EUR',
  nl: 'EUR',
  sg: 'SGD',
  za: 'ZAR',
};

export function inferCountryFromLocation(location: string): {
  country: string;
  currency: string;
} {
  const l = (location ?? '').toLowerCase();
  // Very lightweight geo classifier — enough for the top-of-market
  // signal Adzuna needs. Users can pass location as "Bangalore" and
  // we default to India; "Remote — US" defaults to US; unknown → India
  // since that's our primary market.
  if (/\b(india|bangalore|bengaluru|mumbai|delhi|pune|hyderabad|chennai|noida|gurugram|gurgaon|kolkata|ahmedabad)\b/.test(l)) {
    return { country: 'in', currency: 'INR' };
  }
  if (/\b(united kingdom|london|manchester|edinburgh|uk|gb)\b/.test(l)) {
    return { country: 'gb', currency: 'GBP' };
  }
  if (/\b(united states|usa|us|new york|san francisco|seattle|austin|boston|remote.+us)\b/.test(l)) {
    return { country: 'us', currency: 'USD' };
  }
  if (/\b(singapore|sg)\b/.test(l)) {
    return { country: 'sg', currency: 'SGD' };
  }
  if (/\b(canada|toronto|vancouver|ca)\b/.test(l)) {
    return { country: 'ca', currency: 'CAD' };
  }
  if (/\b(australia|sydney|melbourne|au)\b/.test(l)) {
    return { country: 'au', currency: 'AUD' };
  }
  // Default to India — Relaunch's primary user base.
  return { country: 'in', currency: 'INR' };
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

  const { country, currency } = inferCountryFromLocation(input.location);
  const params = new URLSearchParams({
    app_id: cfg.ADZUNA_APP_ID,
    app_key: cfg.ADZUNA_APP_KEY,
    what: input.jobTitle,
    where: input.location,
    content_type: 'application/json',
  });

  const url = `https://api.adzuna.com/v1/api/jobs/${country}/histogram?${params}`;

  let data: { histogram?: Record<string, number> };
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(10000),
      next: { revalidate: 3600 }, // cache 1h at the edge — histogram doesn't churn
    });
    if (!res.ok) {
      throw new Error(`Adzuna ${res.status}`);
    }
    data = await res.json();
  } catch (err) {
    console.error('[adzuna-salary] fetch failed', err);
    throw new Error("Couldn't reach the salary data source. Try again in a moment.");
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

  return { histogram, totalVacancies, country, currency };
}
