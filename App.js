import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Linking,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  useWindowDimensions,
  View
} from "react-native";
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
const SEARCH_SUGGESTION_DEBOUNCE_MS = 90;
const SEARCH_SUGGESTION_LIMIT = 4;
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
const WORDMARK_SEGMENTS = [
  { text: "open", color: OJS_COLORS.green },
  { text: "job", color: OJS_COLORS.focus },
  { text: "slots", color: OJS_COLORS.muted }
];
const PUBLIC_APP_VERSION = "1.5.14";
const PUBLIC_VERSION_LABEL = `Public v${PUBLIC_APP_VERSION}`;
const LINKEDIN_PROFILE_URL = "https://www.linkedin.com/in/batuhan-boran-320b311b7/";
const PUBLIC_RELEASE_NOTES = [
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
      "Expanded search quality coverage to 1000 deterministic title/filter cases and added clearer empty-state actions when a title, location, and remote-mode intersection has no indexed slots."
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
function createDefaultPostingsFilters() {
  return {
    ats: "all",
    industries: [],
    regions: [],
    countries: [],
    states: [],
    counties: [],
    remote: "all",
    hide_no_date: false
  };
}

function getPostingsFiltersSignature(filters = {}) {
  const normalizeArray = (value) => (Array.isArray(value) ? value.map(String).sort() : []);
  return JSON.stringify({
    ats: String(filters.ats || "all"),
    industries: normalizeArray(filters.industries),
    regions: normalizeArray(filters.regions),
    countries: normalizeArray(filters.countries),
    states: normalizeArray(filters.states),
    counties: normalizeArray(filters.counties),
    remote: String(filters.remote || "all"),
    hide_no_date: Boolean(filters.hide_no_date)
  });
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
  return {
    type: sanitizeDisplayText(source.type, fallbackType).trim() || fallbackType,
    value,
    label,
    count: Number(source.count || 1)
  };
}

function mergeSearchSuggestions(...groups) {
  const merged = [];
  const seen = new Set();
  groups.flat().forEach((item) => {
    const normalized = normalizeSearchSuggestionItem(item);
    if (!normalized) return;
    const key = `${normalized.type}:${normalizeSuggestionQuery(normalized.value)}`;
    if (seen.has(key)) return;
    seen.add(key);
    merged.push(normalized);
  });
  return merged;
}

function appendLocalSuggestion(candidates, type, value, label = value, count = 1) {
  const normalized = normalizeSearchSuggestionItem({ type, value, label, count }, type);
  if (normalized) {
    candidates.push(normalized);
  }
}

function buildLocalSearchSuggestions(query, limit = 5, context = {}) {
  const normalizedQuery = normalizeSuggestionQuery(query);
  if (normalizedQuery.length < 2) return [];

  const candidates = [];
  const filterOptions = context.postingFilterOptions || {};
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
    appendLocalSuggestion(candidates, "country", option?.value || option?.label, option?.label || option?.value, option?.count);
  });
  (filterOptions.regions || []).forEach((option) => {
    appendLocalSuggestion(candidates, "region", option?.value || option?.label, option?.label || option?.value, option?.count);
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

  if (scored.length > 0) return scored;
  return [{ type: "search", value: query.trim(), label: query.trim(), count: 1 }];
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
  savingApplicationIds,
  ignoringPostingIds,
  blockedCompanyNames,
  blockingCompanyNames,
  showAdminActions = false
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const postingUrl = String(item?.job_posting_url || "").trim();
  const onOpenPosting = useCallback(async () => {
    if (!postingUrl || !isSafeExternalHttpUrl(postingUrl)) return;
    const supported = await Linking.canOpenURL(postingUrl);
    if (supported) {
      await Linking.openURL(postingUrl);
    }
  }, [postingUrl]);

  const isSaving = Boolean(savingApplicationIds?.[postingUrl]);
  const isIgnoring = Boolean(ignoringPostingIds?.[postingUrl]);
  const normalizedCompanyName = normalizeCompanyName(item?.company_name);
  const isCompanyBlocked = blockedCompanyNames?.has(normalizedCompanyName);
  const isBlockingCompany = blockingCompanyNames?.has(normalizedCompanyName);
  const isApplied = Boolean(item?.applied);
  const saveDisabled = isSaving || isApplied || isIgnoring;
  const ignoreDisabled = isIgnoring;
  const blockDisabled = isCompanyBlocked || isBlockingCompany;
  const atsLabel = getAtsDisplayLabel(item?.ats);
  const positionName = sanitizeDisplayText(item?.position_name, "Unknown position");
  const locationLabel = sanitizeDisplayText(item?.location, "Location unavailable");
  const companyLabel = sanitizeDisplayText(item?.company_name, "Unknown company");
  const postingDateLabel = sanitizeDisplayText(item?.posting_date, "Posting date unavailable");
  const appliedByLabel = sanitizeDisplayText(item?.applied_by_label, "Application already tracked");
  const postingUrlLabel = sanitizeDisplayText(item?.job_posting_url, "");

  return (
    <View style={styles.card} testID="posting-card">
      <View style={styles.postingCardTopRow}>
        <Pressable
          onPress={onOpenPosting}
          style={({ pressed }) => [styles.postingCardMainPressArea, pressed ? styles.postingCardMainPressAreaPressed : null]}
          testID="posting-card-open"
          accessibilityRole="link"
          accessibilityLabel={`Open posting: ${positionName} at ${companyLabel}`}
        >
          <Text style={styles.position}>{positionName}</Text>
          <Text style={styles.location}>{locationLabel}</Text>
          <Text style={styles.company}>{companyLabel}</Text>
          <Text style={styles.ats}>ATS: {atsLabel}</Text>
          <Text style={styles.posted}>{postingDateLabel}</Text>
          {isApplied ? (
            <Text style={styles.postingAppliedNotice}>{appliedByLabel}</Text>
          ) : null}
          <Text numberOfLines={1} style={styles.url}>
            {postingUrlLabel}
          </Text>
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
  maxVisibleOptions = 80
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
            placeholder={`Search ${label.toLowerCase()}`}
            autoCapitalize="none"
            testID={`${testIdPart}-filter-search`}
            accessibilityLabel={`Search ${label}`}
          />

          <ScrollView style={styles.dropdownOptionsScroll}>
            {filteredOptions.length === 0 ? (
              <Text style={styles.dropdownEmpty}>
                {normalizedOptions.length === 0
                  ? emptyText || `${label} are not indexed yet. Worldwide search is still active.`
                  : `No ${label.toLowerCase()} match "${search}".`}
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
            Showing {filteredOptions.length} of {normalizedOptions.length} {label.toLowerCase()}.
          </Text>

          <Pressable
            onPress={onClear}
            style={({ pressed }) => [styles.dropdownClearBtn, pressed ? styles.buttonPressed : null]}
            testID={`${testIdPart}-filter-clear`}
            accessibilityRole="button"
          >
            <Text style={styles.dropdownClearBtnText}>Clear {label}</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

function SingleSelectDropdown({ label, options, selectedValue, onSelectValue, anyLabel = "Any" }) {
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
        testID={`${testIdPart}-filter-trigger`}
        accessibilityRole="button"
        accessibilityLabel={`${label} filter`}
      >
        <Text style={styles.dropdownTriggerLabel}>{label}</Text>
        <Text style={styles.dropdownTriggerValue}>{selectedOption?.label || anyLabel}</Text>
      </Pressable>

      {open ? (
        <View style={styles.dropdownPanel}>
          <ScrollView style={styles.dropdownOptionsScroll}>
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
                  testID={`${testIdPart}-filter-option-${toTestIdPart(value || option?.label)}`}
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

function ToggleRow({ label, value, onValueChange }) {
  return (
    <View style={styles.toggleRow}>
      <Text style={styles.toggleLabel}>{label}</Text>
      <Switch value={Boolean(value)} onValueChange={onValueChange} />
    </View>
  );
}

export default function App() {
  const { width: viewportWidth } = useWindowDimensions();
  const isDesktopViewport = Platform.OS === "web" && Number(viewportWidth || 0) >= 768;
  const [activePage, setActivePage] = useState(PAGE_KEYS.POSTINGS);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [releaseNotesOpen, setReleaseNotesOpen] = useState(false);
  const [postingsFilters, setPostingsFilters] = useState(createDefaultPostingsFilters);
  const [postingFilterOptions, setPostingFilterOptions] = useState({
    ats: DEFAULT_ATS_FILTER_OPTIONS,
    industries: [],
    regions: [],
    countries: [],
    states: [],
    counties: []
  });
  const [postingFilterOptionsLoading, setPostingFilterOptionsLoading] = useState(false);
  const [postingsFilterPanelOpen, setPostingsFilterPanelOpen] = useState(false);
  const [postings, setPostings] = useState([]);
  const [postingsTotalCount, setPostingsTotalCount] = useState(0);
  const [postingsHasMore, setPostingsHasMore] = useState(false);
  const [postingsNextOffset, setPostingsNextOffset] = useState(0);
  const [postingsLoadingMore, setPostingsLoadingMore] = useState(false);
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
  const [searchResultsMode, setSearchResultsMode] = useState(false);
  const [coverageDetailsOpen, setCoverageDetailsOpen] = useState(false);
  const [status, setStatus] = useState(null);
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
  const postingsListRef = useRef(null);
  const searchRef = useRef("");
  const lastSearchSubmitRef = useRef({ value: "", at: 0 });
  const suppressedSuggestionQueryRef = useRef("");
  const postingsFiltersRef = useRef(postingsFilters);
  const autoSyncInFlightRef = useRef(false);
  const statusPollInFlightRef = useRef(false);
  const postingsRefreshInFlightRef = useRef(false);
  const lastPostingRefreshAtRef = useRef(0);
  const wasSyncRunningRef = useRef(false);
  const postingsRequestSequenceRef = useRef(0);
  const postingsRef = useRef([]);
  const postingsHasMoreRef = useRef(false);
  const postingsNextOffsetRef = useRef(0);
  const postingsLoadingMoreRef = useRef(false);
  const showScrollTopButtonRef = useRef(false);
  const applicationsRequestSequenceRef = useRef(0);
  const frontendLogQueueRef = useRef([]);
  const frontendLogFlushInFlightRef = useRef(false);
  const lastFrontendLogFlushAtRef = useRef(0);
  const syncNoticeTimerRef = useRef(null);
  const searchSuggestionCacheRef = useRef(new Map());
  const recentSearchesRef = useRef([]);
  const prefersReducedMotionRef = useRef(false);
  const searchMotionRef = useRef(new Animated.Value(0));
  const suggestionsMotionRef = useRef(new Animated.Value(0));
  const resultsMotionRef = useRef(new Animated.Value(0));

  const pageTitle = PAGE_TITLES[activePage] || PAGE_TITLES[PAGE_KEYS.POSTINGS];
  const flushFrontendLogs = useCallback(async () => {
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
  }, []);

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
  const handleOpenLinkedInCredit = useCallback(async () => {
    try {
      if (!isSafeExternalHttpUrl(LINKEDIN_PROFILE_URL)) return;
      const supported = await Linking.canOpenURL(LINKEDIN_PROFILE_URL);
      if (supported) {
        await Linking.openURL(LINKEDIN_PROFILE_URL);
      }
    } catch {
      // Non-critical attribution link; ignore platform/browser launch failures.
    }
  }, []);
  const remoteFilterOptions = useMemo(
    () => [
      { value: "all", label: "All Locations" },
      { value: "remote", label: "Remote Only" },
      { value: "hybrid", label: "Hybrid Only" },
      { value: "non_remote", label: "On-Site / Unknown" }
    ],
    []
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
    const syncEnabledCompanies = Number(status.sync_enabled_company_count ?? summary.sync_enabled_company_count ?? 0);
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
      { label: "Indexed slots", value: formatCompactNumberLabel(status.posting_count || 0) },
      { label: "Seen in 24h", value: formatCompactNumberLabel(status.postings_seen_24h_count || 0) },
      { label: "Sync companies", value: formatCompactNumberLabel(syncEnabledCompanies) },
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
  }, [status]);

  const hasActivePostingFilters = useMemo(() => {
    return (
      postingsFilters.ats !== "all" ||
      (postingsFilters.industries || []).length > 0 ||
      (postingsFilters.regions || []).length > 0 ||
      (postingsFilters.countries || []).length > 0 ||
      (postingsFilters.states || []).length > 0 ||
      (postingsFilters.counties || []).length > 0 ||
      postingsFilters.remote !== "all" ||
      Boolean(postingsFilters.hide_no_date)
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

  const searchQueryText = String(search || "").trim();
  const showResultsSurface = searchResultsMode || hasActivePostingFilters;
  const searchUiMode = showResultsSurface ? "results" : searchQueryText ? "suggest" : "home";
  const searchShellCompact = searchUiMode === "results";
  const suggestionsVisible = searchSuggestionsOpen && searchSuggestions.length > 0;
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
    setActivePage(page);
    setDrawerOpen(false);
  }, []);

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

  const loadPostings = useCallback(async (q, options = {}) => {
    const append = Boolean(options.append);
    const silent = Boolean(options.silent);
    const filters = options.filters || postingsFiltersRef.current;
    const limit = Math.max(1, Math.min(500, Number(options.limit || FRONTEND_POSTINGS_PAGE_SIZE)));
    const offset = append
      ? Math.max(0, Number(options.offset ?? postingsNextOffsetRef.current ?? postingsRef.current.length))
      : 0;
    const requestSequence = append
      ? postingsRequestSequenceRef.current
      : postingsRequestSequenceRef.current + 1;

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
    }
    setError("");
    try {
      const response = await fetchPostings(q, limit, offset, filters);
      if (requestSequence !== postingsRequestSequenceRef.current) {
        return;
      }
      const normalizedItems = normalizePostingItems(response?.items);
      const nextVisibleItems = append
        ? mergePostingItems(postingsRef.current, normalizedItems)
        : normalizedItems;
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
      setPostingsTotalCount(totalCount);
      setPostingsNextOffset(nextOffset);
      setPostingsHasMore(Boolean(responseHasMore && normalizedItems.length > 0));
      setSearchNotice("");
      lastPostingRefreshAtRef.current = Date.now();
    } catch (e) {
      if (requestSequence === postingsRequestSequenceRef.current) {
        if (e?.isTransientBusy) {
          setSearchNotice("Showing the latest results while indexing catches up. Search will retry shortly.");
        } else if (!append) {
          setError(String(e.message || e));
        } else {
          setSearchNotice("Could not load the next result page. Try scrolling again in a moment.");
        }
        queueFrontendLog("error", append ? "load_more_postings_failed" : "load_postings_failed", String(e?.stack || e?.message || e), {
          search: q,
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
  }, [queueFrontendLog]);

  const loadPostingFilterOptions = useCallback(async () => {
    setPostingFilterOptionsLoading(true);
    try {
      const response = await fetchPostingFilterOptions();
      setPostingFilterOptions({
        ats: mergeAtsFilterOptions(response?.ats),
        industries: Array.isArray(response?.industries) ? response.industries : [],
        regions: Array.isArray(response?.regions) ? response.regions : [],
        countries: Array.isArray(response?.countries) ? response.countries : [],
        states: Array.isArray(response?.states) ? response.states : [],
        counties: Array.isArray(response?.counties) ? response.counties : []
      });
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setPostingFilterOptionsLoading(false);
    }
  }, []);

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
    setActivePage(PAGE_KEYS.APPLICATIONS);
    setDrawerOpen(false);
    loadApplications({ silent: false });
  }, [loadApplications]);

  const loadStatus = useCallback(async () => {
    try {
      const response = await fetchSyncStatus();
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
      setError(String(e.message || e));
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

  const submitSearch = useCallback((value = searchRef.current) => {
    const nextSearch = String(value || "").trim();
    const now = Date.now();
    const filters = postingsFiltersRef.current;
    const filtersSignature = getPostingsFiltersSignature(filters);
    const lastSubmit = lastSearchSubmitRef.current || { value: "", at: 0 };
    const duplicateSubmit =
      lastSubmit.value === nextSearch &&
      lastSubmit.filtersSignature === filtersSignature &&
      now - lastSubmit.at < 250;
    lastSearchSubmitRef.current = { value: nextSearch, filtersSignature, at: now };
    suppressedSuggestionQueryRef.current = nextSearch;
    if (nextSearch) {
      recentSearchesRef.current = [
        nextSearch,
        ...recentSearchesRef.current.filter((item) => normalizeSuggestionQuery(item) !== normalizeSuggestionQuery(nextSearch))
      ].slice(0, 8);
    }
    setSearchResultsMode(true);
    setSearch(nextSearch);
    setSearchSuggestionsOpen(false);
    setActiveSuggestionIndex(-1);
    scrollPostingsToTop();
    if (!duplicateSubmit) {
      void loadPostings(nextSearch, { filters });
    }
  }, [loadPostings, scrollPostingsToTop]);

  const clearSearchAndSuggestions = useCallback(() => {
    const defaultFilters = createDefaultPostingsFilters();
    lastSearchSubmitRef.current = {
      value: "",
      filtersSignature: getPostingsFiltersSignature(defaultFilters),
      at: Date.now()
    };
    suppressedSuggestionQueryRef.current = "";
    setSearch("");
    setPostingsFilters(defaultFilters);
    setPostingsFilterPanelOpen(false);
    setSearchResultsMode(false);
    setSearchSuggestionsOpen(false);
    setActiveSuggestionIndex(-1);
    scrollPostingsToTop();
    void loadPostings("", { filters: defaultFilters });
  }, [loadPostings, scrollPostingsToTop]);

  const selectSearchSuggestion = useCallback((suggestion) => {
    const value = String(suggestion?.value || suggestion?.label || "").trim();
    if (!value) return;
    submitSearch(value);
  }, [submitSearch]);

  const handleBrandHome = useCallback(() => {
    const defaultFilters = createDefaultPostingsFilters();
    setActivePage(PAGE_KEYS.POSTINGS);
    setDrawerOpen(false);
    setSearch("");
    setPostingsFilters(defaultFilters);
    setPostingsFilterPanelOpen(false);
    setSearchResultsMode(false);
    setSearchSuggestionsOpen(false);
    setActiveSuggestionIndex(-1);
    suppressedSuggestionQueryRef.current = "";
    lastSearchSubmitRef.current = {
      value: "",
      filtersSignature: getPostingsFiltersSignature(defaultFilters),
      at: Date.now()
    };
    scrollPostingsToTop();
    void loadPostings("", { filters: defaultFilters });
    setTimeout(() => searchInputRef.current?.focus?.(), 0);
  }, [loadPostings, scrollPostingsToTop]);

  const handleSearchChange = useCallback((value) => {
    const nextValue = String(value || "");
    if (suppressedSuggestionQueryRef.current !== nextValue.trim()) {
      suppressedSuggestionQueryRef.current = "";
    }
    setSearch(nextValue);
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
    setPostingsFilters((prev) => ({
      ...prev,
      ats: nextValue || "all"
    }));
  }, []);

  const toggleIndustryFilter = useCallback((value) => {
    setSearchResultsMode(true);
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

  const clearLocationPostingFilters = useCallback(() => {
    applyPostingsFiltersImmediately({
      ...postingsFiltersRef.current,
      regions: [],
      countries: [],
      states: [],
      counties: []
    });
  }, [applyPostingsFiltersImmediately]);

  const clearRemotePostingFilter = useCallback(() => {
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
    Animated.timing(searchMotionRef.current, {
      toValue: searchShellCompact ? 1 : 0,
      duration: prefersReducedMotionRef.current ? 0 : 300,
      useNativeDriver: true
    }).start();
  }, [searchShellCompact]);

  useEffect(() => {
    Animated.timing(suggestionsMotionRef.current, {
      toValue: suggestionsVisible ? 1 : 0,
      duration: prefersReducedMotionRef.current ? 0 : 180,
      useNativeDriver: true
    }).start();
  }, [suggestionsVisible]);

  useEffect(() => {
    Animated.timing(resultsMotionRef.current, {
      toValue: showResultsSurface ? 1 : 0,
      duration: prefersReducedMotionRef.current ? 0 : 320,
      useNativeDriver: true
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
    if (!isDesktopViewport && releaseNotesOpen) {
      setReleaseNotesOpen(false);
    }
  }, [isDesktopViewport, releaseNotesOpen]);

  useEffect(() => {
    if (Platform.OS !== "web") return undefined;

    const handleGlobalKeyDown = (event) => {
      const tagName = String(event?.target?.tagName || "").toLowerCase();
      const isEditableTarget = tagName === "input" || tagName === "textarea" || Boolean(event?.target?.isContentEditable);
      const targetTestId = String(event?.target?.getAttribute?.("data-testid") || "");
      if (event.key === "Escape") {
        if (drawerOpen) {
          event.preventDefault();
          setDrawerOpen(false);
          return;
        }
        if (isEditableTarget && targetTestId !== "postings-search-input") {
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
  }, [activePage, clearSearchAndSuggestions, drawerOpen, focusSearch]);

  useEffect(() => {
    if (activePage !== PAGE_KEYS.POSTINGS) return undefined;
    const query = String(search || "").trim();
    const cacheKey = normalizeSuggestionQuery(query);
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
    const cachedItems =
      cached && Date.now() - Number(cached.at || 0) < SEARCH_SUGGESTION_CACHE_TTL_MS
        ? Array.isArray(cached.items)
          ? cached.items
          : []
        : [];
    const localItems = buildLocalSearchSuggestions(query, SEARCH_SUGGESTION_LIMIT, {
      postingFilterOptions,
      postings,
      recentSearches: recentSearchesRef.current
    });
    const immediateItems = mergeSearchSuggestions(cachedItems, localItems).slice(0, SEARCH_SUGGESTION_LIMIT);
    setSearchSuggestions(immediateItems);
    setSearchSuggestionsOpen(immediateItems.length > 0);
    setActiveSuggestionIndex(-1);

    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        if (suppressedSuggestionQueryRef.current === query) return;
        const response = await fetchSearchSuggestions(query, SEARCH_SUGGESTION_LIMIT);
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
        queueFrontendLog("warn", "search_suggestions_failed", String(e?.message || e), { search: query });
      }
    }, SEARCH_SUGGESTION_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [activePage, postingFilterOptions, postings, queueFrontendLog, search]);

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
    const bootstrap = async () => {
      setInitializing(true);
      setError("");
      try {
        await Promise.all([
          loadPostings("", { filters: postingsFiltersRef.current }),
          loadStatus(),
          loadPostingFilterOptions()
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
    loadStatus,
    loadPostingFilterOptions
  ]);

  useEffect(() => {
    const query = String(search || "").trim();
    const filtersSignature = getPostingsFiltersSignature(postingsFilters);
    const lastSubmit = lastSearchSubmitRef.current || {};
    if (
      lastSubmit.value === query &&
      lastSubmit.filtersSignature === filtersSignature &&
      Date.now() - Number(lastSubmit.at || 0) < 1900
    ) {
      return undefined;
    }
    const timer = setTimeout(() => {
      loadPostings(search, { filters: postingsFilters });
    }, 1800);
    return () => clearTimeout(timer);
  }, [search, postingsFilters, loadPostings]);

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
    if (activePage !== PAGE_KEYS.APPLICATIONS) return;
    loadApplications({ silent: false });
  }, [activePage, loadApplications]);

  useEffect(() => {
    if (activePage !== PAGE_KEYS.SETTINGS_APPLICANTEE) return;
    loadPersonalInformation({ silent: false });
  }, [activePage, loadPersonalInformation]);

  useEffect(() => {
    if (activePage !== PAGE_KEYS.SETTINGS_SYNC) return;
    loadSyncServiceSettings({ silent: false });
    loadBlockedCompanies({ silent: false });
  }, [activePage, loadBlockedCompanies, loadSyncServiceSettings]);

  useEffect(() => {
    if (activePage !== PAGE_KEYS.SETTINGS_MCP) return;
    loadMcpSettings({ silent: false });
  }, [activePage, loadMcpSettings]);

  useEffect(() => {
    if (activePage !== PAGE_KEYS.POSTINGS) return;
    loadStatus();
    loadPostingFilterOptions();
  }, [activePage, loadStatus, loadPostingFilterOptions]);

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
      visible={releaseNotesOpen && isDesktopViewport}
      onRequestClose={() => setReleaseNotesOpen(false)}
    >
      <View style={styles.releaseNotesOverlay} testID="release-notes-modal">
        <Pressable
          style={styles.releaseNotesBackdrop}
          onPress={() => setReleaseNotesOpen(false)}
          accessibilityRole="button"
          accessibilityLabel="Close release notes"
        />
        <View style={styles.releaseNotesCard}>
          <View style={styles.releaseNotesHeader}>
            <View style={styles.releaseNotesHeaderCopy}>
              <Text style={styles.releaseNotesTitle}>Release notes</Text>
            </View>
            <Pressable
              onPress={() => setReleaseNotesOpen(false)}
              style={({ pressed }) => [styles.releaseNotesCloseButton, pressed ? styles.buttonPressed : null]}
              testID="release-notes-close"
              accessibilityRole="button"
              accessibilityLabel="Close release notes"
            >
              <Text style={styles.releaseNotesCloseText}>Close</Text>
            </Pressable>
          </View>
          <ScrollView style={styles.releaseNotesScroll} contentContainerStyle={styles.releaseNotesScrollContent}>
            {PUBLIC_RELEASE_NOTES.map((release) => (
              <View key={release.version} style={styles.releaseNoteItem}>
                <View style={styles.releaseNoteHeadingRow}>
                  <Text style={styles.releaseNoteVersion}>Version {release.version}</Text>
                  <Text style={styles.releaseNoteDate}>{release.date}</Text>
                </View>
                <Text style={styles.releaseNoteTitle}>{release.title}</Text>
                <Text style={styles.releaseNoteSummary}>{release.summary}</Text>
              </View>
            ))}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );

  const renderPostingsPage = () => (
    <View style={styles.postingsPageFrame}>
      <ScrollView
        ref={postingsListRef}
        style={styles.postingsPageScroll}
        contentContainerStyle={styles.postingsPageContent}
        keyboardShouldPersistTaps="handled"
        onScroll={handlePostingsScroll}
        scrollEventThrottle={250}
        testID="postings-page-scroll"
      >
      <Animated.View
        style={[
          styles.searchShell,
          searchShellCompact ? styles.searchShellCompact : styles.searchShellHome,
          searchUiMode === "suggest" ? styles.searchShellSuggest : null,
          postingsFilterPanelOpen && !showResultsSurface ? styles.searchShellFilterOpen : null,
          Platform.OS === "web" ? styles.webSmoothMotion : null,
          searchMotionStyle
        ]}
        testID="search-shell"
      >
        {isDesktopViewport && searchUiMode !== "results" ? (
          <View pointerEvents="box-none" style={styles.searchMetaRail}>
            <Pressable
              onPress={() => setReleaseNotesOpen(true)}
              style={({ pressed }) => [styles.publicVersionButton, pressed ? styles.publicVersionButtonPressed : null]}
              testID="public-version-button"
              accessibilityRole="button"
              accessibilityLabel={`Open release notes for version ${PUBLIC_APP_VERSION}`}
            >
              <Text style={styles.publicVersionLabel}>{PUBLIC_VERSION_LABEL}</Text>
            </Pressable>
            <Text style={styles.searchCreditText}>
              Deployed and developed by{" "}
              <Text
                href={LINKEDIN_PROFILE_URL}
                hrefAttrs={{ target: "_blank", rel: "noopener noreferrer" }}
                onPress={handleOpenLinkedInCredit}
                style={styles.searchCreditLink}
                accessibilityRole="link"
                accessibilityLabel="Batuhan Boran LinkedIn profile"
              >
                Batuhan Boran
              </Text>
            </Text>
          </View>
        ) : null}
        <Pressable
          onPress={handleBrandHome}
          style={({ pressed }) => [styles.brandWordmark, pressed ? styles.brandWordmarkPressed : null]}
          testID="brand-wordmark"
          accessibilityRole="link"
          accessibilityLabel="openjobslots home"
        >
          {WORDMARK_SEGMENTS.map((segment, index) => (
            <Text
              key={`brand-wordmark-${segment.text}-${index}`}
              style={[
                styles.brandWordmarkLetter,
                searchShellCompact ? styles.brandWordmarkLetterCompact : null,
                { color: segment.color }
              ]}
            >
              {segment.text}
            </Text>
          ))}
        </Pressable>
        <Text style={[styles.searchLead, searchShellCompact ? styles.searchLeadCompact : null]}>
          Find fresh openings across public ATS job boards.
        </Text>
        <View style={styles.searchBoxRow}>
          <TextInput
            ref={searchInputRef}
            style={[styles.search, searchShellCompact ? styles.searchCompact : null]}
            value={search}
            onChangeText={handleSearchChange}
            onSubmitEditing={() => submitSearch(search)}
            onKeyPress={handleSearchKeyPress}
            placeholder="Search title, company, location, or country"
            autoCapitalize="none"
            returnKeyType="search"
            blurOnSubmit={false}
            testID="postings-search-input"
            accessibilityLabel="Search postings"
          />
        </View>
        <View
          style={[
            styles.searchLowerRail,
            searchShellCompact ? styles.searchLowerRailCompact : null,
            postingsFilterPanelOpen && !showResultsSurface ? styles.searchLowerRailFiltersOpen : null
          ]}
        >
          {suggestionsVisible ? (
            <Animated.View
              style={[styles.searchSuggestionsPanel, suggestionsMotionStyle]}
              testID="search-suggestions-panel"
            >
              {searchSuggestions.map((suggestion, index) => {
                const label = String(suggestion?.label || suggestion?.value || "").trim();
                const hint = String(suggestion?.type || "").trim();
                const selected = index === activeSuggestionIndex;
                return (
                  <Pressable
                    key={`${hint}-${label}-${index}`}
                    onPress={() => selectSearchSuggestion(suggestion)}
                    style={[styles.searchSuggestionItem, selected ? styles.searchSuggestionItemActive : null]}
                    testID={`search-suggestion-${index}`}
                    accessibilityRole="button"
                    accessibilityLabel={`Search ${label}`}
                  >
                    <Text numberOfLines={1} style={styles.searchSuggestionLabel}>{label}</Text>
                    {hint ? <Text numberOfLines={1} style={styles.searchSuggestionHint}>{hint}</Text> : null}
                  </Pressable>
                );
              })}
            </Animated.View>
          ) : (
            <>
              <Text style={styles.searchShortcutHint}>Enter to search · Esc to clear</Text>
              {searchNotice ? (
                <Text style={styles.searchNotice} testID="search-notice" accessibilityRole="status">
                  {searchNotice}
                </Text>
              ) : null}
              <View style={styles.searchActionsRow}>
                <Pressable
                  onPress={() => setPostingsFilterPanelOpen((prev) => !prev)}
                  style={({ pressed }) => [styles.postingsFiltersToggleBtn, pressed ? styles.buttonPressed : null]}
                  testID="postings-filter-toggle"
                  accessibilityRole="button"
                  accessibilityLabel={postingsFilterPanelOpen ? "Hide posting filters" : "Show posting filters"}
                >
                  <Text style={styles.postingsFiltersToggleText}>
                    {postingsFilterPanelOpen ? "Hide filters" : "Filters"}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={clearAllPostingFilters}
                  style={({ pressed }) => [styles.postingsFiltersClearBtn, pressed ? styles.buttonPressed : null]}
                  testID="postings-filter-clear"
                  accessibilityRole="button"
                  accessibilityLabel="Clear posting filters"
                >
                  <Text style={styles.postingsFiltersClearText}>Clear</Text>
                </Pressable>
              </View>
              {syncNotice ? (
                <Text style={styles.syncNotice} testID="sync-action-notice" accessibilityRole="status">
                  {syncNotice}
                </Text>
              ) : null}
            </>
          )}
        </View>
      </Animated.View>

      {postingsFilterPanelOpen ? (
        <View style={styles.postingsFiltersPanel} testID="filters-panel">
          <View style={styles.postingsFiltersPanelContent}>
            {postingFilterOptionsLoading ? (
              <Text style={styles.small}>Loading filter options...</Text>
            ) : (
              <>
                <View style={styles.postingsFiltersIntro}>
                  <Text style={styles.postingsFiltersIntroTitle}>Worldwide filters</Text>
                  <Text style={styles.postingsFiltersIntroText}>
                    Search stays global until you choose a region, country, or remote mode.
                  </Text>
                </View>
                <SingleSelectDropdown
                  label="ATS"
                  options={postingFilterOptions.ats}
                  selectedValue={postingsFilters.ats}
                  onSelectValue={setAtsFilter}
                  anyLabel="All ATS"
                />

                <MultiSelectDropdown
                  label="Industries"
                  options={postingFilterOptions.industries}
                  selectedValues={postingsFilters.industries}
                  onToggleValue={toggleIndustryFilter}
                  onClear={() =>
                    setPostingsFilters((prev) => ({
                      ...prev,
                      industries: []
                    }))
                  }
                  emptyText="No industries available."
                  helperText="Optional. Leave empty to search every indexed industry."
                  anyLabel="Any industry"
                />

                <MultiSelectDropdown
                  label="Regions"
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
                  emptyText="Worldwide search is active. Region metadata is not indexed yet."
                  helperText="Start broad by continent, then narrow to countries when useful."
                  anyLabel="Worldwide"
                />

                <MultiSelectDropdown
                  label="Countries"
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
                      ? "No countries match the selected region yet. Clear Regions to search worldwide."
                      : "Country metadata is not indexed yet. Worldwide search is still active."
                  }
                  helperText={
                    postingsFilters.regions?.length
                      ? "Countries are limited by the selected region."
                      : "Leave empty to include every country."
                  }
                  anyLabel="All countries"
                />

                {(postingsFilters.countries || []).length > 0 || (postingsFilters.states || []).length > 0 ? (
                  <MultiSelectDropdown
                    label="States"
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
                    emptyText="No states or provinces are indexed for the selected countries."
                    helperText="Shown after country selection. Leave empty to include all states/provinces."
                    anyLabel="All states/provinces"
                  />
                ) : (
                  <Text style={styles.contextualFilterHint}>
                    Choose a country to narrow by state or province.
                  </Text>
                )}

                {(postingsFilters.states || []).length > 0 || (postingsFilters.counties || []).length > 0 ? (
                  <MultiSelectDropdown
                    label="Counties"
                    options={visibleCountyOptions}
                    selectedValues={postingsFilters.counties}
                    onToggleValue={toggleCountyFilter}
                    onClear={() =>
                      setPostingsFilters((prev) => ({
                        ...prev,
                        counties: []
                      }))
                    }
                    emptyText="No counties match selected states."
                    helperText="Shown after state selection for sources that include county metadata."
                    anyLabel="All counties"
                  />
                ) : (
                  <Text style={styles.contextualFilterHint}>
                    Choose a state/province to narrow by county when county data exists.
                  </Text>
                )}
              </>
            )}

            <View style={styles.remoteFilterGroup}>
              <Text style={styles.fieldLabel}>Remote Filter</Text>
              <View style={styles.remoteFilterChipsRow}>
                {remoteFilterOptions.map((option) => {
                  const selected = postingsFilters.remote === option.value;
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
                        styles.remoteFilterChip,
                        selected ? styles.remoteFilterChipActive : null,
                        pressed ? styles.buttonPressed : null
                      ]}
                      testID={`remote-filter-${option.value}`}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                    >
                      <Text style={[styles.remoteFilterChipText, selected ? styles.remoteFilterChipTextActive : null]}>
                        {option.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              <View style={styles.remoteNoDateToggleRow}>
                <Text style={styles.remoteNoDateToggleLabel}>Hide postings with no date</Text>
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
          </View>
        </View>
      ) : null}

      {showResultsSurface ? (
        <Animated.View
          style={[styles.resultsSurface, Platform.OS === "web" ? styles.resultsSurfaceMotion : null, resultsMotionStyle]}
          testID="results-surface"
        >
          {renderSyncStatusPanel()}
          {loading && !initializing ? (
            <Text style={styles.postingsRefreshIndicator} testID="postings-refresh-indicator" accessibilityRole="status">
              Updating visible results...
            </Text>
          ) : null}
          {applicationsNotice ? <Text style={styles.inlineNotice}>{applicationsNotice}</Text> : null}

          {initializing && postings.length === 0 ? (
            <ActivityIndicator size="large" style={styles.loader} />
          ) : (
            <View style={styles.list} testID="postings-list">
              {postings.length === 0 ? (
                <View style={styles.emptyState} testID="postings-empty-state">
                  <Text style={styles.emptyTitle}>No slots match this exact search.</Text>
                  <Text style={styles.emptyText}>
                    The title can exist globally while the selected location or work mode has no indexed match yet.
                  </Text>
                  <View style={styles.emptyActions}>
                    {hasLocationPostingFilters ? (
                      <Pressable
                        onPress={clearLocationPostingFilters}
                        style={({ pressed }) => [styles.emptyActionButton, styles.emptyActionPrimary, pressed ? styles.buttonPressed : null]}
                        testID="empty-clear-location-filters"
                        accessibilityRole="button"
                      >
                        <Text style={styles.emptyActionPrimaryText}>Search all locations</Text>
                      </Pressable>
                    ) : null}
                    {hasRemotePostingFilter ? (
                      <Pressable
                        onPress={clearRemotePostingFilter}
                        style={({ pressed }) => [styles.emptyActionButton, pressed ? styles.buttonPressed : null]}
                        testID="empty-clear-remote-filter"
                        accessibilityRole="button"
                      >
                        <Text style={styles.emptyActionText}>All work modes</Text>
                      </Pressable>
                    ) : null}
                    {hasActivePostingFilters ? (
                      <Pressable
                        onPress={clearAllPostingFilters}
                        style={({ pressed }) => [styles.emptyActionButton, pressed ? styles.buttonPressed : null]}
                        testID="empty-clear-all-filters"
                        accessibilityRole="button"
                      >
                        <Text style={styles.emptyActionText}>Clear filters</Text>
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
                    savingApplicationIds={savingApplicationIds}
                    ignoringPostingIds={ignoringPostingIds}
                    blockedCompanyNames={blockedCompanyNames}
                    blockingCompanyNames={blockingCompanyNamesSet}
                  />
                ))
              )}
            </View>
          )}
          {!initializing && postings.length > 0 ? (
            <View style={styles.postingsPagingFooter} testID="postings-pagination-status" accessibilityRole="status">
              <Text style={styles.postingsPagingText}>
                Showing {formatCompactNumberLabel(postings.length)} of{" "}
                {formatCompactNumberLabel(Math.max(postingsTotalCount, postings.length))} slots
              </Text>
              <View style={styles.postingsPagingStateRow}>
                {postingsLoadingMore ? <ActivityIndicator size="small" color={OJS_COLORS.green} /> : null}
                <Text style={styles.postingsPagingHint}>
                  {postingsLoadingMore
                    ? "Loading more slots..."
                    : postingsHasMore
                      ? "Scroll to load more"
                      : "All visible slots loaded"}
                </Text>
              </View>
            </View>
          ) : null}
        </Animated.View>
      ) : null}
      </ScrollView>
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
      {isDesktopViewport ? renderReleaseNotesModal() : null}
    </View>
  );

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
          <View style={styles.modalBackdrop} pointerEvents="none" />
          <View style={styles.modalCard}>
            <View style={styles.modalCloseRow} pointerEvents="box-none">
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
    if (activePage === PAGE_KEYS.APPLICATIONS) return renderApplicationsPage();
    if (activePage === PAGE_KEYS.SETTINGS_APPLICANTEE) return renderApplicanteeSettingsPage();
    if (activePage === PAGE_KEYS.SETTINGS_SYNC) return renderSyncSettingsPage();
    if (activePage === PAGE_KEYS.SETTINGS_MCP) return renderMcpSettingsPage();
    return renderPostingsPage();
  };

  const renderHeaderNav = () => {
    if (activePage === PAGE_KEYS.POSTINGS) {
      return null;
    }
    return (
      <View style={styles.headerNav} testID="top-nav">
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
    <SafeAreaView style={styles.container}>
      <View style={[styles.header, activePage === PAGE_KEYS.POSTINGS ? styles.headerCompact : null]}>
        <View style={styles.headerTopRow}>
          {activePage !== PAGE_KEYS.POSTINGS ? (
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
          ) : (
            <View style={styles.headerPublicSpacer} />
          )}
          {renderHeaderNav()}
        </View>
        {activePage !== PAGE_KEYS.POSTINGS ? <Text style={styles.pageTitle}>{pageTitle}</Text> : null}
      </View>

      {error ? (
        <Text style={styles.error} testID="app-error-message" accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
      {renderActivePage()}

      {drawerOpen && activePage !== PAGE_KEYS.POSTINGS ? (
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
    backgroundColor: OJS_COLORS.bg
  },
  header: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 6,
    backgroundColor: OJS_COLORS.bg
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
  postingsPageScroll: {
    flex: 1,
    backgroundColor: OJS_COLORS.bg,
    ...(Platform.OS === "web"
      ? {
          scrollbarColor: `${OJS_COLORS.border} ${OJS_COLORS.bg}`,
          scrollbarWidth: "thin"
        }
      : {})
  },
  postingsPageFrame: {
    flex: 1,
    position: "relative",
    backgroundColor: OJS_COLORS.bg
  },
  postingsPageContent: {
    paddingBottom: 20
  },
  webSmoothMotion: {
    transitionProperty: "min-height, padding, margin, transform, opacity",
    transitionDuration: "300ms",
    transitionTimingFunction: "cubic-bezier(0.2, 0, 0, 1)"
  },
  searchShell: {
    position: "relative",
    alignSelf: "center",
    width: "100%",
    maxWidth: 980,
    paddingHorizontal: 16,
    alignItems: "center",
    justifyContent: "center"
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
    position: "absolute",
    top: Platform.OS === "web" ? 14 : 10,
    left: 16,
    right: 16,
    zIndex: 3,
    elevation: 3,
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12
  },
  publicVersionButton: {
    flexShrink: 1,
    maxWidth: "36%",
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4
  },
  publicVersionButtonPressed: {
    backgroundColor: OJS_COLORS.surfaceMuted,
    transform: [{ scale: 0.985 }]
  },
  publicVersionLabel: {
    color: OJS_COLORS.muted,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: "700",
    letterSpacing: 0
  },
  searchCreditText: {
    flexShrink: 1,
    maxWidth: "62%",
    textAlign: "right",
    color: OJS_COLORS.muted,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: "600",
    letterSpacing: 0
  },
  searchCreditLink: {
    color: OJS_COLORS.green,
    fontWeight: "800",
    textDecorationLine: "underline"
  },
  brandWordmark: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "center",
    marginTop: 2,
    paddingHorizontal: 10,
    paddingVertical: 2,
    borderRadius: 24
  },
  brandWordmarkPressed: {
    backgroundColor: OJS_COLORS.surfaceMuted,
    transform: [{ scale: 0.992 }]
  },
  brandWordmarkLetter: {
    fontSize: 44,
    lineHeight: 50,
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
    marginBottom: 18,
    textAlign: "center",
    fontSize: 13,
    color: OJS_COLORS.muted
  },
  searchLeadCompact: {
    marginTop: 0,
    marginBottom: 7,
    fontSize: 12,
    lineHeight: 16
  },
  searchBoxRow: {
    width: "100%",
    maxWidth: 760
  },
  searchLowerRail: {
    width: "100%",
    maxWidth: 760,
    minHeight: Platform.OS === "web" ? 170 : 170,
    alignItems: "center"
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
  searchActionsRow: {
    marginTop: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
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
    alignSelf: "center",
    width: "100%",
    maxWidth: 1160,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: OJS_COLORS.softBorder,
    borderRadius: 14,
    backgroundColor: OJS_COLORS.surface,
    padding: 10
  },
  postingsFiltersPanelContent: {
    paddingBottom: 4
  },
  postingsFiltersIntro: {
    borderWidth: 1,
    borderColor: OJS_COLORS.softBorder,
    borderRadius: 12,
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
    fontWeight: "700",
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
  search: {
    borderWidth: 1,
    borderColor: OJS_COLORS.border,
    borderRadius: 30,
    backgroundColor: OJS_COLORS.surface,
    paddingHorizontal: 24,
    height: 58,
    fontSize: 16,
    color: OJS_COLORS.ink,
    shadowColor: OJS_COLORS.shadow,
    shadowOpacity: 0.1,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 6 },
    ...(Platform.OS === "web"
      ? {
          outlineColor: OJS_COLORS.focus,
          outlineOffset: 2,
          transitionProperty: "border-color, box-shadow, transform",
          transitionDuration: "180ms",
          transitionTimingFunction: "cubic-bezier(0.2, 0, 0, 1)"
        }
      : {})
  },
  searchCompact: {
    height: 48,
    paddingHorizontal: 20,
    fontSize: 15
  },
  searchSuggestionsPanel: {
    width: "100%",
    maxWidth: 760,
    alignSelf: "center",
    marginTop: 9,
    overflow: "hidden",
    zIndex: 4,
    elevation: 4,
    borderWidth: 1,
    borderColor: OJS_COLORS.softBorder,
    borderRadius: 22,
    backgroundColor: OJS_COLORS.surface,
    paddingVertical: 6,
    shadowColor: OJS_COLORS.shadow,
    shadowOpacity: 0.1,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 5 },
    ...(Platform.OS === "web"
      ? {
          transitionProperty: "opacity, transform, margin, max-height",
          transitionDuration: "180ms",
          transitionTimingFunction: "cubic-bezier(0.2, 0, 0, 1)"
        }
      : {})
  },
  searchSuggestionItem: {
    minHeight: 44,
    paddingHorizontal: 14,
    paddingVertical: 7,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10
  },
  searchSuggestionItemActive: {
    backgroundColor: OJS_COLORS.surfaceMuted
  },
  searchSuggestionLabel: {
    flex: 1,
    color: OJS_COLORS.ink,
    fontSize: 13,
    fontWeight: "600"
  },
  searchSuggestionHint: {
    flexShrink: 0,
    maxWidth: 120,
    color: OJS_COLORS.muted,
    fontSize: 11,
    textTransform: "capitalize"
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
    shadowColor: OJS_COLORS.blue,
    shadowOpacity: 0.14,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 }
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
  resultsSurface: {
    width: "100%"
  },
  resultsSurfaceMotion: {
    transitionProperty: "opacity, transform",
    transitionDuration: "320ms",
    transitionTimingFunction: "cubic-bezier(0.0, 0.0, 0.2, 1)"
  },
  list: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 12,
    gap: 10
  },
  postingsRefreshIndicator: {
    marginHorizontal: 16,
    marginTop: 2,
    marginBottom: 4,
    color: OJS_COLORS.muted,
    fontSize: 11
  },
  postingsPagingFooter: {
    alignSelf: "center",
    width: "100%",
    maxWidth: 980,
    paddingHorizontal: 16,
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
    backgroundColor: OJS_COLORS.green,
    borderWidth: 1,
    borderColor: OJS_COLORS.focus,
    shadowColor: OJS_COLORS.shadow,
    shadowOpacity: 0.18,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
    zIndex: 40
  },
  scrollTopButtonDesktop: {
    right: 28,
    bottom: 28,
    minHeight: 48,
    minWidth: 68
  },
  scrollTopButtonMobile: {
    right: 16,
    bottom: 16,
    minHeight: 52,
    minWidth: 72
  },
  scrollTopButtonPressed: {
    backgroundColor: OJS_COLORS.ink,
    transform: [{ scale: 0.97 }]
  },
  scrollTopButtonText: {
    color: OJS_COLORS.surface,
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 0
  },
  card: {
    backgroundColor: OJS_COLORS.surface,
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: OJS_COLORS.softBorder
  },
  position: {
    fontSize: 16,
    fontWeight: "600",
    color: OJS_COLORS.ink
  },
  location: {
    marginTop: 4,
    fontSize: 12,
    color: OJS_COLORS.muted
  },
  company: {
    marginTop: 4,
    fontSize: 14,
    color: OJS_COLORS.text
  },
  ats: {
    marginTop: 3,
    fontSize: 12,
    color: OJS_COLORS.text,
    fontWeight: "600"
  },
  posted: {
    marginTop: 2,
    fontSize: 12,
    color: OJS_COLORS.muted
  },
  postingAppliedNotice: {
    marginTop: 6,
    fontSize: 12,
    color: OJS_COLORS.success,
    fontWeight: "600"
  },
  url: {
    marginTop: 6,
    fontSize: 11,
    color: OJS_COLORS.muted
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
    shadowColor: OJS_COLORS.shadow,
    shadowOpacity: 0.14,
    shadowRadius: 30,
    shadowOffset: { width: 0, height: 18 }
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
    minHeight: 40,
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
  releaseNotesScrollContent: {
    paddingBottom: 4
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
    zIndex: 0
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
    marginBottom: 4
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

