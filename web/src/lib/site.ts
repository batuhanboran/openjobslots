// Site-wide constants for the OpenJobSlots (Brave-skinned) frontend.

export const APP_VERSION = "3.0.0";
export const VERSION_LABEL = `Genel v${APP_VERSION}`;

export const REPO_URL = "https://github.com/batuhanboran/openjobslots";
export const LINKEDIN_URL = "https://www.linkedin.com/in/batuhan-boran-320b311b7/";

// Wordmark segments — three purple tones per OpenJobSlots brand.
export const WORDMARK_SEGMENTS = [
  { text: "open", varName: "--wordmark-open" },
  { text: "job", varName: "--wordmark-job" },
  { text: "slots", varName: "--wordmark-slots" },
] as const;

export type ThemeMode = "light" | "dark" | "system";

// Quick-settings: display languages (cosmetic preference store).
export const LANGUAGE_OPTIONS = [
  { value: "tr", label: "Türkçe" },
  { value: "en", label: "English" },
  { value: "de", label: "Deutsch" },
  { value: "fr", label: "Français" },
  { value: "es", label: "Español" },
  { value: "pt", label: "Português" },
  { value: "it", label: "Italiano" },
  { value: "nl", label: "Nederlands" },
  { value: "pl", label: "Polski" },
  { value: "ja", label: "日本語" },
  { value: "ko", label: "한국어" },
  { value: "zh", label: "中文" },
] as const;

// Quick-settings: search region. Default is worldwide ("all") so the global
// board is never silently narrowed; a filter is sent to the API only when the
// user explicitly picks one. Backend expects continent names on `regions` and
// FULL country names on `countries` (verified against /postings/filter-options).
export interface RegionOption {
  value: string;
  label: string;
  regions?: string; // backend `regions` param (continent)
  countries?: string; // backend `countries` param (full country name)
}

export const REGION_OPTIONS: RegionOption[] = [
  { value: "all", label: "Tüm bölgeler" },
  { value: "na", label: "Kuzey Amerika", regions: "North America" },
  { value: "emea", label: "EMEA (Avrupa · Orta Doğu · Afrika)", regions: "EMEA" },
  { value: "apac", label: "APAC (Asya-Pasifik)", regions: "APAC" },
  { value: "latam", label: "LATAM (Latin Amerika)", regions: "LATAM" },
  { value: "us", label: "Amerika Birleşik Devletleri", countries: "United States" },
  { value: "uk", label: "Birleşik Krallık", countries: "United Kingdom" },
  { value: "de", label: "Almanya", countries: "Germany" },
  { value: "ca", label: "Kanada", countries: "Canada" },
  { value: "in", label: "Hindistan", countries: "India" },
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
