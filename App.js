import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Keyboard,
  Linking,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  StatusBar,
  Switch,
  Text,
  TextInput,
  useWindowDimensions,
  View
} from "react-native";
import appMetadata from "./app.json";
import packageMetadata from "./package.json";
import {
  blockCompany,
  createApplication,
  deleteApplication,
  fetchApplications,
  fetchBlockedCompanies,
  fetchMcpCandidates,
  fetchMcpSettings,
  fetchPostingFilterOptions,
  fetchPersonalInformation,
  fetchPostings,
  fetchPopularSearches,
  fetchPublicPreferences,
  fetchSearchSuggestions,
  postFrontendLog,
  fetchSyncServiceSettings,
  fetchSyncStatus,
  ignorePosting,
  migrateDatabaseSettings,
  saveMcpSettings,
  savePersonalInformation,
  saveSyncServiceSettings,
  startSync,
  stopSync,
  unblockCompany,
  updateApplicationStatus
} from "./src/api";
import {
  trackPublicApplyClick,
  trackPublicFilterChange,
  trackPublicSearch
} from "./src/publicAnalytics";
import { isNativeStorePlatform } from "./src/mobile/publicSurface";
import {
  createDefaultPostingsFilters,
  getPostingsFiltersSignature
} from "./src/postingsFilters";
import {
  buildPublicStatsChips,
  formatExactNumberLabel
} from "./src/publicStatsCore";
import {
  getPublicSeoCountryFallbackQueries,
  getPublicSeoPopularSearchItems,
  getPublicSeoRouteLabel,
  getPublicSeoRouteHintByPath
} from "./src/publicSeoRoutes";

const PAGE_KEYS = {
  POSTINGS: "postings",
  APPLICATIONS: "applications",
  SETTINGS_APPLICANTEE: "settings_applicantee_information",
  SETTINGS_SYNC: "settings_sync",
  SETTINGS_MCP: "settings_mcp"
};

const PAGE_TITLES = {
  [PAGE_KEYS.POSTINGS]: "Job slots",
  [PAGE_KEYS.APPLICATIONS]: "Applications",
  [PAGE_KEYS.SETTINGS_APPLICANTEE]: "Settings / Applicantee Information",
  [PAGE_KEYS.SETTINGS_SYNC]: "Settings / Sync Settings",
  [PAGE_KEYS.SETTINGS_MCP]: "Settings / MCP Settings"
};
const APPLICATION_STATUS_OPTIONS = [
  "applied",
  "interview scheduled",
  "awaiting response",
  "offer received",
  "withdrawn",
  "denied"
];
const DEFAULT_SYNC_INTERVAL_SECONDS = 3600;
const FRONTEND_POSTINGS_PAGE_SIZE = 80;
const FRONTEND_POSTINGS_PREFETCH_DISTANCE_PX = 720;
const MIN_SYNC_INTERVAL_SECONDS = 60;
const MAX_SYNC_INTERVAL_SECONDS = 24 * 60 * 60;
const DEFAULT_ATS_REQUEST_QUEUE_CONCURRENCY = 1;
const MIN_ATS_REQUEST_QUEUE_CONCURRENCY = 1;
const MAX_ATS_REQUEST_QUEUE_CONCURRENCY = 20;
const SEARCH_SUGGESTION_CACHE_TTL_MS = 5 * 60 * 1000;
const SEARCH_SUGGESTION_DEBOUNCE_MS = 700;
const SEARCH_SUGGESTION_LIMIT = 4;
const SEARCH_INTENT_CHIP_LIMIT = 4;
const SEARCH_SUBMIT_DEDUPE_MS = 2500;
const AUTO_SEARCH_DEBOUNCE_MS = 1800;

function readPublicCountOverride(key) {
  const value = typeof process !== "undefined" ? process?.env?.[key] : undefined;
  const numberValue = Number(value);
  return Number.isFinite(numberValue) && numberValue > 0 ? numberValue : null;
}

const PUBLIC_STATS_OVERRIDE = {
  job_slot_count: readPublicCountOverride("EXPO_PUBLIC_OPENJOBSLOTS_JOB_SLOT_COUNT"),
  posting_count: readPublicCountOverride("EXPO_PUBLIC_OPENJOBSLOTS_JOB_SLOT_COUNT"),
  configured_ats_count: readPublicCountOverride("EXPO_PUBLIC_OPENJOBSLOTS_ATS_COUNT"),
  visible_company_count: readPublicCountOverride("EXPO_PUBLIC_OPENJOBSLOTS_COMPANY_COUNT")
};

function hasPublicStatsOverride() {
  return Object.values(PUBLIC_STATS_OVERRIDE).some((value) => Number(value) > 0);
}

function applyPublicStatsOverride(status = {}) {
  if (!hasPublicStatsOverride()) return status || {};
  const source = status || {};
  return {
    ...source,
    ...Object.fromEntries(
      Object.entries(PUBLIC_STATS_OVERRIDE).filter(([, value]) => Number(value) > 0)
    )
  };
}
const SOURCE_INTELLIGENCE_LIMIT = 8;
const LOCAL_SEARCH_SHORTCUTS = [
  { type: "search", value: "remote jobs", label: "remote jobs" },
  { type: "search", value: "technical support", label: "technical support" },
  { type: "search", value: "software engineer", label: "software engineer" },
  { type: "search", value: "product manager", label: "product manager" },
  { type: "search", value: "customer support", label: "customer support" },
  { type: "country", value: "türkiye", label: "türkiye" },
  { type: "country", value: "turkiye", label: "turkiye" },
  { type: "search", value: "turkish jobs", label: "turkish jobs" }
];
const SEARCH_PLACEHOLDER_TYPE_MS = 38;
const SEARCH_PLACEHOLDER_DELETE_MS = 20;
const SEARCH_PLACEHOLDER_HOLD_MS = 700;
const SEARCH_PLACEHOLDER_NEXT_MS = 140;
const SEARCH_PLACEHOLDER_EXAMPLES = [
  "Technical Support Engineer in London",
  "Remote Software Engineer",
  "Product Manager in Berlin",
  "Data Analyst in Toronto",
  "Customer Success Manager remote",
  "Nurse Practitioner in New York",
  "Frontend Engineer in Amsterdam",
  "Operations Manager in Singapore"
];
const OJS_COLORS = {
  blue: "#26332D",
  accent: "#C0E1D2",
  accentSoft: "#E5EEE4",
  red: "#DC9B9B",
  yellow: "#9A6A4F",
  green: "#527D68",
  ink: "#26332D",
  text: "#33443C",
  muted: "#68756E",
  slotGray: "#68756E",
  border: "#D7DDD2",
  softBorder: "#E2E7DE",
  bg: "#F6F4E8",
  surface: "#ffffff",
  surfaceMuted: "#E5EEE4",
  hover: "#F2EDE1",
  pressed: "#C0E1D2",
  focus: "#7FBFA6",
  success: "#527D68",
  successSoft: "#E5EEE4",
  warning: "#9A6A4F",
  warningSoft: "#F6F4E8",
  danger: "#A65F5F",
  dangerSoft: "#F1DEDC",
  shadow: "#26332D"
};
const OJS_BRAND_PURPLES = {
  open: "#5F36F2",
  job: "#7C3AED",
  slots: "#A855F7",
  openDark: "#D6CCFF",
  jobDark: "#C4B5FD",
  slotsDark: "#F0ABFC"
};
const WORDMARK_SEGMENTS = [
  { text: "open", color: OJS_BRAND_PURPLES.open },
  { text: "job", color: OJS_BRAND_PURPLES.job },
  { text: "slots", color: OJS_BRAND_PURPLES.slots }
];
const OJS_DARK_COLORS = {
  bg: "#101713",
  surface: "#17221D",
  surfaceMuted: "#20352B",
  hover: "#22342C",
  text: "#D8E7DF",
  ink: "#ECF6F1",
  muted: "#B5C8BE",
  border: "#33483D",
  softBorder: "#385347",
  pressed: "#274E40",
  focus: "#8ED6B9",
  green: "#8ED6B9",
  shadow: "#050806"
};
const YAHOO_COLORS = {
  purple: OJS_BRAND_PURPLES.job,
  purpleHover: OJS_BRAND_PURPLES.open,
  purplePressed: "#4C1D95",
  blue: "#4B5DFF",
  ink: "#232A31",
  text: "#000000",
  muted: "#6E7780",
  border: "#E3E3E3",
  borderStrong: "#C7CDD2",
  surface: "#FFFFFF",
  section: "#F0F3F5",
  focusRing: "rgba(124, 58, 237, 0.2)"
};
const DARK_WORDMARK_SEGMENTS = [
  { text: "open", color: OJS_DARK_COLORS.green },
  { text: "job", color: "#BFE4D3" },
  { text: "slots", color: OJS_DARK_COLORS.muted }
];
const YAHOO_WORDMARK_SEGMENTS = [
  { text: "open", color: OJS_BRAND_PURPLES.open },
  { text: "job", color: OJS_BRAND_PURPLES.job },
  { text: "slots", color: OJS_BRAND_PURPLES.slots }
];
const YAHOO_WORDMARK_SEGMENTS_DARK = [
  { text: "open", color: OJS_BRAND_PURPLES.openDark },
  { text: "job", color: OJS_BRAND_PURPLES.jobDark },
  { text: "slots", color: OJS_BRAND_PURPLES.slotsDark }
];
const OJS_FONT_STACK = Platform.OS === "web"
  ? "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
  : undefined;
const YAHOO_FONT_STACK = Platform.OS === "web"
  ? "'SF Pro Display', 'Geist Sans', 'Helvetica Neue', 'Segoe UI', system-ui, -apple-system, sans-serif"
  : undefined;
const ACCESSIBILITY_STATUS_PROPS = Platform.OS === "web"
  ? { accessibilityRole: "status" }
  : { accessibilityLiveRegion: "polite" };
const ANDROID_STATUS_BAR_OFFSET = Platform.OS === "android" ? StatusBar.currentHeight || 0 : 0;
const SEARCH_SUBMIT_BEHAVIOR_PROPS = Platform.OS === "web"
  ? { blurOnSubmit: false }
  : { blurOnSubmit: true, submitBehavior: "blurAndSubmit", showSoftInputOnFocus: true };

function dismissSearchKeyboard(inputRef) {
  if (Platform.OS !== "web") {
    const dismissInput = () => {
      inputRef?.current?.blur?.();
      Keyboard.dismiss();
    };
    dismissInput();
    setTimeout(dismissInput, 120);
    setTimeout(dismissInput, 350);
  }
}

const PUBLIC_LANGUAGE_STORAGE_KEY = "openjobslots.publicLanguage";
const PUBLIC_THEME_STORAGE_KEY = "openjobslots.publicTheme";
const PUBLIC_LANGUAGE_HINT_COOKIE = "ojs_public_language_hint";
const VISITED_POSTING_URLS_STORAGE_KEY = "openjobslots.visitedPostingUrls.v1";
const MAX_VISITED_POSTING_URLS = 1000;
const DEFAULT_PUBLIC_LANGUAGE = "en";
const PUBLIC_LANGUAGE_OPTIONS = [
  {
    code: "en",
    label: "English",
    nativeLabel: "English",
    shortLabel: "EN",
    countryCode: "US",
    flag: { type: "us", stripes: ["#B22234", "#FFFFFF", "#B22234", "#FFFFFF", "#B22234", "#FFFFFF", "#B22234"] }
  },
  {
    code: "tr",
    label: "Turkish",
    nativeLabel: "Türkçe",
    shortLabel: "TR",
    countryCode: "TR",
    flag: { type: "tr", stripes: ["#E30A17"] }
  },
  {
    code: "de",
    label: "German",
    nativeLabel: "Deutsch",
    shortLabel: "DE",
    countryCode: "DE",
    flag: { type: "horizontal", stripes: ["#111111", "#DD0000", "#FFCE00"] }
  },
  {
    code: "fr",
    label: "French",
    nativeLabel: "Français",
    shortLabel: "FR",
    countryCode: "FR",
    flag: { type: "vertical", stripes: ["#0055A4", "#FFFFFF", "#EF4135"] }
  },
  {
    code: "es",
    label: "Spanish",
    nativeLabel: "Español",
    shortLabel: "ES",
    countryCode: "ES",
    flag: { type: "horizontal", stripes: ["#AA151B", "#F1BF00", "#AA151B"] }
  },
  {
    code: "pt-BR",
    label: "Portuguese (Brazil)",
    nativeLabel: "Português (BR)",
    shortLabel: "BR",
    countryCode: "BR",
    flag: { type: "horizontal", stripes: ["#009739", "#FEDD00", "#002776"] }
  },
  {
    code: "pt-PT",
    label: "Portuguese (Portugal)",
    nativeLabel: "Português (PT)",
    shortLabel: "PT",
    countryCode: "PT",
    flag: { type: "vertical", stripes: ["#006600", "#FF0000", "#FFCC00"] }
  },
  {
    code: "it",
    label: "Italian",
    nativeLabel: "Italiano",
    shortLabel: "IT",
    countryCode: "IT",
    flag: { type: "vertical", stripes: ["#009246", "#FFFFFF", "#CE2B37"] }
  },
  {
    code: "nl",
    label: "Dutch",
    nativeLabel: "Nederlands",
    shortLabel: "NL",
    countryCode: "NL",
    flag: { type: "horizontal", stripes: ["#AE1C28", "#FFFFFF", "#21468B"] }
  },
  {
    code: "pl",
    label: "Polish",
    nativeLabel: "Polski",
    shortLabel: "PL",
    countryCode: "PL",
    flag: { type: "horizontal", stripes: ["#FFFFFF", "#DC143C"] }
  },
  {
    code: "ja",
    label: "Japanese",
    nativeLabel: "日本語",
    shortLabel: "JA",
    countryCode: "JP",
    flag: { type: "horizontal", stripes: ["#FFFFFF", "#BC002D", "#FFFFFF"] }
  },
  {
    code: "ko",
    label: "Korean",
    nativeLabel: "한국어",
    shortLabel: "KO",
    countryCode: "KR",
    flag: { type: "horizontal", stripes: ["#FFFFFF", "#CD2E3A", "#0047A0"] }
  },
  {
    code: "zh-CN",
    label: "Chinese (Simplified)",
    nativeLabel: "简体中文",
    shortLabel: "CN",
    countryCode: "CN",
    flag: { type: "horizontal", stripes: ["#DE2910", "#FFDE00", "#DE2910"] }
  },
  {
    code: "hi",
    label: "Hindi",
    nativeLabel: "हिन्दी",
    shortLabel: "HI",
    countryCode: "IN",
    flag: { type: "horizontal", stripes: ["#FF9933", "#FFFFFF", "#138808"] }
  },
  {
    code: "ar",
    label: "Arabic",
    nativeLabel: "العربية",
    shortLabel: "AR",
    countryCode: "AE",
    flag: { type: "horizontal", stripes: ["#00732F", "#FFFFFF", "#000000"] }
  },
  {
    code: "id",
    label: "Indonesian",
    nativeLabel: "Bahasa Indonesia",
    shortLabel: "ID",
    countryCode: "ID",
    flag: { type: "horizontal", stripes: ["#CE1126", "#FFFFFF"] }
  },
  {
    code: "sv",
    label: "Swedish",
    nativeLabel: "Svenska",
    shortLabel: "SV",
    countryCode: "SE",
    flag: { type: "horizontal", stripes: ["#006AA7", "#FECC00", "#006AA7"] }
  },
  {
    code: "da",
    label: "Danish",
    nativeLabel: "Dansk",
    shortLabel: "DA",
    countryCode: "DK",
    flag: { type: "horizontal", stripes: ["#C60C30", "#FFFFFF", "#C60C30"] }
  },
  {
    code: "no",
    label: "Norwegian",
    nativeLabel: "Norsk",
    shortLabel: "NO",
    countryCode: "NO",
    flag: { type: "horizontal", stripes: ["#BA0C2F", "#FFFFFF", "#00205B"] }
  },
  {
    code: "fi",
    label: "Finnish",
    nativeLabel: "Suomi",
    shortLabel: "FI",
    countryCode: "FI",
    flag: { type: "horizontal", stripes: ["#FFFFFF", "#002F6C", "#FFFFFF"] }
  }
];
const PUBLIC_LANGUAGE_BY_CODE = new Map(PUBLIC_LANGUAGE_OPTIONS.map((language) => [language.code, language]));
const PUBLIC_LANGUAGE_CANONICAL_CODE_BY_NORMALIZED = new Map(
  PUBLIC_LANGUAGE_OPTIONS.map((language) => [String(language.code).toLowerCase(), language.code])
);
const PUBLIC_LANGUAGE_PRIMARY_FALLBACK_BY_CODE = new Map([
  ["pt", "pt-BR"],
  ["zh", "zh-CN"],
  ...PUBLIC_LANGUAGE_OPTIONS
    .filter((language) => !String(language.code).includes("-"))
    .map((language) => [String(language.code).toLowerCase(), language.code])
]);
const PUBLIC_LOCALE_BY_LANGUAGE_CODE = {
  en: "en-US",
  tr: "tr-TR",
  de: "de-DE",
  fr: "fr-FR",
  es: "es-ES",
  "pt-BR": "pt-BR",
  "pt-PT": "pt-PT",
  it: "it-IT",
  nl: "nl-NL",
  pl: "pl-PL",
  ja: "ja-JP",
  ko: "ko-KR",
  "zh-CN": "zh-CN",
  hi: "hi-IN",
  ar: "ar-AE",
  id: "id-ID",
  sv: "sv-SE",
  da: "da-DK",
  no: "nb-NO",
  fi: "fi-FI"
};
const PUBLIC_MESSAGES = {
  en: {
    "results.eyebrow": "Public search",
    "results.title": "Open roles",
    "search.heroTitle": "Search open job slots",
    "search.lead": "Find fresh openings across public ATS job boards.",
    "search.label": "Search openings",
    "search.placeholder": "Search title, company, location, or country",

    "search.placeholderShort": "Search jobs or companies",
    "search.examplePrefix": "Try",
    "search.shortcut": "Enter to search · Esc to clear",
    "seo.popularSearches": "Popular searches",
    "search.clear": "Clear",
    "filters.loading": "Loading filter options...",
    "filters.show": "Filters",
    "filters.hide": "Hide filters",
    "filters.global.title": "Global search",
    "filters.global.locationTitle": "Location narrowed",
    "filters.global.copy": "Search remains worldwide until a location filter is selected.",
    "filters.global.locationCopy": "Region and country filters are active.",
    "filters.ats": "ATS",
    "filters.ats.any": "All ATS",
    "filters.industries": "Industries",
    "filters.industries.any": "Any industry",
    "filters.regions": "Regions",
    "filters.regions.any": "Worldwide",
    "filters.countries": "Countries",
    "filters.countries.any": "All countries",
    "filters.states": "States",
    "filters.states.any": "All states/provinces",
    "filters.counties": "Counties",
    "filters.counties.any": "All counties",
    "filters.industries.empty": "No industries available.",
    "filters.industries.helper": "Optional. Leave empty to search every indexed industry.",
    "filters.regions.empty": "Worldwide search is active. Region metadata is not indexed yet.",
    "filters.regions.helper": "Start broad by continent, then narrow to countries when useful.",
    "filters.countries.emptyRegion": "No countries match the selected region yet. Clear Regions to search worldwide.",
    "filters.countries.empty": "No countries match. Worldwide search is still active.",
    "filters.countries.helperRegion": "Countries are limited by the selected region.",
    "filters.countries.helper": "Leave empty to include every country.",
    "filters.states.empty": "No states or provinces are indexed for the selected countries.",
    "filters.states.helper": "Shown after country selection. Leave empty to include all states/provinces.",
    "filters.counties.empty": "No counties match selected states.",
    "filters.counties.helper": "Shown after state selection for sources that include county metadata.",
    "filters.countryHint": "Choose a country to narrow by state or province.",
    "filters.stateHint": "Choose a state/province to narrow by county when county data exists.",
    "freshness.label": "Freshness",
    "freshness.all": "Any date",
    "freshness.3": "3 days",
    "freshness.7": "7 days",
    "freshness.30": "30 days",
    "remote.label": "Remote Filter",
    "remote.all": "All Locations",
    "remote.allShort": "Any",
    "remote.remote": "Remote Only",
    "remote.remoteShort": "Remote",
    "remote.hybrid": "Hybrid Only",
    "remote.hybridShort": "Hybrid",
    "remote.nonRemote": "On-Site / Unknown",
    "remote.nonRemoteShort": "On-site",
    "remote.hideNoDate": "Hide postings with no date",
    "sources.title": "Sources in results",
    "sources.empty": "Run a search to see sources in the current result set.",
    "results.search": "Search",
    "results.toSeeSlots": "to see slots",
    "results.searchPrompt": "Search jobs",
    "results.slot": "slot",
    "results.slots": "slots",
    "results.slotIndexed": "job slot",
    "results.slotsIndexed": "job slots",
    "results.indexLoading": "Loading index",
    "initial.title": "Search fresh public ATS openings.",
    "initial.copy": "Start with a title, company, location, country, or work mode. Filters stay pinned beside the results on desktop.",
    "sort.relevance": "Relevance",
    "sort.last_seen": "Fresh source",
    "sort.posted_date": "Posted date",
    "sort.ats_source": "ATS/source",
    "sort.confidence": "Confidence",
    "theme.day": "Light",
    "theme.night": "Dark",
    "language.label": "Language",
    "version.label": "Public v{version}",
    "credit.deployed": "Deployed and developed by",
    "release.title": "Release notes",
    "release.close": "Close",
    "release.closeA11y": "Close release notes",
    "release.historyLabel": "Release notes history",
    "release.openA11y": "Open release notes for version {version}",
    "release.versionLabel": "Version {version}",
    "release.genericTitle": "Public search update",
    "release.genericSummary": "This release improved public search, data quality, coverage, and production reliability.",
    "stats.jobSlots": "job slots",
    "stats.ats": "ATS",
    "stats.companies": "companies",
    "suggestion.search": "Search",
    "suggestion.title": "Title",
    "suggestion.company": "Company",
    "suggestion.location": "Location",
    "suggestion.country": "Country",
    "suggestion.region": "Region",
    "suggestion.industry": "Industry",
    "suggestion.recent": "Recent",
    "suggestion.ats": "ATS",
    "dropdown.search": "Search {label}",
    "dropdown.empty": "{label} are not indexed yet. Worldwide search is still active.",
    "dropdown.noMatch": "No {label} match \"{search}\".",
    "dropdown.showing": "Showing {visible} of {total} {label}.",
    "dropdown.clear": "Clear {label}",
    "sources.result": "result",
    "sources.results": "results",
    "sources.confidence": "Conf",
    "sources.quality": "Quality",
    "sources.freshSeen": "{fresh}% fresh - seen {date}",
    "sources.currentSet": "{fresh}% fresh - current set",
    "search.intentDetected": "Detected intent",
    "posting.atsLabel": "ATS",
    "posting.dateUnavailable": "Posting date unavailable",
    "empty.noSlotsExact": "No slots match this exact search.",
    "empty.tryDifferent": "Try another title, source, location, or freshness window.",
    "empty.searchAllLocations": "Search all locations",
    "empty.allWorkModes": "All work modes",
    "empty.clearFilters": "Clear filters",
    "results.updating": "Updating visible results...",
    "results.showingOf": "Showing {visible} of {total} slots",
    "results.loadingMore": "Loading more slots...",
    "results.scrollMore": "Scroll to load more",
    "results.allLoaded": "All visible slots loaded"
  },
  tr: {
    "results.eyebrow": "Genel arama",
    "results.title": "Açık roller",
    "search.heroTitle": "Açık iş ilanlarını ara",
    "search.lead": "Herkese açık ATS iş panolarındaki güncel ilanları bul.",
    "search.label": "İlan ara",
    "search.placeholder": "Ünvan, şirket, konum veya ülke ara",

    "search.placeholderShort": "İş veya şirket ara",
    "search.examplePrefix": "Orn.",
    "search.shortcut": "Aramak için Enter · Temizlemek için Esc",
    "seo.popularSearches": "Popüler aramalar",
    "search.clear": "Temizle",
    "filters.loading": "Filtreler yükleniyor...",
    "filters.show": "Filtreler",
    "filters.hide": "Filtreleri gizle",
    "filters.global.title": "Global arama",
    "filters.global.locationTitle": "Konum daraltıldı",
    "filters.global.copy": "Bölge, ülke veya çalışma modu seçilene kadar arama global kalır.",
    "filters.global.locationCopy": "Bölge ve ülke filtreleri aktif.",
    "filters.ats": "ATS",
    "filters.ats.any": "Tüm ATS",
    "filters.industries": "Sektörler",
    "filters.industries.any": "Tüm sektörler",
    "filters.regions": "Bölgeler",
    "filters.regions.any": "Dünya geneli",
    "filters.countries": "Ülkeler",
    "filters.countries.any": "Tüm ülkeler",
    "filters.states": "Eyaletler",
    "filters.states.any": "Tüm eyaletler",
    "filters.counties": "İlçeler",
    "filters.counties.any": "Tüm ilçeler",
    "filters.industries.empty": "Uygun sektör yok.",
    "filters.industries.helper": "İsteğe bağlı. Tüm indekslenmiş sektörlerde aramak için boş bırak.",
    "filters.regions.empty": "Dünya geneli arama aktif. Bölge metadatası henüz indekslenmedi.",
    "filters.regions.helper": "Geniş başla, gerekiyorsa ülkeye daralt.",
    "filters.countries.emptyRegion": "Seçilen bölgeyle eşleşen ülke yok. Dünya geneli aramak için Bölgeleri temizle.",
    "filters.countries.empty": "Eşleşen ülke yok. Dünya geneli arama aktif kalır.",
    "filters.countries.helperRegion": "Ülkeler seçilen bölgeye göre sınırlı.",
    "filters.countries.helper": "Tüm ülkeleri dahil etmek için boş bırak.",
    "filters.states.empty": "Seçilen ülkeler için eyalet veya bölge indekslenmedi.",
    "filters.states.helper": "Ülke seçildikten sonra görünür. Tüm eyalet/bölgeleri dahil etmek için boş bırak.",
    "filters.counties.empty": "Seçilen eyaletlerle eşleşen ilçe yok.",
    "filters.counties.helper": "İlçe metadatası olan kaynaklarda eyalet seçiminden sonra görünür.",
    "filters.countryHint": "Eyalet veya bölge kırılımı için önce ülke seç.",
    "filters.stateHint": "Varsa ilçe kırılımı için eyalet/bölge seç.",
    "freshness.label": "Güncellik",
    "freshness.all": "Tümü",
    "freshness.3": "3 gün",
    "freshness.7": "7 gün",
    "freshness.30": "30 gün",
    "remote.label": "Çalışma modu",
    "remote.all": "Tüm konumlar",
    "remote.allShort": "Tümü",
    "remote.remote": "Sadece remote",
    "remote.remoteShort": "Remote",
    "remote.hybrid": "Sadece hibrit",
    "remote.hybridShort": "Hibrit",
    "remote.nonRemote": "Ofis / belirsiz",
    "remote.nonRemoteShort": "Ofis",
    "remote.hideNoDate": "Tarihi olmayan ilanları gizle",
    "sources.title": "Sonuçlardaki kaynaklar",
    "sources.empty": "Bu sonuç setindeki kaynakları görmek için arama yap.",
    "results.search": "Ara",
    "results.toSeeSlots": "slotları gör",
    "results.searchPrompt": "İlan ara",
    "results.slot": "ilan",
    "results.slots": "ilan",
    "results.slotIndexed": "is ilani",
    "results.slotsIndexed": "is ilani",
    "results.indexLoading": "Indeks yukleniyor",
    "initial.title": "Taze public ATS ilanlarını ara.",
    "initial.copy": "Ünvan, şirket, konum, ülke veya çalışma modu ile başla. Filtreler desktop görünümde sonuçların yanında sabit kalır.",
    "sort.relevance": "Alaka",
    "sort.last_seen": "Taze kaynak",
    "sort.posted_date": "İlan tarihi",
    "sort.ats_source": "ATS/kaynak",
    "sort.confidence": "Güven",
    "theme.day": "Gündüz",
    "theme.night": "Gece",
    "language.label": "Dil",
    "version.label": "Genel v{version}",
    "credit.deployed": "Yayına alan ve geliştiren",
    "release.title": "Sürüm notları",
    "release.close": "Kapat",
    "release.closeA11y": "Sürüm notlarını kapat",
    "release.historyLabel": "Sürüm notları geçmişi",
    "release.openA11y": "{version} sürümü için sürüm notlarını aç",
    "release.versionLabel": "Sürüm {version}",
    "release.genericTitle": "Genel arama güncellemesi",
    "release.genericSummary": "Bu sürüm genel arama deneyimini, veri kalitesini, kapsamı ve üretim güvenilirliğini iyileştirdi.",
    "stats.jobSlots": "iş ilanı",
    "stats.ats": "ATS",
    "stats.companies": "şirket",
    "suggestion.search": "Arama",
    "suggestion.title": "Ünvan",
    "suggestion.company": "Şirket",
    "suggestion.location": "Konum",
    "suggestion.country": "Ülke",
    "suggestion.region": "Bölge",
    "suggestion.industry": "Sektör",
    "suggestion.recent": "Son arama",
    "suggestion.ats": "ATS",
    "dropdown.search": "{label} ara",
    "dropdown.empty": "{label} henuz indekslenmedi. Global arama aktif kalir.",
    "dropdown.noMatch": "\"{search}\" icin {label} eslesmesi yok.",
    "dropdown.showing": "{total} {label} icinde {visible} gosteriliyor.",
    "dropdown.clear": "{label} temizle",
    "sources.result": "sonuc",
    "sources.results": "sonuc",
    "sources.confidence": "Guven",
    "sources.quality": "Kalite",
    "sources.freshSeen": "%{fresh} guncel - son gorulme {date}",
    "sources.currentSet": "%{fresh} guncel - mevcut set",
    "search.intentDetected": "Algilanan niyet",
    "posting.atsLabel": "ATS",
    "posting.dateUnavailable": "Ilan tarihi yok",
    "empty.noSlotsExact": "Bu aramayla eslesen ilan yok.",
    "empty.tryDifferent": "Baska bir unvan, kaynak, konum veya guncellik araligi dene.",
    "empty.searchAllLocations": "Tum konumlarda ara",
    "empty.allWorkModes": "Tum calisma modlari",
    "empty.clearFilters": "Filtreleri temizle",
    "results.updating": "Görünen sonuçlar güncelleniyor...",
    "results.showingOf": "{visible} / {total} ilan gosteriliyor",
    "results.loadingMore": "Daha fazla ilan yukleniyor...",
    "results.scrollMore": "Daha fazlasi icin kaydir",
    "results.allLoaded": "Gorunen tum ilanlar yuklendi"
  },
  de: {
    "results.eyebrow": "Öffentliche Suche",
    "results.title": "Offene Rollen",
    "search.heroTitle": "Offene Jobslots suchen",
    "search.lead": "Finde aktuelle Stellen auf öffentlichen ATS-Jobbörsen.",
    "search.label": "Stellen suchen",
    "search.placeholder": "Titel, Firma, Ort oder Land suchen",

    "search.placeholderShort": "Jobs oder Firmen suchen",
    "search.examplePrefix": "Beispiel",
    "search.shortcut": "Enter zum Suchen · Esc zum Leeren",
    "seo.popularSearches": "Beliebte Suchen",
    "search.clear": "Leeren",
    "filters.loading": "Filter werden geladen...",
    "filters.show": "Filter",
    "filters.hide": "Filter ausblenden",
    "filters.global.title": "Globale Suche",
    "filters.global.locationTitle": "Standort eingegrenzt",
    "filters.global.copy": "Die Suche bleibt weltweit, bis ein Standortfilter aktiv ist.",
    "filters.global.locationCopy": "Region- und Landfilter sind aktiv.",
    "filters.ats": "ATS",
    "filters.ats.any": "Alle ATS",
    "filters.industries": "Branchen",
    "filters.industries.any": "Alle Branchen",
    "filters.regions": "Regionen",
    "filters.regions.any": "Weltweit",
    "filters.countries": "Länder",
    "filters.countries.any": "Alle Länder",
    "filters.states": "Bundesländer",
    "filters.states.any": "Alle Bundesländer",
    "filters.counties": "Kreise",
    "filters.counties.any": "Alle Kreise",
    "filters.industries.empty": "Keine Branchen verfügbar.",
    "filters.industries.helper": "Optional. Leer lassen, um alle indizierten Branchen zu durchsuchen.",
    "filters.regions.empty": "Die weltweite Suche ist aktiv. Regionsdaten sind noch nicht indiziert.",
    "filters.regions.helper": "Breit nach Kontinent starten und bei Bedarf auf Länder eingrenzen.",
    "filters.countries.emptyRegion": "Keine Länder passen zur ausgewählten Region. Regionen löschen, um weltweit zu suchen.",
    "filters.countries.empty": "Keine Länder passen. Die weltweite Suche bleibt aktiv.",
    "filters.countries.helperRegion": "Länder sind durch die ausgewählte Region begrenzt.",
    "filters.countries.helper": "Leer lassen, um jedes Land einzubeziehen.",
    "filters.states.empty": "Für die ausgewählten Länder sind keine Staaten oder Provinzen indiziert.",
    "filters.states.helper": "Wird nach der Länderauswahl angezeigt. Leer lassen, um alle Staaten/Provinzen einzubeziehen.",
    "filters.counties.empty": "Keine Kreise passen zu den ausgewählten Staaten.",
    "filters.counties.helper": "Wird nach der Staatsauswahl für Quellen mit Kreisdaten angezeigt.",
    "filters.countryHint": "Wähle ein Land, um nach Bundesland oder Region zu filtern.",
    "filters.stateHint": "Wähle eine Region, um vorhandene Kreis-Daten zu nutzen.",
    "freshness.label": "Aktualität",
    "freshness.all": "Alle",
    "freshness.3": "3 Tage",
    "freshness.7": "7 Tage",
    "freshness.30": "30 Tage",
    "remote.label": "Arbeitsmodus",
    "remote.all": "Alle Standorte",
    "remote.allShort": "Alle",
    "remote.remote": "Nur Remote",
    "remote.remoteShort": "Remote",
    "remote.hybrid": "Nur Hybrid",
    "remote.hybridShort": "Hybrid",
    "remote.nonRemote": "Vor Ort / unklar",
    "remote.nonRemoteShort": "Vor Ort",
    "remote.hideNoDate": "Postings ohne Datum ausblenden",
    "sources.title": "Quellen in Ergebnissen",
    "sources.empty": "Starte eine Suche, um Quellen im Ergebnis zu sehen.",
    "results.search": "Suchen",
    "results.toSeeSlots": "Slots anzeigen",
    "results.searchPrompt": "Stellen suchen",
    "results.slot": "Slot",
    "results.slots": "Slots",
    "results.slotIndexed": "Jobslot",
    "results.slotsIndexed": "Jobslots",
    "results.indexLoading": "Index wird geladen",
    "initial.title": "Aktuelle öffentliche ATS-Stellen suchen.",
    "initial.copy": "Beginne mit Titel, Firma, Ort, Land oder Arbeitsmodus. Filter bleiben am Desktop neben den Ergebnissen fixiert.",
    "sort.relevance": "Relevanz",
    "sort.last_seen": "Frische Quelle",
    "sort.posted_date": "Veröffentlicht",
    "sort.ats_source": "ATS/Quelle",
    "sort.confidence": "Vertrauen",
    "theme.day": "Tag",
    "theme.night": "Nacht",
    "language.label": "Sprache",
    "version.label": "Öffentlich v{version}",
    "credit.deployed": "Bereitgestellt und entwickelt von",
    "release.title": "Versionshinweise",
    "release.close": "Schließen",
    "release.closeA11y": "Versionshinweise schließen",
    "release.historyLabel": "Verlauf der Versionshinweise",
    "release.openA11y": "Versionshinweise für Version {version} öffnen",
    "release.versionLabel": "Version {version}",
    "release.genericTitle": "Update der öffentlichen Suche",
    "release.genericSummary": "Diese Version verbessert öffentliche Suche, Datenqualität, Abdeckung und Produktionszuverlässigkeit.",
    "stats.jobSlots": "Jobslots",
    "stats.ats": "ATS",
    "stats.companies": "Unternehmen",
    "suggestion.search": "Suche",
    "suggestion.title": "Titel",
    "suggestion.company": "Unternehmen",
    "suggestion.location": "Standort",
    "suggestion.country": "Land",
    "suggestion.region": "Region",
    "suggestion.industry": "Branche",
    "suggestion.recent": "Zuletzt",
    "suggestion.ats": "ATS",
    "dropdown.search": "{label} suchen",
    "dropdown.empty": "{label} sind noch nicht indiziert. Die weltweite Suche bleibt aktiv.",
    "dropdown.noMatch": "Keine {label} passen zu \"{search}\".",
    "dropdown.showing": "{visible} von {total} {label} angezeigt.",
    "dropdown.clear": "{label} löschen",
    "sources.result": "Ergebnis",
    "sources.results": "Ergebnisse",
    "sources.confidence": "Vertr.",
    "sources.quality": "Qualität",
    "sources.freshSeen": "{fresh}% frisch - gesehen {date}",
    "sources.currentSet": "{fresh}% frisch - aktuelles Set",
    "search.intentDetected": "Erkannte Absicht",
    "posting.atsLabel": "ATS",
    "posting.dateUnavailable": "Veröffentlichungsdatum nicht verfügbar",
    "empty.noSlotsExact": "Keine Jobslots passen genau zu dieser Suche.",
    "empty.tryDifferent": "Versuche einen anderen Titel, eine andere Quelle, einen anderen Standort oder ein anderes Aktualitätsfenster.",
    "empty.searchAllLocations": "Alle Standorte durchsuchen",
    "empty.allWorkModes": "Alle Arbeitsmodi",
    "empty.clearFilters": "Filter löschen",
    "results.updating": "Sichtbare Ergebnisse werden aktualisiert...",
    "results.showingOf": "{visible} von {total} Jobslots angezeigt",
    "results.loadingMore": "Weitere Jobslots werden geladen...",
    "results.scrollMore": "Scrollen, um mehr zu laden",
    "results.allLoaded": "Alle sichtbaren Jobslots geladen"
  },
  fr: {
    "results.eyebrow": "Recherche publique",
    "results.title": "Postes ouverts",
    "search.heroTitle": "Rechercher des postes ouverts",
    "search.lead": "Trouvez des offres récentes sur les jobboards ATS publics.",
    "search.label": "Rechercher",
    "search.placeholder": "Titre, entreprise, lieu ou pays",

    "search.placeholderShort": "Rechercher jobs ou entreprises",
    "search.examplePrefix": "Essayez",
    "search.shortcut": "Entrer pour rechercher · Esc pour vider",
    "seo.popularSearches": "Recherches populaires",
    "search.clear": "Vider",
    "filters.loading": "Chargement des filtres...",
    "filters.show": "Filtres",
    "filters.hide": "Masquer les filtres",
    "filters.global.title": "Recherche mondiale",
    "filters.global.locationTitle": "Lieu précisé",
    "filters.global.copy": "La recherche reste mondiale jusqu'au choix d'un lieu.",
    "filters.global.locationCopy": "Les filtres région et pays sont actifs.",
    "filters.ats": "ATS",
    "filters.ats.any": "Tous les ATS",
    "filters.industries": "Secteurs",
    "filters.industries.any": "Tous les secteurs",
    "filters.regions": "Régions",
    "filters.regions.any": "Monde entier",
    "filters.countries": "Pays",
    "filters.countries.any": "Tous les pays",
    "filters.states": "États/régions",
    "filters.states.any": "Tous les états",
    "filters.counties": "Comtés",
    "filters.counties.any": "Tous les comtés",
    "filters.industries.empty": "Aucun secteur disponible.",
    "filters.industries.helper": "Facultatif. Laissez vide pour rechercher tous les secteurs indexés.",
    "filters.regions.empty": "La recherche mondiale est active. Les métadonnées de région ne sont pas encore indexées.",
    "filters.regions.helper": "Commencez large par continent, puis affinez par pays si utile.",
    "filters.countries.emptyRegion": "Aucun pays ne correspond à la région sélectionnée. Effacez les régions pour rechercher partout.",
    "filters.countries.empty": "Aucun pays ne correspond. La recherche mondiale reste active.",
    "filters.countries.helperRegion": "Les pays sont limités par la région sélectionnée.",
    "filters.countries.helper": "Laissez vide pour inclure tous les pays.",
    "filters.states.empty": "Aucun état ou province n'est indexé pour les pays sélectionnés.",
    "filters.states.helper": "Affiché après le choix du pays. Laissez vide pour inclure tous les états/provinces.",
    "filters.counties.empty": "Aucun comté ne correspond aux états sélectionnés.",
    "filters.counties.helper": "Affiché après le choix d'un état pour les sources avec données de comté.",
    "filters.countryHint": "Choisissez un pays pour filtrer par état ou région.",
    "filters.stateHint": "Choisissez une région si des données locales existent.",
    "freshness.label": "Fraîcheur",
    "freshness.all": "Toutes",
    "freshness.3": "3 jours",
    "freshness.7": "7 jours",
    "freshness.30": "30 jours",
    "remote.label": "Mode de travail",
    "remote.all": "Tous les lieux",
    "remote.allShort": "Tous",
    "remote.remote": "Remote seul",
    "remote.remoteShort": "Remote",
    "remote.hybrid": "Hybride seul",
    "remote.hybridShort": "Hybride",
    "remote.nonRemote": "Sur site / inconnu",
    "remote.nonRemoteShort": "Sur site",
    "remote.hideNoDate": "Masquer les offres sans date",
    "sources.title": "Sources des résultats",
    "sources.empty": "Lancez une recherche pour voir les sources.",
    "results.search": "Rechercher",
    "results.toSeeSlots": "pour voir les offres",
    "results.searchPrompt": "Chercher des offres",
    "results.slot": "offre",
    "results.slots": "offres",
    "results.slotIndexed": "offre",
    "results.slotsIndexed": "offres",
    "results.indexLoading": "Index en chargement",
    "initial.title": "Rechercher des offres ATS publiques récentes.",
    "initial.copy": "Commencez par un titre, une entreprise, un lieu, un pays ou un mode de travail. Les filtres restent fixes sur desktop.",
    "sort.relevance": "Pertinence",
    "sort.last_seen": "Source récente",
    "sort.posted_date": "Date de publication",
    "sort.ats_source": "ATS/source",
    "sort.confidence": "Confiance",
    "theme.day": "Jour",
    "theme.night": "Nuit",
    "language.label": "Langue",
    "version.label": "Recherche v{version}",
    "credit.deployed": "Déployé et développé par",
    "release.title": "Notes de version",
    "release.close": "Fermer",
    "release.closeA11y": "Fermer les notes de version",
    "release.historyLabel": "Historique des notes de version",
    "release.openA11y": "Ouvrir les notes de version {version}",
    "release.versionLabel": "Version {version}",
    "release.genericTitle": "Mise à jour de la recherche publique",
    "release.genericSummary": "Cette version améliore la recherche publique, la qualité des données, la couverture et la fiabilité en production.",
    "stats.jobSlots": "offres",
    "stats.ats": "ATS",
    "stats.companies": "entreprises",
    "suggestion.search": "Recherche",
    "suggestion.title": "Titre",
    "suggestion.company": "Entreprise",
    "suggestion.location": "Lieu",
    "suggestion.country": "Pays",
    "suggestion.region": "Région",
    "suggestion.industry": "Secteur",
    "suggestion.recent": "Récent",
    "suggestion.ats": "ATS",
    "dropdown.search": "Rechercher {label}",
    "dropdown.empty": "{label} ne sont pas encore indexés. La recherche mondiale reste active.",
    "dropdown.noMatch": "Aucun {label} ne correspond à \"{search}\".",
    "dropdown.showing": "{visible} sur {total} {label} affichés.",
    "dropdown.clear": "Effacer {label}",
    "sources.result": "résultat",
    "sources.results": "résultats",
    "sources.confidence": "Conf.",
    "sources.quality": "Qualité",
    "sources.freshSeen": "{fresh}% frais - vu le {date}",
    "sources.currentSet": "{fresh}% frais - jeu actuel",
    "search.intentDetected": "Intention détectée",
    "posting.atsLabel": "ATS",
    "posting.dateUnavailable": "Date de publication indisponible",
    "empty.noSlotsExact": "Aucune offre ne correspond exactement à cette recherche.",
    "empty.tryDifferent": "Essayez un autre titre, une autre source, un autre lieu ou une autre période de fraîcheur.",
    "empty.searchAllLocations": "Rechercher tous les lieux",
    "empty.allWorkModes": "Tous les modes de travail",
    "empty.clearFilters": "Effacer les filtres",
    "results.updating": "Mise à jour des résultats visibles...",
    "results.showingOf": "{visible} offres sur {total} affichées",
    "results.loadingMore": "Chargement de plus d'offres...",
    "results.scrollMore": "Faites défiler pour charger plus",
    "results.allLoaded": "Toutes les offres visibles sont chargées"
  },
  es: {
    "results.eyebrow": "Búsqueda pública",
    "results.title": "Roles abiertos",
    "search.heroTitle": "Buscar puestos abiertos",
    "search.lead": "Encuentra ofertas recientes en bolsas ATS públicas.",
    "search.label": "Buscar empleos",
    "search.placeholder": "Título, empresa, ubicación o país",

    "search.placeholderShort": "Buscar empleos o empresas",
    "search.examplePrefix": "Prueba",
    "search.shortcut": "Enter para buscar · Esc para limpiar",
    "seo.popularSearches": "Búsquedas populares",
    "search.clear": "Limpiar",
    "filters.loading": "Cargando filtros...",
    "filters.show": "Filtros",
    "filters.hide": "Ocultar filtros",
    "filters.global.title": "Búsqueda global",
    "filters.global.locationTitle": "Ubicación acotada",
    "filters.global.copy": "La búsqueda sigue global hasta elegir una ubicación.",
    "filters.global.locationCopy": "Los filtros de región y país están activos.",
    "filters.ats": "ATS",
    "filters.ats.any": "Todos los ATS",
    "filters.industries": "Industrias",
    "filters.industries.any": "Cualquier industria",
    "filters.regions": "Regiones",
    "filters.regions.any": "Mundial",
    "filters.countries": "Países",
    "filters.countries.any": "Todos los países",
    "filters.states": "Estados",
    "filters.states.any": "Todos los estados",
    "filters.counties": "Condados",
    "filters.counties.any": "Todos los condados",
    "filters.industries.empty": "No hay industrias disponibles.",
    "filters.industries.helper": "Opcional. Déjalo vacío para buscar en todas las industrias indexadas.",
    "filters.regions.empty": "La búsqueda mundial está activa. Los metadatos de región aún no están indexados.",
    "filters.regions.helper": "Empieza amplio por continente y luego reduce a países cuando sirva.",
    "filters.countries.emptyRegion": "Ningún país coincide con la región seleccionada. Limpia Regiones para buscar globalmente.",
    "filters.countries.empty": "Ningún país coincide. La búsqueda mundial sigue activa.",
    "filters.countries.helperRegion": "Los países se limitan por la región seleccionada.",
    "filters.countries.helper": "Déjalo vacío para incluir todos los países.",
    "filters.states.empty": "No hay estados o provincias indexados para los países seleccionados.",
    "filters.states.helper": "Se muestra después de elegir país. Déjalo vacío para incluir todos los estados/provincias.",
    "filters.counties.empty": "Ningún condado coincide con los estados seleccionados.",
    "filters.counties.helper": "Se muestra después de elegir estado para fuentes con metadatos de condado.",
    "filters.countryHint": "Elige un país para filtrar por estado o provincia.",
    "filters.stateHint": "Elige un estado/provincia cuando existan datos de condado.",
    "freshness.label": "Frescura",
    "freshness.all": "Todas",
    "freshness.3": "3 días",
    "freshness.7": "7 días",
    "freshness.30": "30 días",
    "remote.label": "Modo de trabajo",
    "remote.all": "Todas las ubicaciones",
    "remote.allShort": "Todas",
    "remote.remote": "Solo remoto",
    "remote.remoteShort": "Remoto",
    "remote.hybrid": "Solo híbrido",
    "remote.hybridShort": "Híbrido",
    "remote.nonRemote": "Presencial / desconocido",
    "remote.nonRemoteShort": "Presencial",
    "remote.hideNoDate": "Ocultar ofertas sin fecha",
    "sources.title": "Fuentes en resultados",
    "sources.empty": "Haz una búsqueda para ver las fuentes del resultado.",
    "results.search": "Buscar",
    "results.toSeeSlots": "para ver puestos",
    "results.searchPrompt": "Buscar empleos",
    "results.slot": "puesto",
    "results.slots": "puestos",
    "results.slotIndexed": "puesto",
    "results.slotsIndexed": "puestos",
    "results.indexLoading": "Cargando índice",
    "initial.title": "Busca ofertas ATS públicas recientes.",
    "initial.copy": "Empieza con título, empresa, ubicación, país o modo de trabajo. Los filtros quedan fijos junto a los resultados en desktop.",
    "sort.relevance": "Relevancia",
    "sort.last_seen": "Fuente fresca",
    "sort.posted_date": "Fecha publicada",
    "sort.ats_source": "ATS/fuente",
    "sort.confidence": "Confianza",
    "theme.day": "Día",
    "theme.night": "Noche",
    "language.label": "Idioma",
    "version.label": "Público v{version}",
    "credit.deployed": "Desplegado y desarrollado por",
    "release.title": "Notas de la versión",
    "release.close": "Cerrar",
    "release.closeA11y": "Cerrar notas de la versión",
    "release.historyLabel": "Historial de notas de la versión",
    "release.openA11y": "Abrir notas de la versión {version}",
    "release.versionLabel": "Versión {version}",
    "release.genericTitle": "Actualización de búsqueda pública",
    "release.genericSummary": "Esta versión mejora la búsqueda pública, la calidad de datos, la cobertura y la fiabilidad en producción.",
    "stats.jobSlots": "puestos",
    "stats.ats": "ATS",
    "stats.companies": "empresas",
    "suggestion.search": "Búsqueda",
    "suggestion.title": "Título",
    "suggestion.company": "Empresa",
    "suggestion.location": "Ubicación",
    "suggestion.country": "País",
    "suggestion.region": "Región",
    "suggestion.industry": "Industria",
    "suggestion.recent": "Reciente",
    "suggestion.ats": "ATS",
    "dropdown.search": "Buscar {label}",
    "dropdown.empty": "{label} aún no están indexados. La búsqueda mundial sigue activa.",
    "dropdown.noMatch": "Ningún {label} coincide con \"{search}\".",
    "dropdown.showing": "Mostrando {visible} de {total} {label}.",
    "dropdown.clear": "Limpiar {label}",
    "sources.result": "resultado",
    "sources.results": "resultados",
    "sources.confidence": "Conf.",
    "sources.quality": "Calidad",
    "sources.freshSeen": "{fresh}% fresco - visto {date}",
    "sources.currentSet": "{fresh}% fresco - conjunto actual",
    "search.intentDetected": "Intención detectada",
    "posting.atsLabel": "ATS",
    "posting.dateUnavailable": "Fecha de publicación no disponible",
    "empty.noSlotsExact": "Ningún puesto coincide exactamente con esta búsqueda.",
    "empty.tryDifferent": "Prueba otro título, fuente, ubicación o ventana de frescura.",
    "empty.searchAllLocations": "Buscar en todas las ubicaciones",
    "empty.allWorkModes": "Todos los modos de trabajo",
    "empty.clearFilters": "Limpiar filtros",
    "results.updating": "Actualizando resultados visibles...",
    "results.showingOf": "Mostrando {visible} de {total} puestos",
    "results.loadingMore": "Cargando más puestos...",
    "results.scrollMore": "Desplázate para cargar más",
    "results.allLoaded": "Todos los puestos visibles cargados"
  }
};

function createPublicLanguagePack(overrides = {}) {
  return {
    ...PUBLIC_MESSAGES.en,
    ...overrides
  };
}

Object.assign(PUBLIC_MESSAGES, {
  "pt-BR": createPublicLanguagePack({
    "results.eyebrow": "Busca pública",
    "results.title": "Vagas abertas",
    "search.heroTitle": "Buscar vagas abertas",
    "search.lead": "Encontre vagas recentes em quadros ATS públicos.",
    "search.label": "Buscar vagas",
    "search.placeholder": "Busque cargo, empresa, local ou país",
    "search.placeholderShort": "Buscar vagas ou empresas",
    "search.examplePrefix": "Tente",
    "search.shortcut": "Enter para buscar · Esc para limpar",
    "seo.popularSearches": "Buscas populares",
    "search.clear": "Limpar",
    "filters.loading": "Carregando filtros...",
    "filters.show": "Filtros",
    "filters.hide": "Ocultar filtros",
    "filters.global.title": "Busca global",
    "filters.global.locationTitle": "Local filtrado",
    "filters.global.copy": "A busca continua global até você escolher um filtro de local.",
    "filters.global.locationCopy": "Filtros de região e país estão ativos.",
    "filters.industries": "Setores",
    "filters.regions": "Regiões",
    "filters.countries": "Países",
    "filters.states": "Estados",
    "filters.counties": "Condados",
    "freshness.label": "Atualidade",
    "freshness.all": "Qualquer data",
    "remote.label": "Modo de trabalho",
    "remote.all": "Todos os locais",
    "remote.remote": "Somente remoto",
    "remote.hybrid": "Somente híbrido",
    "remote.nonRemote": "Presencial / desconhecido",
    "sources.title": "Fontes nos resultados",
    "sources.empty": "Faça uma busca para ver fontes neste conjunto.",
    "results.search": "Buscar",
    "results.searchPrompt": "Buscar vagas",
    "results.slot": "vaga",
    "results.slots": "vagas",
    "results.slotIndexed": "vaga",
    "results.slotsIndexed": "vagas",
    "results.indexLoading": "Carregando índice",
    "initial.title": "Busque vagas públicas ATS recentes.",
    "initial.copy": "Comece por cargo, empresa, local, país ou modo de trabalho.",
    "sort.relevance": "Relevância",
    "sort.last_seen": "Fonte recente",
    "sort.posted_date": "Data de publicação",
    "sort.ats_source": "ATS/fonte",
    "sort.confidence": "Confiança",
    "theme.day": "Dia",
    "theme.night": "Noite",
    "language.label": "Idioma",
    "version.label": "Público v{version}",
    "credit.deployed": "Publicado e desenvolvido por",
    "release.title": "Notas da versão",
    "release.close": "Fechar",
    "release.closeA11y": "Fechar notas da versão",
    "release.historyLabel": "Histórico de versões",
    "release.openA11y": "Abrir notas da versão {version}",
    "release.versionLabel": "Versão {version}",
    "release.genericTitle": "Atualização da busca pública",
    "release.genericSummary": "Esta versão melhorou a busca pública, a qualidade dos dados, a cobertura e a confiabilidade em produção.",
    "stats.jobSlots": "vagas",
    "stats.companies": "empresas",
    "suggestion.title": "Cargo",
    "suggestion.company": "Empresa",
    "suggestion.location": "Local",
    "suggestion.country": "País",
    "suggestion.region": "Região",
    "suggestion.industry": "Setor",
    "suggestion.recent": "Recente",
    "dropdown.search": "Buscar {label}",
    "dropdown.clear": "Limpar {label}",
    "posting.dateUnavailable": "Data da vaga indisponível",
    "empty.noSlotsExact": "Nenhuma vaga corresponde exatamente a esta busca.",
    "empty.tryDifferent": "Tente outro cargo, fonte, local ou período.",
    "empty.searchAllLocations": "Buscar em todos os locais",
    "empty.allWorkModes": "Todos os modos de trabalho",
    "empty.clearFilters": "Limpar filtros",
    "results.updating": "Atualizando resultados visíveis...",
    "results.showingOf": "Mostrando {visible} de {total} vagas",
    "results.loadingMore": "Carregando mais vagas...",
    "results.scrollMore": "Role para carregar mais",
    "results.allLoaded": "Todas as vagas visíveis foram carregadas"
  }),
  "pt-PT": createPublicLanguagePack({
    "results.eyebrow": "Pesquisa pública",
    "results.title": "Vagas abertas",
    "search.heroTitle": "Pesquisar vagas abertas",
    "search.lead": "Encontra vagas recentes em quadros ATS públicos.",
    "search.label": "Pesquisar vagas",
    "search.placeholder": "Pesquisa cargo, empresa, local ou país",
    "search.placeholderShort": "Pesquisar vagas ou empresas",
    "search.examplePrefix": "Experimenta",
    "search.shortcut": "Enter para pesquisar · Esc para limpar",
    "seo.popularSearches": "Pesquisas populares",
    "search.clear": "Limpar",
    "filters.loading": "A carregar filtros...",
    "filters.show": "Filtros",
    "filters.hide": "Ocultar filtros",
    "filters.global.title": "Pesquisa global",
    "filters.global.locationTitle": "Local filtrado",
    "filters.global.copy": "A pesquisa continua global até escolheres um filtro de local.",
    "filters.global.locationCopy": "Filtros de região e país estão ativos.",
    "filters.industries": "Setores",
    "filters.regions": "Regiões",
    "filters.countries": "Países",
    "filters.states": "Distritos",
    "filters.counties": "Concelhos",
    "freshness.label": "Atualidade",
    "freshness.all": "Qualquer data",
    "remote.label": "Modo de trabalho",
    "remote.all": "Todos os locais",
    "remote.remote": "Só remoto",
    "remote.hybrid": "Só híbrido",
    "remote.nonRemote": "Presencial / desconhecido",
    "sources.title": "Fontes nos resultados",
    "results.search": "Pesquisar",
    "results.searchPrompt": "Pesquisar vagas",
    "results.slot": "vaga",
    "results.slots": "vagas",
    "results.slotIndexed": "vaga",
    "results.slotsIndexed": "vagas",
    "initial.title": "Pesquisa vagas públicas ATS recentes.",
    "initial.copy": "Começa por cargo, empresa, local, país ou modo de trabalho.",
    "sort.relevance": "Relevância",
    "sort.last_seen": "Fonte recente",
    "sort.posted_date": "Data de publicação",
    "sort.ats_source": "ATS/fonte",
    "sort.confidence": "Confiança",
    "theme.day": "Dia",
    "theme.night": "Noite",
    "language.label": "Idioma",
    "version.label": "Público v{version}",
    "credit.deployed": "Publicado e desenvolvido por",
    "release.title": "Notas da versão",
    "release.close": "Fechar",
    "release.versionLabel": "Versão {version}",
    "release.genericTitle": "Atualização da pesquisa pública",
    "release.genericSummary": "Esta versão melhorou a pesquisa pública, a qualidade dos dados, a cobertura e a fiabilidade em produção.",
    "stats.jobSlots": "vagas",
    "stats.companies": "empresas",
    "suggestion.title": "Cargo",
    "suggestion.company": "Empresa",
    "suggestion.location": "Local",
    "suggestion.country": "País",
    "suggestion.region": "Região",
    "suggestion.industry": "Setor",
    "dropdown.search": "Pesquisar {label}",
    "dropdown.clear": "Limpar {label}",
    "posting.dateUnavailable": "Data da vaga indisponível",
    "empty.noSlotsExact": "Nenhuma vaga corresponde exatamente a esta pesquisa.",
    "empty.tryDifferent": "Experimenta outro cargo, fonte, local ou período.",
    "empty.clearFilters": "Limpar filtros",
    "results.updating": "A atualizar resultados visíveis...",
    "results.showingOf": "A mostrar {visible} de {total} vagas",
    "results.loadingMore": "A carregar mais vagas...",
    "results.allLoaded": "Todas as vagas visíveis foram carregadas"
  }),
  it: createPublicLanguagePack({
    "results.eyebrow": "Ricerca pubblica",
    "results.title": "Ruoli aperti",
    "search.heroTitle": "Cerca posizioni aperte",
    "search.lead": "Trova offerte recenti nei job board ATS pubblici.",
    "search.label": "Cerca offerte",
    "search.placeholder": "Cerca ruolo, azienda, località o paese",
    "search.placeholderShort": "Cerca lavori o aziende",
    "search.shortcut": "Invio per cercare · Esc per cancellare",
    "seo.popularSearches": "Ricerche popolari",
    "search.clear": "Cancella",
    "filters.show": "Filtri",
    "filters.hide": "Nascondi filtri",
    "filters.global.title": "Ricerca globale",
    "filters.global.copy": "La ricerca resta globale finché non scegli un filtro di località.",
    "filters.industries": "Settori",
    "filters.regions": "Regioni",
    "filters.countries": "Paesi",
    "filters.states": "Stati/province",
    "freshness.label": "Freschezza",
    "freshness.all": "Qualsiasi data",
    "remote.label": "Modalità di lavoro",
    "remote.all": "Tutte le località",
    "remote.remote": "Solo remoto",
    "remote.hybrid": "Solo ibrido",
    "remote.nonRemote": "In sede / sconosciuto",
    "sources.title": "Fonti nei risultati",
    "results.search": "Cerca",
    "results.searchPrompt": "Cerca lavori",
    "results.slot": "offerta",
    "results.slots": "offerte",
    "results.slotIndexed": "offerta",
    "results.slotsIndexed": "offerte",
    "initial.title": "Cerca offerte ATS pubbliche recenti.",
    "initial.copy": "Inizia da ruolo, azienda, località, paese o modalità di lavoro.",
    "sort.relevance": "Rilevanza",
    "sort.last_seen": "Fonte recente",
    "sort.posted_date": "Data pubblicazione",
    "sort.confidence": "Affidabilità",
    "theme.day": "Giorno",
    "theme.night": "Notte",
    "language.label": "Lingua",
    "version.label": "Pubblico v{version}",
    "credit.deployed": "Pubblicato e sviluppato da",
    "release.title": "Note di rilascio",
    "release.close": "Chiudi",
    "release.versionLabel": "Versione {version}",
    "release.genericTitle": "Aggiornamento della ricerca pubblica",
    "release.genericSummary": "Questa versione migliora ricerca pubblica, qualità dei dati, copertura e affidabilità in produzione.",
    "stats.jobSlots": "offerte",
    "stats.companies": "aziende",
    "suggestion.title": "Ruolo",
    "suggestion.company": "Azienda",
    "suggestion.location": "Località",
    "suggestion.country": "Paese",
    "suggestion.region": "Regione",
    "suggestion.industry": "Settore",
    "dropdown.search": "Cerca {label}",
    "dropdown.clear": "Cancella {label}",
    "posting.dateUnavailable": "Data offerta non disponibile",
    "empty.noSlotsExact": "Nessuna offerta corrisponde esattamente a questa ricerca.",
    "empty.tryDifferent": "Prova un altro ruolo, fonte, località o periodo.",
    "empty.clearFilters": "Cancella filtri",
    "results.updating": "Aggiornamento dei risultati visibili...",
    "results.showingOf": "Mostrando {visible} di {total} offerte",
    "results.loadingMore": "Caricamento di altre offerte...",
    "results.allLoaded": "Tutte le offerte visibili sono caricate"
  }),
  nl: createPublicLanguagePack({
    "results.eyebrow": "Publieke zoekopdracht",
    "results.title": "Open rollen",
    "search.heroTitle": "Zoek openstaande vacatures",
    "search.lead": "Vind recente vacatures op publieke ATS-jobboards.",
    "search.label": "Vacatures zoeken",
    "search.placeholder": "Zoek titel, bedrijf, plaats of land",
    "search.placeholderShort": "Zoek jobs of bedrijven",
    "search.shortcut": "Enter om te zoeken · Esc om te wissen",
    "seo.popularSearches": "Populaire zoekopdrachten",
    "search.clear": "Wissen",
    "filters.show": "Filters",
    "filters.hide": "Filters verbergen",
    "filters.global.title": "Wereldwijd zoeken",
    "filters.global.copy": "Zoeken blijft wereldwijd tot je een locatiefilter kiest.",
    "filters.industries": "Sectoren",
    "filters.regions": "Regio's",
    "filters.countries": "Landen",
    "filters.states": "Provincies",
    "freshness.label": "Actualiteit",
    "freshness.all": "Elke datum",
    "remote.label": "Werkmodus",
    "remote.all": "Alle locaties",
    "remote.remote": "Alleen remote",
    "remote.hybrid": "Alleen hybride",
    "remote.nonRemote": "Op locatie / onbekend",
    "sources.title": "Bronnen in resultaten",
    "results.search": "Zoeken",
    "results.searchPrompt": "Vacatures zoeken",
    "results.slot": "vacature",
    "results.slots": "vacatures",
    "results.slotIndexed": "vacature",
    "results.slotsIndexed": "vacatures",
    "initial.title": "Zoek recente publieke ATS-vacatures.",
    "initial.copy": "Begin met titel, bedrijf, plaats, land of werkmodus.",
    "sort.relevance": "Relevantie",
    "sort.last_seen": "Recente bron",
    "sort.posted_date": "Publicatiedatum",
    "sort.confidence": "Vertrouwen",
    "theme.day": "Dag",
    "theme.night": "Nacht",
    "language.label": "Taal",
    "version.label": "Publiek v{version}",
    "credit.deployed": "Gepubliceerd en ontwikkeld door",
    "release.title": "Release-opmerkingen",
    "release.close": "Sluiten",
    "release.versionLabel": "Versie {version}",
    "release.genericTitle": "Publieke zoekupdate",
    "release.genericSummary": "Deze versie verbetert publieke zoekopdrachten, datakwaliteit, dekking en productiebetrouwbaarheid.",
    "stats.jobSlots": "vacatures",
    "stats.companies": "bedrijven",
    "suggestion.title": "Titel",
    "suggestion.company": "Bedrijf",
    "suggestion.location": "Locatie",
    "suggestion.country": "Land",
    "suggestion.region": "Regio",
    "suggestion.industry": "Sector",
    "dropdown.search": "Zoek {label}",
    "dropdown.clear": "Wis {label}",
    "posting.dateUnavailable": "Vacaturedatum niet beschikbaar",
    "empty.noSlotsExact": "Geen vacatures passen exact bij deze zoekopdracht.",
    "empty.tryDifferent": "Probeer een andere titel, bron, locatie of periode.",
    "empty.clearFilters": "Filters wissen",
    "results.updating": "Zichtbare resultaten worden bijgewerkt...",
    "results.showingOf": "{visible} van {total} vacatures getoond",
    "results.loadingMore": "Meer vacatures laden...",
    "results.allLoaded": "Alle zichtbare vacatures zijn geladen"
  }),
  pl: createPublicLanguagePack({
    "results.eyebrow": "Wyszukiwanie publiczne",
    "results.title": "Otwarte role",
    "search.heroTitle": "Szukaj otwartych ofert pracy",
    "search.lead": "Znajdź świeże oferty z publicznych tablic ATS.",
    "search.label": "Szukaj ofert",
    "search.placeholder": "Szukaj stanowiska, firmy, lokalizacji lub kraju",
    "search.placeholderShort": "Szukaj ofert lub firm",
    "search.shortcut": "Enter, aby szukać · Esc, aby wyczyścić",
    "seo.popularSearches": "Popularne wyszukiwania",
    "search.clear": "Wyczyść",
    "filters.show": "Filtry",
    "filters.hide": "Ukryj filtry",
    "filters.global.title": "Wyszukiwanie globalne",
    "filters.global.copy": "Wyszukiwanie pozostaje globalne, dopóki nie wybierzesz lokalizacji.",
    "filters.industries": "Branże",
    "filters.regions": "Regiony",
    "filters.countries": "Kraje",
    "filters.states": "Województwa",
    "freshness.label": "Świeżość",
    "freshness.all": "Dowolna data",
    "remote.label": "Tryb pracy",
    "remote.all": "Wszystkie lokalizacje",
    "remote.remote": "Tylko zdalnie",
    "remote.hybrid": "Tylko hybrydowo",
    "remote.nonRemote": "Na miejscu / nieznane",
    "sources.title": "Źródła w wynikach",
    "results.search": "Szukaj",
    "results.searchPrompt": "Szukaj pracy",
    "results.slot": "oferta",
    "results.slots": "oferty",
    "results.slotIndexed": "oferta pracy",
    "results.slotsIndexed": "oferty pracy",
    "initial.title": "Szukaj świeżych publicznych ofert ATS.",
    "initial.copy": "Zacznij od stanowiska, firmy, lokalizacji, kraju lub trybu pracy.",
    "sort.relevance": "Trafność",
    "sort.last_seen": "Świeże źródło",
    "sort.posted_date": "Data publikacji",
    "sort.confidence": "Pewność",
    "theme.day": "Dzień",
    "theme.night": "Noc",
    "language.label": "Język",
    "version.label": "Publiczne v{version}",
    "credit.deployed": "Wdrożone i rozwijane przez",
    "release.title": "Informacje o wersji",
    "release.close": "Zamknij",
    "release.versionLabel": "Wersja {version}",
    "release.genericTitle": "Aktualizacja wyszukiwania publicznego",
    "release.genericSummary": "Ta wersja poprawia wyszukiwanie publiczne, jakość danych, zasięg i niezawodność produkcji.",
    "stats.jobSlots": "oferty",
    "stats.companies": "firmy",
    "suggestion.title": "Stanowisko",
    "suggestion.company": "Firma",
    "suggestion.location": "Lokalizacja",
    "suggestion.country": "Kraj",
    "suggestion.region": "Region",
    "suggestion.industry": "Branża",
    "dropdown.search": "Szukaj {label}",
    "dropdown.clear": "Wyczyść {label}",
    "posting.dateUnavailable": "Data oferty niedostępna",
    "empty.noSlotsExact": "Brak ofert dokładnie pasujących do wyszukiwania.",
    "empty.tryDifferent": "Spróbuj innego stanowiska, źródła, lokalizacji lub okresu.",
    "empty.clearFilters": "Wyczyść filtry",
    "results.updating": "Aktualizowanie widocznych wyników...",
    "results.showingOf": "Pokazano {visible} z {total} ofert",
    "results.loadingMore": "Ładowanie kolejnych ofert...",
    "results.allLoaded": "Wszystkie widoczne oferty zostały załadowane"
  }),
  ja: createPublicLanguagePack({
    "results.eyebrow": "公開検索",
    "results.title": "募集中の職種",
    "search.heroTitle": "公開求人を検索",
    "search.lead": "公開ATS求人ボードから新しい求人を見つけます。",
    "search.label": "求人を検索",
    "search.placeholder": "職種、会社、地域、国で検索",
    "search.placeholderShort": "求人または企業を検索",
    "search.shortcut": "Enterで検索 · Escでクリア",
    "seo.popularSearches": "人気の検索",
    "search.clear": "クリア",
    "filters.show": "フィルター",
    "filters.hide": "フィルターを閉じる",
    "filters.global.title": "グローバル検索",
    "filters.global.copy": "地域フィルターを選ぶまで検索は全世界が対象です。",
    "filters.industries": "業界",
    "filters.regions": "地域",
    "filters.countries": "国",
    "filters.states": "都道府県",
    "freshness.label": "新しさ",
    "freshness.all": "すべての日付",
    "remote.label": "勤務形態",
    "remote.all": "すべての勤務地",
    "remote.remote": "リモートのみ",
    "remote.hybrid": "ハイブリッドのみ",
    "remote.nonRemote": "出社 / 不明",
    "sources.title": "結果内のソース",
    "results.search": "検索",
    "results.searchPrompt": "求人検索",
    "results.slot": "求人",
    "results.slots": "求人",
    "results.slotIndexed": "求人",
    "results.slotsIndexed": "求人",
    "initial.title": "新しい公開ATS求人を検索します。",
    "initial.copy": "職種、会社、地域、国、勤務形態から始めます。",
    "sort.relevance": "関連度",
    "sort.last_seen": "新しいソース",
    "sort.posted_date": "掲載日",
    "sort.confidence": "信頼度",
    "theme.day": "昼",
    "theme.night": "夜",
    "language.label": "言語",
    "version.label": "公開 v{version}",
    "credit.deployed": "公開・開発",
    "release.title": "リリースノート",
    "release.close": "閉じる",
    "release.versionLabel": "バージョン {version}",
    "release.genericTitle": "公開検索の更新",
    "release.genericSummary": "このリリースでは公開検索、データ品質、カバレッジ、本番信頼性を改善しました。",
    "stats.jobSlots": "求人",
    "stats.companies": "企業",
    "suggestion.title": "職種",
    "suggestion.company": "会社",
    "suggestion.location": "勤務地",
    "suggestion.country": "国",
    "suggestion.region": "地域",
    "suggestion.industry": "業界",
    "dropdown.search": "{label}を検索",
    "dropdown.clear": "{label}をクリア",
    "posting.dateUnavailable": "掲載日は利用できません",
    "empty.noSlotsExact": "この検索に完全一致する求人はありません。",
    "empty.tryDifferent": "別の職種、ソース、場所、期間を試してください。",
    "empty.clearFilters": "フィルターをクリア",
    "results.updating": "表示結果を更新中...",
    "results.showingOf": "{total}件中{visible}件を表示",
    "results.loadingMore": "さらに求人を読み込み中...",
    "results.allLoaded": "表示可能な求人はすべて読み込み済みです"
  }),
  ko: createPublicLanguagePack({
    "results.eyebrow": "공개 검색",
    "results.title": "채용 중인 역할",
    "search.heroTitle": "공개 채용 공고 검색",
    "search.lead": "공개 ATS 채용 보드의 최신 공고를 찾습니다.",
    "search.label": "공고 검색",
    "search.placeholder": "직무, 회사, 지역 또는 국가 검색",
    "search.placeholderShort": "채용공고 또는 회사 검색",
    "search.shortcut": "Enter로 검색 · Esc로 지우기",
    "seo.popularSearches": "인기 검색어",
    "search.clear": "지우기",
    "filters.show": "필터",
    "filters.hide": "필터 숨기기",
    "filters.global.title": "전 세계 검색",
    "filters.global.copy": "지역 필터를 선택할 때까지 전 세계를 검색합니다.",
    "filters.industries": "산업",
    "filters.regions": "지역",
    "filters.countries": "국가",
    "filters.states": "주/도",
    "freshness.label": "최신순",
    "freshness.all": "모든 날짜",
    "remote.label": "근무 방식",
    "remote.all": "모든 위치",
    "remote.remote": "원격만",
    "remote.hybrid": "하이브리드만",
    "remote.nonRemote": "현장 / 알 수 없음",
    "sources.title": "결과 출처",
    "results.search": "검색",
    "results.searchPrompt": "채용 검색",
    "results.slot": "공고",
    "results.slots": "공고",
    "results.slotIndexed": "채용 공고",
    "results.slotsIndexed": "채용 공고",
    "initial.title": "최신 공개 ATS 공고를 검색하세요.",
    "initial.copy": "직무, 회사, 지역, 국가 또는 근무 방식으로 시작하세요.",
    "sort.relevance": "관련도",
    "sort.last_seen": "최신 출처",
    "sort.posted_date": "게시일",
    "sort.confidence": "신뢰도",
    "theme.day": "낮",
    "theme.night": "밤",
    "language.label": "언어",
    "version.label": "공개 v{version}",
    "credit.deployed": "배포 및 개발",
    "release.title": "릴리스 노트",
    "release.close": "닫기",
    "release.versionLabel": "버전 {version}",
    "release.genericTitle": "공개 검색 업데이트",
    "release.genericSummary": "이번 릴리스는 공개 검색, 데이터 품질, 범위, 운영 안정성을 개선했습니다.",
    "stats.jobSlots": "공고",
    "stats.companies": "회사",
    "suggestion.title": "직무",
    "suggestion.company": "회사",
    "suggestion.location": "위치",
    "suggestion.country": "국가",
    "suggestion.region": "지역",
    "suggestion.industry": "산업",
    "dropdown.search": "{label} 검색",
    "dropdown.clear": "{label} 지우기",
    "posting.dateUnavailable": "게시일 없음",
    "empty.noSlotsExact": "이 검색과 정확히 일치하는 공고가 없습니다.",
    "empty.tryDifferent": "다른 직무, 출처, 위치 또는 기간을 시도하세요.",
    "empty.clearFilters": "필터 지우기",
    "results.updating": "표시 결과 업데이트 중...",
    "results.showingOf": "{total}개 중 {visible}개 표시",
    "results.loadingMore": "더 많은 공고 로드 중...",
    "results.allLoaded": "표시 가능한 모든 공고를 불러왔습니다"
  }),
  "zh-CN": createPublicLanguagePack({
    "results.eyebrow": "公开搜索",
    "results.title": "开放职位",
    "search.heroTitle": "搜索开放职位",
    "search.lead": "从公开 ATS 招聘板查找最新职位。",
    "search.label": "搜索职位",
    "search.placeholder": "搜索职位、公司、地点或国家",
    "search.placeholderShort": "搜索职位或公司",
    "search.shortcut": "Enter 搜索 · Esc 清除",
    "seo.popularSearches": "热门搜索",
    "search.clear": "清除",
    "filters.show": "筛选",
    "filters.hide": "隐藏筛选",
    "filters.global.title": "全球搜索",
    "filters.global.copy": "选择地点筛选前，搜索保持全球范围。",
    "filters.industries": "行业",
    "filters.regions": "地区",
    "filters.countries": "国家",
    "filters.states": "省/州",
    "freshness.label": "新鲜度",
    "freshness.all": "任意日期",
    "remote.label": "工作方式",
    "remote.all": "所有地点",
    "remote.remote": "仅远程",
    "remote.hybrid": "仅混合",
    "remote.nonRemote": "现场 / 未知",
    "sources.title": "结果来源",
    "results.search": "搜索",
    "results.searchPrompt": "搜索工作",
    "results.slot": "职位",
    "results.slots": "职位",
    "results.slotIndexed": "职位",
    "results.slotsIndexed": "职位",
    "initial.title": "搜索最新公开 ATS 职位。",
    "initial.copy": "从职位、公司、地点、国家或工作方式开始。",
    "sort.relevance": "相关性",
    "sort.last_seen": "最新来源",
    "sort.posted_date": "发布日期",
    "sort.confidence": "置信度",
    "theme.day": "白天",
    "theme.night": "夜间",
    "language.label": "语言",
    "version.label": "公开 v{version}",
    "credit.deployed": "发布和开发者",
    "release.title": "版本说明",
    "release.close": "关闭",
    "release.versionLabel": "版本 {version}",
    "release.genericTitle": "公开搜索更新",
    "release.genericSummary": "此版本改进了公开搜索、数据质量、覆盖范围和生产可靠性。",
    "stats.jobSlots": "职位",
    "stats.companies": "公司",
    "suggestion.title": "职位",
    "suggestion.company": "公司",
    "suggestion.location": "地点",
    "suggestion.country": "国家",
    "suggestion.region": "地区",
    "suggestion.industry": "行业",
    "dropdown.search": "搜索 {label}",
    "dropdown.clear": "清除 {label}",
    "posting.dateUnavailable": "职位日期不可用",
    "empty.noSlotsExact": "没有职位与此搜索完全匹配。",
    "empty.tryDifferent": "尝试其他职位、来源、地点或时间范围。",
    "empty.clearFilters": "清除筛选",
    "results.updating": "正在更新可见结果...",
    "results.showingOf": "显示 {visible} / {total} 个职位",
    "results.loadingMore": "正在加载更多职位...",
    "results.allLoaded": "所有可见职位已加载"
  }),
  hi: createPublicLanguagePack({
    "results.eyebrow": "सार्वजनिक खोज",
    "results.title": "खुले पद",
    "search.heroTitle": "खुली नौकरियां खोजें",
    "search.lead": "सार्वजनिक ATS job boards से ताज़ा openings खोजें।",
    "search.label": "नौकरियां खोजें",
    "search.placeholder": "पद, कंपनी, स्थान या देश खोजें",
    "search.placeholderShort": "नौकरी या कंपनी खोजें",
    "search.shortcut": "Enter से खोजें · Esc से साफ करें",
    "seo.popularSearches": "लोकप्रिय खोजें",
    "search.clear": "साफ करें",
    "filters.show": "फिल्टर",
    "filters.hide": "फिल्टर छिपाएं",
    "filters.global.title": "वैश्विक खोज",
    "filters.global.copy": "स्थान फिल्टर चुनने तक खोज वैश्विक रहती है।",
    "filters.industries": "उद्योग",
    "filters.regions": "क्षेत्र",
    "filters.countries": "देश",
    "filters.states": "राज्य",
    "freshness.label": "ताज़गी",
    "freshness.all": "कोई भी तारीख",
    "remote.label": "काम का तरीका",
    "remote.all": "सभी स्थान",
    "remote.remote": "केवल remote",
    "remote.hybrid": "केवल hybrid",
    "remote.nonRemote": "ऑफिस / अज्ञात",
    "sources.title": "परिणाम स्रोत",
    "results.search": "खोजें",
    "results.searchPrompt": "jobs खोजें",
    "results.slot": "नौकरी",
    "results.slots": "नौकरियां",
    "results.slotIndexed": "job slot",
    "results.slotsIndexed": "job slots",
    "initial.title": "ताज़ा सार्वजनिक ATS openings खोजें।",
    "initial.copy": "पद, कंपनी, स्थान, देश या काम के तरीके से शुरू करें।",
    "sort.relevance": "प्रासंगिकता",
    "sort.last_seen": "ताज़ा स्रोत",
    "sort.posted_date": "पोस्ट तारीख",
    "sort.confidence": "विश्वास",
    "theme.day": "दिन",
    "theme.night": "रात",
    "language.label": "भाषा",
    "version.label": "सार्वजनिक v{version}",
    "credit.deployed": "प्रकाशित और विकसित",
    "release.title": "रिलीज नोट्स",
    "release.close": "बंद करें",
    "release.versionLabel": "संस्करण {version}",
    "release.genericTitle": "Public search update",
    "release.genericSummary": "इस release ने public search, data quality, coverage और production reliability को बेहतर किया।",
    "stats.jobSlots": "नौकरियां",
    "stats.companies": "कंपनियां",
    "suggestion.title": "पद",
    "suggestion.company": "कंपनी",
    "suggestion.location": "स्थान",
    "suggestion.country": "देश",
    "suggestion.region": "क्षेत्र",
    "suggestion.industry": "उद्योग",
    "dropdown.search": "{label} खोजें",
    "dropdown.clear": "{label} साफ करें",
    "posting.dateUnavailable": "posting date उपलब्ध नहीं",
    "empty.noSlotsExact": "इस खोज से कोई exact match नहीं मिला।",
    "empty.tryDifferent": "दूसरा पद, स्रोत, स्थान या समय सीमा आज़माएं।",
    "empty.clearFilters": "फिल्टर साफ करें",
    "results.updating": "दिख रहे परिणाम अपडेट हो रहे हैं...",
    "results.showingOf": "{total} में से {visible} नौकरियां",
    "results.loadingMore": "और नौकरियां लोड हो रही हैं...",
    "results.allLoaded": "सभी दिखने वाली नौकरियां लोड हो गईं"
  }),
  ar: createPublicLanguagePack({
    "results.eyebrow": "بحث عام",
    "results.title": "وظائف مفتوحة",
    "search.heroTitle": "ابحث عن الوظائف المفتوحة",
    "search.lead": "اعثر على وظائف حديثة من لوحات ATS العامة.",
    "search.label": "بحث عن وظائف",
    "search.placeholder": "ابحث عن المسمى أو الشركة أو الموقع أو الدولة",
    "search.placeholderShort": "ابحث عن وظيفة أو شركة",
    "search.shortcut": "Enter للبحث · Esc للمسح",
    "seo.popularSearches": "عمليات بحث شائعة",
    "search.clear": "مسح",
    "filters.show": "الفلاتر",
    "filters.hide": "إخفاء الفلاتر",
    "filters.global.title": "بحث عالمي",
    "filters.global.copy": "يبقى البحث عالميا حتى تختار فلتر موقع.",
    "filters.industries": "القطاعات",
    "filters.regions": "المناطق",
    "filters.countries": "الدول",
    "filters.states": "الولايات",
    "freshness.label": "الحداثة",
    "freshness.all": "أي تاريخ",
    "remote.label": "نمط العمل",
    "remote.all": "كل المواقع",
    "remote.remote": "عن بعد فقط",
    "remote.hybrid": "هجين فقط",
    "remote.nonRemote": "حضوري / غير معروف",
    "sources.title": "المصادر في النتائج",
    "results.search": "بحث",
    "results.searchPrompt": "ابحث عن وظائف",
    "results.slot": "وظيفة",
    "results.slots": "وظائف",
    "results.slotIndexed": "وظيفة",
    "results.slotsIndexed": "وظائف",
    "initial.title": "ابحث في وظائف ATS العامة الحديثة.",
    "initial.copy": "ابدأ بالمسمى أو الشركة أو الموقع أو الدولة أو نمط العمل.",
    "sort.relevance": "الصلة",
    "sort.last_seen": "مصدر حديث",
    "sort.posted_date": "تاريخ النشر",
    "sort.confidence": "الثقة",
    "theme.day": "نهار",
    "theme.night": "ليل",
    "language.label": "اللغة",
    "version.label": "عام v{version}",
    "credit.deployed": "نشر وتطوير",
    "release.title": "ملاحظات الإصدار",
    "release.close": "إغلاق",
    "release.versionLabel": "الإصدار {version}",
    "release.genericTitle": "تحديث البحث العام",
    "release.genericSummary": "حسّن هذا الإصدار البحث العام وجودة البيانات والتغطية والموثوقية في الإنتاج.",
    "stats.jobSlots": "وظائف",
    "stats.companies": "شركات",
    "suggestion.title": "المسمى",
    "suggestion.company": "الشركة",
    "suggestion.location": "الموقع",
    "suggestion.country": "الدولة",
    "suggestion.region": "المنطقة",
    "suggestion.industry": "القطاع",
    "dropdown.search": "بحث {label}",
    "dropdown.clear": "مسح {label}",
    "posting.dateUnavailable": "تاريخ الوظيفة غير متاح",
    "empty.noSlotsExact": "لا توجد وظائف تطابق هذا البحث تماما.",
    "empty.tryDifferent": "جرّب مسمى أو مصدرا أو موقعا أو فترة مختلفة.",
    "empty.clearFilters": "مسح الفلاتر",
    "results.updating": "تحديث النتائج الظاهرة...",
    "results.showingOf": "عرض {visible} من {total} وظائف",
    "results.loadingMore": "تحميل المزيد من الوظائف...",
    "results.allLoaded": "تم تحميل كل الوظائف الظاهرة"
  }),
  id: createPublicLanguagePack({
    "results.eyebrow": "Pencarian publik",
    "results.title": "Peran terbuka",
    "search.heroTitle": "Cari lowongan terbuka",
    "search.lead": "Temukan lowongan terbaru dari papan ATS publik.",
    "search.label": "Cari lowongan",
    "search.placeholder": "Cari jabatan, perusahaan, lokasi, atau negara",
    "search.placeholderShort": "Cari lowongan atau perusahaan",
    "search.shortcut": "Enter untuk mencari · Esc untuk menghapus",
    "seo.popularSearches": "Pencarian populer",
    "search.clear": "Hapus",
    "filters.show": "Filter",
    "filters.hide": "Sembunyikan filter",
    "filters.global.title": "Pencarian global",
    "filters.global.copy": "Pencarian tetap global sampai filter lokasi dipilih.",
    "filters.industries": "Industri",
    "filters.regions": "Wilayah",
    "filters.countries": "Negara",
    "filters.states": "Provinsi",
    "freshness.label": "Kesegaran",
    "freshness.all": "Tanggal apa pun",
    "remote.label": "Mode kerja",
    "remote.all": "Semua lokasi",
    "remote.remote": "Hanya remote",
    "remote.hybrid": "Hanya hybrid",
    "remote.nonRemote": "On-site / tidak diketahui",
    "sources.title": "Sumber di hasil",
    "results.search": "Cari",
    "results.searchPrompt": "Cari pekerjaan",
    "results.slot": "lowongan",
    "results.slots": "lowongan",
    "results.slotIndexed": "lowongan",
    "results.slotsIndexed": "lowongan",
    "initial.title": "Cari lowongan ATS publik terbaru.",
    "initial.copy": "Mulai dari jabatan, perusahaan, lokasi, negara, atau mode kerja.",
    "sort.relevance": "Relevansi",
    "sort.last_seen": "Sumber terbaru",
    "sort.posted_date": "Tanggal posting",
    "sort.confidence": "Kepercayaan",
    "theme.day": "Siang",
    "theme.night": "Malam",
    "language.label": "Bahasa",
    "version.label": "Publik v{version}",
    "credit.deployed": "Diterbitkan dan dikembangkan oleh",
    "release.title": "Catatan rilis",
    "release.close": "Tutup",
    "release.versionLabel": "Versi {version}",
    "release.genericTitle": "Pembaruan pencarian publik",
    "release.genericSummary": "Rilis ini meningkatkan pencarian publik, kualitas data, cakupan, dan keandalan produksi.",
    "stats.jobSlots": "lowongan",
    "stats.companies": "perusahaan",
    "suggestion.title": "Jabatan",
    "suggestion.company": "Perusahaan",
    "suggestion.location": "Lokasi",
    "suggestion.country": "Negara",
    "suggestion.region": "Wilayah",
    "suggestion.industry": "Industri",
    "dropdown.search": "Cari {label}",
    "dropdown.clear": "Hapus {label}",
    "posting.dateUnavailable": "Tanggal lowongan tidak tersedia",
    "empty.noSlotsExact": "Tidak ada lowongan yang cocok persis dengan pencarian ini.",
    "empty.tryDifferent": "Coba jabatan, sumber, lokasi, atau rentang waktu lain.",
    "empty.clearFilters": "Hapus filter",
    "results.updating": "Memperbarui hasil yang terlihat...",
    "results.showingOf": "Menampilkan {visible} dari {total} lowongan",
    "results.loadingMore": "Memuat lowongan lain...",
    "results.allLoaded": "Semua lowongan yang terlihat sudah dimuat"
  }),
  sv: createPublicLanguagePack({
    "results.eyebrow": "Publik sökning",
    "results.title": "Öppna roller",
    "search.heroTitle": "Sök öppna jobb",
    "search.lead": "Hitta färska jobb från publika ATS-jobbtavlor.",
    "search.label": "Sök jobb",
    "search.placeholder": "Sök titel, företag, plats eller land",
    "search.placeholderShort": "Sök jobb eller företag",
    "search.shortcut": "Enter för sök · Esc för att rensa",
    "seo.popularSearches": "Populära sökningar",
    "search.clear": "Rensa",
    "filters.show": "Filter",
    "filters.hide": "Dölj filter",
    "filters.global.title": "Global sökning",
    "filters.global.copy": "Sökningen är global tills ett platsfilter väljs.",
    "filters.industries": "Branscher",
    "filters.regions": "Regioner",
    "filters.countries": "Länder",
    "filters.states": "Län",
    "freshness.label": "Aktualitet",
    "freshness.all": "Alla datum",
    "remote.label": "Arbetssätt",
    "remote.all": "Alla platser",
    "remote.remote": "Endast remote",
    "remote.hybrid": "Endast hybrid",
    "remote.nonRemote": "På plats / okänt",
    "sources.title": "Källor i resultat",
    "results.search": "Sök",
    "results.searchPrompt": "Sök jobb",
    "results.slot": "jobb",
    "results.slots": "jobb",
    "results.slotIndexed": "jobb",
    "results.slotsIndexed": "jobb",
    "initial.title": "Sök färska publika ATS-jobb.",
    "initial.copy": "Börja med titel, företag, plats, land eller arbetssätt.",
    "sort.relevance": "Relevans",
    "sort.last_seen": "Färsk källa",
    "sort.posted_date": "Publiceringsdatum",
    "sort.confidence": "Förtroende",
    "theme.day": "Dag",
    "theme.night": "Natt",
    "language.label": "Språk",
    "version.label": "Publik v{version}",
    "credit.deployed": "Publicerad och utvecklad av",
    "release.title": "Versionsnotiser",
    "release.close": "Stäng",
    "release.versionLabel": "Version {version}",
    "release.genericTitle": "Uppdatering av publik sökning",
    "release.genericSummary": "Den här versionen förbättrar publik sökning, datakvalitet, täckning och produktionsstabilitet.",
    "stats.jobSlots": "jobb",
    "stats.companies": "företag",
    "suggestion.title": "Titel",
    "suggestion.company": "Företag",
    "suggestion.location": "Plats",
    "suggestion.country": "Land",
    "suggestion.region": "Region",
    "suggestion.industry": "Bransch",
    "dropdown.search": "Sök {label}",
    "dropdown.clear": "Rensa {label}",
    "posting.dateUnavailable": "Publiceringsdatum saknas",
    "empty.noSlotsExact": "Inga jobb matchar sökningen exakt.",
    "empty.tryDifferent": "Prova en annan titel, källa, plats eller tidsperiod.",
    "empty.clearFilters": "Rensa filter",
    "results.updating": "Uppdaterar synliga resultat...",
    "results.showingOf": "Visar {visible} av {total} jobb",
    "results.loadingMore": "Läser in fler jobb...",
    "results.allLoaded": "Alla synliga jobb är inlästa"
  }),
  da: createPublicLanguagePack({
    "results.eyebrow": "Offentlig søgning",
    "results.title": "Åbne roller",
    "search.heroTitle": "Søg ledige job",
    "search.lead": "Find friske opslag fra offentlige ATS-jobboards.",
    "search.label": "Søg job",
    "search.placeholder": "Søg titel, virksomhed, sted eller land",
    "search.placeholderShort": "Søg job eller firmaer",
    "search.shortcut": "Enter for søgning · Esc for at rydde",
    "seo.popularSearches": "Populære søgninger",
    "search.clear": "Ryd",
    "filters.show": "Filtre",
    "filters.hide": "Skjul filtre",
    "filters.global.title": "Global søgning",
    "filters.global.copy": "Søgningen forbliver global, indtil et stedfilter vælges.",
    "filters.industries": "Brancher",
    "filters.regions": "Regioner",
    "filters.countries": "Lande",
    "filters.states": "Regioner",
    "freshness.label": "Friskhed",
    "freshness.all": "Alle datoer",
    "remote.label": "Arbejdsform",
    "remote.all": "Alle steder",
    "remote.remote": "Kun remote",
    "remote.hybrid": "Kun hybrid",
    "remote.nonRemote": "På kontor / ukendt",
    "sources.title": "Kilder i resultater",
    "results.search": "Søg",
    "results.searchPrompt": "Søg job",
    "results.slot": "job",
    "results.slots": "job",
    "results.slotIndexed": "job",
    "results.slotsIndexed": "job",
    "initial.title": "Søg friske offentlige ATS-job.",
    "initial.copy": "Start med titel, virksomhed, sted, land eller arbejdsform.",
    "sort.relevance": "Relevans",
    "sort.last_seen": "Frisk kilde",
    "sort.posted_date": "Opslagsdato",
    "sort.confidence": "Tillid",
    "theme.day": "Dag",
    "theme.night": "Nat",
    "language.label": "Sprog",
    "version.label": "Offentlig v{version}",
    "credit.deployed": "Publiceret og udviklet af",
    "release.title": "Versionsnoter",
    "release.close": "Luk",
    "release.versionLabel": "Version {version}",
    "release.genericTitle": "Opdatering af offentlig søgning",
    "release.genericSummary": "Denne version forbedrer offentlig søgning, datakvalitet, dækning og produktionsstabilitet.",
    "stats.jobSlots": "job",
    "stats.companies": "virksomheder",
    "suggestion.title": "Titel",
    "suggestion.company": "Virksomhed",
    "suggestion.location": "Sted",
    "suggestion.country": "Land",
    "suggestion.region": "Region",
    "suggestion.industry": "Branche",
    "dropdown.search": "Søg {label}",
    "dropdown.clear": "Ryd {label}",
    "posting.dateUnavailable": "Opslagsdato ikke tilgængelig",
    "empty.noSlotsExact": "Ingen job matcher denne søgning præcist.",
    "empty.tryDifferent": "Prøv en anden titel, kilde, placering eller periode.",
    "empty.clearFilters": "Ryd filtre",
    "results.updating": "Opdaterer synlige resultater...",
    "results.showingOf": "Viser {visible} af {total} job",
    "results.loadingMore": "Indlæser flere job...",
    "results.allLoaded": "Alle synlige job er indlæst"
  }),
  no: createPublicLanguagePack({
    "results.eyebrow": "Offentlig søk",
    "results.title": "Åpne roller",
    "search.heroTitle": "Søk åpne jobber",
    "search.lead": "Finn ferske stillinger fra offentlige ATS-jobbtavler.",
    "search.label": "Søk jobber",
    "search.placeholder": "Søk tittel, selskap, sted eller land",
    "search.placeholderShort": "Søk jobber eller selskaper",
    "search.shortcut": "Enter for å søke · Esc for å tømme",
    "seo.popularSearches": "Populære søk",
    "search.clear": "Tøm",
    "filters.show": "Filtre",
    "filters.hide": "Skjul filtre",
    "filters.global.title": "Globalt søk",
    "filters.global.copy": "Søket er globalt til et stedsfilter velges.",
    "filters.industries": "Bransjer",
    "filters.regions": "Regioner",
    "filters.countries": "Land",
    "filters.states": "Fylker",
    "freshness.label": "Ferskhet",
    "freshness.all": "Alle datoer",
    "remote.label": "Arbeidsform",
    "remote.all": "Alle steder",
    "remote.remote": "Bare remote",
    "remote.hybrid": "Bare hybrid",
    "remote.nonRemote": "På kontor / ukjent",
    "sources.title": "Kilder i resultater",
    "results.search": "Søk",
    "results.searchPrompt": "Søk jobber",
    "results.slot": "jobb",
    "results.slots": "jobber",
    "results.slotIndexed": "jobb",
    "results.slotsIndexed": "jobber",
    "initial.title": "Søk ferske offentlige ATS-jobber.",
    "initial.copy": "Start med tittel, selskap, sted, land eller arbeidsform.",
    "sort.relevance": "Relevans",
    "sort.last_seen": "Fersk kilde",
    "sort.posted_date": "Publiseringsdato",
    "sort.confidence": "Tillit",
    "theme.day": "Dag",
    "theme.night": "Natt",
    "language.label": "Språk",
    "version.label": "Offentlig v{version}",
    "credit.deployed": "Publisert og utviklet av",
    "release.title": "Versjonsnotater",
    "release.close": "Lukk",
    "release.versionLabel": "Versjon {version}",
    "release.genericTitle": "Oppdatering av offentlig søk",
    "release.genericSummary": "Denne versjonen forbedrer offentlig søk, datakvalitet, dekning og produksjonsstabilitet.",
    "stats.jobSlots": "jobber",
    "stats.companies": "selskaper",
    "suggestion.title": "Tittel",
    "suggestion.company": "Selskap",
    "suggestion.location": "Sted",
    "suggestion.country": "Land",
    "suggestion.region": "Region",
    "suggestion.industry": "Bransje",
    "dropdown.search": "Søk {label}",
    "dropdown.clear": "Tøm {label}",
    "posting.dateUnavailable": "Publiseringsdato mangler",
    "empty.noSlotsExact": "Ingen jobber matcher søket nøyaktig.",
    "empty.tryDifferent": "Prøv en annen tittel, kilde, plassering eller periode.",
    "empty.clearFilters": "Tøm filtre",
    "results.updating": "Oppdaterer synlige resultater...",
    "results.showingOf": "Viser {visible} av {total} jobber",
    "results.loadingMore": "Laster flere jobber...",
    "results.allLoaded": "Alle synlige jobber er lastet"
  }),
  fi: createPublicLanguagePack({
    "results.eyebrow": "Julkinen haku",
    "results.title": "Avoimet roolit",
    "search.heroTitle": "Etsi avoimia työpaikkoja",
    "search.lead": "Löydä tuoreet ilmoitukset julkisilta ATS-työpaikkasivuilta.",
    "search.label": "Etsi työpaikkoja",
    "search.placeholder": "Etsi nimike, yritys, sijainti tai maa",
    "search.placeholderShort": "Hae työpaikkoja tai yrityksiä",
    "search.shortcut": "Enter hakee · Esc tyhjentää",
    "seo.popularSearches": "Suositut haut",
    "search.clear": "Tyhjennä",
    "filters.show": "Suodattimet",
    "filters.hide": "Piilota suodattimet",
    "filters.global.title": "Globaali haku",
    "filters.global.copy": "Haku pysyy globaalina, kunnes sijaintisuodatin valitaan.",
    "filters.industries": "Toimialat",
    "filters.regions": "Alueet",
    "filters.countries": "Maat",
    "filters.states": "Maakunnat",
    "freshness.label": "Tuoreus",
    "freshness.all": "Mikä tahansa päivä",
    "remote.label": "Työmuoto",
    "remote.all": "Kaikki sijainnit",
    "remote.remote": "Vain etätyö",
    "remote.hybrid": "Vain hybridi",
    "remote.nonRemote": "Toimistolla / tuntematon",
    "sources.title": "Tulosten lähteet",
    "results.search": "Etsi",
    "results.searchPrompt": "Etsi töitä",
    "results.slot": "työpaikka",
    "results.slots": "työpaikkaa",
    "results.slotIndexed": "työpaikka",
    "results.slotsIndexed": "työpaikkaa",
    "initial.title": "Etsi tuoreita julkisia ATS-työpaikkoja.",
    "initial.copy": "Aloita nimikkeellä, yrityksellä, sijainnilla, maalla tai työmuodolla.",
    "sort.relevance": "Osuvuus",
    "sort.last_seen": "Tuore lähde",
    "sort.posted_date": "Julkaisupäivä",
    "sort.confidence": "Luottamus",
    "theme.day": "Päivä",
    "theme.night": "Yö",
    "language.label": "Kieli",
    "version.label": "Julkinen v{version}",
    "credit.deployed": "Julkaissut ja kehittänyt",
    "release.title": "Julkaisutiedot",
    "release.close": "Sulje",
    "release.versionLabel": "Versio {version}",
    "release.genericTitle": "Julkisen haun päivitys",
    "release.genericSummary": "Tämä julkaisu paransi julkista hakua, datan laatua, kattavuutta ja tuotantoluotettavuutta.",
    "stats.jobSlots": "työpaikkaa",
    "stats.companies": "yritystä",
    "suggestion.title": "Nimike",
    "suggestion.company": "Yritys",
    "suggestion.location": "Sijainti",
    "suggestion.country": "Maa",
    "suggestion.region": "Alue",
    "suggestion.industry": "Toimiala",
    "dropdown.search": "Etsi {label}",
    "dropdown.clear": "Tyhjennä {label}",
    "posting.dateUnavailable": "Julkaisupäivä ei ole saatavilla",
    "empty.noSlotsExact": "Mikään työpaikka ei vastaa hakua täsmälleen.",
    "empty.tryDifferent": "Kokeile toista nimikettä, lähdettä, sijaintia tai ajanjaksoa.",
    "empty.clearFilters": "Tyhjennä suodattimet",
    "results.updating": "Päivitetään näkyviä tuloksia...",
    "results.showingOf": "Näytetään {visible} / {total} työpaikkaa",
    "results.loadingMore": "Ladataan lisää työpaikkoja...",
    "results.allLoaded": "Kaikki näkyvät työpaikat on ladattu"
  })
});
function buildPublicLanguagePackSupplement(copy = {}) {
  return {
    "search.examplePrefix": copy.examplePrefix,
    "filters.loading": copy.filtersLoading,
    "filters.global.locationTitle": copy.locationTitle,
    "filters.global.locationCopy": copy.locationCopy,
    "filters.ats": copy.ats,
    "filters.ats.any": copy.allAts,
    "filters.industries.any": copy.anyIndustry,
    "filters.regions.any": copy.worldwide,
    "filters.countries.any": copy.allCountries,
    "filters.states.any": copy.allStates,
    "filters.counties": copy.counties,
    "filters.counties.any": copy.allCounties,
    "filters.industries.empty": copy.noIndustries,
    "filters.industries.helper": copy.industriesHelper,
    "filters.regions.empty": copy.regionsEmpty,
    "filters.regions.helper": copy.regionsHelper,
    "filters.countries.emptyRegion": copy.countriesEmptyRegion,
    "filters.countries.empty": copy.countriesEmpty,
    "filters.countries.helperRegion": copy.countriesHelperRegion,
    "filters.countries.helper": copy.countriesHelper,
    "filters.states.empty": copy.statesEmpty,
    "filters.states.helper": copy.statesHelper,
    "filters.counties.empty": copy.countiesEmpty,
    "filters.counties.helper": copy.countiesHelper,
    "filters.countryHint": copy.countryHint,
    "filters.stateHint": copy.stateHint,
    "freshness.3": copy.freshness3,
    "freshness.7": copy.freshness7,
    "freshness.30": copy.freshness30,
    "remote.allShort": copy.anyShort,
    "remote.remoteShort": copy.remoteShort,
    "remote.hybridShort": copy.hybridShort,
    "remote.nonRemoteShort": copy.onSiteShort,
    "remote.hideNoDate": copy.hideNoDate,
    "sources.empty": copy.sourcesEmpty,
    "results.toSeeSlots": copy.toSeeSlots,
    "results.indexLoading": copy.indexLoading,
    "sort.ats_source": copy.sortAtsSource,
    "release.closeA11y": copy.releaseCloseA11y,
    "release.historyLabel": copy.releaseHistoryLabel,
    "release.openA11y": copy.releaseOpenA11y,
    "stats.ats": copy.ats,
    "suggestion.search": copy.suggestionSearch,
    "suggestion.recent": copy.suggestionRecent,
    "suggestion.ats": copy.ats,
    "dropdown.empty": copy.dropdownEmpty,
    "dropdown.noMatch": copy.dropdownNoMatch,
    "dropdown.showing": copy.dropdownShowing,
    "sources.result": copy.sourceResult,
    "sources.results": copy.sourceResults,
    "sources.confidence": copy.sourceConfidence,
    "sources.quality": copy.sourceQuality,
    "sources.freshSeen": copy.sourceFreshSeen,
    "sources.currentSet": copy.sourceCurrentSet,
    "search.intentDetected": copy.intentDetected,
    "posting.atsLabel": copy.ats,
    "empty.searchAllLocations": copy.searchAllLocations,
    "empty.allWorkModes": copy.allWorkModes,
    "results.scrollMore": copy.scrollMore,
    ...(copy.extra || {})
  };
}

const PUBLIC_LANGUAGE_PACK_COMPLETION_COPY = Object.freeze({
  "pt-BR": {
    examplePrefix: "Tente",
    filtersLoading: "Carregando filtros...",
    locationTitle: "Local filtrado",
    locationCopy: "Filtros de região e país estão ativos.",
    ats: "ATS",
    allAts: "Todos os ATS",
    anyIndustry: "Qualquer setor",
    worldwide: "Mundo todo",
    allCountries: "Todos os países",
    allStates: "Todos os estados/províncias",
    counties: "Condados",
    allCounties: "Todos os condados",
    noIndustries: "Nenhum setor disponível.",
    industriesHelper: "Opcional. Deixe vazio para buscar todos os setores indexados.",
    regionsEmpty: "A busca mundial está ativa. Metadados de região ainda não foram indexados.",
    regionsHelper: "Comece por continente e depois refine por país quando fizer sentido.",
    countriesEmptyRegion: "Nenhum país corresponde à região selecionada. Limpe Regiões para buscar no mundo todo.",
    countriesEmpty: "Nenhum país corresponde. A busca mundial continua ativa.",
    countriesHelperRegion: "Os países estão limitados pela região selecionada.",
    countriesHelper: "Deixe vazio para incluir todos os países.",
    statesEmpty: "Nenhum estado ou província foi indexado para os países selecionados.",
    statesHelper: "Aparece após escolher um país. Deixe vazio para incluir todos os estados/províncias.",
    countiesEmpty: "Nenhum condado corresponde aos estados selecionados.",
    countiesHelper: "Aparece após escolher um estado quando a fonte inclui metadados de condado.",
    countryHint: "Escolha um país para refinar por estado ou província.",
    stateHint: "Escolha um estado/província para refinar por condado quando houver dados.",
    freshness3: "3 dias",
    freshness7: "7 dias",
    freshness30: "30 dias",
    anyShort: "Qualquer",
    remoteShort: "Remoto",
    hybridShort: "Híbrido",
    onSiteShort: "Presencial",
    hideNoDate: "Ocultar vagas sem data",
    sourcesEmpty: "Faça uma busca para ver fontes no conjunto atual.",
    toSeeSlots: "para ver vagas",
    indexLoading: "Carregando índice",
    sortAtsSource: "ATS/fonte",
    releaseCloseA11y: "Fechar notas da versão",
    releaseHistoryLabel: "Histórico de versões",
    releaseOpenA11y: "Abrir notas da versão {version}",
    suggestionSearch: "Busca",
    suggestionRecent: "Recente",
    dropdownEmpty: "{label} ainda não foram indexados. A busca mundial continua ativa.",
    dropdownNoMatch: "Nenhum {label} corresponde a \"{search}\".",
    dropdownShowing: "Mostrando {visible} de {total} {label}.",
    sourceResult: "resultado",
    sourceResults: "resultados",
    sourceConfidence: "Conf.",
    sourceQuality: "Qualidade",
    sourceFreshSeen: "{fresh}% recentes - visto em {date}",
    sourceCurrentSet: "{fresh}% recentes - conjunto atual",
    intentDetected: "Intenção detectada",
    searchAllLocations: "Buscar em todos os locais",
    allWorkModes: "Todos os modos de trabalho",
    scrollMore: "Role para carregar mais"
  },
  "pt-PT": {
    examplePrefix: "Experimenta",
    filtersLoading: "A carregar filtros...",
    locationTitle: "Local filtrado",
    locationCopy: "Os filtros de região e país estão ativos.",
    ats: "ATS",
    allAts: "Todos os ATS",
    anyIndustry: "Qualquer setor",
    worldwide: "Mundo inteiro",
    allCountries: "Todos os países",
    allStates: "Todos os distritos/províncias",
    counties: "Concelhos",
    allCounties: "Todos os concelhos",
    noIndustries: "Nenhum setor disponível.",
    industriesHelper: "Opcional. Deixa vazio para pesquisar todos os setores indexados.",
    regionsEmpty: "A pesquisa mundial está ativa. Os metadados de região ainda não foram indexados.",
    regionsHelper: "Começa por continente e depois refina por país quando for útil.",
    countriesEmptyRegion: "Nenhum país corresponde à região selecionada. Limpa Regiões para pesquisar no mundo inteiro.",
    countriesEmpty: "Nenhum país corresponde. A pesquisa mundial continua ativa.",
    countriesHelperRegion: "Os países estão limitados pela região selecionada.",
    countriesHelper: "Deixa vazio para incluir todos os países.",
    statesEmpty: "Nenhum distrito ou província foi indexado para os países selecionados.",
    statesHelper: "Mostrado após escolher um país. Deixa vazio para incluir todos os distritos/províncias.",
    countiesEmpty: "Nenhum concelho corresponde aos distritos selecionados.",
    countiesHelper: "Mostrado após escolher um distrito quando a fonte inclui metadados de concelho.",
    countryHint: "Escolhe um país para refinar por distrito ou província.",
    stateHint: "Escolhe um distrito/província para refinar por concelho quando houver dados.",
    freshness3: "3 dias",
    freshness7: "7 dias",
    freshness30: "30 dias",
    anyShort: "Qualquer",
    remoteShort: "Remoto",
    hybridShort: "Híbrido",
    onSiteShort: "Presencial",
    hideNoDate: "Ocultar vagas sem data",
    sourcesEmpty: "Faz uma pesquisa para ver fontes no conjunto atual.",
    toSeeSlots: "para ver vagas",
    indexLoading: "A carregar índice",
    sortAtsSource: "ATS/fonte",
    releaseCloseA11y: "Fechar notas da versão",
    releaseHistoryLabel: "Histórico de versões",
    releaseOpenA11y: "Abrir notas da versão {version}",
    suggestionSearch: "Pesquisa",
    suggestionRecent: "Recente",
    dropdownEmpty: "{label} ainda não foram indexados. A pesquisa mundial continua ativa.",
    dropdownNoMatch: "Nenhum {label} corresponde a \"{search}\".",
    dropdownShowing: "A mostrar {visible} de {total} {label}.",
    sourceResult: "resultado",
    sourceResults: "resultados",
    sourceConfidence: "Conf.",
    sourceQuality: "Qualidade",
    sourceFreshSeen: "{fresh}% recentes - visto em {date}",
    sourceCurrentSet: "{fresh}% recentes - conjunto atual",
    intentDetected: "Intenção detetada",
    searchAllLocations: "Pesquisar em todos os locais",
    allWorkModes: "Todos os modos de trabalho",
    scrollMore: "Desce para carregar mais"
  },
  it: {
    examplePrefix: "Prova",
    filtersLoading: "Caricamento filtri...",
    locationTitle: "Località filtrata",
    locationCopy: "I filtri di regione e paese sono attivi.",
    ats: "ATS",
    allAts: "Tutti gli ATS",
    anyIndustry: "Qualsiasi settore",
    worldwide: "Tutto il mondo",
    allCountries: "Tutti i paesi",
    allStates: "Tutti gli stati/province",
    counties: "Contee",
    allCounties: "Tutte le contee",
    noIndustries: "Nessun settore disponibile.",
    industriesHelper: "Facoltativo. Lascia vuoto per cercare in tutti i settori indicizzati.",
    regionsEmpty: "La ricerca mondiale è attiva. I metadati regionali non sono ancora indicizzati.",
    regionsHelper: "Parti dal continente, poi restringi ai paesi quando serve.",
    countriesEmptyRegion: "Nessun paese corrisponde alla regione selezionata. Cancella Regioni per cercare ovunque.",
    countriesEmpty: "Nessun paese corrisponde. La ricerca mondiale resta attiva.",
    countriesHelperRegion: "I paesi sono limitati dalla regione selezionata.",
    countriesHelper: "Lascia vuoto per includere tutti i paesi.",
    statesEmpty: "Nessuno stato o provincia è indicizzato per i paesi selezionati.",
    statesHelper: "Compare dopo la scelta del paese. Lascia vuoto per includere tutti gli stati/province.",
    countiesEmpty: "Nessuna contea corrisponde agli stati selezionati.",
    countiesHelper: "Compare dopo la scelta dello stato quando la fonte include metadati di contea.",
    countryHint: "Scegli un paese per restringere per stato o provincia.",
    stateHint: "Scegli uno stato/provincia per restringere per contea quando ci sono dati.",
    freshness3: "3 giorni",
    freshness7: "7 giorni",
    freshness30: "30 giorni",
    anyShort: "Qualsiasi",
    remoteShort: "Remoto",
    hybridShort: "Ibrido",
    onSiteShort: "In sede",
    hideNoDate: "Nascondi offerte senza data",
    sourcesEmpty: "Esegui una ricerca per vedere le fonti del set corrente.",
    toSeeSlots: "per vedere le offerte",
    indexLoading: "Caricamento indice",
    sortAtsSource: "ATS/fonte",
    releaseCloseA11y: "Chiudi note di rilascio",
    releaseHistoryLabel: "Cronologia note di rilascio",
    releaseOpenA11y: "Apri note di rilascio della versione {version}",
    suggestionSearch: "Ricerca",
    suggestionRecent: "Recente",
    dropdownEmpty: "{label} non sono ancora indicizzati. La ricerca mondiale resta attiva.",
    dropdownNoMatch: "Nessun {label} corrisponde a \"{search}\".",
    dropdownShowing: "Mostrati {visible} di {total} {label}.",
    sourceResult: "risultato",
    sourceResults: "risultati",
    sourceConfidence: "Conf.",
    sourceQuality: "Qualità",
    sourceFreshSeen: "{fresh}% freschi - visto {date}",
    sourceCurrentSet: "{fresh}% freschi - set corrente",
    intentDetected: "Intento rilevato",
    searchAllLocations: "Cerca in tutte le località",
    allWorkModes: "Tutte le modalità di lavoro",
    scrollMore: "Scorri per caricare altro"
  },
  nl: {
    examplePrefix: "Probeer",
    filtersLoading: "Filters laden...",
    locationTitle: "Gefilterde locatie",
    locationCopy: "Regio- en landfilters zijn actief.",
    ats: "ATS",
    allAts: "Alle ATS",
    anyIndustry: "Elke sector",
    worldwide: "Wereldwijd",
    allCountries: "Alle landen",
    allStates: "Alle staten/provincies",
    counties: "Districten",
    allCounties: "Alle districten",
    noIndustries: "Geen sectoren beschikbaar.",
    industriesHelper: "Optioneel. Laat leeg om elke geïndexeerde sector te doorzoeken.",
    regionsEmpty: "Wereldwijd zoeken is actief. Regiometadata is nog niet geïndexeerd.",
    regionsHelper: "Begin breed per continent en verfijn daarna naar landen wanneer nuttig.",
    countriesEmptyRegion: "Geen landen passen bij de gekozen regio. Wis Regio's om wereldwijd te zoeken.",
    countriesEmpty: "Geen landen gevonden. Wereldwijd zoeken blijft actief.",
    countriesHelperRegion: "Landen zijn beperkt door de gekozen regio.",
    countriesHelper: "Laat leeg om elk land mee te nemen.",
    statesEmpty: "Geen staten of provincies zijn geïndexeerd voor de gekozen landen.",
    statesHelper: "Verschijnt na landkeuze. Laat leeg om alle staten/provincies mee te nemen.",
    countiesEmpty: "Geen districten passen bij de gekozen staten.",
    countiesHelper: "Verschijnt na staatskeuze wanneer bronnen districtmetadata bevatten.",
    countryHint: "Kies een land om te verfijnen op staat of provincie.",
    stateHint: "Kies een staat/provincie om te verfijnen op county wanneer data bestaat.",
    freshness3: "3 dagen",
    freshness7: "7 dagen",
    freshness30: "30 dagen",
    anyShort: "Elke",
    remoteShort: "Remote",
    hybridShort: "Hybride",
    onSiteShort: "Op locatie",
    hideNoDate: "Verberg vacatures zonder datum",
    sourcesEmpty: "Voer een zoekopdracht uit om bronnen in de huidige set te zien.",
    toSeeSlots: "om vacatures te zien",
    indexLoading: "Index laden",
    sortAtsSource: "ATS/bron",
    releaseCloseA11y: "Release-opmerkingen sluiten",
    releaseHistoryLabel: "Geschiedenis van release-opmerkingen",
    releaseOpenA11y: "Release-opmerkingen voor versie {version} openen",
    suggestionSearch: "Zoekopdracht",
    suggestionRecent: "Recent",
    dropdownEmpty: "{label} zijn nog niet geïndexeerd. Wereldwijd zoeken blijft actief.",
    dropdownNoMatch: "Geen {label} past bij \"{search}\".",
    dropdownShowing: "{visible} van {total} {label} getoond.",
    sourceResult: "resultaat",
    sourceResults: "resultaten",
    sourceConfidence: "Vertr.",
    sourceQuality: "Kwaliteit",
    sourceFreshSeen: "{fresh}% recent - gezien {date}",
    sourceCurrentSet: "{fresh}% recent - huidige set",
    intentDetected: "Intentie herkend",
    searchAllLocations: "Zoek in alle locaties",
    allWorkModes: "Alle werkmodi",
    scrollMore: "Scroll om meer te laden"
  },
  pl: {
    examplePrefix: "Spróbuj",
    filtersLoading: "Ładowanie filtrów...",
    locationTitle: "Filtrowana lokalizacja",
    locationCopy: "Filtry regionu i kraju są aktywne.",
    ats: "ATS",
    allAts: "Wszystkie ATS",
    anyIndustry: "Dowolna branża",
    worldwide: "Cały świat",
    allCountries: "Wszystkie kraje",
    allStates: "Wszystkie stany/prowincje",
    counties: "Powiaty",
    allCounties: "Wszystkie powiaty",
    noIndustries: "Brak dostępnych branż.",
    industriesHelper: "Opcjonalne. Zostaw puste, aby szukać we wszystkich indeksowanych branżach.",
    regionsEmpty: "Aktywne jest wyszukiwanie globalne. Metadane regionów nie są jeszcze indeksowane.",
    regionsHelper: "Zacznij szeroko od kontynentu, potem zawęź do krajów.",
    countriesEmptyRegion: "Żaden kraj nie pasuje do wybranego regionu. Wyczyść Regiony, aby szukać globalnie.",
    countriesEmpty: "Żaden kraj nie pasuje. Wyszukiwanie globalne nadal działa.",
    countriesHelperRegion: "Kraje są ograniczone przez wybrany region.",
    countriesHelper: "Zostaw puste, aby uwzględnić wszystkie kraje.",
    statesEmpty: "Brak stanów lub prowincji dla wybranych krajów.",
    statesHelper: "Widoczne po wyborze kraju. Zostaw puste, aby uwzględnić wszystkie stany/prowincje.",
    countiesEmpty: "Żaden powiat nie pasuje do wybranych stanów.",
    countiesHelper: "Widoczne po wyborze stanu, jeśli źródło zawiera metadane powiatu.",
    countryHint: "Wybierz kraj, aby zawęzić według stanu lub prowincji.",
    stateHint: "Wybierz stan/prowincję, aby zawęzić według powiatu, gdy dane istnieją.",
    freshness3: "3 dni",
    freshness7: "7 dni",
    freshness30: "30 dni",
    anyShort: "Dowolne",
    remoteShort: "Zdalnie",
    hybridShort: "Hybrydowo",
    onSiteShort: "Na miejscu",
    hideNoDate: "Ukryj oferty bez daty",
    sourcesEmpty: "Uruchom wyszukiwanie, aby zobaczyć źródła w bieżącym zestawie.",
    toSeeSlots: "aby zobaczyć oferty",
    indexLoading: "Ładowanie indeksu",
    sortAtsSource: "ATS/źródło",
    releaseCloseA11y: "Zamknij informacje o wersji",
    releaseHistoryLabel: "Historia informacji o wersjach",
    releaseOpenA11y: "Otwórz informacje o wersji {version}",
    suggestionSearch: "Wyszukiwanie",
    suggestionRecent: "Ostatnie",
    dropdownEmpty: "{label} nie są jeszcze indeksowane. Wyszukiwanie globalne nadal działa.",
    dropdownNoMatch: "Brak {label} pasujących do \"{search}\".",
    dropdownShowing: "Pokazano {visible} z {total} {label}.",
    sourceResult: "wynik",
    sourceResults: "wyniki",
    sourceConfidence: "Pewn.",
    sourceQuality: "Jakość",
    sourceFreshSeen: "{fresh}% świeże - widziane {date}",
    sourceCurrentSet: "{fresh}% świeże - bieżący zestaw",
    intentDetected: "Wykryta intencja",
    searchAllLocations: "Szukaj we wszystkich lokalizacjach",
    allWorkModes: "Wszystkie tryby pracy",
    scrollMore: "Przewiń, aby załadować więcej"
  },
  ja: {
    examplePrefix: "例",
    filtersLoading: "フィルターを読み込み中...",
    locationTitle: "絞り込み済みの地域",
    locationCopy: "地域と国のフィルターが有効です。",
    ats: "ATS",
    allAts: "すべてのATS",
    anyIndustry: "すべての業界",
    worldwide: "全世界",
    allCountries: "すべての国",
    allStates: "すべての州/都道府県",
    counties: "郡",
    allCounties: "すべての郡",
    noIndustries: "利用できる業界はありません。",
    industriesHelper: "任意です。空のままにすると、すべてのインデックス済み業界を検索します。",
    regionsEmpty: "全世界検索が有効です。地域メタデータはまだインデックスされていません。",
    regionsHelper: "大陸から広く始め、必要に応じて国へ絞り込みます。",
    countriesEmptyRegion: "選択した地域に一致する国はありません。地域をクリアすると全世界を検索します。",
    countriesEmpty: "一致する国はありません。全世界検索は有効なままです。",
    countriesHelperRegion: "国は選択した地域で制限されています。",
    countriesHelper: "空のままにすると、すべての国を含めます。",
    statesEmpty: "選択した国に州または都道府県はインデックスされていません。",
    statesHelper: "国を選択すると表示されます。空のままにすると、すべての州/都道府県を含めます。",
    countiesEmpty: "選択した州に一致する郡はありません。",
    countiesHelper: "郡メタデータを含むソースでは、州の選択後に表示されます。",
    countryHint: "州または都道府県で絞り込むには国を選択してください。",
    stateHint: "郡データがある場合、州/都道府県を選択して郡で絞り込みます。",
    freshness3: "3日",
    freshness7: "7日",
    freshness30: "30日",
    anyShort: "すべて",
    remoteShort: "リモート",
    hybridShort: "ハイブリッド",
    onSiteShort: "出社",
    hideNoDate: "日付のない求人を非表示",
    sourcesEmpty: "検索すると現在の結果セットのソースが表示されます。",
    toSeeSlots: "求人を見る",
    indexLoading: "インデックスを読み込み中",
    sortAtsSource: "ATS/ソース",
    releaseCloseA11y: "リリースノートを閉じる",
    releaseHistoryLabel: "リリースノート履歴",
    releaseOpenA11y: "バージョン {version} のリリースノートを開く",
    suggestionSearch: "検索",
    suggestionRecent: "最近",
    dropdownEmpty: "{label} はまだインデックスされていません。全世界検索は有効なままです。",
    dropdownNoMatch: "\"{search}\" に一致する {label} はありません。",
    dropdownShowing: "{total}件中{visible}件の{label}を表示。",
    sourceResult: "結果",
    sourceResults: "結果",
    sourceConfidence: "信頼",
    sourceQuality: "品質",
    sourceFreshSeen: "{fresh}% 新着 - {date} に確認",
    sourceCurrentSet: "{fresh}% 新着 - 現在のセット",
    intentDetected: "意図を検出",
    searchAllLocations: "すべての地域で検索",
    allWorkModes: "すべての勤務形態",
    scrollMore: "スクロールしてさらに読み込む"
  },
  ko: {
    examplePrefix: "예시",
    filtersLoading: "필터 로드 중...",
    locationTitle: "필터된 위치",
    locationCopy: "지역 및 국가 필터가 활성화되어 있습니다.",
    ats: "ATS",
    allAts: "모든 ATS",
    anyIndustry: "모든 산업",
    worldwide: "전 세계",
    allCountries: "모든 국가",
    allStates: "모든 주/도",
    counties: "카운티",
    allCounties: "모든 카운티",
    noIndustries: "사용 가능한 산업이 없습니다.",
    industriesHelper: "선택 사항입니다. 비워 두면 모든 색인된 산업을 검색합니다.",
    regionsEmpty: "전 세계 검색이 활성화되어 있습니다. 지역 메타데이터는 아직 색인되지 않았습니다.",
    regionsHelper: "대륙부터 넓게 시작한 뒤 필요하면 국가로 좁히세요.",
    countriesEmptyRegion: "선택한 지역과 일치하는 국가가 없습니다. 지역을 지우면 전 세계를 검색합니다.",
    countriesEmpty: "일치하는 국가가 없습니다. 전 세계 검색은 계속 활성화됩니다.",
    countriesHelperRegion: "국가는 선택한 지역으로 제한됩니다.",
    countriesHelper: "비워 두면 모든 국가를 포함합니다.",
    statesEmpty: "선택한 국가에 색인된 주 또는 도가 없습니다.",
    statesHelper: "국가 선택 후 표시됩니다. 비워 두면 모든 주/도를 포함합니다.",
    countiesEmpty: "선택한 주와 일치하는 카운티가 없습니다.",
    countiesHelper: "소스에 카운티 메타데이터가 있을 때 주 선택 후 표시됩니다.",
    countryHint: "주 또는 도로 좁히려면 국가를 선택하세요.",
    stateHint: "카운티 데이터가 있으면 주/도를 선택해 카운티로 좁히세요.",
    freshness3: "3일",
    freshness7: "7일",
    freshness30: "30일",
    anyShort: "전체",
    remoteShort: "원격",
    hybridShort: "하이브리드",
    onSiteShort: "현장",
    hideNoDate: "날짜 없는 공고 숨기기",
    sourcesEmpty: "검색하면 현재 결과 세트의 출처가 표시됩니다.",
    toSeeSlots: "공고를 보려면",
    indexLoading: "인덱스 로드 중",
    sortAtsSource: "ATS/출처",
    releaseCloseA11y: "릴리스 노트 닫기",
    releaseHistoryLabel: "릴리스 노트 기록",
    releaseOpenA11y: "버전 {version} 릴리스 노트 열기",
    suggestionSearch: "검색",
    suggestionRecent: "최근",
    dropdownEmpty: "{label}은 아직 색인되지 않았습니다. 전 세계 검색은 계속 활성화됩니다.",
    dropdownNoMatch: "\"{search}\"와 일치하는 {label}이 없습니다.",
    dropdownShowing: "{total}개 중 {visible}개 {label} 표시.",
    sourceResult: "결과",
    sourceResults: "결과",
    sourceConfidence: "신뢰도",
    sourceQuality: "품질",
    sourceFreshSeen: "{fresh}% 최신 - {date} 확인",
    sourceCurrentSet: "{fresh}% 최신 - 현재 세트",
    intentDetected: "의도 감지됨",
    searchAllLocations: "모든 위치에서 검색",
    allWorkModes: "모든 근무 방식",
    scrollMore: "더 보려면 스크롤"
  },
  "zh-CN": {
    examplePrefix: "试试",
    filtersLoading: "正在加载筛选...",
    locationTitle: "已筛选地点",
    locationCopy: "地区和国家筛选已启用。",
    ats: "ATS",
    allAts: "所有 ATS",
    anyIndustry: "任意行业",
    worldwide: "全球",
    allCountries: "所有国家",
    allStates: "所有州/省",
    counties: "县",
    allCounties: "所有县",
    noIndustries: "没有可用行业。",
    industriesHelper: "可选。留空即可搜索所有已索引行业。",
    regionsEmpty: "全球搜索已启用。地区元数据尚未索引。",
    regionsHelper: "先按洲广泛搜索，再按需缩小到国家。",
    countriesEmptyRegion: "没有国家匹配所选地区。清除地区即可全球搜索。",
    countriesEmpty: "没有匹配国家。全球搜索仍然有效。",
    countriesHelperRegion: "国家受所选地区限制。",
    countriesHelper: "留空即可包含所有国家。",
    statesEmpty: "所选国家没有已索引的州或省。",
    statesHelper: "选择国家后显示。留空即可包含所有州/省。",
    countiesEmpty: "没有县匹配所选州。",
    countiesHelper: "当来源包含县级元数据时，选择州后显示。",
    countryHint: "选择国家以按州或省缩小范围。",
    stateHint: "存在县级数据时，选择州/省以按县缩小范围。",
    freshness3: "3 天",
    freshness7: "7 天",
    freshness30: "30 天",
    anyShort: "任意",
    remoteShort: "远程",
    hybridShort: "混合",
    onSiteShort: "现场",
    hideNoDate: "隐藏无日期职位",
    sourcesEmpty: "运行搜索后可查看当前结果集的来源。",
    toSeeSlots: "查看职位",
    indexLoading: "正在加载索引",
    sortAtsSource: "ATS/来源",
    releaseCloseA11y: "关闭版本说明",
    releaseHistoryLabel: "版本说明历史",
    releaseOpenA11y: "打开版本 {version} 的说明",
    suggestionSearch: "搜索",
    suggestionRecent: "最近",
    dropdownEmpty: "{label} 尚未索引。全球搜索仍然有效。",
    dropdownNoMatch: "没有 {label} 匹配 \"{search}\"。",
    dropdownShowing: "显示 {visible} / {total} 个 {label}。",
    sourceResult: "结果",
    sourceResults: "结果",
    sourceConfidence: "可信度",
    sourceQuality: "质量",
    sourceFreshSeen: "{fresh}% 新鲜 - 见于 {date}",
    sourceCurrentSet: "{fresh}% 新鲜 - 当前集合",
    intentDetected: "已检测意图",
    searchAllLocations: "搜索所有地点",
    allWorkModes: "所有工作方式",
    scrollMore: "滚动加载更多"
  },
  hi: {
    examplePrefix: "आज़माएँ",
    filtersLoading: "फ़िल्टर लोड हो रहे हैं...",
    locationTitle: "फ़िल्टर किया गया स्थान",
    locationCopy: "क्षेत्र और देश फ़िल्टर सक्रिय हैं।",
    ats: "ATS",
    allAts: "सभी ATS",
    anyIndustry: "कोई भी उद्योग",
    worldwide: "दुनिया भर",
    allCountries: "सभी देश",
    allStates: "सभी राज्य/प्रांत",
    counties: "काउंटी",
    allCounties: "सभी काउंटी",
    noIndustries: "कोई उद्योग उपलब्ध नहीं है।",
    industriesHelper: "वैकल्पिक। सभी इंडेक्स किए गए उद्योगों में खोजने के लिए खाली छोड़ें।",
    regionsEmpty: "वैश्विक खोज सक्रिय है। क्षेत्र मेटाडेटा अभी इंडेक्स नहीं है।",
    regionsHelper: "पहले महाद्वीप से व्यापक खोज करें, फिर ज़रूरत हो तो देशों तक सीमित करें।",
    countriesEmptyRegion: "चुने गए क्षेत्र से कोई देश मेल नहीं खाता। वैश्विक खोज के लिए क्षेत्र साफ़ करें।",
    countriesEmpty: "कोई देश मेल नहीं खाता। वैश्विक खोज अभी भी सक्रिय है।",
    countriesHelperRegion: "देश चुने गए क्षेत्र तक सीमित हैं।",
    countriesHelper: "सभी देशों को शामिल करने के लिए खाली छोड़ें।",
    statesEmpty: "चुने गए देशों के लिए कोई राज्य या प्रांत इंडेक्स नहीं है।",
    statesHelper: "देश चुनने के बाद दिखता है। सभी राज्य/प्रांत शामिल करने के लिए खाली छोड़ें।",
    countiesEmpty: "चुने गए राज्यों से कोई काउंटी मेल नहीं खाती।",
    countiesHelper: "जब स्रोत में काउंटी मेटाडेटा हो तो राज्य चुनने के बाद दिखता है।",
    countryHint: "राज्य या प्रांत से सीमित करने के लिए देश चुनें।",
    stateHint: "काउंटी डेटा होने पर काउंटी से सीमित करने के लिए राज्य/प्रांत चुनें।",
    freshness3: "3 दिन",
    freshness7: "7 दिन",
    freshness30: "30 दिन",
    anyShort: "कोई भी",
    remoteShort: "दूरस्थ",
    hybridShort: "हाइब्रिड",
    onSiteShort: "ऑफ़िस",
    hideNoDate: "बिना तारीख वाली नौकरियां छिपाएँ",
    sourcesEmpty: "मौजूदा परिणामों के स्रोत देखने के लिए खोज चलाएँ।",
    toSeeSlots: "नौकरियां देखने के लिए",
    indexLoading: "इंडेक्स लोड हो रहा है",
    sortAtsSource: "ATS/स्रोत",
    releaseCloseA11y: "रिलीज़ नोट्स बंद करें",
    releaseHistoryLabel: "रिलीज़ नोट्स इतिहास",
    releaseOpenA11y: "संस्करण {version} के रिलीज़ नोट्स खोलें",
    suggestionSearch: "खोज",
    suggestionRecent: "हाल का",
    dropdownEmpty: "{label} अभी इंडेक्स नहीं हैं। वैश्विक खोज अभी भी सक्रिय है।",
    dropdownNoMatch: "\"{search}\" से कोई {label} मेल नहीं खाता।",
    dropdownShowing: "{total} में से {visible} {label} दिख रहे हैं।",
    sourceResult: "परिणाम",
    sourceResults: "परिणाम",
    sourceConfidence: "विश्वास",
    sourceQuality: "गुणवत्ता",
    sourceFreshSeen: "{fresh}% ताज़ा - {date} को देखा गया",
    sourceCurrentSet: "{fresh}% ताज़ा - मौजूदा सेट",
    intentDetected: "इरादा पहचाना गया",
    searchAllLocations: "सभी स्थानों में खोजें",
    allWorkModes: "काम के सभी तरीके",
    scrollMore: "और लोड करने के लिए स्क्रोल करें",
    extra: {
      "remote.remote": "केवल दूरस्थ",
      "remote.hybrid": "केवल हाइब्रिड",
      "results.searchPrompt": "नौकरियां खोजें",
      "results.slotIndexed": "नौकरी",
      "results.slotsIndexed": "नौकरियां",
      "initial.title": "ताज़ा सार्वजनिक ATS नौकरियां खोजें।",
      "version.label": "सार्वजनिक v{version}",
      "release.genericTitle": "सार्वजनिक खोज अपडेट",
      "release.genericSummary": "इस रिलीज़ ने सार्वजनिक खोज, डेटा गुणवत्ता, कवरेज और उत्पादन भरोसेमंदी को बेहतर किया।",
      "posting.dateUnavailable": "पोस्टिंग तारीख उपलब्ध नहीं",
      "empty.noSlotsExact": "इस खोज से कोई सटीक मेल नहीं मिला।"
    }
  },
  ar: {
    examplePrefix: "جرّب",
    filtersLoading: "جارٍ تحميل الفلاتر...",
    locationTitle: "موقع مفلتر",
    locationCopy: "فلاتر المنطقة والدولة نشطة.",
    ats: "ATS",
    allAts: "كل أنظمة ATS",
    anyIndustry: "أي قطاع",
    worldwide: "العالم كله",
    allCountries: "كل الدول",
    allStates: "كل الولايات/المقاطعات",
    counties: "المقاطعات",
    allCounties: "كل المقاطعات",
    noIndustries: "لا توجد قطاعات متاحة.",
    industriesHelper: "اختياري. اتركه فارغًا للبحث في كل القطاعات المفهرسة.",
    regionsEmpty: "البحث العالمي نشط. لم تتم فهرسة بيانات المناطق بعد.",
    regionsHelper: "ابدأ بالقارة ثم ضيّق إلى الدول عند الحاجة.",
    countriesEmptyRegion: "لا توجد دول تطابق المنطقة المحددة. امسح المناطق للبحث عالميًا.",
    countriesEmpty: "لا توجد دول مطابقة. البحث العالمي ما زال نشطًا.",
    countriesHelperRegion: "الدول محددة حسب المنطقة المختارة.",
    countriesHelper: "اتركه فارغًا لتضمين كل الدول.",
    statesEmpty: "لا توجد ولايات أو مقاطعات مفهرسة للدول المحددة.",
    statesHelper: "يظهر بعد اختيار الدولة. اتركه فارغًا لتضمين كل الولايات/المقاطعات.",
    countiesEmpty: "لا توجد مقاطعات تطابق الولايات المحددة.",
    countiesHelper: "يظهر بعد اختيار الولاية عندما يحتوي المصدر على بيانات مقاطعة.",
    countryHint: "اختر دولة للتضييق حسب الولاية أو المقاطعة.",
    stateHint: "اختر ولاية/مقاطعة للتضييق حسب المقاطعة عند توفر البيانات.",
    freshness3: "3 أيام",
    freshness7: "7 أيام",
    freshness30: "30 يومًا",
    anyShort: "أي",
    remoteShort: "عن بعد",
    hybridShort: "هجين",
    onSiteShort: "حضوري",
    hideNoDate: "إخفاء الوظائف بلا تاريخ",
    sourcesEmpty: "نفّذ بحثًا لرؤية المصادر في مجموعة النتائج الحالية.",
    toSeeSlots: "لرؤية الوظائف",
    indexLoading: "جارٍ تحميل الفهرس",
    sortAtsSource: "ATS/المصدر",
    releaseCloseA11y: "إغلاق ملاحظات الإصدار",
    releaseHistoryLabel: "سجل ملاحظات الإصدار",
    releaseOpenA11y: "فتح ملاحظات الإصدار {version}",
    suggestionSearch: "بحث",
    suggestionRecent: "حديث",
    dropdownEmpty: "{label} غير مفهرسة بعد. البحث العالمي ما زال نشطًا.",
    dropdownNoMatch: "لا يوجد {label} يطابق \"{search}\".",
    dropdownShowing: "عرض {visible} من {total} {label}.",
    sourceResult: "نتيجة",
    sourceResults: "نتائج",
    sourceConfidence: "الثقة",
    sourceQuality: "الجودة",
    sourceFreshSeen: "{fresh}% حديثة - شوهدت في {date}",
    sourceCurrentSet: "{fresh}% حديثة - المجموعة الحالية",
    intentDetected: "تم اكتشاف النية",
    searchAllLocations: "البحث في كل المواقع",
    allWorkModes: "كل أنماط العمل",
    scrollMore: "مرّر لتحميل المزيد"
  },
  id: {
    examplePrefix: "Coba",
    filtersLoading: "Memuat filter...",
    locationTitle: "Lokasi terfilter",
    locationCopy: "Filter wilayah dan negara aktif.",
    ats: "ATS",
    allAts: "Semua ATS",
    anyIndustry: "Industri apa pun",
    worldwide: "Seluruh dunia",
    allCountries: "Semua negara",
    allStates: "Semua negara bagian/provinsi",
    counties: "County",
    allCounties: "Semua county",
    noIndustries: "Tidak ada industri tersedia.",
    industriesHelper: "Opsional. Kosongkan untuk mencari semua industri yang diindeks.",
    regionsEmpty: "Pencarian global aktif. Metadata wilayah belum diindeks.",
    regionsHelper: "Mulai luas dari benua, lalu persempit ke negara bila perlu.",
    countriesEmptyRegion: "Tidak ada negara yang cocok dengan wilayah terpilih. Hapus Wilayah untuk mencari global.",
    countriesEmpty: "Tidak ada negara yang cocok. Pencarian global tetap aktif.",
    countriesHelperRegion: "Negara dibatasi oleh wilayah terpilih.",
    countriesHelper: "Kosongkan untuk menyertakan semua negara.",
    statesEmpty: "Tidak ada negara bagian atau provinsi yang diindeks untuk negara terpilih.",
    statesHelper: "Muncul setelah memilih negara. Kosongkan untuk menyertakan semua negara bagian/provinsi.",
    countiesEmpty: "Tidak ada county yang cocok dengan negara bagian terpilih.",
    countiesHelper: "Muncul setelah memilih negara bagian saat sumber menyertakan metadata county.",
    countryHint: "Pilih negara untuk mempersempit berdasarkan negara bagian atau provinsi.",
    stateHint: "Pilih negara bagian/provinsi untuk mempersempit berdasarkan county jika datanya ada.",
    freshness3: "3 hari",
    freshness7: "7 hari",
    freshness30: "30 hari",
    anyShort: "Apa pun",
    remoteShort: "Remote",
    hybridShort: "Hybrid",
    onSiteShort: "Kantor",
    hideNoDate: "Sembunyikan lowongan tanpa tanggal",
    sourcesEmpty: "Jalankan pencarian untuk melihat sumber di hasil saat ini.",
    toSeeSlots: "untuk melihat lowongan",
    indexLoading: "Memuat indeks",
    sortAtsSource: "ATS/sumber",
    releaseCloseA11y: "Tutup catatan rilis",
    releaseHistoryLabel: "Riwayat catatan rilis",
    releaseOpenA11y: "Buka catatan rilis versi {version}",
    suggestionSearch: "Pencarian",
    suggestionRecent: "Terbaru",
    dropdownEmpty: "{label} belum diindeks. Pencarian global tetap aktif.",
    dropdownNoMatch: "Tidak ada {label} yang cocok dengan \"{search}\".",
    dropdownShowing: "Menampilkan {visible} dari {total} {label}.",
    sourceResult: "hasil",
    sourceResults: "hasil",
    sourceConfidence: "Keyakinan",
    sourceQuality: "Kualitas",
    sourceFreshSeen: "{fresh}% baru - terlihat {date}",
    sourceCurrentSet: "{fresh}% baru - set saat ini",
    intentDetected: "Niat terdeteksi",
    searchAllLocations: "Cari di semua lokasi",
    allWorkModes: "Semua mode kerja",
    scrollMore: "Gulir untuk memuat lagi"
  },
  sv: {
    examplePrefix: "Prova",
    filtersLoading: "Laddar filter...",
    locationTitle: "Filtrerad plats",
    locationCopy: "Region- och landsfilter är aktiva.",
    ats: "ATS",
    allAts: "Alla ATS",
    anyIndustry: "Valfri bransch",
    worldwide: "Hela världen",
    allCountries: "Alla länder",
    allStates: "Alla delstater/provinser",
    counties: "Countyn",
    allCounties: "Alla countyn",
    noIndustries: "Inga branscher tillgängliga.",
    industriesHelper: "Valfritt. Lämna tomt för att söka i alla indexerade branscher.",
    regionsEmpty: "Global sökning är aktiv. Regionmetadata är inte indexerad ännu.",
    regionsHelper: "Börja brett per kontinent och smalna av till länder vid behov.",
    countriesEmptyRegion: "Inga länder matchar vald region. Rensa Regioner för att söka globalt.",
    countriesEmpty: "Inga länder matchar. Global sökning är fortfarande aktiv.",
    countriesHelperRegion: "Länder begränsas av vald region.",
    countriesHelper: "Lämna tomt för att inkludera alla länder.",
    statesEmpty: "Inga delstater eller provinser är indexerade för valda länder.",
    statesHelper: "Visas efter landval. Lämna tomt för att inkludera alla delstater/provinser.",
    countiesEmpty: "Inga countyn matchar valda delstater.",
    countiesHelper: "Visas efter delstatsval när källan innehåller countymetadata.",
    countryHint: "Välj ett land för att smalna av efter delstat eller provins.",
    stateHint: "Välj delstat/provins för att smalna av efter county när data finns.",
    freshness3: "3 dagar",
    freshness7: "7 dagar",
    freshness30: "30 dagar",
    anyShort: "Valfri",
    remoteShort: "Distans",
    hybridShort: "Hybrid",
    onSiteShort: "På plats",
    hideNoDate: "Dölj jobb utan datum",
    sourcesEmpty: "Kör en sökning för att se källor i aktuell resultatuppsättning.",
    toSeeSlots: "för att se jobb",
    indexLoading: "Laddar index",
    sortAtsSource: "ATS/källa",
    releaseCloseA11y: "Stäng versionsnotiser",
    releaseHistoryLabel: "Historik för versionsnotiser",
    releaseOpenA11y: "Öppna versionsnotiser för version {version}",
    suggestionSearch: "Sökning",
    suggestionRecent: "Senaste",
    dropdownEmpty: "{label} är inte indexerade ännu. Global sökning är fortfarande aktiv.",
    dropdownNoMatch: "Inga {label} matchar \"{search}\".",
    dropdownShowing: "Visar {visible} av {total} {label}.",
    sourceResult: "resultat",
    sourceResults: "resultat",
    sourceConfidence: "Konf.",
    sourceQuality: "Kvalitet",
    sourceFreshSeen: "{fresh}% färska - sedda {date}",
    sourceCurrentSet: "{fresh}% färska - aktuell uppsättning",
    intentDetected: "Avsikt upptäckt",
    searchAllLocations: "Sök på alla platser",
    allWorkModes: "Alla arbetslägen",
    scrollMore: "Skrolla för att ladda fler"
  },
  da: {
    examplePrefix: "Prøv",
    filtersLoading: "Indlæser filtre...",
    locationTitle: "Filtreret sted",
    locationCopy: "Regions- og landefiltre er aktive.",
    ats: "ATS",
    allAts: "Alle ATS",
    anyIndustry: "Enhver branche",
    worldwide: "Hele verden",
    allCountries: "Alle lande",
    allStates: "Alle stater/provinser",
    counties: "Amter",
    allCounties: "Alle amter",
    noIndustries: "Ingen brancher tilgængelige.",
    industriesHelper: "Valgfrit. Lad feltet stå tomt for at søge i alle indekserede brancher.",
    regionsEmpty: "Global søgning er aktiv. Regionsmetadata er endnu ikke indekseret.",
    regionsHelper: "Start bredt med kontinent, og indsnævr til lande når det er nyttigt.",
    countriesEmptyRegion: "Ingen lande matcher den valgte region. Ryd Regioner for at søge globalt.",
    countriesEmpty: "Ingen lande matcher. Global søgning er stadig aktiv.",
    countriesHelperRegion: "Lande er begrænset af den valgte region.",
    countriesHelper: "Lad feltet stå tomt for at inkludere alle lande.",
    statesEmpty: "Ingen stater eller provinser er indekseret for de valgte lande.",
    statesHelper: "Vises efter valg af land. Lad feltet stå tomt for at inkludere alle stater/provinser.",
    countiesEmpty: "Ingen amter matcher de valgte stater.",
    countiesHelper: "Vises efter valg af stat når kilden indeholder amtsmetadata.",
    countryHint: "Vælg et land for at indsnævre efter stat eller provins.",
    stateHint: "Vælg stat/provins for at indsnævre efter county når data findes.",
    freshness3: "3 dage",
    freshness7: "7 dage",
    freshness30: "30 dage",
    anyShort: "Enhver",
    remoteShort: "Remote",
    hybridShort: "Hybrid",
    onSiteShort: "På stedet",
    hideNoDate: "Skjul opslag uden dato",
    sourcesEmpty: "Kør en søgning for at se kilder i det aktuelle resultat.",
    toSeeSlots: "for at se job",
    indexLoading: "Indlæser indeks",
    sortAtsSource: "ATS/kilde",
    releaseCloseA11y: "Luk versionsnoter",
    releaseHistoryLabel: "Historik for versionsnoter",
    releaseOpenA11y: "Åbn versionsnoter for version {version}",
    suggestionSearch: "Søgning",
    suggestionRecent: "Seneste",
    dropdownEmpty: "{label} er ikke indekseret endnu. Global søgning er stadig aktiv.",
    dropdownNoMatch: "Ingen {label} matcher \"{search}\".",
    dropdownShowing: "Viser {visible} af {total} {label}.",
    sourceResult: "resultat",
    sourceResults: "resultater",
    sourceConfidence: "Konf.",
    sourceQuality: "Kvalitet",
    sourceFreshSeen: "{fresh}% friske - set {date}",
    sourceCurrentSet: "{fresh}% friske - aktuelt sæt",
    intentDetected: "Hensigt registreret",
    searchAllLocations: "Søg alle steder",
    allWorkModes: "Alle arbejdsformer",
    scrollMore: "Rul for at indlæse flere"
  },
  no: {
    examplePrefix: "Prøv",
    filtersLoading: "Laster filtre...",
    locationTitle: "Filtrert sted",
    locationCopy: "Region- og landsfiltre er aktive.",
    ats: "ATS",
    allAts: "Alle ATS",
    anyIndustry: "Hvilken som helst bransje",
    worldwide: "Hele verden",
    allCountries: "Alle land",
    allStates: "Alle delstater/provinser",
    counties: "Fylker/counties",
    allCounties: "Alle fylker/counties",
    noIndustries: "Ingen bransjer tilgjengelige.",
    industriesHelper: "Valgfritt. La stå tomt for å søke i alle indekserte bransjer.",
    regionsEmpty: "Globalt søk er aktivt. Regionmetadata er ikke indeksert ennå.",
    regionsHelper: "Start bredt med kontinent, og snevre inn til land når det er nyttig.",
    countriesEmptyRegion: "Ingen land matcher valgt region. Fjern Regioner for å søke globalt.",
    countriesEmpty: "Ingen land matcher. Globalt søk er fortsatt aktivt.",
    countriesHelperRegion: "Land er begrenset av valgt region.",
    countriesHelper: "La stå tomt for å inkludere alle land.",
    statesEmpty: "Ingen delstater eller provinser er indeksert for valgte land.",
    statesHelper: "Vises etter valg av land. La stå tomt for å inkludere alle delstater/provinser.",
    countiesEmpty: "Ingen fylker/counties matcher valgte delstater.",
    countiesHelper: "Vises etter delstatsvalg når kilden har county-metadata.",
    countryHint: "Velg et land for å snevre inn etter delstat eller provins.",
    stateHint: "Velg delstat/provins for å snevre inn etter county når data finnes.",
    freshness3: "3 dager",
    freshness7: "7 dager",
    freshness30: "30 dager",
    anyShort: "Hvilken som helst",
    remoteShort: "Remote",
    hybridShort: "Hybrid",
    onSiteShort: "På stedet",
    hideNoDate: "Skjul jobber uten dato",
    sourcesEmpty: "Kjør et søk for å se kilder i gjeldende resultatsett.",
    toSeeSlots: "for å se jobber",
    indexLoading: "Laster indeks",
    sortAtsSource: "ATS/kilde",
    releaseCloseA11y: "Lukk versjonsnotater",
    releaseHistoryLabel: "Historikk for versjonsnotater",
    releaseOpenA11y: "Åpne versjonsnotater for versjon {version}",
    suggestionSearch: "Søk",
    suggestionRecent: "Nylig",
    dropdownEmpty: "{label} er ikke indeksert ennå. Globalt søk er fortsatt aktivt.",
    dropdownNoMatch: "Ingen {label} matcher \"{search}\".",
    dropdownShowing: "Viser {visible} av {total} {label}.",
    sourceResult: "resultat",
    sourceResults: "resultater",
    sourceConfidence: "Konf.",
    sourceQuality: "Kvalitet",
    sourceFreshSeen: "{fresh}% ferske - sett {date}",
    sourceCurrentSet: "{fresh}% ferske - gjeldende sett",
    intentDetected: "Intensjon oppdaget",
    searchAllLocations: "Søk alle steder",
    allWorkModes: "Alle arbeidsformer",
    scrollMore: "Rull for å laste flere"
  },
  fi: {
    examplePrefix: "Kokeile",
    filtersLoading: "Ladataan suodattimia...",
    locationTitle: "Suodatettu sijainti",
    locationCopy: "Alue- ja maasuodattimet ovat käytössä.",
    ats: "ATS",
    allAts: "Kaikki ATS:t",
    anyIndustry: "Mikä tahansa toimiala",
    worldwide: "Koko maailma",
    allCountries: "Kaikki maat",
    allStates: "Kaikki osavaltiot/maakunnat",
    counties: "Piirikunnat",
    allCounties: "Kaikki piirikunnat",
    noIndustries: "Toimialoja ei ole saatavilla.",
    industriesHelper: "Valinnainen. Jätä tyhjäksi hakeaksesi kaikista indeksoiduista toimialoista.",
    regionsEmpty: "Globaali haku on käytössä. Aluetietoja ei ole vielä indeksoitu.",
    regionsHelper: "Aloita maanosasta ja rajaa maihin tarvittaessa.",
    countriesEmptyRegion: "Yksikään maa ei vastaa valittua aluetta. Tyhjennä alueet hakeaksesi maailmanlaajuisesti.",
    countriesEmpty: "Mikään maa ei vastaa. Globaali haku pysyy käytössä.",
    countriesHelperRegion: "Maat on rajattu valitun alueen mukaan.",
    countriesHelper: "Jätä tyhjäksi sisällyttääksesi kaikki maat.",
    statesEmpty: "Valituille maille ei ole indeksoitu osavaltioita tai maakuntia.",
    statesHelper: "Näytetään maan valinnan jälkeen. Jätä tyhjäksi sisällyttääksesi kaikki osavaltiot/maakunnat.",
    countiesEmpty: "Yksikään piirikunta ei vastaa valittuja osavaltioita.",
    countiesHelper: "Näytetään osavaltion valinnan jälkeen, jos lähteessä on piirikuntatietoja.",
    countryHint: "Valitse maa rajataksesi osavaltion tai maakunnan mukaan.",
    stateHint: "Valitse osavaltio/maakunta rajataksesi piirikunnan mukaan, jos tietoja on.",
    freshness3: "3 päivää",
    freshness7: "7 päivää",
    freshness30: "30 päivää",
    anyShort: "Mikä tahansa",
    remoteShort: "Etä",
    hybridShort: "Hybridi",
    onSiteShort: "Toimisto",
    hideNoDate: "Piilota päivättömät työpaikat",
    sourcesEmpty: "Tee haku nähdäksesi nykyisen tulosjoukon lähteet.",
    toSeeSlots: "nähdäksesi työpaikat",
    indexLoading: "Ladataan indeksiä",
    sortAtsSource: "ATS/lähde",
    releaseCloseA11y: "Sulje julkaisutiedot",
    releaseHistoryLabel: "Julkaisutietojen historia",
    releaseOpenA11y: "Avaa version {version} julkaisutiedot",
    suggestionSearch: "Haku",
    suggestionRecent: "Viimeaikainen",
    dropdownEmpty: "{label} ei ole vielä indeksoitu. Globaali haku pysyy käytössä.",
    dropdownNoMatch: "Mikään {label} ei vastaa hakua \"{search}\".",
    dropdownShowing: "Näytetään {visible} / {total} {label}.",
    sourceResult: "tulos",
    sourceResults: "tulosta",
    sourceConfidence: "Luott.",
    sourceQuality: "Laatu",
    sourceFreshSeen: "{fresh}% tuoreita - nähty {date}",
    sourceCurrentSet: "{fresh}% tuoreita - nykyinen joukko",
    intentDetected: "Aikomus havaittu",
    searchAllLocations: "Hae kaikista sijainneista",
    allWorkModes: "Kaikki työmuodot",
    scrollMore: "Vieritä ladataksesi lisää"
  }
});

Object.entries(PUBLIC_LANGUAGE_PACK_COMPLETION_COPY).forEach(([languageCode, copy]) => {
  PUBLIC_MESSAGES[languageCode] = {
    ...PUBLIC_MESSAGES[languageCode],
    ...buildPublicLanguagePackSupplement(copy)
  };
});
const PUBLIC_APP_VERSION = String(appMetadata?.expo?.version || packageMetadata?.version || "1.8.0");
const PUBLIC_VERSION_LABEL = `Public v${PUBLIC_APP_VERSION}`;
const BATUHAN_WEBSITE_URL = "https://batuhanboran.com";
const PUBLIC_RELEASE_NOTES = [
  {
    version: "2.2.0",
    date: "June 1, 2026",
    title: "ATS architecture and recovery guardrails",
    summary:
      "Moves ATS recovery proof closer to source-local modules, tightens alias and fixture ownership, adds safer read-only Meili/Postgres facet-drift diagnostics, and reduces false parser-drift alerts from optional enrichment payloads."
  },
  {
    version: "2.1.0",
    date: "May 31, 2026",
    title: "ATS pipeline and runtime safety",
    summary:
      "Strengthens source-module dispatch and parser evidence lanes, keeps ATS pipeline safeguards explicit, coalesces duplicate read work under load, lowers background worker and deploy pressure, and keeps Meili/Postgres parity verified after the repair window."
  },
  {
    version: "2.0.0",
    date: "May 27, 2026",
    title: "Coverage, ATS ingestion, and search parity",
    summary:
      "Adds exact job-slot counts, ATS and company coverage in the search header, more source-specific ATS ingestion and parser work, guarded canary expansion, higher worker throughput, and refreshed search-index parity."
  },
  {
    version: "1.9.3",
    date: "May 18, 2026",
    title: "Index freshness and public count polish",
    summary:
      "Kept the public search count aligned with the live index, improved sort segment motion, restored worker freshness budgeting, and documented the next safe source-quality path toward a larger fresher index."
  },
  {
    version: "1.9.2",
    date: "May 17, 2026",
    title: "Public search dependency hardening",
    summary:
      "Kept the public search update live and resolved deploy-time dependency audit warnings with pinned transitive overrides for the web build."
  },
  {
    version: "1.9.1",
    date: "May 17, 2026",
    title: "Public search experience update",
    summary:
      "Cleaned the public search shell, kept the openjobslots logo, added a sticky desktop search panel, mobile-friendly filters, dynamic result counts, a 3-day freshness filter, expanded sort controls, search suggestions with visible intent chips, and a compact sources-in-results panel."
  },
  {
    version: "1.8.0",
    date: "May 12, 2026",
    title: "Certified-source indexing release",
    summary:
      "Closed the ATS-specific fetch/parser/index cycle with source-specific modules, certification workbench coverage, direct JSON/API, enterprise/detail, and HTML/public-sector parser waves, threshold-based indexing, a certified-source public dataset rebuild, and final Meili/Postgres parity."
  },
  {
    version: "1.7.0",
    date: "May 12, 2026",
    title: "Clean parser quality release",
    summary:
      "Closed the clean parser/data-quality cycle with the parser quality gate, ATS certification workbench, Wave A and Wave B parser repairs, the controlled clean public dataset rebuild, continuous source quality protection, Applitrack auto-disablement, and a final replace-mode Meili rebuild with clean Postgres parity."
  },
  {
    version: "1.6.2",
    date: "May 11, 2026",
    title: "Data quality repair and search index closure",
    summary:
      "Closed the v1.6 data-quality repair cycle with guarded backend job protections, safe existing-evidence geo and remote backfill, bounded iCIMS and Applitrack detail refetch, targeted ATS gap repair, and a final replace-mode Meili rebuild from Postgres. Meili now matches the Postgres indexable count and remote facets."
  },
  {
    version: "1.6.1",
    date: "May 9, 2026",
    title: "Data quality tooling release",
    summary:
      "Added accurate data-quality summaries, read-only audit reports, dry-run geo and remote backfill planning, guarded production apply and rollback support, guarded iCIMS and Applitrack detail refetch tooling, and safe Meili replace-mode reindex checks. No production data backfill was applied in this deploy step."
  },
  {
    version: "1.6.0",
    date: "May 8, 2026",
    title: "Production hardening release",
    summary:
      "Hardened search relevance and Meili parity, expanded ATS parser certification, improved ingestion cache and worker reliability, fixed UI issues found by automation, added data quality diagnostics, and verified the release with backend, parser, API, E2E, build, and quality-gate checks."
  },
  {
    version: "1.5.21",
    date: "May 8, 2026",
    title: "Parser contract and diagnostics",
    summary:
      "Expanded normalized ATS output fields, added ApplicantPro raw parser certification, and added parser diagnostics for the full ATS catalog."
  },
  {
    version: "1.5.20",
    date: "May 8, 2026",
    title: "iCIMS country-code repair",
    summary:
      "Corrected iCIMS country-code location backfill so rows like IN-KL and IL city locations are not misclassified as United States postings."
  },
  {
    version: "1.5.19",
    date: "May 8, 2026",
    title: "Detail parser certification",
    summary:
      "Added raw detail-page fixtures for iCIMS and Applitrack, improved iCIMS country-code location and remote parsing, and added a budgeted detail-page backfill tool for existing ATS rows."
  },
  {
    version: "1.5.18",
    date: "May 8, 2026",
    title: "Parser backfill stabilization",
    summary:
      "Improved production normalization backfill for source posting dates, preserved stronger source IDs and remote classifications during sync, and tightened parser tests for physical job locations."
  },
  {
    version: "1.5.17",
    date: "May 8, 2026",
    title: "ATS certification workbench",
    summary:
      "Added a 60-source ATS parser certification registry, field-quality lane notes, and guard tests so parser fixes must prove geo, date, remote, and source ID behavior before certification."
  },
  {
    version: "1.5.16",
    date: "May 8, 2026",
    title: "ATS field quality repair",
    summary:
      "Expanded global location normalization and source ID recovery across high-volume ATS records so production backfills and search reindexing can repair more existing job slots."
  },
  {
    version: "1.5.15",
    date: "May 8, 2026",
    title: "Production index repair",
    summary:
      "Applied the ATS normalization backfill on production data, rebuilt the public search index from Postgres, and tightened full-reindex outbox cleanup."
  },
  {
    version: "1.5.14",
    date: "May 8, 2026",
    title: "ATS parser certification pass",
    summary:
      "Improved Workday, BambooHR, Taleo, ApplyToJob, Breezy, Recruitee, iCIMS, and Applitrack field extraction, added direct ATS quality auditing, and hardened deploy verification."
  },
  {
    version: "1.5.13",
    date: "May 8, 2026",
    title: "Parser normalization repair",
    summary:
      "Expanded ATS location, country, region, and remote normalization, improved high-volume parser outputs, and added a controlled data backfill path before search reindexing."
  },
  {
    version: "1.5.12",
    date: "May 8, 2026",
    title: "Search quality operating plan",
    summary:
      "Documented the parser-first stabilization path: improve ATS location, date, and remote normalization before Meilisearch cleanup, then verify with production parity tests."
  },
  {
    version: "1.5.11",
    date: "May 7, 2026",
    title: "Search hydration repair",
    summary:
      "Changed result hydration to trust search-index text relevance while keeping public visibility and structured filter guards in Postgres."
  },
  {
    version: "1.5.10",
    date: "May 7, 2026",
    title: "Zero-result search speed",
    summary:
      "Stopped running expensive database fallback searches when the healthy search index already proves a query has no matching public slots."
  },
  {
    version: "1.5.9",
    date: "May 7, 2026",
    title: "Search term precision fix",
    summary:
      "Changed public result search to require all title terms in the search index, reducing misleading partial matches before database hydration."
  },
  {
    version: "1.5.8",
    date: "May 7, 2026",
    title: "Search index visibility fix",
    summary:
      "Tightened the public search index filter so hidden or legacy index rows do not force expensive database fallbacks during title, country, and remote searches."
  },
  {
    version: "1.5.7",
    date: "May 7, 2026",
    title: "Postgres search stability",
    summary:
      "Increased Postgres shared memory, reduced database connection pressure, and disabled parallel fallback scans so high-volume search probes do not exhaust container shared memory."
  },
  {
    version: "1.5.6",
    date: "May 7, 2026",
    title: "Search filter diagnostics",
    summary:
      "Expanded search quality coverage to 1000 deterministic title/filter cases and added clearer empty-state actions when a title, location, and remote-mode intersection has no job slots."
  },
  {
    version: "1.5.5",
    date: "May 7, 2026",
    title: "Search reliability and sync budgeting",
    summary:
      "Added a backend search corpus, improved Meilisearch/Postgres fallback behavior, capped hydrated result pages, and budgeted automatic sync work to reduce continuous load."
  },
  {
    version: "1.5.4",
    date: "May 7, 2026",
    title: "Search index and sync freshness repair",
    summary:
      "Improved country and region matching, added a Postgres safety fallback when the search index is empty, and made ingestion distribute due sync work across ATS sources."
  },
  {
    version: "1.5.3",
    date: "May 7, 2026",
    title: "Scroll comfort and docs CI cleanup",
    summary:
      "Added a floating back-to-top control for long result lists and changed the docs workflow to validate docs without requiring GitHub Pages."
  },
  {
    version: "1.5.2",
    date: "May 7, 2026",
    title: "Progressive results and ATS certification audit",
    summary:
      "Added scroll-based result paging, clarified refresh states, and documented strict parser-certification gaps across all configured ATS sources."
  },
  {
    version: "1.5.1",
    date: "May 7, 2026",
    title: "Security and deployment hardening",
    summary:
      "Removed runtime database tracking from the repository, tightened public posting responses, cleaned dependency advisories, and hardened production Docker builds."
  },
  {
    version: "1.5.0",
    date: "May 7, 2026",
    title: "ATS certification and retention controls",
    summary:
      "Added ATS certification tracking, parser expansion notes, safer source gating, public attribution polish, and data retention controls for fresher search results."
  },
  {
    version: "1.4.0",
    date: "May 7, 2026",
    title: "Release notes and launch polish",
    summary:
      "Added desktop release notes, public SEO metadata, stronger mobile QA checks, and direct browser compatibility for the live site."
  },
  {
    version: "1.3.0",
    date: "May 7, 2026",
    title: "Centered search experience",
    summary:
      "Refined the centered search home, smoother results transition, faster suggestions, compact coverage, and softer public palette."
  },
  {
    version: "1.2.0",
    date: "May 6, 2026",
    title: "Public search boundary",
    summary:
      "Separated the public search page from admin-only controls, cleaned reload behavior, and expanded desktop and mobile automation."
  },
  {
    version: "1.1.0",
    date: "May 6, 2026",
    title: "Production search foundation",
    summary:
      "Moved the public product toward an app, worker, Postgres, and Meilisearch stack with safer sync controls and deployment workflow."
  },
  {
    version: "1.0.0",
    date: "May 6, 2026",
    title: "OpenJobSlots live baseline",
    summary:
      "Launched the openjobslots public job-search baseline with searchable postings, ATS coverage, filters, and live service deployment."
  }
];
const PUBLIC_RELEASE_NOTE_TRANSLATIONS = {
  tr: {
    "2.2.0": {
      title: "ATS mimarisi ve kurtarma güvenlik hatları",
      summary:
        "ATS kurtarma kanıtını kaynak yerel modüllere yaklaştırır, alias ve fixture sahipliğini sıkılaştırır, daha güvenli salt okunur Meili/Postgres facet-drift tanılaması ekler ve isteğe bağlı zenginleştirme payload'larından gelen hatalı parser-drift uyarılarını azaltır."
    },
    "2.1.0": {
      title: "ATS pipeline ve runtime güvenliği",
      summary:
        "Kaynak modülü yönlendirmesini ve parser kanıt hatlarını güçlendirir, ATS pipeline korumalarını açık tutar, yük altında yinelenen okuma işlerini birleştirir, arka plan worker ve deploy baskısını düşürür, onarım penceresinden sonra Meili/Postgres eşitliğini doğrulanmış tutar."
    },
    "2.0.0": {
      title: "Kapsam, ATS alımı ve arama eşitliği",
      summary:
        "Net iş ilanı sayılarını, arama başlığında ATS ve şirket kapsamını, daha fazla kaynağa özel ATS alımını ve parser çalışmasını, kontrollü canary genişlemesini, daha yüksek worker verimini ve yenilenmiş arama indeksi eşitliğini ekler."
    },
    "1.9.3": {
      title: "İndeks tazeliği ve genel sayı düzeni",
      summary:
        "Genel arama sayısını canlı indeksle uyumlu tuttu, sıralama geçişini iyileştirdi, worker tazelik bütçesini geri getirdi ve daha büyük, daha taze bir indeks için sonraki güvenli kaynak kalitesi yolunu belgeledi."
    },
    "1.9.2": {
      title: "Genel arama bağımlılıklarını sağlamlaştırma",
      summary:
        "Genel arama güncellemesini canlı tuttu ve web build için sabitlenmiş geçişli override'larla deploy zamanı bağımlılık uyarılarını çözdü."
    },
    "1.9.1": {
      title: "Genel arama deneyimi güncellemesi",
      summary:
        "Genel arama kabuğunu temizledi, openjobslots logosunu korudu, masaüstü için yapışkan arama paneli, mobil uyumlu filtreler, dinamik sonuç sayıları, 3 günlük güncellik filtresi, genişletilmiş sıralama kontrolleri, görünür niyet çipleri olan arama önerileri ve kompakt kaynak paneli ekledi."
    },
    "1.8.0": {
      title: "Sertifikalı kaynak indeksleme sürümü",
      summary:
        "Kaynağa özel modüller, sertifikasyon çalışma alanı, API ve HTML parser dalgaları, eşik tabanlı indeksleme, sertifikalı genel veri seti yeniden oluşturma ve son Meili/Postgres eşitliği ile ATS fetch/parser/indeks döngüsünü kapattı."
    },
    "1.7.0": {
      title: "Temiz parser kalite sürümü",
      summary:
        "Parser kalite kapısı, ATS sertifikasyon çalışma alanı, parser onarımları, kontrollü genel veri seti yeniden oluşturma, sürekli kaynak kalitesi koruması ve son Meili rebuild ile temiz parser/veri kalitesi döngüsünü kapattı."
    }
  },
  de: {
    "2.2.0": {
      title: "ATS-Architektur und Recovery-Schutz",
      summary:
        "Rückt ATS-Recovery-Nachweise näher an quelllokale Module, verschärft Alias- und Fixture-Verantwortung, ergänzt sicherere schreibgeschützte Meili/Postgres-Facet-Drift-Diagnosen und reduziert falsche Parser-Drift-Meldungen aus optionalen Anreicherungspayloads."
    },
    "2.1.0": {
      title: "ATS-Pipeline und Laufzeitsicherheit",
      summary:
        "Stärkt Source-Modul-Dispatch und Parser-Evidenzspuren, hält ATS-Pipeline-Schutzmaßnahmen explizit, bündelt doppelte Lesevorgänge unter Last, senkt Worker- und Deploy-Druck im Hintergrund und hält die Meili/Postgres-Parität nach dem Reparaturfenster verifiziert."
    },
    "2.0.0": {
      title: "Abdeckung, ATS-Erfassung und Suchparität",
      summary:
        "Fügt genaue Jobslot-Zahlen, ATS- und Unternehmensabdeckung im Suchkopf, mehr quellenspezifische ATS-Erfassung und Parser-Arbeit, kontrollierte Canary-Erweiterung, höheren Worker-Durchsatz und erneuerte Suchindex-Parität hinzu."
    },
    "1.9.3": {
      title: "Indexfrische und öffentliche Zählungen",
      summary:
        "Hielt die öffentliche Suchzählung mit dem Live-Index synchron, verbesserte die Sortierbewegung, stellte das Frischebudget des Workers wieder her und dokumentierte den nächsten sicheren Weg zu einem größeren, frischeren Index."
    },
    "1.9.2": {
      title: "Härtung der öffentlichen Suchabhängigkeiten",
      summary:
        "Hielt das öffentliche Suchupdate live und löste Deploy-Warnungen zu Abhängigkeiten mit festen transitiven Overrides für den Web-Build."
    },
    "1.9.1": {
      title: "Update der öffentlichen Suche",
      summary:
        "Bereinigte die öffentliche Suchoberfläche, behielt das openjobslots-Logo, ergänzte ein fixiertes Desktop-Suchpanel, mobilfreundliche Filter, dynamische Ergebniszahlen, einen 3-Tage-Frischefilter, erweiterte Sortierung, Suchvorschläge mit sichtbaren Absicht-Chips und ein kompaktes Quellenpanel."
    },
    "1.8.0": {
      title: "Release für zertifizierte Quellenindizes",
      summary:
        "Schloss den ATS-spezifischen Fetch-, Parser- und Indexzyklus mit Quellmodulen, Zertifizierungs-Workbench, API-/HTML-Parserwellen, Schwellenindexierung, zertifiziertem öffentlichen Datensatz und finaler Meili/Postgres-Parität ab."
    },
    "1.7.0": {
      title: "Release für saubere Parser-Qualität",
      summary:
        "Schloss den Parser- und Datenqualitätszyklus mit Qualitäts-Gate, ATS-Workbench, Parser-Reparaturen, kontrolliertem öffentlichen Datensatz, kontinuierlichem Quellschutz und finalem Meili-Rebuild ab."
    }
  },
  fr: {
    "2.2.0": {
      title: "Architecture ATS et garde-fous de récupération",
      summary:
        "Rapproche les preuves de récupération ATS des modules propres à chaque source, renforce la responsabilité des alias et fixtures, ajoute des diagnostics Meili/Postgres en lecture seule plus sûrs pour les écarts de facettes, et réduit les fausses alertes de drift parser liées aux payloads d'enrichissement optionnels."
    },
    "2.1.0": {
      title: "Pipeline ATS et sécurité d'exécution",
      summary:
        "Renforce la répartition par modules source et les pistes de preuve des parsers, garde explicites les garde-fous du pipeline ATS, regroupe les lectures dupliquées sous charge, réduit la pression des workers et des déploiements en arrière-plan, et maintient la parité Meili/Postgres vérifiée après la fenêtre de réparation."
    },
    "2.0.0": {
      title: "Couverture, ingestion ATS et parité de recherche",
      summary:
        "Ajoute des comptes exacts d'offres, la couverture ATS et entreprises dans l'en-tête de recherche, davantage d'ingestion ATS et de travail parser par source, une extension canary contrôlée, un meilleur débit worker et une parité d'index de recherche rafraîchie."
    },
    "1.9.3": {
      title: "Fraîcheur de l'index et comptes publics",
      summary:
        "A gardé le compteur public aligné avec l'index live, amélioré le mouvement du tri, restauré le budget de fraîcheur du worker et documenté le prochain chemin sûr vers un index plus large et plus frais."
    },
    "1.9.2": {
      title: "Renforcement des dépendances de recherche publique",
      summary:
        "A gardé la mise à jour de recherche publique en ligne et résolu les avertissements de dépendances au déploiement avec des overrides transitifs épinglés pour le build web."
    },
    "1.9.1": {
      title: "Mise à jour de l'expérience de recherche publique",
      summary:
        "A nettoyé l'interface de recherche publique, conservé le logo openjobslots, ajouté un panneau de recherche desktop collant, des filtres adaptés au mobile, des compteurs dynamiques, un filtre de fraîcheur 3 jours, des tris étendus, des suggestions avec intentions visibles et un panneau de sources compact."
    },
    "1.8.0": {
      title: "Version d'indexation des sources certifiées",
      summary:
        "A clôturé le cycle ATS fetch/parser/index avec des modules par source, la couverture du banc de certification, des vagues parser API/HTML, l'indexation par seuil, la reconstruction du jeu public certifié et la parité finale Meili/Postgres."
    },
    "1.7.0": {
      title: "Version qualité parser propre",
      summary:
        "A clôturé le cycle parser et qualité des données avec la porte qualité, le banc de certification ATS, des réparations parser, la reconstruction contrôlée du jeu public, la protection continue des sources et le rebuild final Meili."
    }
  },
  es: {
    "2.2.0": {
      title: "Arquitectura ATS y controles de recuperación",
      summary:
        "Acerca la evidencia de recuperación ATS a los módulos propios de cada fuente, refuerza la propiedad de alias y fixtures, añade diagnósticos Meili/Postgres de solo lectura más seguros para el drift de facetas y reduce falsas alertas de drift de parser por payloads opcionales de enriquecimiento."
    },
    "2.1.0": {
      title: "Pipeline ATS y seguridad en ejecución",
      summary:
        "Refuerza el despacho por módulos de fuente y las líneas de evidencia de parsers, mantiene explícitas las protecciones del pipeline ATS, agrupa lecturas duplicadas bajo carga, reduce la presión de workers y despliegues en segundo plano, y mantiene verificada la paridad Meili/Postgres tras la ventana de reparación."
    },
    "2.0.0": {
      title: "Cobertura, ingesta ATS y paridad de búsqueda",
      summary:
        "Añade recuentos exactos de puestos, cobertura ATS y de empresas en el encabezado de búsqueda, más ingesta ATS y trabajo de parsers por fuente, expansión canary controlada, mayor rendimiento del worker y paridad renovada del índice de búsqueda."
    },
    "1.9.3": {
      title: "Frescura del índice y recuentos públicos",
      summary:
        "Mantuvo el recuento público alineado con el índice live, mejoró el movimiento de ordenación, restauró el presupuesto de frescura del worker y documentó el siguiente camino seguro hacia un índice más grande y fresco."
    },
    "1.9.2": {
      title: "Refuerzo de dependencias de búsqueda pública",
      summary:
        "Mantuvo activa la actualización de búsqueda pública y resolvió advertencias de dependencias en deploy con overrides transitivos fijados para el build web."
    },
    "1.9.1": {
      title: "Actualización de la experiencia de búsqueda pública",
      summary:
        "Limpió la interfaz de búsqueda pública, mantuvo el logo openjobslots, agregó un panel de búsqueda fijo en desktop, filtros móviles, recuentos dinámicos, filtro de frescura de 3 días, ordenación ampliada, sugerencias con chips de intención visibles y un panel compacto de fuentes."
    },
    "1.8.0": {
      title: "Versión de indexación de fuentes certificadas",
      summary:
        "Cerró el ciclo ATS de fetch/parser/índice con módulos por fuente, banco de certificación, oleadas de parser API/HTML, indexación por umbral, reconstrucción del dataset público certificado y paridad final Meili/Postgres."
    },
    "1.7.0": {
      title: "Versión de calidad limpia de parsers",
      summary:
        "Cerró el ciclo de parser y calidad de datos con la puerta de calidad, el banco de certificación ATS, reparaciones de parsers, reconstrucción controlada del dataset público, protección continua de fuentes y rebuild final de Meili."
    }
  },
  "pt-BR": {
    "2.2.0": {
      title: "Arquitetura ATS e guardrails de recuperação",
      summary:
        "Aproxima a prova de recuperação ATS dos módulos locais de cada fonte, reforça a propriedade de aliases e fixtures, adiciona diagnósticos Meili/Postgres somente leitura mais seguros para drift de facetas e reduz falsos alertas de drift de parser vindos de payloads opcionais de enriquecimento."
    },
    "2.1.0": {
      title: "Pipeline ATS e segurança de runtime",
      summary:
        "Fortalece o despacho por módulos de fonte e as trilhas de evidência dos parsers, mantém explícitas as proteções do pipeline ATS, consolida leituras duplicadas sob carga, reduz a pressão de workers e deploys em segundo plano e mantém a paridade Meili/Postgres verificada após a janela de reparo."
    },
    "2.0.0": {
      title: "Cobertura, ingestão ATS e paridade de busca",
      summary:
        "Adiciona contagens exatas de vagas, cobertura de ATS e empresas no cabeçalho, mais ingestão e parsers por fonte, expansão canary controlada, maior vazão do worker e paridade renovada do índice de busca."
    },
    "1.9.3": {
      title: "Atualidade do índice e contagens públicas",
      summary:
        "Manteve a contagem pública alinhada ao índice ao vivo, refinou o movimento da ordenação, restaurou o orçamento de atualização do worker e documentou o próximo caminho seguro para um índice maior e mais recente."
    },
    "1.9.2": {
      title: "Reforço das dependências da busca pública",
      summary:
        "Manteve a atualização da busca pública no ar e resolveu avisos de dependências no deploy com overrides transitivos fixos para o build web."
    },
    "1.9.1": {
      title: "Atualização da experiência de busca pública",
      summary:
        "Limpou a interface de busca pública, preservou o logo openjobslots, adicionou painel de busca fixo no desktop, filtros mobile, contagens dinâmicas, filtro de 3 dias, ordenação ampliada, sugestões com chips de intenção e painel compacto de fontes."
    },
    "1.8.0": {
      title: "Versão de indexação de fontes certificadas",
      summary:
        "Fechou o ciclo ATS de coleta, parser e índice com módulos por fonte, workbench de certificação, ondas de parser API/HTML, indexação por limiar, reconstrução do dataset público certificado e paridade final Meili/Postgres."
    },
    "1.7.0": {
      title: "Versão de qualidade limpa dos parsers",
      summary:
        "Fechou o ciclo de parser e qualidade de dados com gate de qualidade, workbench ATS, reparos de parser, reconstrução controlada do dataset público, proteção contínua de fontes e rebuild final do Meili."
    }
  },
  "pt-PT": {
    "2.2.0": {
      title: "Arquitetura ATS e guardas de recuperação",
      summary:
        "Aproxima a prova de recuperação ATS dos módulos locais de cada fonte, reforça a propriedade de aliases e fixtures, acrescenta diagnósticos Meili/Postgres só de leitura mais seguros para drift de facetas e reduz falsos alertas de drift de parser vindos de payloads opcionais de enriquecimento."
    },
    "2.1.0": {
      title: "Pipeline ATS e segurança de runtime",
      summary:
        "Reforça o despacho por módulos de fonte e os trilhos de evidência dos parsers, mantém explícitas as proteções do pipeline ATS, consolida leituras duplicadas sob carga, reduz a pressão de workers e deploys em segundo plano e mantém a paridade Meili/Postgres verificada após a janela de reparação."
    },
    "2.0.0": {
      title: "Cobertura, ingestão ATS e paridade da pesquisa",
      summary:
        "Adiciona contagens exatas de vagas, cobertura de ATS e empresas no cabeçalho, mais ingestão e parsers por fonte, expansão canary controlada, maior débito do worker e paridade renovada do índice de pesquisa."
    },
    "1.9.3": {
      title: "Atualidade do índice e contagens públicas",
      summary:
        "Manteve a contagem pública alinhada com o índice em produção, melhorou o movimento da ordenação, restaurou o orçamento de atualização do worker e documentou o próximo caminho seguro para um índice maior e mais recente."
    },
    "1.9.2": {
      title: "Reforço das dependências da pesquisa pública",
      summary:
        "Manteve a atualização da pesquisa pública ativa e resolveu avisos de dependências no deploy com overrides transitivos fixos para o build web."
    },
    "1.9.1": {
      title: "Atualização da experiência de pesquisa pública",
      summary:
        "Limpou a interface de pesquisa pública, manteve o logotipo openjobslots, adicionou painel de pesquisa fixo no desktop, filtros mobile, contagens dinâmicas, filtro de 3 dias, ordenação ampliada, sugestões com chips de intenção e painel compacto de fontes."
    },
    "1.8.0": {
      title: "Versão de indexação de fontes certificadas",
      summary:
        "Fechou o ciclo ATS de recolha, parser e índice com módulos por fonte, workbench de certificação, ondas de parser API/HTML, indexação por limiar, reconstrução do dataset público certificado e paridade final Meili/Postgres."
    },
    "1.7.0": {
      title: "Versão de qualidade limpa dos parsers",
      summary:
        "Fechou o ciclo de parser e qualidade dos dados com gate de qualidade, workbench ATS, reparações de parser, reconstrução controlada do dataset público, proteção contínua das fontes e rebuild final do Meili."
    }
  },
  it: {
    "2.2.0": {
      title: "Architettura ATS e protezioni di recupero",
      summary:
        "Avvicina le prove di recupero ATS ai moduli locali delle fonti, rafforza la proprietà di alias e fixture, aggiunge diagnostica Meili/Postgres in sola lettura più sicura per il drift delle faccette e riduce i falsi avvisi di drift del parser dai payload opzionali di arricchimento."
    },
    "2.1.0": {
      title: "Pipeline ATS e sicurezza runtime",
      summary:
        "Rafforza il dispatch dei moduli sorgente e le tracce di evidenza dei parser, mantiene esplicite le protezioni della pipeline ATS, accorpa le letture duplicate sotto carico, riduce la pressione di worker e deploy in background e mantiene verificata la parità Meili/Postgres dopo la finestra di riparazione."
    },
    "2.0.0": {
      title: "Copertura, ingestione ATS e parità di ricerca",
      summary:
        "Aggiunge conteggi esatti delle offerte, copertura ATS e aziende nell'intestazione, più ingestione e parser per fonte, espansione canary controllata, maggiore throughput del worker e parità aggiornata dell'indice di ricerca."
    },
    "1.9.3": {
      title: "Freschezza dell'indice e conteggi pubblici",
      summary:
        "Ha mantenuto il conteggio pubblico allineato all'indice live, migliorato il movimento dell'ordinamento, ripristinato il budget di freschezza del worker e documentato il prossimo percorso sicuro verso un indice più grande e aggiornato."
    },
    "1.9.2": {
      title: "Rafforzamento delle dipendenze della ricerca pubblica",
      summary:
        "Ha mantenuto online l'aggiornamento della ricerca pubblica e risolto gli avvisi di dipendenze al deploy con override transitivi fissati per la build web."
    },
    "1.9.1": {
      title: "Aggiornamento dell'esperienza di ricerca pubblica",
      summary:
        "Ha ripulito la shell di ricerca pubblica, mantenuto il logo openjobslots, aggiunto pannello desktop fisso, filtri mobile, conteggi dinamici, filtro a 3 giorni, ordinamento esteso, suggerimenti con chip di intento e pannello fonti compatto."
    },
    "1.8.0": {
      title: "Release di indicizzazione delle fonti certificate",
      summary:
        "Ha chiuso il ciclo ATS di fetch, parser e indice con moduli per fonte, workbench di certificazione, ondate parser API/HTML, indicizzazione a soglia, ricostruzione del dataset pubblico certificato e parità finale Meili/Postgres."
    },
    "1.7.0": {
      title: "Release di qualità pulita dei parser",
      summary:
        "Ha chiuso il ciclo parser e qualità dati con quality gate, workbench ATS, riparazioni parser, ricostruzione controllata del dataset pubblico, protezione continua delle fonti e rebuild finale di Meili."
    }
  },
  nl: {
    "2.2.0": {
      title: "ATS-architectuur en herstelwaarborgen",
      summary:
        "Brengt ATS-herstelbewijs dichter bij bronspecifieke modules, scherpt eigenaarschap van aliassen en fixtures aan, voegt veiligere alleen-lezen Meili/Postgres-facetdrift-diagnoses toe en vermindert valse parserdriftmeldingen uit optionele verrijkingspayloads."
    },
    "2.1.0": {
      title: "ATS-pipeline en runtimeveiligheid",
      summary:
        "Versterkt bronmodule-dispatch en parserevidentie, houdt ATS-pipelinebeveiligingen expliciet, bundelt dubbele leeswerkzaamheden onder belasting, verlaagt achtergronddruk van workers en deploys en houdt Meili/Postgres-pariteit na de herstelperiode geverifieerd."
    },
    "2.0.0": {
      title: "Dekking, ATS-inname en zoekpariteit",
      summary:
        "Voegt exacte vacaturetellingen, ATS- en bedrijfsdekking in de zoekkop, meer bronspecifieke ATS-inname en parserwerk, gecontroleerde canary-uitbreiding, hogere worker-doorvoer en vernieuwde zoekindexpariteit toe."
    },
    "1.9.3": {
      title: "Indexversheid en publieke tellingen",
      summary:
        "Hield de publieke telling gelijk aan de live index, verbeterde de sorteermotion, herstelde het versheidsbudget van de worker en documenteerde het volgende veilige pad naar een grotere, frissere index."
    },
    "1.9.2": {
      title: "Versteviging van publieke zoekafhankelijkheden",
      summary:
        "Hield de publieke zoekupdate live en loste deploywaarschuwingen over afhankelijkheden op met vaste transitieve overrides voor de webbuild."
    },
    "1.9.1": {
      title: "Update van de publieke zoekervaring",
      summary:
        "Schoonde de publieke zoekinterface op, behield het openjobslots-logo, voegde een vast desktopzoekpaneel, mobiele filters, dynamische tellingen, 3-dagenfilter, uitgebreid sorteren, intentiechips en een compact bronnenpaneel toe."
    },
    "1.8.0": {
      title: "Release voor indexering van gecertificeerde bronnen",
      summary:
        "Sloot de ATS-cyclus voor ophalen, parseren en indexeren af met bronmodules, certificeringswerkbank, API/HTML-parsergolven, drempelindexering, herbouw van de gecertificeerde publieke dataset en finale Meili/Postgres-pariteit."
    },
    "1.7.0": {
      title: "Release voor schone parserkwaliteit",
      summary:
        "Sloot de parser- en datakwaliteitscyclus af met quality gate, ATS-werkbank, parserreparaties, gecontroleerde herbouw van de publieke dataset, continue bronbescherming en finale Meili-rebuild."
    }
  },
  pl: {
    "2.2.0": {
      title: "Architektura ATS i zabezpieczenia odzyskiwania",
      summary:
        "Przenosi dowody odzyskiwania ATS bliżej modułów właściwych dla źródeł, zaostrza własność aliasów i fixture'ów, dodaje bezpieczniejszą diagnostykę tylko do odczytu dla driftu facetów Meili/Postgres oraz ogranicza fałszywe alerty driftu parsera z opcjonalnych payloadów wzbogacających."
    },
    "2.1.0": {
      title: "Pipeline ATS i bezpieczeństwo runtime",
      summary:
        "Wzmacnia dispatch modułów źródłowych i ścieżki dowodowe parserów, utrzymuje jawne zabezpieczenia pipeline'u ATS, scala zdublowane odczyty pod obciążeniem, zmniejsza presję workerów i deployów w tle oraz utrzymuje zweryfikowany parytet Meili/Postgres po oknie naprawczym."
    },
    "2.0.0": {
      title: "Pokrycie, pobieranie ATS i parytet wyszukiwania",
      summary:
        "Dodaje dokładne liczniki ofert, pokrycie ATS i firm w nagłówku wyszukiwania, więcej pobierania i parserów dla źródeł, kontrolowaną ekspansję canary, większą przepustowość workera oraz odświeżony parytet indeksu wyszukiwania."
    },
    "1.9.3": {
      title: "Świeżość indeksu i publiczne liczniki",
      summary:
        "Utrzymała publiczny licznik zgodny z indeksem live, poprawiła ruch sortowania, przywróciła budżet świeżości workera i opisała kolejny bezpieczny krok do większego, świeższego indeksu."
    },
    "1.9.2": {
      title: "Wzmocnienie zależności wyszukiwania publicznego",
      summary:
        "Utrzymała aktualizację wyszukiwania publicznego na produkcji i rozwiązała ostrzeżenia zależności przy deployu przez przypięte override'y transitive dla buildu web."
    },
    "1.9.1": {
      title: "Aktualizacja doświadczenia wyszukiwania publicznego",
      summary:
        "Uporządkowała interfejs wyszukiwania, zachowała logo openjobslots, dodała przyklejony panel desktopowy, filtry mobilne, dynamiczne liczniki, filtr 3 dni, rozbudowane sortowanie, sugestie z chipami intencji i kompaktowy panel źródeł."
    },
    "1.8.0": {
      title: "Wersja indeksowania certyfikowanych źródeł",
      summary:
        "Zamknęła cykl ATS pobierania, parserów i indeksu z modułami źródeł, workbenchem certyfikacji, falami parserów API/HTML, indeksowaniem progowym, odbudową certyfikowanego publicznego datasetu i końcowym parytetem Meili/Postgres."
    },
    "1.7.0": {
      title: "Wersja czystej jakości parserów",
      summary:
        "Zamknęła cykl jakości parserów i danych przez quality gate, ATS workbench, naprawy parserów, kontrolowaną odbudowę publicznego datasetu, ciągłą ochronę źródeł i końcowy rebuild Meili."
    }
  },
  ja: {
    "2.2.0": {
      title: "ATSアーキテクチャと復旧ガードレール",
      summary:
        "ATS復旧の証跡をソースローカルなモジュールへ近づけ、エイリアスとフィクスチャの所有範囲を明確にし、読み取り専用のMeili/Postgresファセットドリフト診断をより安全に追加し、任意の拡張ペイロードによる誤ったパーサードリフト警告を減らします。"
    },
    "2.1.0": {
      title: "ATSパイプラインとランタイム安全性",
      summary:
        "ソースモジュールのディスパッチとパーサー証拠レーンを強化し、ATSパイプラインの保護を明示したまま、負荷時の重複読み取りをまとめ、バックグラウンドのworkerとデプロイ負荷を下げ、修復期間後もMeili/Postgresの整合性を検証済みに保ちます。"
    }
  },
  ko: {
    "2.2.0": {
      title: "ATS 아키텍처와 복구 가드레일",
      summary:
        "ATS 복구 증거를 소스별 로컬 모듈에 더 가깝게 두고, alias와 fixture 소유 범위를 강화하며, 더 안전한 읽기 전용 Meili/Postgres facet drift 진단을 추가하고, 선택적 보강 payload에서 발생하는 잘못된 parser drift 경고를 줄입니다."
    },
    "2.1.0": {
      title: "ATS 파이프라인과 런타임 안전성",
      summary:
        "소스 모듈 디스패치와 파서 증거 레인을 강화하고, ATS 파이프라인 보호 장치를 명확히 유지하며, 부하 상황의 중복 읽기 작업을 합치고, 백그라운드 worker와 배포 압력을 낮추며, 복구 기간 이후에도 Meili/Postgres 정합성을 검증된 상태로 유지합니다."
    }
  },
  "zh-CN": {
    "2.2.0": {
      title: "ATS 架构与恢复护栏",
      summary:
        "将 ATS 恢复证据更贴近源本地模块，收紧别名和 fixture 的归属，加入更安全的只读 Meili/Postgres facet drift 诊断，并减少可选增强 payload 带来的误报 parser drift 告警。"
    },
    "2.1.0": {
      title: "ATS 管道与运行时安全",
      summary:
        "强化源模块调度和解析器证据链，保持 ATS 管道保护明确，在负载下合并重复读取，降低后台 worker 与部署压力，并在修复窗口后保持 Meili/Postgres 一致性已验证。"
    }
  },
  hi: {
    "2.2.0": {
      title: "ATS आर्किटेक्चर और रिकवरी गार्डरेल",
      summary:
        "ATS recovery proof को source-local modules के करीब लाता है, alias और fixture ownership को सख्त करता है, सुरक्षित read-only Meili/Postgres facet-drift diagnostics जोड़ता है, और optional enrichment payloads से आने वाले गलत parser-drift alerts घटाता है।"
    },
    "2.1.0": {
      title: "ATS pipeline और runtime सुरक्षा",
      summary:
        "Source-module dispatch और parser evidence lanes को मजबूत करता है, ATS pipeline guards को स्पष्ट रखता है, load में duplicate read work को coalesce करता है, background worker और deploy pressure घटाता है, और repair window के बाद Meili/Postgres parity verified रखता है।"
    }
  },
  ar: {
    "2.2.0": {
      title: "بنية ATS وحواجز أمان الاسترداد",
      summary:
        "يقرب إثباتات استرداد ATS من وحدات المصادر المحلية، ويشدد ملكية الأسماء البديلة والـ fixtures، ويضيف تشخيصات Meili/Postgres للقراءة فقط بشكل أكثر أمانا لاختلاف faceting، ويقلل تنبيهات parser drift الخاطئة الناتجة عن payloads الإثراء الاختيارية."
    },
    "2.1.0": {
      title: "مسار ATS وأمان وقت التشغيل",
      summary:
        "يعزز توجيه وحدات المصادر ومسارات أدلة parsers، ويبقي حمايات مسار ATS واضحة، ويدمج قراءات مكررة تحت الضغط، ويخفض ضغط workers والنشر في الخلفية، ويحافظ على تحقق توافق Meili/Postgres بعد نافذة الإصلاح."
    }
  },
  id: {
    "2.2.0": {
      title: "Arsitektur ATS dan pagar pemulihan",
      summary:
        "Mendekatkan bukti pemulihan ATS ke modul lokal tiap sumber, memperketat kepemilikan alias dan fixture, menambahkan diagnostik facet drift Meili/Postgres read-only yang lebih aman, serta mengurangi peringatan parser drift palsu dari payload pengayaan opsional."
    },
    "2.1.0": {
      title: "Pipeline ATS dan keamanan runtime",
      summary:
        "Memperkuat dispatch modul sumber dan jalur bukti parser, menjaga guard pipeline ATS tetap eksplisit, menggabungkan pekerjaan baca duplikat saat beban tinggi, menurunkan tekanan worker dan deploy latar belakang, serta menjaga paritas Meili/Postgres tetap terverifikasi setelah jendela perbaikan."
    }
  },
  sv: {
    "2.2.0": {
      title: "ATS-arkitektur och skydd för återhämtning",
      summary:
        "Flyttar ATS-återhämtningsbevis närmare källlokala moduler, skärper ägarskap för alias och fixtures, lägger till säkrare skrivskyddad diagnostik för Meili/Postgres facet-drift och minskar falska parser-drift-varningar från valfria berikningspayloads."
    },
    "2.1.0": {
      title: "ATS-pipeline och runtime-säkerhet",
      summary:
        "Stärker dispatch för källmoduler och parserbevis, håller skydden i ATS-pipelinen tydliga, slår ihop dubbla läsjobb under belastning, minskar bakgrundstrycket från workers och deployer och håller Meili/Postgres-paritet verifierad efter reparationsfönstret."
    }
  },
  da: {
    "2.2.0": {
      title: "ATS-arkitektur og gærder for gendannelse",
      summary:
        "Flytter ATS-gendannelsesbeviser tættere på kildelokale moduler, skærper ejerskab af aliaser og fixtures, tilføjer sikrere skrivebeskyttet diagnostik for Meili/Postgres facet-drift og reducerer falske parser-drift-advarsler fra valgfrie berigelses-payloads."
    },
    "2.1.0": {
      title: "ATS-pipeline og runtime-sikkerhed",
      summary:
        "Styrker dispatch for kildemoduler og parserbeviser, holder ATS-pipeline-beskyttelser eksplicitte, samler duplikeret læsearbejde under belastning, sænker baggrundspres fra workers og deploys og holder Meili/Postgres-paritet verificeret efter reparationsvinduet."
    }
  },
  no: {
    "2.2.0": {
      title: "ATS-arkitektur og gjerder for gjenoppretting",
      summary:
        "Flytter ATS-gjenopprettingsbevis nærmere kildelokale moduler, skjerper eierskap for aliaser og fixtures, legger til sikrere skrivebeskyttet diagnostikk for Meili/Postgres facet-drift og reduserer falske parser-drift-varsler fra valgfrie berikelses-payloads."
    },
    "2.1.0": {
      title: "ATS-pipeline og runtime-sikkerhet",
      summary:
        "Styrker dispatch for kildemoduler og parserbevis, holder ATS-pipeline-vern tydelig, samler dupliserte lesejobber under belastning, senker bakgrunnspress fra workers og deployer og holder Meili/Postgres-paritet verifisert etter reparasjonsvinduet."
    }
  },
  fi: {
    "2.2.0": {
      title: "ATS-arkkitehtuuri ja palautuksen suojakaiteet",
      summary:
        "Siirtää ATS-palautuksen todisteet lähemmäs lähdekohtaisia moduuleja, tiukentaa aliasten ja fixture-tiedostojen omistajuutta, lisää turvallisempaa vain luku -tilan Meili/Postgres facet-drift -diagnostiikkaa ja vähentää valinnaisista rikastuspayloadista tulevia virheellisiä parser-drift-hälytyksiä."
    },
    "2.1.0": {
      title: "ATS-putki ja runtime-turvallisuus",
      summary:
        "Vahvistaa lähdemoduulien dispatchia ja parserien todistepolkuja, pitää ATS-putken suojaukset selkeinä, yhdistää kuorman alla päällekkäiset lukutyöt, vähentää taustalla toimivien workerien ja deployiden painetta sekä pitää Meili/Postgres-pariteetin varmennettuna korjausikkunan jälkeen."
    }
  }
};
const WORLDWIDE_REGION_OPTIONS = [
  { value: "Africa", label: "Africa" },
  { value: "Americas", label: "Americas" },
  { value: "Asia", label: "Asia" },
  { value: "Europe", label: "Europe" },
  { value: "Oceania", label: "Oceania" }
];
const REGION_GROUPS = {
  africa: ["africa", "northern africa", "sub-saharan africa", "eastern africa", "middle africa", "southern africa", "western africa"],
  americas: [
    "americas",
    "america",
    "north america",
    "south america",
    "central america",
    "latin america",
    "caribbean"
  ],
  asia: ["asia", "east asia", "eastern asia", "south asia", "southern asia", "southeast asia", "south-eastern asia", "western asia", "central asia", "middle east"],
  europe: ["europe", "northern europe", "southern europe", "western europe", "eastern europe", "european union"],
  oceania: ["oceania", "australia", "australia and new zealand", "melanesia", "micronesia", "polynesia"]
};
const DEFAULT_POSTING_SORT_OPTIONS = [
  { value: "relevance", label: "Relevance" },
  { value: "last_seen", label: "Fresh source" },
  { value: "posted_date", label: "Posted date" },
  { value: "ats_source", label: "ATS/source" },
  { value: "confidence", label: "Confidence" }
];
const FRESHNESS_FILTER_OPTIONS = [
  { value: "all", label: "Any date", testId: "freshness-filter-any" },
  { value: 3, label: "3 days", testId: "freshness-filter-3d" },
  { value: 7, label: "7 days", testId: "freshness-filter-7d" },
  { value: 30, label: "30 days", testId: "freshness-filter-30d" }
];
function countDistinctPostingValues(items, getValue) {
  const values = new Set();
  for (const item of Array.isArray(items) ? items : []) {
    const value = String(getValue(item) || "").trim().toLowerCase();
    if (value) values.add(value);
  }
  return values.size;
}

function readPositiveInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : null;
}

function buildFrontendResultCoverage(response = {}, items = [], sourceFacets = [], totalCount = 0) {
  const jobSlotCount = Math.max(0, Math.floor(Number(totalCount || items.length || 0)));
  const loadedItemCount = Array.isArray(items) ? items.length : 0;
  const allVisibleItemsLoaded = jobSlotCount <= loadedItemCount;
  const countExact = response?.count_exact !== false || allVisibleItemsLoaded;
  const approximateJobSlotCount = !countExact && jobSlotCount > 0;
  const sourceFacetCount = Array.isArray(sourceFacets) ? sourceFacets.filter((item) => Number(item?.count || 0) > 0).length : 0;
  const responseAtsCount = readPositiveInteger(response?.visible_ats_count) ?? readPositiveInteger(response?.ats_count);
  const responseCompanyCount =
    readPositiveInteger(response?.visible_company_count) ??
    readPositiveInteger(response?.company_count);
  const atsCount =
    responseAtsCount ??
    (countExact && sourceFacetCount ? sourceFacetCount : null) ??
    (allVisibleItemsLoaded ? countDistinctPostingValues(items, (item) => item?.ats) : 0);
  const companyCount = responseCompanyCount ?? (allVisibleItemsLoaded ? countDistinctPostingValues(items, (item) => item?.company_name) : 0);
  const omitAtsCount = responseAtsCount === null && !countExact && !allVisibleItemsLoaded;
  const omitCompanyCount = responseCompanyCount === null && !allVisibleItemsLoaded;
  return {
    posting_count: jobSlotCount,
    job_slot_count: jobSlotCount,
    job_slot_count_label: approximateJobSlotCount ? `${formatExactNumberLabel(jobSlotCount)}+` : undefined,
    job_slot_count_approximate: approximateJobSlotCount,
    omit_job_slot_count: approximateJobSlotCount,
    count_exact: countExact,
    configured_ats_count: atsCount,
    configured_enabled_ats_count: atsCount,
    visible_ats_count: atsCount,
    omit_ats_count: omitAtsCount,
    company_count: companyCount,
    visible_company_count: companyCount,
    omit_company_count: omitCompanyCount
  };
}

function normalizePublicLanguageCode(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/_/g, "-");
  if (!normalized) return "";
  const exact = PUBLIC_LANGUAGE_CANONICAL_CODE_BY_NORMALIZED.get(normalized);
  if (exact) return exact;
  const primary = normalized.split("-")[0];
  return PUBLIC_LANGUAGE_PRIMARY_FALLBACK_BY_CODE.get(primary) || "";
}

function getPublicDocumentDirection(languageCode) {
  return normalizePublicLanguageCode(languageCode) === "ar" ? "rtl" : "ltr";
}

function readWebStorageValue(key) {
  if (Platform.OS !== "web" || typeof window === "undefined" || !window.localStorage) return "";
  try {
    return String(window.localStorage.getItem(key) || "");
  } catch {
    return "";
  }
}

function writeWebStorageValue(key, value) {
  if (Platform.OS !== "web" || typeof window === "undefined" || !window.localStorage) return;
  try {
    window.localStorage.setItem(key, String(value || ""));
  } catch {
    // Local storage is optional; ignore private browsing or quota failures.
  }
}

function readWebCookieValue(name) {
  if (Platform.OS !== "web" || typeof document === "undefined") return "";
  const target = `${encodeURIComponent(String(name || ""))}=`;
  try {
    const cookie = String(document.cookie || "")
      .split(";")
      .map((item) => item.trim())
      .find((item) => item.startsWith(target));
    return cookie ? decodeURIComponent(cookie.slice(target.length)) : "";
  } catch {
    return "";
  }
}

function normalizeVisitedPostingUrl(value) {
  return String(value || "").trim();
}

function normalizeVisitedPostingUrlList(value) {
  return (Array.isArray(value) ? value : [])
    .map(normalizeVisitedPostingUrl)
    .filter(Boolean)
    .slice(-MAX_VISITED_POSTING_URLS);
}

function readVisitedPostingUrls() {
  const raw = readWebStorageValue(VISITED_POSTING_URLS_STORAGE_KEY);
  if (!raw) return new Set();
  try {
    return new Set(normalizeVisitedPostingUrlList(JSON.parse(raw)));
  } catch {
    return new Set();
  }
}

function writeVisitedPostingUrls(urls) {
  const normalized = normalizeVisitedPostingUrlList(Array.from(urls || []));
  writeWebStorageValue(VISITED_POSTING_URLS_STORAGE_KEY, JSON.stringify(normalized));
}

function addVisitedPostingUrl(currentUrls, postingUrl) {
  const normalized = normalizeVisitedPostingUrl(postingUrl);
  if (!normalized) return currentUrls instanceof Set ? currentUrls : new Set();
  const next = new Set(currentUrls instanceof Set ? currentUrls : []);
  next.delete(normalized);
  next.add(normalized);
  return new Set(Array.from(next).slice(-MAX_VISITED_POSTING_URLS));
}

function sanitizePublicSearchUrlQuery(value) {
  const normalized = String(value || "").replace(/\s+/g, " ").trim();
  if (normalized.length < 2) return "";
  if (/[^\s@]+@[^\s@]+\.[^\s@]+/.test(normalized)) return "";
  if (/\b(?:https?:\/\/|www\.)\S+/i.test(normalized)) return "";
  return normalized.slice(0, 80);
}

function getPublicSeoRouteHint() {
  if (Platform.OS !== "web" || typeof window === "undefined") return null;
  return getPublicSeoRouteHintByPath(window.location?.pathname || "/");
}

function readInitialPublicSearchQuery() {
  if (Platform.OS !== "web" || typeof window === "undefined" || typeof URLSearchParams === "undefined") return "";
  try {
    const params = new URLSearchParams(window.location.search || "");
    return sanitizePublicSearchUrlQuery(params.get("q") || params.get("search") || getPublicSeoRouteHint()?.searchQuery || "");
  } catch {
    return "";
  }
}

function replacePublicSearchUrlQuery(query) {
  if (Platform.OS !== "web" || typeof window === "undefined" || !window.history || typeof URL === "undefined") return;
  try {
    const nextQuery = sanitizePublicSearchUrlQuery(query);
    const url = new URL(window.location.href);
    url.searchParams.delete("search");
    if (nextQuery) url.searchParams.set("q", nextQuery);
    else url.searchParams.delete("q");
    const nextUrl = `${url.pathname}${url.search}${url.hash}`;
    if (nextUrl !== `${window.location.pathname}${window.location.search}${window.location.hash}`) {
      window.history.replaceState({}, "", nextUrl);
    }
  } catch {
    // URL state is best-effort; search remains functional without History API.
  }
}

function replacePublicSearchUrlPath(pathname) {
  if (Platform.OS !== "web" || typeof window === "undefined" || !window.history || typeof URL === "undefined") return;
  const rawPath = String(pathname || "").trim();
  if (!rawPath || !rawPath.startsWith("/") || rawPath.startsWith("//")) return;
  try {
    const url = new URL(rawPath, window.location.origin);
    const nextUrl = `${url.pathname}${url.search}${url.hash}`;
    if (nextUrl !== `${window.location.pathname}${window.location.search}${window.location.hash}`) {
      window.history.replaceState({}, "", nextUrl);
    }
  } catch {
    // URL path state is best-effort; search remains functional without History API.
  }
}

function getBrowserLanguageCode(fallback = DEFAULT_PUBLIC_LANGUAGE) {
  if (Platform.OS !== "web" || typeof window === "undefined") return fallback;
  const candidates = [
    ...(Array.isArray(window.navigator?.languages) ? window.navigator.languages : []),
    window.navigator?.language,
    window.navigator?.userLanguage
  ];
  for (const candidate of candidates) {
    const languageCode = normalizePublicLanguageCode(candidate);
    if (languageCode) return languageCode;
  }
  return fallback;
}

function getInitialPublicLanguageCode() {
  return (
    normalizePublicLanguageCode(getPublicSeoRouteHint()?.languageCode) ||
    normalizePublicLanguageCode(readWebStorageValue(PUBLIC_LANGUAGE_STORAGE_KEY)) ||
    getBrowserLanguageCode("") ||
    normalizePublicLanguageCode(readWebCookieValue(PUBLIC_LANGUAGE_HINT_COOKIE)) ||
    DEFAULT_PUBLIC_LANGUAGE
  );
}

function getInitialPublicTheme() {
  const saved = readWebStorageValue(PUBLIC_THEME_STORAGE_KEY).toLowerCase();
  if (saved === "dark" || saved === "light") return saved;
  if (Platform.OS === "web" && typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)")?.matches) {
    return "dark";
  }
  return "light";
}

function translatePublicText(languageCode, key, fallback = "") {
  const messages = PUBLIC_MESSAGES[languageCode] || PUBLIC_MESSAGES.en;
  return messages?.[key] || PUBLIC_MESSAGES.en?.[key] || fallback || key;
}

function interpolatePublicText(template, values = {}) {
  return String(template || "").replace(/\{([a-zA-Z0-9_]+)\}/g, (_match, key) =>
    Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : ""
  );
}

function translatedPublicText(t, key, fallback = "", values = {}) {
  return interpolatePublicText(t(key, fallback), values);
}

const SEO_LANDING_LINK_LIMIT = 8;

function getSeoLandingLinkLabel(route) {
  return String(route?.label || "").trim() || getPublicSeoRouteLabel(route);
}

function getSeoLandingCompactLabel(label) {
  const normalized = String(label || "").replace(/\s+/g, " ").trim();
  const chars = Array.from(normalized);
  if (chars.length <= 22) return normalized;
  return `${chars.slice(0, 19).join("").trim()}...`;
}

function getSeoLandingLinkTestId(route) {
  return `seo-landing-link-${String(route?.path || "route").replace(/^\/+/, "").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "")}`;
}

function SeoLandingLinks({ languageCode, t, isDarkTheme, popularSearchItems, compact = false, onSelectPopularSearch }) {
  const allLinks = Array.isArray(popularSearchItems) && popularSearchItems.length > 0
    ? popularSearchItems
    : getPublicSeoPopularSearchItems(languageCode, [], SEO_LANDING_LINK_LIMIT);
  const links = compact ? allLinks.slice(0, 6) : allLinks;
  if (links.length === 0) return null;
  return (
    <View style={[styles.seoLandingLinks, compact ? styles.seoLandingLinksCompact : null]} testID="seo-landing-links">
      <Text style={[styles.seoLandingLinksTitle, isDarkTheme ? styles.textMutedDark : null]}>
        {t("seo.popularSearches", "Popular searches")}
      </Text>
      <View style={[styles.seoLandingLinksList, compact ? styles.seoLandingLinksListCompact : null]}>
        {links.map((route, index) => {
          const label = getSeoLandingLinkLabel(route);
          const displayLabel = compact ? getSeoLandingCompactLabel(label) : label;
          const key = String(route?.path || route?.searchQuery || route?.localizedSearchQuery || label || index);
          const isQueryLandingPath = String(route?.path || "").includes("?");
          if (Platform.OS === "web") {
            return (
              <Text
                key={key}
                href={isQueryLandingPath ? undefined : route.path}
                hrefAttrs={isQueryLandingPath ? undefined : { rel: "bookmark" }}
                onPress={isQueryLandingPath ? () => onSelectPopularSearch?.(route) : undefined}
                numberOfLines={compact ? 1 : undefined}
                style={[
                  styles.seoLandingLink,
                  compact ? styles.seoLandingLinkCompact : null,
                  isDarkTheme ? styles.seoLandingLinkDark : null
                ]}
                testID={getSeoLandingLinkTestId(route)}
                accessibilityRole={isQueryLandingPath ? "button" : "link"}
                accessibilityLabel={label}
              >
                {displayLabel}
              </Text>
            );
          }
          return (
            <Pressable
              key={key}
              onPress={() => onSelectPopularSearch?.(route)}
              style={({ pressed }) => [
                styles.seoLandingLinkButton,
                compact ? styles.seoLandingLinkButtonCompact : null,
                isDarkTheme ? styles.seoLandingLinkButtonDark : null,
                pressed ? styles.buttonPressed : null
              ]}
              testID={getSeoLandingLinkTestId(route)}
              accessibilityRole="button"
              accessibilityLabel={label}
            >
              <Text
                numberOfLines={1}
                style={[
                  styles.seoLandingLinkButtonText,
                  compact ? styles.seoLandingLinkButtonTextCompact : null,
                  isDarkTheme ? styles.seoLandingLinkButtonTextDark : null
                ]}
              >
                {displayLabel}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const PUBLIC_RELEASE_MONTH_INDEX = Object.freeze({
  january: 0,
  february: 1,
  march: 2,
  april: 3,
  may: 4,
  june: 5,
  july: 6,
  august: 7,
  september: 8,
  october: 9,
  november: 10,
  december: 11
});

function getPublicLocale(languageCode) {
  return PUBLIC_LOCALE_BY_LANGUAGE_CODE[languageCode] || PUBLIC_LOCALE_BY_LANGUAGE_CODE.en;
}

function formatPublicReleaseDate(rawDate, languageCode) {
  const raw = String(rawDate || "").trim();
  const namedMonthMatch = raw.match(/^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})$/);
  const namedMonthIndex = PUBLIC_RELEASE_MONTH_INDEX[namedMonthMatch?.[1]?.toLowerCase()];
  const date = namedMonthIndex !== undefined
    ? new Date(Date.UTC(Number(namedMonthMatch[3]), namedMonthIndex, Number(namedMonthMatch[2]), 12, 0, 0))
    : new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  try {
    return new Intl.DateTimeFormat(getPublicLocale(languageCode), {
      year: "numeric",
      month: "short",
      day: "numeric",
      timeZone: "UTC"
    }).format(date);
  } catch {
    return raw;
  }
}

function getLocalizedReleaseNote(release, languageCode, t) {
  const translated = PUBLIC_RELEASE_NOTE_TRANSLATIONS[languageCode]?.[release.version];
  return {
    ...release,
    title: translated?.title || release.title,
    summary: translated?.summary || release.summary,
    dateLabel: formatPublicReleaseDate(release.date, languageCode)
  };
}

function getSearchSuggestionTypeLabel(type, t) {
  const normalizedType = String(type || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
  const keyByType = {
    ats: "suggestion.ats",
    title: "suggestion.title",
    company: "suggestion.company",
    location: "suggestion.location",
    country: "suggestion.country",
    region: "suggestion.region",
    industry: "suggestion.industry",
    recent: "suggestion.recent",
    search: "suggestion.search"
  };
  const key = keyByType[normalizedType];
  if (!key) return String(type || "").trim();
  return t(key, String(type || "").trim());
}

function getPublicStatsChipLabel(chip, t) {
  const keyByChip = {
    "job-slots": "stats.jobSlots",
    ats: "stats.ats",
    companies: "stats.companies"
  };
  const key = keyByChip[chip?.key];
  return key ? t(key, chip?.label || "") : chip?.label || "";
}

function getTranslatedSortOption(option, languageCode) {
  const value = String(option?.value || "").trim() || "relevance";
  return {
    ...option,
    value,
    label: translatePublicText(languageCode, `sort.${value}`, option?.label || value)
  };
}

function getTranslatedFreshnessLabel(value, languageCode, fallback) {
  return translatePublicText(languageCode, `freshness.${String(value)}`, fallback);
}

const DEFAULT_ATS_FILTER_OPTIONS = [
  { value: "adp_myjobs", label: "ADP MyJobs" },
  { value: "adp_workforcenow", label: "ADP Workforce Now" },
  { value: "applicantai", label: "ApplicantAI" },
  { value: "applitrack", label: "Applitrack" },
  { value: "applicantpro", label: "ApplicantPro" },
  { value: "applytojob", label: "ApplyToJob" },
  { value: "ashby", label: "Ashby" },
  { value: "bamboohr", label: "BambooHR" },
  { value: "brassring", label: "BrassRing" },
  { value: "breezy", label: "BreezyHR" },
  { value: "careerplug", label: "CareerPlug" },
  { value: "careerpuck", label: "CareerPuck" },
  { value: "careerspage", label: "CareersPage" },
  { value: "dayforcehcm", label: "Dayforce" },
  { value: "eightfold", label: "Eightfold" },
  { value: "fountain", label: "Fountain" },
  { value: "freshteam", label: "Freshteam" },
  { value: "gem", label: "Gem" },
  { value: "getro", label: "Getro" },
  { value: "governmentjobs", label: "GovernmentJobs" },
  { value: "smartrecruiters", label: "SmartRecruiters" },
  { value: "policeapp", label: "PoliceApp" },
  { value: "usajobs", label: "USAJobs" },
  { value: "k12jobspot", label: "K12JobSpot" },
  { value: "schoolspring", label: "SchoolSpring" },
  { value: "calcareers", label: "CalCareers" },
  { value: "calopps", label: "CalOpps" },
  { value: "statejobsny", label: "StateJobsNY" },
  { value: "hibob", label: "HiBob" },
  { value: "isolvisolvedhire", label: "isolvedhire" },
  { value: "greenhouse", label: "Greenhouse" },
  { value: "hirebridge", label: "Hirebridge" },
  { value: "hrmdirect", label: "HRMDirect" },
  { value: "icims", label: "iCIMS" },
  { value: "jobaps", label: "JobAps" },
  { value: "jobvite", label: "Jobvite" },
  { value: "join", label: "JOIN" },
  { value: "lever", label: "Lever" },
  { value: "loxo", label: "Loxo" },
  { value: "manatal", label: "Manatal" },
  { value: "oracle", label: "Oracle" },
  { value: "pageup", label: "PageUp" },
  { value: "paylocity", label: "Paylocity" },
  { value: "peopleforce", label: "PeopleForce" },
  { value: "pinpointhq", label: "PinpointHQ" },
  { value: "recruitcrm", label: "RecruitCRM" },
  { value: "recruitee", label: "Recruitee" },
  { value: "rippling", label: "Rippling" },
  { value: "sagehr", label: "SageHR" },
  { value: "saphrcloud", label: "SAP HR Cloud" },
  { value: "simplicant", label: "Simplicant" },
  { value: "talentlyft", label: "Talentlyft" },
  { value: "talentreef", label: "TalentReef" },
  { value: "taleo", label: "Taleo" },
  { value: "talexio", label: "Talexio" },
  { value: "teamtailor", label: "Teamtailor" },
  { value: "theapplicantmanager", label: "The Applicant Manager" },
  { value: "ultipro", label: "UltiPro" },
  { value: "workday", label: "Workday" },
  { value: "zoho", label: "Zoho Recruit" }
];
const ATS_LABEL_BY_VALUE = {
  adp_myjobs: "ADP MyJobs",
  adp_workforcenow: "ADP Workforce Now",
  applicantai: "ApplicantAI",
  applitrack: "Applitrack",
  applicantpro: "ApplicantPro",
  applytojob: "ApplyToJob",
  ashby: "Ashby",
  bamboohr: "BambooHR",
  brassring: "BrassRing",
  breezy: "BreezyHR",
  careerplug: "CareerPlug",
  careerpuck: "CareerPuck",
  careerspage: "CareersPage",
  dayforcehcm: "Dayforce",
  eightfold: "Eightfold",
  fountain: "Fountain",
  freshteam: "Freshteam",
  gem: "Gem",
  getro: "Getro",
  governmentjobs: "GovernmentJobs",
  smartrecruiters: "SmartRecruiters",
  policeapp: "PoliceApp",
  usajobs: "USAJobs",
  k12jobspot: "K12JobSpot",
  schoolspring: "SchoolSpring",
  calcareers: "CalCareers",
  calopps: "CalOpps",
  statejobsny: "StateJobsNY",
  hibob: "HiBob",
  isolvisolvedhire: "isolvedhire",
  greenhouse: "Greenhouse",
  hirebridge: "Hirebridge",
  hrmdirect: "HRMDirect",
  icims: "iCIMS",
  jobaps: "JobAps",
  jobvite: "Jobvite",
  join: "JOIN",
  lever: "Lever",
  loxo: "Loxo",
  manatal: "Manatal",
  oracle: "Oracle",
  pageup: "PageUp",
  paylocity: "Paylocity",
  peopleforce: "PeopleForce",
  pinpointhq: "PinpointHQ",
  recruitcrm: "RecruitCRM",
  recruitee: "Recruitee",
  rippling: "Rippling",
  sagehr: "SageHR",
  saphrcloud: "SAP HR Cloud",
  simplicant: "Simplicant",
  talentlyft: "Talentlyft",
  talentreef: "TalentReef",
  taleo: "Taleo",
  talexio: "Talexio",
  teamtailor: "Teamtailor",
  theapplicantmanager: "The Applicant Manager",
  ultipro: "UltiPro",
  workday: "Workday",
  zoho: "Zoho Recruit"
};

let androidNetInfoModule;

function getAndroidNetInfo() {
  if (Platform.OS !== "android") return null;
  if (androidNetInfoModule !== undefined) {
    return androidNetInfoModule;
  }
  try {
    androidNetInfoModule = require("@react-native-community/netinfo").default;
  } catch {
    androidNetInfoModule = null;
  }
  return androidNetInfoModule;
}

function sanitizeDisplayText(value, fallback = "") {
  const source = String(value ?? "");
  if (!source) return fallback;

  let cleaned = "";
  for (let index = 0; index < source.length; index += 1) {
    const code = source.charCodeAt(index);

    // Drop surrogate pairs and lone surrogate code units to avoid unstable
    // rendering behavior in some Windows/Hermes combinations.
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = source.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        index += 1;
      }
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) {
      continue;
    }

    // Keep printable characters plus tab/newline/carriage return.
    if (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) {
      continue;
    }

    cleaned += source[index];
  }

  return cleaned || fallback;
}

function isSafeExternalHttpUrl(value) {
  try {
    const parsed = new URL(String(value || "").trim());
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function formatDateTimeSafe(value, fallback = "Unknown time") {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return fallback;
  }
  const pad = (part) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(
    date.getMinutes()
  )}:${pad(date.getSeconds())}`;
}

function formatPostingDateLabel(value, languageCode, fallback = "Posting date unavailable") {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  try {
    return new Intl.DateTimeFormat(getPublicLocale(languageCode), {
      year: "numeric",
      month: "short",
      day: "numeric"
    }).format(date);
  } catch {
    return formatDateTimeSafe(date, fallback).slice(0, 10);
  }
}

function formatPostingUrlHostLabel(value) {
  try {
    const parsed = new URL(String(value || "").trim());
    return parsed.hostname.replace(/^www\./i, "");
  } catch {
    return "";
  }
}

function formatTimeSafe(value, fallback = "Unknown time") {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return fallback;
  }
  const pad = (part) => String(part).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function formatNumberLabel(value, fallback = "0") {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return fallback;
  return numberValue.toLocaleString();
}

function formatCompactNumberLabel(value, fallback = "0") {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return fallback;
  const absValue = Math.abs(numberValue);
  if (absValue >= 1_000_000) return `${(numberValue / 1_000_000).toFixed(absValue >= 10_000_000 ? 0 : 1)}M`;
  if (absValue >= 1_000) return `${(numberValue / 1_000).toFixed(absValue >= 10_000 ? 0 : 1)}K`;
  return formatNumberLabel(numberValue, fallback);
}

function buildResultCountLabel({ showResultsSurface, resultTotalCount, t }) {
  const value = showResultsSurface || resultTotalCount > 0
    ? formatExactNumberLabel(resultTotalCount)
    : t("results.indexLoading", "Loading index");
  const unit = showResultsSurface || resultTotalCount > 0
    ? resultTotalCount === 1 ? t("results.slotIndexed", "job slot") : t("results.slotsIndexed", "job slots")
    : "";
  return {
    value,
    unit,
    label: unit ? `${value} ${unit}` : value
  };
}

function formatEpochSeconds(value, fallback = "Not available") {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue) || numberValue <= 0) return fallback;
  return formatDateTimeSafe(new Date(numberValue * 1000), fallback);
}

function toTestIdPart(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeRegionName(value) {
  return String(value || "").trim().toLowerCase();
}

function regionMatchesSelection(region, selectedRegions) {
  const normalizedRegion = normalizeRegionName(region);
  if (!normalizedRegion) return false;
  return (selectedRegions || []).some((selectedRegion) => {
    const normalizedSelected = normalizeRegionName(selectedRegion);
    if (!normalizedSelected) return false;
    if (normalizedRegion === normalizedSelected) return true;
    const selectedGroup = REGION_GROUPS[normalizedSelected] || [];
    if (selectedGroup.includes(normalizedRegion)) return true;
    const matchingGroup = Object.values(REGION_GROUPS).find((group) => group.includes(normalizedSelected));
    return Array.isArray(matchingGroup) && matchingGroup.includes(normalizedRegion);
  });
}

function formatApplicationDate(value) {
  const epochSeconds = Number(value);
  if (!Number.isFinite(epochSeconds) || epochSeconds <= 0) {
    return "Unknown date";
  }

  const date = new Date(epochSeconds * 1000);
  if (Number.isNaN(date.getTime())) {
    return "Unknown date";
  }

  const pad = (part) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(
    date.getMinutes()
  )}`;
}

function normalizeApplicationItem(item) {
  const source = item && typeof item === "object" ? item : {};
  return {
    ...source,
    id: Number(source.id || 0),
    company_name: sanitizeDisplayText(source.company_name, ""),
    position_name: sanitizeDisplayText(source.position_name, ""),
    status: sanitizeDisplayText(source.status, "applied"),
    applied_by_label: sanitizeDisplayText(source.applied_by_label, "")
  };
}

function normalizePostingItem(item, index = 0) {
  const source = item && typeof item === "object" ? item : {};
  const urlValue = sanitizeDisplayText(source.job_posting_url, "").trim();
  const companyName = sanitizeDisplayText(source.company_name, "");
  const positionName = sanitizeDisplayText(source.position_name, "");
  const fallbackCompanyPart = normalizeCompanyName(companyName) || "company";
  const fallbackPositionPart =
    String(positionName || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "-") || "position";
  return {
    ...source,
    company_name: companyName,
    position_name: positionName,
    location: sanitizeDisplayText(source.location, ""),
    posting_date: sanitizeDisplayText(source.posting_date, ""),
    ats: sanitizeDisplayText(source.ats, ""),
    applied_by_label: sanitizeDisplayText(source.applied_by_label, ""),
    ignored_by_label: sanitizeDisplayText(source.ignored_by_label, ""),
    job_posting_url: urlValue,
    _row_fallback_key: urlValue || `${fallbackCompanyPart}-${fallbackPositionPart}-${index}`
  };
}

function normalizePostingItems(items) {
  const source = Array.isArray(items) ? items : [];
  return source.map((item, index) => normalizePostingItem(item, index));
}

function normalizeSourceFacetItem(item) {
  const source = item && typeof item === "object" ? item : {};
  const value = normalizeAtsValue(source.value || source.ats || source.source || source.label || "") || "unknown";
  const label = sanitizeDisplayText(source.label || getAtsDisplayLabel(value), getAtsDisplayLabel(value));
  const count = Math.max(0, Number(source.count || 0));
  const freshCount = Math.max(0, Math.min(count, Number(source.fresh_count || source.freshCount || 0)));
  const latestSeenEpoch = Math.max(0, Number(source.latest_seen_epoch || source.latestSeenEpoch || 0));
  const rawFreshPercentage = Number(source.fresh_percentage ?? source.freshPercentage);
  const freshPercentage = Number.isFinite(rawFreshPercentage)
    ? Math.max(0, Math.min(100, Math.round(rawFreshPercentage)))
    : count > 0
      ? Math.round((freshCount / count) * 100)
      : 0;

  if (!count) return null;
  return {
    key: value,
    value,
    label,
    count,
    avgConfidence: Math.max(0, Number(source.avg_confidence ?? source.avgConfidence ?? 0) || 0),
    avgQuality: Math.max(0, Number(source.avg_quality ?? source.avgQuality ?? 0) || 0),
    latestSeenEpoch,
    freshCount,
    freshPercentage
  };
}

function normalizeSourceFacets(items) {
  return (Array.isArray(items) ? items : [])
    .map(normalizeSourceFacetItem)
    .filter(Boolean)
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, SOURCE_INTELLIGENCE_LIMIT);
}

function buildSourceFacetsFromPostings(items) {
  const bySource = new Map();
  const freshCutoffEpoch = Math.floor(Date.now() / 1000) - 3 * 24 * 60 * 60;
  (Array.isArray(items) ? items : []).forEach((posting) => {
    const value = normalizeAtsValue(posting?.ats || "") || "unknown";
    const existing = bySource.get(value) || {
      value,
      label: getAtsDisplayLabel(value),
      count: 0,
      latest_seen_epoch: 0,
      fresh_count: 0,
      avg_confidence: 0,
      avg_quality: 0
    };
    existing.count += 1;
    const latestSeenEpoch = Math.max(0, Number(posting?.last_seen_epoch || 0));
    if (latestSeenEpoch > existing.latest_seen_epoch) {
      existing.latest_seen_epoch = latestSeenEpoch;
    }
    if (latestSeenEpoch >= freshCutoffEpoch) {
      existing.fresh_count += 1;
    }
    bySource.set(value, existing);
  });
  return normalizeSourceFacets(Array.from(bySource.values()));
}

function formatSourceMetricPercent(value) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue) || numberValue <= 0) return "0%";
  const percentValue = numberValue <= 1 ? numberValue * 100 : numberValue;
  return `${Math.round(percentValue)}%`;
}

function formatSourceQualitySummary(source, t = (key, fallback) => fallback || key) {
  return `${t("sources.confidence", "Conf")} ${formatSourceMetricPercent(source?.avgConfidence)} - ${t("sources.quality", "Quality")} ${Math.round(Number(source?.avgQuality || 0))}`;
}

function formatSourceFreshnessSummary(source, t = (key, fallback) => fallback || key) {
  const freshPercentage = Math.max(0, Math.min(100, Math.round(Number(source?.freshPercentage || 0))));
  if (source?.latestSeenEpoch) {
    return translatedPublicText(t, "sources.freshSeen", "{fresh}% fresh - seen {date}", {
      fresh: freshPercentage,
      date: formatEpochSeconds(source.latestSeenEpoch, "recent").slice(0, 10)
    });
  }
  return translatedPublicText(t, "sources.currentSet", "{fresh}% fresh - current set", {
    fresh: freshPercentage
  });
}

function getPostingIdentity(item, fallbackIndex = 0) {
  const source = item && typeof item === "object" ? item : {};
  return String(
    source.job_posting_url ||
      source.canonical_url ||
      source._row_fallback_key ||
      `posting-${fallbackIndex}`
  ).trim();
}

function mergePostingItems(existingItems, nextItems) {
  const merged = [];
  const indexByKey = new Map();

  const addOrReplace = (item, fallbackIndex) => {
    const key = getPostingIdentity(item, fallbackIndex);
    if (!key) return;
    if (indexByKey.has(key)) {
      merged[indexByKey.get(key)] = item;
      return;
    }
    indexByKey.set(key, merged.length);
    merged.push(item);
  };

  (Array.isArray(existingItems) ? existingItems : []).forEach(addOrReplace);
  (Array.isArray(nextItems) ? nextItems : []).forEach((item, index) =>
    addOrReplace(item, index + merged.length)
  );
  return merged;
}

function normalizeSuggestionQuery(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function normalizeSearchSuggestionItem(item, fallbackType = "search") {
  const source = item && typeof item === "object" ? item : {};
  const value = sanitizeDisplayText(source.value || source.label, "").trim();
  const label = sanitizeDisplayText(source.label || source.value, "").trim();
  if (!value || !label) return null;
  const normalized = {
    type: sanitizeDisplayText(source.type, fallbackType).trim() || fallbackType,
    value,
    label,
    count: Number(source.count || 1)
  };
  const intentType = sanitizeDisplayText(source.intent_type || source.intentType, "").trim();
  const filter = normalizeSearchSuggestionFilter(source.filter);
  if (intentType) normalized.intent_type = intentType;
  if (filter) normalized.filter = filter;
  return normalized;
}

function mergeSearchSuggestions(...groups) {
  const merged = [];
  const seen = new Set();
  groups.flat().forEach((item) => {
    const normalized = normalizeSearchSuggestionItem(item);
    if (!normalized) return;
    const normalizedType = String(normalized.type || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "");
    if (normalizedType === "search") return;
    const key = `${normalized.type}:${normalizeSuggestionQuery(normalized.value)}`;
    if (seen.has(key)) return;
    seen.add(key);
    merged.push(normalized);
  });
  return merged;
}

function appendLocalSuggestion(candidates, type, value, label = value, count = 1, extras = {}) {
  const normalized = normalizeSearchSuggestionItem({ type, value, label, count, ...extras }, type);
  if (normalized) {
    candidates.push(normalized);
  }
}

function normalizeSearchSuggestionFilter(filter) {
  const source = filter && typeof filter === "object" ? filter : {};
  const patch = {};
  const remote = String(source.remote || "").trim().toLowerCase();
  if (["remote", "hybrid", "non_remote"].includes(remote)) {
    patch.remote = remote;
  }
  const freshnessDays = Number(source.freshness_days || source.freshnessDays || 0);
  if ([3, 7, 30].includes(freshnessDays)) {
    patch.freshness_days = freshnessDays;
  }
  const ats = normalizeAtsValue(source.ats || source.source || "");
  if (ats && ATS_LABEL_BY_VALUE[ats]) {
    patch.ats = ats;
  }
  return Object.keys(patch).length > 0 ? patch : null;
}

function normalizedSuggestionContainsTerm(text, term) {
  const normalizedText = normalizeSuggestionQuery(text);
  const normalizedTerm = normalizeSuggestionQuery(term);
  if (!normalizedText || !normalizedTerm) return false;
  const escaped = normalizedTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (new RegExp(`(^|\\s)${escaped}(\\s|$)`).test(normalizedText)) return true;
  return normalizedTerm.length >= 4 && normalizedText.includes(normalizedTerm);
}

function getSearchSourceSuggestionOptions(filterOptions = {}) {
  const byValue = new Map();
  const add = (option) => {
    const rawValue = option?.value || option?.label;
    const value = normalizeAtsValue(rawValue);
    const label = sanitizeDisplayText(option?.label || rawValue, "").trim();
    if (!value || !label || byValue.has(value)) return;
    byValue.set(value, { value, label, count: Number(option?.count || 1) });
  };
  DEFAULT_ATS_FILTER_OPTIONS.forEach(add);
  (filterOptions.ats || []).forEach(add);
  return Array.from(byValue.values());
}

function buildSearchIntentSuggestions(query, limit = SEARCH_INTENT_CHIP_LIMIT, context = {}) {
  const normalizedQuery = normalizeSuggestionQuery(query);
  if (normalizedQuery.length < 2) return [];

  const candidates = [];
  if (normalizedSuggestionContainsTerm(normalizedQuery, "remote") || normalizedSuggestionContainsTerm(normalizedQuery, "wfh") || normalizedQuery.includes("work from home")) {
    appendLocalSuggestion(candidates, "intent", "remote", "Remote", 1, {
      intent_type: "remote",
      filter: { remote: "remote" }
    });
  }
  if (normalizedSuggestionContainsTerm(normalizedQuery, "hybrid")) {
    appendLocalSuggestion(candidates, "intent", "hybrid", "Hybrid", 1, {
      intent_type: "hybrid",
      filter: { remote: "hybrid" }
    });
  }
  if (
    normalizedSuggestionContainsTerm(normalizedQuery, "onsite") ||
    normalizedQuery.includes("on site") ||
    normalizedQuery.includes("in office")
  ) {
    appendLocalSuggestion(candidates, "intent", "onsite", "On-site", 1, {
      intent_type: "onsite",
      filter: { remote: "non_remote" }
    });
  }
  if (/(^|\s)(last|past|within)\s+3\s+(days?|d)(\s|$)/.test(normalizedQuery) || /(^|\s)3\s+(days?|d)(\s|$)/.test(normalizedQuery) || /(^|\s)3d(\s|$)/.test(normalizedQuery)) {
    appendLocalSuggestion(candidates, "intent", "3", "Last 3 days", 1, {
      intent_type: "freshness",
      filter: { freshness_days: 3 }
    });
  }

  getSearchSourceSuggestionOptions(context.postingFilterOptions || {}).forEach((source) => {
    if (
      normalizedSuggestionContainsTerm(normalizedQuery, source.value) ||
      normalizedSuggestionContainsTerm(normalizedQuery, source.label)
    ) {
      appendLocalSuggestion(candidates, "source", source.value, source.label, source.count, {
        intent_type: "source",
        filter: { ats: source.value }
      });
    }
  });

  return mergeSearchSuggestions(candidates).slice(0, limit);
}

function getSearchSuggestionFilterPatch(suggestion) {
  return normalizeSearchSuggestionFilter(suggestion?.filter);
}

function getSearchIntentChipTestId(suggestion) {
  const filter = getSearchSuggestionFilterPatch(suggestion);
  const intentType = String(suggestion?.intent_type || suggestion?.type || "").trim().toLowerCase();
  if (filter?.freshness_days) return `intent-chip-freshness-${filter.freshness_days}d`;
  if (filter?.ats) return `intent-chip-source-${filter.ats}`;
  if (intentType === "onsite" || filter?.remote === "non_remote") return "intent-chip-onsite";
  if (filter?.remote) return `intent-chip-${filter.remote}`;
  return `intent-chip-${normalizeSuggestionQuery(suggestion?.value || suggestion?.label).replace(/[^a-z0-9]+/g, "-") || "suggestion"}`;
}

function isSearchIntentActive(suggestion, filters = {}) {
  const filter = getSearchSuggestionFilterPatch(suggestion);
  if (!filter) return false;
  if (filter.remote && String(filters.remote || "all") !== filter.remote) return false;
  if (filter.freshness_days && String(filters.freshness_days || "all") !== String(filter.freshness_days)) return false;
  if (filter.ats && String(filters.ats || "all") !== filter.ats) return false;
  return true;
}

function buildLocalSearchSuggestions(query, limit = 5, context = {}) {
  const normalizedQuery = normalizeSuggestionQuery(query);
  if (normalizedQuery.length < 2) return [];

  const candidates = [];
  const filterOptions = context.postingFilterOptions || {};
  const intentItems = buildSearchIntentSuggestions(query, SEARCH_INTENT_CHIP_LIMIT, {
    postingFilterOptions: filterOptions
  });
  const postingsSource = Array.isArray(context.postings) ? context.postings.slice(0, 250) : [];

  LOCAL_SEARCH_SHORTCUTS.forEach((shortcut) => {
    appendLocalSuggestion(candidates, shortcut.type, shortcut.value, shortcut.label);
  });
  (context.recentSearches || []).forEach((recent) => {
    appendLocalSuggestion(candidates, "recent", recent, recent);
  });
  (filterOptions.industries || []).forEach((option) => {
    appendLocalSuggestion(candidates, "industry", option?.value || option?.label, option?.label || option?.value, option?.count);
  });
  (filterOptions.countries || []).forEach((option) => {
    const label = option?.label || option?.value;
    appendLocalSuggestion(candidates, "country", label, label, option?.count);
  });
  (filterOptions.regions || []).forEach((option) => {
    const label = option?.label || option?.value;
    appendLocalSuggestion(candidates, "region", label, label, option?.count);
  });
  (filterOptions.ats || []).forEach((option) => {
    appendLocalSuggestion(candidates, "ATS", option?.value || option?.label, option?.label || option?.value, option?.count);
  });
  postingsSource.forEach((posting) => {
    appendLocalSuggestion(candidates, "title", posting?.position_name, posting?.position_name);
    appendLocalSuggestion(candidates, "company", posting?.company_name, posting?.company_name);
    appendLocalSuggestion(candidates, "location", posting?.location, posting?.location);
  });

  const scored = mergeSearchSuggestions(candidates)
    .map((item) => {
      const label = normalizeSuggestionQuery(item.label);
      const value = normalizeSuggestionQuery(item.value);
      const starts = label.startsWith(normalizedQuery) || value.startsWith(normalizedQuery);
      const contains = label.includes(normalizedQuery) || value.includes(normalizedQuery);
      const wordStarts = label.split(" ").some((part) => part.startsWith(normalizedQuery));
      const score = starts ? 3 : wordStarts ? 2 : contains ? 1 : 0;
      return { item, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || b.item.count - a.item.count || a.item.label.length - b.item.label.length)
    .map((entry) => entry.item)
    .slice(0, limit);

  if (scored.length > 0 || intentItems.length > 0) {
    return mergeSearchSuggestions(intentItems, scored).slice(0, limit);
  }
  return [];
}

function normalizeAtsValue(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return "";
  if (normalized === "ashbyhq") return "ashby";
  if (normalized === "greenhouseio" || normalized === "greenhouse.io") return "greenhouse";
  if (normalized === "leverco" || normalized === "lever.co") return "lever";
  if (normalized === "dayforce" || normalized === "dayforcehcm" || normalized === "dayforcehcm.com") {
    return "dayforcehcm";
  }
  if (normalized === "jobvitecom" || normalized === "jobvite.com") return "jobvite";
  if (normalized === "hibob.com" || normalized === "hibobcom" || normalized === "hibob" || normalized === "careers.hibob.com" || normalized === "careershibobcom") return "hibob";
  if (normalized === "isolvisolvedhire" || normalized === "isolvedhire" || normalized === "isolvedhire.com" || normalized === "isolvedhirecom") {
    return "isolvisolvedhire";
  }
  if (normalized === "applicantprocom" || normalized === "applicantpro.com") return "applicantpro";
  if (normalized === "applitrackcom" || normalized === "applitrack.com") return "applitrack";
  if (normalized === "bamboohrcom" || normalized === "bamboohr.com") return "bamboohr";
  if (normalized === "freshteamcom" || normalized === "freshteam.com") return "freshteam";
  if (normalized === "governmentjobscom" || normalized === "governmentjobs.com") return "governmentjobs";
  if (normalized === "policeappcom" || normalized === "policeapp.com" || normalized === "www.policeapp.com" || normalized === "policeapp") return "policeapp";
  if (normalized === "usajobsgov" || normalized === "usajobs.gov" || normalized === "www.usajobs.gov" || normalized === "usajobs") return "usajobs";
  if (normalized === "k12jobspotcom" || normalized === "k12jobspot.com" || normalized === "www.k12jobspot.com" || normalized === "api.k12jobspot.com" || normalized === "k12jobspot") return "k12jobspot";
  if (normalized === "schoolspringcom" || normalized === "schoolspring.com" || normalized === "www.schoolspring.com" || normalized === "api.schoolspring.com" || normalized === "schoolspring") return "schoolspring";
  if (normalized === "calcareers" || normalized === "calcareers.ca.gov" || normalized === "www.calcareers.ca.gov" || normalized === "calcareerscagov" || normalized === "wwwcalcareerscagov") return "calcareers";
  if (normalized === "calopps" || normalized === "calopps.org" || normalized === "www.calopps.org" || normalized === "caloppsorg" || normalized === "wwwcaloppsorg") return "calopps";
  if (normalized === "statejobsny" || normalized === "statejobsny.com" || normalized === "www.statejobsny.com" || normalized === "statejobsnycom" || normalized === "wwwstatejobsnycom") return "statejobsny";
  if (
    normalized === "smartrecruiterscom" ||
    normalized === "smartrecruiters.com" ||
    normalized === "jobs.smartrecruiters.com" ||
    normalized === "jobssmartrecruiterscom"
  ) {
    return "smartrecruiters";
  }
  if (
    normalized === "sagehr" ||
    normalized === "sage.hr" ||
    normalized === "talent.sage.hr" ||
    normalized === "talentsagehr"
  ) {
    return "sagehr";
  }
  if (normalized === "peopleforceio" || normalized === "peopleforce.io") return "peopleforce";
  if (normalized === "simplicantcom" || normalized === "simplicant.com") return "simplicant";
  if (normalized === "pinpointhqcom" || normalized === "pinpointhq.com") return "pinpointhq";
  if (normalized === "recruitcrmiocom" || normalized === "recruitcrm.io" || normalized === "recruitcrmio") return "recruitcrm";
  if (normalized === "rippling.com" || normalized === "ripplingcom" || normalized === "ats.rippling.com" || normalized === "atsripplingcom") {
    return "rippling";
  }
  if (normalized === "applytojobcom" || normalized === "applytojob.com") return "applytojob";
  if (normalized === "theapplicantmanagercom" || normalized === "theapplicantmanager.com") {
    return "theapplicantmanager";
  }
  if (normalized === "icimscom" || normalized === "icims.com") return "icims";
  if (normalized === "jobs.gem.com" || normalized === "gem.com" || normalized === "gemcom") return "gem";
  if (normalized === "jobapscloud.com" || normalized === "jobapscloudcom") return "jobaps";
  if (
    normalized === "jobappnetwork.com" ||
    normalized === "jobappnetworkcom" ||
    normalized === "apply.jobappnetwork.com" ||
    normalized === "applyjobappnetworkcom"
  ) {
    return "talentreef";
  }
  if (normalized === "adp_myjobs" || normalized === "adpmyjobs") return "adp_myjobs";
  if (
    normalized === "paylocity" ||
    normalized === "paylocity.com" ||
    normalized === "paylocitycom" ||
    normalized === "recruiting.paylocity.com" ||
    normalized === "recruitingpaylocitycom"
  ) {
    return "paylocity";
  }
  if (normalized === "eightfold" || normalized === "eightfold.ai" || normalized === "eightfoldai") {
    return "eightfold";
  }
  if (
    normalized === "oracle" ||
    normalized === "oraclecloud" ||
    normalized === "oraclecloud.com" ||
    normalized === "oraclecloudcom"
  ) {
    return "oracle";
  }
  if (normalized === "careerspage" || normalized === "careerspage.io" || normalized === "careerspageio") {
    return "careerspage";
  }
  if (
    normalized === "hirebridge" ||
    normalized === "hirebridge.com" ||
    normalized === "hirebridgecom" ||
    normalized === "recruit.hirebridge.com" ||
    normalized === "recruithirebridgecom"
  ) {
    return "hirebridge";
  }
  if (
    normalized === "saphrcloud.com" ||
    normalized === "saphrcloudcom" ||
    normalized === "jobs.hr.cloud.sap" ||
    normalized === "jobshrcloudsap"
  ) {
    return "saphrcloud";
  }
  if (normalized === "recruiteecom" || normalized === "recruitee.com") return "recruitee";
  if (normalized === "ukg") return "ultipro";
  if (normalized === "taleonet" || normalized === "taleo.net") return "taleo";
  return normalized;
}

function normalizeCompanyName(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function getAtsDisplayLabel(value) {
  const normalized = normalizeAtsValue(value);
  if (!normalized) return "ATS unavailable";
  return ATS_LABEL_BY_VALUE[normalized] || normalized;
}

function mergeAtsFilterOptions(options) {
  const byValue = new Map();
  const source = Array.isArray(options) ? options : [];

  for (const option of source) {
    const value = normalizeAtsValue(option?.value);
    if (!value) continue;
    const fallbackLabel = getAtsDisplayLabel(value);
    const label = String(option?.label || "").trim() || fallbackLabel;
    byValue.set(value, { value, label, enabled: option?.enabled !== false });
  }

  for (const option of DEFAULT_ATS_FILTER_OPTIONS) {
    if (!byValue.has(option.value)) {
      byValue.set(option.value, { ...option, enabled: true });
    }
  }

  return Array.from(byValue.values());
}

function normalizeSyncIntervalSeconds(value) {
  const parsed = Number.parseInt(String(value || "").trim(), 10);
  if (!Number.isFinite(parsed)) return DEFAULT_SYNC_INTERVAL_SECONDS;
  if (parsed < MIN_SYNC_INTERVAL_SECONDS) return MIN_SYNC_INTERVAL_SECONDS;
  if (parsed > MAX_SYNC_INTERVAL_SECONDS) return MAX_SYNC_INTERVAL_SECONDS;
  return parsed;
}

function formatSyncIntervalLabel(seconds) {
  const value = normalizeSyncIntervalSeconds(seconds);
  if (value % 3600 === 0) {
    const hours = value / 3600;
    return `${hours} hour${hours === 1 ? "" : "s"}`;
  }
  if (value % 60 === 0) {
    const minutes = value / 60;
    return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  }
  return `${value} seconds`;
}

function normalizeAtsRequestQueueConcurrency(value) {
  const parsed = Number.parseInt(String(value || "").trim(), 10);
  if (!Number.isFinite(parsed)) return DEFAULT_ATS_REQUEST_QUEUE_CONCURRENCY;
  if (parsed < MIN_ATS_REQUEST_QUEUE_CONCURRENCY) return MIN_ATS_REQUEST_QUEUE_CONCURRENCY;
  if (parsed > MAX_ATS_REQUEST_QUEUE_CONCURRENCY) return MAX_ATS_REQUEST_QUEUE_CONCURRENCY;
  return parsed;
}

function normalizeSyncEnabledAts(value, fallback = DEFAULT_ATS_FILTER_OPTIONS.map((option) => option.value)) {
  const allowed = new Set(DEFAULT_ATS_FILTER_OPTIONS.map((option) => option.value));
  const source = Array.isArray(value) ? value : [];
  const normalized = [];
  for (const item of source) {
    const atsValue = normalizeAtsValue(item);
    if (!atsValue || !allowed.has(atsValue) || normalized.includes(atsValue)) continue;
    normalized.push(atsValue);
  }
  if (normalized.length > 0) return normalized;

  const fallbackList = Array.isArray(fallback) ? fallback : [];
  const fallbackNormalized = [];
  for (const item of fallbackList) {
    const atsValue = normalizeAtsValue(item);
    if (!atsValue || !allowed.has(atsValue) || fallbackNormalized.includes(atsValue)) continue;
    fallbackNormalized.push(atsValue);
  }
  if (fallbackNormalized.length > 0) return fallbackNormalized;
  return DEFAULT_ATS_FILTER_OPTIONS.map((option) => option.value);
}

function createDefaultSyncServiceSettings() {
  return {
    ats_request_queue_concurrency: String(DEFAULT_ATS_REQUEST_QUEUE_CONCURRENCY),
    sync_enabled_ats: DEFAULT_ATS_FILTER_OPTIONS.map((option) => option.value),
    active_ats_request_queue_concurrency: String(DEFAULT_ATS_REQUEST_QUEUE_CONCURRENCY),
    min_ats_request_queue_concurrency: MIN_ATS_REQUEST_QUEUE_CONCURRENCY,
    max_ats_request_queue_concurrency: MAX_ATS_REQUEST_QUEUE_CONCURRENCY,
    applies_after_service_restart: true
  };
}

function toFormSyncServiceSettings(value) {
  const defaults = createDefaultSyncServiceSettings();
  const source = value && typeof value === "object" ? value : {};
  const configured = normalizeAtsRequestQueueConcurrency(source.ats_request_queue_concurrency);
  const active = normalizeAtsRequestQueueConcurrency(
    source.active_ats_request_queue_concurrency ?? configured
  );
  const syncEnabledAts = normalizeSyncEnabledAts(source.sync_enabled_ats, defaults.sync_enabled_ats);
  const minValue = normalizeAtsRequestQueueConcurrency(source.min_ats_request_queue_concurrency || defaults.min_ats_request_queue_concurrency);
  const maxValue = normalizeAtsRequestQueueConcurrency(source.max_ats_request_queue_concurrency || defaults.max_ats_request_queue_concurrency);

  return {
    ats_request_queue_concurrency: String(configured),
    sync_enabled_ats: syncEnabledAts,
    active_ats_request_queue_concurrency: String(active),
    min_ats_request_queue_concurrency: Math.min(minValue, maxValue),
    max_ats_request_queue_concurrency: Math.max(minValue, maxValue),
    applies_after_service_restart: source.applies_after_service_restart !== false
  };
}

const PERSONAL_INFORMATION_FIELDS = [
  { key: "first_name", label: "First Name", placeholder: "Jane", autoCapitalize: "words" },
  { key: "middle_name", label: "Middle Name", placeholder: "Alex", autoCapitalize: "words" },
  { key: "last_name", label: "Last Name", placeholder: "Doe", autoCapitalize: "words" },
  { key: "email", label: "Email", placeholder: "jane@example.com", keyboardType: "email-address" },
  { key: "phone_number", label: "Phone Number", placeholder: "(555) 555-5555", keyboardType: "phone-pad" },
  { key: "address", label: "Address", placeholder: "123 Main St, Seattle, WA", autoCapitalize: "words", multiline: true },
  { key: "linkedin_url", label: "LinkedIn URL", placeholder: "https://linkedin.com/in/username", keyboardType: "url" },
  { key: "github_url", label: "GitHub URL", placeholder: "https://github.com/username", keyboardType: "url" },
  { key: "portfolio_url", label: "Portfolio URL", placeholder: "https://yourportfolio.com", keyboardType: "url" },
  { key: "resume_file_path", label: "Resume File Path", placeholder: "C:\\Users\\You\\Documents\\resume.pdf" },
  { key: "projects_portfolio_file_path", label: "Projects Portfolio File Path", placeholder: "C:\\Users\\You\\Documents\\projects.pdf" },
  { key: "certifications_folder_path", label: "Certifications Folder Path", placeholder: "C:\\Users\\You\\Documents\\certifications" },
  { key: "ethnicity", label: "Ethnicity", placeholder: "Optional value" },
  { key: "gender", label: "Gender", placeholder: "Optional value" },
  { key: "age", label: "Age", placeholder: "29", keyboardType: "numeric" },
  { key: "years_of_experience", label: "Years of Experience", placeholder: "6", keyboardType: "numeric" },
  { key: "veteran_status", label: "Veteran Status", placeholder: "Optional value" },
  { key: "disability_status", label: "Disability Status", placeholder: "Optional value" },
  { key: "education_level", label: "Education Level", placeholder: "Bachelor's Degree" }
];

function createEmptyPersonalInformation() {
  return PERSONAL_INFORMATION_FIELDS.reduce((accumulator, field) => {
    accumulator[field.key] = "";
    return accumulator;
  }, {});
}

function toFormPersonalInformation(value) {
  const source = value && typeof value === "object" ? value : {};
  const formValue = createEmptyPersonalInformation();

  for (const field of PERSONAL_INFORMATION_FIELDS) {
    if (field.key === "age" || field.key === "years_of_experience") {
      const numericValue = source[field.key];
      formValue[field.key] =
        numericValue === null || numericValue === undefined || Number(numericValue) === 0 ? "" : String(numericValue);
      continue;
    }
    formValue[field.key] = String(source[field.key] ?? "");
  }

  return formValue;
}

function createDefaultMcpSettings() {
  return {
    enabled: false,
    preferred_agent_name: "openjobslots Agent",
    agent_login_email: "",
    agent_login_password: "",
    mfa_login_email: "",
    mfa_login_notes: "",
    dry_run_only: true,
    require_final_approval: true,
    max_applications_per_run: "10",
    preferred_search: "",
    preferred_remote: "all",
    preferred_industries: [],
    preferred_regions: [],
    preferred_countries: [],
    preferred_states: [],
    preferred_counties: [],
    instructions_for_agent: ""
  };
}

function toFormMcpSettings(value) {
  const defaults = createDefaultMcpSettings();
  const source = value && typeof value === "object" ? value : {};
  const agentLoginEmail = String(source.agent_login_email || "");
  return {
    ...defaults,
    enabled: Boolean(source.enabled),
    preferred_agent_name: String(source.preferred_agent_name || defaults.preferred_agent_name),
    agent_login_email: agentLoginEmail,
    agent_login_password: String(source.agent_login_password || ""),
    mfa_login_email: agentLoginEmail,
    mfa_login_notes: String(source.mfa_login_notes || ""),
    dry_run_only: source.dry_run_only === undefined ? defaults.dry_run_only : Boolean(source.dry_run_only),
    require_final_approval:
      source.require_final_approval === undefined
        ? defaults.require_final_approval
        : Boolean(source.require_final_approval),
    max_applications_per_run: String(
      source.max_applications_per_run === undefined || source.max_applications_per_run === null
        ? defaults.max_applications_per_run
        : source.max_applications_per_run
    ),
    preferred_search: String(source.preferred_search || ""),
    preferred_remote: ["remote", "hybrid", "non_remote"].includes(source.preferred_remote)
      ? source.preferred_remote
      : "all",
    preferred_industries: Array.isArray(source.preferred_industries) ? source.preferred_industries.filter(Boolean) : [],
    preferred_regions: Array.isArray(source.preferred_regions) ? source.preferred_regions.filter(Boolean) : [],
    preferred_countries: Array.isArray(source.preferred_countries) ? source.preferred_countries.filter(Boolean) : [],
    preferred_states: Array.isArray(source.preferred_states) ? source.preferred_states.filter(Boolean) : [],
    preferred_counties: Array.isArray(source.preferred_counties) ? source.preferred_counties.filter(Boolean) : [],
    instructions_for_agent: String(source.instructions_for_agent || "")
  };
}

function toApiMcpSettings(value) {
  const source = value && typeof value === "object" ? value : {};
  const parsedMax = Number.parseInt(String(source.max_applications_per_run || "").trim(), 10);
  const maxApplications = Number.isFinite(parsedMax) && parsedMax > 0 ? parsedMax : 10;
  const agentLoginEmail = String(source.agent_login_email || "").trim();
  return {
    enabled: Boolean(source.enabled),
    preferred_agent_name: String(source.preferred_agent_name || "").trim() || "openjobslots Agent",
    agent_login_email: agentLoginEmail,
    agent_login_password: String(source.agent_login_password || ""),
    mfa_login_email: agentLoginEmail,
    mfa_login_notes: String(source.mfa_login_notes || "").trim(),
    dry_run_only: Boolean(source.dry_run_only),
    require_final_approval: Boolean(source.require_final_approval),
    max_applications_per_run: maxApplications,
    preferred_search: String(source.preferred_search || "").trim(),
    preferred_remote: ["remote", "hybrid", "non_remote"].includes(source.preferred_remote)
      ? source.preferred_remote
      : "all",
    preferred_industries: Array.isArray(source.preferred_industries) ? source.preferred_industries.filter(Boolean) : [],
    preferred_regions: Array.isArray(source.preferred_regions) ? source.preferred_regions.filter(Boolean) : [],
    preferred_countries: Array.isArray(source.preferred_countries) ? source.preferred_countries.filter(Boolean) : [],
    preferred_states: Array.isArray(source.preferred_states) ? source.preferred_states.filter(Boolean) : [],
    preferred_counties: Array.isArray(source.preferred_counties) ? source.preferred_counties.filter(Boolean) : [],
    instructions_for_agent: String(source.instructions_for_agent || "").trim()
  };
}

function PostingCard({
  item,
  onTrackApplication,
  onIgnorePosting,
  onBlockCompany,
  onMarkPostingVisited,
  visitedPostingUrls,
  savingApplicationIds,
  ignoringPostingIds,
  blockedCompanyNames,
  blockingCompanyNames,
  showAdminActions = false,
  isDarkTheme = false,
  compact = false,
  languageCode = DEFAULT_PUBLIC_LANGUAGE,
  t = (key, fallback) => fallback || key
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const postingUrl = String(item?.job_posting_url || "").trim();
  const onOpenPosting = useCallback(async () => {
    if (!postingUrl || !isSafeExternalHttpUrl(postingUrl)) return;
    const supported = await Linking.canOpenURL(postingUrl);
    if (supported) {
      onMarkPostingVisited?.(postingUrl);
      trackPublicApplyClick(item);
      await Linking.openURL(postingUrl);
    }
  }, [item, onMarkPostingVisited, postingUrl]);

  const isSaving = Boolean(savingApplicationIds?.[postingUrl]);
  const isIgnoring = Boolean(ignoringPostingIds?.[postingUrl]);
  const normalizedCompanyName = normalizeCompanyName(item?.company_name);
  const isCompanyBlocked = blockedCompanyNames?.has(normalizedCompanyName);
  const isBlockingCompany = blockingCompanyNames?.has(normalizedCompanyName);
  const isApplied = Boolean(item?.applied);
  const saveDisabled = isSaving || isApplied || isIgnoring;
  const ignoreDisabled = isIgnoring;
  const blockDisabled = isCompanyBlocked || isBlockingCompany;
  const isPostingVisited = Boolean(visitedPostingUrls?.has(postingUrl));
  const atsLabel = getAtsDisplayLabel(item?.ats);
  const positionName = sanitizeDisplayText(item?.position_name, "Unknown position");
  const locationLabel = sanitizeDisplayText(item?.location, "Location unavailable");
  const companyLabel = sanitizeDisplayText(item?.company_name, "Unknown company");
  const postingDateLabel = formatPostingDateLabel(
    item?.posting_date,
    languageCode,
    t("posting.dateUnavailable", "Posting date unavailable")
  );
  const appliedByLabel = sanitizeDisplayText(item?.applied_by_label, "Application already tracked");
  const postingUrlLabel = sanitizeDisplayText(formatPostingUrlHostLabel(item?.job_posting_url), "");
  return (
    <View style={[styles.card, compact ? styles.cardMobile : null, isDarkTheme ? styles.cardDark : null]} testID="posting-card" accessibilityRole="article">
      <View style={styles.postingCardTopRow}>
        <Pressable
          onPress={onOpenPosting}
          style={({ pressed }) => [styles.postingCardMainPressArea, pressed ? styles.postingCardMainPressAreaPressed : null]}
          testID="posting-card-open"
          accessibilityRole="link"
          accessibilityLabel={`Open posting: ${positionName} at ${companyLabel}`}
        >
          <Text
            style={[
              styles.position,
              compact ? styles.positionMobile : null,
              isDarkTheme ? styles.positionDark : null,
              isPostingVisited ? styles.positionVisited : null,
              isPostingVisited && isDarkTheme ? styles.positionVisitedDark : null
            ]}
            testID="posting-card-title"
          >
            {companyLabel}
          </Text>
          <Text style={[styles.postingRole, compact ? styles.postingRoleMobile : null, isDarkTheme ? styles.postingRoleDark : null]}>{positionName}</Text>
          <Text style={[styles.location, compact ? styles.locationMobile : null, isDarkTheme ? styles.locationDark : null]}>{locationLabel}</Text>
          <Text style={[styles.ats, compact ? styles.atsMobile : null, isDarkTheme ? styles.atsDark : null]}>{t("posting.atsLabel", "ATS")}: {atsLabel}</Text>
          <Text style={[styles.posted, compact ? styles.postedMobile : null, isDarkTheme ? styles.postedDark : null]}>{postingDateLabel}</Text>
          {isApplied ? (
            <Text style={styles.postingAppliedNotice}>{appliedByLabel}</Text>
          ) : null}
          {postingUrlLabel ? (
            <Text numberOfLines={1} style={[styles.url, compact ? styles.urlMobile : null, isDarkTheme ? styles.urlDark : null]}>
              {postingUrlLabel}
            </Text>
          ) : null}
        </Pressable>

        {showAdminActions ? (
          <View style={styles.postingCardMenuAnchor}>
            <Pressable
              onPress={() => setMenuOpen((prev) => !prev)}
              style={({ pressed }) => [styles.postingCardMenuTrigger, pressed ? styles.buttonPressed : null]}
              testID="posting-card-menu"
              accessibilityRole="button"
              accessibilityLabel="Open posting actions"
            >
              <Text style={styles.postingCardMenuTriggerText}>...</Text>
            </Pressable>

          {menuOpen ? (
            <View style={styles.postingCardMenu}>
              <Pressable
                onPress={() => {
                  setMenuOpen(false);
                  onTrackApplication(item);
                }}
                disabled={saveDisabled}
                style={({ pressed }) => [
                  styles.postingCardMenuItem,
                  saveDisabled ? styles.postingCardMenuItemDisabled : null,
                  pressed ? styles.buttonPressed : null
                ]}
                testID="posting-card-save"
                accessibilityRole="button"
                accessibilityLabel="Save posting to applications"
              >
                <Text style={styles.postingCardMenuItemText}>
                  {isSaving ? "Saving..." : isApplied ? "Already Applied" : "Save To Applications"}
                </Text>
              </Pressable>

              <Pressable
                onPress={() => {
                  setMenuOpen(false);
                  onIgnorePosting(item);
                }}
                disabled={ignoreDisabled}
                style={({ pressed }) => [
                  styles.postingCardMenuItem,
                  ignoreDisabled ? styles.postingCardMenuItemDisabled : null,
                  pressed ? styles.buttonPressed : null
                ]}
                testID="posting-card-ignore"
                accessibilityRole="button"
                accessibilityLabel="Ignore posting"
              >
                <Text style={styles.postingCardMenuItemText}>{isIgnoring ? "Ignoring..." : "Ignore Job Posting"}</Text>
              </Pressable>

              <Pressable
                onPress={() => {
                  setMenuOpen(false);
                  onBlockCompany(item);
                }}
                disabled={blockDisabled}
                style={({ pressed }) => [
                  styles.postingCardMenuItem,
                  styles.postingCardMenuItemDestructive,
                  blockDisabled ? styles.postingCardMenuItemDisabled : null,
                  pressed ? styles.buttonPressed : null
                ]}
                testID="posting-card-block-company"
                accessibilityRole="button"
                accessibilityLabel="Block company"
              >
                <Text style={[styles.postingCardMenuItemText, styles.postingCardMenuItemTextDestructive]}>
                  {isBlockingCompany ? "Blocking company..." : isCompanyBlocked ? "Company Blocked" : "Block Company"}
                </Text>
              </Pressable>
            </View>
          ) : null}
          </View>
        ) : null}
      </View>
    </View>
  );
}

function DrawerItem({ label, selected, onPress }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.drawerItem,
        selected ? styles.drawerItemSelected : null,
        pressed ? styles.buttonPressed : null
      ]}
    >
      <Text style={[styles.drawerItemText, selected ? styles.drawerItemTextSelected : null]}>{label}</Text>
    </Pressable>
  );
}

function HeaderNavButton({ label, selected, onPress }) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={0}
      style={({ pressed }) => [
        styles.headerNavButton,
        selected ? styles.headerNavButtonActive : null,
        pressed ? styles.buttonPressed : null
      ]}
      accessibilityRole="button"
      accessibilityState={{ selected }}
    >
      <Text numberOfLines={1} style={[styles.headerNavButtonText, selected ? styles.headerNavButtonTextActive : null]}>
        {label}
      </Text>
    </Pressable>
  );
}

function MultiSelectDropdown({
  label,
  options,
  selectedValues,
  onToggleValue,
  onClear,
  emptyText,
  helperText,
  anyLabel = "Worldwide",
  maxVisibleOptions = 80,
  t = (key, fallback) => fallback || key
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const selectedArray = Array.isArray(selectedValues) ? selectedValues : [];
  const normalizedOptions = Array.isArray(options) ? options : [];
  const labelByValue = useMemo(
    () => new Map(normalizedOptions.map((option) => [String(option?.value || ""), String(option?.label || option?.value || "")])),
    [normalizedOptions]
  );

  const filteredOptions = useMemo(() => {
    const needle = String(search || "").trim().toLowerCase();
    if (!needle) return normalizedOptions.slice(0, maxVisibleOptions);
    return normalizedOptions
      .filter((option) => String(option?.label || "").toLowerCase().includes(needle))
      .slice(0, maxVisibleOptions);
  }, [maxVisibleOptions, normalizedOptions, search]);

  const selectedCount = selectedArray.length;
  const selectedLabels = selectedArray.map((value) => labelByValue.get(String(value)) || String(value)).filter(Boolean);
  const selectedSummary =
    selectedLabels.length > 0
      ? selectedLabels.length > 2
        ? `${selectedLabels.slice(0, 2).join(", ")} +${selectedLabels.length - 2}`
        : selectedLabels.join(", ")
      : anyLabel;
  const testIdPart = toTestIdPart(label);

  return (
    <View style={styles.dropdownWrap} testID={`${testIdPart}-filter`}>
      <Pressable
        onPress={() => setOpen((prev) => !prev)}
        style={({ pressed }) => [styles.dropdownTrigger, pressed ? styles.buttonPressed : null]}
        testID={`${testIdPart}-filter-trigger`}
        accessibilityRole="button"
        accessibilityLabel={`${label} filter`}
      >
        <Text style={styles.dropdownTriggerLabel}>{label}</Text>
        <Text style={styles.dropdownTriggerValue}>{selectedSummary}</Text>
      </Pressable>

      {open ? (
        <View style={styles.dropdownPanel}>
          {helperText ? <Text style={styles.dropdownHelper}>{helperText}</Text> : null}
          {selectedCount > 0 ? (
            <View style={styles.dropdownSelectedChips}>
              {selectedLabels.slice(0, 5).map((selectedLabel) => (
                <Text key={`${label}-${selectedLabel}`} style={styles.dropdownSelectedChip}>
                  {selectedLabel}
                </Text>
              ))}
              {selectedLabels.length > 5 ? <Text style={styles.dropdownSelectedMore}>+{selectedLabels.length - 5}</Text> : null}
            </View>
          ) : null}
          <TextInput
            style={styles.dropdownSearch}
            value={search}
            onChangeText={setSearch}
            placeholder={translatedPublicText(t, "dropdown.search", "Search {label}", { label: label.toLowerCase() })}
            autoCapitalize="none"
            testID={`${testIdPart}-filter-search`}
            accessibilityLabel={translatedPublicText(t, "dropdown.search", "Search {label}", { label })}
          />

          <ScrollView style={styles.dropdownOptionsScroll}>
            {filteredOptions.length === 0 ? (
              <Text style={styles.dropdownEmpty}>
                {normalizedOptions.length === 0
                  ? emptyText || translatedPublicText(t, "dropdown.empty", "{label} are not indexed yet. Worldwide search is still active.", { label })
                  : translatedPublicText(t, "dropdown.noMatch", "No {label} match \"{search}\".", { label: label.toLowerCase(), search })}
              </Text>
            ) : (
              filteredOptions.map((option) => {
                const value = String(option?.value || "");
                const isSelected = selectedArray.includes(value);
                return (
                  <Pressable
                    key={value}
                    onPress={() => onToggleValue(value)}
                    style={({ pressed }) => [
                      styles.dropdownOption,
                      isSelected ? styles.dropdownOptionSelected : null,
                      pressed ? styles.buttonPressed : null
                    ]}
                    testID={`${testIdPart}-filter-option-${toTestIdPart(value || option?.label)}`}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: isSelected }}
                  >
                    <Text style={[styles.dropdownOptionLabel, isSelected ? styles.dropdownOptionLabelSelected : null]}>
                      {option?.label}
                    </Text>
                  </Pressable>
                );
              })
            )}
          </ScrollView>
          <Text style={styles.dropdownOptionCount}>
            {translatedPublicText(t, "dropdown.showing", "Showing {visible} of {total} {label}.", {
              visible: filteredOptions.length,
              total: normalizedOptions.length,
              label: label.toLowerCase()
            })}
          </Text>

          <Pressable
            onPress={onClear}
            style={({ pressed }) => [styles.dropdownClearBtn, pressed ? styles.buttonPressed : null]}
            testID={`${testIdPart}-filter-clear`}
            accessibilityRole="button"
          >
            <Text style={styles.dropdownClearBtnText}>{translatedPublicText(t, "dropdown.clear", "Clear {label}", { label })}</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

function SingleSelectDropdown({
  label,
  options,
  selectedValue,
  onSelectValue,
  anyLabel = "Any",
  includeAnyOption = true,
  triggerTestID = "",
  optionTestIDPrefix = ""
}) {
  const [open, setOpen] = useState(false);
  const normalizedOptions = Array.isArray(options) ? options : [];
  const selected = String(selectedValue || "all");
  const selectedOption = normalizedOptions.find((option) => String(option?.value || "") === selected);
  const testIdPart = toTestIdPart(label);

  return (
    <View style={styles.dropdownWrap} testID={`${testIdPart}-filter`}>
      <Pressable
        onPress={() => setOpen((prev) => !prev)}
        style={({ pressed }) => [styles.dropdownTrigger, pressed ? styles.buttonPressed : null]}
        testID={triggerTestID || `${testIdPart}-filter-trigger`}
        accessibilityRole="button"
        accessibilityLabel={`${label} filter`}
      >
        <Text style={styles.dropdownTriggerLabel}>{label}</Text>
        <Text style={styles.dropdownTriggerValue}>{selectedOption?.label || anyLabel}</Text>
      </Pressable>

      {open ? (
        <View style={styles.dropdownPanel}>
          <ScrollView style={styles.dropdownOptionsScroll}>
            {includeAnyOption ? (
              <Pressable
                onPress={() => {
                  onSelectValue("all");
                  setOpen(false);
                }}
                style={({ pressed }) => [
                  styles.dropdownOption,
                  selected === "all" ? styles.dropdownOptionSelected : null,
                  pressed ? styles.buttonPressed : null
                ]}
                testID={`${testIdPart}-filter-option-all`}
                accessibilityRole="radio"
                accessibilityState={{ checked: selected === "all" }}
              >
                <Text style={[styles.dropdownOptionLabel, selected === "all" ? styles.dropdownOptionLabelSelected : null]}>
                  {anyLabel}
                </Text>
              </Pressable>
            ) : null}

            {normalizedOptions.map((option) => {
              const value = String(option?.value || "");
              const isSelected = selected === value;
              const isEnabled = option?.enabled !== false;
              return (
                <Pressable
                  key={value}
                  onPress={() => {
                    if (!isEnabled) return;
                    onSelectValue(value || "all");
                    setOpen(false);
                  }}
                  style={({ pressed }) => [
                    styles.dropdownOption,
                    isSelected ? styles.dropdownOptionSelected : null,
                    !isEnabled ? styles.dropdownOptionDisabled : null,
                    pressed && isEnabled ? styles.buttonPressed : null
                  ]}
                  testID={optionTestIDPrefix
                    ? `${optionTestIDPrefix}-${toTestIdPart(value || option?.label)}`
                    : `${testIdPart}-filter-option-${toTestIdPart(value || option?.label)}`}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: isSelected, disabled: !isEnabled }}
                >
                  <Text
                    style={[
                      styles.dropdownOptionLabel,
                      isSelected ? styles.dropdownOptionLabelSelected : null,
                      !isEnabled ? styles.dropdownOptionLabelDisabled : null
                    ]}
                  >
                    {option?.label}
                    {!isEnabled ? " (Sync off)" : ""}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
}

function CountryBall({ language, selected = false, size = 30 }) {
  const flag = language?.flag || PUBLIC_LANGUAGE_OPTIONS[0].flag;
  const stripes = Array.isArray(flag.stripes) && flag.stripes.length > 0 ? flag.stripes : ["#ffffff"];
  const stripeDirectionStyle = flag.type === "vertical" ? styles.countryBallFlagVertical : styles.countryBallFlagHorizontal;
  return (
    <View
      style={[
        styles.countryBall,
        selected ? styles.countryBallSelected : null,
        {
          width: size,
          height: size,
          borderRadius: size / 2
        }
      ]}
      testID={`language-countryball-${language?.code || "en"}`}
    >
      <View style={[styles.countryBallFlagClip, stripeDirectionStyle]}>
        {stripes.map((color, index) => (
          <View
            // eslint-disable-next-line react/no-array-index-key
            key={`${language?.code || "flag"}-${color}-${index}`}
            style={[styles.countryBallStripe, { backgroundColor: color }]}
          />
        ))}
        {flag.type === "us" ? <View style={styles.countryBallUsCanton} /> : null}
        {flag.type === "tr" ? (
          <View style={styles.countryBallCrescentWrap}>
            <View style={styles.countryBallCrescentBase} />
            <View style={styles.countryBallCrescentCut} />
          </View>
        ) : null}
      </View>
      <View pointerEvents="none" style={styles.countryBallEyes}>
        <View style={styles.countryBallEye} />
        <View style={styles.countryBallEye} />
      </View>
    </View>
  );
}

function LanguageSelector({ languageCode, menuOpen, onToggleMenu, onSelectLanguage, t, compact = false }) {
  const selectedLanguage = PUBLIC_LANGUAGE_BY_CODE.get(languageCode) || PUBLIC_LANGUAGE_BY_CODE.get(DEFAULT_PUBLIC_LANGUAGE);
  const isRtlLanguage = getPublicDocumentDirection(languageCode) === "rtl";
  return (
    <View style={[styles.languageSelectorWrap, compact ? styles.languageSelectorWrapCompact : null]}>
      <Pressable
        onPress={onToggleMenu}
        style={({ pressed }) => [
          styles.languageSelectorButton,
          compact ? styles.languageSelectorButtonCompact : null,
          menuOpen ? styles.languageSelectorButtonOpen : null,
          pressed ? styles.languageSelectorButtonPressed : null
        ]}
        testID="language-selector"
        accessibilityRole="button"
        accessibilityLabel={t("language.label", "Language")}
        accessibilityState={{ expanded: menuOpen }}
      >
        <CountryBall language={selectedLanguage} selected size={compact ? 22 : 30} />
        <Text style={[styles.languageSelectorCode, compact ? styles.languageSelectorCodeCompact : null]}>{selectedLanguage.shortLabel}</Text>
      </Pressable>
      {menuOpen ? (
        <View
          style={[
            styles.languageOptions,
            isRtlLanguage ? styles.languageOptionsRtl : null,
            compact ? styles.languageOptionsCompact : null
          ]}
          testID="language-options"
        >
          <ScrollView
            style={styles.languageOptionsScroll}
            contentContainerStyle={styles.languageOptionsContent}
            keyboardShouldPersistTaps="handled"
            nestedScrollEnabled
            showsVerticalScrollIndicator={false}
          >
            {PUBLIC_LANGUAGE_OPTIONS.map((language) => {
              const selected = language.code === selectedLanguage.code;
              return (
                <Pressable
                  key={language.code}
                  onPress={() => onSelectLanguage(language.code)}
                  style={({ pressed }) => [
                    styles.languageOption,
                    selected ? styles.languageOptionSelected : null,
                    pressed ? styles.languageOptionPressed : null
                  ]}
                  testID={`language-option-${language.code}`}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  accessibilityLabel={`${language.label} language`}
                >
                  <CountryBall language={language} selected={selected} size={26} />
                  <View style={styles.languageOptionCopy}>
                    <Text style={styles.languageOptionLabel}>{language.nativeLabel}</Text>
                    <Text style={styles.languageOptionMeta}>{language.shortLabel}</Text>
                  </View>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
}

function ThemeToggle({ themeMode, onToggleTheme, t, compact = false }) {
  const isDark = themeMode === "dark";
  return (
    <Pressable
      onPress={onToggleTheme}
      style={({ pressed }) => [
        styles.themeToggle,
        compact ? styles.themeToggleCompact : null,
        isDark ? styles.themeToggleDark : null,
        pressed ? styles.themeTogglePressed : null
      ]}
      testID="theme-toggle"
      accessibilityRole="button"
      accessibilityLabel={isDark ? t("theme.night", "Night") : t("theme.day", "Day")}
    >
      <View style={[styles.themeIconButton, compact ? styles.themeIconButtonCompact : null, isDark ? styles.themeIconButtonDark : null]}>
        <View style={[styles.themeIconCore, compact ? styles.themeIconCoreCompact : null, isDark ? styles.themeIconCoreDark : null]}>
          {isDark ? <View style={[styles.themeIconMoonCutout, compact ? styles.themeIconMoonCutoutCompact : null]} /> : null}
        </View>
      </View>
      <Text style={[styles.themeToggleText, compact ? styles.themeToggleTextCompact : null, isDark ? styles.themeToggleTextDark : null]}>
        {isDark ? t("theme.night", "Night") : t("theme.day", "Day")}
      </Text>
    </Pressable>
  );
}

function SearchGlyph({ isDark = false, compact = false }) {
  return (
    <View style={[styles.searchGlyph, compact ? styles.searchGlyphCompact : null]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View style={[styles.searchGlyphCircle, isDark ? styles.searchGlyphCircleDark : null]} />
      <View style={[styles.searchGlyphHandle, isDark ? styles.searchGlyphHandleDark : null]} />
    </View>
  );
}

function ClearGlyph({ isDark = false }) {
  return (
    <View style={styles.clearGlyph} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View style={[styles.clearGlyphBar, isDark ? styles.clearGlyphBarDark : null, styles.clearGlyphBarForward]} />
      <View style={[styles.clearGlyphBar, isDark ? styles.clearGlyphBarDark : null, styles.clearGlyphBarBackward]} />
    </View>
  );
}

function SourceIntelligencePanel({
  sources,
  showResultsSurface,
  selectedSource,
  onSelectSource,
  t = (key, fallback) => fallback || key,
  isDarkTheme = false
}) {
  const visibleSources = Array.isArray(sources) ? sources : [];
  return (
    <View style={[styles.atsIntelligencePanel, isDarkTheme ? styles.atsIntelligencePanelDark : null]} testID="ats-intelligence-panel">
      <Text style={[styles.atsIntelligenceTitle, isDarkTheme ? styles.textInkDark : null]}>{t("sources.title", "Sources in results")}</Text>
      {showResultsSurface && visibleSources.length > 0 ? (
        visibleSources.map((source) => {
          const sourceValue = source.value || source.key || "unknown";
          const testIdPart = toTestIdPart(sourceValue || source.label);
          const selected = selectedSource === sourceValue;
          return (
            <Pressable
              key={`${sourceValue}-${source.label}`}
              onPress={() => onSelectSource?.(source)}
              style={({ pressed }) => [
                styles.atsIntelligenceRow,
                selected ? styles.atsIntelligenceRowActive : null,
                pressed ? styles.buttonPressed : null
              ]}
              testID={`source-intelligence-row-${testIdPart}`}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              accessibilityLabel={`Filter results by ${source.label}`}
            >
              <View style={styles.atsIntelligenceSourceBlock}>
                <Text style={styles.atsIntelligenceSource}>{source.label}</Text>
                <Text style={styles.atsIntelligenceMeta} testID={`source-intelligence-count-${testIdPart}`}>
                  {formatCompactNumberLabel(source.count)} {source.count === 1 ? t("sources.result", "result") : t("sources.results", "results")}
                </Text>
                <Text style={styles.atsIntelligenceQuality} testID={`source-intelligence-quality-${testIdPart}`}>
                  {formatSourceQualitySummary(source, t)}
                </Text>
              </View>
              <Text style={styles.atsIntelligenceFreshness} testID={`source-intelligence-freshness-${testIdPart}`}>
                {formatSourceFreshnessSummary(source, t)}
              </Text>
            </Pressable>
          );
        })
      ) : (
        <Text style={[styles.atsIntelligenceEmpty, isDarkTheme ? styles.textMutedDark : null]}>
          {t("sources.empty", "Run a search to see sources in the current result set.")}
        </Text>
      )}
    </View>
  );
}

function SortSegmentedControl({ options, selectedValue, onSelectValue }) {
  const normalizedOptions = (Array.isArray(options) && options.length > 0 ? options : DEFAULT_POSTING_SORT_OPTIONS)
    .map((option) => ({
      value: String(option?.value || "").trim() || "relevance",
      label: sanitizeDisplayText(option?.label || option?.value || "Relevance", "Relevance")
    }))
    .filter((option) => option.value)
    .slice(0, 5);
  const safeOptions = normalizedOptions.length > 0 ? normalizedOptions : DEFAULT_POSTING_SORT_OPTIONS;
  const selected = String(selectedValue || "relevance");

  return (
    <View
      style={styles.sortSegmentedControl}
      testID="sort-control"
      accessibilityRole="radiogroup"
      accessibilityLabel="Sort results"
    >
      {safeOptions.map((option) => {
        const isSelected = option.value === selected;
        return (
          <Pressable
            key={option.value}
            onPress={() => onSelectValue?.(option.value)}
            style={({ pressed }) => [
              styles.sortSegmentOption,
              isSelected ? styles.sortSegmentOptionActive : null,
              pressed ? styles.sortSegmentOptionPressed : null
            ]}
            testID={`sort-option-${toTestIdPart(option.value)}`}
            accessibilityRole="radio"
            accessibilityState={{ checked: isSelected }}
            accessibilityLabel={`Sort by ${option.label}`}
          >
            <Text
              numberOfLines={1}
              style={[styles.sortSegmentOptionText, isSelected ? styles.sortSegmentOptionTextActive : null]}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function ToggleRow({ label, value, onValueChange }) {
  return (
    <View style={styles.toggleRow}>
      <Text style={styles.toggleLabel}>{label}</Text>
      <Switch value={Boolean(value)} onValueChange={onValueChange} />
    </View>
  );
}

export default function App() {
  const { width: viewportWidth, height: viewportHeight } = useWindowDimensions();
  const isDesktopViewport = Platform.OS === "web" && Number(viewportWidth || 0) >= 768;
  const isPublicNativeStoreSurface = isNativeStorePlatform(Platform.OS);
  const initialPublicSearchQuery = useMemo(readInitialPublicSearchQuery, []);
  const [activePage, setActivePage] = useState(PAGE_KEYS.POSTINGS);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [publicLanguageCode, setPublicLanguageCode] = useState(getInitialPublicLanguageCode);
  const [languageMenuOpen, setLanguageMenuOpen] = useState(false);
  const [publicTheme, setPublicTheme] = useState(getInitialPublicTheme);
  const [search, setSearch] = useState(initialPublicSearchQuery);
  const [searchFocused, setSearchFocused] = useState(false);
  const [searchExampleTypeState, setSearchExampleTypeState] = useState({
    index: 0,
    length: 2,
    deleting: false
  });
  const [releaseNotesOpen, setReleaseNotesOpen] = useState(false);
  const [postingsFilters, setPostingsFilters] = useState(createDefaultPostingsFilters);
  const [postingFilterOptions, setPostingFilterOptions] = useState({
    ats: DEFAULT_ATS_FILTER_OPTIONS,
    industries: [],
    regions: [],
    countries: [],
    states: [],
    counties: [],
    sort_options: DEFAULT_POSTING_SORT_OPTIONS
  });
  const [postingFilterOptionsLoading, setPostingFilterOptionsLoading] = useState(false);
  const [postingsFilterPanelOpen, setPostingsFilterPanelOpen] = useState(false);
  const [postings, setPostings] = useState([]);
  const [sourceFacets, setSourceFacets] = useState([]);
  const [postingsTotalCount, setPostingsTotalCount] = useState(0);
  const [postingsResultCoverage, setPostingsResultCoverage] = useState(null);
  const [postingsResultQuery, setPostingsResultQuery] = useState("");
  const [postingsResultFiltersSignature, setPostingsResultFiltersSignature] = useState(
    getPostingsFiltersSignature(createDefaultPostingsFilters())
  );
  const [postingsHasMore, setPostingsHasMore] = useState(false);
  const [postingsNextOffset, setPostingsNextOffset] = useState(0);
  const [postingsLoadingMore, setPostingsLoadingMore] = useState(false);
  const [visitedPostingUrls, setVisitedPostingUrls] = useState(readVisitedPostingUrls);
  const [showScrollTopButton, setShowScrollTopButton] = useState(false);
  const [applications, setApplications] = useState([]);
  const [applicationsLoading, setApplicationsLoading] = useState(false);
  const [applicationsNotice, setApplicationsNotice] = useState("");
  const [savingApplicationIds, setSavingApplicationIds] = useState({});
  const [ignoringPostingIds, setIgnoringPostingIds] = useState({});
  const [blockingCompanyNames, setBlockingCompanyNames] = useState({});
  const [blockedCompanies, setBlockedCompanies] = useState([]);
  const [blockedCompaniesLoading, setBlockedCompaniesLoading] = useState(false);
  const [unblockingCompanyNames, setUnblockingCompanyNames] = useState({});
  const [updatingApplicationIds, setUpdatingApplicationIds] = useState({});
  const [deletingApplicationIds, setDeletingApplicationIds] = useState({});
  const [openApplicationStatusForId, setOpenApplicationStatusForId] = useState(null);
  const [initializing, setInitializing] = useState(true);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncActionState, setSyncActionState] = useState("idle");
  const [syncNotice, setSyncNotice] = useState("");
  const [error, setError] = useState("");
  const [searchNotice, setSearchNotice] = useState("");
  const [searchSuggestions, setSearchSuggestions] = useState([]);
  const [searchSuggestionsOpen, setSearchSuggestionsOpen] = useState(false);
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(-1);
  const [popularSearchItems, setPopularSearchItems] = useState([]);
  const [searchResultsMode, setSearchResultsMode] = useState(Boolean(initialPublicSearchQuery));
  const [hideNativeSearchCaret, setHideNativeSearchCaret] = useState(false);
  const [coverageDetailsOpen, setCoverageDetailsOpen] = useState(false);
  const [status, setStatus] = useState(null);
  const [statusError, setStatusError] = useState("");
  const [personalInformation, setPersonalInformation] = useState(createEmptyPersonalInformation);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsNotice, setSettingsNotice] = useState("");
  const [syncSettings, setSyncSettings] = useState({
    autoSyncEnabled: true,
    wifiOnly: false,
    syncIntervalSeconds: String(DEFAULT_SYNC_INTERVAL_SECONDS)
  });
  const [syncServiceSettings, setSyncServiceSettings] = useState(createDefaultSyncServiceSettings);
  const [syncServiceSettingsLoading, setSyncServiceSettingsLoading] = useState(false);
  const [syncServiceSettingsSaving, setSyncServiceSettingsSaving] = useState(false);
  const [syncSettingsNotice, setSyncSettingsNotice] = useState("");
  const [migrationSourceDbPath, setMigrationSourceDbPath] = useState("");
  const [migrationSelection, setMigrationSelection] = useState({
    personal_information: true,
    mcp_settings: true,
    blocked_companies: true,
    applications: true
  });
  const [migrationRunning, setMigrationRunning] = useState(false);
  const [migrationNotice, setMigrationNotice] = useState("");
  const [migrationModalOpen, setMigrationModalOpen] = useState(false);
  const [mcpSettings, setMcpSettings] = useState(createDefaultMcpSettings);
  const [mcpSettingsLoading, setMcpSettingsLoading] = useState(false);
  const [mcpSettingsSaving, setMcpSettingsSaving] = useState(false);
  const [mcpSettingsNotice, setMcpSettingsNotice] = useState("");
  const searchInputRef = useRef(null);
  const suppressNativeSearchFocusRef = useRef(false);
  const postingsListRef = useRef(null);
  const searchRef = useRef(initialPublicSearchQuery);
  const lastSearchSubmitRef = useRef({
    value: initialPublicSearchQuery,
    filtersSignature: getPostingsFiltersSignature(createDefaultPostingsFilters()),
    at: Date.now()
  });
  const suppressedSuggestionQueryRef = useRef(initialPublicSearchQuery);
  const postingsFiltersRef = useRef(postingsFilters);
  const autoSyncInFlightRef = useRef(false);
  const statusPollInFlightRef = useRef(false);
  const postingsRefreshInFlightRef = useRef(false);
  const didRunInitialPostingsBootstrapRef = useRef(false);
  const lastPostingRefreshAtRef = useRef(0);
  const wasSyncRunningRef = useRef(false);
  const postingsRequestSequenceRef = useRef(0);
  const postingsRef = useRef([]);
  const postingFilterOptionsRef = useRef(postingFilterOptions);
  const postingsHasMoreRef = useRef(false);
  const postingsNextOffsetRef = useRef(0);
  const postingsLoadingMoreRef = useRef(false);
  const showScrollTopButtonRef = useRef(false);
  const applicationsRequestSequenceRef = useRef(0);
  const frontendLogQueueRef = useRef([]);
  const frontendLogFlushInFlightRef = useRef(false);
  const lastFrontendLogFlushAtRef = useRef(0);
  const syncNoticeTimerRef = useRef(null);
  const autoSearchTimerRef = useRef(null);
  const searchSuggestionTimerRef = useRef(null);
  const lastSearchInputAtRef = useRef(0);
  const searchSuggestionCacheRef = useRef(new Map());
  const recentSearchesRef = useRef([]);
  const prefersReducedMotionRef = useRef(false);
  const searchMotionRef = useRef(new Animated.Value(0));
  const suggestionsMotionRef = useRef(new Animated.Value(0));
  const resultsMotionRef = useRef(new Animated.Value(0));

  const pageTitle = PAGE_TITLES[activePage] || PAGE_TITLES[PAGE_KEYS.POSTINGS];
  const isDarkPublicTheme = publicTheme === "dark";
  const publicWordmarkSegments = isDarkPublicTheme ? YAHOO_WORDMARK_SEGMENTS_DARK : YAHOO_WORDMARK_SEGMENTS;
  const t = useCallback(
    (key, fallback = "") => translatePublicText(publicLanguageCode, key, fallback),
    [publicLanguageCode]
  );
  const publicLanguageCountryCode =
    PUBLIC_LANGUAGE_BY_CODE.get(publicLanguageCode)?.countryCode || PUBLIC_LANGUAGE_OPTIONS[0].countryCode;
  const currentSearchExample =
    SEARCH_PLACEHOLDER_EXAMPLES[searchExampleTypeState.index % SEARCH_PLACEHOLDER_EXAMPLES.length] ||
    SEARCH_PLACEHOLDER_EXAMPLES[0] ||
    "";
  const animatedSearchPlaceholderEnabled = Platform.OS === "web";
  const defaultSearchPlaceholder = t("search.placeholder", "Search title, company, location, or country");
  const compactSearchPlaceholder = t("search.placeholderShort", "Search jobs or companies");
  const exampleSearchPlaceholder = animatedSearchPlaceholderEnabled
    ? currentSearchExample.slice(
        0,
        Math.max(1, Math.min(currentSearchExample.length, searchExampleTypeState.length))
      )
    : compactSearchPlaceholder;
  const flushFrontendLogs = useCallback(async () => {
    if (isPublicNativeStoreSurface) return;
    if (frontendLogFlushInFlightRef.current) return;
    if (frontendLogQueueRef.current.length === 0) return;

    frontendLogFlushInFlightRef.current = true;
    try {
      while (frontendLogQueueRef.current.length > 0) {
        const nextEntry = frontendLogQueueRef.current[0];
        const response = await postFrontendLog(nextEntry);
        if (!response?.ok) {
          break;
        }
        frontendLogQueueRef.current.shift();
      }
    } finally {
      frontendLogFlushInFlightRef.current = false;
    }
  }, [isPublicNativeStoreSurface]);

  const queueFrontendLog = useCallback(
    (level, eventName, message, context = {}) => {
      const entry = {
        level: sanitizeDisplayText(level, "info").toLowerCase(),
        event: sanitizeDisplayText(eventName, "frontend_event"),
        message: sanitizeDisplayText(message, ""),
        context
      };

      frontendLogQueueRef.current.push(entry);
      if (frontendLogQueueRef.current.length > 60) {
        frontendLogQueueRef.current.shift();
      }

      const now = Date.now();
      const shouldFlushImmediately =
        entry.level === "error" ||
        entry.level === "fatal" ||
        frontendLogQueueRef.current.length <= 1 ||
        now - lastFrontendLogFlushAtRef.current >= 1500;

      if (shouldFlushImmediately) {
        lastFrontendLogFlushAtRef.current = now;
        void flushFrontendLogs();
      }
    },
    [flushFrontendLogs]
  );
  const handleOpenDeveloperCredit = useCallback(async () => {
    try {
      if (!isSafeExternalHttpUrl(BATUHAN_WEBSITE_URL)) return;
      const supported = await Linking.canOpenURL(BATUHAN_WEBSITE_URL);
      if (supported) {
        await Linking.openURL(BATUHAN_WEBSITE_URL);
      }
    } catch {
      // Non-critical attribution link; ignore platform/browser launch failures.
    }
  }, []);
  const closeSearchWorkForUtilityMenu = useCallback(() => {
    if (autoSearchTimerRef.current) {
      clearTimeout(autoSearchTimerRef.current);
      autoSearchTimerRef.current = null;
    }
    if (searchSuggestionTimerRef.current) {
      clearTimeout(searchSuggestionTimerRef.current);
      searchSuggestionTimerRef.current = null;
    }
    suppressedSuggestionQueryRef.current = String(searchRef.current || "").trim();
    setLanguageMenuOpen(false);
    setSearchSuggestionsOpen(false);
    setActiveSuggestionIndex(-1);
  }, []);
  const togglePublicLanguageMenu = useCallback(() => {
    if (!languageMenuOpen) {
      closeSearchWorkForUtilityMenu();
    }
    setLanguageMenuOpen((previousOpen) => !previousOpen);
  }, [closeSearchWorkForUtilityMenu, languageMenuOpen]);
  const selectPublicLanguage = useCallback((languageCode) => {
    const nextLanguage = normalizePublicLanguageCode(languageCode) || DEFAULT_PUBLIC_LANGUAGE;
    closeSearchWorkForUtilityMenu();
    setPublicLanguageCode(nextLanguage);
    setLanguageMenuOpen(false);
    writeWebStorageValue(PUBLIC_LANGUAGE_STORAGE_KEY, nextLanguage);
  }, [closeSearchWorkForUtilityMenu]);
  const togglePublicTheme = useCallback(() => {
    closeSearchWorkForUtilityMenu();
    setPublicTheme((previousTheme) => {
      const nextTheme = previousTheme === "dark" ? "light" : "dark";
      writeWebStorageValue(PUBLIC_THEME_STORAGE_KEY, nextTheme);
      return nextTheme;
    });
  }, [closeSearchWorkForUtilityMenu]);
  const openPublicReleaseNotes = useCallback(() => {
    closeSearchWorkForUtilityMenu();
    setReleaseNotesOpen(true);
  }, [closeSearchWorkForUtilityMenu]);
  useEffect(() => {
    if (Platform.OS !== "web" || typeof document === "undefined") return undefined;
    const root = document.documentElement;
    if (!root) return undefined;
    const previousDirection = root.getAttribute("dir");
    const previousLanguage = root.getAttribute("lang");
    const documentLanguage = normalizePublicLanguageCode(publicLanguageCode) || DEFAULT_PUBLIC_LANGUAGE;

    root.setAttribute("dir", getPublicDocumentDirection(documentLanguage));
    root.setAttribute("lang", documentLanguage);

    return () => {
      if (previousDirection === null) {
        root.removeAttribute("dir");
      } else {
        root.setAttribute("dir", previousDirection);
      }
      if (previousLanguage === null) {
        root.removeAttribute("lang");
      } else {
        root.setAttribute("lang", previousLanguage);
      }
    };
  }, [publicLanguageCode]);
  useEffect(() => {
    if (Platform.OS !== "web" || typeof document === "undefined") return undefined;
    const backgroundColor = activePage === PAGE_KEYS.POSTINGS && isDarkPublicTheme
      ? OJS_DARK_COLORS.bg
      : OJS_COLORS.bg;
    const previousBodyBackground = document.body?.style?.backgroundColor || "";
    const previousDocumentBackground = document.documentElement?.style?.backgroundColor || "";

    if (document.body?.style) {
      document.body.style.backgroundColor = backgroundColor;
    }
    if (document.documentElement?.style) {
      document.documentElement.style.backgroundColor = backgroundColor;
    }

    return () => {
      if (document.body?.style) {
        document.body.style.backgroundColor = previousBodyBackground;
      }
      if (document.documentElement?.style) {
        document.documentElement.style.backgroundColor = previousDocumentBackground;
      }
    };
  }, [activePage, isDarkPublicTheme]);
  const remoteFilterOptions = useMemo(
    () => [
      { value: "all", label: t("remote.all", "All Locations"), shortLabel: t("remote.allShort", "Any") },
      { value: "remote", label: t("remote.remote", "Remote Only"), shortLabel: t("remote.remoteShort", "Remote") },
      { value: "hybrid", label: t("remote.hybrid", "Hybrid Only"), shortLabel: t("remote.hybridShort", "Hybrid") },
      { value: "non_remote", label: t("remote.nonRemote", "On-Site / Unknown"), shortLabel: t("remote.nonRemoteShort", "On-site") }
    ],
    [t]
  );
  const countryRegionByValue = useMemo(
    () =>
      new Map(
        (postingFilterOptions.countries || []).map((country) => [
          String(country?.value || ""),
          String(country?.region || "")
        ])
      ),
    [postingFilterOptions.countries]
  );
  const normalizedRegionOptions = useMemo(() => {
    const byKey = new Map();
    WORLDWIDE_REGION_OPTIONS.forEach((option) => {
      byKey.set(normalizeRegionName(option.value), option);
    });
    (postingFilterOptions.regions || []).forEach((option) => {
      const value = String(option?.value || option?.label || "").trim();
      const label = String(option?.label || option?.value || "").trim();
      if (!value || !label) return;
      byKey.set(normalizeRegionName(value), { ...option, value, label });
    });
    (postingFilterOptions.countries || []).forEach((country) => {
      const region = String(country?.region || "").trim();
      if (!region) return;
      const key = normalizeRegionName(region);
      if (!byKey.has(key)) {
        byKey.set(key, { value: region, label: region });
      }
    });
    return Array.from(byKey.values());
  }, [postingFilterOptions.countries, postingFilterOptions.regions]);
  const visibleCountryOptions = useMemo(() => {
    const selectedRegions = postingsFilters.regions || [];
    if (selectedRegions.length === 0) return postingFilterOptions.countries || [];
    return (postingFilterOptions.countries || []).filter((country) =>
      regionMatchesSelection(country?.region, selectedRegions)
    );
  }, [postingFilterOptions.countries, postingsFilters.regions]);
  const visibleCountyOptions = useMemo(() => {
    const selectedStates = postingsFilters.states || [];
    if (selectedStates.length === 0) return postingFilterOptions.counties || [];
    return (postingFilterOptions.counties || []).filter((county) => selectedStates.includes(county?.state));
  }, [postingFilterOptions.counties, postingsFilters.states]);
  const visibleMcpCountryOptions = useMemo(() => {
    const selectedRegions = mcpSettings.preferred_regions || [];
    if (selectedRegions.length === 0) return postingFilterOptions.countries || [];
    return (postingFilterOptions.countries || []).filter((country) =>
      regionMatchesSelection(country?.region, selectedRegions)
    );
  }, [mcpSettings.preferred_regions, postingFilterOptions.countries]);
  const visibleMcpCountyOptions = useMemo(() => {
    const selectedStates = mcpSettings.preferred_states || [];
    if (selectedStates.length === 0) return postingFilterOptions.counties || [];
    return (postingFilterOptions.counties || []).filter((county) => selectedStates.includes(county?.state));
  }, [mcpSettings.preferred_states, postingFilterOptions.counties]);
  const blockedCompanyNames = useMemo(
    () =>
      new Set(
        (blockedCompanies || [])
          .map((item) => normalizeCompanyName(item?.company_name || item?.normalized_company_name))
          .filter(Boolean)
      ),
    [blockedCompanies]
  );
  const blockingCompanyNamesSet = useMemo(
    () =>
      new Set(
        Object.entries(blockingCompanyNames || {})
          .filter(([, loading]) => Boolean(loading))
          .map(([companyName]) => companyName)
      ),
    [blockingCompanyNames]
  );
  const syncAtsOptions = useMemo(() => {
    const labelByValue = new Map((postingFilterOptions.ats || []).map((option) => [String(option?.value || ""), String(option?.label || "")]));
    return DEFAULT_ATS_FILTER_OPTIONS.map((option) => ({
      value: option.value,
      label: labelByValue.get(option.value) || option.label
    }));
  }, [postingFilterOptions.ats]);

  const syncStatusDetails = useMemo(() => {
    if (statusError) {
      return {
        summary: "Index coverage is temporarily unavailable.",
        workerState: "Worker status unavailable",
        latestRunText: "Retrying status in the background",
        activeAts: [],
        metrics: [
          { label: "Job slots", value: "0" },
          { label: "ATS", value: "0" },
          { label: "Companies", value: "0" },
          { label: "Seen in 24h", value: "0" },
          { label: "Queue due", value: "0" },
          { label: "Failures", value: "0" },
          { label: "Parser errors", value: "0" }
        ],
        healthNote: "Coverage diagnostics are temporarily unavailable. Search remains usable.",
        lastError: ""
      };
    }
    if (!status) {
      return {
        summary: "Loading sync coverage.",
        workerState: "Worker pending",
        latestRunText: "No run recorded",
        activeAts: [],
        metrics: [],
        healthNote: "",
        lastError: ""
      };
    }
    const syncTime = status.last_sync_at
      ? formatDateTimeSafe(status.last_sync_at, "Unknown sync time")
      : "No sync has run yet";
    const summary = status.last_sync_summary || {};
    const failedCompanies = Number(status.failed_companies ?? summary.failed_companies ?? 0);
    const worker = status.ingestion_worker || {};
    const workerStatus = sanitizeDisplayText(worker.latest_status, worker.latest_run_id ? "unknown" : "not started");
    const activeAts = Array.isArray(worker.active_ats) ? worker.active_ats.filter(Boolean) : [];
    const latestRunText = worker.latest_run_id
      ? `Run ${worker.latest_run_id} started ${formatEpochSeconds(worker.started_at_epoch)}`
      : "No worker run recorded yet";
    const workerState = workerStatus === "running" ? "Worker running" : `Worker ${workerStatus}`;
    const failureCount = Number(worker.failure_count || 0) + failedCompanies;
    const parserErrorCount = Number(worker.parser_error_count_24h || 0);
    const metrics = [
      ...buildPublicStatsChips(status).map((chip) => ({
        label: chip.label === "ATS" ? "ATS" : chip.label.replace(/\b\w/g, (char) => char.toUpperCase()),
        value: chip.value
      })),
      { label: "Seen in 24h", value: formatExactNumberLabel(status.postings_seen_24h_count || 0) },
      { label: "Queue due", value: formatCompactNumberLabel(worker.queue_due_count || 0) },
      { label: "Failures", value: formatCompactNumberLabel(failureCount) },
      { label: "Parser errors", value: formatCompactNumberLabel(parserErrorCount) }
    ];
    const healthNote =
      failureCount > 0 || parserErrorCount > 0
        ? "A few sources need parser review. Results stay searchable while diagnostics are logged."
        : "";
    const base = `${workerState}. Last sync: ${syncTime}. ${latestRunText}.`;
    if (status.running && status.progress) {
      const collectedCount = Number(status.progress.total_collected || 0);
      const storedCount = Number(status.posting_count || 0);
      const syncingCompanyName = sanitizeDisplayText(status.progress.company_name, "");
      const liveSyncHint =
        collectedCount > 0 && storedCount === 0
          ? " Sync is collecting postings; visible results appear as batches are saved."
          : "";
      return {
        summary: `${base} Syncing ${status.progress.current}/${status.progress.total}: ${syncingCompanyName} (collected ${collectedCount}).${liveSyncHint}`,
        workerState,
        latestRunText,
        activeAts,
        metrics,
        healthNote,
        lastError: sanitizeDisplayText(worker.last_error, "")
      };
    }
    return {
      summary: base,
      workerState,
      latestRunText,
      activeAts,
      metrics,
      healthNote,
      lastError: sanitizeDisplayText(worker.last_error, "")
    };
  }, [status, statusError]);

  const hasActivePostingFilters = useMemo(() => {
    return (
      postingsFilters.ats !== "all" ||
      (postingsFilters.industries || []).length > 0 ||
      (postingsFilters.regions || []).length > 0 ||
      (postingsFilters.countries || []).length > 0 ||
      (postingsFilters.states || []).length > 0 ||
      (postingsFilters.counties || []).length > 0 ||
      postingsFilters.remote !== "all" ||
      Boolean(postingsFilters.hide_no_date) ||
      String(postingsFilters.freshness_days || "all") !== "all"
    );
  }, [postingsFilters]);
  const hasLocationPostingFilters = useMemo(() => {
    return (
      (postingsFilters.regions || []).length > 0 ||
      (postingsFilters.countries || []).length > 0 ||
      (postingsFilters.states || []).length > 0 ||
      (postingsFilters.counties || []).length > 0
    );
  }, [postingsFilters]);
  const hasRemotePostingFilter = postingsFilters.remote !== "all";
  const visibleSourceSummary = useMemo(() => {
    if (sourceFacets.length > 0) return sourceFacets;
    return buildSourceFacetsFromPostings(postings);
  }, [postings, sourceFacets]);

  const searchQueryText = String(search || "").trim();
  const showResultsSurface = searchResultsMode || hasActivePostingFilters;
  const searchUiMode = showResultsSurface ? "results" : searchQueryText ? "suggest" : "home";
  const searchShellCompact = searchUiMode === "results";
  const mobileHomeSearchShellLayout = useMemo(() => {
    if (Platform.OS === "web" || isDesktopViewport || showResultsSurface) return null;
    const height = Number(viewportHeight || 0);
    if (!Number.isFinite(height) || height <= 0) return null;
    const topReserve = ANDROID_STATUS_BAR_OFFSET + 76;
    const bottomReserve = isPublicNativeStoreSurface ? 156 : 112;
    return { minHeight: Math.max(500, height - topReserve - bottomReserve) };
  }, [isDesktopViewport, isPublicNativeStoreSurface, showResultsSurface, viewportHeight]);
  const suggestionsVisible = searchSuggestionsOpen && searchSuggestions.length > 0;
  const searchIntentChips = useMemo(
    () => buildSearchIntentSuggestions(search, SEARCH_INTENT_CHIP_LIMIT, { postingFilterOptions }),
    [postingFilterOptions, search]
  );
  const searchMotionStyle = {
    opacity: searchMotionRef.current.interpolate({
      inputRange: [0, 1],
      outputRange: [0.98, 1]
    }),
    transform: [
      {
        translateY: searchMotionRef.current.interpolate({
          inputRange: [0, 1],
          outputRange: [0, -14]
        })
      }
    ]
  };
  const suggestionsMotionStyle = {
    opacity: suggestionsMotionRef.current,
    transform: [
      {
        translateY: suggestionsMotionRef.current.interpolate({
          inputRange: [0, 1],
          outputRange: [-6, 0]
        })
      }
    ]
  };
  const resultsMotionStyle = {
    opacity: resultsMotionRef.current,
    transform: [
      {
        translateY: resultsMotionRef.current.interpolate({
          inputRange: [0, 1],
          outputRange: [64, 0]
        })
      }
    ]
  };

  useEffect(() => {
    if (postingsFilters.ats === "all") return;
    const selectedOption = (postingFilterOptions.ats || []).find(
      (option) => String(option?.value || "") === postingsFilters.ats
    );
    if (selectedOption && selectedOption.enabled === false) {
      setPostingsFilters((prev) => ({
        ...prev,
        ats: "all"
      }));
    }
  }, [postingsFilters.ats, postingFilterOptions.ats]);

  const navigateToPage = useCallback((page) => {
    if (isPublicNativeStoreSurface && page !== PAGE_KEYS.POSTINGS) {
      setActivePage(PAGE_KEYS.POSTINGS);
      setDrawerOpen(false);
      return;
    }
    setActivePage(page);
    setDrawerOpen(false);
  }, [isPublicNativeStoreSurface]);

  const setScrollTopButtonVisible = useCallback((visible) => {
    if (showScrollTopButtonRef.current === visible) return;
    showScrollTopButtonRef.current = visible;
    setShowScrollTopButton(visible);
  }, []);

  const scrollPostingsToTop = useCallback(() => {
    showScrollTopButtonRef.current = false;
    setShowScrollTopButton(false);
    setTimeout(() => {
      if (Platform.OS === "web" && typeof window !== "undefined") {
        const behavior = prefersReducedMotionRef.current ? "auto" : "smooth";
        window.scrollTo?.({ top: 0, behavior });
        window.document
          ?.querySelector?.('[data-testid="postings-page-scroll"]')
          ?.scrollTo?.({ top: 0, behavior });
      }
      postingsListRef.current?.scrollTo?.({ y: 0, animated: true });
      postingsListRef.current?.scrollToOffset?.({ offset: 0, animated: true });
    }, 0);
  }, []);

  const markPostingVisited = useCallback((postingUrl) => {
    const normalized = normalizeVisitedPostingUrl(postingUrl);
    if (!normalized) return;
    setVisitedPostingUrls((prev) => {
      const next = addVisitedPostingUrl(prev, normalized);
      writeVisitedPostingUrls(next);
      return next;
    });
  }, []);

  const loadPostings = useCallback(async (q, options = {}) => {
    const append = Boolean(options.append);
    const silent = Boolean(options.silent);
    const filters = options.filters || postingsFiltersRef.current;
    const requestedSearch = String(q || "").trim();
    const requestedFiltersSignature = getPostingsFiltersSignature(filters);
    const limit = Math.max(1, Math.min(500, Number(options.limit || FRONTEND_POSTINGS_PAGE_SIZE)));
    const offset = append
      ? Math.max(0, Number(options.offset ?? postingsNextOffsetRef.current ?? postingsRef.current.length))
      : 0;
    const requestSequence = append
      ? postingsRequestSequenceRef.current
      : postingsRequestSequenceRef.current + 1;
    const previousVisiblePostings = append ? [] : postingsRef.current;

    if (append && postingsLoadingMoreRef.current) {
      return;
    }
    if (!append) {
      postingsRequestSequenceRef.current = requestSequence;
    }
    if (append) {
      postingsLoadingMoreRef.current = true;
      setPostingsLoadingMore(true);
    } else if (!silent) {
      setLoading(true);
      postingsRef.current = [];
      postingsNextOffsetRef.current = 0;
      postingsHasMoreRef.current = false;
      setPostings([]);
      setSourceFacets([]);
      setPostingsTotalCount(0);
      setPostingsResultCoverage(null);
      setPostingsNextOffset(0);
      setPostingsHasMore(false);
    }
    setError("");
    try {
      const analyticsFilters = {
        ...filters,
        page_language: publicLanguageCode,
        ...(publicLanguageCountryCode ? { page_country: publicLanguageCountryCode } : {})
      };
      const response = await fetchPostings(requestedSearch, limit, offset, analyticsFilters);
      if (requestSequence !== postingsRequestSequenceRef.current) {
        return;
      }
      const normalizedItems = normalizePostingItems(response?.items);
      const nextVisibleItems = append
        ? mergePostingItems(postingsRef.current, normalizedItems)
        : normalizedItems;
      const nextSourceFacets = normalizeSourceFacets(response?.source_facets);
      const fallbackSourceFacets = buildSourceFacetsFromPostings(nextVisibleItems);
      const effectiveSourceFacets = nextSourceFacets.length > 0 ? nextSourceFacets : fallbackSourceFacets;
      const visibleCountAfterLoad = nextVisibleItems.length;
      const responseCount = Number(response?.count || 0);
      const totalCount = Math.max(responseCount, visibleCountAfterLoad);
      const rawNextOffset = response && Object.prototype.hasOwnProperty.call(response, "next_offset")
        ? response.next_offset
        : undefined;
      const nextOffset = rawNextOffset !== null && rawNextOffset !== undefined && Number.isFinite(Number(rawNextOffset))
        ? Math.max(0, Number(rawNextOffset))
        : offset + normalizedItems.length;
      const responseHasMore =
        Boolean(response?.has_more) ||
        (responseCount > 0 && responseCount > offset + normalizedItems.length) ||
        normalizedItems.length >= limit;

      postingsRef.current = nextVisibleItems;
      postingsNextOffsetRef.current = nextOffset;
      postingsHasMoreRef.current = Boolean(responseHasMore && normalizedItems.length > 0);
      setPostings(nextVisibleItems);
      setSourceFacets(effectiveSourceFacets);
      setPostingsTotalCount(totalCount);
      if (!append) {
        setPostingsResultQuery(requestedSearch);
        setPostingsResultFiltersSignature(requestedFiltersSignature);
      }
      setPostingsResultCoverage(buildFrontendResultCoverage(response, nextVisibleItems, effectiveSourceFacets, totalCount));
      setPostingsNextOffset(nextOffset);
      setPostingsHasMore(Boolean(responseHasMore && normalizedItems.length > 0));
      setSearchNotice("");
      lastPostingRefreshAtRef.current = Date.now();
    } catch (e) {
      if (requestSequence === postingsRequestSequenceRef.current) {
        if (e?.isTransientBusy) {
          setSearchNotice("Showing the latest results while indexing catches up. Search will retry shortly.");
          if (!append && Array.isArray(previousVisiblePostings) && previousVisiblePostings.length > 0) {
            const restoredSourceFacets = buildSourceFacetsFromPostings(previousVisiblePostings);
            postingsRef.current = previousVisiblePostings;
            postingsNextOffsetRef.current = previousVisiblePostings.length;
            postingsHasMoreRef.current = false;
            setPostings(previousVisiblePostings);
            setSourceFacets(restoredSourceFacets);
            setPostingsTotalCount(previousVisiblePostings.length);
            setPostingsResultCoverage(
              buildFrontendResultCoverage({}, previousVisiblePostings, restoredSourceFacets, previousVisiblePostings.length)
            );
            setPostingsNextOffset(previousVisiblePostings.length);
            setPostingsHasMore(false);
          }
        } else if (!append) {
          setError(String(e.message || e));
        } else {
          setSearchNotice("Could not load the next result page. Try scrolling again in a moment.");
        }
        queueFrontendLog("error", append ? "load_more_postings_failed" : "load_postings_failed", String(e?.stack || e?.message || e), {
          search: requestedSearch,
          offset,
          limit,
          append,
          transient_busy: Boolean(e?.isTransientBusy)
        });
      }
    } finally {
      if (append) {
        postingsLoadingMoreRef.current = false;
        setPostingsLoadingMore(false);
      } else if (!silent && requestSequence === postingsRequestSequenceRef.current) {
        setLoading(false);
      }
    }
  }, [publicLanguageCode, publicLanguageCountryCode, queueFrontendLog]);

  const loadPostingFilterOptions = useCallback(async (options = {}) => {
    const silent = Boolean(options.silent);
    const force = Boolean(options.force);
    if (isPublicNativeStoreSurface || !force) {
      return;
    }
    const q = Object.prototype.hasOwnProperty.call(options, "search") ? options.search : searchRef.current;
    const filters = options.filters || postingsFiltersRef.current;
    if (!silent) {
      setPostingFilterOptionsLoading(true);
    }
    try {
      const analyticsFilters = {
        ...filters,
        page_language: publicLanguageCode,
        ...(publicLanguageCountryCode ? { page_country: publicLanguageCountryCode } : {})
      };
      const response = await fetchPostingFilterOptions(q, analyticsFilters);
      setPostingFilterOptions({
        ats: mergeAtsFilterOptions(response?.ats),
        industries: Array.isArray(response?.industries) ? response.industries : [],
        regions: Array.isArray(response?.regions) ? response.regions : [],
        countries: Array.isArray(response?.countries) ? response.countries : [],
        states: Array.isArray(response?.states) ? response.states : [],
        counties: Array.isArray(response?.counties) ? response.counties : [],
        sort_options: Array.isArray(response?.sort_options) && response.sort_options.length > 0
          ? response.sort_options
          : DEFAULT_POSTING_SORT_OPTIONS
      });
    } catch (e) {
      if (!silent) setError(String(e.message || e));
      else queueFrontendLog("warn", "load_filter_options_failed", String(e?.message || e), {});
    } finally {
      if (!silent) {
        setPostingFilterOptionsLoading(false);
      }
    }
  }, [isPublicNativeStoreSurface, publicLanguageCode, publicLanguageCountryCode, queueFrontendLog]);

  const loadMorePostings = useCallback(() => {
    if (initializing || loading) return;
    if (postingsLoadingMoreRef.current || !postingsHasMoreRef.current) return;
    const offset = Math.max(0, Number(postingsNextOffsetRef.current || postingsRef.current.length));
    void loadPostings(searchRef.current, {
      append: true,
      silent: true,
      filters: postingsFiltersRef.current,
      limit: FRONTEND_POSTINGS_PAGE_SIZE,
      offset
    });
  }, [initializing, loading, loadPostings]);

  const handlePostingsScroll = useCallback((event) => {
    if (!showResultsSurface) return;
    const nativeEvent = event?.nativeEvent || {};
    const layoutHeight = Number(nativeEvent?.layoutMeasurement?.height || 0);
    const contentHeight = Number(nativeEvent?.contentSize?.height || 0);
    const scrollY = Number(nativeEvent?.contentOffset?.y || 0);
    if (!layoutHeight || !contentHeight) return;
    const shouldShowScrollTop = scrollY > Math.max(520, layoutHeight * 0.75);
    setScrollTopButtonVisible(shouldShowScrollTop);
    const distanceFromBottom = contentHeight - (scrollY + layoutHeight);
    const triggerDistance = Math.max(FRONTEND_POSTINGS_PREFETCH_DISTANCE_PX, layoutHeight * 0.75);
    if (distanceFromBottom <= triggerDistance) {
      loadMorePostings();
    }
  }, [loadMorePostings, setScrollTopButtonVisible, showResultsSurface]);

  const loadApplications = useCallback(async (options = {}) => {
    const silent = Boolean(options.silent);
    const requestSequence = applicationsRequestSequenceRef.current + 1;
    applicationsRequestSequenceRef.current = requestSequence;
    if (!silent) {
      setApplicationsLoading(true);
    }
    try {
      const response = await fetchApplications(1000, 0);
      if (requestSequence !== applicationsRequestSequenceRef.current) {
        return;
      }
      const items = Array.isArray(response?.items) ? response.items : [];
      setApplications(items.map(normalizeApplicationItem).filter((item) => item.id > 0));
    } catch (e) {
      if (requestSequence === applicationsRequestSequenceRef.current) {
        if (!silent) {
          setError(String(e.message || e));
        } else {
          queueFrontendLog("warn", "load_applications_failed", String(e?.message || e), {});
        }
      }
    } finally {
      if (!silent && requestSequence === applicationsRequestSequenceRef.current) {
        setApplicationsLoading(false);
      }
    }
  }, [queueFrontendLog]);

  const handleOpenApplicationsPage = useCallback(() => {
    if (isPublicNativeStoreSurface) {
      setActivePage(PAGE_KEYS.POSTINGS);
      setDrawerOpen(false);
      return;
    }
    setActivePage(PAGE_KEYS.APPLICATIONS);
    setDrawerOpen(false);
    loadApplications({ silent: false });
  }, [isPublicNativeStoreSurface, loadApplications]);

  const loadStatus = useCallback(async () => {
    try {
      const response = await fetchSyncStatus();
      setStatusError("");
      setStatus(response);
      const workerRunning = String(response?.ingestion_worker?.latest_status || "").toLowerCase() === "running";
      const isStopping = Boolean(response?.stopping || response?.cancel_requested);
      const isRunning = Boolean(response?.running || workerRunning);
      setSyncing(isRunning);
      setSyncActionState((prev) => {
        if (isStopping) return "stopping";
        if (isRunning) return "running";
        if (prev === "queued" || prev === "running" || prev === "stopping") return "updated";
        return prev;
      });
      return response;
    } catch (e) {
      setStatusError("unavailable");
      queueFrontendLog("error", "load_status_failed", String(e?.stack || e?.message || e), {});
      return null;
    }
  }, [queueFrontendLog]);

  const loadPersonalInformation = useCallback(async (options = {}) => {
    const silent = Boolean(options.silent);
    if (!silent) {
      setSettingsLoading(true);
    }
    try {
      const response = await fetchPersonalInformation();
      setPersonalInformation(toFormPersonalInformation(response?.item));
    } catch (e) {
      if (!silent) {
        setError(String(e.message || e));
      } else {
        queueFrontendLog("warn", "load_personal_information_failed", String(e?.message || e), {});
      }
    } finally {
      if (!silent) {
        setSettingsLoading(false);
      }
    }
  }, [queueFrontendLog]);

  const loadMcpSettings = useCallback(async (options = {}) => {
    const silent = Boolean(options.silent);
    if (!silent) {
      setMcpSettingsLoading(true);
    }
    try {
      const response = await fetchMcpSettings();
      setMcpSettings(toFormMcpSettings(response?.item));
    } catch (e) {
      if (!silent) {
        setError(String(e.message || e));
      } else {
        queueFrontendLog("warn", "load_mcp_settings_failed", String(e?.message || e), {});
      }
    } finally {
      if (!silent) {
        setMcpSettingsLoading(false);
      }
    }
  }, [queueFrontendLog]);

  const loadSyncServiceSettings = useCallback(async (options = {}) => {
    const silent = Boolean(options.silent);
    if (!silent) {
      setSyncServiceSettingsLoading(true);
    }
    try {
      const response = await fetchSyncServiceSettings();
      setSyncServiceSettings(toFormSyncServiceSettings(response?.item));
    } catch (e) {
      if (!silent) {
        setError(String(e.message || e));
      } else {
        queueFrontendLog("warn", "load_sync_service_settings_failed", String(e?.message || e), {});
      }
    } finally {
      if (!silent) {
        setSyncServiceSettingsLoading(false);
      }
    }
  }, [queueFrontendLog]);

  const loadBlockedCompanies = useCallback(async (options = {}) => {
    const silent = Boolean(options.silent);
    if (!silent) {
      setBlockedCompaniesLoading(true);
    }
    try {
      const response = await fetchBlockedCompanies();
      setBlockedCompanies(Array.isArray(response?.items) ? response.items : []);
    } catch (e) {
      if (!silent) {
        setError(String(e.message || e));
      } else {
        queueFrontendLog("warn", "load_blocked_companies_failed", String(e?.message || e), {});
      }
    } finally {
      if (!silent) {
        setBlockedCompaniesLoading(false);
      }
    }
  }, [queueFrontendLog]);

  const runSync = useCallback(async () => {
    setError("");
    if (syncNoticeTimerRef.current) {
      clearTimeout(syncNoticeTimerRef.current);
      syncNoticeTimerRef.current = null;
    }
    try {
      const shouldStop = syncing || syncActionState === "running" || syncActionState === "queued";
      if (shouldStop) {
        setSyncNotice("Stopping sync after the current write finishes.");
        setSyncActionState("stopping");
        await stopSync();
      } else {
        setSyncNotice("Sync queued. Results stay searchable while indexing runs.");
        setSyncActionState("queued");
        setSyncing(true);
        const response = await startSync(false);
        setSyncActionState(response?.started === false ? "running" : "queued");
      }
      await loadStatus();
      syncNoticeTimerRef.current = setTimeout(() => {
        setSyncNotice("");
        syncNoticeTimerRef.current = null;
      }, 6000);
    } catch (e) {
      setSyncing(false);
      setSyncActionState("failed");
      setSyncNotice("Sync control failed. Details were logged for debugging.");
      setError(String(e.message || e));
    }
  }, [loadStatus, syncActionState, syncing]);

  const cancelPendingAutoSearch = useCallback(() => {
    if (autoSearchTimerRef.current) {
      clearTimeout(autoSearchTimerRef.current);
      autoSearchTimerRef.current = null;
    }
  }, []);

  const cancelPendingSearchSuggestion = useCallback(() => {
    if (searchSuggestionTimerRef.current) {
      clearTimeout(searchSuggestionTimerRef.current);
      searchSuggestionTimerRef.current = null;
    }
  }, []);

  const resetNativeSearchFocus = useCallback(() => {
    if (Platform.OS === "web") return;
    suppressNativeSearchFocusRef.current = true;
    setHideNativeSearchCaret(true);
    setSearchFocused(false);
  }, []);

  const resetPostingsHomeState = useCallback((filters = createDefaultPostingsFilters()) => {
    postingsRequestSequenceRef.current += 1;
    postingsRef.current = [];
    postingsNextOffsetRef.current = 0;
    postingsHasMoreRef.current = false;
    postingsLoadingMoreRef.current = false;
    setLoading(false);
    setPostingsLoadingMore(false);
    setPostings([]);
    setSourceFacets([]);
    setPostingsTotalCount(0);
    setPostingsResultCoverage(null);
    setPostingsResultQuery("");
    setPostingsResultFiltersSignature(getPostingsFiltersSignature(filters));
    setPostingsNextOffset(0);
    setPostingsHasMore(false);
    setSearchNotice("");
  }, []);

  const submitSearch = useCallback((value = searchRef.current, analytics = {}) => {
    cancelPendingAutoSearch();
    cancelPendingSearchSuggestion();
    dismissSearchKeyboard(searchInputRef);
    resetNativeSearchFocus();
    setLanguageMenuOpen(false);
    const nextSearch = String(value || "").trim();
    searchRef.current = nextSearch;
    lastSearchInputAtRef.current = Date.now();
    const analyticsSource = String(analytics?.source || "search_box").trim() || "search_box";
    const now = Date.now();
    const filters = postingsFiltersRef.current;
    const filtersSignature = getPostingsFiltersSignature(filters);
    const defaultFiltersSignature = getPostingsFiltersSignature(createDefaultPostingsFilters());
    const lastSubmit = lastSearchSubmitRef.current || { value: "", at: 0 };
    const duplicateSubmit =
      lastSubmit.value === nextSearch &&
      lastSubmit.filtersSignature === filtersSignature &&
      now - lastSubmit.at < SEARCH_SUBMIT_DEDUPE_MS;
    lastSearchSubmitRef.current = { value: nextSearch, filtersSignature, at: now };
    suppressedSuggestionQueryRef.current = nextSearch;
    if (nextSearch) {
      recentSearchesRef.current = [
        nextSearch,
        ...recentSearchesRef.current.filter((item) => normalizeSuggestionQuery(item) !== normalizeSuggestionQuery(nextSearch))
      ].slice(0, 8);
    }
    if (!nextSearch && filtersSignature === defaultFiltersSignature) {
      setSearchResultsMode(false);
      setSearch("");
      replacePublicSearchUrlQuery("");
      resetPostingsHomeState(filters);
      setSearchSuggestionsOpen(false);
      setActiveSuggestionIndex(-1);
      scrollPostingsToTop();
      return;
    }
    setSearchResultsMode(true);
    setSearch(nextSearch);
    replacePublicSearchUrlQuery(nextSearch);
    if (!duplicateSubmit) {
      setPostingsResultCoverage(null);
    }
    setSearchSuggestionsOpen(false);
    setActiveSuggestionIndex(-1);
    scrollPostingsToTop();
    if (!duplicateSubmit) {
      if (nextSearch) trackPublicSearch(nextSearch, { source: analyticsSource });
      void loadPostings(nextSearch, { filters });
    }
  }, [cancelPendingAutoSearch, cancelPendingSearchSuggestion, loadPostings, resetNativeSearchFocus, resetPostingsHomeState, scrollPostingsToTop]);

  const selectPopularSearch = useCallback((route) => {
    const nextQuery = String(
      route?.searchQuery ||
      route?.query ||
      route?.localizedSearchQuery ||
      route?.label ||
      ""
    ).trim();
    if (!nextQuery) return;
    if (String(route?.path || "").includes("?")) {
      replacePublicSearchUrlPath(route.path);
    }
    submitSearch(nextQuery, { source: "popular_search" });
  }, [submitSearch]);

  const clearSearchAndSuggestions = useCallback(() => {
    cancelPendingAutoSearch();
    cancelPendingSearchSuggestion();
    dismissSearchKeyboard(searchInputRef);
    resetNativeSearchFocus();
    const defaultFilters = createDefaultPostingsFilters();
    lastSearchSubmitRef.current = {
      value: "",
      filtersSignature: getPostingsFiltersSignature(defaultFilters),
      at: Date.now()
    };
    suppressedSuggestionQueryRef.current = "";
    setSearch("");
    replacePublicSearchUrlQuery("");
    setPostingsFilters(defaultFilters);
    setPostingsFilterPanelOpen(false);
    setSearchResultsMode(false);
    setLanguageMenuOpen(false);
    resetPostingsHomeState(defaultFilters);
    setSearchSuggestionsOpen(false);
    setActiveSuggestionIndex(-1);
    scrollPostingsToTop();
  }, [cancelPendingAutoSearch, cancelPendingSearchSuggestion, resetNativeSearchFocus, resetPostingsHomeState, scrollPostingsToTop]);

  const applySearchSuggestionFilter = useCallback((suggestion) => {
    const filterPatch = getSearchSuggestionFilterPatch(suggestion);
    if (!filterPatch) return false;
    cancelPendingAutoSearch();
    cancelPendingSearchSuggestion();
    dismissSearchKeyboard(searchInputRef);
    resetNativeSearchFocus();
    const nextFilters = {
      ...postingsFiltersRef.current,
      ...filterPatch
    };
    const query = String(searchRef.current || "").trim();
    const filtersSignature = getPostingsFiltersSignature(nextFilters);
    const now = Date.now();
    const lastSubmit = lastSearchSubmitRef.current || { value: "", at: 0 };
    const duplicateSubmit =
      lastSubmit.value === query &&
      lastSubmit.filtersSignature === filtersSignature &&
      now - lastSubmit.at < SEARCH_SUBMIT_DEDUPE_MS;
    lastSearchSubmitRef.current = {
      value: query,
      filtersSignature,
      at: now
    };
    suppressedSuggestionQueryRef.current = query;
    setPostingsFilters(nextFilters);
    setSearchResultsMode(true);
    if (!duplicateSubmit) {
      setPostingsResultCoverage(null);
    }
    setSearchSuggestionsOpen(false);
    setActiveSuggestionIndex(-1);
    scrollPostingsToTop();
    if (!duplicateSubmit) {
      trackPublicFilterChange("suggestion");
      void loadPostings(query, { filters: nextFilters });
    }
    return true;
  }, [cancelPendingAutoSearch, cancelPendingSearchSuggestion, loadPostings, resetNativeSearchFocus, scrollPostingsToTop]);

  const selectSearchSuggestion = useCallback((suggestion) => {
    if (applySearchSuggestionFilter(suggestion)) return;
    const value = String(suggestion?.value || suggestion?.label || "").trim();
    if (!value) return;
    submitSearch(value, { source: "suggestion" });
  }, [applySearchSuggestionFilter, submitSearch]);

  const handleBrandHome = useCallback(() => {
    cancelPendingAutoSearch();
    cancelPendingSearchSuggestion();
    const defaultFilters = createDefaultPostingsFilters();
    setActivePage(PAGE_KEYS.POSTINGS);
    setDrawerOpen(false);
    setSearch("");
    replacePublicSearchUrlQuery("");
    setPostingsFilters(defaultFilters);
    setPostingsFilterPanelOpen(false);
    setSearchResultsMode(false);
    setLanguageMenuOpen(false);
    resetPostingsHomeState(defaultFilters);
    setSearchSuggestionsOpen(false);
    setActiveSuggestionIndex(-1);
    suppressedSuggestionQueryRef.current = "";
    lastSearchSubmitRef.current = {
      value: "",
      filtersSignature: getPostingsFiltersSignature(defaultFilters),
      at: Date.now()
    };
    scrollPostingsToTop();
    setTimeout(() => searchInputRef.current?.focus?.(), 0);
  }, [cancelPendingAutoSearch, cancelPendingSearchSuggestion, resetPostingsHomeState, scrollPostingsToTop]);

  const handleSearchChange = useCallback((value) => {
    cancelPendingSearchSuggestion();
    if (Platform.OS !== "web") {
      suppressNativeSearchFocusRef.current = false;
      setHideNativeSearchCaret(false);
    }
    const nextValue = String(value || "");
    const previousResultQuery = String(postingsResultQuery || "").trim();
    searchRef.current = nextValue;
    lastSearchInputAtRef.current = Date.now();
    if (suppressedSuggestionQueryRef.current !== nextValue.trim()) {
      suppressedSuggestionQueryRef.current = "";
    }
    if (showResultsSurface && nextValue.trim() !== previousResultQuery) {
      setPostingsResultCoverage(null);
    }
    if (!nextValue.trim() && showResultsSurface) {
      const defaultFilters = createDefaultPostingsFilters();
      const defaultFiltersSignature = getPostingsFiltersSignature(defaultFilters);
      const currentFiltersSignature = getPostingsFiltersSignature(postingsFiltersRef.current);
      if (currentFiltersSignature === defaultFiltersSignature) {
        cancelPendingAutoSearch();
        suppressedSuggestionQueryRef.current = "";
        lastSearchSubmitRef.current = {
          value: "",
          filtersSignature: defaultFiltersSignature,
          at: Date.now()
        };
        setSearch(nextValue);
        replacePublicSearchUrlQuery("");
        setLanguageMenuOpen(false);
        setPostingsFilterPanelOpen(false);
        setSearchResultsMode(false);
        resetPostingsHomeState(defaultFilters);
        setSearchSuggestions([]);
        setSearchSuggestionsOpen(false);
        setActiveSuggestionIndex(-1);
        return;
      }
    }
    setSearch(nextValue);
  }, [cancelPendingAutoSearch, cancelPendingSearchSuggestion, postingsResultQuery, resetPostingsHomeState, showResultsSurface]);

  const handleSearchFocus = useCallback(() => {
    if (Platform.OS !== "web" && suppressNativeSearchFocusRef.current) {
      setSearchFocused(false);
      return;
    }
    if (Platform.OS !== "web") setHideNativeSearchCaret(false);
    setSearchFocused(true);
  }, []);

  const handleSearchBlur = useCallback(() => {
    if (Platform.OS !== "web") {
      suppressNativeSearchFocusRef.current = false;
    }
    setSearchFocused(false);
  }, []);

  const handleSearchPressIn = useCallback(() => {
    if (Platform.OS === "web") return;
    suppressNativeSearchFocusRef.current = false;
    setHideNativeSearchCaret(false);
    setSearchFocused(true);
  }, []);

  const focusSearch = useCallback(() => {
    setActivePage(PAGE_KEYS.POSTINGS);
    setDrawerOpen(false);
    setTimeout(() => searchInputRef.current?.focus?.(), 0);
  }, [queueFrontendLog]);

  const handleSearchKeyPress = useCallback((event) => {
    const key = event?.nativeEvent?.key;
    if (key === "Escape") {
      event?.preventDefault?.();
      clearSearchAndSuggestions();
      return;
    }
    if (key === "ArrowDown" && searchSuggestions.length > 0) {
      setSearchSuggestionsOpen(true);
      setActiveSuggestionIndex((prev) => Math.min(prev + 1, searchSuggestions.length - 1));
      return;
    }
    if (key === "ArrowUp" && searchSuggestions.length > 0) {
      setSearchSuggestionsOpen(true);
      setActiveSuggestionIndex((prev) => Math.max(prev - 1, 0));
      return;
    }
    if (key === "Enter" && activeSuggestionIndex >= 0 && searchSuggestions[activeSuggestionIndex]) {
      event?.preventDefault?.();
      selectSearchSuggestion(searchSuggestions[activeSuggestionIndex]);
      return;
    }
    if (key === "Enter") {
      event?.preventDefault?.();
      submitSearch(searchRef.current);
    }
  }, [activeSuggestionIndex, clearSearchAndSuggestions, searchSuggestions, selectSearchSuggestion, submitSearch]);

  const handleSaveApplicanteeInformation = useCallback(async () => {
    setError("");
    setSettingsNotice("");
    setSettingsSaving(true);
    try {
      const payload = { ...personalInformation };
      const response = await savePersonalInformation(payload);
      setPersonalInformation(toFormPersonalInformation(response?.item || payload));
      setSettingsNotice("Applicantee information saved.");
    } catch (e) {
      setError(String(e.message || e));
      setSettingsNotice("Unable to save applicantee information.");
    } finally {
      setSettingsSaving(false);
    }
  }, [personalInformation]);

  const handleChangePersonalInformation = useCallback((fieldKey, value) => {
    setPersonalInformation((prev) => ({
      ...prev,
      [fieldKey]: value
    }));
  }, []);

  const handleSaveSyncSettings = useCallback(async () => {
    setError("");
    setSyncSettingsNotice("");
    const syncIntervalSeconds = normalizeSyncIntervalSeconds(syncSettings.syncIntervalSeconds);
    const atsRequestQueueConcurrency = normalizeAtsRequestQueueConcurrency(
      syncServiceSettings.ats_request_queue_concurrency
    );
    const syncEnabledAts = normalizeSyncEnabledAts(syncServiceSettings.sync_enabled_ats);

    setSyncSettings((prev) => ({
      ...prev,
      syncIntervalSeconds: String(syncIntervalSeconds)
    }));
    setSyncServiceSettings((prev) => ({
      ...prev,
      ats_request_queue_concurrency: String(atsRequestQueueConcurrency),
      sync_enabled_ats: syncEnabledAts
    }));

    const intervalLabel = formatSyncIntervalLabel(syncIntervalSeconds);
    const networkScope =
      Platform.OS === "android"
        ? syncSettings.wifiOnly
          ? "on Wi-Fi only"
          : "on any network"
        : "on any network (Wi-Fi-only applies on Android)";
    const statusLabel = syncSettings.autoSyncEnabled ? `enabled every ${intervalLabel} ${networkScope}` : "disabled";
    const localSavedMessage = `Sync settings saved locally at ${formatTimeSafe(new Date())}. Auto sync is ${statusLabel}.`;

    queueFrontendLog("info", "save_sync_settings_started", "Saving sync settings.", {
      ats_request_queue_concurrency: atsRequestQueueConcurrency,
      sync_enabled_ats_count: syncEnabledAts.length
    });

    setSyncServiceSettingsSaving(true);
    try {
      const response = await saveSyncServiceSettings({
        ats_request_queue_concurrency: atsRequestQueueConcurrency,
        sync_enabled_ats: syncEnabledAts
      });
      const saved = toFormSyncServiceSettings(response?.item);
      setSyncServiceSettings(saved);
      queueFrontendLog("info", "save_sync_settings_completed", "Sync settings saved successfully.", {
        ats_request_queue_concurrency: saved.ats_request_queue_concurrency,
        sync_enabled_ats_count: saved.sync_enabled_ats.length
      });
      setSyncSettingsNotice(
        `${localSavedMessage} ATS request queue concurrency saved as ${saved.ats_request_queue_concurrency}. Sync-enabled ATS: ${saved.sync_enabled_ats.length}. This will take effect next time you stop and restart the sync service.`
      );
    } catch (e) {
      setError(String(e.message || e));
      queueFrontendLog("error", "save_sync_settings_failed", String(e?.stack || e?.message || e), {
        ats_request_queue_concurrency: atsRequestQueueConcurrency,
        sync_enabled_ats_count: syncEnabledAts.length
      });
      setSyncSettingsNotice(
        `${localSavedMessage} Unable to save ATS request queue concurrency on the server.`
      );
    } finally {
      setSyncServiceSettingsSaving(false);
    }
  }, [
    queueFrontendLog,
    syncServiceSettings.ats_request_queue_concurrency,
    syncServiceSettings.sync_enabled_ats,
    syncSettings
  ]);

  const handleMigrateFromDatabase = useCallback(async () => {
    const sourceDbPath = String(migrationSourceDbPath || "").trim();
    if (!sourceDbPath) {
      setMigrationNotice("Please enter a source database path.");
      return;
    }
    const selectedCount = Object.values(migrationSelection || {}).filter(Boolean).length;
    if (selectedCount === 0) {
      setMigrationNotice("Select at least one migration option.");
      return;
    }

    setError("");
      setMigrationNotice("");
      setMigrationRunning(true);
      try {
      const response = await migrateDatabaseSettings({
        source_db_path: sourceDbPath,
        personal_information: migrationSelection.personal_information,
        mcp_settings: migrationSelection.mcp_settings,
        blocked_companies: migrationSelection.blocked_companies,
        applications: migrationSelection.applications
      });
      const summary = response?.summary || {};

      await Promise.all([
        loadApplications({ silent: true }),
        loadPersonalInformation({ silent: true }),
        loadMcpSettings({ silent: true }),
        loadSyncServiceSettings({ silent: true }),
        loadBlockedCompanies({ silent: true })
      ]);

      const messageParts = ["Migration complete."];
      if (summary?.selected?.personal_information) {
        messageParts.push(`Personal info: ${summary.personal_information_copied ? "copied" : "not found"}`);
      }
      if (summary?.selected?.mcp_settings) {
        messageParts.push(`AI/MCP: ${summary.mcp_settings_copied ? "copied" : "not found"}`);
      }
      if (summary?.selected?.blocked_companies) {
        messageParts.push(`Blocked companies upserted: ${summary.blocked_companies_copied || 0}`);
      }
      if (summary?.selected?.applications) {
        messageParts.push(`Applications inserted: ${summary.applications_inserted || 0}`);
        messageParts.push(`Applications reused: ${summary.applications_reused || 0}`);
        messageParts.push(
          `Applications skipped (missing company): ${summary.applications_skipped_missing_company || 0}`
        );
      }
      setMigrationNotice(messageParts.join(" | "));
    } catch (e) {
      setError(String(e.message || e));
      setMigrationNotice("Migration failed.");
    } finally {
      setMigrationRunning(false);
    }
  }, [
    migrationSelection,
    migrationSourceDbPath,
    loadApplications,
    loadBlockedCompanies,
    loadMcpSettings,
    loadPersonalInformation,
    loadSyncServiceSettings
  ]);

  const handleSaveMcpSettings = useCallback(async () => {
    setError("");
    setMcpSettingsNotice("");
    setMcpSettingsSaving(true);
    try {
      const payload = toApiMcpSettings(mcpSettings);
      const response = await saveMcpSettings(payload);
      const savedSettings = toFormMcpSettings(response?.item || payload);
      setMcpSettings(savedSettings);

      const preview = await fetchMcpCandidates({
        use_settings: true,
        include_applied: false,
        limit: Number.parseInt(savedSettings.max_applications_per_run, 10) || 10
      });
      setMcpSettingsNotice(`MCP settings saved. ${preview?.count || 0} candidate postings currently match.`);
    } catch (e) {
      setError(String(e.message || e));
      setMcpSettingsNotice("Unable to save MCP settings.");
    } finally {
      setMcpSettingsSaving(false);
    }
  }, [mcpSettings]);

  const handleTrackPostingApplication = useCallback(
    async (posting) => {
      const postingKey = String(posting?.job_posting_url || "").trim();
      if (!postingKey) return;

      setSavingApplicationIds((prev) => ({
        ...prev,
        [postingKey]: true
      }));
      setError("");
      try {
        const response = await createApplication({
          company_name: posting.company_name,
          position_name: posting.position_name,
          job_posting_url: posting.job_posting_url,
          application_date: Math.floor(Date.now() / 1000),
          status: "applied",
          applied_by_type: "manual",
          applied_by_label: "Manually applied by user"
        });
        postingsRequestSequenceRef.current += 1;
        setPostings((prev) =>
          prev.filter((item) => String(item?.job_posting_url || "").trim() !== postingKey)
        );
        lastPostingRefreshAtRef.current = Date.now();
        const createdApplication = normalizeApplicationItem(response?.item);
        if (createdApplication.id > 0) {
          applicationsRequestSequenceRef.current += 1;
          setApplications((prev) => {
            const remaining = prev.filter((item) => item.id !== createdApplication.id);
            return [createdApplication, ...remaining];
          });
        }
        setApplicationsNotice(`Saved "${posting.position_name}" to Applications.`);
        await loadApplications({ silent: false });
      } catch (e) {
        setError(String(e.message || e));
      } finally {
        setSavingApplicationIds((prev) => ({
          ...prev,
          [postingKey]: false
        }));
      }
    },
    [loadApplications]
  );

  const handleIgnorePosting = useCallback(async (posting) => {
    const postingKey = String(posting?.job_posting_url || "").trim();
    if (!postingKey) return;

    setIgnoringPostingIds((prev) => ({
      ...prev,
      [postingKey]: true
    }));
    setError("");
    try {
      await ignorePosting({
        job_posting_url: posting.job_posting_url,
        ignored: true,
        ignored_by_label: "Ignored by user"
      });
      postingsRequestSequenceRef.current += 1;
      setPostings((prev) =>
        prev.filter((item) => String(item?.job_posting_url || "").trim() !== postingKey)
      );
      setApplicationsNotice(`Ignored "${posting.position_name}".`);
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setIgnoringPostingIds((prev) => ({
        ...prev,
        [postingKey]: false
      }));
    }
  }, []);

  const handleBlockCompany = useCallback(
    async (posting) => {
      const companyName = String(posting?.company_name || "").trim();
      const normalizedCompanyName = normalizeCompanyName(companyName);
      if (!companyName || !normalizedCompanyName) return;

      setBlockingCompanyNames((prev) => ({
        ...prev,
        [normalizedCompanyName]: true
      }));
      setError("");
      try {
        await blockCompany({ company_name: companyName });
        setPostings((prev) =>
          prev.filter((item) => normalizeCompanyName(item?.company_name) !== normalizedCompanyName)
        );
        await loadBlockedCompanies({ silent: true });
        setApplicationsNotice(`Blocked "${companyName}". Postings from this company are now hidden.`);
      } catch (e) {
        setError(String(e.message || e));
      } finally {
        setBlockingCompanyNames((prev) => ({
          ...prev,
          [normalizedCompanyName]: false
        }));
      }
    },
    [loadBlockedCompanies]
  );

  const handleUnblockCompany = useCallback(
    async (companyName) => {
      const normalizedCompanyName = normalizeCompanyName(companyName);
      if (!normalizedCompanyName) return;

      setUnblockingCompanyNames((prev) => ({
        ...prev,
        [normalizedCompanyName]: true
      }));
      setError("");
      try {
        await unblockCompany({ company_name: companyName });
        await loadBlockedCompanies({ silent: true });
        await loadPostings(searchRef.current, { silent: true, filters: postingsFiltersRef.current });
        setApplicationsNotice(`Unblocked "${companyName}".`);
      } catch (e) {
        setError(String(e.message || e));
      } finally {
        setUnblockingCompanyNames((prev) => ({
          ...prev,
          [normalizedCompanyName]: false
        }));
      }
    },
    [loadBlockedCompanies, loadPostings]
  );

  const handleUpdateApplicationStatus = useCallback(async (applicationId, nextStatus) => {
    setUpdatingApplicationIds((prev) => ({
      ...prev,
      [applicationId]: true
    }));
    setError("");
    try {
      const response = await updateApplicationStatus(applicationId, nextStatus);
      const item = response?.item;
      if (item) {
        setApplications((prev) =>
          prev.map((application) =>
            application.id === applicationId ? normalizeApplicationItem({ ...application, ...item }) : application
          )
        );
      }
      setApplicationsNotice(`Updated application status to "${nextStatus}".`);
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setUpdatingApplicationIds((prev) => ({
        ...prev,
        [applicationId]: false
      }));
      setOpenApplicationStatusForId(null);
    }
  }, []);

  const handleDeleteApplication = useCallback(async (applicationId) => {
    setDeletingApplicationIds((prev) => ({
      ...prev,
      [applicationId]: true
    }));
    setError("");
    try {
      await deleteApplication(applicationId);
      setApplications((prev) => prev.filter((application) => application.id !== applicationId));
      setApplicationsNotice("Application deleted.");
      setOpenApplicationStatusForId(null);
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setDeletingApplicationIds((prev) => ({
        ...prev,
        [applicationId]: false
      }));
    }
  }, []);

  const setAtsFilter = useCallback((value) => {
    const nextValue = String(value || "all").trim().toLowerCase();
    setSearchResultsMode(true);
    trackPublicFilterChange("ats");
    setPostingsFilters((prev) => ({
      ...prev,
      ats: nextValue || "all"
    }));
  }, []);

  const toggleIndustryFilter = useCallback((value) => {
    setSearchResultsMode(true);
    trackPublicFilterChange("industry");
    setPostingsFilters((prev) => {
      const next = new Set(prev.industries);
      if (next.has(value)) {
        next.delete(value);
      } else {
        next.add(value);
      }
      return {
        ...prev,
        industries: Array.from(next)
      };
    });
  }, []);

  const toggleRegionFilter = useCallback(
    (value) => {
      setSearchResultsMode(true);
      trackPublicFilterChange("region");
      setPostingsFilters((prev) => {
        const nextRegions = new Set(prev.regions || []);
        if (nextRegions.has(value)) {
          nextRegions.delete(value);
        } else {
          nextRegions.add(value);
        }

        const nextRegionValues = Array.from(nextRegions);
        const nextCountries = (prev.countries || []).filter((countryValue) => {
          if (nextRegionValues.length === 0) return true;
          const countryRegion = countryRegionByValue.get(String(countryValue || ""));
          return countryRegion && nextRegionValues.includes(countryRegion);
        });

        return {
          ...prev,
          regions: nextRegionValues,
          countries: nextCountries
        };
      });
    },
    [countryRegionByValue]
  );

  const toggleCountryFilter = useCallback((value) => {
    setSearchResultsMode(true);
    trackPublicFilterChange("country");
    setPostingsFilters((prev) => {
      const next = new Set(prev.countries || []);
      if (next.has(value)) {
        next.delete(value);
      } else {
        next.add(value);
      }
      return {
        ...prev,
        countries: Array.from(next)
      };
    });
  }, []);

  const toggleStateFilter = useCallback((value) => {
    setSearchResultsMode(true);
    trackPublicFilterChange("state");
    setPostingsFilters((prev) => {
      const nextStates = new Set(prev.states);
      if (nextStates.has(value)) {
        nextStates.delete(value);
      } else {
        nextStates.add(value);
      }

      const nextStateValues = Array.from(nextStates);
      const nextCounties = prev.counties.filter((countyValue) => {
        const [stateCode] = String(countyValue || "").split("|");
        return !stateCode || nextStateValues.includes(stateCode);
      });

      return {
        ...prev,
        states: nextStateValues,
        counties: nextCounties
      };
    });
  }, []);

  const toggleCountyFilter = useCallback((value) => {
    setSearchResultsMode(true);
    trackPublicFilterChange("county");
    setPostingsFilters((prev) => {
      const next = new Set(prev.counties);
      if (next.has(value)) {
        next.delete(value);
      } else {
        next.add(value);
      }
      return {
        ...prev,
        counties: Array.from(next)
      };
    });
  }, []);

  const clearAllPostingFilters = useCallback(() => {
    const defaultFilters = createDefaultPostingsFilters();
    trackPublicFilterChange("clear_all");
    setPostingsFilters(defaultFilters);
    setSearchResultsMode(Boolean(String(searchRef.current || "").trim()));
    lastSearchSubmitRef.current = {
      value: searchRef.current,
      filtersSignature: getPostingsFiltersSignature(defaultFilters),
      at: Date.now()
    };
    scrollPostingsToTop();
    void loadPostings(searchRef.current, { filters: defaultFilters });
  }, [loadPostings, scrollPostingsToTop]);

  const applyPostingsFiltersImmediately = useCallback((nextFilters) => {
    const defaultFiltersSignature = getPostingsFiltersSignature(createDefaultPostingsFilters());
    const nextFiltersSignature = getPostingsFiltersSignature(nextFilters);
    setPostingsFilters(nextFilters);
    setSearchResultsMode(Boolean(String(searchRef.current || "").trim()) || nextFiltersSignature !== defaultFiltersSignature);
    lastSearchSubmitRef.current = {
      value: searchRef.current,
      filtersSignature: nextFiltersSignature,
      at: Date.now()
    };
    scrollPostingsToTop();
    void loadPostings(searchRef.current, { filters: nextFilters });
  }, [loadPostings, scrollPostingsToTop]);

  const handleSelectSourceFacet = useCallback(
    (source) => {
      const value = normalizeAtsValue(source?.value || source?.key || source?.label || "");
      if (!value || value === "unknown" || !ATS_LABEL_BY_VALUE[value]) return;
      trackPublicFilterChange("source");
      applyPostingsFiltersImmediately({
        ...postingsFiltersRef.current,
        ats: value
      });
    },
    [applyPostingsFiltersImmediately]
  );

  const clearLocationPostingFilters = useCallback(() => {
    trackPublicFilterChange("location_clear");
    applyPostingsFiltersImmediately({
      ...postingsFiltersRef.current,
      regions: [],
      countries: [],
      states: [],
      counties: []
    });
  }, [applyPostingsFiltersImmediately]);

  const clearRemotePostingFilter = useCallback(() => {
    trackPublicFilterChange("remote_clear");
    applyPostingsFiltersImmediately({
      ...postingsFiltersRef.current,
      remote: "all"
    });
  }, [applyPostingsFiltersImmediately]);

  const toggleMcpIndustryPreference = useCallback((value) => {
    setMcpSettings((prev) => {
      const next = new Set(prev.preferred_industries || []);
      if (next.has(value)) {
        next.delete(value);
      } else {
        next.add(value);
      }
      return {
        ...prev,
        preferred_industries: Array.from(next)
      };
    });
  }, []);

  const toggleMcpRegionPreference = useCallback(
    (value) => {
      setMcpSettings((prev) => {
        const nextRegions = new Set(prev.preferred_regions || []);
        if (nextRegions.has(value)) {
          nextRegions.delete(value);
        } else {
          nextRegions.add(value);
        }

        const nextRegionValues = Array.from(nextRegions);
        const nextCountries = (prev.preferred_countries || []).filter((countryValue) => {
          if (nextRegionValues.length === 0) return true;
          const countryRegion = countryRegionByValue.get(String(countryValue || ""));
          return countryRegion && nextRegionValues.includes(countryRegion);
        });

        return {
          ...prev,
          preferred_regions: nextRegionValues,
          preferred_countries: nextCountries
        };
      });
    },
    [countryRegionByValue]
  );

  const toggleMcpCountryPreference = useCallback((value) => {
    setMcpSettings((prev) => {
      const next = new Set(prev.preferred_countries || []);
      if (next.has(value)) {
        next.delete(value);
      } else {
        next.add(value);
      }
      return {
        ...prev,
        preferred_countries: Array.from(next)
      };
    });
  }, []);

  const toggleMcpStatePreference = useCallback((value) => {
    setMcpSettings((prev) => {
      const nextStates = new Set(prev.preferred_states || []);
      if (nextStates.has(value)) {
        nextStates.delete(value);
      } else {
        nextStates.add(value);
      }

      const nextStateValues = Array.from(nextStates);
      const nextCounties = (prev.preferred_counties || []).filter((countyValue) => {
        const [stateCode] = String(countyValue || "").split("|");
        return !stateCode || nextStateValues.includes(stateCode);
      });

      return {
        ...prev,
        preferred_states: nextStateValues,
        preferred_counties: nextCounties
      };
    });
  }, []);

  const toggleMcpCountyPreference = useCallback((value) => {
    setMcpSettings((prev) => {
      const next = new Set(prev.preferred_counties || []);
      if (next.has(value)) {
        next.delete(value);
      } else {
        next.add(value);
      }
      return {
        ...prev,
        preferred_counties: Array.from(next)
      };
    });
  }, []);

  useEffect(() => {
    searchRef.current = search;
  }, [search]);

  useEffect(() => {
    postingsFiltersRef.current = postingsFilters;
  }, [postingsFilters]);

  useEffect(() => {
    postingFilterOptionsRef.current = postingFilterOptions;
  }, [postingFilterOptions]);

  useEffect(() => {
    postingsRef.current = postings;
  }, [postings]);

  useEffect(() => {
    postingsHasMoreRef.current = postingsHasMore;
  }, [postingsHasMore]);

  useEffect(() => {
    postingsNextOffsetRef.current = postingsNextOffset;
  }, [postingsNextOffset]);

  useEffect(() => {
    if (hasActivePostingFilters) {
      setSearchResultsMode(true);
    }
  }, [hasActivePostingFilters]);

  useEffect(() => {
    if (isPublicNativeStoreSurface) return undefined;
    if (normalizePublicLanguageCode(getPublicSeoRouteHint()?.languageCode)) return undefined;
    if (normalizePublicLanguageCode(readWebStorageValue(PUBLIC_LANGUAGE_STORAGE_KEY))) return undefined;
    let cancelled = false;
    const loadPublicPreference = async () => {
      try {
        const response = await fetchPublicPreferences();
        if (cancelled) return;
        const nextLanguage = normalizePublicLanguageCode(response?.default_language);
        if (nextLanguage) {
          setPublicLanguageCode(nextLanguage);
        }
      } catch (e) {
        queueFrontendLog("warn", "public_preferences_failed", String(e?.message || e));
      }
    };
    void loadPublicPreference();
    return () => {
      cancelled = true;
    };
  }, [isPublicNativeStoreSurface, queueFrontendLog]);

  useEffect(() => {
    if (activePage !== PAGE_KEYS.POSTINGS) return undefined;
    const fallbackQueryCounts = publicLanguageCountryCode
      ? getPublicSeoCountryFallbackQueries(publicLanguageCountryCode, publicLanguageCode, SEO_LANDING_LINK_LIMIT)
      : [];
    const fallbackItems = getPublicSeoPopularSearchItems(publicLanguageCode, fallbackQueryCounts, SEO_LANDING_LINK_LIMIT, {
      trustedQueryCounts: fallbackQueryCounts.length > 0,
      countryCode: publicLanguageCountryCode
    });
    setPopularSearchItems(fallbackItems);
    if (showResultsSurface) return undefined;

    let cancelled = false;
    const loadPopularSearches = async () => {
      try {
        const response = await fetchPopularSearches(publicLanguageCode, SEO_LANDING_LINK_LIMIT, publicLanguageCountryCode);
        if (cancelled) return;
        const items = Array.isArray(response?.items) ? response.items.slice(0, SEO_LANDING_LINK_LIMIT) : [];
        setPopularSearchItems(items.length > 0 ? items : fallbackItems);
      } catch (e) {
        if (!cancelled) {
          setPopularSearchItems(fallbackItems);
          queueFrontendLog("warn", "popular_searches_failed", String(e?.message || e), {
            language: publicLanguageCode,
            country: publicLanguageCountryCode
          });
        }
      }
    };
    void loadPopularSearches();
    return () => {
      cancelled = true;
    };
  }, [activePage, publicLanguageCode, publicLanguageCountryCode, queueFrontendLog, showResultsSurface]);

  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined" || !window.matchMedia) return undefined;
    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updatePreference = () => {
      prefersReducedMotionRef.current = Boolean(motionQuery.matches);
    };
    updatePreference();
    motionQuery.addEventListener?.("change", updatePreference);
    return () => motionQuery.removeEventListener?.("change", updatePreference);
  }, []);

  useEffect(() => {
    if (!animatedSearchPlaceholderEnabled) return undefined;
    if (activePage !== PAGE_KEYS.POSTINGS) return undefined;
    if (showResultsSurface) return undefined;
    if (String(search || "").trim()) return undefined;
    const text = SEARCH_PLACEHOLDER_EXAMPLES[searchExampleTypeState.index % SEARCH_PLACEHOLDER_EXAMPLES.length] || "";
    const atEnd = !searchExampleTypeState.deleting && searchExampleTypeState.length >= text.length;
    const atStart = searchExampleTypeState.deleting && searchExampleTypeState.length <= 1;
    const delay = atEnd
      ? SEARCH_PLACEHOLDER_HOLD_MS
      : atStart
        ? SEARCH_PLACEHOLDER_NEXT_MS
        : searchExampleTypeState.deleting
          ? SEARCH_PLACEHOLDER_DELETE_MS
          : SEARCH_PLACEHOLDER_TYPE_MS;
    const timer = setTimeout(() => {
      setSearchExampleTypeState((current) => {
        const currentText = SEARCH_PLACEHOLDER_EXAMPLES[current.index % SEARCH_PLACEHOLDER_EXAMPLES.length] || "";
        if (!current.deleting && current.length >= currentText.length) {
          return { ...current, deleting: true };
        }
        if (current.deleting && current.length <= 1) {
          return {
            index: (current.index + 1) % SEARCH_PLACEHOLDER_EXAMPLES.length,
            length: 2,
            deleting: false
          };
        }
        return {
          ...current,
          length: Math.max(1, current.length + (current.deleting ? -1 : 1))
        };
      });
    }, delay);
    return () => clearTimeout(timer);
  }, [activePage, animatedSearchPlaceholderEnabled, search, searchExampleTypeState, showResultsSurface]);

  useEffect(() => {
    Animated.timing(searchMotionRef.current, {
      toValue: searchShellCompact ? 1 : 0,
      duration: prefersReducedMotionRef.current ? 0 : 300,
      useNativeDriver: Platform.OS !== "web"
    }).start();
  }, [searchShellCompact]);

  useEffect(() => {
    Animated.timing(suggestionsMotionRef.current, {
      toValue: suggestionsVisible ? 1 : 0,
      duration: prefersReducedMotionRef.current ? 0 : 180,
      useNativeDriver: Platform.OS !== "web"
    }).start();
  }, [suggestionsVisible]);

  useEffect(() => {
    Animated.timing(resultsMotionRef.current, {
      toValue: showResultsSurface ? 1 : 0,
      duration: prefersReducedMotionRef.current ? 0 : 320,
      useNativeDriver: Platform.OS !== "web"
    }).start();
  }, [showResultsSurface]);

  useEffect(() => {
    if (!showResultsSurface) {
      setScrollTopButtonVisible(false);
    }
  }, [setScrollTopButtonVisible, showResultsSurface]);

  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") return undefined;
    const updateWindowScrollTopButton = () => {
      if (!showResultsSurface) {
        setScrollTopButtonVisible(false);
        return;
      }
      const scrollY = Number(window.scrollY || window.document?.documentElement?.scrollTop || 0);
      const viewportHeight = Number(window.innerHeight || 0);
      setScrollTopButtonVisible(scrollY > Math.max(520, viewportHeight * 0.75));
    };
    window.addEventListener("scroll", updateWindowScrollTopButton, { passive: true });
    updateWindowScrollTopButton();
    return () => window.removeEventListener("scroll", updateWindowScrollTopButton);
  }, [setScrollTopButtonVisible, showResultsSurface]);

  useEffect(() => {
    if (Platform.OS !== "web") return undefined;

    const handleGlobalKeyDown = (event) => {
      const tagName = String(event?.target?.tagName || "").toLowerCase();
      const isEditableTarget = tagName === "input" || tagName === "textarea" || Boolean(event?.target?.isContentEditable);
      const targetTestId = String(event?.target?.getAttribute?.("data-testid") || "");
      if (event.key === "Escape") {
        if (releaseNotesOpen) {
          event.preventDefault();
          setReleaseNotesOpen(false);
          return;
        }
        if (languageMenuOpen) {
          event.preventDefault();
          setLanguageMenuOpen(false);
          return;
        }
        if (drawerOpen) {
          event.preventDefault();
          setDrawerOpen(false);
          return;
        }
        if (isEditableTarget && targetTestId !== "search-input") {
          return;
        }
        if (activePage === PAGE_KEYS.POSTINGS) {
          event.preventDefault();
          clearSearchAndSuggestions();
          return;
        }
      }
      if ((event.key === "k" || event.key === "K") && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        focusSearch();
        return;
      }
      if (event.key === "/" && !isEditableTarget) {
        event.preventDefault();
        focusSearch();
      }
    };

    document.addEventListener("keydown", handleGlobalKeyDown);
    return () => document.removeEventListener("keydown", handleGlobalKeyDown);
  }, [activePage, clearSearchAndSuggestions, drawerOpen, focusSearch, languageMenuOpen, releaseNotesOpen]);

  useEffect(() => {
    if (activePage !== PAGE_KEYS.POSTINGS) return undefined;
    const query = String(search || "").trim();
    const cacheKey = `${publicLanguageCode}:${publicLanguageCountryCode}:${normalizeSuggestionQuery(query)}`;
    cancelPendingSearchSuggestion();
    if (query.length < 2) {
      setSearchSuggestions([]);
      setSearchSuggestionsOpen(false);
      setActiveSuggestionIndex(-1);
      return undefined;
    }
    if (suppressedSuggestionQueryRef.current === query) {
      setSearchSuggestionsOpen(false);
      setActiveSuggestionIndex(-1);
      return undefined;
    }

    const cached = searchSuggestionCacheRef.current.get(cacheKey);
    const cacheFresh = cached && Date.now() - Number(cached.at || 0) < SEARCH_SUGGESTION_CACHE_TTL_MS;
    const cachedItems = cacheFresh && Array.isArray(cached.items) ? cached.items : [];
    const localItems = buildLocalSearchSuggestions(query, SEARCH_SUGGESTION_LIMIT, {
      postingFilterOptions: postingFilterOptionsRef.current,
      postings: postingsRef.current,
      recentSearches: recentSearchesRef.current
    });
    const immediateItems = mergeSearchSuggestions(cachedItems, localItems).slice(0, SEARCH_SUGGESTION_LIMIT);
    setSearchSuggestions(immediateItems);
    setSearchSuggestionsOpen(immediateItems.length > 0);
    setActiveSuggestionIndex(-1);
    if (cacheFresh) {
      return undefined;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const currentQuery = String(searchRef.current || "").trim();
        if (currentQuery !== query) return;
        if (Date.now() - Number(lastSearchInputAtRef.current || 0) < SEARCH_SUGGESTION_DEBOUNCE_MS - 20) return;
        if (suppressedSuggestionQueryRef.current === query) return;
        const response = await fetchSearchSuggestions(query, SEARCH_SUGGESTION_LIMIT, publicLanguageCountryCode, publicLanguageCode);
        if (cancelled) return;
        if (suppressedSuggestionQueryRef.current === query) return;
        const remoteItems = Array.isArray(response?.items) ? response.items.slice(0, SEARCH_SUGGESTION_LIMIT) : [];
        const items = mergeSearchSuggestions(remoteItems, localItems).slice(0, SEARCH_SUGGESTION_LIMIT);
        searchSuggestionCacheRef.current.set(cacheKey, { at: Date.now(), items });
        setSearchSuggestionsOpen(items.length > 0);
        setSearchSuggestions(items);
        setActiveSuggestionIndex(-1);
      } catch (e) {
        if (cancelled) return;
        setSearchSuggestions(immediateItems);
        setSearchSuggestionsOpen(immediateItems.length > 0);
        queueFrontendLog("warn", "search_suggestions_failed", String(e?.message || e), {
          search: query,
          country: publicLanguageCountryCode
        });
      }
    }, SEARCH_SUGGESTION_DEBOUNCE_MS);
    searchSuggestionTimerRef.current = timer;

    return () => {
      cancelled = true;
      if (searchSuggestionTimerRef.current === timer) {
        searchSuggestionTimerRef.current = null;
      }
      clearTimeout(timer);
    };
  }, [activePage, cancelPendingSearchSuggestion, publicLanguageCode, publicLanguageCountryCode, queueFrontendLog, search]);

  useEffect(() => () => {
    if (syncNoticeTimerRef.current) {
      clearTimeout(syncNoticeTimerRef.current);
    }
  }, []);

  useEffect(() => {
    if (Platform.OS !== "windows") return undefined;

    const flushId = setInterval(() => {
      void flushFrontendLogs();
    }, 2500);

    return () => clearInterval(flushId);
  }, [flushFrontendLogs]);

  useEffect(() => {
    if (didRunInitialPostingsBootstrapRef.current) return undefined;
    didRunInitialPostingsBootstrapRef.current = true;
    const bootstrap = async () => {
      setInitializing(true);
      setError("");
      try {
        const bootstrapSearch = String(searchRef.current || "").trim();
        const bootstrapFilters = postingsFiltersRef.current;
        await Promise.all([
          loadPostings(bootstrapSearch, { filters: bootstrapFilters }),
          loadPostingFilterOptions({ search: bootstrapSearch, filters: bootstrapFilters }),
          loadStatus()
        ]);
      } catch (e) {
        setError(String(e.message || e));
      } finally {
        setInitializing(false);
      }
    };

    bootstrap();
  }, [
    loadPostings,
    loadPostingFilterOptions,
    loadStatus
  ]);

  useEffect(() => {
    const query = String(search || "").trim();
    const filtersSignature = getPostingsFiltersSignature(postingsFilters);
    const lastSubmit = lastSearchSubmitRef.current || {};
    if (
      lastSubmit.value === query &&
      lastSubmit.filtersSignature === filtersSignature
    ) {
      return undefined;
    }
    cancelPendingAutoSearch();
    const timer = setTimeout(() => {
      autoSearchTimerRef.current = null;
      const latestSubmit = lastSearchSubmitRef.current || {};
      if (
        String(searchRef.current || "").trim() !== query ||
        (
          latestSubmit.value === query &&
          latestSubmit.filtersSignature === filtersSignature &&
          Date.now() - Number(latestSubmit.at || 0) < SEARCH_SUBMIT_DEDUPE_MS
        )
      ) {
        return;
      }
      lastSearchSubmitRef.current = {
        value: query,
        filtersSignature,
        at: Date.now()
      };
      loadPostings(query, { filters: postingsFilters });
      loadPostingFilterOptions({ search: query, filters: postingsFilters, silent: true });
    }, AUTO_SEARCH_DEBOUNCE_MS);
    autoSearchTimerRef.current = timer;
    return () => {
      if (autoSearchTimerRef.current === timer) {
        autoSearchTimerRef.current = null;
      }
      clearTimeout(timer);
    };
  }, [cancelPendingAutoSearch, search, postingsFilters, loadPostings, loadPostingFilterOptions]);

  useEffect(() => {
    if (activePage === PAGE_KEYS.POSTINGS || !syncSettings.autoSyncEnabled) return undefined;

    const syncIntervalSeconds = normalizeSyncIntervalSeconds(syncSettings.syncIntervalSeconds);
    const syncIntervalMs = syncIntervalSeconds * 1000;

    const id = setInterval(async () => {
      if (autoSyncInFlightRef.current) return;

      if (Platform.OS === "android" && syncSettings.wifiOnly) {
        try {
          const NetInfo = getAndroidNetInfo();
          if (!NetInfo) return;
          const networkState = await NetInfo.fetch();
          const networkType = String(networkState?.type || "").toLowerCase();
          if (networkType !== "wifi") return;
        } catch {
          return;
        }
      }

      autoSyncInFlightRef.current = true;
      try {
        await runSync();
      } finally {
        autoSyncInFlightRef.current = false;
      }
    }, syncIntervalMs);

    return () => clearInterval(id);
  }, [activePage, runSync, syncSettings.autoSyncEnabled, syncSettings.syncIntervalSeconds, syncSettings.wifiOnly]);

  useEffect(() => {
    if (activePage === PAGE_KEYS.POSTINGS) return undefined;
    const id = setInterval(async () => {
      if (statusPollInFlightRef.current) return;

      statusPollInFlightRef.current = true;
      try {
        const latest = await loadStatus();
        if (!latest) return;

        const isRunning = Boolean(latest.running);
        const syncJustFinished = wasSyncRunningRef.current && !isRunning;
        wasSyncRunningRef.current = isRunning;

        if (activePage !== PAGE_KEYS.POSTINGS) return;
        if (postingsRefreshInFlightRef.current) return;

        const now = Date.now();
        const minRefreshMs = isRunning ? 15000 : 60000;
        const dueForRefresh = now - lastPostingRefreshAtRef.current >= minRefreshMs;
        if (!dueForRefresh && !syncJustFinished) return;

        postingsRefreshInFlightRef.current = true;
        try {
          await loadPostings(searchRef.current, { silent: true, filters: postingsFiltersRef.current });
        } finally {
          postingsRefreshInFlightRef.current = false;
        }
      } finally {
        statusPollInFlightRef.current = false;
      }
    }, 3000);
    return () => clearInterval(id);
  }, [activePage, loadPostings, loadStatus]);

  useEffect(() => {
    if (isPublicNativeStoreSurface && activePage !== PAGE_KEYS.POSTINGS) {
      setActivePage(PAGE_KEYS.POSTINGS);
    }
  }, [activePage, isPublicNativeStoreSurface]);

  useEffect(() => {
    if (isPublicNativeStoreSurface || activePage !== PAGE_KEYS.APPLICATIONS) return;
    loadApplications({ silent: false });
  }, [activePage, isPublicNativeStoreSurface, loadApplications]);

  useEffect(() => {
    if (isPublicNativeStoreSurface || activePage !== PAGE_KEYS.SETTINGS_APPLICANTEE) return;
    loadPersonalInformation({ silent: false });
  }, [activePage, isPublicNativeStoreSurface, loadPersonalInformation]);

  useEffect(() => {
    if (isPublicNativeStoreSurface || activePage !== PAGE_KEYS.SETTINGS_SYNC) return;
    loadSyncServiceSettings({ silent: false });
    loadBlockedCompanies({ silent: false });
  }, [activePage, isPublicNativeStoreSurface, loadBlockedCompanies, loadSyncServiceSettings]);

  useEffect(() => {
    if (isPublicNativeStoreSurface || activePage !== PAGE_KEYS.SETTINGS_MCP) return;
    loadMcpSettings({ silent: false });
  }, [activePage, isPublicNativeStoreSurface, loadMcpSettings]);

  useEffect(() => {
    if (activePage !== PAGE_KEYS.SETTINGS_MCP) return;
    loadPostingFilterOptions({ force: true });
  }, [activePage, loadPostingFilterOptions]);

  const renderSyncStatusPanel = () => {
    const isWorkerRunning = syncing || syncStatusDetails.workerState === "Worker running";
    const detailOpen = coverageDetailsOpen;
    return (
      <View style={styles.syncStatusPanel} testID="sync-status-panel">
        <View style={styles.syncStatusCompactRow} testID="coverage-strip">
          <View style={styles.syncStatusHeadingBlock}>
            <Text style={styles.syncStatusTitle}>Index coverage</Text>
            <Text numberOfLines={1} style={styles.syncStatusSummary} testID="sync-status-summary">
              {syncStatusDetails.summary}
            </Text>
          </View>
          <View
            style={[
              styles.syncStatusBadge,
              isWorkerRunning ? styles.syncStatusBadgeRunning : null
            ]}
            testID="ingestion-status-summary"
          >
            <Text style={styles.syncStatusBadgeText}>{isWorkerRunning ? "Running" : "Idle"}</Text>
          </View>
          <Pressable
            onPress={() => setCoverageDetailsOpen((prev) => !prev)}
            style={({ pressed }) => [styles.coverageToggle, pressed ? styles.buttonPressed : null]}
            testID="coverage-toggle"
            accessibilityRole="button"
            accessibilityLabel={detailOpen ? "Hide index coverage details" : "Show index coverage details"}
          >
            <Text style={styles.coverageToggleText}>{detailOpen ? "Less" : "Details"}</Text>
          </Pressable>
        </View>

        <View style={styles.syncStatusMetricsGrid}>
          {syncStatusDetails.metrics.map((metric) => (
            <View key={metric.label} style={styles.syncStatusMetric} testID={`sync-metric-${toTestIdPart(metric.label)}`}>
              <Text style={styles.syncStatusMetricValue}>{metric.value}</Text>
              <Text style={styles.syncStatusMetricLabel}>{metric.label}</Text>
            </View>
          ))}
        </View>

        {detailOpen ? (
          <View style={styles.syncStatusDetailsBlock} testID="coverage-details">
            <View style={styles.syncStatusStatesRow}>
              <Text style={styles.syncStatusState}>{syncStatusDetails.workerState}</Text>
              <Text style={styles.syncStatusState}>{syncStatusDetails.latestRunText}</Text>
            </View>
            {syncStatusDetails.activeAts?.length ? (
              <Text style={styles.syncStatusDetail} testID="sync-active-ats">
                Active ATS: {syncStatusDetails.activeAts.join(", ")}
              </Text>
            ) : null}
            {syncStatusDetails.healthNote ? (
              <Text style={styles.syncStatusError} testID="sync-last-error">
                {syncStatusDetails.healthNote}
              </Text>
            ) : null}
          </View>
        ) : null}
      </View>
    );
  };

  const renderReleaseNotesModal = () => (
    <Modal
      animationType="fade"
      transparent
      visible={releaseNotesOpen}
      onRequestClose={() => setReleaseNotesOpen(false)}
    >
      <View
        style={[styles.releaseNotesOverlay, !isDesktopViewport ? styles.releaseNotesOverlayMobile : null]}
        testID="release-notes-modal"
      >
        <Pressable
          style={styles.releaseNotesBackdrop}
          onPress={() => setReleaseNotesOpen(false)}
          testID="release-notes-backdrop"
          accessibilityRole="button"
          accessibilityLabel={t("release.closeA11y", "Close release notes")}
        />
        <View style={[styles.releaseNotesCard, !isDesktopViewport ? styles.releaseNotesCardMobile : null]}>
          <View style={styles.releaseNotesHeader}>
            <View style={styles.releaseNotesHeaderCopy}>
              <Text style={styles.releaseNotesTitle} testID="release-notes-title">
                {t("release.title", "Release notes")}
              </Text>
            </View>
            <Pressable
              onPress={() => setReleaseNotesOpen(false)}
              style={({ pressed }) => [styles.releaseNotesCloseButton, pressed ? styles.buttonPressed : null]}
              testID="release-notes-close"
              accessibilityRole="button"
              accessibilityLabel={t("release.closeA11y", "Close release notes")}
            >
              <Text style={styles.releaseNotesCloseText}>{t("release.close", "Close")}</Text>
            </Pressable>
          </View>
          <ScrollView
            style={[styles.releaseNotesScroll, !isDesktopViewport ? styles.releaseNotesScrollMobile : null]}
            contentContainerStyle={[
              styles.releaseNotesScrollContent,
              !isDesktopViewport ? styles.releaseNotesScrollContentMobile : null
            ]}
            testID="release-notes-scroll"
            accessibilityLabel={t("release.historyLabel", "Release notes history")}
          >
            {PUBLIC_RELEASE_NOTES.map((release) => {
              const localizedRelease = getLocalizedReleaseNote(release, publicLanguageCode, t);
              return (
                <View key={release.version} style={styles.releaseNoteItem}>
                  <View style={styles.releaseNoteHeadingRow}>
                    <Text style={styles.releaseNoteVersion}>
                      {translatedPublicText(t, "release.versionLabel", "Version {version}", { version: release.version })}
                    </Text>
                    <Text style={styles.releaseNoteDate}>{localizedRelease.dateLabel}</Text>
                  </View>
                  <Text style={styles.releaseNoteTitle} testID={`release-note-title-${release.version}`}>{localizedRelease.title}</Text>
                  <Text style={styles.releaseNoteSummary} testID={`release-note-summary-${release.version}`}>{localizedRelease.summary}</Text>
                </View>
              );
            })}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );

  const renderPostingsPage = () => {
    const filtersVisible = false;
    const resultTotalCount = Math.max(postingsTotalCount, postings.length);
    const currentPostingsFiltersSignature = getPostingsFiltersSignature(postingsFilters);
    const resultStateMatchesCurrentSearch =
      String(postingsResultQuery || "").trim() === searchQueryText &&
      postingsResultFiltersSignature === currentPostingsFiltersSignature;
    const resultsAwaitingFreshResponse =
      showResultsSurface && !initializing && !error && postings.length === 0 && !postingsResultCoverage;
    const resultStatsSource = resultStateMatchesCurrentSearch
      ? (postingsResultCoverage || buildFrontendResultCoverage({}, postings, sourceFacets, resultTotalCount))
      : null;
    const publicStatsSource = showResultsSurface ? resultStatsSource : applyPublicStatsOverride(status);
    const resultStatsLoading = resultsAwaitingFreshResponse;
    const suppressPublicStatsChips = showResultsSurface && (!resultStateMatchesCurrentSearch || suggestionsVisible);
    const publicShellStatsChips =
      resultStatsLoading || suppressPublicStatsChips || !publicStatsSource ? [] : buildPublicStatsChips(publicStatsSource);
    const resultTotalCountLabel = resultStatsSource?.job_slot_count_label || formatCompactNumberLabel(resultTotalCount);
    const showPostingsRefreshIndicator = !initializing && (loading || resultsAwaitingFreshResponse);
    const showPostingsEmptyState =
      !initializing && !loading && !error && !resultsAwaitingFreshResponse && postings.length === 0;
    const renderSearchBox = (mode = "home") => {
      const compact = mode === "results";
      const showAttachedSuggestions = suggestionsVisible && searchSuggestions.length > 0;
      const showResultsMobileSuggestions = compact && !isDesktopViewport && showAttachedSuggestions;
      const emptySearchPlaceholder = compact ? compactSearchPlaceholder : exampleSearchPlaceholder;
      const searchLength = String(search || "").trim().length;
      const searchLengthStyle =
        searchLength >= 34 ? styles.yahooSearchInputVeryLong : searchLength >= 22 ? styles.yahooSearchInputLong : null;
      const showSearchFocusedFrame = searchFocused && !(Platform.OS !== "web" && hideNativeSearchCaret);
      return (
        <View style={[styles.searchBoxRow, styles.yahooSearchBoxRow, compact ? styles.yahooSearchBoxRowResults : null]}>
          <View
            style={[
              styles.searchBoxAutocomplete,
              compact ? styles.searchBoxAutocompleteResults : null,
              showResultsMobileSuggestions ? styles.searchBoxAutocompleteResultsWithSuggestions : null
            ]}
            testID="search-box-autocomplete"
          >
            <View
              style={[
                styles.yahooSearchBoxFrame,
                compact ? styles.yahooSearchBoxFrameResults : null,
                showAttachedSuggestions ? styles.yahooSearchBoxFrameWithSuggestions : null,
                isDarkPublicTheme ? styles.yahooSearchBoxFrameDark : null,
                showSearchFocusedFrame ? styles.yahooSearchBoxFrameFocused : null,
                showSearchFocusedFrame && isDarkPublicTheme ? styles.yahooSearchBoxFrameFocusedDark : null
              ]}
              testID="search-box-frame"
            >
              {!compact ? <SearchGlyph isDark={isDarkPublicTheme} /> : null}
              <TextInput
                ref={searchInputRef}
                style={[
                  styles.search,
                  isDarkPublicTheme ? styles.searchDark : null,
                  styles.yahooSearchInput,
                  searchLengthStyle,
                  isDarkPublicTheme ? styles.yahooSearchInputDark : null
                ]}
                value={search}
                onChangeText={handleSearchChange}
                onFocus={handleSearchFocus}
                onBlur={handleSearchBlur}
                onPressIn={handleSearchPressIn}
                onSubmitEditing={() => submitSearch(search)}
                onKeyPress={handleSearchKeyPress}
                caretHidden={Platform.OS !== "web" && hideNativeSearchCaret}
                placeholder={
                  !String(search || "").trim()
                    ? emptySearchPlaceholder
                    : defaultSearchPlaceholder
                }
                placeholderTextColor={isDarkPublicTheme ? OJS_DARK_COLORS.muted : YAHOO_COLORS.muted}
                autoCapitalize="none"
                returnKeyType="search"
                numberOfLines={1}
                {...SEARCH_SUBMIT_BEHAVIOR_PROPS}
                testID="search-input"
                accessibilityLabel={t("search.label", "Search openings")}
              />
              {compact && String(search || "").trim() ? (
                <Pressable
                  onPress={clearSearchAndSuggestions}
                  style={({ pressed }) => [styles.yahooSearchIconButton, pressed ? styles.yahooSearchIconButtonPressed : null]}
                  testID="postings-search-clear"
                  accessibilityRole="button"
                  accessibilityLabel={t("search.clear", "Clear")}
                >
                  <ClearGlyph isDark={isDarkPublicTheme} />
                </Pressable>
              ) : null}
              {compact ? (
                <Pressable
                  onPress={() => submitSearch(search)}
                  style={({ pressed }) => [styles.yahooSearchSubmitButton, pressed ? styles.yahooSearchSubmitButtonPressed : null]}
                  testID="postings-search-submit"
                  accessibilityRole="button"
                  accessibilityLabel={t("results.search", "Search")}
                >
                  <SearchGlyph isDark={isDarkPublicTheme} compact />
                </Pressable>
              ) : null}
            </View>
            {showAttachedSuggestions ? (
              <Animated.View
                style={[
                  styles.searchSuggestionsPanel,
                  compact ? styles.searchSuggestionsPanelResults : null,
                  showResultsMobileSuggestions ? styles.searchSuggestionsPanelResultsMobileInFlow : null,
                  isDarkPublicTheme ? styles.searchSuggestionsPanelDark : null,
                  suggestionsMotionStyle
                ]}
                testID="search-suggestions-panel"
              >
                {searchSuggestions.map((suggestion, index) => {
                  const label = String(suggestion?.label || suggestion?.value || "").trim();
                  const hint = getSearchSuggestionTypeLabel(suggestion?.type, t);
                  const selected = index === activeSuggestionIndex;
                  return (
                    <Pressable
                      key={`${hint}-${label}-${index}`}
                      onPress={() => selectSearchSuggestion(suggestion)}
                      style={[
                        styles.searchSuggestionItem,
                        selected ? styles.searchSuggestionItemActive : null,
                        selected && isDarkPublicTheme ? styles.searchSuggestionItemActiveDark : null
                      ]}
                      testID={`search-suggestion-${index}`}
                      accessibilityRole="button"
                      accessibilityLabel={translatedPublicText(t, "dropdown.search", "Search {label}", { label })}
                    >
                      <View style={styles.searchSuggestionIconSlot}>
                        <SearchGlyph isDark={isDarkPublicTheme} compact />
                      </View>
                      <Text
                        numberOfLines={1}
                        style={[styles.searchSuggestionLabel, isDarkPublicTheme ? styles.searchSuggestionLabelDark : null]}
                      >
                        {label}
                      </Text>
                      {hint ? (
                        <Text
                          numberOfLines={1}
                          style={[styles.searchSuggestionHint, isDarkPublicTheme ? styles.searchSuggestionHintDark : null]}
                        >
                          {hint}
                        </Text>
                      ) : null}
                    </Pressable>
                  );
                })}
              </Animated.View>
            ) : null}
          </View>
        </View>
      );
    };
    const renderPublicStatsChips = () => {
      if (!showResultsSurface) return null;
      if (publicShellStatsChips.length === 0) return null;
      return (
        <View style={[styles.publicStatsChipRow, !isDesktopViewport ? styles.publicStatsChipRowMobile : null]} testID="public-stats-chips">
          {publicShellStatsChips.map((chip) => {
            const isJobSlots = chip.key === "job-slots";
            const translatedLabel = getPublicStatsChipLabel(chip, t);
            const visibleLabel = translatedLabel ? ` ${translatedLabel}` : "";
            return (
              <View
                key={chip.key}
                style={[
                  styles.publicStatsChip,
                  !isDesktopViewport ? styles.publicStatsChipMobile : null,
                  isJobSlots ? styles.resultCountText : null,
                  isJobSlots && !isDesktopViewport ? styles.resultCountTextMobile : null,
                  chip.key === "ats" ? styles.publicStatsChipAts : null,
                  chip.key === "ats" && !isDesktopViewport ? styles.publicStatsChipAtsMobile : null,
                  chip.key === "companies" ? styles.publicStatsChipCompanies : null,
                  chip.key === "companies" && !isDesktopViewport ? styles.publicStatsChipCompaniesMobile : null,
                  styles.yahooStatsChip,
                  isDarkPublicTheme ? styles.publicStatsChipDark : null
                ]}
                testID={isJobSlots ? "result-count" : `public-stat-${chip.key}`}
                accessibilityRole={isJobSlots ? undefined : "text"}
                {...(isJobSlots ? ACCESSIBILITY_STATUS_PROPS : null)}
                accessibilityLabel={`${chip.value} ${translatedLabel}`}
              >
                <Text
                  style={[
                    styles.publicStatsChipValue,
                    isJobSlots ? styles.resultCountValueText : null,
                    !isDesktopViewport ? styles.publicStatsChipValueMobile : null,
                    isDarkPublicTheme ? styles.textInkDark : null
                  ]}
                >
                  {chip.value}
                </Text>
                <Text
                  numberOfLines={1}
                  style={[
                    styles.publicStatsChipLabel,
                    isJobSlots ? styles.resultCountUnitText : null,
                    !isDesktopViewport ? styles.publicStatsChipLabelMobile : null,
                    isDarkPublicTheme ? styles.textMutedDark : null
                  ]}
                >
                  {visibleLabel}
                </Text>
              </View>
            );
          })}
        </View>
      );
    };
    const renderUtilityControls = () => (
      <View style={[styles.resultsUtilityControls, !isDesktopViewport ? styles.resultsUtilityControlsMobile : null]}>
        <ThemeToggle themeMode={publicTheme} onToggleTheme={togglePublicTheme} t={t} compact={!isDesktopViewport} />
        <LanguageSelector
          languageCode={publicLanguageCode}
          menuOpen={languageMenuOpen}
          onToggleMenu={togglePublicLanguageMenu}
          onSelectLanguage={selectPublicLanguage}
          t={t}
          compact={!isDesktopViewport}
        />
      </View>
    );
    const brandMark = (
      <Pressable
        onPress={handleBrandHome}
        style={({ pressed }) => [
          styles.brandWordmark,
          styles.yahooBrandWordmark,
          showResultsSurface ? styles.yahooBrandWordmarkResults : null,
          pressed ? styles.brandWordmarkPressed : null
        ]}
        testID="app-logo"
        accessibilityRole="link"
        accessibilityLabel="openjobslots home"
      >
        <View style={styles.brandWordmarkInner} testID="brand-wordmark">
          {publicWordmarkSegments.map((segment, index) => (
            <Text
              key={`brand-wordmark-${segment.text}-${index}`}
              style={[
                styles.brandWordmarkLetter,
                styles.yahooBrandWordmarkLetter,
                !isDesktopViewport ? styles.yahooBrandWordmarkLetterMobile : null,
                showResultsSurface ? styles.yahooBrandWordmarkLetterResults : null,
                showResultsSurface && !isDesktopViewport ? styles.yahooBrandWordmarkLetterResultsMobile : null,
                { color: segment.color }
              ]}
            >
              {segment.text}
            </Text>
          ))}
        </View>
      </Pressable>
    );
    const publicFooterMeta = (
      <View
        style={[
          styles.publicFooterMeta,
          showResultsSurface ? styles.publicFooterMetaResults : null,
          !isDesktopViewport ? styles.publicFooterMetaMobile : null,
          isDarkPublicTheme ? styles.publicFooterMetaDark : null
        ]}
        testID="public-footer-meta"
      >
        <Pressable
          onPress={openPublicReleaseNotes}
          style={({ pressed }) => [
            styles.publicVersionButton,
            styles.publicFooterVersionButton,
            isDarkPublicTheme ? styles.publicFooterVersionButtonDark : null,
            pressed ? styles.publicVersionButtonPressed : null,
            pressed && isDarkPublicTheme ? styles.publicVersionButtonPressedDark : null
          ]}
          testID="public-version-button"
          accessibilityRole="button"
          accessibilityLabel={translatedPublicText(t, "release.openA11y", "Open release notes for version {version}", {
            version: PUBLIC_APP_VERSION
          })}
        >
          <Text
            style={[styles.publicVersionLabel, isDarkPublicTheme ? styles.publicVersionLabelDark : null]}
            testID="public-version-label"
          >
            {translatedPublicText(t, "version.label", PUBLIC_VERSION_LABEL, { version: PUBLIC_APP_VERSION })}
          </Text>
        </Pressable>
        {!isPublicNativeStoreSurface ? (
          <Text
            style={[styles.searchCreditText, styles.yahooCreditText, styles.publicFooterCredit, isDarkPublicTheme ? styles.searchCreditTextDark : null]}
            testID="search-credit-text"
          >
            {t("credit.deployed", "Deployed and developed by")}{" "}
            <Text
              href={BATUHAN_WEBSITE_URL}
              hrefAttrs={{ target: "_blank", rel: "noopener noreferrer" }}
              onPress={handleOpenDeveloperCredit}
              style={[styles.searchCreditLink, isDarkPublicTheme ? styles.searchCreditLinkDark : null]}
              testID="search-credit-link"
              accessibilityRole="link"
              accessibilityLabel="Batuhan Boran website"
            >
              Batuhan Boran
            </Text>
          </Text>
        ) : null}
      </View>
    );

    return (
    <View style={[styles.postingsPageFrame, isDarkPublicTheme ? styles.postingsPageFrameDark : null]} accessibilityRole="main">
      <ScrollView
        ref={postingsListRef}
        style={[styles.postingsPageScroll, isDarkPublicTheme ? styles.postingsPageScrollDark : null]}
        contentContainerStyle={styles.postingsPageContent}
        keyboardShouldPersistTaps="handled"
        onScroll={handlePostingsScroll}
        scrollEventThrottle={250}
        testID="postings-page-scroll"
      >
      <View
        style={[styles.publicSearchLayout, isDesktopViewport ? styles.publicSearchLayoutDesktop : styles.publicSearchLayoutMobile]}
        testID="search-shell"
      >
      <View
        style={[
          styles.searchPanel,
          styles.yahooSearchPanel,
          isDesktopViewport ? styles.searchPanelDesktop : styles.searchPanelMobile,
          !isDesktopViewport && !showResultsSurface ? styles.searchPanelHomeMobile : null,
          showResultsSurface ? styles.yahooSearchPanelResults : null,
          showResultsSurface && isDesktopViewport ? styles.searchPanelSticky : null,
          isDarkPublicTheme ? styles.searchPanelDark : null
        ]}
        testID="search-panel"
      >
      <View
        style={[
          styles.yahooTopBar,
          showResultsSurface ? styles.yahooTopBarResults : null,
          !isDesktopViewport ? styles.yahooTopBarMobile : null,
          !isDesktopViewport && showResultsSurface ? styles.yahooTopBarResultsMobile : null,
          !isDesktopViewport && !showResultsSurface ? styles.yahooTopBarHomeMobile : null
        ]}
      >
        {showResultsSurface ? (
          <View style={[styles.yahooResultsSearchTop, !isDesktopViewport ? styles.yahooResultsSearchTopMobile : null]}>
            {renderSearchBox("results")}
          </View>
        ) : (
          <View style={styles.yahooBrandCluster}>
            {brandMark}
          </View>
        )}
        <View
          style={[
            styles.yahooTopActions,
            showResultsSurface ? styles.yahooTopActionsResults : null,
            !isDesktopViewport ? styles.yahooTopActionsMobile : null,
            !isDesktopViewport && showResultsSurface ? styles.yahooTopActionsResultsMobile : null,
            !isDesktopViewport && !showResultsSurface ? styles.yahooTopActionsHomeMobile : null
          ]}
        >
          {showResultsSurface && !isDesktopViewport ? (
            <>
              <View style={styles.mobileResultsHeaderBand}>
                <View style={styles.yahooResultsBrandSlotMobile}>
                  {brandMark}
                </View>
                {renderUtilityControls()}
              </View>
              <View style={styles.mobileResultsStatsBand} testID="results-metrics-row">
                {renderPublicStatsChips()}
              </View>
            </>
          ) : (
            <>
              {showResultsSurface ? (
                <View style={styles.yahooResultsBrandSlot}>
                  {brandMark}
                </View>
              ) : null}
              <View
                style={[
                  styles.resultsMetricsRow,
                  !isDesktopViewport ? styles.resultsMetricsRowMobile : null,
                  !isDesktopViewport && !showResultsSurface ? styles.resultsMetricsRowHomeMobile : null
                ]}
                testID="results-metrics-row"
              >
                {renderPublicStatsChips()}
                {renderUtilityControls()}
              </View>
            </>
          )}
        </View>
      </View>
      {!showResultsSurface ? (
      <Animated.View
        style={[
          styles.searchShell,
          styles.yahooSearchShell,
          showResultsSurface ? styles.yahooSearchShellCompact : styles.yahooSearchShellHome,
          !isDesktopViewport ? styles.yahooSearchShellMobile : null,
          !isDesktopViewport && !showResultsSurface ? styles.yahooSearchShellHomeMobile : null,
          mobileHomeSearchShellLayout,
          Platform.OS === "web" ? styles.webSmoothMotion : null
        ]}
        testID="search-controls"
      >
        <Text style={[styles.yahooHeroTitle, isDarkPublicTheme ? styles.textInkDark : null]}>
          {showResultsSurface ? t("results.title", "Open roles") : t("search.heroTitle", "Search open job slots")}
        </Text>
        <Text style={[styles.searchLead, styles.yahooSearchLead, isDarkPublicTheme ? styles.textMutedDark : null]}>
          {t("search.lead", "Find fresh openings across public ATS job boards.")}
        </Text>
        {renderSearchBox("home")}
        <View
          style={[styles.searchIntentPanel, searchIntentChips.length === 0 ? styles.searchIntentPanelEmpty : null]}
          pointerEvents={searchIntentChips.length > 0 ? "auto" : "none"}
          testID={searchIntentChips.length > 0 ? "search-intent-chips" : undefined}
        >
          {searchIntentChips.length > 0 ? (
            <>
            <Text style={styles.searchIntentLabel}>{t("search.intentDetected", "Detected intent")}</Text>
            <View style={styles.searchIntentChipsRow}>
              {searchIntentChips.map((suggestion, index) => {
                const selected = isSearchIntentActive(suggestion, postingsFilters);
                const label = String(suggestion?.label || suggestion?.value || "").trim();
                return (
                  <Pressable
                    key={`${suggestion?.intent_type || suggestion?.type || "intent"}-${suggestion?.value || label}-${index}`}
                    onPress={() => selectSearchSuggestion(suggestion)}
                    style={({ pressed }) => [
                      styles.searchIntentChip,
                      selected ? styles.searchIntentChipActive : null,
                      pressed ? styles.buttonPressed : null
                    ]}
                    testID={getSearchIntentChipTestId(suggestion)}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    accessibilityLabel={`Apply ${label} search intent`}
                  >
                    <Text
                      numberOfLines={1}
                      style={[styles.searchIntentChipText, selected ? styles.searchIntentChipTextActive : null]}
                    >
                      {label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            </>
          ) : null}
        </View>
        <View
          style={[styles.searchLowerRail, !isDesktopViewport ? styles.searchLowerRailMobile : null]}
        >
          {!suggestionsVisible ? (
            <>
              {isDesktopViewport ? (
                <Text style={[styles.searchShortcutHint, isDarkPublicTheme ? styles.textMutedDark : null]}>
                  {t("search.shortcut", "Enter to search · Esc to clear")}
                </Text>
              ) : null}
              {searchNotice ? (
                <Text style={styles.searchNotice} testID="search-notice" {...ACCESSIBILITY_STATUS_PROPS}>
                  {searchNotice}
                </Text>
              ) : null}
              {syncNotice ? (
                <Text style={styles.syncNotice} testID="sync-action-notice" {...ACCESSIBILITY_STATUS_PROPS}>
                  {syncNotice}
                </Text>
              ) : null}
              <SeoLandingLinks
                languageCode={publicLanguageCode}
                t={t}
                isDarkTheme={isDarkPublicTheme}
                popularSearchItems={popularSearchItems}
                compact={!isDesktopViewport}
                onSelectPopularSearch={selectPopularSearch}
              />
            </>
          ) : null}
        </View>
      </Animated.View>
      ) : null}

      {filtersVisible ? (
        <View
          style={[styles.postingsFiltersPanel, isDesktopViewport ? styles.postingsFiltersPanelDesktop : null]}
          testID="filters-panel"
        >
          <View style={styles.postingsFiltersPanelContent}>
            {postingFilterOptionsLoading ? (
              <Text style={[styles.small, isDarkPublicTheme ? styles.textMutedDark : null]}>{t("filters.loading", "Loading filter options...")}</Text>
            ) : (
              <>
                <View style={styles.globalFilterStatus} testID="global-filter-status">
                  <View style={styles.globalFilterStatusDot} />
                  <View style={styles.globalFilterStatusCopy}>
                    <Text style={styles.globalFilterStatusTitle}>
                      {hasLocationPostingFilters ? t("filters.global.locationTitle", "Location narrowed") : t("filters.global.title", "Global search")}
                    </Text>
                    <Text style={styles.globalFilterStatusText} numberOfLines={2}>
                      {hasLocationPostingFilters
                        ? t("filters.global.locationCopy", "Region and country filters are active.")
                        : t("filters.global.copy", "Search remains worldwide until a location filter is selected.")}
                    </Text>
                  </View>
                </View>
                <SingleSelectDropdown
                  label={t("filters.ats", "ATS")}
                  options={postingFilterOptions.ats}
                  selectedValue={postingsFilters.ats}
                  onSelectValue={setAtsFilter}
                  anyLabel={t("filters.ats.any", "All ATS")}
                />

                <MultiSelectDropdown
                  label={t("filters.industries", "Industries")}
                  options={postingFilterOptions.industries}
                  selectedValues={postingsFilters.industries}
                  onToggleValue={toggleIndustryFilter}
                  onClear={() =>
                    setPostingsFilters((prev) => ({
                      ...prev,
                      industries: []
                    }))
                  }
                  emptyText={t("filters.industries.empty", "No industries available.")}
                  helperText={t("filters.industries.helper", "Optional. Leave empty to search every indexed industry.")}
                  anyLabel={t("filters.industries.any", "Any industry")}
                  t={t}
                />

                <MultiSelectDropdown
                  label={t("filters.regions", "Regions")}
                  options={normalizedRegionOptions}
                  selectedValues={postingsFilters.regions}
                  onToggleValue={toggleRegionFilter}
                  onClear={() =>
                    setPostingsFilters((prev) => ({
                      ...prev,
                      regions: [],
                      countries: []
                    }))
                  }
                  emptyText={t("filters.regions.empty", "Worldwide search is active. Region metadata is not indexed yet.")}
                  helperText={t("filters.regions.helper", "Start broad by continent, then narrow to countries when useful.")}
                  anyLabel={t("filters.regions.any", "Worldwide")}
                  t={t}
                />

                <MultiSelectDropdown
                  label={t("filters.countries", "Countries")}
                  options={visibleCountryOptions}
                  selectedValues={postingsFilters.countries}
                  onToggleValue={toggleCountryFilter}
                  onClear={() =>
                    setPostingsFilters((prev) => ({
                      ...prev,
                      countries: []
                    }))
                  }
                  emptyText={
                    postingsFilters.regions?.length
                      ? t("filters.countries.emptyRegion", "No countries match the selected region yet. Clear Regions to search worldwide.")
                      : t("filters.countries.empty", "No countries match. Worldwide search is still active.")
                  }
                  helperText={
                    postingsFilters.regions?.length
                      ? t("filters.countries.helperRegion", "Countries are limited by the selected region.")
                      : t("filters.countries.helper", "Leave empty to include every country.")
                  }
                  anyLabel={t("filters.countries.any", "All countries")}
                  t={t}
                />

                {(postingsFilters.countries || []).length > 0 || (postingsFilters.states || []).length > 0 ? (
                  <MultiSelectDropdown
                    label={t("filters.states", "States")}
                    options={postingFilterOptions.states}
                    selectedValues={postingsFilters.states}
                    onToggleValue={toggleStateFilter}
                    onClear={() =>
                      setPostingsFilters((prev) => ({
                        ...prev,
                        states: [],
                        counties: []
                      }))
                    }
                    emptyText={t("filters.states.empty", "No states or provinces are indexed for the selected countries.")}
                    helperText={t("filters.states.helper", "Shown after country selection. Leave empty to include all states/provinces.")}
                    anyLabel={t("filters.states.any", "All states/provinces")}
                    t={t}
                  />
                ) : (
                  <Text style={styles.contextualFilterHint}>
                    {t("filters.countryHint", "Choose a country to narrow by state or province.")}
                  </Text>
                )}

                {(postingsFilters.states || []).length > 0 || (postingsFilters.counties || []).length > 0 ? (
                  <MultiSelectDropdown
                    label={t("filters.counties", "Counties")}
                    options={visibleCountyOptions}
                    selectedValues={postingsFilters.counties}
                    onToggleValue={toggleCountyFilter}
                    onClear={() =>
                      setPostingsFilters((prev) => ({
                        ...prev,
                        counties: []
                      }))
                    }
                    emptyText={t("filters.counties.empty", "No counties match selected states.")}
                    helperText={t("filters.counties.helper", "Shown after state selection for sources that include county metadata.")}
                    anyLabel={t("filters.counties.any", "All counties")}
                    t={t}
                  />
                ) : (
                  <Text style={styles.contextualFilterHint}>
                    {t("filters.stateHint", "Choose a state/province to narrow by county when county data exists.")}
                  </Text>
                )}
              </>
            )}

            <View style={styles.freshnessFilterGroup}>
              <Text style={[styles.fieldLabel, isDarkPublicTheme ? styles.textMutedDark : null]}>{t("freshness.label", "Freshness")}</Text>
              <View style={styles.filterSegmentRow}>
                {FRESHNESS_FILTER_OPTIONS.map((option) => {
                  const selected = String(postingsFilters.freshness_days || "all") === String(option.value);
                  const label = getTranslatedFreshnessLabel(option.value, publicLanguageCode, option.label);
                  return (
                    <Pressable
                      key={String(option.value)}
                      onPress={() => {
                        setSearchResultsMode(true);
                        setPostingsFilters((prev) => ({
                          ...prev,
                          freshness_days: option.value
                        }));
                      }}
                      style={({ pressed }) => [
                        styles.filterSegmentChip,
                        selected ? styles.filterSegmentChipActive : null,
                        pressed ? styles.filterSegmentChipPressed : null
                      ]}
                      testID={option.testId}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                    >
                      <Text
                        numberOfLines={1}
                        style={[styles.filterSegmentChipText, selected ? styles.filterSegmentChipTextActive : null]}
                      >
                        {label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            <View style={styles.remoteFilterGroup}>
              <Text style={[styles.fieldLabel, isDarkPublicTheme ? styles.textMutedDark : null]}>{t("remote.label", "Remote Filter")}</Text>
              <View style={styles.filterSegmentRow} testID="remote-filter-row">
                {remoteFilterOptions.map((option) => {
                  const selected = postingsFilters.remote === option.value;
                  const label = option.shortLabel || option.label;
                  return (
                    <Pressable
                      key={option.value}
                      onPress={() =>
                        {
                          setSearchResultsMode(true);
                          setPostingsFilters((prev) => ({
                            ...prev,
                            remote: option.value
                          }));
                        }
                      }
                      style={({ pressed }) => [
                        styles.filterSegmentChip,
                        selected ? styles.filterSegmentChipActive : null,
                        pressed ? styles.filterSegmentChipPressed : null
                      ]}
                      testID={`remote-filter-${option.value}`}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                      accessibilityLabel={option.label}
                    >
                      <Text
                        numberOfLines={1}
                        style={[styles.filterSegmentChipText, selected ? styles.filterSegmentChipTextActive : null]}
                      >
                        {label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              <View style={styles.remoteNoDateToggleRow}>
                <Text style={styles.remoteNoDateToggleLabel}>{t("remote.hideNoDate", "Hide postings with no date")}</Text>
                <Switch
                  value={Boolean(postingsFilters.hide_no_date)}
                  onValueChange={(value) =>
                    {
                      setSearchResultsMode(true);
                      setPostingsFilters((prev) => ({
                        ...prev,
                        hide_no_date: value
                      }));
                    }
                  }
                  testID="hide-no-date-filter"
                  accessibilityLabel="Hide postings with no date"
                />
              </View>
            </View>
            <SourceIntelligencePanel
              sources={visibleSourceSummary}
              showResultsSurface={showResultsSurface}
              selectedSource={postingsFilters.ats}
              onSelectSource={handleSelectSourceFacet}
              t={t}
              isDarkTheme={isDarkPublicTheme}
            />
          </View>
        </View>
      ) : null}

      </View>

      {showResultsSurface ? (
      <View style={[styles.resultsColumn, !isDesktopViewport ? styles.resultsColumnMobile : null]}>
      {showResultsSurface ? (
        <Animated.View
          style={[styles.resultsSurface, Platform.OS === "web" ? styles.resultsSurfaceMotion : null, resultsMotionStyle]}
          testID="results-surface"
        >
          {showPostingsRefreshIndicator ? (
            <Text style={styles.postingsRefreshIndicator} testID="postings-refresh-indicator" {...ACCESSIBILITY_STATUS_PROPS}>
              {t("results.updating", "Updating visible results...")}
            </Text>
          ) : null}
          {searchNotice ? (
            <Text style={styles.searchNotice} testID="search-notice" {...ACCESSIBILITY_STATUS_PROPS}>
              {searchNotice}
            </Text>
          ) : null}
          {applicationsNotice ? <Text style={styles.inlineNotice}>{applicationsNotice}</Text> : null}

          {initializing && postings.length === 0 ? (
            <ActivityIndicator size="large" style={styles.loader} />
          ) : (
            <View style={styles.list} testID="postings-list">
              {showPostingsEmptyState ? (
                <View style={styles.emptyState} testID="postings-empty-state">
                  <Text style={styles.emptyTitle}>{t("empty.noSlotsExact", "No slots match this exact search.")}</Text>
                  <Text style={styles.emptyText}>
                    {t("empty.tryDifferent", "Try another title, company, location, or keyword.")}
                  </Text>
                  <View style={styles.emptyActions}>
                    {hasLocationPostingFilters ? (
                      <Pressable
                        onPress={clearLocationPostingFilters}
                        style={({ pressed }) => [styles.emptyActionButton, styles.emptyActionPrimary, pressed ? styles.buttonPressed : null]}
                        testID="empty-clear-location-filters"
                        accessibilityRole="button"
                      >
                        <Text style={styles.emptyActionPrimaryText}>{t("empty.searchAllLocations", "Search all locations")}</Text>
                      </Pressable>
                    ) : null}
                    {hasRemotePostingFilter ? (
                      <Pressable
                        onPress={clearRemotePostingFilter}
                        style={({ pressed }) => [styles.emptyActionButton, pressed ? styles.buttonPressed : null]}
                        testID="empty-clear-remote-filter"
                        accessibilityRole="button"
                      >
                        <Text style={styles.emptyActionText}>{t("empty.allWorkModes", "All work modes")}</Text>
                      </Pressable>
                    ) : null}
                    {hasActivePostingFilters ? (
                      <Pressable
                        onPress={clearAllPostingFilters}
                        style={({ pressed }) => [styles.emptyActionButton, pressed ? styles.buttonPressed : null]}
                        testID="empty-clear-all-filters"
                        accessibilityRole="button"
                      >
                        <Text style={styles.emptyActionText}>{t("empty.clearFilters", "Clear filters")}</Text>
                      </Pressable>
                    ) : null}
                  </View>
                </View>
              ) : (
                postings.map((item, index) => (
                  <PostingCard
                    key={String(item?.job_posting_url || item?._row_fallback_key || `posting-${index}`)}
                    item={item}
                    onTrackApplication={handleTrackPostingApplication}
                    onIgnorePosting={handleIgnorePosting}
                    onBlockCompany={handleBlockCompany}
                    onMarkPostingVisited={markPostingVisited}
                    visitedPostingUrls={visitedPostingUrls}
                    savingApplicationIds={savingApplicationIds}
                    ignoringPostingIds={ignoringPostingIds}
                    blockedCompanyNames={blockedCompanyNames}
                    blockingCompanyNames={blockingCompanyNamesSet}
                    compact={!isDesktopViewport}
                    isDarkTheme={isDarkPublicTheme}
                    languageCode={publicLanguageCode}
                    t={t}
                  />
                ))
              )}
            </View>
          )}
          {!initializing && postings.length > 0 ? (
            <View style={styles.postingsPagingFooter} testID="postings-pagination-status" {...ACCESSIBILITY_STATUS_PROPS}>
              <Text style={styles.postingsPagingText}>
                {translatedPublicText(t, "results.showingOf", "Showing {visible} of {total} slots", {
                  visible: formatCompactNumberLabel(postings.length),
                  total: resultTotalCountLabel
                })}
              </Text>
              <View style={styles.postingsPagingStateRow}>
                {postingsLoadingMore ? <ActivityIndicator size="small" color={OJS_COLORS.green} /> : null}
                <Text style={styles.postingsPagingHint}>
                  {postingsLoadingMore
                    ? t("results.loadingMore", "Loading more slots...")
                    : postingsHasMore
                      ? t("results.scrollMore", "Scroll to load more")
                      : t("results.allLoaded", "All visible slots loaded")}
                </Text>
              </View>
            </View>
          ) : null}
        </Animated.View>
      ) : null}
      </View>
      ) : null}
      </View>
      </ScrollView>
      {!showResultsSurface ? publicFooterMeta : null}
      {showResultsSurface && showScrollTopButton ? (
        <Pressable
          onPress={scrollPostingsToTop}
          style={({ pressed }) => [
            styles.scrollTopButton,
            isDesktopViewport ? styles.scrollTopButtonDesktop : styles.scrollTopButtonMobile,
            pressed ? styles.scrollTopButtonPressed : null
          ]}
          testID="postings-scroll-top-button"
          accessibilityRole="button"
          accessibilityLabel="Back to top"
        >
          <Text style={styles.scrollTopButtonText}>Top</Text>
        </Pressable>
      ) : null}
      {renderReleaseNotesModal()}
    </View>
    );
  };

  const renderApplicationsPage = () => (
    <ScrollView contentContainerStyle={styles.settingsContent}>
      <View style={styles.settingsCard}>
        <Text style={styles.settingsTitle}>Applications</Text>
        <Text style={styles.settingsDescription}>
          Track jobs you applied to. Entries added from Postings are marked as manual applications.
        </Text>

        {applicationsNotice ? <Text style={styles.settingsNotice}>{applicationsNotice}</Text> : null}
        {applicationsLoading ? <ActivityIndicator size="small" style={styles.settingsLoader} /> : null}

        {!applicationsLoading && applications.length === 0 ? (
          <Text style={styles.empty}>No applications tracked yet.</Text>
        ) : null}

        {applications.map((application) => {
          const statusMenuOpen = openApplicationStatusForId === application.id;
          const isUpdatingStatus = Boolean(updatingApplicationIds[application.id]);
          const isDeleting = Boolean(deletingApplicationIds[application.id]);
          const appliedDate = formatApplicationDate(application?.application_date);
          const positionName = sanitizeDisplayText(application?.position_name, "Unknown position");
          const companyName = sanitizeDisplayText(application?.company_name, "Unknown company");
          const appliedByLabel = sanitizeDisplayText(application?.applied_by_label, "Manually applied by user");
          const statusLabel = sanitizeDisplayText(application?.status, "applied");

          return (
            <View key={application.id} style={styles.applicationCard}>
              <Text style={styles.position}>{positionName}</Text>
              <Text style={styles.company}>{companyName}</Text>
              <Text style={styles.posted}>Applied: {appliedDate}</Text>
              <Text style={styles.applicationAttribution}>{appliedByLabel}</Text>

              <View style={styles.applicationActionsRow}>
                <View style={styles.applicationStatusWrap}>
                  <Pressable
                    onPress={() => setOpenApplicationStatusForId((prev) => (prev === application.id ? null : application.id))}
                    disabled={isUpdatingStatus}
                    style={styles.applicationStatusBtn}
                  >
                    <Text style={styles.applicationStatusBtnText}>
                      {isUpdatingStatus ? "Updating..." : `Status: ${statusLabel}`}
                    </Text>
                  </Pressable>

                  {statusMenuOpen ? (
                    <View style={styles.applicationStatusMenu}>
                      {APPLICATION_STATUS_OPTIONS.map((status) => (
                        <Pressable
                          key={`${application.id}-${status}`}
                          onPress={() => handleUpdateApplicationStatus(application.id, status)}
                          style={[
                            styles.applicationStatusMenuItem,
                            application.status === status ? styles.applicationStatusMenuItemActive : null
                          ]}
                        >
                          <Text
                            style={[
                              styles.applicationStatusMenuItemText,
                              application.status === status ? styles.applicationStatusMenuItemTextActive : null
                            ]}
                          >
                            {status}
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                  ) : null}
                </View>

                <Pressable
                  onPress={() => handleDeleteApplication(application.id)}
                  disabled={isDeleting}
                  style={[styles.applicationDeleteBtn, isDeleting ? styles.applicationDeleteBtnDisabled : null]}
                >
                  <Text style={styles.applicationDeleteBtnText}>{isDeleting ? "Deleting..." : "Delete"}</Text>
                </Pressable>
              </View>
            </View>
          );
        })}
      </View>
    </ScrollView>
  );

  const renderApplicanteeSettingsPage = () => (
    <ScrollView contentContainerStyle={styles.settingsContent}>
      <View style={styles.settingsCard}>
        <Text style={styles.settingsTitle}>Settings</Text>
        <Text style={styles.settingsSubsection}>Applicantee information</Text>
        <Text style={styles.settingsDescription}>
          Fill out your personal information so it can be reused for applications.
        </Text>

        {settingsLoading ? (
          <ActivityIndicator size="small" style={styles.settingsLoader} />
        ) : (
          <>
            {PERSONAL_INFORMATION_FIELDS.map((field) => (
              <View key={field.key} style={styles.formGroup}>
                <Text style={styles.fieldLabel}>{field.label}</Text>
                <TextInput
                  style={[styles.textField, field.multiline ? styles.textFieldMultiline : null]}
                  value={personalInformation[field.key]}
                  onChangeText={(value) => handleChangePersonalInformation(field.key, value)}
                  placeholder={field.placeholder}
                  autoCapitalize={field.autoCapitalize || "none"}
                  keyboardType={field.keyboardType || "default"}
                  multiline={Boolean(field.multiline)}
                  numberOfLines={field.multiline ? 3 : 1}
                />
              </View>
            ))}

            {settingsNotice ? <Text style={styles.settingsNotice}>{settingsNotice}</Text> : null}

            <Pressable
              onPress={handleSaveApplicanteeInformation}
              disabled={settingsSaving}
              style={[styles.settingsSaveButton, settingsSaving ? styles.settingsSaveButtonDisabled : null]}
            >
              <Text style={styles.settingsSaveButtonText}>
                {settingsSaving ? "Saving..." : "Save Applicantee Information"}
              </Text>
            </Pressable>
          </>
        )}
      </View>
    </ScrollView>
  );

  const renderSyncSettingsPage = () => (
    <ScrollView contentContainerStyle={styles.settingsContent}>
      <View style={styles.settingsCard}>
        <Text style={styles.settingsTitle}>Settings</Text>
        <Text style={styles.settingsSubsection}>Sync Settings</Text>
        <Text style={styles.settingsDescription}>
          Configure automatic posting sync timing. Wi-Fi-only gating applies only on Android.
        </Text>

        <View style={styles.formGroup}>
          <ToggleRow
            label="Enable automatic sync"
            value={syncSettings.autoSyncEnabled}
            onValueChange={(value) =>
              setSyncSettings((prev) => ({
                ...prev,
                autoSyncEnabled: value
              }))
            }
          />
          <ToggleRow
            label="Only sync on Wi-Fi (Android only)"
            value={syncSettings.wifiOnly}
            onValueChange={(value) =>
              setSyncSettings((prev) => ({
                ...prev,
                wifiOnly: value
              }))
            }
          />
        </View>

        <View style={styles.formGroup}>
          <Text style={styles.fieldLabel}>Sync interval (seconds)</Text>
          <TextInput
            style={styles.textField}
            value={syncSettings.syncIntervalSeconds}
            onChangeText={(value) =>
              setSyncSettings((prev) => ({
                ...prev,
                syncIntervalSeconds: value.replace(/[^0-9]/g, "")
              }))
            }
            keyboardType="numeric"
            placeholder={String(DEFAULT_SYNC_INTERVAL_SECONDS)}
          />
          <Text style={styles.settingsInlineHint}>
            Default: {DEFAULT_SYNC_INTERVAL_SECONDS} ({formatSyncIntervalLabel(DEFAULT_SYNC_INTERVAL_SECONDS)}). Minimum:{" "}
            {MIN_SYNC_INTERVAL_SECONDS} seconds.
          </Text>
          {Platform.OS !== "android" ? (
            <Text style={styles.settingsInlineHint}>Wi-Fi-only sync is inactive on web and Windows.</Text>
          ) : null}
        </View>

        <View style={styles.formGroup}>
          <Text style={styles.fieldLabel}>ATS request queue concurrency</Text>
          <TextInput
            style={styles.textField}
            value={syncServiceSettings.ats_request_queue_concurrency}
            onChangeText={(value) =>
              setSyncServiceSettings((prev) => ({
                ...prev,
                ats_request_queue_concurrency: value.replace(/[^0-9]/g, "")
              }))
            }
            keyboardType="numeric"
            placeholder={String(DEFAULT_ATS_REQUEST_QUEUE_CONCURRENCY)}
          />
          {syncServiceSettingsLoading ? <ActivityIndicator size="small" style={styles.settingsLoader} /> : null}
          <Text style={styles.settingsInlineHint}>
            Range: {syncServiceSettings.min_ats_request_queue_concurrency} to{" "}
            {syncServiceSettings.max_ats_request_queue_concurrency}. Higher values can increase throughput but may cause
            more 429 responses.
          </Text>
          <Text style={styles.settingsInlineHint}>
            Runtime is currently using {syncServiceSettings.active_ats_request_queue_concurrency}. This will take effect
            next time you stop and restart the sync service.
          </Text>
        </View>

        <View style={styles.formGroup}>
          <Text style={styles.fieldLabel}>ATS included in sync</Text>
          <Text style={styles.settingsInlineHint}>
            Only selected ATS are synced. Excluded ATS stay visible in filters but are greyed out.
          </Text>
          <View style={styles.settingsInlineActionsRow}>
            <Pressable
              onPress={() =>
                setSyncServiceSettings((prev) => ({
                  ...prev,
                  sync_enabled_ats: DEFAULT_ATS_FILTER_OPTIONS.map((option) => option.value)
                }))
              }
              style={styles.settingsInlineActionBtn}
            >
              <Text style={styles.settingsInlineActionBtnText}>Enable All</Text>
            </Pressable>
          </View>
          <View style={styles.settingsCheckboxList}>
            {syncAtsOptions.map((option) => {
              const checked = (syncServiceSettings.sync_enabled_ats || []).includes(option.value);
              return (
                <Pressable
                  key={`sync-ats-${option.value}`}
                  onPress={() =>
                    setSyncServiceSettings((prev) => {
                      const current = normalizeSyncEnabledAts(prev.sync_enabled_ats);
                      if (current.includes(option.value)) {
                        if (current.length <= 1) return prev;
                        return {
                          ...prev,
                          sync_enabled_ats: current.filter((item) => item !== option.value)
                        };
                      }
                      return {
                        ...prev,
                        sync_enabled_ats: normalizeSyncEnabledAts([...current, option.value])
                      };
                    })
                  }
                  style={styles.settingsCheckboxRow}
                >
                  <Text style={styles.settingsCheckboxIcon}>{checked ? "☑" : "☐"}</Text>
                  <Text style={styles.settingsCheckboxLabel}>{option.label}</Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={styles.settingsInlineHint}>
            {syncServiceSettings.sync_enabled_ats.length} ATS currently enabled for sync.
          </Text>
        </View>

        <View style={styles.formGroup}>
          <Text style={styles.fieldLabel}>Blocked companies</Text>
          <Text style={styles.settingsInlineHint}>
            Blocked companies are hidden from Postings and excluded from sync collection.
          </Text>
          {blockedCompaniesLoading ? <ActivityIndicator size="small" style={styles.settingsLoader} /> : null}
          {!blockedCompaniesLoading && blockedCompanies.length === 0 ? (
            <Text style={styles.settingsInlineHint}>No blocked companies.</Text>
          ) : null}
          {blockedCompanies.map((company) => {
            const companyName = String(company?.company_name || company?.normalized_company_name || "").trim();
            const normalizedCompanyName = normalizeCompanyName(companyName);
            const isUnblocking = Boolean(unblockingCompanyNames[normalizedCompanyName]);
            return (
              <View key={`blocked-${normalizedCompanyName}`} style={styles.blockedCompanyRow}>
                <Text style={styles.blockedCompanyName}>{companyName || "Unknown company"}</Text>
                <Pressable
                  onPress={() => handleUnblockCompany(companyName)}
                  disabled={isUnblocking}
                  style={[styles.blockedCompanyUnblockBtn, isUnblocking ? styles.blockedCompanyUnblockBtnDisabled : null]}
                >
                  <Text style={styles.blockedCompanyUnblockBtnText}>{isUnblocking ? "Unblocking..." : "Unblock"}</Text>
                </Pressable>
              </View>
            );
          })}
        </View>

        <View style={styles.formGroup}>
          <Text style={styles.fieldLabel}>Migration tools</Text>
          <Text style={styles.settingsInlineHint}>
            Migration is intentionally separated into a modal to avoid accidental taps while saving sync settings.
          </Text>
          <Pressable
            onPress={() => setMigrationModalOpen(true)}
            style={styles.settingsSecondaryButton}
          >
            <Text style={styles.settingsSecondaryButtonText}>Open Migration Tools</Text>
          </Pressable>
        </View>

        {syncSettingsNotice ? <Text style={styles.settingsNotice}>{syncSettingsNotice}</Text> : null}

        <Pressable
          onPress={handleSaveSyncSettings}
          disabled={syncServiceSettingsSaving}
          style={[styles.settingsSaveButton, syncServiceSettingsSaving ? styles.settingsSaveButtonDisabled : null]}
        >
          <Text style={styles.settingsSaveButtonText}>{syncServiceSettingsSaving ? "Saving..." : "Save Sync Settings"}</Text>
        </Pressable>
      </View>

      <Modal
        animationType="fade"
        transparent
        visible={migrationModalOpen}
        onRequestClose={() => {
          if (migrationRunning) return;
          setMigrationModalOpen(false);
        }}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalBackdrop} pointerEvents={Platform.OS === "web" ? undefined : "none"} />
          <View style={styles.modalCard}>
            <View style={styles.modalCloseRow} pointerEvents={Platform.OS === "web" ? undefined : "box-none"}>
              <Pressable
                onPress={() => {
                  if (migrationRunning) return;
                  setMigrationModalOpen(false);
                }}
                disabled={migrationRunning}
                style={({ pressed }) => [
                  styles.modalCloseButton,
                  pressed ? styles.buttonPressed : null,
                  migrationRunning ? styles.settingsSaveButtonDisabled : null
                ]}
                accessibilityRole="button"
                accessibilityState={{ disabled: migrationRunning }}
                hitSlop={10}
              >
                <Text style={styles.modalCloseButtonText}>Close</Text>
              </Pressable>
            </View>
            <View style={styles.modalHeaderRow}>
              <Text style={styles.modalTitle}>Migrate Settings And Applications</Text>
            </View>
            <Text style={styles.settingsInlineHint}>
              Imports selected data from another SQLite database file. The Companies table is never modified.
            </Text>

            <ScrollView
              style={styles.modalBodyScroll}
              contentContainerStyle={styles.modalBodyContent}
              keyboardShouldPersistTaps="handled"
            >
              <View style={styles.settingsCheckboxList}>
                {[
                  { key: "personal_information", label: "Personal Information" },
                  { key: "mcp_settings", label: "AI/MCP Settings" },
                  { key: "blocked_companies", label: "Blocked Companies" },
                  {
                    key: "applications",
                    label: "Applications (includes application_attribution and posting_application_state)"
                  }
                ].map((option) => {
                  const checked = Boolean(migrationSelection[option.key]);
                  return (
                    <Pressable
                      key={`migration-${option.key}`}
                      onPress={() =>
                        setMigrationSelection((prev) => ({
                          ...prev,
                          [option.key]: !checked
                        }))
                      }
                      style={styles.settingsCheckboxRow}
                    >
                      <Text style={styles.settingsCheckboxIcon}>{checked ? "☑" : "☐"}</Text>
                      <Text style={styles.settingsCheckboxLabel}>{option.label}</Text>
                    </Pressable>
                  );
                })}
              </View>

              <TextInput
                style={styles.textField}
                value={migrationSourceDbPath}
                onChangeText={setMigrationSourceDbPath}
                placeholder="C:\\path\\to\\jobs.db"
                autoCapitalize="none"
                autoCorrect={false}
              />

              {migrationNotice ? <Text style={styles.settingsNotice}>{migrationNotice}</Text> : null}

              <Pressable
                onPress={handleMigrateFromDatabase}
                disabled={migrationRunning}
                style={[styles.settingsSaveButton, migrationRunning ? styles.settingsSaveButtonDisabled : null]}
              >
                <Text style={styles.settingsSaveButtonText}>
                  {migrationRunning ? "Migrating..." : "Migrate From Database"}
                </Text>
              </Pressable>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );

  const renderMcpSettingsPage = () => (
    <ScrollView contentContainerStyle={styles.settingsContent}>
      <View style={styles.settingsCard}>
        <Text style={styles.settingsTitle}>Settings</Text>
        <Text style={styles.settingsSubsection}>MCP Settings</Text>
        <Text style={styles.settingsDescription}>
          Configure agent behavior, preferences, and a dedicated agent login email/password used for account creation and MFA.
        </Text>

        {mcpSettingsLoading ? <ActivityIndicator size="small" style={styles.settingsLoader} /> : null}

        <View style={styles.formGroup}>
          <ToggleRow
            label="Enable MCP application agent"
            value={mcpSettings.enabled}
            onValueChange={(value) =>
              setMcpSettings((prev) => ({
                ...prev,
                enabled: value
              }))
            }
          />
          <ToggleRow
            label="Dry run only (do not submit)"
            value={mcpSettings.dry_run_only}
            onValueChange={(value) =>
              setMcpSettings((prev) => ({
                ...prev,
                dry_run_only: value
              }))
            }
          />
          <ToggleRow
            label="Require final user approval"
            value={mcpSettings.require_final_approval}
            onValueChange={(value) =>
              setMcpSettings((prev) => ({
                ...prev,
                require_final_approval: value
              }))
            }
          />
        </View>

        <View style={styles.formGroup}>
          <Text style={styles.fieldLabel}>Preferred agent label</Text>
          <TextInput
            style={styles.textField}
            value={mcpSettings.preferred_agent_name}
            onChangeText={(value) =>
              setMcpSettings((prev) => ({
                ...prev,
                preferred_agent_name: value
              }))
            }
            placeholder="Codex, Claude, or openjobslots Agent"
          />
        </View>

        <View style={styles.formGroup}>
          <Text style={styles.fieldLabel}>Agent login email</Text>
          <TextInput
            style={styles.textField}
            value={mcpSettings.agent_login_email}
            onChangeText={(value) =>
              setMcpSettings((prev) => ({
                ...prev,
                agent_login_email: value,
                mfa_login_email: value
              }))
            }
            placeholder="agent-login@example.com"
            keyboardType="email-address"
            autoCapitalize="none"
          />
        </View>

        <View style={styles.formGroup}>
          <Text style={styles.fieldLabel}>Agent login password</Text>
          <TextInput
            style={styles.textField}
            value={mcpSettings.agent_login_password}
            onChangeText={(value) =>
              setMcpSettings((prev) => ({
                ...prev,
                agent_login_password: value
              }))
            }
            placeholder="Enter agent inbox password"
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
          />
        </View>

        <View style={styles.formGroup}>
          <Text style={styles.fieldLabel}>MFA/login notes</Text>
          <TextInput
            style={[styles.textField, styles.textFieldMultiline]}
            value={mcpSettings.mfa_login_notes}
            onChangeText={(value) =>
              setMcpSettings((prev) => ({
                ...prev,
                mfa_login_notes: value
              }))
            }
            multiline
            numberOfLines={3}
            placeholder="Example: use auth app first, fallback to backup email"
          />
        </View>

        <View style={styles.formGroup}>
          <Text style={styles.fieldLabel}>Max applications per run</Text>
          <TextInput
            style={styles.textField}
            value={mcpSettings.max_applications_per_run}
            onChangeText={(value) =>
              setMcpSettings((prev) => ({
                ...prev,
                max_applications_per_run: value
              }))
            }
            keyboardType="numeric"
            placeholder="10"
          />
        </View>

        <View style={styles.formGroup}>
          <Text style={styles.fieldLabel}>Preferred search text</Text>
          <TextInput
            style={styles.textField}
            value={mcpSettings.preferred_search}
            onChangeText={(value) =>
              setMcpSettings((prev) => ({
                ...prev,
                preferred_search: value
              }))
            }
            placeholder="software engineer"
            autoCapitalize="none"
          />
        </View>

        <View style={styles.formGroup}>
          <Text style={styles.fieldLabel}>Preferred remote filter</Text>
          <View style={styles.remoteFilterChipsRow}>
            {remoteFilterOptions.map((option) => {
              const selected = mcpSettings.preferred_remote === option.value;
              return (
                <Pressable
                  key={`mcp-${option.value}`}
                  onPress={() =>
                    setMcpSettings((prev) => ({
                      ...prev,
                      preferred_remote: option.value
                    }))
                  }
                  style={({ pressed }) => [
                    styles.remoteFilterChip,
                    selected ? styles.remoteFilterChipActive : null,
                    pressed ? styles.buttonPressed : null
                  ]}
                >
                  <Text style={[styles.remoteFilterChipText, selected ? styles.remoteFilterChipTextActive : null]}>
                    {option.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={styles.formGroup}>
          <MultiSelectDropdown
            label="Preferred Industries"
            options={postingFilterOptions.industries}
            selectedValues={mcpSettings.preferred_industries}
            onToggleValue={toggleMcpIndustryPreference}
            onClear={() =>
              setMcpSettings((prev) => ({
                ...prev,
                preferred_industries: []
              }))
            }
            emptyText="No industries available."
          />

          <MultiSelectDropdown
            label="Preferred Regions"
            options={normalizedRegionOptions}
            selectedValues={mcpSettings.preferred_regions}
            onToggleValue={toggleMcpRegionPreference}
            onClear={() =>
              setMcpSettings((prev) => ({
                ...prev,
                preferred_regions: [],
                preferred_countries: []
              }))
            }
            emptyText="No regions available."
          />

          <MultiSelectDropdown
            label="Preferred Countries"
            options={visibleMcpCountryOptions}
            selectedValues={mcpSettings.preferred_countries}
            onToggleValue={toggleMcpCountryPreference}
            onClear={() =>
              setMcpSettings((prev) => ({
                ...prev,
                preferred_countries: []
              }))
            }
            emptyText="No countries match selected regions."
          />

          <MultiSelectDropdown
            label="Preferred States"
            options={postingFilterOptions.states}
            selectedValues={mcpSettings.preferred_states}
            onToggleValue={toggleMcpStatePreference}
            onClear={() =>
              setMcpSettings((prev) => ({
                ...prev,
                preferred_states: [],
                preferred_counties: []
              }))
            }
            emptyText="No states available."
          />

          <MultiSelectDropdown
            label="Preferred Counties"
            options={visibleMcpCountyOptions}
            selectedValues={mcpSettings.preferred_counties}
            onToggleValue={toggleMcpCountyPreference}
            onClear={() =>
              setMcpSettings((prev) => ({
                ...prev,
                preferred_counties: []
              }))
            }
            emptyText="No counties match selected states."
          />
        </View>

        <View style={styles.formGroup}>
          <Text style={styles.fieldLabel}>Agent instructions</Text>
          <TextInput
            style={[styles.textField, styles.textFieldMultiline]}
            value={mcpSettings.instructions_for_agent}
            onChangeText={(value) =>
              setMcpSettings((prev) => ({
                ...prev,
                instructions_for_agent: value
              }))
            }
            multiline
            numberOfLines={4}
            placeholder="Example: prioritize mid-size companies and skip relocation-only roles."
          />
        </View>

        {mcpSettingsNotice ? <Text style={styles.settingsNotice}>{mcpSettingsNotice}</Text> : null}

        <Pressable
          onPress={handleSaveMcpSettings}
          disabled={mcpSettingsSaving}
          style={[styles.settingsSaveButton, mcpSettingsSaving ? styles.settingsSaveButtonDisabled : null]}
        >
          <Text style={styles.settingsSaveButtonText}>{mcpSettingsSaving ? "Saving..." : "Save MCP Settings"}</Text>
        </Pressable>
      </View>
    </ScrollView>
  );

  const renderActivePage = () => {
    if (isPublicNativeStoreSurface) return renderPostingsPage();
    if (activePage === PAGE_KEYS.APPLICATIONS) return renderApplicationsPage();
    if (activePage === PAGE_KEYS.SETTINGS_APPLICANTEE) return renderApplicanteeSettingsPage();
    if (activePage === PAGE_KEYS.SETTINGS_SYNC) return renderSyncSettingsPage();
    if (activePage === PAGE_KEYS.SETTINGS_MCP) return renderMcpSettingsPage();
    return renderPostingsPage();
  };

  const renderHeaderNav = () => {
    if (isPublicNativeStoreSurface) {
      return null;
    }
    if (activePage === PAGE_KEYS.POSTINGS) {
      return null;
    }
    return (
      <View style={styles.headerNav} testID="top-nav" accessibilityRole="navigation">
        <HeaderNavButton
          label="Search"
          selected={activePage === PAGE_KEYS.POSTINGS}
          onPress={handleBrandHome}
        />
        <HeaderNavButton
          label="Applications"
          selected={activePage === PAGE_KEYS.APPLICATIONS}
          onPress={handleOpenApplicationsPage}
        />
        <HeaderNavButton
          label="Profile"
          selected={activePage === PAGE_KEYS.SETTINGS_APPLICANTEE}
          onPress={() => navigateToPage(PAGE_KEYS.SETTINGS_APPLICANTEE)}
        />
        <HeaderNavButton
          label="Sync"
          selected={activePage === PAGE_KEYS.SETTINGS_SYNC}
          onPress={() => navigateToPage(PAGE_KEYS.SETTINGS_SYNC)}
        />
        <HeaderNavButton
          label="MCP"
          selected={activePage === PAGE_KEYS.SETTINGS_MCP}
          onPress={() => navigateToPage(PAGE_KEYS.SETTINGS_MCP)}
        />
      </View>
    );
  };

  return (
    <SafeAreaView
      style={[
        styles.container,
        activePage === PAGE_KEYS.POSTINGS ? styles.containerPublic : null,
        activePage === PAGE_KEYS.POSTINGS && isDarkPublicTheme ? styles.containerPublicDark : null
      ]}
    >
      {activePage !== PAGE_KEYS.POSTINGS ? (
      <View style={styles.header} accessibilityRole="banner">
        <View style={styles.headerTopRow}>
          <Pressable
            onPress={handleBrandHome}
            style={({ pressed }) => [styles.headerLogoContainer, pressed ? styles.buttonPressed : null]}
            accessibilityRole="link"
            accessibilityLabel="openjobslots home"
          >
            <View style={styles.headerWordmark}>
              {WORDMARK_SEGMENTS.map((segment, index) => (
                <Text
                  key={`header-wordmark-${segment.text}-${index}`}
                  style={[styles.headerWordmarkLetter, { color: segment.color }]}
                >
                  {segment.text}
                </Text>
              ))}
            </View>
          </Pressable>
          {renderHeaderNav()}
        </View>
        <Text style={styles.pageTitle}>{pageTitle}</Text>
      </View>
      ) : null}

      {error ? (
        <Text style={styles.error} testID="app-error-message" accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
      {renderActivePage()}

      {drawerOpen && !isPublicNativeStoreSurface && activePage !== PAGE_KEYS.POSTINGS ? (
        <View style={styles.drawerOverlay}>
          <Pressable style={styles.drawerBackdrop} onPress={() => setDrawerOpen(false)} />
          <View style={styles.drawerPanel}>
            <Text style={styles.drawerHeading}>Navigation</Text>
            <DrawerItem
              label="Job slots"
              selected={activePage === PAGE_KEYS.POSTINGS}
              onPress={() => navigateToPage(PAGE_KEYS.POSTINGS)}
            />
            <DrawerItem
              label="Applications"
              selected={activePage === PAGE_KEYS.APPLICATIONS}
              onPress={handleOpenApplicationsPage}
            />

            <Text style={styles.drawerHeading}>Settings</Text>
            <DrawerItem
              label="Applicantee Information"
              selected={activePage === PAGE_KEYS.SETTINGS_APPLICANTEE}
              onPress={() => navigateToPage(PAGE_KEYS.SETTINGS_APPLICANTEE)}
            />
            <DrawerItem
              label="Sync Settings"
              selected={activePage === PAGE_KEYS.SETTINGS_SYNC}
              onPress={() => navigateToPage(PAGE_KEYS.SETTINGS_SYNC)}
            />
            <DrawerItem
              label="MCP Settings"
              selected={activePage === PAGE_KEYS.SETTINGS_MCP}
              onPress={() => navigateToPage(PAGE_KEYS.SETTINGS_MCP)}
            />
          </View>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: OJS_COLORS.bg,
    fontFamily: OJS_FONT_STACK
  },
  containerPublic: {
    backgroundColor: YAHOO_COLORS.surface,
    fontFamily: YAHOO_FONT_STACK
  },
  containerPublicDark: {
    backgroundColor: OJS_DARK_COLORS.bg
  },
  header: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 6,
    backgroundColor: OJS_COLORS.bg
  },
  headerPublicDark: {
    backgroundColor: OJS_DARK_COLORS.bg
  },
  headerCompact: {
    paddingBottom: 0,
    paddingTop: 8
  },
  headerTopRow: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    rowGap: 6
  },
  headerPublicSpacer: {
    flex: 1,
    minWidth: 1
  },
  headerNav: {
    marginLeft: "auto",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    flexWrap: "wrap",
    maxWidth: "100%"
  },
  headerNavButton: {
    borderRadius: 16,
    marginLeft: 6,
    marginBottom: 6,
    paddingHorizontal: 10,
    paddingVertical: 7,
    minHeight: 32,
    flexShrink: 0,
    alignSelf: "flex-start",
    justifyContent: "center",
    alignItems: "center",
    overflow: "hidden"
  },
  headerNavButtonActive: {
    backgroundColor: OJS_COLORS.pressed
  },
  headerNavButtonText: {
    color: OJS_COLORS.muted,
    fontSize: 12,
    fontWeight: "600"
  },
  headerNavButtonTextActive: {
    color: OJS_COLORS.blue
  },
  headerTextContainer: {
    alignItems: "flex-start",
    marginTop: 6
  },
  headerLogoContainer: {
    marginLeft: "auto",
    flexShrink: 0,
    alignItems: "flex-end"
  },
  headerWordmark: {
    flexDirection: "row",
    alignItems: "baseline"
  },
  headerWordmarkLetter: {
    fontSize: 22,
    lineHeight: 26,
    fontWeight: "800",
    letterSpacing: 0
  },
  headerWordmarkOpen: {
    fontSize: 22,
    lineHeight: 26,
    fontWeight: "800",
    color: OJS_COLORS.blue
  },
  headerWordmarkSlots: {
    fontSize: 22,
    lineHeight: 26,
    fontWeight: "800",
    color: OJS_COLORS.ink
  },
  headerLogo: {
    width: 220,
    height: 52,
    marginTop: 2,
    alignSelf: "flex-end"
  },
  hamburgerButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: OJS_COLORS.softBorder,
    backgroundColor: OJS_COLORS.surface,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 10,
    marginTop: 2
  },
  hamburgerIcon: {
    fontSize: 20,
    fontWeight: "700",
    color: OJS_COLORS.ink
  },
  title: {
    fontSize: 22,
    fontWeight: "700",
    color: OJS_COLORS.ink
  },
  subtitle: {
    fontSize: 14,
    color: OJS_COLORS.muted,
    marginTop: 4
  },
  pageTitle: {
    marginTop: 10,
    fontSize: 13,
    color: OJS_COLORS.text,
    fontWeight: "600"
  },
  small: {
    fontSize: 11,
    color: OJS_COLORS.muted,
    marginTop: 2
  },
  textMutedDark: {
    color: OJS_DARK_COLORS.muted
  },
  textInkDark: {
    color: OJS_DARK_COLORS.ink
  },
  postingsPageScroll: {
    flex: 1,
    backgroundColor: YAHOO_COLORS.surface,
    fontFamily: YAHOO_FONT_STACK,
    ...(Platform.OS === "web"
      ? {
          scrollbarColor: `${YAHOO_COLORS.borderStrong} ${YAHOO_COLORS.surface}`,
          scrollbarWidth: "thin"
        }
      : {})
  },
  postingsPageScrollDark: {
    backgroundColor: OJS_DARK_COLORS.bg,
    ...(Platform.OS === "web"
      ? {
          scrollbarColor: `${OJS_DARK_COLORS.border} ${OJS_DARK_COLORS.bg}`
        }
      : {})
  },
  postingsPageFrame: {
    flex: 1,
    position: "relative",
    backgroundColor: YAHOO_COLORS.surface,
    fontFamily: YAHOO_FONT_STACK
  },
  postingsPageFrameDark: {
    backgroundColor: OJS_DARK_COLORS.bg
  },
  postingsPageContent: {
    paddingHorizontal: 0,
    paddingTop: 0,
    paddingBottom: Platform.OS === "web" ? 96 : 116
  },
  webSmoothMotion: {
    transitionProperty: "min-height, padding, margin, transform, opacity",
    transitionDuration: "300ms",
    transitionTimingFunction: "cubic-bezier(0.2, 0, 0, 1)"
  },
  searchShell: {
    position: "relative",
    width: "100%",
    alignItems: "stretch"
  },
  publicSearchLayout: {
    width: "100%",
    maxWidth: "100%",
    alignSelf: "center",
    gap: 0
  },
  publicSearchLayoutDesktop: {
    flexDirection: "column",
    alignItems: "stretch"
  },
  publicSearchLayoutMobile: {
    flexDirection: "column"
  },
  searchPanel: {
    borderWidth: 1,
    borderColor: OJS_COLORS.softBorder,
    borderRadius: 12,
    backgroundColor: OJS_COLORS.surface,
    padding: 14,
    zIndex: 5,
    fontFamily: OJS_FONT_STACK,
    ...(Platform.OS === "web"
      ? { boxShadow: "0 8px 24px rgba(38, 51, 45, 0.08)" }
      : {
          shadowColor: OJS_COLORS.shadow,
          shadowOpacity: 0.08,
          shadowRadius: 18,
          shadowOffset: { width: 0, height: 8 }
        })
  },
  yahooSearchPanel: {
    borderWidth: 0,
    borderRadius: 0,
    backgroundColor: YAHOO_COLORS.surface,
    paddingHorizontal: 48,
    paddingTop: 32,
    paddingBottom: 44,
    fontFamily: YAHOO_FONT_STACK,
    ...(Platform.OS === "web"
      ? {
          boxShadow: "none",
          minHeight: "100svh"
        }
      : {})
  },
  yahooSearchPanelResults: {
    ...(Platform.OS === "web" ? { minHeight: "auto" } : {}),
    ...(ANDROID_STATUS_BAR_OFFSET > 0 ? { paddingTop: ANDROID_STATUS_BAR_OFFSET + 12 } : {}),
    paddingBottom: 14
  },
  searchPanelDark: {
    borderColor: OJS_DARK_COLORS.softBorder,
    backgroundColor: OJS_DARK_COLORS.bg,
    ...(Platform.OS === "web" ? { boxShadow: "0 12px 28px rgba(0, 0, 0, 0.34)" } : {})
  },
  searchPanelDesktop: {
    width: "100%",
    flexShrink: 1,
    ...(Platform.OS === "web"
      ? {
          minHeight: "100svh",
          overflow: "visible"
        }
      : {})
  },
  searchPanelMobile: {
    width: "100%",
    paddingHorizontal: 18,
    paddingTop: 20,
    paddingBottom: 32
  },
  searchPanelHomeMobile: {
    paddingTop: Platform.OS === "web" ? "max(24px, calc(env(safe-area-inset-top) + 16px))" : ANDROID_STATUS_BAR_OFFSET + 16,
    paddingBottom: Platform.OS === "web" ? 24 : 88
  },
  searchPanelSticky: {
    ...(Platform.OS === "web"
      ? {
          position: "sticky",
          top: 0,
          alignSelf: "stretch"
        }
      : {})
  },
  yahooTopBar: {
    width: "100%",
    maxWidth: 1200,
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 24,
    zIndex: 80
  },
  yahooTopBarResults: {
    maxWidth: "100%",
    paddingHorizontal: 84,
    paddingTop: 0,
    paddingBottom: 18,
    borderBottomWidth: 1,
    borderBottomColor: YAHOO_COLORS.border,
    alignItems: "center",
    justifyContent: "space-between"
  },
  yahooTopBarMobile: {
    flexDirection: "column",
    alignItems: "stretch",
    gap: 16,
    paddingHorizontal: 0
  },
  yahooTopBarHomeMobile: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10
  },
  yahooTopBarResultsMobile: {
    flexDirection: "column",
    alignItems: "stretch",
    gap: 10
  },
  yahooBrandCluster: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "flex-start",
    flexWrap: "wrap",
    gap: 14
  },
  yahooMetaLinks: {
    flexShrink: 1,
    minWidth: 180,
    paddingTop: 5,
    color: YAHOO_COLORS.ink,
    gap: 4
  },
  yahooMetaLinksDark: {
    color: OJS_DARK_COLORS.muted
  },
  yahooTopActions: {
    flexShrink: 0,
    maxWidth: "58%",
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "flex-end",
    gap: 12,
    flexWrap: "wrap",
    zIndex: 85
  },
  yahooTopActionsResults: {
    maxWidth: "none",
    alignItems: "center",
    flexWrap: "nowrap",
    flexShrink: 0
  },
  yahooTopActionsMobile: {
    width: "100%",
    maxWidth: "100%",
    justifyContent: "flex-start",
    alignItems: "flex-start",
    flexWrap: "wrap",
    gap: 8
  },
  yahooTopActionsHomeMobile: {
    width: "auto",
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "flex-end",
    flexWrap: "nowrap",
    gap: 0
  },
  yahooTopActionsResultsMobile: {
    width: "100%",
    flexDirection: "column",
    alignItems: "stretch",
    justifyContent: "flex-start",
    flexWrap: "nowrap",
    gap: 7
  },
  yahooResultsBrandSlot: {
    flexShrink: 0
  },
  yahooResultsBrandSlotMobile: {
    flex: 1,
    minWidth: 0,
    width: "auto"
  },
  yahooResultsSearchTop: {
    flexGrow: 0,
    flexShrink: 1,
    flexBasis: 560,
    minWidth: 380,
    maxWidth: 560,
    alignItems: "flex-start"
  },
  yahooResultsSearchTopMobile: {
    width: "100%",
    minWidth: 0,
    maxWidth: "100%",
    flexBasis: "auto"
  },
  yahooBrandWordmark: {
    paddingHorizontal: 0,
    paddingVertical: 0,
    borderRadius: 0
  },
  yahooBrandWordmarkResults: {
    paddingHorizontal: 0,
    flexShrink: 0
  },
  yahooBrandWordmarkLetter: {
    color: YAHOO_COLORS.purple,
    fontFamily: YAHOO_FONT_STACK,
    fontSize: 40,
    lineHeight: 48,
    fontWeight: "700",
    letterSpacing: 0
  },
  yahooBrandWordmarkLetterMobile: {
    fontSize: 31,
    lineHeight: 38
  },
  yahooBrandWordmarkLetterResults: {
    fontSize: 28,
    lineHeight: 34
  },
  yahooBrandWordmarkLetterResultsMobile: {
    fontSize: 25,
    lineHeight: 30
  },
  yahooCreditText: {
    maxWidth: 260,
    textAlign: "left",
    color: YAHOO_COLORS.ink,
    fontFamily: YAHOO_FONT_STACK,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: "400"
  },
  publicFooterMeta: {
    position: Platform.OS === "web" ? "fixed" : "absolute",
    left: 48,
    right: 48,
    bottom: 24,
    zIndex: 70,
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    gap: 16
  },
  publicFooterMetaResults: {
    bottom: 18
  },
  publicFooterMetaMobile: {
    position: Platform.OS === "web" ? "fixed" : "absolute",
    left: Platform.OS === "web" ? 14 : 18,
    right: Platform.OS === "web" ? 14 : 18,
    bottom: Platform.OS === "web" ? 16 : 84,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    marginTop: 0,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: "rgba(100, 79, 240, 0.14)",
    borderRadius: 16,
    backgroundColor: "rgba(255, 255, 255, 0.94)",
    ...(Platform.OS === "web"
      ? {
          backdropFilter: "blur(12px)",
          boxShadow: "0 8px 20px rgba(35, 42, 49, 0.08)"
        }
      : {})
  },
  publicFooterMetaDark: {
    color: OJS_DARK_COLORS.muted,
    borderColor: "rgba(216, 204, 255, 0.2)",
    backgroundColor: "rgba(24, 21, 31, 0.94)",
    ...(Platform.OS === "web" ? { boxShadow: "0 8px 24px rgba(0, 0, 0, 0.32)" } : {})
  },
  publicFooterVersionButton: {
    alignSelf: "flex-start",
    maxWidth: "100%",
    borderWidth: 1,
    borderColor: "rgba(100, 79, 240, 0.14)",
    backgroundColor: "rgba(100, 79, 240, 0.08)",
    paddingHorizontal: 9,
    paddingVertical: 5
  },
  publicFooterVersionButtonDark: {
    borderColor: "rgba(216, 204, 255, 0.24)",
    backgroundColor: "rgba(183, 158, 255, 0.14)"
  },
  publicFooterCredit: {
    maxWidth: 360,
    textAlign: "right"
  },
  yahooSearchShell: {
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12
  },
  yahooSearchShellHome: {
    minHeight: Platform.OS === "web" ? "calc(100svh - 190px)" : 520,
    paddingTop: 64,
    paddingBottom: 80
  },
  yahooSearchShellMobile: {
    minHeight: Platform.OS === "web" ? "min(360px, calc(100svh - 220px))" : 260,
    paddingTop: 18,
    paddingBottom: 22
  },
  yahooSearchShellHomeMobile: {
    minHeight: Platform.OS === "web" ? "max(500px, calc(100svh - 178px))" : 520,
    paddingTop: 34,
    paddingBottom: Platform.OS === "web" ? 112 : 116,
    justifyContent: "center"
  },
  yahooSearchShellCompact: {
    minHeight: Platform.OS === "web" ? 170 : 160,
    paddingTop: 34,
    paddingBottom: 24
  },
  yahooHeroTitle: {
    color: YAHOO_COLORS.ink,
    fontFamily: YAHOO_FONT_STACK,
    fontSize: 40,
    lineHeight: 48,
    fontWeight: "400",
    textAlign: "center",
    letterSpacing: 0
  },
  yahooSearchLead: {
    maxWidth: 760,
    marginTop: 10,
    marginBottom: 22,
    color: YAHOO_COLORS.ink,
    fontFamily: YAHOO_FONT_STACK,
    fontSize: 14,
    lineHeight: 21,
    textAlign: "center"
  },
  yahooSearchBoxRow: {
    alignItems: "center",
    justifyContent: "center",
    overflow: "visible"
  },
  yahooSearchBoxRowResults: {
    width: "100%",
    alignItems: "flex-start",
    justifyContent: "flex-start"
  },
  searchBoxAutocomplete: {
    position: "relative",
    width: 614,
    maxWidth: "100%",
    height: 52,
    alignSelf: "center",
    overflow: "visible",
    zIndex: 24
  },
  searchBoxAutocompleteResults: {
    width: "100%",
    maxWidth: 640,
    height: 46,
    alignSelf: "flex-start",
    zIndex: 24
  },
  searchBoxAutocompleteResultsWithSuggestions: {
    height: "auto",
    minHeight: 46,
    zIndex: 120,
    elevation: 14
  },
  yahooSearchBoxFrame: {
    width: 614,
    maxWidth: "100%",
    height: 52,
    borderWidth: 1,
    borderColor: YAHOO_COLORS.border,
    borderRadius: 28,
    backgroundColor: YAHOO_COLORS.surface,
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: 18,
    paddingRight: 18,
    overflow: "visible",
    ...(Platform.OS === "web"
      ? {
          boxShadow: "0 2px 8px rgba(35, 42, 49, 0.16)",
          transitionProperty: "box-shadow, border-color, background-color",
          transitionDuration: "180ms",
          transitionTimingFunction: "cubic-bezier(0.2, 0, 0, 1)"
        }
      : {})
  },
  yahooSearchBoxFrameWithSuggestions: {
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0
  },
  yahooSearchBoxFrameResults: {
    width: "100%",
    maxWidth: 640,
    height: 46,
    borderRadius: 24,
    paddingLeft: 18,
    paddingRight: 6,
    ...(Platform.OS === "web" ? { boxShadow: "none" } : {})
  },
  yahooSearchBoxFrameDark: {
    borderColor: "#3F3858",
    backgroundColor: "#18151F",
    ...(Platform.OS === "web" ? { boxShadow: "0 2px 10px rgba(0, 0, 0, 0.32)" } : {})
  },
  yahooSearchBoxFrameFocused: {
    borderColor: YAHOO_COLORS.focusRing,
    ...(Platform.OS === "web" ? { boxShadow: "0 2px 12px rgba(35, 42, 49, 0.18), 0 0 0 3px rgba(74, 116, 255, 0.14)" } : {})
  },
  yahooSearchBoxFrameFocusedDark: {
    borderColor: "#8EA0FF",
    ...(Platform.OS === "web" ? { boxShadow: "0 2px 12px rgba(0, 0, 0, 0.36), 0 0 0 3px rgba(142, 160, 255, 0.18)" } : {})
  },
  yahooSearchIcon: {
    marginRight: 12,
    color: YAHOO_COLORS.ink,
    fontSize: 20,
    lineHeight: 24
  },
  yahooSearchInput: {
    flex: 1,
    minWidth: 0,
    height: "100%",
    borderWidth: 0,
    borderRadius: 0,
    backgroundColor: "transparent",
    paddingHorizontal: 0,
    paddingVertical: 0,
    color: YAHOO_COLORS.ink,
    fontFamily: YAHOO_FONT_STACK,
    fontSize: 18,
    lineHeight: 24,
    textAlignVertical: "center",
    includeFontPadding: false,
    ...(Platform.OS === "web"
      ? {
          boxShadow: "none",
          outlineStyle: "none",
          outlineWidth: 0
        }
      : {})
  },
  yahooSearchInputDark: {
    color: OJS_DARK_COLORS.ink,
    ...(Platform.OS === "web" ? { outlineStyle: "none", outlineWidth: 0 } : {})
  },
  yahooSearchInputDisplay: {
    justifyContent: "center"
  },
  yahooSearchInputDisplayPressed: {
    opacity: 0.72
  },
  yahooSearchInputDisplayText: {
    color: YAHOO_COLORS.ink,
    fontFamily: YAHOO_FONT_STACK,
    fontSize: 18,
    lineHeight: 24,
    includeFontPadding: false
  },
  yahooSearchInputDisplayTextDark: {
    color: OJS_DARK_COLORS.ink
  },
  yahooSearchInputLong: {
    fontSize: 16,
    lineHeight: 22
  },
  yahooSearchInputVeryLong: {
    fontSize: 14,
    lineHeight: 20
  },
  searchGlyph: {
    width: 22,
    height: 22,
    position: "relative",
    flexShrink: 0,
    marginRight: 12
  },
  searchGlyphCompact: {
    marginRight: 0
  },
  searchGlyphCircle: {
    position: "absolute",
    left: 3,
    top: 3,
    width: 11,
    height: 11,
    borderWidth: 2,
    borderColor: YAHOO_COLORS.blue,
    borderRadius: 999
  },
  searchGlyphCircleDark: {
    borderColor: "#8EA0FF"
  },
  searchGlyphHandle: {
    position: "absolute",
    left: 13,
    top: 14,
    width: 8,
    height: 2,
    borderRadius: 999,
    backgroundColor: YAHOO_COLORS.blue,
    transform: [{ rotate: "45deg" }]
  },
  searchGlyphHandleDark: {
    backgroundColor: "#8EA0FF"
  },
  yahooSearchIconButton: {
    width: 44,
    height: 44,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 2
  },
  yahooSearchIconButtonPressed: {
    backgroundColor: YAHOO_COLORS.section,
    transform: [{ scale: 0.96 }]
  },
  clearGlyph: {
    width: 18,
    height: 18,
    position: "relative"
  },
  clearGlyphBar: {
    position: "absolute",
    left: 2,
    top: 8,
    width: 14,
    height: 2,
    borderRadius: 999,
    backgroundColor: YAHOO_COLORS.muted
  },
  clearGlyphBarDark: {
    backgroundColor: OJS_DARK_COLORS.muted
  },
  clearGlyphBarForward: {
    transform: [{ rotate: "45deg" }]
  },
  clearGlyphBarBackward: {
    transform: [{ rotate: "-45deg" }]
  },
  yahooSearchSubmitButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent"
  },
  yahooSearchSubmitButtonPressed: {
    backgroundColor: "rgba(114, 63, 245, 0.08)",
    transform: [{ scale: 0.96 }]
  },
  yahooSearchSubmitButtonText: {
    color: YAHOO_COLORS.blue,
    fontSize: 22,
    lineHeight: 24,
    fontWeight: "700"
  },
  yahooMobileResultsActions: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingTop: 10
  },
  searchShellHome: {
    minHeight: Platform.OS === "web" ? "calc(100svh - 48px)" : 620,
    justifyContent: "center",
    paddingTop: Platform.OS === "web" ? 24 : 18,
    paddingBottom: 0
  },
  searchShellSuggest: {
    minHeight: Platform.OS === "web" ? "calc(100svh - 48px)" : 620,
    justifyContent: "center",
    paddingTop: Platform.OS === "web" ? 24 : 18,
    paddingBottom: 0
  },
  searchShellCompact: {
    minHeight: Platform.OS === "web" ? 144 : 132,
    justifyContent: "flex-start",
    paddingTop: Platform.OS === "web" ? 8 : 6,
    paddingBottom: 8
  },
  searchShellFilterOpen: {
    minHeight: Platform.OS === "web" ? 280 : 280,
    justifyContent: "flex-start",
    paddingTop: Platform.OS === "web" ? 34 : 28,
    paddingBottom: 10
  },
  searchMetaRail: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 12,
    ...(Platform.OS === "web" ? { pointerEvents: "box-none" } : {})
  },
  publicVersionButton: {
    flexShrink: 1,
    maxWidth: "46%",
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4
  },
  publicVersionButtonPressed: {
    backgroundColor: OJS_COLORS.surfaceMuted,
    transform: [{ scale: 0.985 }]
  },
  publicVersionButtonPressedDark: {
    backgroundColor: "rgba(191, 228, 211, 0.12)"
  },
  publicVersionLabel: {
    color: OJS_COLORS.muted,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: "700",
    letterSpacing: 0
  },
  publicVersionLabelDark: {
    color: OJS_DARK_COLORS.muted
  },
  searchCreditText: {
    flexShrink: 1,
    maxWidth: "54%",
    textAlign: "right",
    color: OJS_COLORS.muted,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: "600",
    letterSpacing: 0
  },
  searchCreditTextDark: {
    color: OJS_DARK_COLORS.muted
  },
  searchCreditLink: {
    color: OJS_COLORS.green,
    fontWeight: "800",
    textDecorationLine: "underline"
  },
  searchCreditLinkDark: {
    color: OJS_DARK_COLORS.green
  },
  brandWordmark: {
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 2,
    borderRadius: 24
  },
  brandWordmarkInner: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "flex-start"
  },
  brandWordmarkPressed: {
    backgroundColor: OJS_COLORS.surfaceMuted,
    transform: [{ scale: 0.992 }]
  },
  brandWordmarkLetter: {
    fontSize: 30,
    lineHeight: 34,
    fontWeight: "800",
    letterSpacing: 0
  },
  brandWordmarkLetterCompact: {
    fontSize: 26,
    lineHeight: 30
  },
  brandWordmarkOpen: {
    fontSize: 36,
    lineHeight: 42,
    fontWeight: "800",
    color: OJS_COLORS.blue
  },
  brandWordmarkSlots: {
    fontSize: 36,
    lineHeight: 42,
    fontWeight: "800",
    color: OJS_COLORS.ink
  },
  searchLead: {
    marginTop: 2,
    marginBottom: 16,
    textAlign: "left",
    fontSize: 13,
    lineHeight: 18,
    color: OJS_COLORS.muted
  },
  searchLeadCompact: {
    marginTop: 0,
    marginBottom: 7,
    fontSize: 12,
    lineHeight: 16
  },
  searchPanelLabel: {
    marginBottom: 7,
    color: OJS_COLORS.muted,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "700",
    textTransform: "uppercase"
  },
  searchBoxRow: {
    width: "100%",
    maxWidth: "100%"
  },
  searchLowerRail: {
    width: "100%",
    minHeight: Platform.OS === "web" ? 204 : 176,
    alignItems: "stretch"
  },
  searchLowerRailMobile: {
    minHeight: Platform.OS === "web" ? 142 : 132
  },
  searchLowerRailCompact: {
    minHeight: Platform.OS === "web" ? 58 : 54
  },
  searchLowerRailFiltersOpen: {
    minHeight: Platform.OS === "web" ? 72 : 72
  },
  searchShortcutHint: {
    marginTop: 7,
    color: OJS_COLORS.muted,
    fontSize: 11,
    textAlign: "center"
  },
  seoLandingLinks: {
    width: "100%",
    maxWidth: 760,
    alignSelf: "center",
    marginTop: 24,
    paddingHorizontal: 10,
    alignItems: "center",
    gap: 10
  },
  seoLandingLinksCompact: {
    marginTop: 8,
    paddingHorizontal: 0,
    gap: 6
  },
  seoLandingLinksTitle: {
    color: OJS_COLORS.muted,
    fontFamily: YAHOO_FONT_STACK,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "700",
    textTransform: "uppercase"
  },
  seoLandingLinksList: {
    width: "100%",
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    alignItems: "center",
    gap: 8
  },
  seoLandingLinksListCompact: {
    alignSelf: "center",
    maxWidth: 360,
    gap: 6
  },
  seoLandingLink: {
    color: YAHOO_COLORS.purple,
    backgroundColor: "rgba(100, 79, 240, 0.08)",
    borderWidth: 1,
    borderColor: "rgba(100, 79, 240, 0.16)",
    borderRadius: 999,
    minWidth: 44,
    minHeight: 44,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontFamily: YAHOO_FONT_STACK,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "600",
    textDecorationLine: "none"
  },
  seoLandingLinkCompact: {
    width: "48%",
    maxWidth: 174,
    minWidth: 0,
    paddingHorizontal: 8,
    paddingVertical: 8,
    fontSize: 11,
    lineHeight: 14,
    textAlign: "center",
    ...(Platform.OS === "web"
      ? {
          boxSizing: "border-box",
          display: "block",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap"
        }
      : {})
  },
  seoLandingLinkDark: {
    color: "#D8CCFF",
    backgroundColor: "rgba(183, 158, 255, 0.14)",
    borderColor: "rgba(183, 158, 255, 0.24)"
  },
  seoLandingLinkButton: {
    maxWidth: "100%",
    minWidth: 44,
    minHeight: 44,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "rgba(100, 79, 240, 0.08)",
    borderWidth: 1,
    borderColor: "rgba(100, 79, 240, 0.16)",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 10
  },
  seoLandingLinkButtonCompact: {
    width: "48%",
    maxWidth: 174,
    minWidth: 0,
    paddingHorizontal: 8,
    paddingVertical: 8
  },
  seoLandingLinkButtonDark: {
    backgroundColor: "rgba(183, 158, 255, 0.14)",
    borderColor: "rgba(183, 158, 255, 0.24)"
  },
  seoLandingLinkButtonText: {
    color: YAHOO_COLORS.purple,
    fontFamily: YAHOO_FONT_STACK,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "600"
  },
  seoLandingLinkButtonTextCompact: {
    fontSize: 11,
    lineHeight: 14,
    textAlign: "center"
  },
  seoLandingLinkButtonTextDark: {
    color: "#D8CCFF"
  },
  searchActionsRow: {
    marginTop: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-start",
    gap: 8,
    flexWrap: "wrap"
  },
  controls: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10
  },
  postingsFiltersHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 6
  },
  postingsFiltersToggleBtn: {
    borderWidth: 1,
    borderColor: OJS_COLORS.border,
    backgroundColor: OJS_COLORS.surface,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 9,
    minHeight: 44,
    justifyContent: "center"
  },
  postingsFiltersToggleText: {
    color: OJS_COLORS.text,
    fontWeight: "600",
    fontSize: 12
  },
  postingsFiltersClearBtn: {
    borderWidth: 1,
    borderColor: OJS_COLORS.softBorder,
    borderRadius: 18,
    paddingHorizontal: 13,
    paddingVertical: 9,
    minHeight: 44,
    justifyContent: "center",
    backgroundColor: OJS_COLORS.surface
  },
  postingsFiltersClearText: {
    color: OJS_COLORS.muted,
    fontSize: 12,
    fontWeight: "600"
  },
  buttonPressed: {
    backgroundColor: OJS_COLORS.surfaceMuted,
    transform: [{ scale: 0.98 }]
  },
  postingsFiltersPanel: {
    width: "100%",
    maxWidth: "100%",
    marginTop: 14,
    marginBottom: 4
  },
  postingsFiltersPanelDesktop: {
    ...(Platform.OS === "web"
      ? {
          maxHeight: "calc(100svh - 330px)",
          overflowY: "auto",
          overflowX: "hidden",
          paddingRight: 4,
          marginRight: -4,
          scrollbarColor: `${OJS_COLORS.border} transparent`,
          scrollbarWidth: "thin"
        }
      : {})
  },
  postingsFiltersPanelContent: {
    paddingBottom: 4
  },
  globalFilterStatus: {
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: OJS_COLORS.softBorder,
    backgroundColor: OJS_COLORS.hover,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 9
  },
  globalFilterStatusDot: {
    width: 9,
    height: 9,
    borderRadius: 999,
    backgroundColor: OJS_COLORS.focus
  },
  globalFilterStatusCopy: {
    flex: 1,
    minWidth: 0
  },
  globalFilterStatusTitle: {
    color: OJS_COLORS.ink,
    fontSize: 12,
    lineHeight: 15,
    fontWeight: "700"
  },
  globalFilterStatusText: {
    marginTop: 1,
    color: OJS_COLORS.muted,
    fontSize: 11,
    lineHeight: 15
  },
  postingsFiltersIntro: {
    borderRadius: 10,
    backgroundColor: OJS_COLORS.surfaceMuted,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 10
  },
  postingsFiltersIntroTitle: {
    color: OJS_COLORS.ink,
    fontSize: 13,
    fontWeight: "700"
  },
  postingsFiltersIntroText: {
    marginTop: 3,
    color: OJS_COLORS.muted,
    fontSize: 12,
    lineHeight: 17
  },
  contextualFilterHint: {
    color: OJS_COLORS.muted,
    backgroundColor: OJS_COLORS.surfaceMuted,
    borderWidth: 1,
    borderColor: OJS_COLORS.softBorder,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    marginBottom: 10,
    fontSize: 12,
    lineHeight: 17
  },
  dropdownWrap: {
    marginBottom: 10
  },
  dropdownTrigger: {
    borderWidth: 1,
    borderColor: OJS_COLORS.softBorder,
    borderRadius: 12,
    backgroundColor: OJS_COLORS.surface,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 44,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center"
  },
  dropdownTriggerLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: OJS_COLORS.text,
    marginRight: 10
  },
  dropdownTriggerValue: {
    flex: 1,
    fontSize: 12,
    color: OJS_COLORS.muted,
    fontWeight: "600",
    textAlign: "right"
  },
  dropdownPanel: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: OJS_COLORS.softBorder,
    borderRadius: 10,
    backgroundColor: OJS_COLORS.surface,
    padding: 8
  },
  dropdownHelper: {
    color: OJS_COLORS.muted,
    fontSize: 12,
    lineHeight: 17,
    marginBottom: 8,
    paddingHorizontal: 2
  },
  dropdownSelectedChips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginBottom: 8
  },
  dropdownSelectedChip: {
    overflow: "hidden",
    borderWidth: 1,
    borderColor: OJS_COLORS.accent,
    borderRadius: 999,
    backgroundColor: OJS_COLORS.pressed,
    color: OJS_COLORS.blue,
    paddingHorizontal: 8,
    paddingVertical: 5,
    fontSize: 11,
    fontWeight: "700"
  },
  dropdownSelectedMore: {
    borderRadius: 999,
    backgroundColor: OJS_COLORS.hover,
    color: OJS_COLORS.muted,
    paddingHorizontal: 8,
    paddingVertical: 5,
    fontSize: 11,
    fontWeight: "700"
  },
  dropdownSearch: {
    borderWidth: 1,
    borderColor: OJS_COLORS.border,
    borderRadius: 10,
    backgroundColor: OJS_COLORS.surface,
    height: 40,
    paddingHorizontal: 10
  },
  dropdownOptionsScroll: {
    maxHeight: 180,
    marginTop: 8
  },
  dropdownOption: {
    borderWidth: 1,
    borderColor: OJS_COLORS.softBorder,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    minHeight: 44,
    marginBottom: 6,
    backgroundColor: OJS_COLORS.surfaceMuted
  },
  dropdownOptionSelected: {
    borderColor: OJS_COLORS.focus,
    backgroundColor: OJS_COLORS.pressed
  },
  dropdownOptionDisabled: {
    borderColor: OJS_COLORS.softBorder,
    backgroundColor: OJS_COLORS.hover
  },
  dropdownOptionLabel: {
    color: OJS_COLORS.text,
    fontSize: 12
  },
  dropdownOptionLabelSelected: {
    color: OJS_COLORS.focus,
    fontWeight: "700"
  },
  dropdownOptionLabelDisabled: {
    color: OJS_COLORS.muted
  },
  dropdownEmpty: {
    color: OJS_COLORS.muted,
    fontSize: 12,
    lineHeight: 17,
    paddingVertical: 10,
    paddingHorizontal: 4
  },
  dropdownOptionCount: {
    marginTop: 2,
    marginBottom: 2,
    color: OJS_COLORS.muted,
    fontSize: 11,
    textAlign: "right"
  },
  dropdownClearBtn: {
    marginTop: 4,
    borderWidth: 1,
    borderColor: OJS_COLORS.softBorder,
    borderRadius: 8,
    paddingVertical: 8,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: OJS_COLORS.surface
  },
  dropdownClearBtnText: {
    color: OJS_COLORS.muted,
    fontSize: 12,
    fontWeight: "600"
  },
  remoteFilterGroup: {
    marginTop: 2
  },
  freshnessFilterGroup: {
    marginTop: 2,
    marginBottom: 12
  },
  filterSegmentRow: {
    flexDirection: "row",
    alignItems: "stretch",
    gap: 6,
    flexWrap: "nowrap",
    width: "100%"
  },
  filterSegmentChip: {
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: OJS_COLORS.border,
    backgroundColor: OJS_COLORS.surface,
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 8,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    ...(Platform.OS === "web"
      ? {
          cursor: "pointer",
          transitionProperty: "background-color, border-color, color, transform, box-shadow",
          transitionDuration: "180ms",
          transitionTimingFunction: "cubic-bezier(0.2, 0, 0, 1)"
        }
      : {})
  },
  filterSegmentChipActive: {
    borderColor: OJS_COLORS.focus,
    backgroundColor: OJS_COLORS.focus,
    ...(Platform.OS === "web" ? { boxShadow: "0 8px 18px rgba(82, 125, 104, 0.18)" } : {})
  },
  filterSegmentChipPressed: {
    backgroundColor: OJS_COLORS.pressed,
    transform: [{ scale: 0.975 }]
  },
  filterSegmentChipText: {
    color: OJS_COLORS.text,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "600",
    textAlign: "center"
  },
  filterSegmentChipTextActive: {
    color: OJS_COLORS.ink
  },
  remoteFilterChipsRow: {
    flexDirection: "row",
    gap: 8,
    flexWrap: "wrap"
  },
  remoteNoDateToggleRow: {
    marginTop: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1,
    borderColor: OJS_COLORS.softBorder,
    borderRadius: 10,
    backgroundColor: OJS_COLORS.surfaceMuted,
    paddingVertical: 9,
    paddingHorizontal: 12
  },
  remoteNoDateToggleLabel: {
    flex: 1,
    marginRight: 10,
    color: OJS_COLORS.text,
    fontSize: 12,
    fontWeight: "600"
  },
  remoteFilterChip: {
    borderWidth: 1,
    borderColor: OJS_COLORS.border,
    backgroundColor: OJS_COLORS.surface,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 8,
    minHeight: 44,
    justifyContent: "center"
  },
  remoteFilterChipActive: {
    borderColor: OJS_COLORS.focus,
    backgroundColor: OJS_COLORS.focus
  },
  remoteFilterChipText: {
    color: OJS_COLORS.text,
    fontSize: 12,
    fontWeight: "600"
  },
  remoteFilterChipTextActive: {
    color: OJS_COLORS.ink
  },
  filterChipDisabled: {
    opacity: 0.58,
    backgroundColor: OJS_COLORS.hover
  },
  filterChipDisabledText: {
    color: OJS_COLORS.muted
  },
  search: {
    borderWidth: 1,
    borderColor: OJS_COLORS.border,
    borderRadius: 12,
    backgroundColor: OJS_COLORS.surface,
    paddingHorizontal: 14,
    height: 48,
    fontSize: 14,
    color: OJS_COLORS.ink,
    ...(Platform.OS === "web"
      ? {
          boxShadow: "0 6px 20px rgba(38, 51, 45, 0.10)",
          outlineColor: OJS_COLORS.focus,
          outlineOffset: 2,
          transitionProperty: "border-color, box-shadow, transform",
          transitionDuration: "180ms",
          transitionTimingFunction: "cubic-bezier(0.2, 0, 0, 1)"
        }
      : {
          shadowColor: OJS_COLORS.shadow,
          shadowOpacity: 0.1,
          shadowRadius: 20,
          shadowOffset: { width: 0, height: 6 }
        })
  },
  searchDark: {
    borderColor: OJS_DARK_COLORS.border,
    backgroundColor: OJS_DARK_COLORS.surfaceMuted,
    color: OJS_DARK_COLORS.ink,
    ...(Platform.OS === "web"
      ? {
          boxShadow: "0 6px 18px rgba(0, 0, 0, 0.28)",
          outlineColor: OJS_DARK_COLORS.focus
        }
      : {})
  },
  searchCompact: {
    height: 48,
    paddingHorizontal: 20,
    fontSize: 15
  },
  searchSuggestionsPanel: {
    position: "absolute",
    top: 52,
    left: 0,
    right: 0,
    width: "100%",
    maxWidth: "100%",
    alignSelf: "stretch",
    marginTop: -1,
    overflow: "hidden",
    zIndex: 25,
    elevation: 8,
    borderWidth: 1,
    borderTopWidth: 0,
    borderColor: OJS_COLORS.softBorder,
    borderTopLeftRadius: 0,
    borderTopRightRadius: 0,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
    backgroundColor: OJS_COLORS.surface,
    paddingTop: 7,
    paddingBottom: 8,
    ...(Platform.OS === "web"
      ? {
          boxShadow: "0 14px 24px rgba(35, 42, 49, 0.10)",
          transitionProperty: "opacity, transform, margin, max-height",
          transitionDuration: "180ms",
          transitionTimingFunction: "cubic-bezier(0.2, 0, 0, 1)"
        }
      : {
          shadowColor: OJS_COLORS.shadow,
          shadowOpacity: 0.12,
          shadowRadius: 18,
          shadowOffset: { width: 0, height: 10 }
        })
  },
  searchSuggestionsPanelResults: {
    top: 46,
    borderBottomLeftRadius: 20,
    borderBottomRightRadius: 20
  },
  searchSuggestionsPanelResultsMobileInFlow: {
    position: "relative",
    top: 0,
    left: 0,
    right: 0,
    maxWidth: 640,
    zIndex: 120,
    elevation: 14
  },
  searchSuggestionsPanelDark: {
    borderColor: OJS_DARK_COLORS.border,
    backgroundColor: "#18151F",
    ...(Platform.OS === "web" ? { boxShadow: "0 16px 28px rgba(0, 0, 0, 0.34)" } : {})
  },
  searchIntentPanel: {
    width: "100%",
    maxWidth: 760,
    alignSelf: "center",
    marginTop: 10,
    minHeight: Platform.OS === "web" ? 78 : 72,
    gap: 7
  },
  searchIntentPanelEmpty: {
    opacity: 0
  },
  searchIntentLabel: {
    color: OJS_COLORS.muted,
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase"
  },
  searchIntentChipsRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8
  },
  searchIntentChip: {
    minHeight: 44,
    maxWidth: "100%",
    borderWidth: 1,
    borderColor: OJS_COLORS.softBorder,
    borderRadius: 999,
    backgroundColor: OJS_COLORS.surface,
    paddingHorizontal: 13,
    paddingVertical: 9,
    alignItems: "center",
    justifyContent: "center"
  },
  searchIntentChipActive: {
    borderColor: OJS_COLORS.green,
    backgroundColor: OJS_COLORS.accentSoft
  },
  searchIntentChipText: {
    color: OJS_COLORS.text,
    fontSize: 12,
    fontWeight: "700"
  },
  searchIntentChipTextActive: {
    color: OJS_COLORS.green
  },
  searchSuggestionItem: {
    minHeight: 44,
    paddingHorizontal: 18,
    paddingVertical: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 11
  },
  searchSuggestionItemActive: {
    backgroundColor: OJS_COLORS.surfaceMuted
  },
  searchSuggestionItemActiveDark: {
    backgroundColor: OJS_DARK_COLORS.pressed
  },
  searchSuggestionIconSlot: {
    width: 24,
    minWidth: 24,
    alignItems: "center",
    justifyContent: "center"
  },
  searchSuggestionLabel: {
    flex: 1,
    color: OJS_COLORS.ink,
    fontFamily: YAHOO_FONT_STACK,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "600"
  },
  searchSuggestionLabelDark: {
    color: OJS_DARK_COLORS.ink
  },
  searchSuggestionHint: {
    flexShrink: 0,
    maxWidth: 120,
    color: OJS_COLORS.muted,
    fontFamily: YAHOO_FONT_STACK,
    fontSize: 12,
    lineHeight: 16,
    textTransform: "capitalize"
  },
  searchSuggestionHintDark: {
    color: OJS_DARK_COLORS.muted
  },
  searchNotice: {
    marginTop: 8,
    color: OJS_COLORS.muted,
    fontSize: 12,
    textAlign: "center"
  },
  syncBtn: {
    backgroundColor: OJS_COLORS.blue,
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 9,
    minWidth: 82,
    minHeight: 38,
    justifyContent: "center",
    alignItems: "center",
    flexDirection: "row",
    ...(Platform.OS === "web"
      ? { boxShadow: "0 3px 8px rgba(38, 51, 45, 0.14)" }
      : {
          shadowColor: OJS_COLORS.blue,
          shadowOpacity: 0.14,
          shadowRadius: 8,
          shadowOffset: { width: 0, height: 3 }
        })
  },
  syncBtnRunning: {
    backgroundColor: OJS_COLORS.red
  },
  syncBtnUpdated: {
    backgroundColor: OJS_COLORS.green
  },
  syncBtnFailed: {
    backgroundColor: OJS_COLORS.danger
  },
  syncBtnPressed: {
    transform: [{ scale: 0.98 }],
    opacity: 0.9
  },
  syncBtnDisabled: {
    opacity: 0.82
  },
  syncBtnSpinner: {
    marginRight: 6
  },
  syncBtnText: {
    color: OJS_COLORS.surface,
    fontWeight: "600"
  },
  syncNotice: {
    marginTop: 8,
    color: OJS_COLORS.muted,
    fontSize: 12,
    textAlign: "center"
  },
  status: {
    paddingHorizontal: 16,
    fontSize: 12,
    color: OJS_COLORS.text
  },
  syncStatusPanel: {
    marginHorizontal: 16,
    marginTop: 6,
    marginBottom: 8,
    padding: 9,
    borderWidth: 1,
    borderColor: OJS_COLORS.softBorder,
    borderRadius: 14,
    backgroundColor: OJS_COLORS.surface
  },
  syncStatusCompactRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8
  },
  syncStatusHeadingBlock: {
    flex: 1,
    minWidth: 0
  },
  syncStatusTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: OJS_COLORS.ink
  },
  syncStatusSummary: {
    marginTop: 2,
    fontSize: 12,
    lineHeight: 17,
    color: OJS_COLORS.muted
  },
  syncStatusBadge: {
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: OJS_COLORS.hover
  },
  syncStatusBadgeRunning: {
    backgroundColor: OJS_COLORS.successSoft
  },
  syncStatusBadgeText: {
    fontSize: 11,
    color: OJS_COLORS.ink,
    fontWeight: "700"
  },
  coverageToggle: {
    borderWidth: 1,
    borderColor: OJS_COLORS.softBorder,
    borderRadius: 14,
    paddingHorizontal: 9,
    paddingVertical: 5,
    minHeight: 44,
    justifyContent: "center",
    backgroundColor: OJS_COLORS.surfaceMuted
  },
  coverageToggleText: {
    fontSize: 11,
    color: OJS_COLORS.muted,
    fontWeight: "700"
  },
  syncStatusStatesRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8
  },
  syncStatusState: {
    fontSize: 12,
    color: OJS_COLORS.muted,
    backgroundColor: OJS_COLORS.surfaceMuted,
    borderWidth: 1,
    borderColor: OJS_COLORS.softBorder,
    borderRadius: 14,
    paddingHorizontal: 8,
    paddingVertical: 5
  },
  syncStatusMetricsGrid: {
    marginTop: 8,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 7
  },
  syncStatusMetric: {
    minWidth: 110,
    flexGrow: 1,
    borderWidth: 1,
    borderColor: OJS_COLORS.softBorder,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 7,
    backgroundColor: OJS_COLORS.surfaceMuted
  },
  syncStatusMetricValue: {
    fontSize: 15,
    color: OJS_COLORS.ink,
    fontWeight: "700"
  },
  syncStatusMetricLabel: {
    marginTop: 2,
    fontSize: 11,
    color: OJS_COLORS.muted
  },
  syncStatusDetail: {
    marginTop: 8,
    fontSize: 12,
    color: OJS_COLORS.text
  },
  syncStatusDetailsBlock: {
    marginTop: 9,
    paddingTop: 9,
    borderTopWidth: 1,
    borderTopColor: OJS_COLORS.softBorder
  },
  syncStatusDiagnostic: {
    marginTop: 8,
    fontSize: 11,
    color: OJS_COLORS.muted
  },
  syncStatusError: {
    marginTop: 8,
    fontSize: 12,
    color: OJS_COLORS.warning,
    fontWeight: "600"
  },
  error: {
    marginHorizontal: 16,
    marginTop: 2,
    color: OJS_COLORS.danger,
    fontSize: 13
  },
  loader: {
    marginTop: 20
  },
  atsIntelligencePanel: {
    marginTop: 14,
    borderTopWidth: 1,
    borderTopColor: OJS_COLORS.softBorder,
    paddingTop: 12,
    paddingBottom: 2
  },
  atsIntelligencePanelDark: {
    borderTopColor: OJS_DARK_COLORS.border
  },
  atsIntelligenceTitle: {
    color: OJS_COLORS.ink,
    fontSize: 13,
    fontWeight: "700",
    marginBottom: 8
  },
  atsIntelligenceRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 10,
    borderRadius: 10,
    paddingHorizontal: 9,
    paddingVertical: 8,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: OJS_COLORS.softBorder,
    backgroundColor: OJS_COLORS.surface,
    ...(Platform.OS === "web"
      ? {
          cursor: "pointer",
          transitionProperty: "background-color, border-color, transform, box-shadow",
          transitionDuration: "180ms",
          transitionTimingFunction: "cubic-bezier(0.2, 0, 0, 1)"
        }
      : {})
  },
  atsIntelligenceRowActive: {
    backgroundColor: OJS_COLORS.accentSoft,
    borderColor: OJS_COLORS.accent
  },
  atsIntelligenceSourceBlock: {
    flex: 1,
    minWidth: 0
  },
  atsIntelligenceSource: {
    color: OJS_COLORS.text,
    fontSize: 12,
    fontWeight: "700"
  },
  atsIntelligenceMeta: {
    marginTop: 2,
    color: OJS_COLORS.muted,
    fontSize: 11
  },
  atsIntelligenceQuality: {
    marginTop: 2,
    color: OJS_COLORS.muted,
    fontSize: 11
  },
  atsIntelligenceFreshness: {
    flexShrink: 1,
    maxWidth: 112,
    color: OJS_COLORS.muted,
    fontSize: 11,
    lineHeight: 15,
    textAlign: "right"
  },
  atsIntelligenceEmpty: {
    color: OJS_COLORS.muted,
    fontSize: 12,
    lineHeight: 17
  },
  resultsColumn: {
    flex: 1,
    minWidth: 0,
    width: "100%",
    maxWidth: 760,
    alignSelf: "flex-start",
    marginLeft: 140,
    paddingTop: 12,
    paddingBottom: 48
  },
  resultsColumnMobile: {
    maxWidth: "100%",
    marginLeft: 0,
    paddingHorizontal: 18
  },
  resultsHeader: {
    position: "relative",
    zIndex: 60,
    elevation: 8,
    marginBottom: 6,
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
    flexWrap: "wrap"
  },
  resultsHeaderDark: {
    borderColor: OJS_DARK_COLORS.softBorder
  },
  resultsEyebrow: {
    color: YAHOO_COLORS.muted,
    fontFamily: YAHOO_FONT_STACK,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "400",
    textTransform: "none"
  },
  resultsTitle: {
    marginTop: 0,
    color: YAHOO_COLORS.ink,
    fontFamily: YAHOO_FONT_STACK,
    fontSize: 20,
    lineHeight: 28,
    fontWeight: "400"
  },
  resultsToolbar: {
    position: "relative",
    zIndex: 65,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 8,
    flexWrap: "wrap"
  },
  resultsToolbarDesktop: {
    width: "100%",
    maxWidth: 640
  },
  resultsToolbarMobile: {
    width: "100%",
    alignItems: "stretch",
    justifyContent: "flex-start"
  },
  resultsUtilityControls: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 8,
    zIndex: 20
  },
  resultsMetricsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 12,
    flexWrap: "nowrap",
    flexShrink: 0,
    minWidth: 0
  },
  resultsMetricsRowMobile: {
    width: "100%",
    maxWidth: "100%",
    justifyContent: "flex-start",
    flexWrap: "nowrap",
    gap: 5,
    flexShrink: 1
  },
  resultsMetricsRowHomeMobile: {
    width: "auto",
    maxWidth: "100%",
    flexShrink: 0
  },
  resultsUtilityControlsMobile: {
    width: "auto",
    minWidth: 0,
    flexWrap: "nowrap",
    justifyContent: "flex-start",
    flexShrink: 0,
    gap: 5
  },
  mobileResultsHeaderBand: {
    position: "relative",
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    zIndex: 140,
    elevation: 18
  },
  mobileResultsStatsBand: {
    position: "relative",
    width: "100%",
    alignItems: "stretch",
    justifyContent: "center",
    zIndex: 1
  },
  languageSelectorWrap: {
    position: "relative",
    zIndex: 180,
    elevation: 20
  },
  languageSelectorWrapCompact: {
    width: 48,
    flexShrink: 0,
    alignItems: "flex-end"
  },
  languageSelectorButton: {
    minHeight: 44,
    borderWidth: 1,
    borderColor: OJS_COLORS.softBorder,
    borderRadius: 999,
    backgroundColor: OJS_COLORS.surface,
    paddingHorizontal: 8,
    paddingVertical: 6,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    ...(Platform.OS === "web"
      ? {
          cursor: "pointer",
          boxShadow: "0 8px 18px rgba(38, 51, 45, 0.07)",
          transitionProperty: "background-color, border-color, transform, box-shadow",
          transitionDuration: "220ms",
          transitionTimingFunction: "cubic-bezier(0.2, 0, 0, 1)"
        }
      : {})
  },
  languageSelectorButtonCompact: {
    minHeight: 44,
    paddingHorizontal: 5,
    paddingVertical: 5,
    gap: 4
  },
  languageSelectorButtonOpen: {
    borderColor: OJS_COLORS.focus,
    backgroundColor: OJS_COLORS.accentSoft
  },
  languageSelectorButtonPressed: {
    transform: [{ scale: 0.975 }]
  },
  languageSelectorCode: {
    color: OJS_COLORS.ink,
    fontSize: 12,
    lineHeight: 15,
    fontWeight: "900"
  },
  languageSelectorCodeCompact: {
    fontSize: 10,
    lineHeight: 12
  },
  languageOptions: {
    position: "absolute",
    right: 0,
    top: 50,
    zIndex: 90,
    elevation: 12,
    minWidth: 178,
    borderWidth: 1,
    borderColor: OJS_COLORS.softBorder,
    borderRadius: 14,
    backgroundColor: OJS_COLORS.surface,
    padding: 6,
    maxHeight: 430,
    overflow: "hidden",
    ...(Platform.OS === "web"
      ? {
          boxShadow: "0 18px 34px rgba(38, 51, 45, 0.16)",
          animationDuration: "180ms",
          animationTimingFunction: "cubic-bezier(0.2, 0, 0, 1)"
        }
      : {})
  },
  languageOptionsRtl: Platform.OS === "web"
    ? {
        left: 0,
        right: "auto"
      }
    : {},
  languageOptionsCompact: {
    top: 48,
    minWidth: 158,
    maxHeight: 380
  },
  languageOptionsScroll: {
    maxHeight: 418
  },
  languageOptionsContent: {
    gap: 4
  },
  languageOption: {
    minHeight: 44,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 7,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    ...(Platform.OS === "web"
      ? {
          cursor: "pointer",
          transitionProperty: "background-color, transform",
          transitionDuration: "180ms",
          transitionTimingFunction: "cubic-bezier(0.2, 0, 0, 1)"
        }
      : {})
  },
  languageOptionSelected: {
    backgroundColor: OJS_COLORS.accentSoft
  },
  languageOptionPressed: {
    transform: [{ scale: 0.98 }],
    backgroundColor: OJS_COLORS.hover
  },
  languageOptionCopy: {
    flex: 1,
    minWidth: 0
  },
  languageOptionLabel: {
    color: OJS_COLORS.ink,
    fontSize: 12,
    lineHeight: 15,
    fontWeight: "800"
  },
  languageOptionMeta: {
    color: OJS_COLORS.muted,
    fontSize: 10,
    lineHeight: 13,
    fontWeight: "800"
  },
  countryBall: {
    position: "relative",
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(38, 51, 45, 0.18)",
    backgroundColor: OJS_COLORS.surfaceMuted,
    ...(Platform.OS === "web"
      ? {
          transitionProperty: "transform, box-shadow, border-color",
          transitionDuration: "240ms",
          transitionTimingFunction: "cubic-bezier(0.2, 0, 0, 1)"
        }
      : {})
  },
  countryBallSelected: {
    borderColor: OJS_COLORS.focus,
    ...(Platform.OS === "web" ? { boxShadow: "0 0 0 3px rgba(127, 191, 166, 0.25)" } : {})
  },
  countryBallFlagClip: {
    ...StyleSheet.absoluteFillObject,
    overflow: "hidden"
  },
  countryBallFlagHorizontal: {
    flexDirection: "column"
  },
  countryBallFlagVertical: {
    flexDirection: "row"
  },
  countryBallStripe: {
    flex: 1
  },
  countryBallUsCanton: {
    position: "absolute",
    top: 0,
    left: 0,
    width: "48%",
    height: "52%",
    backgroundColor: "#3C3B6E"
  },
  countryBallCrescentWrap: {
    position: "absolute",
    left: "27%",
    top: "29%",
    width: "32%",
    height: "32%"
  },
  countryBallCrescentBase: {
    position: "absolute",
    width: "100%",
    height: "100%",
    borderRadius: 999,
    backgroundColor: "#FFFFFF"
  },
  countryBallCrescentCut: {
    position: "absolute",
    left: "30%",
    top: "-2%",
    width: "92%",
    height: "104%",
    borderRadius: 999,
    backgroundColor: "#E30A17"
  },
  countryBallEyes: {
    position: "absolute",
    left: "22%",
    right: "22%",
    top: "34%",
    flexDirection: "row",
    justifyContent: "space-between"
  },
  countryBallEye: {
    width: 4,
    height: 5,
    borderRadius: 999,
    backgroundColor: "#101713"
  },
  themeToggle: {
    minHeight: 40,
    borderWidth: 1,
    borderColor: YAHOO_COLORS.border,
    borderRadius: 999,
    backgroundColor: YAHOO_COLORS.surface,
    paddingHorizontal: 10,
    paddingVertical: 5,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    ...(Platform.OS === "web"
      ? {
          cursor: "pointer",
          boxShadow: "0 8px 18px rgba(35, 42, 49, 0.08)",
          transitionProperty: "background-color, border-color, transform, box-shadow",
          transitionDuration: "220ms",
          transitionTimingFunction: "cubic-bezier(0.2, 0, 0, 1)"
        }
      : {})
  },
  themeToggleCompact: {
    minHeight: 44,
    minWidth: 66,
    paddingHorizontal: 6,
    paddingVertical: 6,
    gap: 5
  },
  themeToggleDark: {
    borderColor: OJS_DARK_COLORS.border,
    backgroundColor: OJS_DARK_COLORS.surface
  },
  themeTogglePressed: {
    transform: [{ scale: 0.975 }]
  },
  themeToggleTrack: {
    width: 42,
    height: 26,
    borderRadius: 999,
    backgroundColor: OJS_COLORS.accentSoft,
    padding: 3,
    justifyContent: "center"
  },
  themeToggleTrackDark: {
    backgroundColor: OJS_DARK_COLORS.pressed
  },
  themeToggleKnob: {
    width: 20,
    height: 20,
    borderRadius: 999,
    backgroundColor: "#F5C96B",
    alignItems: "center",
    justifyContent: "center",
    ...(Platform.OS === "web"
      ? {
          transitionProperty: "transform, background-color",
          transitionDuration: "240ms",
          transitionTimingFunction: "cubic-bezier(0.2, 0, 0, 1)"
        }
      : {})
  },
  themeToggleKnobDark: {
    backgroundColor: "#DDE7F3",
    transform: [{ translateX: 16 }]
  },
  themeToggleGlyph: {
    width: 8,
    height: 8,
    borderRadius: 999
  },
  themeToggleGlyphSun: {
    backgroundColor: "#FFF4C4"
  },
  themeToggleGlyphMoon: {
    backgroundColor: OJS_DARK_COLORS.surface
  },
  themeIconButton: {
    width: 28,
    height: 28,
    borderRadius: 999,
    backgroundColor: "#E6EFE5",
    alignItems: "center",
    justifyContent: "center"
  },
  themeIconButtonCompact: {
    width: 20,
    height: 20
  },
  themeIconButtonDark: {
    backgroundColor: "#221B32"
  },
  themeIconCore: {
    width: 16,
    height: 16,
    borderRadius: 999,
    backgroundColor: "#F5C96B",
    borderWidth: 3,
    borderColor: "#FFF6D7"
  },
  themeIconCoreCompact: {
    width: 11,
    height: 11,
    borderWidth: 2
  },
  themeIconCoreDark: {
    position: "relative",
    backgroundColor: "#D7D0FF",
    borderColor: "#D7D0FF"
  },
  themeIconMoonCutout: {
    position: "absolute",
    right: -4,
    top: -3,
    width: 14,
    height: 14,
    borderRadius: 999,
    backgroundColor: "#221B32"
  },
  themeIconMoonCutoutCompact: {
    right: -3,
    top: -2,
    width: 9,
    height: 9
  },
  themeToggleText: {
    color: YAHOO_COLORS.ink,
    fontFamily: YAHOO_FONT_STACK,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "700"
  },
  themeToggleTextCompact: {
    fontSize: 11,
    lineHeight: 14
  },
  themeToggleTextDark: {
    color: OJS_DARK_COLORS.ink
  },
  resultCountText: {
    minWidth: 116,
    paddingHorizontal: 14
  },
  resultCountTextMobile: {
    minWidth: 0,
    paddingHorizontal: 6,
    flexGrow: 1.1
  },
  resultCountValueText: {
    color: YAHOO_COLORS.ink,
    fontSize: 16,
    lineHeight: 20,
    fontWeight: "800"
  },
  resultCountUnitText: {
    color: YAHOO_COLORS.muted,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: "700"
  },
  publicStatsChipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 8,
    maxWidth: "100%"
  },
  publicStatsChipRowMobile: {
    width: "100%",
    flexGrow: 0,
    flexShrink: 0,
    flexWrap: "nowrap",
    justifyContent: "space-between",
    gap: 6,
    minWidth: 0
  },
  publicStatsChip: {
    overflow: "hidden",
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "center",
    gap: 4,
    borderWidth: 1,
    borderColor: YAHOO_COLORS.border,
    borderRadius: 12,
    backgroundColor: YAHOO_COLORS.surface,
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 9,
    minWidth: 70,
    minHeight: 42,
    color: YAHOO_COLORS.ink,
    fontFamily: YAHOO_FONT_STACK,
    ...(Platform.OS === "web"
      ? {
          fontVariantNumeric: "tabular-nums",
          boxShadow: "none"
        }
      : {})
  },
  publicStatsChipMobile: {
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 1,
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingTop: 5,
    paddingBottom: 5,
    minWidth: 0,
    minHeight: 42,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 0
  },
  publicStatsChipAts: {
    minWidth: 68
  },
  publicStatsChipAtsMobile: {
    minWidth: 40,
    flexGrow: 1
  },
  publicStatsChipCompanies: {
    minWidth: 118
  },
  publicStatsChipCompaniesMobile: {
    minWidth: 60,
    flexGrow: 1
  },
  publicStatsChipDark: {
    borderColor: OJS_DARK_COLORS.softBorder,
    backgroundColor: OJS_DARK_COLORS.surface,
    color: OJS_DARK_COLORS.text,
    ...(Platform.OS === "web" ? { boxShadow: "0 8px 20px rgba(0, 0, 0, 0.22)" } : {})
  },
  publicStatsChipValue: {
    color: YAHOO_COLORS.ink,
    fontFamily: YAHOO_FONT_STACK,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "800"
  },
  publicStatsChipValueMobile: {
    fontSize: 13,
    lineHeight: 15
  },
  publicStatsChipLabel: {
    color: YAHOO_COLORS.muted,
    fontFamily: YAHOO_FONT_STACK,
    fontSize: 11,
    lineHeight: 16,
    fontWeight: "600"
  },
  publicStatsChipLabelMobile: {
    fontSize: 9,
    lineHeight: 11,
    maxWidth: "100%",
    textAlign: "center"
  },
  yahooStatsChip: {
    borderColor: YAHOO_COLORS.border,
    borderRadius: 12,
    fontFamily: YAHOO_FONT_STACK
  },
  sortControlWrap: {
    flexGrow: 1,
    flexShrink: 1,
    minWidth: 0,
    maxWidth: "100%",
    zIndex: 5
  },
  sortControlWrapDesktop: {
    flexBasis: 440,
    minWidth: 300,
    maxWidth: 520
  },
  sortControlWrapMobile: {
    width: "100%",
    minWidth: 0,
    maxWidth: "100%"
  },
  sortSegmentedControl: {
    position: "relative",
    overflow: "hidden",
    minHeight: 46,
    borderWidth: 1,
    borderColor: OJS_COLORS.softBorder,
    borderRadius: 14,
    backgroundColor: OJS_COLORS.surface,
    padding: 4,
    flexDirection: "row",
    alignItems: "stretch",
    ...(Platform.OS === "web"
      ? {
          boxShadow: "0 8px 18px rgba(38, 51, 45, 0.07)"
        }
      : {})
  },
  sortSegmentedIndicator: {
    position: "absolute",
    top: 3,
    bottom: 3,
    borderRadius: 11,
    backgroundColor: OJS_COLORS.pressed,
    borderWidth: 1,
    borderColor: OJS_COLORS.focus,
    ...(Platform.OS === "web"
      ? {
          transitionProperty: "left, width, background-color, border-color",
          transitionDuration: "240ms",
          transitionTimingFunction: "cubic-bezier(0.2, 0, 0, 1)"
        }
      : {})
  },
  sortSegmentOption: {
    flex: 1,
    flexBasis: 0,
    flexShrink: 1,
    minWidth: 0,
    overflow: "hidden",
    minHeight: 36,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "transparent",
    paddingHorizontal: 7,
    alignItems: "center",
    justifyContent: "center",
    ...(Platform.OS === "web"
      ? {
          cursor: "pointer",
          transitionProperty: "background-color, border-color, box-shadow, color, transform",
          transitionDuration: "220ms",
          transitionTimingFunction: "cubic-bezier(0.16, 1, 0.3, 1)"
        }
      : {})
  },
  sortSegmentOptionActive: {
    backgroundColor: OJS_COLORS.pressed,
    borderColor: OJS_COLORS.focus,
    ...(Platform.OS === "web"
      ? {
          boxShadow: "0 6px 14px rgba(82, 125, 104, 0.18)"
        }
      : {})
  },
  sortSegmentOptionPressed: {
    transform: [{ scale: 0.985 }]
  },
  sortSegmentOptionText: {
    maxWidth: "100%",
    minWidth: 0,
    overflow: "hidden",
    color: OJS_COLORS.muted,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "700",
    textAlign: "center"
  },
  sortSegmentOptionTextActive: {
    color: OJS_COLORS.ink
  },
  sortControl: {
    minHeight: 40,
    borderWidth: 1,
    borderColor: OJS_COLORS.softBorder,
    borderRadius: 10,
    backgroundColor: OJS_COLORS.surface,
    paddingHorizontal: 12,
    justifyContent: "center"
  },
  sortControlText: {
    color: OJS_COLORS.muted,
    fontSize: 12,
    fontWeight: "700"
  },
  initialResultsState: {
    borderWidth: 1,
    borderColor: OJS_COLORS.softBorder,
    borderRadius: 12,
    backgroundColor: OJS_COLORS.surface,
    paddingHorizontal: 20,
    paddingVertical: 22
  },
  initialResultsStateDark: {
    borderColor: OJS_DARK_COLORS.softBorder,
    backgroundColor: OJS_DARK_COLORS.surface
  },
  resultsSurface: {
    width: "100%"
  },
  resultsSurfaceMotion: {
    transitionProperty: "opacity, transform",
    transitionDuration: "320ms",
    transitionTimingFunction: "cubic-bezier(0.0, 0.0, 0.2, 1)"
  },
  list: {
    paddingHorizontal: 0,
    paddingTop: 8,
    paddingBottom: 12,
    gap: 0
  },
  postingsRefreshIndicator: {
    marginTop: 2,
    marginBottom: 4,
    color: OJS_COLORS.muted,
    fontSize: 11
  },
  postingsPagingFooter: {
    alignSelf: "center",
    width: "100%",
    paddingTop: 4,
    paddingBottom: 24,
    alignItems: "center",
    gap: 6
  },
  postingsPagingStateRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8
  },
  postingsPagingText: {
    color: OJS_COLORS.text,
    fontSize: 12,
    fontWeight: "700"
  },
  postingsPagingHint: {
    color: OJS_COLORS.muted,
    fontSize: 11
  },
  scrollTopButton: {
    position: "absolute",
    paddingHorizontal: 20,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: OJS_BRAND_PURPLES.job,
    borderWidth: 1,
    borderColor: OJS_BRAND_PURPLES.slots,
    elevation: 8,
    zIndex: 40,
    ...(Platform.OS === "web"
      ? { boxShadow: "0 10px 22px rgba(124, 58, 237, 0.24)" }
      : {
          shadowColor: OJS_BRAND_PURPLES.job,
          shadowOpacity: 0.24,
          shadowRadius: 20,
          shadowOffset: { width: 0, height: 10 }
        })
  },
  scrollTopButtonDesktop: {
    right: 28,
    bottom: 28,
    minHeight: 48,
    minWidth: 68
  },
  scrollTopButtonMobile: {
    right: 16,
    bottom: Platform.OS === "web" ? 16 : 82,
    minHeight: 52,
    minWidth: 72
  },
  scrollTopButtonPressed: {
    backgroundColor: OJS_BRAND_PURPLES.open,
    transform: [{ scale: 0.97 }]
  },
  scrollTopButtonText: {
    color: OJS_COLORS.surface,
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 0
  },
  card: {
    backgroundColor: YAHOO_COLORS.surface,
    borderRadius: 0,
    paddingTop: 16,
    paddingBottom: 18,
    paddingHorizontal: 0,
    borderWidth: 0,
    borderBottomWidth: 1,
    borderBottomColor: YAHOO_COLORS.border,
    fontFamily: YAHOO_FONT_STACK
  },
  cardMobile: {
    paddingTop: 13,
    paddingBottom: 15
  },
  cardDark: {
    backgroundColor: "transparent",
    borderBottomColor: OJS_DARK_COLORS.softBorder
  },
  position: {
    fontFamily: YAHOO_FONT_STACK,
    fontSize: 20,
    lineHeight: 25,
    fontWeight: "400",
    color: "#0000AA"
  },
  positionMobile: {
    fontSize: 18,
    lineHeight: 23
  },
  positionDark: {
    color: "#A9B4FF"
  },
  positionVisited: {
    color: "#681DA8"
  },
  positionVisitedDark: {
    color: "#C58AF9"
  },
  postingRole: {
    marginTop: 4,
    fontFamily: YAHOO_FONT_STACK,
    fontSize: 14,
    lineHeight: 20,
    color: YAHOO_COLORS.ink,
    fontWeight: "400"
  },
  postingRoleMobile: {
    marginTop: 3,
    fontSize: 13,
    lineHeight: 18
  },
  postingRoleDark: {
    color: OJS_DARK_COLORS.text
  },
  location: {
    marginTop: 6,
    fontFamily: YAHOO_FONT_STACK,
    fontSize: 14,
    lineHeight: 20,
    color: YAHOO_COLORS.ink
  },
  locationMobile: {
    marginTop: 5,
    fontSize: 13,
    lineHeight: 18
  },
  locationDark: {
    color: OJS_DARK_COLORS.text
  },
  company: {
    marginTop: 3,
    fontFamily: YAHOO_FONT_STACK,
    fontSize: 14,
    lineHeight: 20,
    color: YAHOO_COLORS.ink,
    fontWeight: "700"
  },
  companyDark: {
    color: OJS_DARK_COLORS.ink
  },
  ats: {
    marginTop: 3,
    fontFamily: YAHOO_FONT_STACK,
    fontSize: 13,
    lineHeight: 18,
    color: YAHOO_COLORS.muted,
    fontWeight: "400"
  },
  atsMobile: {
    fontSize: 12,
    lineHeight: 17
  },
  atsDark: {
    color: OJS_DARK_COLORS.muted
  },
  posted: {
    marginTop: 2,
    fontFamily: YAHOO_FONT_STACK,
    fontSize: 13,
    lineHeight: 18,
    color: YAHOO_COLORS.muted
  },
  postedMobile: {
    fontSize: 12,
    lineHeight: 17
  },
  postingAppliedNotice: {
    marginTop: 6,
    fontSize: 12,
    color: OJS_COLORS.success,
    fontWeight: "600"
  },
  url: {
    marginTop: 6,
    fontFamily: YAHOO_FONT_STACK,
    fontSize: 13,
    lineHeight: 18,
    color: YAHOO_COLORS.muted
  },
  urlMobile: {
    fontSize: 12,
    lineHeight: 17
  },
  urlDark: {
    color: "#A6B5AA"
  },
  postedDark: {
    color: OJS_DARK_COLORS.muted
  },
  postingCardTopRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8
  },
  postingCardMainPressArea: {
    flex: 1,
    minWidth: 0
  },
  postingCardMainPressAreaPressed: {
    opacity: 0.78
  },
  postingCardMenuAnchor: {
    position: "relative",
    zIndex: 2
  },
  postingCardMenuTrigger: {
    borderWidth: 1,
    borderColor: OJS_COLORS.border,
    borderRadius: 8,
    minWidth: 34,
    height: 30,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: OJS_COLORS.surface
  },
  postingCardMenuTriggerText: {
    fontSize: 18,
    lineHeight: 20,
    color: OJS_COLORS.text,
    fontWeight: "700"
  },
  postingCardMenu: {
    position: "absolute",
    top: 34,
    right: 0,
    minWidth: 190,
    borderWidth: 1,
    borderColor: OJS_COLORS.softBorder,
    borderRadius: 10,
    backgroundColor: OJS_COLORS.surface,
    padding: 6
  },
  postingCardMenuItem: {
    borderWidth: 1,
    borderColor: OJS_COLORS.softBorder,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 10,
    marginBottom: 6,
    backgroundColor: OJS_COLORS.surfaceMuted
  },
  postingCardMenuItemDestructive: {
    borderColor: OJS_COLORS.dangerSoft,
    backgroundColor: OJS_COLORS.dangerSoft
  },
  postingCardMenuItemDisabled: {
    opacity: 0.6
  },
  postingCardMenuItemText: {
    color: OJS_COLORS.text,
    fontWeight: "600",
    fontSize: 12
  },
  postingCardMenuItemTextDestructive: {
    color: OJS_COLORS.danger
  },
  postingCardActionSaveDisabled: {
    opacity: 0.65
  },
  inlineNotice: {
    paddingHorizontal: 16,
    marginTop: 4,
    color: OJS_COLORS.success,
    fontSize: 12
  },
  empty: {
    textAlign: "center",
    marginTop: 20,
    color: OJS_COLORS.muted
  },
  emptyState: {
    alignSelf: "center",
    width: "100%",
    maxWidth: 680,
    marginTop: 18,
    borderWidth: 1,
    borderColor: OJS_COLORS.softBorder,
    borderRadius: 16,
    backgroundColor: OJS_COLORS.surface,
    paddingHorizontal: 18,
    paddingVertical: 18,
    alignItems: "center"
  },
  emptyTitle: {
    color: OJS_COLORS.ink,
    fontSize: 16,
    fontWeight: "800",
    textAlign: "center"
  },
  emptyText: {
    marginTop: 7,
    color: OJS_COLORS.muted,
    fontSize: 13,
    lineHeight: 19,
    textAlign: "center"
  },
  emptyActions: {
    marginTop: 14,
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: 8
  },
  emptyActionButton: {
    minHeight: 44,
    borderWidth: 1,
    borderColor: OJS_COLORS.border,
    borderRadius: 999,
    backgroundColor: OJS_COLORS.surface,
    paddingHorizontal: 14,
    paddingVertical: 9,
    justifyContent: "center",
    alignItems: "center"
  },
  emptyActionPrimary: {
    borderColor: OJS_COLORS.focus,
    backgroundColor: OJS_COLORS.accent
  },
  emptyActionText: {
    color: OJS_COLORS.text,
    fontSize: 12,
    fontWeight: "700"
  },
  emptyActionPrimaryText: {
    color: OJS_COLORS.ink,
    fontSize: 12,
    fontWeight: "800"
  },
  applicationCard: {
    marginTop: 12,
    borderWidth: 1,
    borderColor: "#dbe2ea",
    borderRadius: 10,
    padding: 10,
    backgroundColor: "#fdfefe"
  },
  applicationAttribution: {
    marginTop: 4,
    fontSize: 12,
    color: "#334e68",
    fontStyle: "italic"
  },
  applicationActionsRow: {
    marginTop: 10,
    flexDirection: "row",
    gap: 8
  },
  applicationStatusWrap: {
    flex: 1
  },
  applicationStatusBtn: {
    borderWidth: 1,
    borderColor: "#c6ceda",
    borderRadius: 8,
    backgroundColor: "#ffffff",
    paddingVertical: 8,
    paddingHorizontal: 10
  },
  applicationStatusBtnText: {
    color: "#334e68",
    fontSize: 12,
    fontWeight: "600"
  },
  applicationStatusMenu: {
    marginTop: 6,
    borderWidth: 1,
    borderColor: "#dbe2ea",
    borderRadius: 8,
    backgroundColor: "#ffffff",
    padding: 6
  },
  applicationStatusMenuItem: {
    borderWidth: 1,
    borderColor: "#edf2f7",
    borderRadius: 8,
    paddingVertical: 7,
    paddingHorizontal: 8,
    marginBottom: 6,
    backgroundColor: "#f8fafc"
  },
  applicationStatusMenuItemActive: {
    borderColor: "#102a43",
    backgroundColor: "#102a43"
  },
  applicationStatusMenuItemText: {
    color: "#334e68",
    fontSize: 12
  },
  applicationStatusMenuItemTextActive: {
    color: "#ffffff",
    fontWeight: "700"
  },
  applicationDeleteBtn: {
    borderWidth: 1,
    borderColor: "#d13a3a",
    borderRadius: 8,
    backgroundColor: "#d13a3a",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 10,
    minWidth: 84
  },
  applicationDeleteBtnDisabled: {
    opacity: 0.65
  },
  applicationDeleteBtnText: {
    color: "#ffffff",
    fontWeight: "700",
    fontSize: 12
  },
  settingsContent: {
    paddingHorizontal: 12,
    paddingBottom: 24
  },
  settingsCard: {
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#dbe2ea",
    borderRadius: 12,
    padding: 12
  },
  settingsTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#102a43"
  },
  settingsSubsection: {
    marginTop: 4,
    fontSize: 14,
    fontWeight: "600",
    color: "#334e68"
  },
  settingsDescription: {
    marginTop: 6,
    fontSize: 12,
    color: "#52606d"
  },
  settingsLoader: {
    marginTop: 12
  },
  formGroup: {
    marginTop: 12
  },
  fieldLabel: {
    marginBottom: 6,
    fontSize: 12,
    fontWeight: "600",
    color: "#334e68"
  },
  textField: {
    borderWidth: 1,
    borderColor: "#c6ceda",
    borderRadius: 10,
    backgroundColor: "#fff",
    paddingHorizontal: 12,
    height: 42
  },
  textFieldMultiline: {
    minHeight: 72,
    paddingTop: 10,
    paddingBottom: 10,
    textAlignVertical: "top"
  },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1,
    borderColor: "#dbe2ea",
    borderRadius: 10,
    backgroundColor: "#f8fafc",
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 8
  },
  toggleLabel: {
    flex: 1,
    marginRight: 10,
    fontSize: 12,
    color: "#334e68",
    fontWeight: "600"
  },
  settingsNotice: {
    marginTop: 12,
    fontSize: 12,
    color: "#0b6e4f"
  },
  settingsInlineHint: {
    marginTop: 6,
    fontSize: 11,
    color: "#52606d"
  },
  settingsSecondaryButton: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: "#dbe2ea",
    backgroundColor: "#ffffff",
    borderRadius: 10,
    paddingVertical: 11,
    alignItems: "center"
  },
  settingsSecondaryButtonText: {
    color: "#334e68",
    fontWeight: "600"
  },
  releaseNotesOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(38, 51, 45, 0.36)",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 18
  },
  releaseNotesOverlayMobile: {
    justifyContent: "flex-end",
    alignItems: "stretch",
    paddingHorizontal: 14,
    paddingTop: Platform.OS === "web" ? 24 : ANDROID_STATUS_BAR_OFFSET + 18,
    paddingBottom: Platform.OS === "web" ? 24 : 82
  },
  releaseNotesBackdrop: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 0
  },
  releaseNotesCard: {
    position: "relative",
    zIndex: 1,
    width: "100%",
    maxWidth: 760,
    maxHeight: "82%",
    borderWidth: 1,
    borderColor: OJS_COLORS.border,
    borderRadius: 18,
    backgroundColor: OJS_COLORS.surface,
    padding: 22,
    ...(Platform.OS === "web"
      ? { boxShadow: "0 18px 30px rgba(38, 51, 45, 0.14)" }
      : {
          shadowColor: OJS_COLORS.shadow,
          shadowOpacity: 0.14,
          shadowRadius: 30,
          shadowOffset: { width: 0, height: 18 }
        })
  },
  releaseNotesCardMobile: {
    maxHeight: Platform.OS === "web" ? "88%" : "78%",
    maxWidth: "100%",
    borderRadius: 16,
    padding: 16
  },
  releaseNotesHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 16,
    marginBottom: 14
  },
  releaseNotesHeaderCopy: {
    flex: 1,
    minWidth: 0
  },
  releaseNotesTitle: {
    color: OJS_COLORS.ink,
    fontSize: 28,
    lineHeight: 34,
    fontWeight: "800"
  },
  releaseNotesCloseButton: {
    borderWidth: 1,
    borderColor: OJS_COLORS.border,
    borderRadius: 999,
    backgroundColor: OJS_COLORS.surfaceMuted,
    paddingHorizontal: 14,
    paddingVertical: 8,
    minHeight: 44,
    justifyContent: "center"
  },
  releaseNotesCloseText: {
    color: OJS_COLORS.text,
    fontSize: 12,
    fontWeight: "700"
  },
  releaseNotesScroll: {
    maxHeight: 540
  },
  releaseNotesScrollMobile: {
    maxHeight: Platform.OS === "web" ? 560 : 420
  },
  releaseNotesScrollContent: {
    paddingBottom: 4
  },
  releaseNotesScrollContentMobile: {
    paddingBottom: 18
  },
  releaseNoteItem: {
    borderTopWidth: 1,
    borderTopColor: OJS_COLORS.softBorder,
    paddingTop: 16,
    paddingBottom: 16
  },
  releaseNoteHeadingRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 10,
    flexWrap: "wrap"
  },
  releaseNoteVersion: {
    color: OJS_COLORS.ink,
    fontSize: 18,
    lineHeight: 24,
    fontWeight: "800"
  },
  releaseNoteDate: {
    color: OJS_COLORS.muted,
    fontSize: 13,
    lineHeight: 18
  },
  releaseNoteTitle: {
    marginTop: 8,
    color: OJS_COLORS.text,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "700"
  },
  releaseNoteSummary: {
    marginTop: 5,
    color: OJS_COLORS.text,
    fontSize: 14,
    lineHeight: 21
  },
  modalOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(16, 42, 67, 0.45)",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 14
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 0,
    ...(Platform.OS === "web" ? { pointerEvents: "none" } : {})
  },
  modalCard: {
    position: "relative",
    zIndex: 1,
    elevation: 8,
    width: "100%",
    maxWidth: 700,
    maxHeight: "86%",
    borderWidth: 1,
    borderColor: "#dbe2ea",
    borderRadius: 12,
    backgroundColor: "#ffffff",
    padding: 12,
    paddingTop: 14,
    overflow: "visible"
  },
  modalCloseRow: {
    position: "relative",
    zIndex: 60,
    elevation: 16,
    alignItems: "flex-end",
    marginBottom: 4,
    ...(Platform.OS === "web" ? { pointerEvents: "box-none" } : {})
  },
  modalHeaderRow: {
    position: "relative",
    zIndex: 2,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    paddingRight: 82
  },
  modalTitle: {
    flex: 1,
    minWidth: 0,
    fontSize: 15,
    fontWeight: "700",
    color: "#102a43"
  },
  modalCloseButton: {
    zIndex: 61,
    elevation: 16,
    minWidth: 64,
    minHeight: 36,
    borderWidth: 1,
    borderColor: "#dbe2ea",
    borderRadius: 8,
    backgroundColor: "#ffffff",
    paddingHorizontal: 10,
    paddingVertical: 7,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden"
  },
  modalCloseButtonFloating: {
    position: "absolute",
    top: 12,
    right: 12,
    zIndex: 50,
    elevation: 12
  },
  modalCloseButtonText: {
    color: "#334e68",
    fontSize: 12,
    fontWeight: "600"
  },
  modalBodyScroll: {
    marginTop: 8,
    zIndex: 1
  },
  modalBodyContent: {
    paddingBottom: 10
  },
  settingsInlineActionsRow: {
    marginTop: 8,
    flexDirection: "row",
    gap: 8
  },
  settingsInlineActionBtn: {
    borderWidth: 1,
    borderColor: "#dbe2ea",
    borderRadius: 8,
    backgroundColor: "#ffffff",
    paddingVertical: 7,
    paddingHorizontal: 10
  },
  settingsInlineActionBtnText: {
    color: "#334e68",
    fontSize: 12,
    fontWeight: "600"
  },
  settingsCheckboxList: {
    marginTop: 8
  },
  settingsCheckboxRow: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#dbe2ea",
    borderRadius: 10,
    backgroundColor: "#f8fafc",
    paddingVertical: 8,
    paddingHorizontal: 10,
    marginBottom: 6
  },
  settingsCheckboxIcon: {
    width: 18,
    fontSize: 14,
    color: "#102a43",
    fontWeight: "700"
  },
  settingsCheckboxLabel: {
    flex: 1,
    marginLeft: 6,
    fontSize: 12,
    color: "#334e68",
    fontWeight: "600"
  },
  blockedCompanyRow: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: "#dbe2ea",
    borderRadius: 10,
    backgroundColor: "#f8fafc",
    paddingVertical: 8,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10
  },
  blockedCompanyName: {
    flex: 1,
    color: "#334e68",
    fontSize: 12,
    fontWeight: "600"
  },
  blockedCompanyUnblockBtn: {
    borderWidth: 1,
    borderColor: "#0b6e4f",
    borderRadius: 8,
    backgroundColor: "#0b6e4f",
    paddingVertical: 7,
    paddingHorizontal: 10
  },
  blockedCompanyUnblockBtnDisabled: {
    opacity: 0.65
  },
  blockedCompanyUnblockBtnText: {
    color: "#ffffff",
    fontSize: 12,
    fontWeight: "700"
  },
  settingsSaveButton: {
    marginTop: 10,
    backgroundColor: "#0b6e4f",
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center"
  },
  settingsSaveButtonDisabled: {
    opacity: 0.65
  },
  settingsSaveButtonText: {
    color: "#ffffff",
    fontWeight: "600"
  },
  drawerOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 20,
    flexDirection: "row"
  },
  drawerBackdrop: {
    flex: 1,
    backgroundColor: "rgba(16, 42, 67, 0.25)"
  },
  drawerPanel: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    width: 286,
    backgroundColor: "#ffffff",
    borderRightWidth: 1,
    borderRightColor: "#dbe2ea",
    paddingTop: 58,
    paddingHorizontal: 12
  },
  drawerHeading: {
    marginTop: 12,
    marginBottom: 6,
    paddingHorizontal: 8,
    fontSize: 12,
    color: "#7a8798",
    textTransform: "uppercase",
    fontWeight: "700"
  },
  drawerItem: {
    borderWidth: 1,
    borderColor: "#dbe2ea",
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 10,
    marginBottom: 8
  },
  drawerItemSelected: {
    borderColor: "#102a43",
    backgroundColor: "#102a43"
  },
  drawerItemText: {
    color: "#334e68",
    fontWeight: "600"
  },
  drawerItemTextSelected: {
    color: "#ffffff"
  }
});

