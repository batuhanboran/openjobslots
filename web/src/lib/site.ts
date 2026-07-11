// Site-wide constants for the OpenJobSlots (Brave-skinned) frontend.

export const APP_VERSION = "3.0.0";

export const REPO_URL = "https://github.com/batuhanboran/openjobslots";
export const LINKEDIN_URL = "https://www.linkedin.com/in/batuhan-boran-320b311b7/";

// Wordmark segments — three purple tones per OpenJobSlots brand.
export const WORDMARK_SEGMENTS = [
  { text: "open", varName: "--wordmark-open" },
  { text: "job", varName: "--wordmark-job" },
  { text: "slots", varName: "--wordmark-slots" },
] as const;

export type ThemeMode = "light" | "dark" | "system";

// Quick-settings: search region. Default is worldwide ("all") so the global
// board is never silently narrowed; a filter is sent to the API only when the
// user explicitly picks one. Backend expects continent names on `regions` and
// FULL country names on `countries` (verified against /postings/filter-options).
export interface RegionOption {
  value: string;
  labelKey: string; // i18n key (translated at render)
  regions?: string; // backend `regions` param (continent)
  countries?: string; // backend `countries` param (full country name)
}

export const REGION_OPTIONS: RegionOption[] = [
  { value: "all", labelKey: "region.all" },
  { value: "na", labelKey: "region.na", regions: "North America" },
  { value: "emea", labelKey: "region.emea", regions: "EMEA" },
  { value: "apac", labelKey: "region.apac", regions: "APAC" },
  { value: "latam", labelKey: "region.latam", regions: "LATAM" },
  { value: "us", labelKey: "region.us", countries: "United States" },
  { value: "uk", labelKey: "region.uk", countries: "United Kingdom" },
  { value: "de", labelKey: "region.de", countries: "Germany" },
  { value: "ca", labelKey: "region.ca", countries: "Canada" },
  { value: "in", labelKey: "region.in", countries: "India" },
];

/** Map a quick-settings region value to the backend filter params. */
export function resolveRegionFilter(value: string | undefined): {
  regions?: string;
  countries?: string;
} {
  const opt = REGION_OPTIONS.find((o) => o.value === value);
  if (!opt) return {};
  const out: { regions?: string; countries?: string } = {};
  if (opt.regions) out.regions = opt.regions;
  if (opt.countries) out.countries = opt.countries;
  return out;
}
