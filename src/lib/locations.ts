/**
 * Canonical location options for the preferences picker.
 *
 * Why this exists: free-text input ("Bangalore", "BLR", "Bengaluru, India")
 * led to brittle matching across job APIs that all expect different
 * conventions. With a curated list:
 *  - the user picks from real options that we know all four job providers
 *    handle correctly
 *  - we expand each pick to all common spellings, so a job posted as
 *    "Bangalore, KA" still matches when the user selected "Bengaluru"
 *  - we know the right country code to send to JSearch (RapidAPI)
 *
 * Adding a city: copy a row, set the matchTerms to include every
 * spelling/abbreviation the job boards use.
 */

export interface LocationOption {
  id: string;          // canonical, URL-safe — used as form value
  label: string;       // human-facing, with country
  region: string;      // for grouping in the picker UI
  country: string;     // two-letter ISO code (JSearch param)
  isRemote?: boolean;
  /** All spellings we want to substring-match against a JD's location string */
  matchTerms: string[];
}

export const LOCATION_OPTIONS: LocationOption[] = [
  // ----------- India -----------
  { id: 'bengaluru',   label: 'Bengaluru',         region: 'India', country: 'in', matchTerms: ['Bengaluru', 'Bangalore', 'BLR'] },
  { id: 'mumbai',      label: 'Mumbai',            region: 'India', country: 'in', matchTerms: ['Mumbai', 'Bombay', 'BOM'] },
  { id: 'delhi-ncr',   label: 'Delhi NCR',         region: 'India', country: 'in', matchTerms: ['Delhi', 'New Delhi', 'NCR', 'Gurgaon', 'Gurugram', 'Noida'] },
  { id: 'hyderabad',   label: 'Hyderabad',         region: 'India', country: 'in', matchTerms: ['Hyderabad', 'HYD', 'Cyberabad'] },
  { id: 'pune',        label: 'Pune',              region: 'India', country: 'in', matchTerms: ['Pune', 'Poona'] },
  { id: 'chennai',     label: 'Chennai',           region: 'India', country: 'in', matchTerms: ['Chennai', 'Madras'] },
  { id: 'kolkata',     label: 'Kolkata',           region: 'India', country: 'in', matchTerms: ['Kolkata', 'Calcutta'] },
  { id: 'ahmedabad',   label: 'Ahmedabad',         region: 'India', country: 'in', matchTerms: ['Ahmedabad'] },
  { id: 'remote-in',   label: 'Remote (India)',    region: 'India', country: 'in', isRemote: true, matchTerms: ['Remote', 'Anywhere', 'India Remote', 'WFH'] },

  // ----------- United States -----------
  { id: 'sf-bay',      label: 'San Francisco Bay Area', region: 'United States', country: 'us', matchTerms: ['San Francisco', 'SF', 'Bay Area', 'Palo Alto', 'Mountain View', 'San Jose', 'Sunnyvale', 'Oakland'] },
  { id: 'new-york',    label: 'New York City',     region: 'United States', country: 'us', matchTerms: ['New York', 'NYC', 'Manhattan', 'Brooklyn'] },
  { id: 'seattle',     label: 'Seattle',           region: 'United States', country: 'us', matchTerms: ['Seattle', 'Bellevue', 'Redmond'] },
  { id: 'austin',      label: 'Austin',            region: 'United States', country: 'us', matchTerms: ['Austin'] },
  { id: 'boston',      label: 'Boston',            region: 'United States', country: 'us', matchTerms: ['Boston', 'Cambridge MA'] },
  { id: 'los-angeles', label: 'Los Angeles',       region: 'United States', country: 'us', matchTerms: ['Los Angeles', 'LA', 'Santa Monica'] },
  { id: 'chicago',     label: 'Chicago',           region: 'United States', country: 'us', matchTerms: ['Chicago'] },
  { id: 'remote-us',   label: 'Remote (US)',       region: 'United States', country: 'us', isRemote: true, matchTerms: ['Remote', 'US Remote', 'Remote, USA'] },

  // ----------- UK / EU -----------
  { id: 'london',      label: 'London',            region: 'UK & Europe', country: 'gb', matchTerms: ['London'] },
  { id: 'berlin',      label: 'Berlin',            region: 'UK & Europe', country: 'de', matchTerms: ['Berlin'] },
  { id: 'amsterdam',   label: 'Amsterdam',         region: 'UK & Europe', country: 'nl', matchTerms: ['Amsterdam'] },
  { id: 'dublin',      label: 'Dublin',            region: 'UK & Europe', country: 'ie', matchTerms: ['Dublin'] },
  { id: 'paris',       label: 'Paris',             region: 'UK & Europe', country: 'fr', matchTerms: ['Paris'] },
  { id: 'remote-eu',   label: 'Remote (Europe)',   region: 'UK & Europe', country: 'gb', isRemote: true, matchTerms: ['Remote Europe', 'EU Remote', 'EMEA Remote'] },

  // ----------- APAC / Other -----------
  { id: 'singapore',   label: 'Singapore',         region: 'APAC',  country: 'sg', matchTerms: ['Singapore'] },
  { id: 'sydney',      label: 'Sydney',            region: 'APAC',  country: 'au', matchTerms: ['Sydney'] },
  { id: 'tokyo',       label: 'Tokyo',             region: 'APAC',  country: 'jp', matchTerms: ['Tokyo'] },
  { id: 'dubai',       label: 'Dubai',             region: 'APAC',  country: 'ae', matchTerms: ['Dubai', 'UAE'] },
  { id: 'toronto',     label: 'Toronto',           region: 'APAC',  country: 'ca', matchTerms: ['Toronto'] },

  // ----------- Global -----------
  { id: 'remote-global', label: 'Remote (worldwide)', region: 'Anywhere', country: 'us', isRemote: true, matchTerms: ['Remote', 'Anywhere', 'Global Remote', 'Fully Remote'] },
];

/**
 * Group options by region for the picker UI.
 * Order of regions is preserved here.
 */
export function locationsByRegion(): { region: string; options: LocationOption[] }[] {
  const regions = ['India', 'United States', 'UK & Europe', 'APAC', 'Anywhere'];
  return regions.map((region) => ({
    region,
    options: LOCATION_OPTIONS.filter((o) => o.region === region),
  }));
}

/**
 * Look up an option by id. Returns undefined for ids we don't know.
 */
export function findLocation(id: string): LocationOption | undefined {
  return LOCATION_OPTIONS.find((o) => o.id === id);
}

/**
 * Given the user's selected location ids, expand to a flat array of
 * match terms — what gets stored in users.locations. The job matcher
 * uses substring match on these against each job's location field.
 */
export function expandToMatchTerms(selectedIds: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of selectedIds) {
    const opt = findLocation(id);
    if (!opt) continue;
    for (const term of opt.matchTerms) {
      const key = term.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        out.push(term);
      }
    }
  }
  return out;
}

/**
 * Reverse mapping — given the user's saved match terms (or labels),
 * figure out which option ids were originally selected. Used by the
 * picker to render the current state. Lossy but good enough.
 */
export function detectSelectedIds(savedLocations: string[]): string[] {
  if (!savedLocations.length) return [];
  const lower = savedLocations.map((l) => l.toLowerCase());
  const ids: string[] = [];
  for (const opt of LOCATION_OPTIONS) {
    if (opt.matchTerms.some((t) => lower.includes(t.toLowerCase()))) {
      ids.push(opt.id);
    }
  }
  return ids;
}
