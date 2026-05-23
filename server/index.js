const cors = require("cors");
const crypto = require("crypto");
const express = require("express");
const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");
const { open } = require("sqlite");
const sqlite3 = require("sqlite3");
const { ensureIngestionTables, seedAtsSources } = require("./ingestion/schema");
const { getAdapterMetadata, isAtsEnabledByDefault } = require("./ingestion/adapter-metadata");
const {
  isPlaceholderCompanyName,
  normalizeCountryFromLocation,
  normalizeCountryName,
  normalizeRemoteType
} = require("./ingestion/posting");
const {
  buildQualityMetadata,
  buildStoredQualityFields,
  parseQualityFlags
} = require("./ingestion/dataQuality");
const {
  getSqliteQualityAudit,
  makeQualitySummary
} = require("./ingestion/dataQualityAudit");
const {
  createEmptyGrowthSummary,
  getPostgresGrowthSummary,
  normalizeHours: normalizeGrowthHours
} = require("./ingestion/growthSummary");
const { createAtsRateLimitStateStore } = require("./ingestion/atsRateLimitStore");
const { safeFetch } = require("./ingestion/safeFetch");
const {
  createPostgresPool,
  ensurePostgresSchema,
  seedPostgresAtsSources
} = require("./backends/postgres");
const {
  expandSearchTokens
} = require("./search/config");
const {
  getPostgresAtsAdmin,
  getPostgresAtsFieldQualityByAts,
  getPostgresCounts,
  getPostgresFilterOptions,
  getPostgresParserStats,
  getPostgresParserAdmin,
  getPostgresParserAttentionByAts,
  getPostgresPostingDiagnostics,
  getPostgresPublicSearchReport,
  getPostgresQualitySummary,
  getPostgresQuarantineSummary,
  getPostgresSourceRunStatus,
  getPostgresSuggestions,
  getPostgresSourceQualityDashboard,
  getPostgresSyncStatus,
  listPostgresIngestionErrors,
  listPostgresIngestionRuns,
  listPostgresIngestionSources,
  listPostgresParserDriftEvents,
  listPostgresRejections,
  listPostgresPostings,
  recordPostgresPublicSearchEvent,
  requestSyncStart,
  requestSyncStop
} = require("./backends/postgresStore");
const { ensureMeiliPostingsIndex, getMeiliSettingsStatus } = require("./search/meili");
const { readMeiliReindexStatus } = require("./search/reindexStatus");
const { registerAdminRoutes } = require("./http/registerAdminRoutes");
const { registerPublicRoutes } = require("./http/registerPublicRoutes");
const { registerUserRoutes } = require("./http/registerUserRoutes");
const {
  buildGoogleAnalyticsCsp,
  buildPublicWebAnalyticsHeadTags,
  readPublicWebAnalyticsConfig,
  stripPublicWebAnalyticsHeadTags
} = require("./analytics/publicWebAnalytics");
const { readThresholds: readSourceQualityThresholds } = require("./ingestion/sourceQualityPolicy");
const { decodeHtmlEntities, extractJsonLdObjectsFromHtml } = require("./ingestion/parsers/shared/html");
const { isRemoteOnlyLocationValue } = require("./ingestion/parsers/shared/location");
const { normalizeExplicitRemoteValue } = require("./ingestion/parsers/shared/remote");
const { extractSourceIdFromPostingUrl } = require("./ingestion/parsers/shared/sourceIds");
const { parseApplyToJobPostingsFromHtml } = require("./ingestion/sources/applytojob/parse");
const { parseBreezyPostingsFromHtml } = require("./ingestion/sources/breezy/parse");
const { extractTaleoPostingsFromAjax, extractTaleoPostingsFromRest } = require("./ingestion/sources/taleo/parse");
const { parseCareerplugPostingsFromHtml } = require("./ingestion/sources/careerplug/parse");
const { parseFountainPostingsFromApi } = require("./ingestion/sources/fountain/parse");
const { parseGreenhousePostingsFromApi } = require("./ingestion/sources/greenhouse/parse");
const {
  buildHirebridgeDetailsUrl,
  extractHirebridgeDatePostedFromDetailHtml,
  parseHirebridgePostingsFromHtml
} = require("./ingestion/sources/hirebridge/parse");
const { parseHrmDirectPostingsFromHtml } = require("./ingestion/sources/hrmdirect/parse");
const { parseJobvitePostingsFromHtml } = require("./ingestion/sources/jobvite/parse");
const { parseLeverPostingsFromApi } = require("./ingestion/sources/lever/parse");
const {
  extractManatalPageRuntimeConfig,
  parseManatalPostingsFromApi,
  parseManatalPostingsFromHtml
} = require("./ingestion/sources/manatal/parse");
const {
  extractPageupCompanyNameFromTitle,
  extractPageupPostingDateFromDetailHtml,
  parsePageupPostingsFromResults
} = require("./ingestion/sources/pageup/parse");
const {
  extractRecruiteePropsFromHtml,
  parseRecruiteePostingsFromPublicApp
} = require("./ingestion/sources/recruitee/parse");
const { extractIcimsLocationFromHtml, extractIcimsLocationFromTitleOrUrl, extractIcimsPostingDateFromHtml, extractIcimsRemoteTypeFromHtml, parseIcimsPostingsFromHtml } = require("./ingestion/sources/icims/parse");
const { parseZohoPostingsFromHtml } = require("./ingestion/sources/zoho/parse");

const PORT = Number(process.env.PORT || 8787);
const NODE_ENV = String(process.env.NODE_ENV || "development").trim().toLowerCase();
const DB_PATH = process.env.DB_PATH || path.resolve(__dirname, "..", "jobs.db");
const BUNDLED_DB_PATH = path.resolve(__dirname, "..", "jobs.db");
const DB_BACKEND = String(process.env.OPENJOBSLOTS_DB_BACKEND || "sqlite").trim().toLowerCase();
const SEARCH_BACKEND = String(process.env.OPENJOBSLOTS_SEARCH_BACKEND || "sqlite").trim().toLowerCase();
const QUEUE_BACKEND = String(
  process.env.OPENJOBSLOTS_QUEUE_BACKEND || (DB_BACKEND === "postgres" ? "postgres-sync-control" : "sqlite-worker")
).trim().toLowerCase();
const DISABLE_API_SCHEDULER = String(process.env.OPENJOBSLOTS_DISABLE_API_SCHEDULER || "")
  .trim()
  .toLowerCase() === "1";
const API_JSON_LIMIT = String(process.env.OPENJOBSLOTS_JSON_LIMIT || "128kb").trim() || "128kb";
const ADMIN_TOKEN = String(process.env.OPENJOBSLOTS_ADMIN_TOKEN || "").trim();
const ALLOW_LOCAL_ADMIN = String(process.env.OPENJOBSLOTS_ALLOW_LOCAL_ADMIN || "")
  .trim()
  .toLowerCase() === "1";
const TRUST_PROXY = String(process.env.OPENJOBSLOTS_TRUST_PROXY || "")
  .trim()
  .toLowerCase() === "1";
const RATE_LIMIT_WINDOW_MS = Math.max(1000, Number(process.env.OPENJOBSLOTS_RATE_LIMIT_WINDOW_MS || 60_000));
const PUBLIC_RATE_LIMIT_MAX = Math.max(10, Number(process.env.OPENJOBSLOTS_PUBLIC_RATE_LIMIT_MAX || 300));
const CONTROL_RATE_LIMIT_MAX = Math.max(5, Number(process.env.OPENJOBSLOTS_CONTROL_RATE_LIMIT_MAX || 60));
const FRONTEND_LOG_RATE_LIMIT_MAX = Math.max(5, Number(process.env.OPENJOBSLOTS_FRONTEND_LOG_RATE_LIMIT_MAX || 60));
const PUBLIC_READ_CACHE_TTL_MS = Math.max(0, Number(process.env.OPENJOBSLOTS_PUBLIC_READ_CACHE_TTL_MS || 5_000));
const PUBLIC_READ_CACHE_MAX_ENTRIES = Math.max(10, Number(process.env.OPENJOBSLOTS_PUBLIC_READ_CACHE_MAX_ENTRIES || 250));
const PUBLIC_SITE_URL = String(process.env.OPENJOBSLOTS_PUBLIC_SITE_URL || "").trim();
const SEO_SITE_TITLE = "OpenJobSlots | Fresh Job Openings";
const SEO_SITE_DESCRIPTION =
  "Search fresh job openings across ATS platforms, filter by role, company, location, industry, and remote work, and track applications in one place.";
const PUBLIC_SUPPORTED_LANGUAGES = Object.freeze([
  { code: "en", label: "English", native_label: "English", country_code: "US" },
  { code: "tr", label: "Turkish", native_label: "Türkçe", country_code: "TR" },
  { code: "de", label: "German", native_label: "Deutsch", country_code: "DE" },
  { code: "fr", label: "French", native_label: "Français", country_code: "FR" },
  { code: "es", label: "Spanish", native_label: "Español", country_code: "ES" }
]);
const PUBLIC_SUPPORTED_LANGUAGE_CODES = new Set(PUBLIC_SUPPORTED_LANGUAGES.map((language) => language.code));
const PUBLIC_COUNTRY_LANGUAGE_FALLBACKS = Object.freeze({
  AT: "de",
  CH: "de",
  DE: "de",
  ES: "es",
  MX: "es",
  AR: "es",
  CL: "es",
  CO: "es",
  PE: "es",
  FR: "fr",
  BE: "fr",
  CA: "en",
  GB: "en",
  IE: "en",
  AU: "en",
  NZ: "en",
  US: "en",
  TR: "tr"
});
const BACKEND_DATA_ROOT = path.dirname(DB_PATH);
const BACKEND_LOG_DIRECTORY_PATH = path.join(BACKEND_DATA_ROOT, "logs");
const FRONTEND_LOG_PATH = path.join(BACKEND_LOG_DIRECTORY_PATH, "frontend-client.log");
const SYNC_INTERVAL_MS = Number(process.env.SYNC_INTERVAL_MS || 10 * 60 * 1000);
const SYNC_WORKER_CONCURRENCY_RAW = Number(process.env.SYNC_WORKER_CONCURRENCY || 4);
const SYNC_WORKER_CONCURRENCY =
  Number.isFinite(SYNC_WORKER_CONCURRENCY_RAW) && SYNC_WORKER_CONCURRENCY_RAW > 0
    ? Math.floor(SYNC_WORKER_CONCURRENCY_RAW)
    : 4;
const FETCH_TIMEOUT_MS = Number(process.env.FETCH_TIMEOUT_MS || 12000);
const ATS_REQUEST_QUEUE_CONCURRENCY_RAW = Number(process.env.ATS_REQUEST_QUEUE_CONCURRENCY || 1);
const ATS_REQUEST_QUEUE_CONCURRENCY_DEFAULT =
  Number.isFinite(ATS_REQUEST_QUEUE_CONCURRENCY_RAW) && ATS_REQUEST_QUEUE_CONCURRENCY_RAW > 0
    ? Math.floor(ATS_REQUEST_QUEUE_CONCURRENCY_RAW)
    : 1;
const MIN_ATS_REQUEST_QUEUE_CONCURRENCY = 1;
const MAX_ATS_REQUEST_QUEUE_CONCURRENCY = 20;
const POSTING_VISIBLE_RETENTION_DAYS = Math.max(1, Number(process.env.OPENJOBSLOTS_POSTING_HOT_DAYS || 30));
const POSTING_TTL_SECONDS = Number(process.env.POSTING_TTL_SECONDS || POSTING_VISIBLE_RETENTION_DAYS * 24 * 60 * 60);
const SYNC_POSTING_FLUSH_BATCH_SIZE = Number(process.env.SYNC_POSTING_FLUSH_BATCH_SIZE || 200);
const DEFAULT_BROWSER_USER_AGENT =
  process.env.OPENJOBSLOTS_BROWSER_USER_AGENT ||
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36";
const WORKDAY_PAGE_SIZE = 20;
const ULTIPRO_PAGE_SIZE = 50;
const MAX_PAGES_PER_COMPANY = 25;
const LOCALE_SEGMENT_REGEX = /^[a-z]{2}(?:-[a-z]{2})?$/i;
const WORKDAY_RATE_LIMIT_WAIT_MS = 60 * 1000;
const ASHBY_API_URL = "https://jobs.ashbyhq.com/api/non-user-graphql?op=ApiJobBoardWithTeams";
const ASHBY_RATE_LIMIT_WAIT_MS = 60 * 1000;
const GREENHOUSE_API_URL_BASE = "https://boards-api.greenhouse.io/v1/boards";
const GREENHOUSE_RATE_LIMIT_WAIT_MS = 60 * 1000;
const LEVER_API_URL_BASE = "https://api.lever.co/v0/postings";
const LEVER_RATE_LIMIT_WAIT_MS = 60 * 1000;
const RECRUITEE_RATE_LIMIT_WAIT_MS = 60 * 1000;
const ULTIPRO_RATE_LIMIT_WAIT_MS = 60 * 1000;
const TALEO_RATE_LIMIT_WAIT_MS = 60 * 1000;
const JOBVITE_RATE_LIMIT_WAIT_MS = 60 * 1000;
const APPLICANTPRO_RATE_LIMIT_WAIT_MS = 60 * 1000;
const APPLYTOJOB_RATE_LIMIT_WAIT_MS = 60 * 1000;
const ICIMS_RATE_LIMIT_WAIT_MS = 60 * 1000;
const THEAPPLICANTMANAGER_RATE_LIMIT_WAIT_MS = 60 * 1000;
const BREEZY_RATE_LIMIT_WAIT_MS = 60 * 1000;
const ZOHO_RATE_LIMIT_WAIT_MS = 60 * 1000;
const APPLICANTAI_RATE_LIMIT_WAIT_MS = 60 * 1000;
const CAREERPLUG_RATE_LIMIT_WAIT_MS = 60 * 1000;
const BAMBOOHR_RATE_LIMIT_WAIT_MS = 60 * 1000;
const CAREERPUCK_RATE_LIMIT_WAIT_MS = 60 * 1000;
const FOUNTAIN_RATE_LIMIT_WAIT_MS = 60 * 1000;
const GETRO_RATE_LIMIT_WAIT_MS = 60 * 1000;
const HRMDIRECT_RATE_LIMIT_WAIT_MS = 60 * 1000;
const TALENTLYFT_RATE_LIMIT_WAIT_MS = 60 * 1000;
const TALEXIO_RATE_LIMIT_WAIT_MS = 60 * 1000;
const TEAMTAILOR_RATE_LIMIT_WAIT_MS = 60 * 1000;
const FRESHTEAM_RATE_LIMIT_WAIT_MS = 60 * 1000;
const SAGEHR_RATE_LIMIT_WAIT_MS = 60 * 1000;
const LOXO_RATE_LIMIT_WAIT_MS = 5 * 1000;
const SIMPLICANT_RATE_LIMIT_WAIT_MS = 60 * 1000;
const PINPOINTHQ_RATE_LIMIT_WAIT_MS = 60 * 1000;
const RECRUITCRM_RATE_LIMIT_WAIT_MS = 60 * 1000;
const RIPPLING_RATE_LIMIT_WAIT_MS = 60 * 1000;
const MANATAL_RATE_LIMIT_WAIT_MS = 60 * 1000;
const GEM_RATE_LIMIT_WAIT_MS = 60 * 1000;
const JOBAPS_RATE_LIMIT_WAIT_MS = 60 * 1000;
const JOIN_RATE_LIMIT_WAIT_MS = 60 * 1000;
const TALENTREEF_RATE_LIMIT_WAIT_MS = 60 * 1000;
const SAPHRCLOUD_RATE_LIMIT_WAIT_MS = 60 * 1000;
const ADP_MYJOBS_RATE_LIMIT_WAIT_MS = 60 * 1000;
const ADP_WORKFORCENOW_RATE_LIMIT_WAIT_MS = 60 * 1000;
const CAREERSPAGE_RATE_LIMIT_WAIT_MS = 60 * 1000;
const ORACLE_RATE_LIMIT_WAIT_MS = 60 * 1000;
const HIREBRIDGE_RATE_LIMIT_WAIT_MS = 60 * 1000;
const PAGEUP_RATE_LIMIT_WAIT_MS = 60 * 1000;
const PAYLOCITY_RATE_LIMIT_WAIT_MS = 60 * 1000;
const EIGHTFOLD_RATE_LIMIT_WAIT_MS = 60 * 1000;
const BRASSRING_RATE_LIMIT_WAIT_MS = 60 * 1000;
const APPLITRACK_RATE_LIMIT_WAIT_MS = 60 * 1000;
const ICIMS_DETAIL_FETCH_LIMIT_PER_COMPANY = Math.max(0, Number(process.env.OPENJOBSLOTS_ICIMS_DETAIL_FETCH_LIMIT_PER_COMPANY || 5));
const APPLITRACK_DETAIL_FETCH_LIMIT_PER_COMPANY = Math.max(0, Number(process.env.OPENJOBSLOTS_APPLITRACK_DETAIL_FETCH_LIMIT_PER_COMPANY || 5));
const POLICEAPP_RATE_LIMIT_WAIT_MS = 60 * 1000;
const USAJOBS_RATE_LIMIT_WAIT_MS = 60 * 1000;
const USAJOBS_SEARCH_API_URL = "https://data.usajobs.gov/api/Search";
const K12JOBSPOT_RATE_LIMIT_WAIT_MS = 60 * 1000;
const SCHOOLSPRING_RATE_LIMIT_WAIT_MS = 60 * 1000;
const CALCAREERS_RATE_LIMIT_WAIT_MS = 60 * 1000;
const CALOPPS_RATE_LIMIT_WAIT_MS = 60 * 1000;
const STATEJOBSNY_RATE_LIMIT_WAIT_MS = 60 * 1000;
const HIBOB_RATE_LIMIT_WAIT_MS = 60 * 1000;
const ISOLVISOLVEDHIRE_RATE_LIMIT_WAIT_MS = 60 * 1000;
const GOVERNMENTJOBS_RATE_LIMIT_WAIT_MS = 60 * 1000;
const GOVERNMENTJOBS_ESTIMATED_COMPANY_COUNT = 2400;
const SMARTRECRUITERS_RATE_LIMIT_WAIT_MS = 1000;
const SMARTRECRUITERS_ESTIMATED_COMPANY_COUNT = 4000;
const POLICEAPP_ESTIMATED_COMPANY_COUNT = 1166;
const USAJOBS_ESTIMATED_COMPANY_COUNT = 26;
const K12JOBSPOT_ESTIMATED_COMPANY_COUNT = 13000;
const SCHOOLSPRING_ESTIMATED_COMPANY_COUNT = 16287;
const CALCAREERS_ESTIMATED_COMPANY_COUNT = 297;
const CALOPPS_ESTIMATED_COMPANY_COUNT = 254;
const STATEJOBSNY_ESTIMATED_COMPANY_COUNT = 165;
const SMARTRECRUITERS_INSERT_EVERY_N_TARGETS = 10;
const execFileAsync = promisify(execFile);
const SAPHRCLOUD_LOCALE_CANDIDATES = Object.freeze(["en_US", "en_GB"]);
const ORACLE_EXPAND_VALUE = [
  "requisitionList.workLocation",
  "requisitionList.otherWorkLocations",
  "requisitionList.secondaryLocations",
  "flexFieldsFacet.values",
  "requisitionList.requisitionFlexFields"
].join(",");
const ORACLE_FACETS_VALUE =
  "LOCATIONS;WORK_LOCATIONS;WORKPLACE_TYPES;TITLES;CATEGORIES;ORGANIZATIONS;POSTING_DATES;FLEX_FIELDS";
const ASHBY_QUERY = `
  query ApiJobBoardWithTeams($organizationHostedJobsPageName: String!) {
    jobBoard: jobBoardWithTeams(
      organizationHostedJobsPageName: $organizationHostedJobsPageName
    ) {
      teams {
        id
        name
        externalName
        parentTeamId
        __typename
      }
      jobPostings {
        id
        title
        teamId
        locationId
        locationName
        workplaceType
        employmentType
        secondaryLocations {
          ...JobPostingSecondaryLocationParts
          __typename
        }
        compensationTierSummary
        __typename
      }
      __typename
    }
  }

  fragment JobPostingSecondaryLocationParts on JobPostingSecondaryLocation {
    locationId
    locationName
    __typename
  }
`;

let db;
let postgresPool = null;
let wordIndustryCoverageCache = null;
let phraseNgramIndustryCoverageCache = null;
let syncPromise = null;
let postingLocationByJobUrl = new Map();
let postingLocationVersion = 0;
let postingLocationGeoFilterOptionsCache = {
  mapRef: null,
  version: -1,
  countries: [],
  regions: []
};
const locationGeoInferenceCache = new Map();
const atsRateLimitStore = createAtsRateLimitStateStore({
  getPool: () => (DB_BACKEND === "postgres" ? postgresPool : null)
});
let atsRequestQueueConcurrency = ATS_REQUEST_QUEUE_CONCURRENCY_DEFAULT;
let syncEnabledAts = new Set();
const syncStatus = {
  running: false,
  started_at: null,
  last_sync_at: null,
  last_sync_summary: null,
  last_error: null,
  progress: null
};
const PERSONAL_INFORMATION_FIELDS = [
  "first_name",
  "middle_name",
  "last_name",
  "email",
  "phone_number",
  "address",
  "linkedin_url",
  "github_url",
  "portfolio_url",
  "resume_file_path",
  "projects_portfolio_file_path",
  "certifications_folder_path",
  "ethnicity",
  "gender",
  "age",
  "veteran_status",
  "disability_status",
  "education_level",
  "years_of_experience"
];
const PERSONAL_INFORMATION_DEFAULTS = {
  first_name: "",
  middle_name: "",
  last_name: "",
  email: "",
  phone_number: "",
  address: "",
  linkedin_url: "",
  github_url: "",
  portfolio_url: "",
  resume_file_path: "",
  projects_portfolio_file_path: "",
  certifications_folder_path: "",
  ethnicity: "",
  gender: "",
  age: 0,
  veteran_status: "",
  disability_status: "",
  education_level: "",
  years_of_experience: 0
};
const GENERIC_TITLE_LIKE_PARTS = new Set([
  "and",
  "for",
  "with",
  "from",
  "the",
  "manager",
  "assistant",
  "associate",
  "specialist",
  "coordinator",
  "director",
  "officer",
  "analyst",
  "consultant",
  "lead",
  "senior",
  "junior",
  "staff",
  "team",
  "services",
  "service",
  "operations",
  "operation",
  "support"
]);
const WEAK_INDUSTRY_LIKE_PARTS = new Set([
  ...GENERIC_TITLE_LIKE_PARTS,
  "account",
  "accounts",
  "representative",
  "executive",
  "management",
  "area",
  "group",
  "international",
  "care",
  "inside",
  "outside",
  "hourly",
  "commission",
  "anywhere",
  "can",
  "small",
  "planning",
  "compliance",
  "core",
  "safety",
  "import",
  "export",
  "brand",
  "ambassador",
  "customer",
  "business",
  "field",
  "division",
  "product"
]);
const IT_SOFTWARE_INDUSTRY_KEY = "information_technology_software";
const SALES_BUSINESS_INDUSTRY_KEY = "sales_business_development";
const IT_TECH_ANCHOR_PARTS = new Set([
  "software",
  "developer",
  "development",
  "engineer",
  "engineering",
  "devops",
  "platform",
  "cloud",
  "security",
  "cybersecurity",
  "cyber",
  "infrastructure",
  "network",
  "systems",
  "system",
  "administrator",
  "database",
  "sql",
  "data",
  "analytics",
  "architect",
  "automation",
  "backend",
  "frontend",
  "fullstack",
  "application",
  "applications",
  "qa",
  "test",
  "testing",
  "machine",
  "learning",
  "mlops",
  "ai"
]);
const IT_HIGH_SIGNAL_ANCHOR_PARTS = new Set([
  "software",
  "developer",
  "development",
  "engineer",
  "engineering",
  "devops",
  "platform",
  "cloud",
  "security",
  "cybersecurity",
  "cyber",
  "infrastructure",
  "network",
  "systems",
  "system",
  "administrator",
  "database",
  "sql",
  "architect",
  "automation",
  "backend",
  "frontend",
  "fullstack",
  "mlops",
  "machine",
  "learning",
  "ai"
]);
const IT_SALES_GTM_ROLE_REGEX =
  /\b(account executive|account manager|business development|brand ambassador|go[\s-]?to[\s-]?market|gtm|inside sales|outside sales|sales representative|territory manager|partnerships?|sales(?!force\b))\b/i;
const SALES_EXCLUSIVE_ROLE_REGEX =
  /\b(account executive|account manager|business development|brand ambassador|inside sales|outside sales|sales representative|sales manager|sales director|sales consultant|sales specialist|sales associate|sales advisor|presales?|telesales|territory manager|channel sales|partner sales|salesperson|salesman|salesworker|sales(?!force\b))\b/i;
const STATE_CODE_TO_NAME = {
  AL: "alabama",
  AK: "alaska",
  AZ: "arizona",
  AR: "arkansas",
  CA: "california",
  CO: "colorado",
  CT: "connecticut",
  DE: "delaware",
  FL: "florida",
  GA: "georgia",
  HI: "hawaii",
  ID: "idaho",
  IL: "illinois",
  IN: "indiana",
  IA: "iowa",
  KS: "kansas",
  KY: "kentucky",
  LA: "louisiana",
  ME: "maine",
  MD: "maryland",
  MA: "massachusetts",
  MI: "michigan",
  MN: "minnesota",
  MS: "mississippi",
  MO: "missouri",
  MT: "montana",
  NE: "nebraska",
  NV: "nevada",
  NH: "new hampshire",
  NJ: "new jersey",
  NM: "new mexico",
  NY: "new york",
  NC: "north carolina",
  ND: "north dakota",
  OH: "ohio",
  OK: "oklahoma",
  OR: "oregon",
  PA: "pennsylvania",
  RI: "rhode island",
  SC: "south carolina",
  SD: "south dakota",
  TN: "tennessee",
  TX: "texas",
  UT: "utah",
  VT: "vermont",
  VA: "virginia",
  WA: "washington",
  WV: "west virginia",
  WI: "wisconsin",
  WY: "wyoming",
  DC: "district of columbia"
};
const LOCATION_REGION_OPTIONS = Object.freeze([
  { value: "AMER", label: "AMER (Americas)" },
  { value: "EMEA", label: "EMEA (Europe, Middle East, Africa)" },
  { value: "APAC", label: "APAC (Asia-Pacific)" }
]);
const LOCATION_REGION_VALUES = new Set(LOCATION_REGION_OPTIONS.map((option) => option.value));
const LOCATION_NON_COUNTRY_TERMS = new Set([
  "remote",
  "hybrid",
  "onsite",
  "on site",
  "worldwide",
  "global",
  "international",
  "amer",
  "americas",
  "north america",
  "south america",
  "latin america",
  "latam",
  "emea",
  "europe",
  "middle east",
  "africa",
  "apac",
  "asia",
  "asia pacific"
]);
const REGION_HINTS_BY_VALUE = Object.freeze({
  AMER: [
    "amer",
    "americas",
    "north america",
    "south america",
    "latin america",
    "latam",
    "caribbean"
  ],
  EMEA: ["emea", "europe", "middle east", "africa"],
  APAC: ["apac", "asia pacific", "asia", "oceania"]
});
const COUNTRY_DEFINITIONS = Object.freeze([
  {
    code: "US",
    label: "United States",
    region: "AMER",
    aliases: ["us", "usa", "u.s.", "u.s.a.", "united states of america"]
  },
  { code: "CA", label: "Canada", region: "AMER", aliases: ["can"] },
  { code: "MX", label: "Mexico", region: "AMER", aliases: ["mex"] },
  { code: "BR", label: "Brazil", region: "AMER", aliases: ["brasil"] },
  { code: "AR", label: "Argentina", region: "AMER", aliases: [] },
  { code: "CL", label: "Chile", region: "AMER", aliases: [] },
  { code: "CO", label: "Colombia", region: "AMER", aliases: [] },
  { code: "PE", label: "Peru", region: "AMER", aliases: [] },
  { code: "UY", label: "Uruguay", region: "AMER", aliases: [] },
  { code: "PY", label: "Paraguay", region: "AMER", aliases: [] },
  { code: "BO", label: "Bolivia", region: "AMER", aliases: [] },
  { code: "EC", label: "Ecuador", region: "AMER", aliases: [] },
  { code: "VE", label: "Venezuela", region: "AMER", aliases: [] },
  { code: "CR", label: "Costa Rica", region: "AMER", aliases: [] },
  { code: "PA", label: "Panama", region: "AMER", aliases: [] },
  { code: "GT", label: "Guatemala", region: "AMER", aliases: [] },
  { code: "SV", label: "El Salvador", region: "AMER", aliases: [] },
  { code: "HN", label: "Honduras", region: "AMER", aliases: [] },
  { code: "NI", label: "Nicaragua", region: "AMER", aliases: [] },
  { code: "DO", label: "Dominican Republic", region: "AMER", aliases: [] },
  { code: "PR", label: "Puerto Rico", region: "AMER", aliases: [] },
  { code: "JM", label: "Jamaica", region: "AMER", aliases: [] },
  { code: "TT", label: "Trinidad and Tobago", region: "AMER", aliases: ["trinidad"] },
  { code: "BS", label: "Bahamas", region: "AMER", aliases: [] },
  { code: "BB", label: "Barbados", region: "AMER", aliases: [] },
  { code: "GB", label: "United Kingdom", region: "EMEA", aliases: ["uk", "u.k.", "great britain", "britain", "england", "scotland", "wales", "northern ireland"] },
  { code: "IE", label: "Ireland", region: "EMEA", aliases: ["republic of ireland"] },
  { code: "FR", label: "France", region: "EMEA", aliases: [] },
  { code: "DE", label: "Germany", region: "EMEA", aliases: ["deutschland"] },
  { code: "ES", label: "Spain", region: "EMEA", aliases: [] },
  { code: "PT", label: "Portugal", region: "EMEA", aliases: [] },
  { code: "IT", label: "Italy", region: "EMEA", aliases: [] },
  { code: "NL", label: "Netherlands", region: "EMEA", aliases: ["holland"] },
  { code: "BE", label: "Belgium", region: "EMEA", aliases: [] },
  { code: "LU", label: "Luxembourg", region: "EMEA", aliases: [] },
  { code: "CH", label: "Switzerland", region: "EMEA", aliases: [] },
  { code: "AT", label: "Austria", region: "EMEA", aliases: [] },
  { code: "SE", label: "Sweden", region: "EMEA", aliases: [] },
  { code: "NO", label: "Norway", region: "EMEA", aliases: [] },
  { code: "DK", label: "Denmark", region: "EMEA", aliases: [] },
  { code: "FI", label: "Finland", region: "EMEA", aliases: [] },
  { code: "IS", label: "Iceland", region: "EMEA", aliases: [] },
  { code: "PL", label: "Poland", region: "EMEA", aliases: [] },
  { code: "CZ", label: "Czechia", region: "EMEA", aliases: ["czech republic"] },
  { code: "SK", label: "Slovakia", region: "EMEA", aliases: [] },
  { code: "HU", label: "Hungary", region: "EMEA", aliases: [] },
  { code: "RO", label: "Romania", region: "EMEA", aliases: [] },
  { code: "BG", label: "Bulgaria", region: "EMEA", aliases: [] },
  { code: "HR", label: "Croatia", region: "EMEA", aliases: [] },
  { code: "SI", label: "Slovenia", region: "EMEA", aliases: [] },
  { code: "RS", label: "Serbia", region: "EMEA", aliases: [] },
  { code: "BA", label: "Bosnia and Herzegovina", region: "EMEA", aliases: ["bosnia"] },
  { code: "ME", label: "Montenegro", region: "EMEA", aliases: [] },
  { code: "AL", label: "Albania", region: "EMEA", aliases: [] },
  { code: "MK", label: "North Macedonia", region: "EMEA", aliases: ["macedonia"] },
  { code: "GR", label: "Greece", region: "EMEA", aliases: [] },
  { code: "CY", label: "Cyprus", region: "EMEA", aliases: [] },
  { code: "MT", label: "Malta", region: "EMEA", aliases: [] },
  { code: "EE", label: "Estonia", region: "EMEA", aliases: [] },
  { code: "LV", label: "Latvia", region: "EMEA", aliases: [] },
  { code: "LT", label: "Lithuania", region: "EMEA", aliases: [] },
  { code: "UA", label: "Ukraine", region: "EMEA", aliases: [] },
  { code: "BY", label: "Belarus", region: "EMEA", aliases: [] },
  { code: "MD", label: "Moldova", region: "EMEA", aliases: [] },
  { code: "RU", label: "Russia", region: "EMEA", aliases: ["russian federation"] },
  { code: "TR", label: "Turkey", region: "EMEA", aliases: ["turkiye", "turkish", "turkyie", "turksih"] },
  { code: "AE", label: "United Arab Emirates", region: "EMEA", aliases: ["uae", "u.a.e."] },
  { code: "SA", label: "Saudi Arabia", region: "EMEA", aliases: ["ksa"] },
  { code: "QA", label: "Qatar", region: "EMEA", aliases: [] },
  { code: "KW", label: "Kuwait", region: "EMEA", aliases: [] },
  { code: "BH", label: "Bahrain", region: "EMEA", aliases: [] },
  { code: "OM", label: "Oman", region: "EMEA", aliases: [] },
  { code: "IL", label: "Israel", region: "EMEA", aliases: [] },
  { code: "JO", label: "Jordan", region: "EMEA", aliases: [] },
  { code: "LB", label: "Lebanon", region: "EMEA", aliases: [] },
  { code: "EG", label: "Egypt", region: "EMEA", aliases: [] },
  { code: "MA", label: "Morocco", region: "EMEA", aliases: [] },
  { code: "DZ", label: "Algeria", region: "EMEA", aliases: [] },
  { code: "TN", label: "Tunisia", region: "EMEA", aliases: [] },
  { code: "ZA", label: "South Africa", region: "EMEA", aliases: [] },
  { code: "NG", label: "Nigeria", region: "EMEA", aliases: [] },
  { code: "KE", label: "Kenya", region: "EMEA", aliases: [] },
  { code: "GH", label: "Ghana", region: "EMEA", aliases: [] },
  { code: "ET", label: "Ethiopia", region: "EMEA", aliases: [] },
  { code: "UG", label: "Uganda", region: "EMEA", aliases: [] },
  { code: "TZ", label: "Tanzania", region: "EMEA", aliases: [] },
  { code: "SN", label: "Senegal", region: "EMEA", aliases: [] },
  { code: "CI", label: "Cote d Ivoire", region: "EMEA", aliases: ["cote d'ivoire", "ivory coast"] },
  { code: "CM", label: "Cameroon", region: "EMEA", aliases: [] },
  { code: "IN", label: "India", region: "APAC", aliases: [] },
  { code: "CN", label: "China", region: "APAC", aliases: ["prc", "people s republic of china"] },
  { code: "JP", label: "Japan", region: "APAC", aliases: [] },
  { code: "KR", label: "South Korea", region: "APAC", aliases: ["korea", "republic of korea", "korea south"] },
  { code: "SG", label: "Singapore", region: "APAC", aliases: [] },
  { code: "MY", label: "Malaysia", region: "APAC", aliases: [] },
  { code: "TH", label: "Thailand", region: "APAC", aliases: [] },
  { code: "VN", label: "Vietnam", region: "APAC", aliases: ["viet nam"] },
  { code: "ID", label: "Indonesia", region: "APAC", aliases: [] },
  { code: "PH", label: "Philippines", region: "APAC", aliases: [] },
  { code: "AU", label: "Australia", region: "APAC", aliases: [] },
  { code: "NZ", label: "New Zealand", region: "APAC", aliases: [] },
  { code: "HK", label: "Hong Kong", region: "APAC", aliases: ["hong kong sar"] },
  { code: "TW", label: "Taiwan", region: "APAC", aliases: [] },
  { code: "PK", label: "Pakistan", region: "APAC", aliases: [] },
  { code: "BD", label: "Bangladesh", region: "APAC", aliases: [] },
  { code: "LK", label: "Sri Lanka", region: "APAC", aliases: [] },
  { code: "NP", label: "Nepal", region: "APAC", aliases: [] },
  { code: "MM", label: "Myanmar", region: "APAC", aliases: ["burma"] },
  { code: "KH", label: "Cambodia", region: "APAC", aliases: [] },
  { code: "LA", label: "Laos", region: "APAC", aliases: ["lao pdr"] },
  { code: "BN", label: "Brunei", region: "APAC", aliases: ["brunei darussalam"] },
  { code: "MN", label: "Mongolia", region: "APAC", aliases: [] }
]);
const US_STATE_NAMES = new Set(Object.values(STATE_CODE_TO_NAME).map((name) => normalizeGeoText(name)));
const LOCATION_GEO_INFERENCE_CACHE_LIMIT = 30000;
const APPLICATION_STATUS_OPTIONS = new Set([
  "applied",
  "interview scheduled",
  "awaiting response",
  "offer received",
  "withdrawn",
  "denied"
]);
const MCP_REMOTE_OPTIONS = new Set(["all", "remote", "hybrid", "non_remote"]);
const ATS_FILTER_OPTION_ITEMS = Object.freeze([
  { value: "workday", label: "Workday" },
  { value: "ashby", label: "Ashby" },
  { value: "greenhouse", label: "Greenhouse" },
  { value: "lever", label: "Lever" },
  { value: "jobvite", label: "Jobvite" },
  { value: "applicantpro", label: "ApplicantPro" },
  { value: "applytojob", label: "ApplyToJob" },
  { value: "theapplicantmanager", label: "The Applicant Manager" },
  { value: "breezy", label: "BreezyHR" },
  { value: "icims", label: "iCIMS" },
  { value: "zoho", label: "Zoho Recruit" },
  { value: "applicantai", label: "ApplicantAI" },
  { value: "gem", label: "Gem" },
  { value: "jobaps", label: "JobAps" },
  { value: "join", label: "JOIN" },
  { value: "talentreef", label: "TalentReef" },
  { value: "careerplug", label: "CareerPlug" },
  { value: "bamboohr", label: "BambooHR" },
  { value: "adp_myjobs", label: "ADP MyJobs" },
  { value: "adp_workforcenow", label: "ADP Workforce Now" },
  { value: "oracle", label: "Oracle" },
  { value: "paylocity", label: "Paylocity" },
  { value: "eightfold", label: "Eightfold" },
  { value: "manatal", label: "Manatal" },
  { value: "careerspage", label: "CareersPage" },
  { value: "dayforcehcm", label: "Dayforce", enabledByDefault: false },
  { value: "pageup", label: "PageUp" },
  { value: "hirebridge", label: "Hirebridge" },
  { value: "brassring", label: "BrassRing" },
  { value: "applitrack", label: "Applitrack" },
  { value: "hibob", label: "HiBob" },
  { value: "isolvisolvedhire", label: "isolvedhire" },
  { value: "teamtailor", label: "Teamtailor" },
  { value: "freshteam", label: "Freshteam" },
  { value: "sagehr", label: "SageHR" },
  { value: "loxo", label: "Loxo" },
  { value: "peopleforce", label: "PeopleForce" },
  { value: "simplicant", label: "Simplicant" },
  { value: "pinpointhq", label: "PinpointHQ" },
  { value: "recruitcrm", label: "RecruitCRM" },
  { value: "rippling", label: "Rippling" },
  { value: "careerpuck", label: "CareerPuck" },
  { value: "fountain", label: "Fountain" },
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
  { value: "hrmdirect", label: "HRMDirect" },
  { value: "talentlyft", label: "Talentlyft" },
  { value: "talexio", label: "Talexio" },
  { value: "saphrcloud", label: "SAP HR Cloud" },
  { value: "recruitee", label: "Recruitee" },
  { value: "ultipro", label: "UltiPro" },
  { value: "taleo", label: "Taleo" }
]);
const ATS_FILTER_OPTIONS = new Set(ATS_FILTER_OPTION_ITEMS.map((item) => item.value));
const SYNC_DEFAULT_ENABLED_ATS = Object.freeze(
  ATS_FILTER_OPTION_ITEMS
    .filter((item) => item.enabledByDefault !== false && isAtsEnabledByDefault(item.value))
    .map((item) => item.value)
);
const POSTING_SORT_OPTION_ITEMS = Object.freeze([
  { value: "relevance", label: "Relevance" },
  { value: "last_seen", label: "Fresh source" },
  { value: "posted_date", label: "Posted date" },
  { value: "ats_source", label: "ATS/source" },
  { value: "confidence", label: "Confidence" }
]);
const POSTING_SORT_OPTIONS = new Set(POSTING_SORT_OPTION_ITEMS.map((option) => option.value));
const POSTING_FRESHNESS_DAY_OPTIONS = new Set([3, 7, 30]);
const ATS_FILTER_LABEL_BY_VALUE = new Map(ATS_FILTER_OPTION_ITEMS.map((item) => [item.value, item.label]));
const PUBLIC_SOURCE_FACET_LIMIT = 8;
const PUBLIC_SOURCE_FACET_FRESH_DAYS = 3;
const MCP_SETTINGS_DEFAULTS = {
  enabled: false,
  preferred_agent_name: "openjobslots Agent",
  agent_login_email: "",
  agent_login_password: "",
  mfa_login_email: "",
  mfa_login_notes: "",
  dry_run_only: true,
  require_final_approval: true,
  max_applications_per_run: 10,
  preferred_search: "",
  preferred_remote: "all",
  preferred_industries: [],
  preferred_regions: [],
  preferred_countries: [],
  preferred_states: [],
  preferred_counties: [],
  instructions_for_agent: ""
};
const SYNC_SERVICE_SETTINGS_DEFAULTS = {
  ats_request_queue_concurrency: ATS_REQUEST_QUEUE_CONCURRENCY_DEFAULT,
  sync_enabled_ats: SYNC_DEFAULT_ENABLED_ATS
};
const PHRASE_NGRAM_INDUSTRY_COVERAGE_THRESHOLD = 2;
const FALLBACK_WORD_INDUSTRY_COVERAGE_THRESHOLD = 2;
const MIN_INDUSTRY_FALLBACK_WORD_COUNT = 3;
const MIN_INDUSTRY_PHRASE_NGRAM_COUNT = 2;

function nowEpochSeconds() {
  return Math.floor(Date.now() / 1000);
}

function sanitizeFrontendText(value, fallback = "") {
  const source = String(value ?? "");
  if (!source) return fallback;

  let cleaned = "";
  for (let index = 0; index < source.length; index += 1) {
    const code = source.charCodeAt(index);

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

    if (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) {
      continue;
    }

    cleaned += source[index];
  }

  return cleaned || fallback;
}

function sanitizeFrontendValue(value) {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return sanitizeFrontendText(value, "");
  if (Array.isArray(value)) return value.map((item) => sanitizeFrontendValue(item));
  if (typeof value === "object") {
    const normalized = {};
    for (const [key, entryValue] of Object.entries(value)) {
      normalized[key] = sanitizeFrontendValue(entryValue);
    }
    return normalized;
  }
  return value;
}

function sanitizePublicPostingItem(posting) {
  return {
    id: Number(posting?.id || 0),
    company_name: String(posting?.company_name || ""),
    position_name: String(posting?.position_name || ""),
    job_posting_url: String(posting?.job_posting_url || ""),
    location: posting?.location || null,
    posting_date: posting?.posting_date || null,
    last_seen_epoch: Number(posting?.last_seen_epoch || 0),
    ats: String(posting?.ats || "")
  };
}

function sanitizePublicPostings(items) {
  return (Array.isArray(items) ? items : []).map(sanitizePublicPostingItem);
}

function roundPublicMetric(value, digits = 2) {
  const numberValue = Number(value || 0);
  if (!Number.isFinite(numberValue)) return 0;
  const factor = 10 ** digits;
  return Math.round(numberValue * factor) / factor;
}

function getPublicSourceLabel(value) {
  const normalized = normalizeAtsFilterValue(value);
  if (!normalized || normalized === "unknown") return "Unknown source";
  return ATS_FILTER_LABEL_BY_VALUE.get(normalized) || normalized;
}

function sanitizePublicSourceFacetItem(item) {
  const value = normalizeAtsFilterValue(item?.value || item?.ats || item?.source || "");
  const count = Math.max(0, Number(item?.count || 0));
  const freshCount = Math.max(0, Math.min(count, Number(item?.fresh_count || 0)));
  const freshPercentage = Number.isFinite(Number(item?.fresh_percentage))
    ? Math.max(0, Math.min(100, Math.round(Number(item.fresh_percentage))))
    : count > 0
      ? Math.round((freshCount / count) * 100)
      : 0;

  return {
    value: value || "unknown",
    label: sanitizeFrontendText(item?.label || getPublicSourceLabel(value), "Unknown source"),
    count,
    avg_confidence: roundPublicMetric(item?.avg_confidence, 2),
    avg_quality: roundPublicMetric(item?.avg_quality, 1),
    latest_seen_epoch: Math.max(0, Number(item?.latest_seen_epoch || 0)),
    fresh_count: freshCount,
    fresh_percentage: freshPercentage
  };
}

function sanitizePublicSourceFacets(items) {
  return (Array.isArray(items) ? items : [])
    .map(sanitizePublicSourceFacetItem)
    .filter((item) => item.count > 0)
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, PUBLIC_SOURCE_FACET_LIMIT);
}

function buildPublicSourceFacets(rows, limit = PUBLIC_SOURCE_FACET_LIMIT) {
  const sourceRows = Array.isArray(rows) ? rows : [];
  const freshCutoffEpoch = nowEpochSeconds() - PUBLIC_SOURCE_FACET_FRESH_DAYS * 24 * 60 * 60;
  const bySource = new Map();

  for (const row of sourceRows) {
    const jobPostingUrl = String(row?.job_posting_url || row?.canonical_url || "").trim();
    const value = normalizeAtsFilterValue(row?.ats || row?.ats_key || inferAtsFromJobPostingUrl(jobPostingUrl)) || "unknown";
    const existing = bySource.get(value) || {
      value,
      label: getPublicSourceLabel(value),
      count: 0,
      confidenceSum: 0,
      qualitySum: 0,
      latest_seen_epoch: 0,
      fresh_count: 0
    };
    existing.count += 1;
    existing.confidenceSum += Math.max(0, Number(row?.confidence ?? row?.confidence_score ?? 0) || 0);
    existing.qualitySum += Math.max(0, Number(row?.quality_score ?? row?.quality ?? 0) || 0);
    const lastSeenEpoch = Math.max(0, Number(row?.last_seen_epoch || 0));
    if (lastSeenEpoch > existing.latest_seen_epoch) {
      existing.latest_seen_epoch = lastSeenEpoch;
    }
    if (lastSeenEpoch >= freshCutoffEpoch) {
      existing.fresh_count += 1;
    }
    bySource.set(value, existing);
  }

  return sanitizePublicSourceFacets(
    Array.from(bySource.values()).map((item) => ({
      value: item.value,
      label: item.label,
      count: item.count,
      avg_confidence: item.count > 0 ? item.confidenceSum / item.count : 0,
      avg_quality: item.count > 0 ? item.qualitySum / item.count : 0,
      latest_seen_epoch: item.latest_seen_epoch,
      fresh_count: item.fresh_count,
      fresh_percentage: item.count > 0 ? Math.round((item.fresh_count / item.count) * 100) : 0
    }))
  ).slice(0, limit);
}

function sqlitePostingRowToQualityInput(row = {}) {
  const jobPostingUrl = String(row?.job_posting_url || row?.canonical_url || "").trim();
  const atsKey = String(row?.ats || row?.ats_key || inferAtsFromJobPostingUrl(jobPostingUrl)).trim();
  return {
    ...row,
    canonical_url: jobPostingUrl,
    job_posting_url: jobPostingUrl,
    company_name: row?.company_name,
    position_name: row?.position_name,
    location: row?.location,
    location_text: row?.location,
    ats_key: atsKey,
    source_job_id: String(row?.source_job_id || extractSourceIdFromPostingUrl(jobPostingUrl, atsKey) || "").trim(),
    parser_version: String(row?.parser_version || "legacy-adapter-v1"),
    confidence: Number(row?.confidence || 0),
    quality_score: Number(row?.quality_score || 0),
    quality_flags: row?.quality_flags,
    rejection_reason: row?.rejection_reason,
    first_seen_epoch: Number(row?.first_seen_epoch || 0),
    last_seen_epoch: Number(row?.last_seen_epoch || 0)
  };
}

async function getSqlitePostingDiagnostics(options = {}) {
  const canonicalUrl = String(options.canonicalUrl || options.url || "").trim();
  const id = Number(options.id || 0);
  if (!canonicalUrl && (!Number.isFinite(id) || id <= 0)) return null;
  const row = await db.get(
    `
      SELECT
        p.id,
        p.company_name,
        p.position_name,
        p.job_posting_url,
        p.location,
        p.posting_date,
        p.first_seen_epoch,
        p.last_seen_epoch,
        p.source_job_id,
        p.parser_version,
        p.confidence,
        p.quality_score,
        p.quality_flags,
        p.rejection_reason,
        p.hidden,
        pc.source_company_url,
        pc.raw_payload_hash,
        pc.validation_status,
        pc.validation_error,
        pc.updated_at AS cache_updated_at
      FROM Postings p
      LEFT JOIN posting_cache pc
        ON pc.canonical_url = p.job_posting_url
      WHERE ${canonicalUrl ? "p.job_posting_url = ?" : "p.id = ?"}
      LIMIT 1;
    `,
    [canonicalUrl || id]
  );
  if (!row) return null;
  const atsKey = inferAtsFromJobPostingUrl(row.job_posting_url);
  let duplicateOf = "";
  if (String(row.source_job_id || "").trim()) {
    const duplicate = await db.get(
      `
        SELECT job_posting_url
        FROM Postings
        WHERE source_job_id = ?
          AND job_posting_url <> ?
        ORDER BY COALESCE(last_seen_epoch, 0) DESC
        LIMIT 1;
      `,
      [row.source_job_id, row.job_posting_url]
    );
    duplicateOf = String(duplicate?.job_posting_url || "");
  }
  const diagnostics = buildQualityMetadata(
    {
      ...sqlitePostingRowToQualityInput({ ...row, ats: atsKey }),
      raw_payload_hash: row.raw_payload_hash,
      validation_status: row.validation_status,
      validation_error: row.validation_error
    },
    { duplicateOf }
  );
  return {
    id: Number(row.id || 0),
    canonical_url: String(row.job_posting_url || ""),
    title: String(row.position_name || ""),
    company: String(row.company_name || ""),
    diagnostics
  };
}

async function getSqliteQualitySummary(limit = 100) {
  const audit = await getSqliteQualityAudit(db, { limit });
  return {
    ...makeQualitySummary(audit.by_source, audit.summary),
    by_parser: audit.by_parser
  };
}

async function listSqliteRejections(limit = 50) {
  const cappedLimit = Math.max(1, Math.min(250, Number(limit || 50)));
  const rows = await db.all(
    `
      SELECT
        canonical_url,
        ats_key,
        company_name,
        position_name,
        source_company_url,
        validation_status,
        validation_error,
        quality_flags,
        rejection_reason,
        updated_at
      FROM posting_cache
      WHERE validation_status <> 'valid'
         OR TRIM(COALESCE(rejection_reason, '')) <> ''
      ORDER BY updated_at DESC
      LIMIT ?;
    `,
    [cappedLimit]
  );
  const items = rows.map((row) => ({
    type: "posting_cache",
    canonical_url: String(row?.canonical_url || ""),
    ats_key: String(row?.ats_key || ""),
    company_name: String(row?.company_name || ""),
    position_name: String(row?.position_name || ""),
    source_url: String(row?.source_company_url || ""),
    rejection_reason: String(row?.rejection_reason || row?.validation_error || ""),
    quality_flags: parseQualityFlags(row?.quality_flags),
    updated_at: String(row?.updated_at || "")
  }));
  const remaining = cappedLimit - items.length;
  if (remaining > 0) {
    const errors = await db.all(
      `
        SELECT run_id, ats_key, company_url, company_name, error_type, error_message, http_status, created_at
        FROM ingestion_run_errors
        WHERE error_type LIKE 'parser_%'
        ORDER BY id DESC
        LIMIT ?;
      `,
      [remaining]
    );
    items.push(...errors.map((row) => ({
      type: "ingestion_run_error",
      canonical_url: "",
      ats_key: String(row?.ats_key || ""),
      company_name: String(row?.company_name || ""),
      position_name: "",
      source_url: String(row?.company_url || ""),
      rejection_reason: String(row?.error_message || row?.error_type || ""),
      quality_flags: ["rejected"],
      http_status: row?.http_status == null ? null : Number(row.http_status),
      updated_at: String(row?.created_at || "")
    })));
  }
  return items;
}

async function getSqliteParserStats(limit = 100) {
  const [qualityReport, attentionRows] = await Promise.all([
    getSqliteQualityAudit(db, { limit }),
    db.all(
      `
        SELECT ats_key, COUNT(*) AS error_count, MAX(created_at) AS latest_error_at
        FROM ingestion_run_errors
        WHERE error_type LIKE 'parser_%'
        GROUP BY ats_key
        ORDER BY error_count DESC, latest_error_at DESC
        LIMIT ?;
      `,
      [Math.max(1, Math.min(250, Number(limit || 100)))]
    )
  ]);
  const attentionByAts = new Map(attentionRows.map((row) => [String(row.ats_key || ""), row]));
  return qualityReport.by_parser.map((item) => {
    const attention = attentionByAts.get(item.source_ats || item.ats_key) || {};
    return {
      ...item,
      flag_counts: item.quality_flag_counts || {},
      parser_attention_count: Number(attention.error_count || 0),
      latest_parser_error_at: String(attention.latest_error_at || "")
    };
  });
}

function parseCsvEnv(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeOrigin(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    return `${parsed.protocol}//${parsed.host}`.toLowerCase();
  } catch {
    return raw.replace(/\/+$/, "").toLowerCase();
  }
}

function escapeHtmlAttribute(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function getPublicSiteOrigin(req) {
  const configured = normalizeOrigin(PUBLIC_SITE_URL);
  if (configured) return configured;
  if (NODE_ENV === "production") return "https://openjobslots.com";

  const forwardedProto = String(req.get("x-forwarded-proto") || "").split(",")[0].trim();
  const forwardedHost = String(req.get("x-forwarded-host") || "").split(",")[0].trim();
  const protocol = forwardedProto || req.protocol || "http";
  const host = forwardedHost || req.get("host") || `localhost:${PORT}`;
  return normalizeOrigin(`${protocol}://${host}`) || `http://localhost:${PORT}`;
}

function getPublicSiteCanonicalUrl(req) {
  return `${getPublicSiteOrigin(req)}/`;
}

function removeExistingSeoTags(html) {
  return String(html || "")
    .replace(/\s*<meta[^>]+name=["'](?:description|robots|twitter:card|twitter:title|twitter:description)["'][^>]*>/gi, "")
    .replace(/\s*<meta[^>]+property=["'](?:og:title|og:description|og:type|og:url|og:site_name)["'][^>]*>/gi, "")
    .replace(/\s*<link[^>]+rel=["']canonical["'][^>]*>/gi, "");
}

function renderSeoIndexHtml(indexHtml, req) {
  const canonicalUrl = getPublicSiteCanonicalUrl(req);
  const title = escapeHtmlAttribute(SEO_SITE_TITLE);
  const description = escapeHtmlAttribute(SEO_SITE_DESCRIPTION);
  const canonical = escapeHtmlAttribute(canonicalUrl);
  const analyticsTags = buildPublicWebAnalyticsHeadTags(readPublicWebAnalyticsConfig());
  const tags = [
    '<meta name="description" content="' + description + '" />',
    '<link rel="canonical" href="' + canonical + '" />',
    '<meta name="robots" content="index, follow" />',
    '<meta property="og:type" content="website" />',
    '<meta property="og:site_name" content="OpenJobSlots" />',
    '<meta property="og:title" content="' + title + '" />',
    '<meta property="og:description" content="' + description + '" />',
    '<meta property="og:url" content="' + canonical + '" />',
    '<meta name="twitter:card" content="summary" />',
    '<meta name="twitter:title" content="' + title + '" />',
    '<meta name="twitter:description" content="' + description + '" />'
  ].join("\n    ");
  const managedAnalyticsTags = analyticsTags
    ? [
      "<!-- OpenJobSlots public analytics start -->",
      analyticsTags,
      "<!-- OpenJobSlots public analytics end -->"
    ].join("\n    ")
    : "";

  let html = stripPublicWebAnalyticsHeadTags(removeExistingSeoTags(indexHtml)).replace(
    /<title>[\s\S]*?<\/title>/i,
    `<title>${title}</title>`
  );
  if (!/<\/head>/i.test(html)) return html;
  const analyticsBlock = managedAnalyticsTags ? `\n    ${managedAnalyticsTags}` : "";
  return html.replace(
    /<\/head>/i,
    `    <!-- OpenJobSlots SEO metadata -->\n    ${tags}${analyticsBlock}\n</head>`
  );
}

function buildRobotsTxt(req) {
  return [
    "User-agent: *",
    "Allow: /",
    "Disallow: /applications",
    "Disallow: /settings",
    "Disallow: /sync",
    "Disallow: /ingestion",
    "Disallow: /mcp",
    "Disallow: /frontend",
    "Disallow: /postings",
    `Sitemap: ${getPublicSiteOrigin(req)}/sitemap.xml`
  ].join("\n") + "\n";
}

function buildSitemapXml(req) {
  const canonicalUrl = escapeHtmlAttribute(getPublicSiteCanonicalUrl(req));
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    "  <url>",
    `    <loc>${canonicalUrl}</loc>`,
    "    <changefreq>daily</changefreq>",
    "    <priority>1.0</priority>",
    "  </url>",
    "</urlset>"
  ].join("\n") + "\n";
}

function getAllowedOrigins() {
  const configured = parseCsvEnv(process.env.OPENJOBSLOTS_ALLOWED_ORIGINS).map(normalizeOrigin);
  const defaults = [
    "http://localhost:8787",
    `http://localhost:${PORT}`,
    "http://127.0.0.1:8787",
    `http://127.0.0.1:${PORT}`,
    "http://jobs.local",
    "https://jobs.local",
    "http://openjobslots.com",
    "https://openjobslots.com",
    "http://www.openjobslots.com",
    "http://internal-host:8081",
    "https://www.openjobslots.com"
  ];
  return new Set([...configured, ...defaults.map(normalizeOrigin)].filter(Boolean));
}

function isLocalDevelopmentOrigin(origin) {
  if (NODE_ENV === "production") return false;
  try {
    const parsed = new URL(String(origin || ""));
    return (
      (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)
    );
  } catch {
    return false;
  }
}

function isLocalRequest(req) {
  const candidates = [
    req.ip,
    req.socket?.remoteAddress,
    req.connection?.remoteAddress
  ].map((value) => String(value || "").toLowerCase());
  return candidates.some((ip) =>
    ip === "127.0.0.1" ||
    ip === "::1" ||
    ip === "::ffff:127.0.0.1" ||
    ip === "localhost" ||
    ip.startsWith("::ffff:127.")
  );
}

function safeCompareToken(actual, expected) {
  if (!actual || !expected) return false;
  const actualBuffer = Buffer.from(String(actual), "utf8");
  const expectedBuffer = Buffer.from(String(expected), "utf8");
  if (actualBuffer.length !== expectedBuffer.length) return false;
  return crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

function getBearerToken(req) {
  const header = String(req.get("authorization") || "").trim();
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

function hasAdminAccess(req) {
  const requestToken = getBearerToken(req) || String(req.get("x-openjobslots-admin-token") || "").trim();
  if (ADMIN_TOKEN) return safeCompareToken(requestToken, ADMIN_TOKEN);
  if (NODE_ENV === "production") return false;
  return ALLOW_LOCAL_ADMIN && isLocalRequest(req);
}

const CONTROL_ROUTE_PREFIXES = Object.freeze([
  "/admin",
  "/settings",
  "/mcp",
  "/applications",
  "/ingestion/quality",
  "/ingestion/rejections",
  "/ingestion/parser-stats",
  "/ingestion/source-quality",
  "/ingestion/parser-drift",
  "/ingestion/quarantine-summary"
]);
const CONTROL_ROUTE_EXACT = Object.freeze([
  "/sync/start",
  "/sync/stop",
  "/sync/ats",
  "/sync/workday",
  "/postings/ignore",
  "/ingestion/growth-summary"
]);

function isPostingDiagnosticsRoute(pathname) {
  return pathname === "/postings/diagnostics" || /^\/postings\/[^/]+\/diagnostics$/.test(pathname);
}

function isControlRoute(req) {
  const pathname = String(req.path || "").toLowerCase();
  return (
    CONTROL_ROUTE_EXACT.includes(pathname) ||
    CONTROL_ROUTE_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)) ||
    isPostingDiagnosticsRoute(pathname)
  );
}

function buildSecurityContentSecurityPolicy(env = process.env) {
  const analyticsCsp = buildGoogleAnalyticsCsp(readPublicWebAnalyticsConfig(env));
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    ["img-src 'self' data:", ...analyticsCsp.imgSrc].join(" "),
    "font-src 'self' data:",
    "style-src 'self' 'unsafe-inline'",
    ["script-src 'self' 'unsafe-inline'", ...analyticsCsp.scriptSrc].join(" "),
    ["connect-src 'self'", ...analyticsCsp.connectSrc].join(" "),
    "form-action 'self'"
  ].join("; ");
}

function securityHeadersMiddleware(_req, res, next) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader("Content-Security-Policy", buildSecurityContentSecurityPolicy());
  if (NODE_ENV === "production") {
    res.setHeader("Strict-Transport-Security", "max-age=15552000; includeSubDomains");
  }
  next();
}

function createRateLimiter({ windowMs, max, name }) {
  const buckets = new Map();
  let lastCleanup = Date.now();
  return (req, res, next) => {
    const now = Date.now();
    if (now - lastCleanup > windowMs) {
      for (const [key, bucket] of buckets.entries()) {
        if (bucket.resetAt <= now) buckets.delete(key);
      }
      lastCleanup = now;
    }

    const ip = String(req.ip || req.socket?.remoteAddress || "unknown");
    const key = `${name}:${ip}`;
    const bucket = buckets.get(key) || { count: 0, resetAt: now + windowMs };
    if (bucket.resetAt <= now) {
      bucket.count = 0;
      bucket.resetAt = now + windowMs;
    }
    bucket.count += 1;
    buckets.set(key, bucket);

    res.setHeader("RateLimit-Limit", String(max));
    res.setHeader("RateLimit-Remaining", String(Math.max(0, max - bucket.count)));
    res.setHeader("RateLimit-Reset", String(Math.ceil(bucket.resetAt / 1000)));

    if (bucket.count > max) {
      return res.status(429).json({
        ok: false,
        error: "Too many requests. Please retry shortly."
      });
    }
    return next();
  };
}

function createTtlJsonCache({ ttlMs, maxEntries }) {
  const entries = new Map();
  const resolvedTtlMs = Math.max(0, Number(ttlMs || 0));
  const resolvedMaxEntries = Math.max(1, Number(maxEntries || 1));

  const pruneExpired = (now) => {
    for (const [key, entry] of entries.entries()) {
      if (entry.expiresAt <= now) entries.delete(key);
    }
  };

  return {
    clear() {
      entries.clear();
    },
    get(key) {
      if (resolvedTtlMs <= 0) return null;
      const now = Date.now();
      const entry = entries.get(key);
      if (!entry) return null;
      if (entry.expiresAt <= now) {
        entries.delete(key);
        return null;
      }
      return entry.payload;
    },
    set(key, payload) {
      if (resolvedTtlMs <= 0) return;
      const now = Date.now();
      if (entries.size >= resolvedMaxEntries) pruneExpired(now);
      while (entries.size >= resolvedMaxEntries) {
        const oldestKey = entries.keys().next().value;
        if (!oldestKey) break;
        entries.delete(oldestKey);
      }
      entries.set(key, {
        payload,
        expiresAt: now + resolvedTtlMs
      });
    }
  };
}

function getPublicReadCacheKey(req) {
  const authScope = hasAdminAccess(req) ? "admin" : "public";
  return `${authScope}:${req.method}:${req.originalUrl || req.url || req.path || ""}`;
}

function callPublicJsonPayloadHook(hook, req, payload, info) {
  if (typeof hook !== "function") return;
  try {
    Promise.resolve(hook(payload, info)).catch((error) => {
      console.warn("[openjobslots] public_json_payload_hook_failed", String(error?.message || error));
    });
  } catch (error) {
    console.warn("[openjobslots] public_json_payload_hook_failed", String(error?.message || error));
  }
}

async function sendCachedPublicJson(req, res, cache, producer, options = {}) {
  const key = getPublicReadCacheKey(req);
  const cached = cache.get(key);
  if (cached) {
    res.setHeader("X-OpenJobSlots-Cache", "HIT");
    callPublicJsonPayloadHook(options.afterPayload, req, cached, { cacheStatus: "HIT" });
    return res.json(cached);
  }
  const payload = await producer();
  cache.set(key, payload);
  res.setHeader("X-OpenJobSlots-Cache", "MISS");
  callPublicJsonPayloadHook(options.afterPayload, req, payload, { cacheStatus: "MISS" });
  return res.json(payload);
}

function adminGateMiddleware(req, res, next) {
  if (!isControlRoute(req)) return next();
  if (hasAdminAccess(req)) return next();
  return res.status(401).json({
    ok: false,
    error: ADMIN_TOKEN
      ? "Admin token required."
      : "Admin endpoint requires OPENJOBSLOTS_ADMIN_TOKEN, or OPENJOBSLOTS_ALLOW_LOCAL_ADMIN=1 for private local development."
  });
}

function genericErrorMiddleware(error, req, res, _next) {
  const status = Number(error?.status || error?.statusCode || 500);
  const safeStatus = Number.isFinite(status) && status >= 400 && status < 600 ? status : 500;
  console.error("[openjobslots API] request failed:", {
    method: req.method,
    path: req.path,
    status: safeStatus,
    message: String(error?.message || error)
  });
  if (res.headersSent) return;
  res.status(safeStatus).json({
    ok: false,
    error: safeStatus >= 500 ? "Internal server error. Details were logged for debugging." : "Request failed."
  });
}

function ensureFrontendLogDirectory() {
  fs.mkdirSync(BACKEND_LOG_DIRECTORY_PATH, { recursive: true });
}

function normalizeFrontendLogLevel(value) {
  const normalized = String(value || "info")
    .trim()
    .toLowerCase();
  if (["debug", "info", "warn", "error", "fatal"].includes(normalized)) {
    return normalized;
  }
  return "info";
}

function appendFrontendLogEntry(level, eventName, message, context) {
  ensureFrontendLogDirectory();

  const timestamp = new Date().toISOString();
  const entry = {
    timestamp,
    level: normalizeFrontendLogLevel(level),
    event: sanitizeFrontendText(eventName, "frontend_event"),
    message: sanitizeFrontendText(message, ""),
    context: sanitizeFrontendValue(context || {})
  };

  const line = `${JSON.stringify(entry)}\n`;
  fs.appendFileSync(FRONTEND_LOG_PATH, line, "utf8");
}

function normalizeLikeText(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function stripSearchDiacritics(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i")
    .replace(/İ/g, "I");
}

function normalizeSearchText(value) {
  return stripSearchDiacritics(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function tokenizeSearchText(value) {
  return expandSearchTokens(value);
}

function parseCsvParam(value) {
  return String(value || "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function normalizePublicLanguageCode(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/_/g, "-");
  if (!normalized) return "";
  const primary = normalized.split("-")[0];
  return PUBLIC_SUPPORTED_LANGUAGE_CODES.has(primary) ? primary : "";
}

function parseAcceptLanguagePreferences(value) {
  return String(value || "")
    .split(",")
    .map((part, index) => {
      const [tagPart, ...params] = part.trim().split(";");
      const qParam = params.find((param) => param.trim().toLowerCase().startsWith("q="));
      const qValue = qParam ? Number(qParam.split("=")[1]) : 1;
      return {
        tag: tagPart.trim(),
        q: Number.isFinite(qValue) ? qValue : 0,
        index
      };
    })
    .filter((item) => item.tag)
    .sort((a, b) => b.q - a.q || a.index - b.index);
}

function normalizePublicCountryCode(value) {
  const normalized = String(value || "")
    .trim()
    .toUpperCase();
  return /^[A-Z]{2}$/.test(normalized) ? normalized : "";
}

function resolvePublicLanguagePreference({ acceptLanguage, countryCode } = {}) {
  for (const preference of parseAcceptLanguagePreferences(acceptLanguage)) {
    const languageCode = normalizePublicLanguageCode(preference.tag);
    if (languageCode) return languageCode;
  }

  const countryLanguage = PUBLIC_COUNTRY_LANGUAGE_FALLBACKS[normalizePublicCountryCode(countryCode)];
  return normalizePublicLanguageCode(countryLanguage) || "en";
}

function buildPublicPreferences(req) {
  const countryCode = normalizePublicCountryCode(req.get("cf-ipcountry") || req.get("x-vercel-ip-country") || "");
  return {
    ok: true,
    default_language: resolvePublicLanguagePreference({
      acceptLanguage: req.get("accept-language"),
      countryCode
    }),
    country: countryCode,
    supported_languages: PUBLIC_SUPPORTED_LANGUAGES
  };
}

function parseJsonArray(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || "").trim()).filter(Boolean);
  }
  try {
    const parsed = JSON.parse(String(value || "[]"));
    if (!Array.isArray(parsed)) return [];
    return parsed.map((item) => String(item || "").trim()).filter(Boolean);
  } catch {
    return [];
  }
}

function parseJsonObject(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value || "{}"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeGeoText(value) {
  return stripSearchDiacritics(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function containsGeoPhrase(normalizedGeoTextValue, phrase) {
  const haystack = String(normalizedGeoTextValue || "").trim();
  const needle = normalizeGeoText(phrase);
  if (!haystack || !needle) return false;
  return ` ${haystack} `.includes(` ${needle} `);
}

function toTitleCaseWords(value) {
  const source = normalizeGeoText(value);
  if (!source) return "";
  return source
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function buildCountryLookupMaps() {
  const byCode = new Map();
  const aliasToCode = new Map();
  const aliasesByCode = new Map();

  for (const item of COUNTRY_DEFINITIONS) {
    const code = String(item?.code || "")
      .trim()
      .toUpperCase();
    if (!code) continue;

    const label = String(item?.label || code).trim();
    const region = String(item?.region || "")
      .trim()
      .toUpperCase();
    const aliasValues = [label, ...(Array.isArray(item?.aliases) ? item.aliases : [])];
    const aliasSet = new Set();
    for (const aliasValue of aliasValues) {
      const normalizedAlias = normalizeGeoText(aliasValue);
      if (!normalizedAlias) continue;
      if (!aliasToCode.has(normalizedAlias)) {
        aliasToCode.set(normalizedAlias, code);
      }
      aliasSet.add(normalizedAlias);
    }

    byCode.set(code, { code, label, region });
    aliasesByCode.set(code, aliasSet);
  }

  return { byCode, aliasToCode, aliasesByCode };
}

const {
  byCode: COUNTRY_BY_CODE,
  aliasToCode: COUNTRY_ALIAS_TO_CODE,
  aliasesByCode: COUNTRY_ALIASES_BY_CODE
} = buildCountryLookupMaps();

function parseRegionFilters(values) {
  const normalized = normalizeStringArray(values)
    .map((value) => String(value || "").trim().toUpperCase())
    .filter((value) => LOCATION_REGION_VALUES.has(value));
  return Array.from(new Set(normalized));
}

function normalizeCountryLikePart(value) {
  return normalizeGeoText(value)
    .replace(/\b(country|republic|federation|state)\b/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function isLikelyCountryLikePart(value) {
  const candidate = normalizeCountryLikePart(value);
  if (!candidate) return false;
  if (candidate.length < 3 || candidate.length > 40) return false;
  if (candidate.split(" ").length > 4) return false;
  if (/\d/.test(candidate)) return false;
  if (LOCATION_NON_COUNTRY_TERMS.has(candidate)) return false;
  if (US_STATE_NAMES.has(candidate)) return false;
  if (/^[a-z]{2}$/.test(candidate)) return false;
  return true;
}

function splitLocationIntoCountryCandidateSegments(locationText) {
  return String(locationText || "")
    .split(/[,/|;]+|\s+-\s+/)
    .map((segment) => String(segment || "").trim())
    .filter(Boolean);
}

function collectCountryCandidates(locationText) {
  const segments = splitLocationIntoCountryCandidateSegments(locationText);
  if (segments.length === 0) return [];

  const candidates = [];
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const normalizedSegment = normalizeCountryLikePart(segments[index]);
    if (!normalizedSegment) continue;
    candidates.push(normalizedSegment);

    const words = normalizedSegment.split(" ").filter(Boolean);
    const maxWords = Math.min(words.length, 4);
    for (let size = maxWords; size >= 1; size -= 1) {
      const suffix = words.slice(words.length - size).join(" ");
      if (suffix) candidates.push(suffix);
    }
  }

  return Array.from(new Set(candidates));
}

function inferRegionFromNormalizedGeoText(normalizedGeoTextValue, countryCode = "") {
  for (const region of ["AMER", "EMEA", "APAC"]) {
    const hints = REGION_HINTS_BY_VALUE[region] || [];
    const hasHint = hints.some((hint) => containsGeoPhrase(normalizedGeoTextValue, hint));
    if (hasHint) return region;
  }

  const explicitCountryCode = String(countryCode || "").trim().toUpperCase();
  if (explicitCountryCode) {
    return String(COUNTRY_BY_CODE.get(explicitCountryCode)?.region || "").trim().toUpperCase();
  }

  return "";
}

function inferRegionFromLocationText(locationText, countryCode = "") {
  return inferRegionFromNormalizedGeoText(normalizeGeoText(locationText), countryCode);
}

function inferLocationGeoUncached(locationText) {
  const location = String(locationText || "").trim();
  const normalizedGeoLocation = normalizeGeoText(location);
  if (!location || !normalizedGeoLocation) {
    return {
      countryCode: "",
      countryValue: "",
      countryLabel: "",
      countryLikePart: "",
      region: ""
    };
  }

  const countryCandidates = collectCountryCandidates(location);
  for (const candidate of countryCandidates) {
    const countryCode = COUNTRY_ALIAS_TO_CODE.get(candidate);
    if (!countryCode) continue;
    const country = COUNTRY_BY_CODE.get(countryCode);
    const region =
      inferRegionFromNormalizedGeoText(normalizedGeoLocation, countryCode) ||
      String(country?.region || "").trim().toUpperCase();
    return {
      countryCode,
      countryValue: countryCode,
      countryLabel: String(country?.label || countryCode),
      countryLikePart: normalizeGeoText(country?.label || candidate),
      region
    };
  }

  const segments = splitLocationIntoCountryCandidateSegments(location);
  let fallbackCountryLikePart = "";
  if (segments.length >= 2) {
    for (let index = segments.length - 1; index >= 1; index -= 1) {
      const candidate = normalizeCountryLikePart(segments[index]);
      if (!isLikelyCountryLikePart(candidate)) continue;
      fallbackCountryLikePart = candidate;
      break;
    }
  }

  const region = inferRegionFromNormalizedGeoText(normalizedGeoLocation);
  return {
    countryCode: "",
    countryValue: fallbackCountryLikePart ? `RAW:${fallbackCountryLikePart}` : "",
    countryLabel: fallbackCountryLikePart ? toTitleCaseWords(fallbackCountryLikePart) : "",
    countryLikePart: fallbackCountryLikePart,
    region
  };
}

function inferLocationGeo(locationText) {
  const location = String(locationText || "").trim();
  if (!location) {
    return {
      countryCode: "",
      countryValue: "",
      countryLabel: "",
      countryLikePart: "",
      region: ""
    };
  }

  const cached = locationGeoInferenceCache.get(location);
  if (cached) return cached;

  const inferred = inferLocationGeoUncached(location);
  if (locationGeoInferenceCache.size >= LOCATION_GEO_INFERENCE_CACHE_LIMIT) {
    locationGeoInferenceCache.clear();
  }
  locationGeoInferenceCache.set(location, inferred);
  return inferred;
}

function parseCountryFilters(values) {
  const parsed = [];
  const seen = new Set();
  for (const rawValue of normalizeStringArray(values)) {
    const value = String(rawValue || "").trim();
    if (!value) continue;

    let nextFilter = null;
    if (/^raw:/i.test(value)) {
      const rawLikePart = normalizeCountryLikePart(value.slice(4));
      if (isLikelyCountryLikePart(rawLikePart)) {
        nextFilter = {
          type: "raw",
          rawLikePart,
          value: `RAW:${rawLikePart}`
        };
      }
    } else {
      const asCode = value.toUpperCase();
      if (COUNTRY_BY_CODE.has(asCode)) {
        nextFilter = {
          type: "code",
          code: asCode,
          value: asCode
        };
      } else {
        const aliasCountryCode = COUNTRY_ALIAS_TO_CODE.get(normalizeCountryLikePart(value));
        if (aliasCountryCode) {
          nextFilter = {
            type: "code",
            code: aliasCountryCode,
            value: aliasCountryCode
          };
        } else {
          const rawLikePart = normalizeCountryLikePart(value);
          if (isLikelyCountryLikePart(rawLikePart)) {
            nextFilter = {
              type: "raw",
              rawLikePart,
              value: `RAW:${rawLikePart}`
            };
          }
        }
      }
    }

    if (!nextFilter) continue;
    if (seen.has(nextFilter.value)) continue;
    seen.add(nextFilter.value);
    parsed.push(nextFilter);
  }
  return parsed;
}

function getCountryCodeForSearchToken(token) {
  const normalizedToken = normalizeCountryLikePart(token);
  if (!normalizedToken) return "";
  return COUNTRY_ALIAS_TO_CODE.get(normalizedToken) || "";
}

function searchTokenMatchesPosting(token, row) {
  const normalizedToken = normalizeSearchText(token);
  if (!normalizedToken) return true;

  const companyName = normalizeSearchText(row?.company_name);
  const positionName = normalizeSearchText(row?.position_name);
  const location = String(row?.location || "").trim();
  const normalizedLocation = normalizeSearchText(location);
  const ats = normalizeSearchText(row?.ats || row?.ATS_name);
  const remoteType = normalizeSearchText(classifyLocationWorkMode(location));

  if (
    companyName.includes(normalizedToken) ||
    positionName.includes(normalizedToken) ||
    normalizedLocation.includes(normalizedToken) ||
    ats.includes(normalizedToken) ||
    remoteType.includes(normalizedToken)
  ) {
    return true;
  }

  const countryCode = getCountryCodeForSearchToken(normalizedToken);
  if (!countryCode || !location) return false;

  const inferredGeo = inferLocationGeo(location);
  if (inferredGeo.countryCode && inferredGeo.countryCode === countryCode) {
    return true;
  }

  const aliases = COUNTRY_ALIASES_BY_CODE.get(countryCode);
  if (!(aliases instanceof Set)) return false;
  const normalizedGeoLocation = normalizeGeoText(location);
  return Array.from(aliases).some((alias) => containsGeoPhrase(normalizedGeoLocation, alias));
}

function getPostingLocationGeoFilterOptions() {
  if (
    postingLocationGeoFilterOptionsCache.mapRef === postingLocationByJobUrl &&
    postingLocationGeoFilterOptionsCache.version === postingLocationVersion
  ) {
    return postingLocationGeoFilterOptionsCache;
  }

  const countriesByValue = new Map();
  const presentRegions = new Set();
  for (const location of postingLocationByJobUrl.values()) {
    const inferred = inferLocationGeo(location);
    if (inferred.countryValue && inferred.countryLabel) {
      const existing = countriesByValue.get(inferred.countryValue);
      if (!existing) {
        countriesByValue.set(inferred.countryValue, {
          value: inferred.countryValue,
          label: inferred.countryLabel,
          region: inferred.region || ""
        });
      } else if (!existing.region && inferred.region) {
        existing.region = inferred.region;
      }
    }
    if (inferred.region) presentRegions.add(inferred.region);
  }

  const countries = Array.from(countriesByValue.values()).sort((a, b) =>
    String(a?.label || "").localeCompare(String(b?.label || ""))
  );
  const regions = LOCATION_REGION_OPTIONS.filter(
    (option) => presentRegions.size === 0 || presentRegions.has(option.value)
  ).map((option) => ({ ...option }));

  postingLocationGeoFilterOptionsCache = {
    mapRef: postingLocationByJobUrl,
    version: postingLocationVersion,
    countries,
    regions
  };
  return postingLocationGeoFilterOptionsCache;
}

function createLikeParts(value) {
  const normalized = normalizeLikeText(value);
  if (!normalized) return [];
  return normalized
    .split(/[^a-z0-9]+/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 3 && !GENERIC_TITLE_LIKE_PARTS.has(part));
}

function buildWordNgrams(words, minSize = 2, maxSize = 3) {
  const source = Array.isArray(words) ? words : [];
  const ngrams = [];
  for (let size = minSize; size <= maxSize; size += 1) {
    if (source.length < size) continue;
    for (let index = 0; index <= source.length - size; index += 1) {
      const gram = source.slice(index, index + size).join(" ").trim();
      if (gram) ngrams.push(gram);
    }
  }
  return ngrams;
}

function normalizeCountyName(value) {
  return normalizeLikeText(value)
    .replace(/\b(county|parish|borough|census area|municipality)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseCountyFilters(values) {
  const parsed = [];
  for (const rawValue of values) {
    const value = String(rawValue || "").trim();
    if (!value) continue;

    if (value.includes("|")) {
      const [stateRaw, countyRaw] = value.split("|");
      const stateCode = String(stateRaw || "").trim().toUpperCase();
      const countyLikePart = normalizeCountyName(countyRaw);
      if (!countyLikePart) continue;
      parsed.push({ stateCode, countyLikePart });
      continue;
    }

    const countyLikePart = normalizeCountyName(value);
    if (!countyLikePart) continue;
    parsed.push({ stateCode: "", countyLikePart });
  }
  return parsed;
}

function hasStateLikeMatch(locationText, stateCode) {
  const code = String(stateCode || "").trim().toUpperCase();
  if (!code) return false;

  const upperLocation = String(locationText || "").toUpperCase();
  const codeRegex = new RegExp(`(^|[^A-Z])${escapeRegExp(code)}([^A-Z]|$)`);
  if (codeRegex.test(upperLocation)) return true;

  const stateName = STATE_CODE_TO_NAME[code];
  if (!stateName) return false;
  return normalizeLikeText(locationText).includes(stateName);
}

function classifyLocationWorkMode(locationText) {
  const normalized = normalizeLikeText(locationText);
  if (!normalized) return "non_remote";
  const hasHybrid = normalized.includes("hybrid");
  const hasRemote = normalized.includes("remote") || normalized.includes("work from home") || normalized.includes("wfh");
  if (hasHybrid) return "hybrid";
  if (hasRemote) return "remote";
  return "non_remote";
}

async function buildIndustryMatchersByKey(industryKeys) {
  if (!Array.isArray(industryKeys) || industryKeys.length === 0) {
    return new Map();
  }

  const [wordIndustryCoverage, phraseNgramIndustryCoverage] = await Promise.all([
    getWordIndustryCoverageMap(),
    getPhraseNgramIndustryCoverageMap()
  ]);

  const placeholders = industryKeys.map(() => "?").join(", ");
  let rows = [];
  try {
    rows = await db.all(
      `
        SELECT industry_key, normalized_job_title
        FROM job_position_industry
        WHERE industry_key IN (${placeholders});
      `,
      industryKeys
    );
  } catch {
    return new Map();
  }

  const byIndustry = new Map();
  for (const key of industryKeys) {
    byIndustry.set(key, {
      exactTitles: new Set(),
      phraseNgrams: new Set(),
      fallbackWords: new Set(),
      wordCounts: new Map(),
      phraseCounts: new Map()
    });
  }

  for (const row of rows) {
    const key = String(row?.industry_key || "").trim();
    if (!key || !byIndustry.has(key)) continue;
    const normalizedTitle = normalizeLikeText(row?.normalized_job_title);
    const words = createLikeParts(normalizedTitle);
    const target = byIndustry.get(key);
    if (normalizedTitle) {
      target.exactTitles.add(normalizedTitle);
    }

    for (const word of new Set(words)) {
      target.wordCounts.set(word, (target.wordCounts.get(word) || 0) + 1);
    }

    for (const ngram of new Set(buildWordNgrams(words, 2, 3))) {
      target.phraseCounts.set(ngram, (target.phraseCounts.get(ngram) || 0) + 1);
    }
  }

  const finalized = new Map();
  for (const [industryKey, matcher] of byIndustry.entries()) {
    const fallbackWords = new Set();
    for (const [word, count] of matcher.wordCounts.entries()) {
      if (count < MIN_INDUSTRY_FALLBACK_WORD_COUNT) continue;
      if (isWeakFallbackWord(word, wordIndustryCoverage)) continue;
      fallbackWords.add(word);
    }

    const phraseNgrams = new Set();
    for (const [ngram, count] of matcher.phraseCounts.entries()) {
      if (count < MIN_INDUSTRY_PHRASE_NGRAM_COUNT) continue;
      if (isWeakPhraseNgram(ngram, phraseNgramIndustryCoverage)) continue;
      phraseNgrams.add(ngram);
    }

    finalized.set(industryKey, {
      exactTitles: matcher.exactTitles,
      phraseNgrams,
      fallbackWords
    });
  }

  return finalized;
}

async function getWordIndustryCoverageMap() {
  if (wordIndustryCoverageCache instanceof Map) {
    return wordIndustryCoverageCache;
  }

  let rows = [];
  try {
    rows = await db.all(
      `
        SELECT industry_key, normalized_job_title
        FROM job_position_industry;
      `
    );
  } catch {
    wordIndustryCoverageCache = new Map();
    return wordIndustryCoverageCache;
  }

  const wordIndustrySets = new Map();
  for (const row of rows) {
    const industryKey = String(row?.industry_key || "").trim();
    if (!industryKey) continue;

    const words = new Set(createLikeParts(row?.normalized_job_title));
    for (const word of words) {
      if (!wordIndustrySets.has(word)) {
        wordIndustrySets.set(word, new Set());
      }
      wordIndustrySets.get(word).add(industryKey);
    }
  }

  const coverageMap = new Map();
  for (const [word, keys] of wordIndustrySets.entries()) {
    coverageMap.set(word, keys.size);
  }

  wordIndustryCoverageCache = coverageMap;
  return coverageMap;
}

async function getPhraseNgramIndustryCoverageMap() {
  if (phraseNgramIndustryCoverageCache instanceof Map) {
    return phraseNgramIndustryCoverageCache;
  }

  let rows = [];
  try {
    rows = await db.all(
      `
        SELECT industry_key, normalized_job_title
        FROM job_position_industry;
      `
    );
  } catch {
    phraseNgramIndustryCoverageCache = new Map();
    return phraseNgramIndustryCoverageCache;
  }

  const ngramIndustrySets = new Map();
  for (const row of rows) {
    const industryKey = String(row?.industry_key || "").trim();
    if (!industryKey) continue;

    const words = createLikeParts(row?.normalized_job_title);
    const ngrams = new Set(buildWordNgrams(words, 2, 3));
    for (const ngram of ngrams) {
      if (!ngramIndustrySets.has(ngram)) {
        ngramIndustrySets.set(ngram, new Set());
      }
      ngramIndustrySets.get(ngram).add(industryKey);
    }
  }

  const coverageMap = new Map();
  for (const [ngram, keys] of ngramIndustrySets.entries()) {
    coverageMap.set(ngram, keys.size);
  }

  phraseNgramIndustryCoverageCache = coverageMap;
  return coverageMap;
}

function isWeakFallbackWord(word, wordIndustryCoverage) {
  if (!word) return true;
  if (WEAK_INDUSTRY_LIKE_PARTS.has(word)) return true;
  const industryCoverage = Number(wordIndustryCoverage?.get(word) || 0);
  return industryCoverage >= FALLBACK_WORD_INDUSTRY_COVERAGE_THRESHOLD;
}

function isWeakPhraseNgram(ngram, phraseNgramIndustryCoverage) {
  if (!ngram) return true;
  const parts = ngram.split(" ").map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2) return true;
  if (parts.every((part) => WEAK_INDUSTRY_LIKE_PARTS.has(part))) return true;
  const industryCoverage = Number(phraseNgramIndustryCoverage?.get(ngram) || 0);
  return industryCoverage >= PHRASE_NGRAM_INDUSTRY_COVERAGE_THRESHOLD;
}

function rowMatchesIndustryLikeParts(positionName, selectedIndustryKeys, industryMatchersByKey) {
  if (!Array.isArray(selectedIndustryKeys) || selectedIndustryKeys.length === 0) return true;
  if (!(industryMatchersByKey instanceof Map) || industryMatchersByKey.size === 0) return false;

  const titleText = String(positionName || "");
  const selectedKeySet = new Set(
    selectedIndustryKeys.map((key) => String(key || "").trim().toLowerCase()).filter(Boolean)
  );
  const isSalesExclusiveRole = SALES_EXCLUSIVE_ROLE_REGEX.test(titleText);
  if (isSalesExclusiveRole && !selectedKeySet.has(SALES_BUSINESS_INDUSTRY_KEY)) {
    return false;
  }

  const normalizedPosition = normalizeLikeText(positionName);
  const postingWords = createLikeParts(positionName);
  if (postingWords.length === 0) return false;
  const postingWordSet = new Set(postingWords);
  const postingPhraseSet = new Set(buildWordNgrams(postingWords, 2, 3));

  for (const industryKey of selectedIndustryKeys) {
    const matcher = industryMatchersByKey.get(industryKey);
    const exactTitles = matcher?.exactTitles;
    const phraseNgrams = matcher?.phraseNgrams;
    const fallbackWords = matcher?.fallbackWords;
    const hasMatcherData =
      exactTitles instanceof Set || phraseNgrams instanceof Set || fallbackWords instanceof Set;
    if (!hasMatcherData) continue;

    if (exactTitles instanceof Set && normalizedPosition && exactTitles.has(normalizedPosition)) {
      if (industryKey === IT_SOFTWARE_INDUSTRY_KEY && IT_SALES_GTM_ROLE_REGEX.test(titleText)) {
        continue;
      }

      const hasStrongPhrase =
        phraseNgrams instanceof Set &&
        Array.from(postingPhraseSet).some((postingPhrase) => phraseNgrams.has(postingPhrase));
      const hasStrongWord =
        fallbackWords instanceof Set &&
        Array.from(postingWordSet).some((word) => fallbackWords.has(word));
      if (hasStrongPhrase || hasStrongWord) {
        return true;
      }
      if (
        industryKey === IT_SOFTWARE_INDUSTRY_KEY &&
        Array.from(postingWordSet).some((word) => IT_HIGH_SIGNAL_ANCHOR_PARTS.has(word))
      ) {
        return true;
      }
    }

    if (industryKey === IT_SOFTWARE_INDUSTRY_KEY) {
      if (IT_SALES_GTM_ROLE_REGEX.test(titleText)) continue;
      const hasTechAnchor = Array.from(postingWordSet).some((part) => IT_TECH_ANCHOR_PARTS.has(part));
      if (!hasTechAnchor) continue;
    }

    if (phraseNgrams instanceof Set && phraseNgrams.size > 0) {
      for (const postingPhrase of postingPhraseSet) {
        if (phraseNgrams.has(postingPhrase)) {
          return true;
        }
      }
    }

    if (fallbackWords instanceof Set && fallbackWords.size > 0) {
      for (const word of postingWordSet) {
        if (fallbackWords.has(word)) {
          if (
            industryKey !== IT_SOFTWARE_INDUSTRY_KEY ||
            postingWordSet.size === 1 ||
            IT_HIGH_SIGNAL_ANCHOR_PARTS.has(word)
          ) {
            return true;
          }
        }
      }
    }

    if (industryKey === IT_SOFTWARE_INDUSTRY_KEY) {
      for (const word of postingWordSet) {
        if (IT_HIGH_SIGNAL_ANCHOR_PARTS.has(word) && fallbackWords instanceof Set && fallbackWords.has(word)) {
          return true;
        }
      }
    }
  }

  return false;
}
function rowMatchesLocationFilters(
  locationText,
  selectedStateCodes,
  countyFilters,
  countryFilters = [],
  selectedRegions = []
) {
  const stateCodes = Array.isArray(selectedStateCodes) ? selectedStateCodes : [];
  const counties = Array.isArray(countyFilters) ? countyFilters : [];
  const countries = Array.isArray(countryFilters) ? countryFilters : [];
  const regions = Array.isArray(selectedRegions) ? selectedRegions : [];
  if (stateCodes.length === 0 && counties.length === 0 && countries.length === 0 && regions.length === 0) return true;

  const location = String(locationText || "").trim();
  if (!location) return false;
  const normalizedLocation = normalizeLikeText(location);
  const normalizedGeoLocation = normalizeGeoText(location);
  const inferredGeo = inferLocationGeo(location);

  if (stateCodes.length > 0) {
    const hasSelectedState = stateCodes.some((stateCode) => hasStateLikeMatch(location, stateCode));
    if (!hasSelectedState) return false;
  }

  if (counties.length > 0) {
    const matchesCounty = counties.some((countyFilter) => {
      const countyLikePart = String(countyFilter?.countyLikePart || "").trim();
      if (!countyLikePart) return false;

      if (countyFilter.stateCode && !hasStateLikeMatch(location, countyFilter.stateCode)) {
        return false;
      }

      return (
        normalizedLocation.includes(countyLikePart) ||
        normalizedLocation.includes(`${countyLikePart} county`) ||
        normalizedLocation.includes(`${countyLikePart} parish`) ||
        normalizedLocation.includes(`${countyLikePart} borough`) ||
        normalizedLocation.includes(`${countyLikePart} census area`)
      );
    });

    if (!matchesCounty) return false;
  }

  if (countries.length > 0) {
    const matchesCountry = countries.some((countryFilter) => {
      if (countryFilter?.type === "code") {
        const selectedCountryCode = String(countryFilter?.code || "").trim().toUpperCase();
        if (!selectedCountryCode) return false;
        if (inferredGeo.countryCode && inferredGeo.countryCode === selectedCountryCode) {
          return true;
        }

        const aliases = COUNTRY_ALIASES_BY_CODE.get(selectedCountryCode);
        if (!(aliases instanceof Set)) return false;
        return Array.from(aliases).some((alias) => containsGeoPhrase(normalizedGeoLocation, alias));
      }

      const rawLikePart = String(countryFilter?.rawLikePart || "").trim();
      if (!rawLikePart) return false;
      return containsGeoPhrase(normalizedGeoLocation, rawLikePart);
    });

    if (!matchesCountry) return false;
  }

  if (regions.length > 0) {
    const region = inferredGeo.region || inferRegionFromNormalizedGeoText(normalizedGeoLocation, inferredGeo.countryCode);
    if (!region || !regions.includes(region)) return false;
  }

  return true;
}

function rowMatchesRemoteFilter(locationText, remoteFilter) {
  const normalized = normalizeRemoteFilter(remoteFilter);
  if (!normalized || normalized === "all") return true;
  const mode = classifyLocationWorkMode(locationText);
  if (normalized === "remote") return mode === "remote";
  if (normalized === "hybrid") return mode === "hybrid";
  if (normalized === "non_remote") return mode === "non_remote";
  return true;
}

function normalizeRemoteFilter(value) {
  const normalized = String(value || "all")
    .trim()
    .toLowerCase();
  if (normalized === "remote" || normalized === "hybrid" || normalized === "non_remote") return normalized;
  return "all";
}

function inferAtsFromJobPostingUrl(value) {
  const url = String(value || "").trim().toLowerCase();
  if (!url) return "";
  if (url.includes("myworkdayjobs.com")) return "workday";
  if (url.includes("jobs.ashbyhq.com")) return "ashby";
  if (url.includes("job-boards.greenhouse.io") || url.includes("boards.greenhouse.io")) return "greenhouse";
  if (url.includes("jobs.lever.co")) return "lever";
  if (url.includes(".recruitee.com")) return "recruitee";
  if (url.includes("recruiting.ultipro.com/") && url.includes("/jobboard/")) return "ultipro";
  if (url.includes(".taleo.net/careersection/")) return "taleo";
  if ((url.includes("jobs.jobvite.com/") || url.includes("careers.jobvite.com/")) && url.includes("/job/")) {
    return "jobvite";
  }
  if (url.includes(".applicantpro.com/jobs")) return "applicantpro";
  if (url.includes(".applytojob.com/apply")) return "applytojob";
  if (url.includes(".icims.com/jobs/")) return "icims";
  if (url.includes("theapplicantmanager.com/jobs")) return "theapplicantmanager";
  if (url.includes(".breezy.hr/p/")) return "breezy";
  if (url.includes(".zohorecruit.com/jobs/careers")) return "zoho";
  if (url.includes("applicantai.com/")) return "applicantai";
  if (url.includes(".bamboohr.com/careers")) return "bamboohr";
  if (url.includes("app.careerpuck.com/job-board/")) return "careerpuck";
  if (url.includes("dayforcehcm.com/candidateportal/")) return "dayforcehcm";
  if (url.includes("careers.dayforcehcm.com/")) return "dayforcehcm";
  if (url.includes("web.fountain.com/c/")) return "fountain";
  if (url.includes(".getro.com/jobs")) return "getro";
  if (url.includes("governmentjobs.com/jobs/")) return "governmentjobs";
  if (url.includes("jobs.smartrecruiters.com/")) return "smartrecruiters";
  if (url.includes("policeapp.com/") && /\/\d+\/?$/.test(url)) return "policeapp";
  if (url.includes("usajobs.gov/job/")) return "usajobs";
  if (url.includes("k12jobspot.com/job/detail/")) return "k12jobspot";
  if (url.includes("schoolspring.com/job.cfm?jid=")) return "schoolspring";
  if (url.includes("calcareers.ca.gov/calhrpublic/jobs/jobposting.aspx?jobcontrolid=")) return "calcareers";
  if (url.includes("calopps.org/") && url.includes("/job-")) return "calopps";
  if (url.includes("statejobsny.com/public/vacancydetailsview.cfm?id=")) return "statejobsny";
  if (url.includes(".hrmdirect.com/employment/job-opening.php")) return "hrmdirect";
  if (url.includes(".talentlyft.com/jobs/")) return "talentlyft";
  if (url.includes(".talexio.com/jobs")) return "talexio";
  if (url.includes(".teamtailor.com/jobs/")) return "teamtailor";
  if (url.endsWith(".teamtailor.com/jobs")) return "teamtailor";
  if (url.includes(".freshteam.com/jobs/")) return "freshteam";
  if (url.endsWith(".freshteam.com/jobs")) return "freshteam";
  if (url.includes("talent.sage.hr/jobs/")) return "sagehr";
  if (url.includes("www.talent.sage.hr/jobs/")) return "sagehr";
  if (url.includes("app.loxo.co/job/")) return "loxo";
  if (url.includes(".peopleforce.io/careers/")) return "peopleforce";
  if (url.endsWith(".peopleforce.io/careers")) return "peopleforce";
  if (url.includes(".simplicant.com/jobs/")) return "simplicant";
  if (url.includes(".pinpointhq.com/") && url.includes("/postings/")) return "pinpointhq";
  if (url.includes("recruitcrm.io/jobs/")) return "recruitcrm";
  if (url.includes("ats.rippling.com/") && url.includes("/jobs")) return "rippling";
  if (url.includes(".careerplug.com/jobs/")) return "careerplug";
  if (url.endsWith(".careerplug.com/jobs")) return "careerplug";
  if (url.includes("jobs.gem.com/")) return "gem";
  if (url.includes(".jobapscloud.com")) return "jobaps";
  if (url.includes("join.com/companies/")) return "join";
  if (url.includes("apply.jobappnetwork.com/apply/")) return "talentreef";
  if (url.includes(".jobs.hr.cloud.sap/job/")) return "saphrcloud";
  if (url.includes(".jobs.hr.cloud.sap/search/")) return "saphrcloud";
  if (url.includes("myjobs.adp.com/") && url.includes("/cx/job-details")) return "adp_myjobs";
  if (url.includes("workforcenow.adp.com/mascsr/default/mdf/recruitment/recruitment.html")) return "adp_workforcenow";
  if (url.includes("workforcenow.adp.com/jobs/apply/posting.html")) return "adp_workforcenow";
  if (url.includes("careerspage.io/")) {
    const parts = url.split("careerspage.io/")[1]?.split("/").filter(Boolean) || [];
    if (parts.length >= 2) return "careerspage";
  }
  if (
    url.includes(".oraclecloud.com/hcmui/candidateexperience/") &&
    url.includes("/sites/") &&
    (url.includes("/job/") || url.endsWith("/jobs") || url.includes("/jobs?"))
  ) {
    return "oracle";
  }
  if (url.includes("careers.pageuppeople.com/") && url.includes("/job/")) return "pageup";
  if (url.includes("www.careers.pageuppeople.com/") && url.includes("/job/")) return "pageup";
  if (url.includes("recruiting.paylocity.com/recruiting/jobs/details/")) return "paylocity";
  if (
    url.includes(".eightfold.ai/careers/job/") ||
    url.includes(".eightfold.ai/careers/job?") ||
    url.includes("eightfold.ai/careers/job/") ||
    url.includes("eightfold.ai/careers/job?")
  ) {
    return "eightfold";
  }
  if (url.includes("recruit.hirebridge.com/v3/jobs/jobdetails.aspx")) return "hirebridge";
  if (url.includes("recruit.hirebridge.com/v3/careercenter/v2/details.aspx")) return "hirebridge";
  if (url.includes("sjobs.brassring.com/tgnewui/search/home/homewithpreload")) return "brassring";
  if (url.includes(".applitrack.com/") && (
    url.includes("/onlineapp/default.aspx") ||
    url.includes("/jobpostings/output.asp") ||
    url.includes("/jobpostings/view.asp") ||
    url.includes("/applyforjob.aspx") ||
    url.includes("/default.aspx?jobid=")
  )) {
    return "applitrack";
  }
  if (url.includes(".careers.hibob.com/job/")) return "hibob";
  if (url.includes(".isolvedhire.com/jobs/")) return "isolvisolvedhire";
  if (url.includes(".careers-page.com/jobs/")) return "manatal";
  if (url.includes(".careers-page.com/job/")) return "manatal";
  if (url.includes("www.careers-page.com/") && (url.includes("/job/") || url.includes("/jobs/"))) {
    return "manatal";
  }
  return "";
}

function normalizeAtsFilterValue(value) {
  const normalized = normalizeLikeText(value);
  if (normalized === "ashbyhq") return "ashby";
  if (normalized === "greenhouseio" || normalized === "greenhouse.io") return "greenhouse";
  if (normalized === "leverco" || normalized === "lever.co") return "lever";
  if (normalized === "recruiteecom" || normalized === "recruitee.com") return "recruitee";
  if (normalized === "ukg") return "ultipro";
  if (normalized === "taleonet" || normalized === "taleo.net") return "taleo";
  if (normalized === "jobvitecom" || normalized === "jobvite.com") return "jobvite";
  if (normalized === "applicantprocom" || normalized === "applicantpro.com") return "applicantpro";
  if (normalized === "hibob.com" || normalized === "hibobcom" || normalized === "hibob" || normalized === "careers.hibob.com" || normalized === "careershibobcom") {
    return "hibob";
  }
  if (
    normalized === "isolvisolvedhire" ||
    normalized === "isolvedhire" ||
    normalized === "isolvedhire.com" ||
    normalized === "isolvedhirecom"
  ) {
    return "isolvisolvedhire";
  }
  if (normalized === "applytojobcom" || normalized === "applytojob.com") return "applytojob";
  if (normalized === "icimscom" || normalized === "icims.com") return "icims";
  if (normalized === "theapplicantmanagercom" || normalized === "theapplicantmanager.com") {
    return "theapplicantmanager";
  }
  if (normalized === "breezyhr" || normalized === "breezy.hr" || normalized === "breezyhrcom") {
    return "breezy";
  }
  if (normalized === "zohorecruit" || normalized === "zohorecruit.com" || normalized === "zohorecruitcom") {
    return "zoho";
  }
  if (normalized === "applicantai.com" || normalized === "applicantaicom") {
    return "applicantai";
  }
  if (normalized === "bamboohr.com" || normalized === "bamboohrcom") {
    return "bamboohr";
  }
  if (normalized === "careerplug.com" || normalized === "careerplugcom") {
    return "careerplug";
  }
  if (
    normalized === "manatal.com" ||
    normalized === "manatalcom" ||
    normalized === "careers-page.com" ||
    normalized === "careerspagecom"
  ) {
    return "manatal";
  }
  if (normalized === "careerpuck.com" || normalized === "careerpuckcom") {
    return "careerpuck";
  }
  if (normalized === "dayforcehcm" || normalized === "dayforce" || normalized === "dayforcehcm.com" || normalized === "dayforcehcmcom") {
    return "dayforcehcm";
  }
  if (normalized === "fountain.com" || normalized === "fountaincom") {
    return "fountain";
  }
  if (normalized === "getro.com" || normalized === "getrocom") {
    return "getro";
  }
  if (normalized === "governmentjobs.com" || normalized === "governmentjobscom" || normalized === "governmentjobs") {
    return "governmentjobs";
  }
  if (
    normalized === "smartrecruiters.com" ||
    normalized === "smartrecruiterscom" ||
    normalized === "jobs.smartrecruiters.com" ||
    normalized === "jobssmartrecruiterscom" ||
    normalized === "smartrecruiters"
  ) {
    return "smartrecruiters";
  }
  if (normalized === "policeapp" || normalized === "policeapp.com" || normalized === "policeappcom" || normalized === "www.policeapp.com" || normalized === "wwwpoliceappcom") {
    return "policeapp";
  }
  if (normalized === "usajobs" || normalized === "usajobs.gov" || normalized === "usajobsgov" || normalized === "www.usajobs.gov" || normalized === "wwwusajobsgov") {
    return "usajobs";
  }
  if (normalized === "k12jobspot" || normalized === "k12jobspot.com" || normalized === "k12jobspotcom" || normalized === "www.k12jobspot.com" || normalized === "wwwk12jobspotcom" || normalized === "api.k12jobspot.com" || normalized === "apik12jobspotcom") {
    return "k12jobspot";
  }
  if (normalized === "schoolspring" || normalized === "schoolspring.com" || normalized === "schoolspringcom" || normalized === "api.schoolspring.com" || normalized === "apischoolspringcom" || normalized === "www.schoolspring.com" || normalized === "wwwschoolspringcom") {
    return "schoolspring";
  }
  if (
    normalized === "calcareers" ||
    normalized === "calcareers.ca.gov" ||
    normalized === "calcareerscagov" ||
    normalized === "www.calcareers.ca.gov" ||
    normalized === "wwwcalcareerscagov"
  ) {
    return "calcareers";
  }
  if (
    normalized === "calopps" ||
    normalized === "calopps.org" ||
    normalized === "caloppsorg" ||
    normalized === "www.calopps.org" ||
    normalized === "wwwcaloppsorg"
  ) {
    return "calopps";
  }
  if (
    normalized === "statejobsny" ||
    normalized === "statejobsny.com" ||
    normalized === "statejobsnycom" ||
    normalized === "www.statejobsny.com" ||
    normalized === "wwwstatejobsnycom"
  ) {
    return "statejobsny";
  }
  if (normalized === "hrmdirect.com" || normalized === "hrmdirectcom") {
    return "hrmdirect";
  }
  if (normalized === "talentlyft.com" || normalized === "talentlyftcom") {
    return "talentlyft";
  }
  if (normalized === "talexio.com" || normalized === "talexiocom") {
    return "talexio";
  }
  if (normalized === "teamtailor.com" || normalized === "teamtailorcom") {
    return "teamtailor";
  }
  if (normalized === "freshteam.com" || normalized === "freshteamcom") {
    return "freshteam";
  }
  if (
    normalized === "sagehr" ||
    normalized === "sage.hr" ||
    normalized === "talent.sage.hr" ||
    normalized === "talentsagehr"
  ) {
    return "sagehr";
  }
  if (normalized === "loxo.co" || normalized === "loxoco" || normalized === "app.loxo.co" || normalized === "apploxoco") {
    return "loxo";
  }
  if (normalized === "peopleforce.io" || normalized === "peopleforceio") {
    return "peopleforce";
  }
  if (normalized === "simplicant.com" || normalized === "simplicantcom") {
    return "simplicant";
  }
  if (normalized === "pinpointhq.com" || normalized === "pinpointhqcom") {
    return "pinpointhq";
  }
  if (normalized === "recruitcrm.io" || normalized === "recruitcrmiocom" || normalized === "recruitcrmio") {
    return "recruitcrm";
  }
  if (normalized === "rippling.com" || normalized === "ripplingcom" || normalized === "ats.rippling.com" || normalized === "atsripplingcom" || normalized === "rippling") {
    return "rippling";
  }
  if (normalized === "jobs.gem.com" || normalized === "gem.com" || normalized === "gemcom") {
    return "gem";
  }
  if (normalized === "jobapscloud.com" || normalized === "jobapscloudcom") {
    return "jobaps";
  }
  if (normalized === "join.com" || normalized === "joincom") {
    return "join";
  }
  if (
    normalized === "jobappnetwork.com" ||
    normalized === "jobappnetworkcom" ||
    normalized === "apply.jobappnetwork.com" ||
    normalized === "applyjobappnetworkcom"
  ) {
    return "talentreef";
  }
  if (
    normalized === "saphrcloud" ||
    normalized === "saphrcloud.com" ||
    normalized === "saphrcloudcom" ||
    normalized === "jobs.hr.cloud.sap" ||
    normalized === "jobshrcloudsap"
  ) {
    return "saphrcloud";
  }
  if (normalized === "adp_myjobs" || normalized === "adpmyjobs") {
    return "adp_myjobs";
  }
  if (
    normalized === "adp_workforcenow" ||
    normalized === "adpworkforcenow" ||
    normalized === "workforcenow.adp.com" ||
    normalized === "workforcenowadpcom"
  ) {
    return "adp_workforcenow";
  }
  if (normalized === "careerspage" || normalized === "careerspage.io" || normalized === "careerspageio") {
    return "careerspage";
  }
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
    normalized === "pageup" ||
    normalized === "pageuppeople" ||
    normalized === "pageuppeople.com" ||
    normalized === "pageuppeoplecom" ||
    normalized === "careers.pageuppeople.com" ||
    normalized === "careerspageuppeoplecom"
  ) {
    return "pageup";
  }
  if (
    normalized === "oracle" ||
    normalized === "oraclecloud" ||
    normalized === "oraclecloud.com" ||
    normalized === "oraclecloudcom"
  ) {
    return "oracle";
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
    normalized === "brassring" ||
    normalized === "brassring.com" ||
    normalized === "brassringcom" ||
    normalized === "sjobs.brassring.com" ||
    normalized === "sjobsbrassringcom"
  ) {
    return "brassring";
  }
  if (normalized === "applitrack.com" || normalized === "applitrackcom" || normalized === "applitrack") {
    return "applitrack";
  }
  return normalized;
}

function normalizeAtsFilters(value) {
  const items = normalizeStringArray(Array.isArray(value) ? value : [value])
    .map((item) => normalizeAtsFilterValue(item))
    .filter((item) => ATS_FILTER_OPTIONS.has(item));
  return Array.from(new Set(items));
}

function normalizePostingSort(value) {
  const normalized = normalizeLikeText(value);
  if (normalized === "recent" || normalized === "fresh_source" || normalized === "fresh-source" || normalized === "lastseen") {
    return "last_seen";
  }
  if (normalized === "posted" || normalized === "posted_at" || normalized === "posted-date") {
    return "posted_date";
  }
  if (normalized === "ats" || normalized === "source" || normalized === "company_asc" || normalized === "alphabetical") {
    return "ats_source";
  }
  if (normalized === "quality" || normalized === "quality_score" || normalized === "confidence_score") {
    return "confidence";
  }
  if (POSTING_SORT_OPTIONS.has(normalized)) {
    return normalized;
  }
  return "relevance";
}

function normalizeFreshnessDays(value) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return null;
  const rounded = Math.floor(numberValue);
  return POSTING_FRESHNESS_DAY_OPTIONS.has(rounded) ? rounded : null;
}

function getPostingsOrderByClause(sortBy) {
  if (sortBy === "ats_source") {
    return "COALESCE(last_seen_epoch, 0) DESC, id DESC";
  }
  if (sortBy === "posted_date") {
    return "COALESCE(first_seen_epoch, last_seen_epoch, 0) DESC, COALESCE(last_seen_epoch, 0) DESC, id DESC";
  }
  if (sortBy === "confidence") {
    return "COALESCE(confidence, 0) DESC, COALESCE(quality_score, 0) DESC, COALESCE(last_seen_epoch, 0) DESC, id DESC";
  }
  return "COALESCE(last_seen_epoch, 0) DESC, id DESC";
}

function getPublicPostingSortOptions() {
  return POSTING_SORT_OPTION_ITEMS.map((option) => ({ ...option }));
}

function parsePostingDateEpoch(value) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : 0;
}

function getSqlitePostingRelevanceScore(row, search) {
  const query = normalizeLikeText(search);
  if (!query) return 0;
  const position = normalizeLikeText(row?.position_name);
  const company = normalizeLikeText(row?.company_name);
  const location = normalizeLikeText(row?.location);
  const ats = normalizeLikeText(row?.ats);
  let score = 0;
  if (position.includes(query)) score += 40;
  if (company.includes(query)) score += 30;
  if (location.includes(query)) score += 20;
  if (ats.includes(query)) score += 10;
  return score;
}

function sortSqlitePostingItems(items, sortBy, search) {
  const rows = Array.isArray(items) ? items : [];
  return rows.slice().sort((a, b) => {
    if (sortBy === "relevance") {
      const scoreDelta = getSqlitePostingRelevanceScore(b, search) - getSqlitePostingRelevanceScore(a, search);
      if (scoreDelta !== 0) return scoreDelta;
    }
    if (sortBy === "posted_date") {
      const postedDelta = parsePostingDateEpoch(b?.posting_date) - parsePostingDateEpoch(a?.posting_date);
      if (postedDelta !== 0) return postedDelta;
    } else if (sortBy === "ats_source") {
      const atsDelta = String(a?.ats || "").localeCompare(String(b?.ats || ""));
      if (atsDelta !== 0) return atsDelta;
      const companyDelta = String(a?.company_name || "").localeCompare(String(b?.company_name || ""));
      if (companyDelta !== 0) return companyDelta;
    } else if (sortBy === "confidence") {
      const confidenceDelta = Number(b?.confidence || 0) - Number(a?.confidence || 0);
      if (confidenceDelta !== 0) return confidenceDelta;
      const qualityDelta = Number(b?.quality_score || 0) - Number(a?.quality_score || 0);
      if (qualityDelta !== 0) return qualityDelta;
    }
    const seenDelta = Number(b?.last_seen_epoch || 0) - Number(a?.last_seen_epoch || 0);
    if (seenDelta !== 0) return seenDelta;
    return String(a?.job_posting_url || "").localeCompare(String(b?.job_posting_url || ""));
  });
}

function shuffleArrayInPlace(values) {
  const items = Array.isArray(values) ? values : [];
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item || "").trim())
    .filter(Boolean);
}

function normalizeApplicationStatus(value) {
  const normalized = normalizeLikeText(value);
  if (APPLICATION_STATUS_OPTIONS.has(normalized)) {
    return normalized;
  }
  return "applied";
}

function normalizeAppliedByType(value) {
  const normalized = normalizeLikeText(value);
  if (normalized === "ai" || normalized === "agent") return normalized;
  return "manual";
}

function normalizeAppliedByLabel(value, appliedByType = "manual") {
  const explicit = String(value || "").trim();
  if (explicit) return explicit;
  if (appliedByType === "ai" || appliedByType === "agent") {
    return "AI agent applied on behalf of user";
  }
  return "Manually applied by user";
}

function normalizeIgnoredByLabel(value) {
  const explicit = String(value || "").trim();
  if (explicit) return explicit;
  return "Ignored by user";
}

function normalizeBoolean(value, defaultValue = false) {
  if (typeof value === "boolean") return value;
  const normalized = normalizeLikeText(value);
  if (!normalized) return Boolean(defaultValue);
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function normalizeMcpRemotePreference(value) {
  const normalized = normalizeLikeText(value);
  if (MCP_REMOTE_OPTIONS.has(normalized)) return normalized;
  return "all";
}

function normalizeMcpSettingsInput(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  const agentLoginEmail = String(source.agent_login_email ?? MCP_SETTINGS_DEFAULTS.agent_login_email).trim();

  return {
    enabled: normalizeBoolean(source.enabled, MCP_SETTINGS_DEFAULTS.enabled),
    preferred_agent_name: String(source.preferred_agent_name ?? MCP_SETTINGS_DEFAULTS.preferred_agent_name).trim() ||
      MCP_SETTINGS_DEFAULTS.preferred_agent_name,
    agent_login_email: agentLoginEmail,
    agent_login_password: String(source.agent_login_password ?? MCP_SETTINGS_DEFAULTS.agent_login_password),
    mfa_login_email: agentLoginEmail,
    mfa_login_notes: String(source.mfa_login_notes ?? MCP_SETTINGS_DEFAULTS.mfa_login_notes).trim(),
    dry_run_only: normalizeBoolean(source.dry_run_only, MCP_SETTINGS_DEFAULTS.dry_run_only),
    require_final_approval: normalizeBoolean(
      source.require_final_approval,
      MCP_SETTINGS_DEFAULTS.require_final_approval
    ),
    max_applications_per_run:
      parseNonNegativeInteger(source.max_applications_per_run) || MCP_SETTINGS_DEFAULTS.max_applications_per_run,
    preferred_search: String(source.preferred_search ?? MCP_SETTINGS_DEFAULTS.preferred_search).trim(),
    preferred_remote: normalizeMcpRemotePreference(source.preferred_remote),
    preferred_industries: parseJsonArray(source.preferred_industries),
    preferred_regions: parseRegionFilters(parseJsonArray(source.preferred_regions)),
    preferred_countries: parseCountryFilters(parseJsonArray(source.preferred_countries)).map((filter) => filter.value),
    preferred_states: parseJsonArray(source.preferred_states).map((state) => state.toUpperCase()),
    preferred_counties: parseJsonArray(source.preferred_counties),
    instructions_for_agent: String(source.instructions_for_agent ?? MCP_SETTINGS_DEFAULTS.instructions_for_agent).trim()
  };
}

function ensureMcpAgentEnabled(settings) {
  if (normalizeBoolean(settings?.enabled, false)) return;
  const error = new Error("MCP application agent is disabled in settings.");
  error.statusCode = 403;
  throw error;
}

function createDefaultPersonalInformation() {
  return { ...PERSONAL_INFORMATION_DEFAULTS };
}

function parseNonNegativeInteger(value) {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function parsePositiveInteger(value) {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function normalizeAtsRequestQueueConcurrency(value, fallbackValue = ATS_REQUEST_QUEUE_CONCURRENCY_DEFAULT) {
  const fallback = parsePositiveInteger(fallbackValue) || ATS_REQUEST_QUEUE_CONCURRENCY_DEFAULT;
  const parsed = parsePositiveInteger(value) || fallback;
  return Math.max(MIN_ATS_REQUEST_QUEUE_CONCURRENCY, Math.min(MAX_ATS_REQUEST_QUEUE_CONCURRENCY, parsed));
}

function normalizeSyncEnabledAts(value, fallbackValue = SYNC_DEFAULT_ENABLED_ATS) {
  const activeOnly = (items) => items.filter((item) => isAtsEnabledByDefault(item));
  const fallback = activeOnly(normalizeAtsFilters(Array.isArray(fallbackValue) ? fallbackValue : SYNC_DEFAULT_ENABLED_ATS));
  const requested = normalizeAtsFilters(Array.isArray(value) ? value : parseJsonArray(value));
  const normalized = activeOnly(requested);
  if (normalized.length > 0) return normalized;
  if (requested.length > 0) return [];
  if (fallback.length > 0) return fallback;
  return Array.from(SYNC_DEFAULT_ENABLED_ATS);
}

function normalizeSyncServiceSettingsInput(value = {}, fallback = SYNC_SERVICE_SETTINGS_DEFAULTS) {
  const source = value && typeof value === "object" ? value : {};
  const fallbackConcurrency = normalizeAtsRequestQueueConcurrency(fallback?.ats_request_queue_concurrency);
  const fallbackEnabledAts = normalizeSyncEnabledAts(fallback?.sync_enabled_ats);
  return {
    ats_request_queue_concurrency: normalizeAtsRequestQueueConcurrency(
      source.ats_request_queue_concurrency,
      fallbackConcurrency
    ),
    sync_enabled_ats: normalizeSyncEnabledAts(source.sync_enabled_ats, fallbackEnabledAts)
  };
}

function normalizePersonalInformationInput(value) {
  const source = value && typeof value === "object" ? value : {};
  const normalized = createDefaultPersonalInformation();
  const numericFields = new Set(["age", "years_of_experience"]);
  const textFields = PERSONAL_INFORMATION_FIELDS.filter((field) => !numericFields.has(field));

  for (const field of textFields) {
    normalized[field] = String(source[field] ?? "").trim();
  }

  normalized.age = parseNonNegativeInteger(source.age);
  normalized.years_of_experience = parseNonNegativeInteger(source.years_of_experience);

  return normalized;
}

function parseUrl(urlString) {
  if (!urlString) return null;
  try {
    return new URL(urlString);
  } catch {
    return null;
  }
}

function pickCompanyId(pathParts, subdomain) {
  if (!Array.isArray(pathParts) || pathParts.length === 0) return subdomain;

  const [first = "", second = ""] = pathParts;
  if (first && LOCALE_SEGMENT_REGEX.test(first) && second) {
    return second;
  }

  return first || subdomain;
}

function parseWorkdayCompany(urlString) {
  const parsed = parseUrl(urlString);
  if (!parsed) return null;

  const [subdomain = ""] = parsed.hostname.split(".");
  const pathParts = parsed.pathname
    .split("/")
    .map((part) => String(part || "").trim())
    .filter(Boolean);
  const companyIdRaw = pickCompanyId(pathParts, subdomain);
  const companyIdApi = companyIdRaw.toLowerCase();

  if (!subdomain || !companyIdApi) return null;

  return {
    subdomain: subdomain.toLowerCase(),
    companyIdRaw,
    companyIdApi,
    companyBaseUrl: `${parsed.origin}/${companyIdRaw}`,
    cxsUrl: `${parsed.origin}/wday/cxs/${subdomain.toLowerCase()}/${companyIdApi}/jobs`
  };
}

function isPostedToday(postedOn) {
  if (typeof postedOn !== "string") return false;
  return postedOn.trim().toLowerCase() === "posted today";
}

function parsePostingDateToEpochSeconds(postingDate, referenceEpoch = nowEpochSeconds()) {
  const raw = String(postingDate ?? "").trim();
  if (!raw) return null;

  const normalizedLower = raw.toLowerCase();
  if (normalizedLower === "posted today" || normalizedLower === "today") {
    return Number(referenceEpoch);
  }
  if (normalizedLower === "posted yesterday" || normalizedLower === "yesterday") {
    return Number(referenceEpoch) - 24 * 60 * 60;
  }

  const daysAgoMatch = normalizedLower.match(/^(\d+)\s+day(?:s)?\s+ago$/i);
  if (daysAgoMatch?.[1]) {
    return Number(referenceEpoch) - Number(daysAgoMatch[1]) * 24 * 60 * 60;
  }

  const hoursAgoMatch = normalizedLower.match(/^(\d+)\s+hour(?:s)?\s+ago$/i);
  if (hoursAgoMatch?.[1]) {
    return Number(referenceEpoch) - Number(hoursAgoMatch[1]) * 60 * 60;
  }

  let normalized = raw
    .replace(/^posted\s+/i, "")
    .replace(/\b(\d{1,2})(st|nd|rd|th)\b/gi, "$1")
    .replace(/\s+/g, " ")
    .trim();

  if (/^\d{10,13}$/.test(normalized)) {
    const numericEpoch = Number(normalized.length === 13 ? Math.floor(Number(normalized) / 1000) : normalized);
    if (Number.isFinite(numericEpoch) && numericEpoch > 0) {
      return numericEpoch;
    }
  }

  const parsedMs = Date.parse(normalized);
  if (Number.isFinite(parsedMs)) return Math.floor(parsedMs / 1000);

  normalized = normalized.replace(/,\s*/g, " ").trim();
  const fallbackParsedMs = Date.parse(normalized);
  if (Number.isFinite(fallbackParsedMs)) return Math.floor(fallbackParsedMs / 1000);

  return null;
}

function shouldStorePostingByDate(postingDate, referenceEpoch = nowEpochSeconds()) {
  const raw = String(postingDate ?? "").trim();
  if (!raw) return true;

  const parsedEpoch = parsePostingDateToEpochSeconds(raw, referenceEpoch);
  if (!parsedEpoch) return false;
  return parsedEpoch >= Number(referenceEpoch) - POSTING_TTL_SECONDS;
}

function buildJobUrl(companyBaseUrl, externalPath) {
  if (typeof externalPath !== "string" || !externalPath.trim()) return "";
  if (/^https?:\/\//i.test(externalPath.trim())) return externalPath.trim();
  const normalizedPath = externalPath.startsWith("/") ? externalPath : `/${externalPath}`;
  return `${companyBaseUrl}${normalizedPath}`;
}

function formatLocationSegment(rawLocation) {
  if (typeof rawLocation !== "string") return null;
  const trimmed = rawLocation.trim();
  if (!trimmed) return null;

  const doubleDashToken = "__DOUBLE_DASH__";
  return trimmed
    .replace(/--+/g, doubleDashToken)
    .replace(/-/g, " ")
    .replace(new RegExp(doubleDashToken, "g"), "- ")
    .replace(/\s+/g, " ")
    .trim();
}

function inferWorkdayLocationFromJobUrl(jobPostingUrl) {
  try {
    const parsed = new URL(String(jobPostingUrl || ""));
    const pathParts = parsed.pathname
      .split("/")
      .map((part) => String(part || "").trim())
      .filter(Boolean);
    const jobIndex = pathParts.findIndex((part) => part.toLowerCase() === "job");
    if (jobIndex >= 0 && pathParts[jobIndex + 1] && pathParts[jobIndex + 2]) {
      const rawLocation = decodeURIComponent(pathParts[jobIndex + 1]);
      return formatLocationSegment(rawLocation);
    }
    return null;
  } catch {
    return null;
  }
}

function extractWorkdaySourceJobId(posting, jobPostingUrl) {
  const source = posting && typeof posting === "object" ? posting : {};
  const externalPath = String(source?.externalPath || "").trim();
  const fromExternalPath = externalPath.match(/_([A-Za-z0-9-]+)$/)?.[1] || "";
  if (fromExternalPath && /^(?:jr|req|r)-?[a-z0-9-]+$/i.test(fromExternalPath)) return fromExternalPath;

  const direct = String(
    source?.jobRequisitionId ||
      source?.jobReqId ||
      source?.requisitionId ||
      source?.requisition_id ||
      source?.jobId ||
      source?.jobID ||
      source?.id ||
      ""
  ).trim();
  if (direct) return direct;

  if (fromExternalPath) return fromExternalPath;

  try {
    const parsed = new URL(String(jobPostingUrl || ""));
    const lastPart = decodeURIComponent(parsed.pathname.split("/").filter(Boolean).pop() || "");
    return String(lastPart.match(/_([A-Za-z0-9-]+)$/)?.[1] || "").trim();
  } catch {
    return "";
  }
}

function collectWorkdayLocationValues(posting, jobPostingUrl) {
  const source = posting && typeof posting === "object" ? posting : {};
  const values = [];
  const pushValue = (value) => {
    if (value === null || value === undefined) return;
    if (Array.isArray(value)) {
      for (const item of value) pushValue(item);
      return;
    }
    if (typeof value === "object") {
      pushValue(value.descriptor);
      pushValue(value.location);
      pushValue(value.locationName);
      pushValue(value.displayName);
      pushValue(value.name);
      pushValue(value.text);
      pushValue(value.label);
      pushValue(value.city);
      pushValue([value.city, value.state || value.region || value.province, value.country || value.countryName].filter(Boolean).join(", "));
      return;
    }
    const text = String(value || "").trim();
    if (!text) return;
    const normalized = text.toLowerCase();
    if (values.some((existing) => existing.toLowerCase() === normalized)) return;
    values.push(text);
  };

  pushValue(source.locationsText);
  pushValue(source.locationText);
  pushValue(source.primaryLocation);
  pushValue(source.location);
  pushValue(source.locations);
  pushValue(source.jobLocation);
  pushValue(source.bulletFields);
  pushValue(inferWorkdayLocationFromJobUrl(jobPostingUrl));

  return values.filter(Boolean);
}

function extractWorkdayLocationLabel(posting, jobPostingUrl) {
  const values = collectWorkdayLocationValues(posting, jobPostingUrl);
  return values.length > 0 ? values.join(" / ") : null;
}

function extractWorkdayStructuredLocation(posting) {
  const source = posting && typeof posting === "object" ? posting : {};
  const candidates = [
    source.primaryLocation,
    source.location,
    Array.isArray(source.locations) ? source.locations[0] : source.locations,
    source.jobLocation
  ];
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) continue;
    const city = String(candidate.city || "").trim();
    const state = String(candidate.state || candidate.region || candidate.province || "").trim();
    const country = String(candidate.country || candidate.countryName || "").trim();
    const label = String(candidate.descriptor || candidate.displayName || candidate.locationName || candidate.name || "").trim();
    if (city || state || country || label) {
      return { city, state, country, label };
    }
  }
  return { city: "", state: "", country: "", label: "" };
}

function extractWorkdayRemoteSignal(posting, jobPostingUrl) {
  const source = posting && typeof posting === "object" ? posting : {};
  return [
    source?.remoteType,
    source?.remote_type,
    source?.workplaceType,
    source?.workplace_type,
    source?.locationType,
    source?.timeType,
    source?.isRemote === true ? "remote" : "",
    source?.remote === true ? "remote" : "",
    source?.title,
    source?.locationsText,
    source?.locationText,
    source?.externalPath,
    inferWorkdayLocationFromJobUrl(jobPostingUrl)
  ]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .join(" ");
}

function inferPostingLocationFromJobUrl(jobPostingUrl) {
  const url = String(jobPostingUrl || "").trim();
  if (!url) return null;

  try {
    const parsed = new URL(url);
    if (parsed.hostname.endsWith("myworkdayjobs.com")) {
      return inferWorkdayLocationFromJobUrl(url);
    }
    if (parsed.hostname === "jobs.ashbyhq.com") {
      return postingLocationByJobUrl.get(url) || null;
    }
    if (parsed.hostname === "job-boards.greenhouse.io" || parsed.hostname === "boards.greenhouse.io") {
      return postingLocationByJobUrl.get(url) || null;
    }
    if (parsed.hostname === "jobs.lever.co") {
      return postingLocationByJobUrl.get(url) || null;
    }
    if (parsed.hostname.endsWith(".recruitee.com")) {
      return postingLocationByJobUrl.get(url) || null;
    }
    if (parsed.hostname === "recruiting.ultipro.com") {
      return postingLocationByJobUrl.get(url) || null;
    }
    if (parsed.hostname.endsWith(".taleo.net")) {
      return postingLocationByJobUrl.get(url) || null;
    }
    if (parsed.hostname === "jobs.jobvite.com" || parsed.hostname === "careers.jobvite.com") {
      return postingLocationByJobUrl.get(url) || null;
    }
    if (parsed.hostname.endsWith(".applicantpro.com")) {
      return postingLocationByJobUrl.get(url) || null;
    }
    if (parsed.hostname.endsWith(".applytojob.com")) {
      return postingLocationByJobUrl.get(url) || null;
    }
    if (parsed.hostname.endsWith(".icims.com")) {
      return postingLocationByJobUrl.get(url) || null;
    }
    if (parsed.hostname.endsWith("theapplicantmanager.com")) {
      return postingLocationByJobUrl.get(url) || null;
    }
    if (parsed.hostname.endsWith(".breezy.hr")) {
      return postingLocationByJobUrl.get(url) || null;
    }
    if (parsed.hostname.endsWith(".zohorecruit.com")) {
      return postingLocationByJobUrl.get(url) || null;
    }
    if (parsed.hostname.endsWith(".bamboohr.com")) {
      return postingLocationByJobUrl.get(url) || null;
    }
    if (parsed.hostname === "applicantai.com" || parsed.hostname === "www.applicantai.com") {
      return postingLocationByJobUrl.get(url) || null;
    }
    if (parsed.hostname.endsWith(".careerplug.com")) {
      return postingLocationByJobUrl.get(url) || null;
    }
    if (parsed.hostname === "www.careers-page.com" || parsed.hostname.endsWith(".careers-page.com")) {
      return postingLocationByJobUrl.get(url) || null;
    }
    if (parsed.hostname === "app.careerpuck.com" || parsed.hostname === "www.app.careerpuck.com") {
      return postingLocationByJobUrl.get(url) || null;
    }
    if (parsed.hostname === "careers.dayforcehcm.com" || parsed.hostname.endsWith(".dayforcehcm.com")) {
      return postingLocationByJobUrl.get(url) || null;
    }
    if (parsed.hostname === "web.fountain.com" || parsed.hostname === "www.web.fountain.com") {
      return postingLocationByJobUrl.get(url) || null;
    }
    if (parsed.hostname.endsWith(".getro.com")) {
      return postingLocationByJobUrl.get(url) || null;
    }
    if (parsed.hostname === "www.governmentjobs.com" || parsed.hostname === "governmentjobs.com") {
      return postingLocationByJobUrl.get(url) || null;
    }
    if (parsed.hostname === "jobs.smartrecruiters.com" || parsed.hostname === "www.jobs.smartrecruiters.com") {
      return postingLocationByJobUrl.get(url) || null;
    }
    if (parsed.hostname === "www.policeapp.com" || parsed.hostname === "policeapp.com") {
      return postingLocationByJobUrl.get(url) || null;
    }
    if (parsed.hostname === "www.usajobs.gov" || parsed.hostname === "usajobs.gov") {
      return postingLocationByJobUrl.get(url) || null;
    }
    if (parsed.hostname === "www.k12jobspot.com" || parsed.hostname === "k12jobspot.com") {
      return postingLocationByJobUrl.get(url) || null;
    }
    if (parsed.hostname === "www.schoolspring.com" || parsed.hostname === "schoolspring.com") {
      return postingLocationByJobUrl.get(url) || null;
    }
    if (parsed.hostname === "calcareers.ca.gov" || parsed.hostname === "www.calcareers.ca.gov") {
      return postingLocationByJobUrl.get(url) || null;
    }
    if (parsed.hostname === "calopps.org" || parsed.hostname === "www.calopps.org") {
      return postingLocationByJobUrl.get(url) || null;
    }
    if (parsed.hostname === "statejobsny.com" || parsed.hostname === "www.statejobsny.com") {
      return postingLocationByJobUrl.get(url) || null;
    }
    if (parsed.hostname.endsWith(".hrmdirect.com")) {
      return postingLocationByJobUrl.get(url) || null;
    }
    if (parsed.hostname.endsWith(".talentlyft.com")) {
      return postingLocationByJobUrl.get(url) || null;
    }
    if (parsed.hostname.endsWith(".talexio.com")) {
      return postingLocationByJobUrl.get(url) || null;
    }
    if (parsed.hostname.endsWith(".teamtailor.com")) {
      return postingLocationByJobUrl.get(url) || null;
    }
    if (parsed.hostname.endsWith(".freshteam.com")) {
      return postingLocationByJobUrl.get(url) || null;
    }
    if (parsed.hostname === "talent.sage.hr" || parsed.hostname === "www.talent.sage.hr") {
      return postingLocationByJobUrl.get(url) || null;
    }
    if (parsed.hostname === "app.loxo.co" || parsed.hostname === "www.app.loxo.co") {
      return postingLocationByJobUrl.get(url) || null;
    }
    if (parsed.hostname === "jobs.gem.com" || parsed.hostname === "www.jobs.gem.com") {
      return postingLocationByJobUrl.get(url) || null;
    }
    if (parsed.hostname.endsWith(".jobapscloud.com")) {
      return postingLocationByJobUrl.get(url) || null;
    }
    if (parsed.hostname === "join.com" || parsed.hostname === "www.join.com") {
      return postingLocationByJobUrl.get(url) || null;
    }
    if (parsed.hostname === "apply.jobappnetwork.com" || parsed.hostname === "www.apply.jobappnetwork.com") {
      return postingLocationByJobUrl.get(url) || null;
    }
    if (parsed.hostname.endsWith(".jobs.hr.cloud.sap")) {
      return postingLocationByJobUrl.get(url) || null;
    }
    if (parsed.hostname === "myjobs.adp.com" || parsed.hostname === "www.myjobs.adp.com") {
      return postingLocationByJobUrl.get(url) || null;
    }
    if (parsed.hostname === "workforcenow.adp.com" || parsed.hostname === "www.workforcenow.adp.com") {
      return postingLocationByJobUrl.get(url) || null;
    }
    if (parsed.hostname === "careerspage.io" || parsed.hostname === "www.careerspage.io") {
      return postingLocationByJobUrl.get(url) || null;
    }
    if (parsed.hostname === "recruiting.paylocity.com" || parsed.hostname === "www.recruiting.paylocity.com") {
      return postingLocationByJobUrl.get(url) || null;
    }
    if (
      parsed.hostname === "eightfold.ai" ||
      parsed.hostname === "www.eightfold.ai" ||
      parsed.hostname.endsWith(".eightfold.ai")
    ) {
      return postingLocationByJobUrl.get(url) || null;
    }
    if (parsed.hostname === "careers.pageuppeople.com" || parsed.hostname === "www.careers.pageuppeople.com") {
      return postingLocationByJobUrl.get(url) || null;
    }
    if (parsed.hostname.endsWith(".oraclecloud.com") && parsed.pathname.toLowerCase().includes("/hcmui/candidateexperience/")) {
      return postingLocationByJobUrl.get(url) || null;
    }
    if (parsed.hostname === "recruit.hirebridge.com" || parsed.hostname === "www.recruit.hirebridge.com") {
      return postingLocationByJobUrl.get(url) || null;
    }
    if (parsed.hostname === "sjobs.brassring.com" || parsed.hostname === "www.sjobs.brassring.com") {
      return postingLocationByJobUrl.get(url) || null;
    }
    if (parsed.hostname.endsWith(".applitrack.com")) {
      return postingLocationByJobUrl.get(url) || null;
    }
    return null;
  } catch {
    return null;
  }
}

function pushUniqueText(values, value) {
  const text = String(value || "").trim();
  if (!text) return;
  if (values.some((existing) => existing.toLowerCase() === text.toLowerCase())) return;
  values.push(text);
}

function buildAddressLocationLabel(address) {
  const postalAddress = address?.postalAddress && typeof address.postalAddress === "object"
    ? address.postalAddress
    : address && typeof address === "object"
      ? address
      : {};
  const city = String(postalAddress?.addressLocality || postalAddress?.city || "").trim();
  const state = String(postalAddress?.addressRegion || postalAddress?.state || postalAddress?.region || "").trim();
  const country = String(postalAddress?.addressCountry || postalAddress?.country || "").trim();
  const parts = [city, state, country].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : "";
}

function extractAshbyLocationName(posting) {
  const names = [];
  pushUniqueText(names, posting?.locationName);
  pushUniqueText(names, posting?.location);
  pushUniqueText(names, buildAddressLocationLabel(posting?.address));

  const secondary = Array.isArray(posting?.secondaryLocations) ? posting.secondaryLocations : [];
  for (const location of secondary) {
    pushUniqueText(names, location?.locationName);
    pushUniqueText(names, location?.location);
    pushUniqueText(names, buildAddressLocationLabel(location?.address));
  }

  return names.length > 0 ? names.join(" / ") : null;
}

function extractAshbyPrimaryLocationParts(posting) {
  const address = posting?.address && typeof posting.address === "object" ? posting.address : {};
  const rawLocation = String(posting?.locationName || posting?.location || "").trim();
  const city = String(address?.addressLocality || address?.city || "").trim();
  const state = String(address?.addressRegion || address?.state || address?.region || "").trim();
  const country = String(address?.addressCountry || address?.country || "").trim();
  return {
    city: isRemoteOnlyLocationValue(city) ? "" : city,
    state,
    country: normalizeCountryName(country) || normalizeCountryFromLocation(rawLocation)
  };
}

function parseAshbyCompany(urlString) {
  const parsed = parseUrl(urlString);
  if (!parsed) return null;
  const [organizationHostedJobsPageName = ""] = parsed.pathname
    .split("/")
    .map((part) => String(part || "").trim())
    .filter(Boolean);
  if (!organizationHostedJobsPageName) return null;

  return {
    organizationHostedJobsPageName,
    organizationHostedJobsPageNameLower: organizationHostedJobsPageName.toLowerCase()
  };
}

function parseGreenhouseCompany(urlString) {
  const parsed = parseUrl(urlString);
  if (!parsed) return null;
  const [boardToken = ""] = parsed.pathname
    .split("/")
    .map((part) => String(part || "").trim())
    .filter(Boolean);
  if (!boardToken) return null;

  return {
    boardToken,
    boardTokenLower: boardToken.toLowerCase()
  };
}

function parseLeverCompany(urlString) {
  const parsed = parseUrl(urlString);
  if (!parsed) return null;
  const [organization = ""] = parsed.pathname
    .split("/")
    .map((part) => String(part || "").trim())
    .filter(Boolean);
  if (!organization) return null;

  return {
    organization,
    organizationLower: organization.toLowerCase()
  };
}

function parseJobviteCompany(urlString) {
  const parsed = parseUrl(urlString);
  if (!parsed) return null;

  const host = String(parsed.hostname || "").toLowerCase();
  if (host !== "jobs.jobvite.com" && host !== "careers.jobvite.com") return null;

  const pathParts = parsed.pathname
    .split("/")
    .map((part) => String(part || "").trim())
    .filter(Boolean);
  if (pathParts.length === 0) return null;

  const companySlug = String(pathParts[0] || "").trim();
  if (!companySlug) return null;

  return {
    host,
    companySlug,
    companySlugLower: companySlug.toLowerCase(),
    baseOrigin: `${parsed.protocol}//${parsed.host}`,
    jobsUrl: `${parsed.protocol}//${parsed.host}/${companySlug}/jobs`
  };
}

function parseCareerplugCompany(urlString) {
  const parsed = parseUrl(urlString);
  if (!parsed) return null;

  const host = String(parsed.hostname || "").toLowerCase();
  if (!host.endsWith(".careerplug.com")) return null;

  const [subdomain = ""] = host.split(".");
  if (!subdomain) return null;

  return {
    host,
    subdomain,
    subdomainLower: subdomain.toLowerCase(),
    baseOrigin: `${parsed.protocol}//${parsed.host}`,
    jobsUrl: `${parsed.protocol}//${parsed.host}/jobs`
  };
}

function parseBambooHrCompany(urlString) {
  const parsed = parseUrl(urlString);
  if (!parsed) return null;

  const host = String(parsed.hostname || "").toLowerCase();
  const suffix = ".bamboohr.com";
  if (!host.endsWith(suffix)) return null;

  const companySubdomain = String(host.slice(0, -suffix.length) || "").trim();
  if (!companySubdomain || companySubdomain.includes(".") || companySubdomain === "www") return null;

  const pathParts = parsed.pathname
    .split("/")
    .map((part) => String(part || "").trim())
    .filter(Boolean);
  if (pathParts.length > 0 && String(pathParts[0] || "").toLowerCase() !== "careers") return null;

  const baseOrigin = `${parsed.protocol}//${parsed.host}`;
  return {
    host,
    companySubdomain,
    companySubdomainLower: companySubdomain.toLowerCase(),
    baseOrigin,
    boardUrl: `${baseOrigin}/careers`,
    apiUrl: `${baseOrigin}/careers/list`
  };
}

function parseAdpMyjobsCompany(urlString) {
  const parsed = parseUrl(urlString);
  if (!parsed) return null;

  const host = String(parsed.hostname || "").toLowerCase();
  if (host !== "myjobs.adp.com" && host !== "www.myjobs.adp.com") return null;

  const pathParts = parsed.pathname
    .split("/")
    .map((part) => String(part || "").trim())
    .filter(Boolean);
  if (pathParts.length === 0) return null;

  const companyName = String(pathParts[0] || "").trim();
  if (!companyName) return null;

  return {
    host,
    companyName,
    companyNameLower: companyName.toLowerCase(),
    boardUrl: `https://myjobs.adp.com/${companyName}/cx/job-listing`,
    careerSiteUrl: `https://myjobs.adp.com/public/staffing/v1/career-site/${encodeURIComponent(companyName)}`
  };
}

function parseAdpWorkforcenowCompany(urlString) {
  const parsed = parseUrl(urlString);
  if (!parsed) return null;

  const host = String(parsed.hostname || "").toLowerCase();
  if (host !== "workforcenow.adp.com" && host !== "www.workforcenow.adp.com") return null;

  const cid = String(parsed.searchParams?.get("cid") || "").trim();
  const ccId = String(parsed.searchParams?.get("ccId") || "").trim();
  if (!cid || !ccId) return null;

  const baseOrigin = "https://workforcenow.adp.com";
  const boardUrl =
    `${baseOrigin}/mascsr/default/mdf/recruitment/recruitment.html?` +
    `cid=${encodeURIComponent(cid)}&ccId=${encodeURIComponent(ccId)}`;
  const apiBase = `${baseOrigin}/mascsr/default/careercenter/public/events/staffing/v1`;

  return {
    host,
    cid,
    ccId,
    boardUrl,
    jobRequisitionsUrl: `${apiBase}/job-requisitions?cid=${encodeURIComponent(cid)}&ccId=${encodeURIComponent(ccId)}`,
    contentLinksBaseUrl: `${apiBase}/content-links/career-center`
  };
}

function parseCareerspageCompany(urlString) {
  const parsed = parseUrl(urlString);
  if (!parsed) return null;

  const host = String(parsed.hostname || "").toLowerCase();
  if (host !== "careerspage.io" && host !== "www.careerspage.io") return null;

  const pathParts = parsed.pathname
    .split("/")
    .map((part) => String(part || "").trim())
    .filter(Boolean);
  if (pathParts.length === 0) return null;

  const companySlug = String(pathParts[0] || "").trim();
  if (!companySlug) return null;

  return {
    host,
    companySlug,
    companySlugLower: companySlug.toLowerCase(),
    boardUrl: `https://careerspage.io/${companySlug}`
  };
}

function parseOracleCompany(urlString) {
  const parsed = parseUrl(urlString);
  if (!parsed) return null;

  const host = String(parsed.hostname || "").toLowerCase();
  if (!host.endsWith(".oraclecloud.com")) return null;

  const pathParts = String(parsed.pathname || "")
    .split("/")
    .map((part) => String(part || "").trim())
    .filter(Boolean);
  const loweredPathParts = pathParts.map((part) => part.toLowerCase());

  const candidateExperienceIndex = loweredPathParts.indexOf("candidateexperience");
  if (candidateExperienceIndex < 0) return null;

  let language = "en";
  if (candidateExperienceIndex + 1 < pathParts.length) {
    const maybeLanguage = String(pathParts[candidateExperienceIndex + 1] || "").trim();
    if (maybeLanguage && maybeLanguage.toLowerCase() !== "sites") {
      language = maybeLanguage;
    }
  }

  let siteNumber = "";
  const sitesIndex = loweredPathParts.indexOf("sites", candidateExperienceIndex + 1);
  if (sitesIndex >= 0 && sitesIndex + 1 < pathParts.length) {
    siteNumber = String(pathParts[sitesIndex + 1] || "").trim();
  }
  if (!siteNumber) {
    siteNumber = String(parsed.searchParams?.get("siteNumber") || "").trim();
  }
  if (!siteNumber) {
    siteNumber = "CX";
  }

  const safeLanguage = language.replace(/[^A-Za-z0-9_-]/g, "") || "en";
  const safeSiteNumber = siteNumber.replace(/[^A-Za-z0-9_-]/g, "") || "CX";
  const siteBaseUrl = `${parsed.protocol}//${parsed.host}`;
  const boardUrl = `${siteBaseUrl}/hcmUI/CandidateExperience/${safeLanguage}/sites/${safeSiteNumber}/jobs`;
  const apiUrl = `${siteBaseUrl}/hcmRestApi/resources/latest/recruitingCEJobRequisitions`;
  const finder =
    `findReqs;siteNumber=${safeSiteNumber},` +
    `facetsList=${ORACLE_FACETS_VALUE},` +
    "limit=25,sortBy=POSTING_DATES_DESC";

  return {
    host,
    siteBaseUrl,
    boardUrl,
    apiUrl,
    siteNumber: safeSiteNumber,
    language: safeLanguage,
    finder
  };
}

function parsePaylocityCompany(urlString) {
  const parsed = parseUrl(urlString);
  if (!parsed) return null;

  const host = String(parsed.hostname || "").toLowerCase();
  if (host !== "recruiting.paylocity.com" && host !== "www.recruiting.paylocity.com") return null;

  const pathParts = String(parsed.pathname || "")
    .split("/")
    .map((part) => String(part || "").trim())
    .filter(Boolean);

  if (pathParts.length < 5) return null;
  if (pathParts[0].toLowerCase() !== "recruiting" || pathParts[1].toLowerCase() !== "jobs") return null;

  const listingSegment = String(pathParts[2] || "All")
    .trim()
    .replace(/[^A-Za-z0-9_-]/g, "") || "All";
  const companyId = String(pathParts[3] || "")
    .trim()
    .replace(/[^A-Za-z0-9-]/g, "");
  const companySlug = String(pathParts[4] || "")
    .trim()
    .replace(/[^A-Za-z0-9-_.]/g, "");
  if (!companyId || !companySlug) return null;

  const siteBaseUrl = `${parsed.protocol}//${parsed.host}`;
  return {
    host,
    siteBaseUrl,
    companyId,
    companySlug,
    boardUrl:
      `${siteBaseUrl}/recruiting/jobs/${encodeURIComponent(listingSegment)}` +
      `/${encodeURIComponent(companyId)}/${encodeURIComponent(companySlug)}`
  };
}

function parseEightfoldCompany(urlString) {
  const parsed = parseUrl(urlString);
  if (!parsed) return null;

  const host = String(parsed.hostname || "").toLowerCase();
  if (!(host.endsWith(".eightfold.ai") || host === "eightfold.ai" || host === "www.eightfold.ai")) return null;

  const pathParts = String(parsed.pathname || "")
    .split("/")
    .map((part) => String(part || "").trim())
    .filter(Boolean);
  if (pathParts.length === 0 || pathParts[0].toLowerCase() !== "careers") return null;

  const siteBaseUrl = `${parsed.protocol}//${parsed.host}`;
  return {
    host,
    siteBaseUrl,
    boardUrl: `${siteBaseUrl}/careers`
  };
}

function parsePageupCompany(urlString) {
  const parsed = parseUrl(urlString);
  if (!parsed) return null;

  const host = String(parsed.hostname || "").toLowerCase();
  if (host !== "careers.pageuppeople.com" && host !== "www.careers.pageuppeople.com") return null;

  const pathParts = String(parsed.pathname || "")
    .split("/")
    .map((part) => String(part || "").trim())
    .filter(Boolean);
  if (pathParts.length === 0) return null;

  const boardId = String(pathParts[0] || "")
    .trim()
    .replace(/[^A-Za-z0-9_-]/g, "");
  if (!boardId) return null;

  let routeType = "cw";
  let locale = "en-us";
  if (pathParts.length >= 3) {
    const maybeRouteType = String(pathParts[1] || "").trim().toLowerCase();
    const maybeLocale = String(pathParts[2] || "").trim().toLowerCase();
    if (maybeRouteType === "cw" || maybeRouteType === "ci") {
      routeType = maybeRouteType;
    }
    if (/^[a-z]{2}(?:-[a-z]{2})$/i.test(maybeLocale)) {
      locale = maybeLocale;
    }
  }

  const encodedBoardId = encodeURIComponent(boardId);
  const baseOrigin = `${parsed.protocol}//${parsed.host}`;
  return {
    host,
    boardId,
    routeType,
    locale,
    baseOrigin,
    boardUrl: `${baseOrigin}/${encodedBoardId}`,
    searchUrl: `${baseOrigin}/${encodedBoardId}/${routeType}/${locale}/search/`
  };
}

function extractPageupRouteConfigFromUrl(urlString, fallbackRouteType = "cw", fallbackLocale = "en-us") {
  const parsed = parseUrl(urlString);
  const pathParts = String(parsed?.pathname || "")
    .split("/")
    .map((part) => String(part || "").trim())
    .filter(Boolean);

  let routeType = String(fallbackRouteType || "cw").trim().toLowerCase() || "cw";
  let locale = String(fallbackLocale || "en-us").trim().toLowerCase() || "en-us";

  if (pathParts.length >= 3) {
    const maybeRouteType = String(pathParts[1] || "").trim().toLowerCase();
    const maybeLocale = String(pathParts[2] || "").trim().toLowerCase();
    if (maybeRouteType === "cw" || maybeRouteType === "ci") {
      routeType = maybeRouteType;
    }
    if (/^[a-z]{2}(?:-[a-z]{2})$/i.test(maybeLocale)) {
      locale = maybeLocale;
    }
  }

  return {
    routeType,
    locale
  };
}

function parseHirebridgeCompany(urlString) {
  const parsed = parseUrl(urlString);
  if (!parsed) return null;

  const host = String(parsed.hostname || "").toLowerCase();
  if (host !== "recruit.hirebridge.com" && host !== "www.recruit.hirebridge.com") return null;

  const cid = String(parsed.searchParams?.get("cid") || "").trim();
  if (!cid) return null;

  return {
    host,
    cid,
    boardUrl: `https://recruit.hirebridge.com/v3/jobs/list.aspx?cid=${encodeURIComponent(cid)}`,
    detailsBaseUrl: "https://recruit.hirebridge.com/v3/CareerCenter/v2/details.aspx"
  };
}

function parseBrassringCompany(urlString) {
  const parsed = parseUrl(urlString);
  if (!parsed) return null;

  const host = String(parsed.hostname || "").toLowerCase();
  if (host !== "sjobs.brassring.com" && host !== "www.sjobs.brassring.com") return null;

  const partnerId = String(parsed.searchParams?.get("partnerid") || "").trim();
  const siteId = String(parsed.searchParams?.get("siteid") || "").trim();
  if (!partnerId || !siteId) return null;

  const boardUrl =
    `https://sjobs.brassring.com/TGnewUI/Search/Home/Home?partnerid=${encodeURIComponent(partnerId)}` +
    `&siteid=${encodeURIComponent(siteId)}`;
  return {
    host,
    partnerId,
    siteId,
    boardUrl,
    apiUrl: "https://sjobs.brassring.com/TgNewUI/Search/Ajax/MatchedJobs"
  };
}

function parseCareerpuckCompany(urlString) {
  const parsed = parseUrl(urlString);
  if (!parsed) return null;

  const host = String(parsed.hostname || "").toLowerCase();
  if (host !== "app.careerpuck.com" && host !== "www.app.careerpuck.com") return null;

  const pathParts = parsed.pathname
    .split("/")
    .map((part) => String(part || "").trim())
    .filter(Boolean);
  if (pathParts.length < 2 || pathParts[0].toLowerCase() !== "job-board") return null;

  const boardSlug = String(pathParts[1] || "").trim();
  if (!boardSlug) return null;

  return {
    host,
    boardSlug,
    boardSlugLower: boardSlug.toLowerCase(),
    boardUrl: `${parsed.protocol}//${parsed.host}/job-board/${boardSlug}`,
    apiUrl: `https://api.careerpuck.com/v1/public/job-boards/${encodeURIComponent(boardSlug)}`
  };
}

function parseFountainCompany(urlString) {
  const parsed = parseUrl(urlString);
  if (!parsed) return null;

  const host = String(parsed.hostname || "").toLowerCase();
  if (host !== "web.fountain.com" && host !== "www.web.fountain.com") return null;

  const pathParts = parsed.pathname
    .split("/")
    .map((part) => String(part || "").trim())
    .filter(Boolean);
  if (pathParts.length < 4 || pathParts[0].toLowerCase() !== "c") return null;

  const companyPath = pathParts.slice(0, 4);
  const companySlug = String(pathParts[1] || "").trim();
  if (!companySlug) return null;

  const boardPath = companyPath.join("/");
  const boardUrl = `${parsed.protocol}//${parsed.host}/${boardPath}`;

  return {
    host,
    companySlug,
    companySlugLower: companySlug.toLowerCase(),
    boardUrl,
    apiUrl: `${boardUrl}.json`
  };
}

function parseGetroCompany(urlString) {
  const parsed = parseUrl(urlString);
  if (!parsed) return null;

  const host = String(parsed.hostname || "").toLowerCase();
  if (host === "www.getro.com") return null;
  if (!host.endsWith(".getro.com")) return null;

  const [subdomain = ""] = host.split(".");
  if (!subdomain) return null;

  return {
    host,
    subdomain,
    subdomainLower: subdomain.toLowerCase(),
    jobsUrl: `${parsed.protocol}//${parsed.host}/jobs`
  };
}

function parseHrmDirectCompany(urlString) {
  const parsed = parseUrl(urlString);
  if (!parsed) return null;

  const host = String(parsed.hostname || "").toLowerCase();
  if (!host.endsWith(".hrmdirect.com")) return null;

  const [subdomain = ""] = host.split(".");
  if (!subdomain) return null;

  const jobsUrl = new URL(parsed.toString());
  if (!/\/employment\/job-openings\.php$/i.test(String(jobsUrl.pathname || ""))) {
    jobsUrl.pathname = "/employment/job-openings.php";
  }
  if (!jobsUrl.searchParams.has("search")) {
    jobsUrl.searchParams.set("search", "true");
  }
  jobsUrl.hash = "";

  return {
    host,
    subdomain,
    subdomainLower: subdomain.toLowerCase(),
    baseOrigin: `${parsed.protocol}//${parsed.host}`,
    jobsUrl: jobsUrl.toString()
  };
}

function parseTalentlyftCompany(urlString) {
  const parsed = parseUrl(urlString);
  if (!parsed) return null;

  const host = String(parsed.hostname || "").toLowerCase();
  if (!host.endsWith(".talentlyft.com")) return null;

  const [subdomain = ""] = host.split(".");
  if (!subdomain) return null;

  return {
    host,
    subdomain,
    subdomainLower: subdomain.toLowerCase(),
    baseOrigin: `${parsed.protocol}//${parsed.host}`,
    careersUrl: `${parsed.protocol}//${parsed.host}/`
  };
}

function parseTalexioCompany(urlString) {
  const parsed = parseUrl(urlString);
  if (!parsed) return null;

  const host = String(parsed.hostname || "").toLowerCase();
  if (!host.endsWith(".talexio.com")) return null;

  const [subdomain = ""] = host.split(".");
  if (!subdomain) return null;

  const pathParts = parsed.pathname
    .split("/")
    .map((part) => String(part || "").trim())
    .filter(Boolean);
  if (pathParts.length > 0 && String(pathParts[0] || "").toLowerCase() !== "jobs") return null;

  const baseOrigin = `${parsed.protocol}//${parsed.host}`;
  return {
    host,
    subdomain,
    subdomainLower: subdomain.toLowerCase(),
    baseOrigin,
    jobsUrl: `${baseOrigin}/jobs/`,
    apiUrl: `${baseOrigin}/api/jobs`
  };
}

function parseSapHrCloudCompany(urlString) {
  const parsed = parseUrl(urlString);
  if (!parsed) return null;

  const host = String(parsed.hostname || "").toLowerCase();
  const suffix = ".jobs.hr.cloud.sap";
  if (!host.endsWith(suffix)) return null;

  const companyName = String(host.slice(0, -suffix.length) || "").trim();
  if (!companyName) return null;

  const localeFromUrl = String(parsed.searchParams.get("locale") || "").trim();
  const baseOrigin = `${parsed.protocol}//${parsed.host}`;
  return {
    host,
    companyName,
    companyNameLower: companyName.toLowerCase(),
    baseOrigin,
    boardUrl: `${baseOrigin}/search/?createNewAlert=false&q=`,
    apiUrl: `${baseOrigin}/services/recruiting/v1/jobs`,
    localeFromUrl: localeFromUrl || ""
  };
}

function parseTeamtailorCompany(urlString) {
  const parsed = parseUrl(urlString);
  if (!parsed) return null;

  const host = String(parsed.hostname || "").toLowerCase();
  if (!host.endsWith(".teamtailor.com")) return null;

  const [subdomain = ""] = host.split(".");
  if (!subdomain) return null;

  const baseOrigin = `${parsed.protocol}//${parsed.host}`;
  return {
    host,
    subdomain,
    subdomainLower: subdomain.toLowerCase(),
    baseOrigin,
    jobsUrl: `${baseOrigin}/jobs`
  };
}

function parseFreshteamCompany(urlString) {
  const parsed = parseUrl(urlString);
  if (!parsed) return null;

  const host = String(parsed.hostname || "").toLowerCase();
  if (!host.endsWith(".freshteam.com")) return null;
  if (host === "freshteam.com" || host === "www.freshteam.com" || host === "assets.freshteam.com") return null;

  const [subdomain = ""] = host.split(".");
  if (!subdomain) return null;

  const pathParts = parsed.pathname
    .split("/")
    .map((part) => String(part || "").trim())
    .filter(Boolean);
  if (pathParts.length > 0 && String(pathParts[0] || "").toLowerCase() !== "jobs") return null;

  const baseOrigin = `${parsed.protocol}//${parsed.host}`;
  return {
    host,
    subdomain,
    subdomainLower: subdomain.toLowerCase(),
    baseOrigin,
    jobsUrl: `${baseOrigin}/jobs`
  };
}

function parseSagehrCompany(urlString) {
  const parsed = parseUrl(urlString);
  if (!parsed) return null;

  const host = String(parsed.hostname || "").toLowerCase();
  if (host !== "talent.sage.hr" && host !== "www.talent.sage.hr") return null;

  const pathParts = String(parsed.pathname || "")
    .split("/")
    .map((part) => String(part || "").trim())
    .filter(Boolean);
  if (pathParts.length === 0) return null;

  const companySlug = String(pathParts[0] || "").trim();
  if (!companySlug) return null;
  if (companySlug.toLowerCase() === "embed" || companySlug.toLowerCase() === "jobs") return null;

  const baseOrigin = `${parsed.protocol}//${parsed.host}`;
  return {
    host,
    companySlug,
    companySlugLower: companySlug.toLowerCase(),
    baseOrigin,
    boardUrl: `${baseOrigin}/${encodeURIComponent(companySlug)}/vacancies`
  };
}

function parsePeopleforceCompany(urlString) {
  const parsed = parseUrl(urlString);
  if (!parsed) return null;

  const host = String(parsed.hostname || "").toLowerCase();
  if (!host.endsWith(".peopleforce.io")) return null;
  if (host === "peopleforce.io" || host === "www.peopleforce.io") return null;

  const [subdomain = ""] = host.split(".");
  if (!subdomain) return null;

  const pathParts = parsed.pathname
    .split("/")
    .map((part) => String(part || "").trim())
    .filter(Boolean);
  if (pathParts.length > 0 && String(pathParts[0] || "").toLowerCase() !== "careers") return null;

  const baseOrigin = `${parsed.protocol}//${parsed.host}`;
  return {
    host,
    subdomain,
    subdomainLower: subdomain.toLowerCase(),
    baseOrigin,
    jobsUrl: `${baseOrigin}/careers`
  };
}

function parseSimplicantCompany(urlString) {
  const parsed = parseUrl(urlString);
  if (!parsed) return null;

  const host = String(parsed.hostname || "").toLowerCase();
  if (!host.endsWith(".simplicant.com")) return null;
  if (
    host === "simplicant.com" ||
    host === "www.simplicant.com" ||
    host === "assets.simplicant.com" ||
    host === "app.simplicant.com" ||
    host === "jobs.simplicant.com"
  ) {
    return null;
  }

  const [subdomain = ""] = host.split(".");
  if (!subdomain) return null;

  const pathParts = parsed.pathname
    .split("/")
    .map((part) => String(part || "").trim())
    .filter(Boolean);
  if (pathParts.length > 0 && !["jobs", "leads"].includes(String(pathParts[0] || "").toLowerCase())) return null;

  const baseOrigin = `${parsed.protocol}//${parsed.host}`;
  return {
    host,
    subdomain,
    subdomainLower: subdomain.toLowerCase(),
    baseOrigin,
    jobsUrl: `${baseOrigin}/`
  };
}

function parseLoxoCompany(urlString) {
  const parsed = parseUrl(urlString);
  if (!parsed) return null;

  const host = String(parsed.hostname || "").toLowerCase();
  if (host !== "app.loxo.co" && host !== "www.app.loxo.co") return null;

  const pathParts = parsed.pathname
    .split("/")
    .map((part) => String(part || "").trim())
    .filter(Boolean);
  if (pathParts.length === 0) return null;
  if (String(pathParts[0] || "").toLowerCase() === "job") return null;

  const companySlug = String(pathParts[0] || "").trim();
  if (!companySlug) return null;

  const boardUrl = new URL(`${parsed.protocol}//${parsed.host}/${companySlug}`);
  boardUrl.search = "";
  boardUrl.hash = "";

  return {
    host,
    companySlug,
    companySlugLower: companySlug.toLowerCase(),
    baseOrigin: `${parsed.protocol}//${parsed.host}`,
    boardUrl: boardUrl.toString()
  };
}

function parsePinpointHqCompany(urlString) {
  const parsed = parseUrl(urlString);
  if (!parsed) return null;

  const host = String(parsed.hostname || "").toLowerCase();
  if (!host.endsWith(".pinpointhq.com")) return null;
  if (host === "pinpointhq.com" || host === "www.pinpointhq.com") return null;

  const [subdomain = ""] = host.split(".");
  if (!subdomain) return null;

  const baseOrigin = `${parsed.protocol}//${parsed.host}`;
  return {
    host,
    subdomain,
    subdomainLower: subdomain.toLowerCase(),
    baseOrigin,
    boardUrl: `${baseOrigin}/`,
    apiUrl: `${baseOrigin}/postings.json`
  };
}

function parseRecruitCrmCompany(urlString) {
  const parsed = parseUrl(urlString);
  if (!parsed) return null;

  const host = String(parsed.hostname || "").toLowerCase();
  if (host !== "recruitcrm.io" && !host.endsWith(".recruitcrm.io")) return null;

  const pathParts = parsed.pathname
    .split("/")
    .map((part) => String(part || "").trim())
    .filter(Boolean);

  let account = "";
  if (pathParts.length >= 2 && String(pathParts[0] || "").toLowerCase() === "jobs") {
    account = String(pathParts[1] || "").trim();
  } else {
    const queryAccount = String(parsed.searchParams?.get("account") || "").trim();
    account = queryAccount;
  }

  if (!account) return null;

  return {
    host,
    account,
    accountLower: account.toLowerCase(),
    publicJobsUrl: `https://recruitcrm.io/jobs/${encodeURIComponent(account)}`,
    apiUrl:
      `https://albatross.recruitcrm.io/v1/external-pages/jobs-by-account/get?account=${encodeURIComponent(account)}&batch=true`
  };
}

function parseRipplingCompany(urlString) {
  const parsed = parseUrl(urlString);
  if (!parsed) return null;

  const host = String(parsed.hostname || "").toLowerCase();
  if (host !== "ats.rippling.com") return null;

  const pathParts = parsed.pathname
    .split("/")
    .map((part) => String(part || "").trim())
    .filter(Boolean);

  let companySlug = "";
  if (pathParts.length > 0) {
    if (String(pathParts[0] || "").toLowerCase() === "api" && pathParts.length >= 5) {
      companySlug = String(pathParts[4] || "").trim();
    } else {
      companySlug = String(pathParts[0] || "").trim();
    }
  }

  if (!companySlug) return null;

  return {
    host,
    companySlug,
    companySlugLower: companySlug.toLowerCase(),
    boardUrl: `https://ats.rippling.com/${companySlug}/jobs`,
    apiUrl: `https://ats.rippling.com/api/v2/board/${companySlug}/jobs`
  };
}

function parseManatalCompany(urlString) {
  const parsed = parseUrl(urlString);
  if (!parsed) return null;

  const host = String(parsed.hostname || "").toLowerCase();
  if (host !== "www.careers-page.com" && !host.endsWith(".careers-page.com")) return null;

  const pathParts = parsed.pathname
    .split("/")
    .map((part) => String(part || "").trim())
    .filter(Boolean);

  const hostSubdomain =
    host.endsWith(".careers-page.com") && host !== "www.careers-page.com"
      ? String(host.split(".")[0] || "").trim()
      : "";

  let domainSlug = hostSubdomain || String(pathParts[0] || "").trim();
  if (!domainSlug) return null;
  domainSlug = domainSlug.toLowerCase();
  if (!domainSlug || domainSlug === "job" || domainSlug === "jobs") return null;

  const baseOrigin = `${parsed.protocol}//${parsed.host}`;
  const publicBaseUrl = "https://www.careers-page.com";
  const boardUrl =
    host === "www.careers-page.com" ? `${baseOrigin}/${domainSlug}/` : `${baseOrigin}/`;

  return {
    host,
    domainSlug,
    domainSlugLower: domainSlug.toLowerCase(),
    baseOrigin,
    publicBaseUrl,
    boardUrl,
    careersUrl: boardUrl,
    jobsApiUrl: `${publicBaseUrl}/api/v1.0/c/${encodeURIComponent(domainSlug)}/jobs/`
  };
}

function parseGemCompany(urlString) {
  const parsed = parseUrl(urlString);
  if (!parsed) return null;

  const host = String(parsed.hostname || "").toLowerCase();
  if (host !== "jobs.gem.com" && host !== "www.jobs.gem.com") return null;

  const pathParts = parsed.pathname
    .split("/")
    .map((part) => String(part || "").trim())
    .filter(Boolean);
  if (pathParts.length === 0) return null;

  const boardId = String(pathParts[0] || "").trim();
  if (!boardId) return null;

  return {
    host,
    boardId,
    boardIdLower: boardId.toLowerCase(),
    boardUrl: `${parsed.protocol}//${parsed.host}/${boardId}`,
    apiUrl: "https://jobs.gem.com/api/public/graphql/batch"
  };
}

function parseJobApsCompany(urlString) {
  const parsed = parseUrl(urlString);
  if (!parsed) return null;

  const host = String(parsed.hostname || "").toLowerCase();
  if (!host.endsWith(".jobapscloud.com")) return null;

  const boardUrl = parsed.toString();
  return {
    host,
    boardUrl
  };
}

function parseJoinCompany(urlString) {
  const parsed = parseUrl(urlString);
  if (!parsed) return null;

  const host = String(parsed.hostname || "").toLowerCase();
  if (host !== "join.com" && host !== "www.join.com") return null;

  const pathParts = parsed.pathname
    .split("/")
    .map((part) => String(part || "").trim())
    .filter(Boolean);
  if (pathParts.length < 2 || String(pathParts[0] || "").toLowerCase() !== "companies") return null;

  const companySlug = String(pathParts[1] || "").trim();
  if (!companySlug) return null;

  return {
    host,
    companySlug,
    companySlugLower: companySlug.toLowerCase(),
    boardUrl: `${parsed.protocol}//${parsed.host}/companies/${companySlug}`
  };
}

function parseTalentreefCompany(urlString) {
  const parsed = parseUrl(urlString);
  if (!parsed) return null;

  const host = String(parsed.hostname || "").toLowerCase();
  if (host !== "apply.jobappnetwork.com" && host !== "www.apply.jobappnetwork.com") return null;

  const pathParts = parsed.pathname
    .split("/")
    .map((part) => String(part || "").trim())
    .filter(Boolean);
  if (pathParts.length === 0) return null;

  const companyName = String(pathParts[0] || "").trim();
  if (!companyName) return null;

  return {
    host,
    companyName,
    companyNameLower: companyName.toLowerCase(),
    baseOrigin: `${parsed.protocol}//${parsed.host}`,
    boardUrl: `${parsed.protocol}//${parsed.host}/${companyName}`,
    aliasApiUrl: `https://prod-kong.internal.talentreef.com/apply/careerPages/alias/${encodeURIComponent(companyName)}`,
    searchApiUrl: "https://prod-kong.internal.talentreef.com/apply/proxy-es/search-en-us/posting/_search"
  };
}

function parseApplicantProCompany(urlString) {
  const parsed = parseUrl(urlString);
  if (!parsed) return null;

  const host = String(parsed.hostname || "").toLowerCase();
  if (!host.endsWith(".applicantpro.com")) return null;

  const [subdomain = ""] = host.split(".");
  if (!subdomain) return null;

  const jobsUrl = `${parsed.protocol}//${parsed.host}/jobs/`;
  return {
    host,
    subdomain,
    subdomainLower: subdomain.toLowerCase(),
    origin: `${parsed.protocol}//${parsed.host}`,
    jobsUrl
  };
}

function parseApplyToJobCompany(urlString) {
  const parsed = parseUrl(urlString);
  if (!parsed) return null;

  const host = String(parsed.hostname || "").toLowerCase();
  if (!host.endsWith(".applytojob.com")) return null;

  const [subdomain = ""] = host.split(".");
  if (!subdomain) return null;

  return {
    host,
    subdomain,
    subdomainLower: subdomain.toLowerCase(),
    baseOrigin: `${parsed.protocol}//${parsed.host}`,
    applyUrl: `${parsed.protocol}//${parsed.host}/apply`
  };
}

function parseTheApplicantManagerCompany(urlString) {
  const parsed = parseUrl(urlString);
  if (!parsed) return null;

  const host = String(parsed.hostname || "").toLowerCase();
  if (host !== "theapplicantmanager.com" && host !== "www.theapplicantmanager.com") return null;

  const companyCode = String(parsed.searchParams.get("co") || "").trim().toLowerCase();
  if (!companyCode) return null;

  return {
    host,
    companyCode,
    companyCodeLower: companyCode.toLowerCase(),
    baseOrigin: `${parsed.protocol}//${parsed.host}`,
    careersUrl: `${parsed.protocol}//${parsed.host}/careers?co=${encodeURIComponent(companyCode)}`
  };
}

function parseIcimsCompany(urlString) {
  const parsed = parseUrl(urlString);
  if (!parsed) return null;

  const host = String(parsed.hostname || "").toLowerCase();
  if (!host.endsWith(".icims.com")) return null;

  const [subdomain = ""] = host.split(".");
  if (!subdomain) return null;

  const searchUrl = new URL(parsed.toString());
  searchUrl.pathname = "/jobs/search";
  if (!searchUrl.searchParams.has("ss")) {
    searchUrl.searchParams.set("ss", "1");
  }
  searchUrl.searchParams.delete("in_iframe");

  return {
    host,
    subdomain,
    subdomainLower: subdomain.toLowerCase(),
    origin: `${parsed.protocol}//${parsed.host}`,
    searchUrl: searchUrl.toString()
  };
}

function parseBreezyCompany(urlString) {
  const parsed = parseUrl(urlString);
  if (!parsed) return null;

  const host = String(parsed.hostname || "").toLowerCase();
  if (host === "breezy.hr" || host === "www.breezy.hr") return null;
  if (!host.endsWith(".breezy.hr")) return null;

  const [subdomain = ""] = host.split(".");
  if (!subdomain) return null;

  return {
    host,
    subdomain,
    subdomainLower: subdomain.toLowerCase(),
    origin: `${parsed.protocol}//${parsed.host}`,
    portalUrl: `${parsed.protocol}//${parsed.host}/`
  };
}

function parseZohoCompany(urlString) {
  const parsed = parseUrl(urlString);
  if (!parsed) return null;

  const host = String(parsed.hostname || "").toLowerCase();
  if (!host.endsWith(".zohorecruit.com")) return null;

  const [subdomain = ""] = host.split(".");
  if (!subdomain) return null;

  const careersUrl = new URL(parsed.toString());
  careersUrl.pathname = "/jobs/Careers";
  careersUrl.search = "";
  careersUrl.hash = "";

  return {
    host,
    subdomain,
    subdomainLower: subdomain.toLowerCase(),
    origin: `${parsed.protocol}//${parsed.host}`,
    careersUrl: careersUrl.toString()
  };
}

function parseApplicantAiCompany(urlString) {
  const parsed = parseUrl(urlString);
  if (!parsed) return null;

  const host = String(parsed.hostname || "").toLowerCase();
  if (host !== "applicantai.com" && host !== "www.applicantai.com") return null;

  const pathParts = parsed.pathname
    .split("/")
    .map((part) => String(part || "").trim())
    .filter(Boolean);
  const slug = String(pathParts[0] || "").trim();
  if (!slug) return null;

  return {
    host,
    slug,
    slugLower: slug.toLowerCase(),
    baseOrigin: `${parsed.protocol}//${parsed.host}`,
    careersUrl: `${parsed.protocol}//${parsed.host}/${slug}`
  };
}

function parseRecruiteeCompany(urlString) {
  const parsed = parseUrl(urlString);
  if (!parsed) return null;
  if (!String(parsed.hostname || "").toLowerCase().endsWith(".recruitee.com")) return null;

  const pathParts = parsed.pathname
    .split("/")
    .map((part) => String(part || "").trim())
    .filter(Boolean);
  const normalizedPathParts = pathParts[0]?.toLowerCase() === "o" ? [] : pathParts;
  const basePath = normalizedPathParts.length > 0 ? `/${normalizedPathParts.join("/")}` : "";
  const baseUrl = `${parsed.origin}${basePath}`.replace(/\/+$/, "");
  const [subdomain = ""] = parsed.hostname.split(".");

  return {
    baseUrl: baseUrl || parsed.origin,
    subdomain: String(subdomain || "").toLowerCase()
  };
}

function parseUltiProCompany(urlString) {
  const parsed = parseUrl(urlString);
  if (!parsed) return null;

  const host = String(parsed.hostname || "").toLowerCase();
  if (host !== "recruiting.ultipro.com") return null;

  const pathParts = parsed.pathname
    .split("/")
    .map((part) => String(part || "").trim())
    .filter(Boolean);

  const jobBoardIndex = pathParts.findIndex((part) => part.toLowerCase() === "jobboard");
  if (jobBoardIndex <= 0 || jobBoardIndex + 1 >= pathParts.length) return null;

  const tenant = pathParts[jobBoardIndex - 1];
  const boardId = pathParts[jobBoardIndex + 1];
  if (!tenant || !boardId) return null;

  return {
    tenant,
    tenantLower: tenant.toLowerCase(),
    boardId,
    baseBoardUrl: `${parsed.protocol}//${parsed.host}/${tenant}/JobBoard/${boardId}`
  };
}

function parseTaleoCompany(urlString) {
  const parsed = parseUrl(urlString);
  if (!parsed) return null;

  const host = String(parsed.hostname || "").toLowerCase();
  if (!host.endsWith(".taleo.net")) return null;

  const pathParts = parsed.pathname
    .split("/")
    .map((part) => String(part || "").trim())
    .filter(Boolean);

  if (pathParts.length < 2 || pathParts[0].toLowerCase() !== "careersection") return null;

  const careerSection = pathParts[1];
  if (!careerSection) return null;

  const lang = String(parsed.searchParams.get("lang") || "en").trim() || "en";

  return {
    careerSection,
    careerSectionLower: careerSection.toLowerCase(),
    lang,
    baseOrigin: `${parsed.protocol}//${parsed.host}`,
    baseSectionUrl: `${parsed.protocol}//${parsed.host}/careersection/${careerSection}`
  };
}

function extractTaleoRestConfig(pageHtml) {
  const source = String(pageHtml || "");
  const portalMatch = source.match(/portal=([0-9]{6,})/i);
  const portal = String(portalMatch?.[1] || "").trim();

  const tokenNamePatterns = [
    /sessionCSRFTokenName\s*:\s*'([^']+)'/i,
    /sessionCSRFTokenName\s*:\s*"([^"]+)"/i,
    /"sessionCSRFTokenName"\s*:\s*"([^"]+)"/i,
    /name=['"](csrftoken)['"]/i
  ];
  const tokenValuePatterns = [
    /sessionCSRFToken\s*:\s*'([^']+)'/i,
    /sessionCSRFToken\s*:\s*"([^"]+)"/i,
    /"sessionCSRFToken"\s*:\s*"([^"]+)"/i,
    /name=["']csrftoken["'][^>]*value=["']([^"']+)["']/i
  ];

  let tokenName = "";
  let tokenValue = "";

  for (const pattern of tokenNamePatterns) {
    const match = source.match(pattern);
    if (!match?.[1]) continue;
    tokenName = String(match[1] || "").trim();
    if (tokenName) break;
  }

  for (const pattern of tokenValuePatterns) {
    const match = source.match(pattern);
    if (!match?.[1]) continue;
    tokenValue = String(match[1] || "").trim();
    if (tokenValue) break;
  }

  return { portal, tokenName, tokenValue };
}

function extractApplicantProDomainId(pageHtml) {
  const source = String(pageHtml || "");
  const patterns = [
    /["']domain_id["']\s*:\s*["']?(\d{2,})["']?/i,
    /["']domainId["']\s*:\s*["']?(\d{2,})["']?/i,
    /data-domain-id=["'](\d{2,})["']/i,
    /name=["']domain_id["'][^>]*value=["'](\d{2,})["']/i,
    /name=["']domainId["'][^>]*value=["'](\d{2,})["']/i,
    /domain_id\s*=\s*["']?(\d{2,})["']?/i,
    /domainId\s*=\s*["']?(\d{2,})["']?/i
  ];

  for (const pattern of patterns) {
    const match = source.match(pattern);
    const value = String(match?.[1] || "").trim();
    if (value) return value;
  }

  return "";
}

function buildTaleoRestPayload(pageNo = 1) {
  return {
    multilineEnabled: true,
    sortingSelection: {
      sortBySelectionParam: "1",
      ascendingSortingOrder: "false"
    },
    fieldData: {
      fields: {
        LOCATION: "",
        CATEGORY: "",
        KEYWORD: ""
      },
      valid: true
    },
    filterSelectionParam: {
      searchFilterSelections: [
        { id: "JOB_FIELD", selectedValues: [] },
        { id: "LOCATION", selectedValues: [] },
        { id: "ORGANIZATION", selectedValues: [] },
        { id: "JOB_LEVEL", selectedValues: [] }
      ]
    },
    advancedSearchFiltersSelectionParam: {
      searchFilterSelections: [
        { id: "ORGANIZATION", selectedValues: [] },
        { id: "LOCATION", selectedValues: [] },
        { id: "JOB_FIELD", selectedValues: [] },
        { id: "JOB_NUMBER", selectedValues: [] },
        { id: "URGENT_JOB", selectedValues: [] },
        { id: "JOB_SHIFT", selectedValues: [] }
      ]
    },
    pageNo: Number(pageNo || 1)
  };
}

function buildTaleoAjaxPayload(lang = "en", csrfToken = "") {
  const payload = {
    ftlpageid: "reqListBasicPage",
    ftlinterfaceid: "requisitionListInterface",
    ftlcompid: "validateTimeZoneId",
    jsfCmdId: "validateTimeZoneId",
    ftlcompclass: "InitTimeZoneAction",
    ftlcallback: "requisition_restoreDatesValues",
    ftlajaxid: "ftlx1",
    tz: "GMT-07:00",
    tzname: "America/Los_Angeles",
    lang: String(lang || "en").trim() || "en",
    isExternal: "true",
    "rlPager.currentPage": "1",
    "listRequisition.size": "25",
    dropListSize: "25"
  };

  if (csrfToken) {
    payload.csrftoken = String(csrfToken || "").trim();
  }

  return payload;
}

function cleanTeamtailorText(value) {
  return decodeHtmlEntities(String(value || "").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function extractTeamtailorMetaParts(value) {
  const source = String(value || "");
  const parts = [];
  const seen = new Set();
  const spanPattern = /<span[^>]*>([\s\S]*?)<\/span>/gi;
  let spanMatch = spanPattern.exec(source);

  while (spanMatch) {
    const cleaned = cleanTeamtailorText(spanMatch[1] || "");
    const normalized = cleaned.toLowerCase();
    if (cleaned && cleaned !== "·" && cleaned !== "&middot;" && !seen.has(normalized)) {
      parts.push(cleaned);
      seen.add(normalized);
    }
    spanMatch = spanPattern.exec(source);
  }

  return parts;
}

function parseTeamtailorPostingsFromHtml(companyNameForPostings, config, pageHtml) {
  const source = String(pageHtml || "");
  const postings = [];
  const seenUrls = new Set();
  const itemPattern =
    /<li[^>]*class=["'][^"']*\bblock-grid-item\b[^"']*["'][^>]*>([\s\S]*?)<\/li>/gi;
  const hrefPattern = /<a[^>]*href=["']([^"']+)["'][^>]*>/i;
  const titleAttrPattern =
    /<span[^>]*class=["'][^"']*\btext-block-base-link\b[^"']*["'][^>]*\btitle=["']([^"']+)["'][^>]*>/i;
  const titleBodyPattern =
    /<span[^>]*class=["'][^"']*\btext-block-base-link\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i;
  const metaPattern =
    /<div[^>]*class=["'][^"']*\bmt-1\b[^"']*\btext-md\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i;

  let itemMatch = itemPattern.exec(source);
  while (itemMatch) {
    const itemHtml = String(itemMatch[1] || "");
    const hrefMatch = itemHtml.match(hrefPattern);
    const href = String(hrefMatch?.[1] || "").trim();
    const jobUrl = href ? new URL(href, `${config.baseOrigin || ""}/`).toString() : "";
    if (!jobUrl || seenUrls.has(jobUrl)) {
      itemMatch = itemPattern.exec(source);
      continue;
    }

    const titleFromAttr = cleanTeamtailorText(itemHtml.match(titleAttrPattern)?.[1] || "");
    const titleFromBody = cleanTeamtailorText(itemHtml.match(titleBodyPattern)?.[1] || "");
    const title = titleFromAttr || titleFromBody || "Untitled Position";

    const metaRaw = String(itemHtml.match(metaPattern)?.[1] || "");
    const metaParts = extractTeamtailorMetaParts(metaRaw);
    const department = metaParts.length > 1 ? metaParts[0] : null;
    const location = metaParts.length > 1 ? metaParts.slice(1).join(" / ") : metaParts[0] || null;

    postings.push({
      company_name: companyNameForPostings,
      source_job_id: extractSourceIdFromPostingUrl(jobUrl, "teamtailor"),
      position_name: title,
      job_posting_url: jobUrl,
      posting_date: null,
      location,
      department
    });
    seenUrls.add(jobUrl);
    itemMatch = itemPattern.exec(source);
  }

  return postings;
}

function cleanFreshteamText(value) {
  return decodeHtmlEntities(String(value || "").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function parseFreshteamPostingsFromHtml(companyNameForPostings, config, pageHtml) {
  const source = String(pageHtml || "");
  const postings = [];
  const seenUrls = new Set();

  const cardPattern =
    /<a[^>]*href=["'](\/jobs\/[^"'#?]+(?:\/[^"'#?]+)?)["'][^>]*class=["'][^"']*\bheading\b[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi;
  const titlePattern = /<div[^>]*class=["'][^"']*\bjob-title\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i;
  const locationInfoPattern = /<div[^>]*class=["'][^"']*\blocation-info\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i;
  const locationAttrPattern = /\bdata-portal-location=["']([^"']*)["']/i;
  const remoteAttrPattern = /\bdata-portal-remote-location=(true|false)\b/i;

  let cardMatch = cardPattern.exec(source);
  while (cardMatch) {
    const href = String(cardMatch[1] || "").trim();
    const absoluteUrl = href ? new URL(href, `${config.baseOrigin || ""}/`).toString() : "";
    if (!absoluteUrl || seenUrls.has(absoluteUrl)) {
      cardMatch = cardPattern.exec(source);
      continue;
    }

    const cardHtml = String(cardMatch[0] || "");
    const bodyHtml = String(cardMatch[2] || "");
    const title = cleanFreshteamText(bodyHtml.match(titlePattern)?.[1] || "") || "Untitled Position";
    const location = cleanFreshteamText(cardHtml.match(locationAttrPattern)?.[1] || "");
    const locationInfo = cleanFreshteamText(bodyHtml.match(locationInfoPattern)?.[1] || "");
    const isRemoteRaw = String(cardHtml.match(remoteAttrPattern)?.[1] || "").trim().toLowerCase();

    postings.push({
      company_name: companyNameForPostings,
      position_name: title,
      job_posting_url: absoluteUrl,
      posting_date: null,
      location: location || locationInfo || null,
      location_info: locationInfo || null,
      is_remote: isRemoteRaw === "true" ? 1 : 0
    });

    seenUrls.add(absoluteUrl);
    cardMatch = cardPattern.exec(source);
  }

  return postings;
}

function cleanSagehrText(value) {
  return decodeHtmlEntities(String(value || "").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function extractSagehrCompanyNameFromHtml(pageHtml) {
  const source = String(pageHtml || "");
  const companyMatch = source.match(
    /<div[^>]*class=['"][^'"]*\btitle-wrap\b[^'"]*['"][^>]*>[\s\S]*?<h1[^>]*>([\s\S]*?)<\/h1>/i
  );
  const fromTitleWrap = cleanSagehrText(companyMatch?.[1] || "");
  if (fromTitleWrap) return fromTitleWrap;

  const fallbackMatch = source.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const fallback = cleanSagehrText(fallbackMatch?.[1] || "");
  return fallback || "Unknown Company";
}

function parseSagehrPostingsFromHtml(companyNameForPostings, config, pageHtml) {
  const source = String(pageHtml || "");
  const postings = [];
  const seenUrls = new Set();

  const jobPattern = /<div[^>]*class=['"][^'"]*\bjob\b[^'"]*['"][^>]*>([\s\S]*?)<\/div>/gi;
  const linkPattern =
    /<a[^>]*class=['"][^'"]*\btitle\b[^'"]*['"][^>]*href=['"]([^"']+)['"][^>]*>([\s\S]*?)<\/a>/i;
  const locationPattern = /<div[^>]*class=['"][^'"]*\blocation\b[^'"]*['"][^>]*>([\s\S]*?)<\/div>/i;

  let jobMatch = jobPattern.exec(source);
  while (jobMatch) {
    const jobHtml = String(jobMatch[1] || "");
    const linkMatch = jobHtml.match(linkPattern);
    const hrefRaw = cleanSagehrText(linkMatch?.[1] || "");
    const href = decodeHtmlEntities(hrefRaw).replace(/\s+/g, "");
    if (!href || !href.toLowerCase().includes("/jobs/")) {
      jobMatch = jobPattern.exec(source);
      continue;
    }

    let absoluteUrl = "";
    try {
      absoluteUrl = new URL(href, `${config.baseOrigin || ""}/`).toString();
    } catch {
      jobMatch = jobPattern.exec(source);
      continue;
    }

    if (!absoluteUrl || seenUrls.has(absoluteUrl)) {
      jobMatch = jobPattern.exec(source);
      continue;
    }

    const title = cleanSagehrText(linkMatch?.[2] || "") || "Untitled Position";
    const location = cleanSagehrText(jobHtml.match(locationPattern)?.[1] || "");

    postings.push({
      company_name: companyNameForPostings,
      position_name: title,
      job_posting_url: absoluteUrl,
      posting_date: null,
      location: location || null
    });
    seenUrls.add(absoluteUrl);
    jobMatch = jobPattern.exec(source);
  }

  return postings;
}

function cleanPeopleforceText(value) {
  return decodeHtmlEntities(String(value || "").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function parsePeopleforcePostingsFromHtml(companyNameForPostings, config, pageHtml) {
  const source = String(pageHtml || "");
  const postings = [];
  const seenUrls = new Set();

  const postingPattern =
    /<a[^>]*class=["'][^"']*\bstretched-link\b[^"']*["'][^>]*href=["'](\/careers\/v\/[^"'#?]+)["'][^>]*>([\s\S]*?)<\/a>([\s\S]*?)(?=<a[^>]*class=["'][^"']*\bstretched-link\b|$)/gi;
  const locationPattern =
    /<div[^>]*class=["'][^"']*\btw-text-neutral-dark-80\b[^"']*\bsmall\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i;

  let postingMatch = postingPattern.exec(source);
  while (postingMatch) {
    const href = String(postingMatch[1] || "").trim();
    const absoluteUrl = href ? new URL(href, `${config.baseOrigin || ""}/`).toString() : "";
    if (!absoluteUrl || seenUrls.has(absoluteUrl)) {
      postingMatch = postingPattern.exec(source);
      continue;
    }

    const title = cleanPeopleforceText(postingMatch[2] || "") || "Untitled Position";
    const locationRaw = String(postingMatch[3] || "");
    const location = cleanPeopleforceText(locationRaw.match(locationPattern)?.[1] || "");

    postings.push({
      company_name: companyNameForPostings,
      position_name: title,
      job_posting_url: absoluteUrl,
      posting_date: null,
      location: location || null
    });

    seenUrls.add(absoluteUrl);
    postingMatch = postingPattern.exec(source);
  }

  return postings;
}

function cleanSimplicantText(value) {
  return decodeHtmlEntities(String(value || "").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function parseSimplicantPostingsFromHtml(companyNameForPostings, config, pageHtml) {
  const source = String(pageHtml || "");
  const postings = [];
  const seenUrls = new Set();

  const cardPattern =
    /<a[^>]*class=["'][^"']*\blist-group-item\b[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  const titlePattern = /<h3[^>]*class=["'][^"']*\bjob-title\b[^"']*["'][^>]*>([\s\S]*?)<\/h3>/i;
  const locationPattern = /<div[^>]*class=["'][^"']*\bjob-subtitle\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i;

  let match = cardPattern.exec(source);
  while (match) {
    const href = cleanSimplicantText(match[1] || "");
    if (!href || !href.includes("/jobs/") || !href.replace(/\/+$/, "").toLowerCase().endsWith("/detail")) {
      match = cardPattern.exec(source);
      continue;
    }

    const absoluteUrl = new URL(href, `${config.baseOrigin || ""}/`).toString();
    if (!absoluteUrl || seenUrls.has(absoluteUrl)) {
      match = cardPattern.exec(source);
      continue;
    }

    const bodyHtml = String(match[2] || "");
    const title = cleanSimplicantText(bodyHtml.match(titlePattern)?.[1] || "") || "Untitled Position";
    const location = cleanSimplicantText(bodyHtml.match(locationPattern)?.[1] || "");

    postings.push({
      company_name: companyNameForPostings,
      position_name: title,
      job_posting_url: absoluteUrl,
      posting_date: null,
      location: location || null
    });

    seenUrls.add(absoluteUrl);
    match = cardPattern.exec(source);
  }

  return postings;
}

function cleanLoxoText(value) {
  return decodeHtmlEntities(String(value || "").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function parseLoxoPostingsFromHtml(companyNameForPostings, config, pageHtml) {
  const source = String(pageHtml || "");
  const postings = [];
  const seenUrls = new Set();

  const cardPattern =
    /<div[^>]*class=['"][^'"]*\bjobs-listing-card\b[^'"]*['"][^>]*>([\s\S]*?)<\/div>\s*<\/div>\s*<div[^>]*class=['"][^'"]*\bdata-cell\b[^'"]*['"][^>]*>[\s\S]*?<div[^>]*class=['"][^'"]*\bjob-location\b[^'"]*['"][^>]*>([\s\S]*?)<\/div>/gi;
  const hrefPattern = /<a[^>]*class=['"][^'"]*\bjob-title\b[^'"]*['"][^>]*href=['"]([^"']+)['"][^>]*>([\s\S]*?)<\/a>/i;
  const datePattern = /<div[^>]*class=['"][^'"]*\bjob-date\b[^'"]*['"][^>]*>([\s\S]*?)<\/div>/i;

  let match = cardPattern.exec(source);
  while (match) {
    const cardHtml = String(match[1] || "");
    const locationHtml = String(match[2] || "");
    const hrefMatch = cardHtml.match(hrefPattern);
    const href = String(hrefMatch?.[1] || "").trim();
    const absoluteUrl = href ? new URL(href, `${config.baseOrigin || ""}/`).toString() : "";
    if (!absoluteUrl || seenUrls.has(absoluteUrl)) {
      match = cardPattern.exec(source);
      continue;
    }

    const title = cleanLoxoText(hrefMatch?.[2] || "") || "Untitled Position";
    const postingDate = cleanLoxoText(cardHtml.match(datePattern)?.[1] || "");
    const location = cleanLoxoText(locationHtml).replace(/\blocation_on\b/gi, "").trim();

    postings.push({
      company_name: companyNameForPostings,
      position_name: title,
      job_posting_url: absoluteUrl,
      posting_date: postingDate || null,
      location: location || null
    });

    seenUrls.add(absoluteUrl);
    match = cardPattern.exec(source);
  }

  return postings;
}

function cleanCareerspageText(value) {
  return decodeHtmlEntities(String(value || "").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function parseCareerspagePostingsFromHtml(companyNameForPostings, config, pageHtml) {
  const source = String(pageHtml || "");
  const postings = [];
  const seenUrls = new Set();

  const jobItemPattern = /<div[^>]*class=['"][^'"]*\bjob-item\b[^'"]*['"][^>]*>([\s\S]*?)<\/div>\s*<\/div>/gi;
  let itemMatch = jobItemPattern.exec(source);

  while (itemMatch) {
    const itemHtml = String(itemMatch[1] || "");
    const hrefRaw = String(
      itemHtml.match(/href=['"](https?:\/\/careerspage\.io\/[^'"?#]+\/[^'"?#]+)['"]/i)?.[1] || ""
    ).trim();
    if (!hrefRaw) {
      itemMatch = jobItemPattern.exec(source);
      continue;
    }

    const title = cleanCareerspageText(itemHtml.match(/<h3[^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>[\s\S]*?<\/h3>/i)?.[1] || "");
    if (!title) {
      itemMatch = jobItemPattern.exec(source);
      continue;
    }

    let jobUrl = "";
    try {
      jobUrl = new URL(hrefRaw, `${String(config?.boardUrl || "").replace(/\/+$/, "")}/`).toString();
    } catch {
      itemMatch = jobItemPattern.exec(source);
      continue;
    }
    if (!jobUrl || seenUrls.has(jobUrl)) {
      itemMatch = jobItemPattern.exec(source);
      continue;
    }

    const location = cleanCareerspageText(
      itemHtml.match(/fa-location-arrow[^<]*<\/i>\s*<\/span>\s*<span[^>]*>([\s\S]*?)<\/span>/i)?.[1] || ""
    );
    const employmentType = cleanCareerspageText(
      itemHtml.match(/fa-business-time[^<]*<\/i>\s*<\/span>\s*<span[^>]*>([\s\S]*?)<\/span>/i)?.[1] || ""
    );

    postings.push({
      company_name: companyNameForPostings,
      position_name: title || "Untitled Position",
      job_posting_url: jobUrl,
      posting_date: null,
      location: location || null,
      employment_type: employmentType || null
    });
    seenUrls.add(jobUrl);
    itemMatch = jobItemPattern.exec(source);
  }

  return postings;
}

function cleanPaylocityText(value) {
  return decodeHtmlEntities(String(value || ""))
    .replace(/\s+/g, " ")
    .trim();
}

function extractPaylocityPageDataJson(pageHtml) {
  const source = String(pageHtml || "");
  const marker = "window.pageData =";
  let startIndex = source.indexOf(marker);
  if (startIndex < 0) return {};

  startIndex = source.indexOf("{", startIndex);
  if (startIndex < 0) return {};

  let depth = 0;
  let inString = false;
  let escape = false;
  let stringChar = "";

  for (let index = startIndex; index < source.length; index += 1) {
    const char = source[index];

    if (inString) {
      if (escape) {
        escape = false;
      } else if (char === "\\") {
        escape = true;
      } else if (char === stringChar) {
        inString = false;
      }
      continue;
    }

    if (char === "'" || char === '"') {
      inString = true;
      stringChar = char;
      continue;
    }

    if (char === "{") {
      depth += 1;
      continue;
    }
    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(source.slice(startIndex, index + 1));
        } catch {
          return {};
        }
      }
    }
  }

  return {};
}

function parsePaylocityPostingsFromPageData(companyNameForPostings, config, pageData) {
  const jobs = Array.isArray(pageData?.Jobs) ? pageData.Jobs : [];
  const postings = [];
  const seenIds = new Set();
  const effectiveCompanyName =
    cleanPaylocityText(companyNameForPostings) || `paylocity_${String(config?.companyId || "").toLowerCase()}`;

  for (const job of jobs) {
    if (!job || typeof job !== "object") continue;

    const jobId = cleanPaylocityText(job?.JobId || "");
    const normalizedJobId = jobId.toLowerCase();
    if (!jobId || seenIds.has(normalizedJobId)) continue;

    const jobLocation = job?.JobLocation && typeof job.JobLocation === "object" ? job.JobLocation : {};
    const city = cleanPaylocityText(jobLocation?.City || "");
    const state = cleanPaylocityText(jobLocation?.State || "");
    const country = cleanPaylocityText(jobLocation?.Country || "");
    const isRemote = Boolean(job?.IsRemote);

    const locationParts = [city, state].filter(Boolean);
    let location = locationParts.join(", ");
    if (!location) location = cleanPaylocityText(job?.LocationName || "");
    if (!location && isRemote) location = "Remote";
    if (!location && country) location = country;

    postings.push({
      company_name: effectiveCompanyName,
      source_job_id: jobId,
      id: jobId,
      position_name: cleanPaylocityText(job?.JobTitle || "") || "Untitled Position",
      job_posting_url: `${String(config?.siteBaseUrl || "").replace(/\/+$/, "")}/Recruiting/Jobs/Details/${encodeURIComponent(jobId)}`,
      posting_date: cleanPaylocityText(job?.PublishedDate || "") || null,
      location: location || null,
      department: cleanPaylocityText(job?.HiringDepartment || "") || null,
      employment_type: isRemote ? "Remote" : null
    });
    seenIds.add(normalizedJobId);
  }

  return postings;
}

function cleanEightfoldText(value) {
  return decodeHtmlEntities(String(value || ""))
    .replace(/\s+/g, " ")
    .trim();
}

function extractEightfoldDomainFromHtml(pageHtml) {
  const source = String(pageHtml || "");
  const match = source.match(/window\._EF_GROUP_ID\s*=\s*["']([^"']+)["']/i);
  const value = cleanEightfoldText(match?.[1] || "");
  return value || "";
}

function buildEightfoldApiUrl(config, domainValue) {
  const siteBaseUrl = String(config?.siteBaseUrl || "").replace(/\/+$/, "");
  const domain = cleanEightfoldText(domainValue || "");
  if (!siteBaseUrl || !domain) return "";
  return `${siteBaseUrl}/api/pcsx/search?domain=${encodeURIComponent(domain)}&query=&location=&start=0&`;
}

function parseEightfoldPostingsFromApi(companyNameForPostings, config, responseJson) {
  const data = responseJson?.data && typeof responseJson.data === "object" ? responseJson.data : {};
  const positions = Array.isArray(data?.positions) ? data.positions : [];
  const postings = [];
  const seenIds = new Set();
  const seenUrls = new Set();

  const fallbackCompanyKey =
    String(config?.host || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "board";
  const effectiveCompanyName = cleanEightfoldText(companyNameForPostings) || `eightfold_${fallbackCompanyKey}`;

  for (const position of positions) {
    if (!position || typeof position !== "object") continue;

    const positionId = cleanEightfoldText(position?.id || "");
    const normalizedPositionId = positionId.toLowerCase();
    if (!positionId || seenIds.has(normalizedPositionId)) continue;

    const rawPositionUrl = cleanEightfoldText(position?.positionUrl || "");
    let postingUrl = "";
    if (rawPositionUrl) {
      try {
        postingUrl = new URL(rawPositionUrl, `${String(config?.siteBaseUrl || "").replace(/\/+$/, "")}/`).toString();
      } catch {
        postingUrl = "";
      }
    }
    if (!postingUrl || seenUrls.has(postingUrl)) continue;

    const locations = Array.isArray(position?.locations)
      ? position.locations.map((item) => cleanEightfoldText(item || "")).filter(Boolean)
      : [];
    const fallbackLocation = cleanEightfoldText(position?.locations || "");
    const workLocationOption = cleanEightfoldText(position?.workLocationOption || "");
    let location = locations.length > 0 ? locations.join(", ") : fallbackLocation;
    if (!location && /remote/i.test(workLocationOption)) {
      location = "Remote";
    }

    const rawPostedTs = position?.postedTs;
    let postingDate = "";
    if (Number.isFinite(Number(rawPostedTs)) && Number(rawPostedTs) > 0) {
      postingDate = String(Math.floor(Number(rawPostedTs)));
    } else {
      postingDate = cleanEightfoldText(rawPostedTs || "");
    }

    const department = Array.isArray(position?.department)
      ? position.department.map((item) => cleanEightfoldText(item || "")).filter(Boolean).join(" / ")
      : cleanEightfoldText(position?.department || "");
    const externalId = cleanEightfoldText(position?.atsJobId || "");

    postings.push({
      company_name: effectiveCompanyName,
      position_name: cleanEightfoldText(position?.name || "") || "Untitled Position",
      job_posting_url: postingUrl,
      posting_date: postingDate || null,
      location: location || null,
      department: department || null,
      employment_type: workLocationOption || null,
      external_id: externalId || null
    });
    seenIds.add(normalizedPositionId);
    seenUrls.add(postingUrl);
  }

  return postings;
}

function cleanOracleText(value) {
  return decodeHtmlEntities(String(value || ""))
    .replace(/\s+/g, " ")
    .trim();
}

function extractOracleCompanyNameFromFacetList(facets) {
  if (!Array.isArray(facets)) return "";
  for (const facet of facets) {
    if (!facet || typeof facet !== "object") continue;
    const companyName = cleanOracleText(facet?.Name || facet?.name || "");
    if (companyName) return companyName;
  }
  return "";
}

function extractOracleCompanyNameFromItem(item) {
  if (!item || typeof item !== "object") return "";

  const direct = extractOracleCompanyNameFromFacetList(item.organizationsFacet);
  if (direct) return direct;

  const workLocationsFacet = Array.isArray(item.workLocationsFacet)
    ? item.workLocationsFacet
    : item.workLocationsFacet && typeof item.workLocationsFacet === "object"
      ? [item.workLocationsFacet]
      : [];
  for (const workLocation of workLocationsFacet) {
    if (!workLocation || typeof workLocation !== "object") continue;
    const nested = extractOracleCompanyNameFromFacetList(workLocation.organizationsFacet);
    if (nested) return nested;
  }

  return "";
}

function extractOracleCompanyNameFromResponse(responseJson) {
  const items = Array.isArray(responseJson?.items) ? responseJson.items : [];
  for (const item of items) {
    const companyName = extractOracleCompanyNameFromItem(item);
    if (companyName) return companyName;
  }
  return "";
}

function extractOracleLocationFromRequisition(item) {
  const requisition = item && typeof item === "object" ? item : {};
  const primaryLocation = cleanOracleText(requisition?.PrimaryLocation || requisition?.primaryLocation || "");
  if (primaryLocation) return primaryLocation;

  const workLocations = Array.isArray(requisition?.workLocation) ? requisition.workLocation : [];
  const values = [];
  const seen = new Set();

  for (const workLocation of workLocations) {
    const location = workLocation && typeof workLocation === "object" ? workLocation : {};
    const city = cleanOracleText(location?.TownOrCity || location?.townOrCity || "");
    const state = cleanOracleText(location?.Region2 || location?.region2 || "");
    const country = cleanOracleText(location?.Country || location?.country || "");
    const locationName = cleanOracleText(location?.LocationName || location?.locationName || "");
    const label = [city, state, country].filter(Boolean).join(", ") || locationName;
    const normalized = String(label || "").toLowerCase();
    if (!label || seen.has(normalized)) continue;
    seen.add(normalized);
    values.push(label);
  }

  return values.length > 0 ? values.join(" / ") : null;
}

function buildOraclePostingUrl(config, requisitionId) {
  const id = String(requisitionId || "").trim();
  if (!id) return String(config?.boardUrl || "").trim();
  return (
    `${config.siteBaseUrl}/hcmUI/CandidateExperience/${encodeURIComponent(config.language)}` +
    `/sites/${encodeURIComponent(config.siteNumber)}/job/${encodeURIComponent(id)}`
  );
}

function parseOraclePostingsFromApi(companyNameForPostings, config, responseJson) {
  const items = Array.isArray(responseJson?.items) ? responseJson.items : [];
  const inferredCompanyName = extractOracleCompanyNameFromResponse(responseJson);
  const effectiveCompanyName =
    cleanOracleText(companyNameForPostings) ||
    inferredCompanyName ||
    `oracle_${String(config?.siteNumber || "cx").toLowerCase()}`;

  const postings = [];
  const seenIds = new Set();
  const seenUrls = new Set();

  for (const item of items) {
    const container = item && typeof item === "object" ? item : {};
    const requisitions = Array.isArray(container?.requisitionList) ? container.requisitionList : [];

    for (const requisition of requisitions) {
      const row = requisition && typeof requisition === "object" ? requisition : {};
      const requisitionId = cleanOracleText(row?.Id || row?.id || "");
      if (requisitionId && seenIds.has(requisitionId)) continue;

      const postingDate = cleanOracleText(row?.PostedDate || row?.postDate || "");
      if (!postingDate) continue;

      const postingUrl = buildOraclePostingUrl(config, requisitionId);
      if (!postingUrl || seenUrls.has(postingUrl)) continue;

      const departmentValues = [
        cleanOracleText(row?.Department || row?.department || ""),
        cleanOracleText(row?.JobFamily || row?.jobFamily || ""),
        cleanOracleText(row?.Organization || row?.organization || ""),
        cleanOracleText(row?.BusinessUnit || row?.businessUnit || "")
      ].filter(Boolean);
      const uniqueDepartments = Array.from(new Set(departmentValues.map((value) => value.toLowerCase()))).map(
        (lowered) => departmentValues.find((value) => value.toLowerCase() === lowered) || lowered
      );

      const employmentTypeValues = [
        cleanOracleText(row?.WorkerType || row?.workerType || ""),
        cleanOracleText(row?.JobType || row?.jobType || ""),
        cleanOracleText(row?.ContractType || row?.contractType || ""),
        cleanOracleText(row?.WorkplaceType || row?.workplaceType || "")
      ].filter(Boolean);
      const uniqueEmploymentTypes = Array.from(
        new Set(employmentTypeValues.map((value) => value.toLowerCase()))
      ).map((lowered) => employmentTypeValues.find((value) => value.toLowerCase() === lowered) || lowered);

      postings.push({
        company_name: effectiveCompanyName,
        source_job_id: requisitionId || undefined,
        id: requisitionId || undefined,
        position_name: cleanOracleText(row?.Title || row?.title || "") || "Untitled Position",
        job_posting_url: postingUrl,
        posting_date: postingDate,
        location: extractOracleLocationFromRequisition(row),
        department: uniqueDepartments.length > 0 ? uniqueDepartments.join(" / ") : null,
        employment_type: uniqueEmploymentTypes.length > 0 ? uniqueEmploymentTypes.join(" / ") : null
      });

      seenUrls.add(postingUrl);
      if (requisitionId) seenIds.add(requisitionId);
    }
  }

  return postings;
}

function parseCareerpuckPostingsFromApi(companyNameForPostings, responseJson) {
  const jobs = Array.isArray(responseJson?.jobs) ? responseJson.jobs : [];
  const postings = [];
  const seenUrls = new Set();

  for (const job of jobs) {
    const status = String(job?.status || "").trim().toLowerCase();
    if (status && status !== "public") continue;

    const publicUrl = String(job?.publicUrl || "").trim();
    const applyUrl = String(job?.applyUrl || "").trim();
    const jobUrl = publicUrl || applyUrl;
    if (!jobUrl || seenUrls.has(jobUrl)) continue;

    const title = String(job?.title || "").trim() || "Untitled Position";
    const location = String(job?.location || "").trim() || null;
    const postingDate = String(job?.postedAt || "").trim() || null;
    const departmentNames = Array.isArray(job?.departments)
      ? job.departments
          .map((item) => String(item?.name || "").trim())
          .filter(Boolean)
      : [];

    postings.push({
      company_name: companyNameForPostings,
      position_name: title,
      job_posting_url: jobUrl,
      posting_date: postingDate,
      location,
      department: departmentNames.length > 0 ? departmentNames.join(" / ") : null
    });
    seenUrls.add(jobUrl);
  }

  return postings;
}

function parseBambooHrPostingsFromApi(companyNameForPostings, config, responseJson) {
  const result = Array.isArray(responseJson?.result) ? responseJson.result : [];
  const postings = [];
  const seenUrls = new Set();

  for (const row of result) {
    const item = row && typeof row === "object" ? row : {};
    const postingId = String(item?.id || "").trim();
    const itemUrlRaw = String(item?.url || item?.jobUrl || item?.applyUrl || item?.applicationUrl || "").trim();
    if (!itemUrlRaw && !postingId) continue;
    const jobUrl = itemUrlRaw
      ? new URL(itemUrlRaw, `${config.baseOrigin || config.boardUrl || ""}/`).toString()
      : postingId
        ? `${config.boardUrl}/${encodeURIComponent(postingId)}`
        : "";
    if (!jobUrl || seenUrls.has(jobUrl)) continue;

    const locationObject = item?.location && typeof item.location === "object" ? item.location : {};
    const atsLocationObject = item?.atsLocation && typeof item.atsLocation === "object" ? item.atsLocation : {};
    const rawLocationText = typeof item?.location === "string" ? String(item.location || "").trim() : "";
    const rawAtsLocationText = typeof item?.atsLocation === "string" ? String(item.atsLocation || "").trim() : "";
    const city = String(locationObject?.city || atsLocationObject?.city || "").trim();
    const state = String(
      locationObject?.state ||
        locationObject?.province ||
        locationObject?.region ||
        atsLocationObject?.state ||
        atsLocationObject?.province ||
        atsLocationObject?.region ||
        ""
    ).trim();
    const country = String(
      locationObject?.country ||
        atsLocationObject?.country ||
        locationObject?.countryName ||
        atsLocationObject?.countryName ||
        locationObject?.countryCode ||
        atsLocationObject?.countryCode ||
        ""
    ).trim();
    const locationName = String(
      locationObject?.name ||
        atsLocationObject?.name ||
        locationObject?.label ||
        atsLocationObject?.label ||
        locationObject?.displayName ||
        atsLocationObject?.displayName ||
        ""
    ).trim();
    const structuredLocation = [city, state, country].filter(Boolean).join(", ");
    const location =
      structuredLocation ||
      locationName ||
      rawLocationText ||
      rawAtsLocationText ||
      String(item?.employmentLocation || item?.workplaceLocation || "").trim() ||
      (item?.isRemote ? "Remote" : null);

    const postingDate =
      String(
        item?.postingDate ||
          item?.postedDate ||
          item?.postedAt ||
          item?.publishedAt ||
          item?.publishDate ||
          item?.datePosted ||
          item?.createdDate ||
          item?.createdAt ||
          item?.updatedDate ||
          item?.updatedAt ||
          item?.openedDate ||
          item?.openDate ||
          ""
      ).trim() ||
      null;

    postings.push({
      company_name: companyNameForPostings,
      source_job_id: postingId || extractSourceIdFromPostingUrl(jobUrl, "bamboohr"),
      id: postingId,
      position_name: String(item?.jobOpeningName || item?.title || "").trim() || "Untitled Position",
      job_posting_url: jobUrl,
      posting_date: postingDate,
      location,
      city: isRemoteOnlyLocationValue(city) ? null : city || null,
      country: country || null,
      remote: item?.isRemote === true,
      is_remote: item?.isRemote === true,
      workplaceType:
        String(item?.workplaceType || item?.workplace_type || item?.remoteStatus || item?.locationType || "").trim() ||
        (item?.isRemote === true ? "remote" : null),
      department: String(item?.departmentLabel || item?.department || "").trim() || null,
      employment_type: String(item?.employmentStatusLabel || item?.employmentStatus || "").trim() || null
    });
    seenUrls.add(jobUrl);
  }

  return postings;
}

function extractAdpMyjobsLocationParts(locationItem) {
  const item = locationItem && typeof locationItem === "object" ? locationItem : {};
  const nameCode = item?.nameCode && typeof item.nameCode === "object" ? item.nameCode : {};
  const locationName = String(nameCode?.longName || "").trim();
  const address = item?.address && typeof item.address === "object" ? item.address : {};
  const city = String(address?.cityName || "").trim();
  const stateData =
    address?.countrySubdivisionLevel1 && typeof address.countrySubdivisionLevel1 === "object"
      ? address.countrySubdivisionLevel1
      : {};
  const state = String(stateData?.codeValue || stateData?.longName || "").trim();
  const countryData = address?.country && typeof address.country === "object" ? address.country : {};
  const country = String(countryData?.longName || countryData?.codeValue || "").trim();
  const addressValue = [city, state, country].filter(Boolean).join(", ");
  return {
    locationName,
    addressValue,
    city,
    state,
    country
  };
}

function formatAdpMyjobsLocation(job) {
  const item = job && typeof job === "object" ? job : {};
  const values = [];
  const seen = new Set();

  for (const field of ["requisitionLocations", "workLocations", "postingLocations"]) {
    const locations = Array.isArray(item?.[field]) ? item[field] : [];
    for (const locationItem of locations) {
      const { locationName, addressValue } = extractAdpMyjobsLocationParts(locationItem);
      const label = locationName && addressValue ? `${locationName} - ${addressValue}` : locationName || addressValue;
      const normalized = String(label || "").trim().toLowerCase();
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      values.push(String(label || "").trim());
    }
  }

  return values.length > 0 ? values.join(" / ") : null;
}

function parseAdpMyjobsPostingsFromApi(companyNameForPostings, config, responseJson) {
  const jobs = Array.isArray(responseJson?.jobRequisitions) ? responseJson.jobRequisitions : [];
  const postings = [];
  const seenUrls = new Set();
  const seenIds = new Set();

  for (const row of jobs) {
    const item = row && typeof row === "object" ? row : {};
    const reqId = String(item?.reqId || "").trim();
    if (reqId && seenIds.has(reqId)) continue;

    const itemUrlRaw = String(item?.url || item?.jobUrl || "").trim();
    const jobUrl = itemUrlRaw || (reqId ? `https://myjobs.adp.com/${config.companyName}/cx/job-details?reqId=${encodeURIComponent(reqId)}` : "");
    if (!jobUrl || seenUrls.has(jobUrl)) continue;

    const postingDate = String(item?.postingDate || "").trim() || null;
    const firstLocation =
      (Array.isArray(item?.requisitionLocations) && item.requisitionLocations[0]) ||
      (Array.isArray(item?.workLocations) && item.workLocations[0]) ||
      (Array.isArray(item?.postingLocations) && item.postingLocations[0]) ||
      null;
    const firstLocationParts = extractAdpMyjobsLocationParts(firstLocation);
    const departmentValues = Array.isArray(item?.organizationalUnits)
      ? item.organizationalUnits
          .map((unit) => String(unit?.nameCode?.longName || unit?.name || "").trim())
          .filter(Boolean)
      : [];

    postings.push({
      company_name: companyNameForPostings,
      source_job_id: reqId || undefined,
      id: reqId || undefined,
      position_name: String(item?.publishedJobTitle || item?.jobTitle || "").trim() || "Untitled Position",
      job_posting_url: jobUrl,
      posting_date: postingDate,
      location: formatAdpMyjobsLocation(item),
      city: firstLocationParts.city || null,
      state: firstLocationParts.state || null,
      country: firstLocationParts.country || null,
      department: departmentValues.length > 0 ? departmentValues.join(" / ") : null,
      employment_type: String(item?.type || "").trim() || null
    });
    seenUrls.add(jobUrl);
    if (reqId) {
      seenIds.add(reqId);
    }
  }

  return postings;
}

function cleanAdpWorkforcenowText(value) {
  let text = String(value || "");
  try {
    text = decodeURIComponent(text);
  } catch {
    // Keep undecoded value when malformed.
  }
  return decodeHtmlEntities(text.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function slugToAdpWorkforcenowCompanyName(slug) {
  const cleaned = String(slug || "").trim().replace(/^[-_]+|[-_]+$/g, "");
  if (!cleaned) return "";
  const normalized = cleaned
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .trim();
  if (!normalized) return "";
  return normalized
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => (part === part.toUpperCase() && part.length <= 5 ? part : part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()))
    .join(" ");
}

function extractAdpWorkforcenowCompanyName(contentLinksJson) {
  const contentLinks = Array.isArray(contentLinksJson?.contentLinks) ? contentLinksJson.contentLinks : [];

  const parseWelcomeName = (rawText) => {
    const source = cleanAdpWorkforcenowText(rawText);
    const patterns = [
      /(?:career\s+center|career\s+portal|careers?)\s+for\s+(.{2,120}?)(?:[,.]|$)/i,
      /\bfor\s+(.{2,120}?)\s+(?:career\s+center|career\s+portal|careers?\b)/i,
      /welcome\s+to\s+(?:the\s+)?(.{2,120}?)\s+(?:career\s+center|career\s+portal|careers?\b|job\s+portal)/i,
      /choose\s+a\s+career\s+at\s+(.{2,120}?)(?:[,.]|$)/i
    ];
    for (const pattern of patterns) {
      const match = source.match(pattern);
      if (!match?.[1]) continue;
      let candidate = cleanAdpWorkforcenowText(match[1]);
      candidate = candidate
        .replace(/\b(career\s+center|career\s+portal|careers?\s+portal)\b/gi, " ")
        .replace(/\s+/g, " ")
        .trim()
        .replace(/^[-:|,\s]+|[-:|,\s]+$/g, "");
      candidate = candidate.split(/\b(choose\s+a\s+career\s+at|welcome\s+to|if\s+you\s+are|where\s+|our\s+|we\s+)/i)[0]?.trim() || "";
      if (candidate && !["our", "you", "we"].includes(candidate.toLowerCase())) {
        return candidate;
      }
    }
    return "";
  };

  for (const item of contentLinks) {
    const code = String(item?.linkTypeCode?.codeValue || "").trim();
    if (code !== "WELCOME-TXT") continue;
    const parsed = parseWelcomeName(String(item?.linkTypeCode?.longName || ""));
    if (parsed) return parsed;
  }

  for (const item of contentLinks) {
    const code = String(item?.linkTypeCode?.codeValue || "").trim();
    if (code !== "LINKS-BRND") continue;
    const links = Array.isArray(item?.contentBody?.links) ? item.contentBody.links : [];
    for (const link of links) {
      const title = cleanAdpWorkforcenowText(link?.title || "");
      const href = cleanAdpWorkforcenowText(link?.href || "");
      if (title && !["careers", "career", "home", "jobs", "apply"].includes(title.toLowerCase())) {
        return title;
      }
      if (href && !href.includes("workforcenow.adp.com") && !href.includes("jobs/apply/posting.html")) {
        const hrefWithScheme = href.includes("://") ? href : `https://${href}`;
        const parsed = parseUrl(hrefWithScheme);
        const host = String(parsed?.hostname || "").replace(/^www\./i, "").toLowerCase();
        if (host) {
          const derived = slugToAdpWorkforcenowCompanyName(host.split(".")[0] || "");
          if (derived) return derived;
        }
      }
    }
  }

  for (const item of contentLinks) {
    const code = String(item?.linkTypeCode?.codeValue || "").trim();
    if (code !== "IMG_LOGO") continue;
    const body = item?.contentBody && typeof item.contentBody === "object" ? item.contentBody : {};
    const links = Array.isArray(body?.links) ? body.links : [];
    let logoTitle = "";
    for (const link of links) {
      logoTitle = cleanAdpWorkforcenowText(link?.title || "");
      if (logoTitle) break;
    }
    if (!logoTitle) {
      logoTitle = cleanAdpWorkforcenowText(body?.contentTitle || "");
    }
    logoTitle = logoTitle
      .replace(/\.(png|jpg|jpeg|gif|svg|webp)$/i, "")
      .replace(/\b(logo|careers?|career|center|portal|hris|adp|v\d+)\b/gi, " ")
      .replace(/[_-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/^[-:|,\s]+|[-:|,\s]+$/g, "");
    if (logoTitle.length >= 3) return logoTitle;
  }

  for (const item of contentLinks) {
    const links = Array.isArray(item?.contentBody?.links) ? item.contentBody.links : [];
    for (const link of links) {
      const href = cleanAdpWorkforcenowText(link?.href || "");
      if (!href.includes("jobs/apply/posting.html")) continue;
      const parsed = parseUrl(href);
      const clientSlug = String(parsed?.searchParams?.get("client") || "").trim();
      const derived = slugToAdpWorkforcenowCompanyName(clientSlug);
      if (derived) return derived;
    }
  }

  return "";
}

function normalizeAdpWorkforcenowSourceCompanyName(value) {
  const cleaned = cleanAdpWorkforcenowText(value);
  return cleaned && !isPlaceholderCompanyName(cleaned) ? cleaned : "";
}

function resolveAdpWorkforcenowCompanyName(company, config, contentLinksJson) {
  const sourceCompanyName = normalizeAdpWorkforcenowSourceCompanyName(company?.company_name);
  if (sourceCompanyName) return sourceCompanyName;

  const inferredCompanyName = normalizeAdpWorkforcenowSourceCompanyName(
    extractAdpWorkforcenowCompanyName(contentLinksJson)
  );
  if (inferredCompanyName) return inferredCompanyName;

  const ccIdCompanyName = normalizeAdpWorkforcenowSourceCompanyName(
    slugToAdpWorkforcenowCompanyName(config?.ccId)
  );
  if (ccIdCompanyName) return ccIdCompanyName;

  return "";
}

function extractAdpWorkforcenowLocation(job) {
  const item = job && typeof job === "object" ? job : {};
  const values = [];
  const seen = new Set();
  const locations = Array.isArray(item?.requisitionLocations) ? item.requisitionLocations : [];
  for (const locationItem of locations) {
    const location = locationItem && typeof locationItem === "object" ? locationItem : {};
    const nameCode = location?.nameCode && typeof location.nameCode === "object" ? location.nameCode : {};
    const label = String(nameCode?.shortName || nameCode?.longName || "").trim();
    const address = location?.address && typeof location.address === "object" ? location.address : {};
    const city = String(address?.cityName || "").trim();
    const stateData =
      address?.countrySubdivisionLevel1 && typeof address.countrySubdivisionLevel1 === "object"
        ? address.countrySubdivisionLevel1
        : {};
    const state = String(stateData?.codeValue || stateData?.longName || "").trim();
    const countryData = address?.country && typeof address.country === "object" ? address.country : {};
    const country = String(countryData?.codeValue || countryData?.longName || "").trim();
    const addressLabel = [city, state, country].filter(Boolean).join(", ");
    const combined = [label, addressLabel].filter(Boolean).join(" - ").trim();
    const normalized = combined.toLowerCase();
    if (!combined || seen.has(normalized)) continue;
    seen.add(normalized);
    values.push(combined);
  }
  return values.length > 0 ? values.join(" / ") : null;
}

function extractAdpWorkforcenowStructuredLocation(job) {
  const item = job && typeof job === "object" ? job : {};
  const locations = Array.isArray(item?.requisitionLocations) ? item.requisitionLocations : [];
  const location = locations[0] && typeof locations[0] === "object" ? locations[0] : {};
  const address = location?.address && typeof location.address === "object" ? location.address : {};
  const stateData =
    address?.countrySubdivisionLevel1 && typeof address.countrySubdivisionLevel1 === "object"
      ? address.countrySubdivisionLevel1
      : {};
  const countryData = address?.country && typeof address.country === "object" ? address.country : {};
  return {
    city: String(address?.cityName || "").trim(),
    state: String(stateData?.codeValue || stateData?.longName || "").trim(),
    country: String(countryData?.longName || countryData?.codeValue || "").trim()
  };
}

function buildAdpWorkforcenowPostingUrl(item, config) {
  const job = item && typeof item === "object" ? item : {};
  const links = Array.isArray(job?.links) ? job.links : [];
  for (const link of links) {
    const href = String(link?.href || "").trim();
    if (!href) continue;
    const absolute = parseUrl(href) ? href : new URL(href, config.boardUrl).toString();
    if (absolute) return absolute;
  }
  const itemId = String(job?.itemID || "").trim();
  if (itemId) {
    return `${config.boardUrl}&jobId=${encodeURIComponent(itemId)}`;
  }
  return config.boardUrl;
}

function parseAdpWorkforcenowPostingsFromApi(companyNameForPostings, config, responseJson) {
  const jobs = Array.isArray(responseJson?.jobRequisitions) ? responseJson.jobRequisitions : [];
  const postings = [];
  const seenUrls = new Set();
  const seenIds = new Set();
  const effectiveCompanyName =
    normalizeAdpWorkforcenowSourceCompanyName(companyNameForPostings) ||
    normalizeAdpWorkforcenowSourceCompanyName(slugToAdpWorkforcenowCompanyName(config?.ccId));

  for (const row of jobs) {
    const item = row && typeof row === "object" ? row : {};
    const itemId = String(item?.itemID || "").trim();
    if (itemId && seenIds.has(itemId)) continue;

    const jobUrl = buildAdpWorkforcenowPostingUrl(item, config);
    if (!jobUrl || seenUrls.has(jobUrl)) continue;
    const structuredLocation = extractAdpWorkforcenowStructuredLocation(item);

    postings.push({
      company_name: effectiveCompanyName,
      source_job_id: itemId || undefined,
      id: itemId || undefined,
      position_name: String(item?.requisitionTitle || "").trim() || "Untitled Position",
      job_posting_url: jobUrl,
      posting_date: String(item?.postDate || "").trim() || null,
      location: extractAdpWorkforcenowLocation(item),
      city: structuredLocation.city || null,
      state: structuredLocation.state || null,
      country: structuredLocation.country || null,
      employment_type: String(item?.workLevelCode?.shortName || "").trim() || null,
      department: null
    });
    seenUrls.add(jobUrl);
    if (itemId) seenIds.add(itemId);
  }

  return postings;
}

function cleanBrassringText(value) {
  return decodeHtmlEntities(String(value || "").replace(/<[^>]+>/g, " "))
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractBrassringHiddenInput(pageHtml, fieldName) {
  const source = String(pageHtml || "");
  const match = source.match(
    new RegExp(`name=["']${String(fieldName || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["'][^>]*value=["']([^"']*)["']`, "i")
  );
  return cleanBrassringText(match?.[1] || "");
}

function extractBrassringCompanyName(pageHtml) {
  const source = decodeHtmlEntities(String(pageHtml || ""));
  const partnerNameMatch = source.match(/["']PartnerName["']\s*:\s*["']([^"']+)["']/i);
  if (partnerNameMatch?.[1]) return cleanBrassringText(partnerNameMatch[1]) || "Unknown Company";

  const titleMatch = source.match(/Search\s+Jobs\s+at\s*\|\s*([^<\r\n]+)/i);
  if (titleMatch?.[1]) return cleanBrassringText(titleMatch[1]) || "Unknown Company";

  return "Unknown Company";
}

function extractBrassringQuestionValue(item, questionName) {
  const questions = Array.isArray(item?.Questions) ? item.Questions : [];
  const normalizedQuestionName = String(questionName || "").trim().toLowerCase();
  for (const question of questions) {
    if (!question || typeof question !== "object") continue;
    const currentName = String(question?.QuestionName || "").trim().toLowerCase();
    if (currentName !== normalizedQuestionName) continue;
    return cleanBrassringText(question?.Value || "");
  }
  return "";
}

function extractBrassringLocation(item) {
  const directLocation = extractBrassringQuestionValue(item, "location");
  if (directLocation) return directLocation;

  const city = extractBrassringQuestionValue(item, "city");
  const state = extractBrassringQuestionValue(item, "state");
  const country = extractBrassringQuestionValue(item, "country");
  const combinedLocation = [city, state, country].filter(Boolean).join(", ");
  if (combinedLocation) return combinedLocation;

  const latitude = extractBrassringQuestionValue(item, "latitude");
  const longitude = extractBrassringQuestionValue(item, "longitude");
  if (latitude && longitude) return `${latitude},${longitude}`;
  return null;
}

function buildBrassringPostingUrl(config, item) {
  const itemUrl = cleanBrassringText(item?.Link || "");
  if (itemUrl) return itemUrl;

  const reqId = extractBrassringQuestionValue(item, "reqid");
  if (!reqId) return config.boardUrl;
  return (
    "https://sjobs.brassring.com/TGnewUI/Search/home/HomeWithPreLoad?" +
    `partnerid=${encodeURIComponent(config.partnerId)}&siteid=${encodeURIComponent(config.siteId)}` +
    `&PageType=JobDetails&jobid=${encodeURIComponent(reqId)}`
  );
}

function parseBrassringPostingsFromApi(companyNameForPostings, config, responseJson) {
  const jobs = Array.isArray(responseJson?.Jobs?.Job) ? responseJson.Jobs.Job : [];
  const postings = [];
  const seenUrls = new Set();
  const seenIds = new Set();

  for (const row of jobs) {
    const item = row && typeof row === "object" ? row : {};
    const reqId = extractBrassringQuestionValue(item, "reqid");
    if (reqId && seenIds.has(reqId)) continue;

    const jobUrl = buildBrassringPostingUrl(config, item);
    if (!jobUrl || seenUrls.has(jobUrl)) continue;

    postings.push({
      company_name: companyNameForPostings,
      source_job_id: reqId || undefined,
      id: reqId || undefined,
      position_name: extractBrassringQuestionValue(item, "jobtitle") || "Untitled Position",
      job_posting_url: jobUrl,
      posting_date: extractBrassringQuestionValue(item, "lastupdated") || null,
      location: extractBrassringLocation(item),
      department: extractBrassringQuestionValue(item, "department") || null
    });
    seenUrls.add(jobUrl);
    if (reqId) seenIds.add(reqId);
  }

  return postings;
}

function formatPinpointHqLocation(locationValue) {
  const location = locationValue && typeof locationValue === "object" ? locationValue : {};
  const city = String(location?.city || "").trim();
  const province = String(location?.province || "").trim();
  const countryOrName = String(location?.name || "").trim();
  const parts = [city, province, countryOrName].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : null;
}

function parsePinpointHqPostingsFromApi(companyNameForPostings, config, responseJson) {
  const data = Array.isArray(responseJson?.data) ? responseJson.data : [];
  const postings = [];
  const seenUrls = new Set();

  for (const row of data) {
    const item = row && typeof row === "object" ? row : {};
    const itemUrlRaw = String(item?.url || "").trim();
    const itemPathRaw = String(item?.path || "").trim();
    const jobUrl = itemUrlRaw
      ? itemUrlRaw
      : itemPathRaw
        ? new URL(itemPathRaw, `${config.baseOrigin || config.boardUrl || ""}/`).toString()
        : "";
    if (!jobUrl || seenUrls.has(jobUrl)) continue;

    const postingDate =
      String(item?.posted_at || item?.published_at || item?.created_at || item?.updated_at || item?.deadline_at || "").trim() ||
      null;
    const department = String(item?.job?.department?.name || "").trim() || null;

    postings.push({
      company_name: companyNameForPostings,
      source_job_id:
        String(item?.id ?? item?.uuid ?? item?.job_id ?? item?.jobId ?? "").trim() ||
        extractSourceIdFromPostingUrl(jobUrl, "pinpointhq"),
      id: String(item?.id ?? item?.uuid ?? "").trim() || undefined,
      position_name: String(item?.title || "").trim() || "Untitled Position",
      job_posting_url: jobUrl,
      posting_date: postingDate,
      location: formatPinpointHqLocation(item?.location),
      department,
      employment_type: String(item?.employment_type_text || item?.employment_type || "").trim() || null,
      workplace_type: String(item?.workplace_type_text || item?.workplace_type || "").trim() || null
    });
    seenUrls.add(jobUrl);
  }

  return postings;
}

function formatRecruitCrmLocation(item) {
  const parts = extractRecruitCrmLocationParts(item);
  if (parts.locationText) return parts.locationText;
  const values = [parts.city, parts.locality, parts.state, parts.country, parts.postalCode].filter(Boolean);
  return values.length > 0 ? values.join(", ") : null;
}

function recruitCrmLocationObject(item = {}) {
  const candidates = [
    item?.location,
    item?.job_location,
    item?.jobLocation,
    item?.job_location_data,
    item?.work_location,
    item?.workLocation,
    item?.address
  ];
  for (const candidate of candidates) {
    if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) return candidate;
  }
  return {};
}

function recruitCrmLocationText(item = {}) {
  const direct = [
    item?.location,
    item?.job_location,
    item?.jobLocation,
    item?.location_name,
    item?.locationName,
    item?.work_location,
    item?.workLocation,
    item?.address
  ].find((value) => typeof value === "string" && value.trim());
  if (direct) return String(direct).trim();

  const location = recruitCrmLocationObject(item);
  return String(
    location?.name ||
      location?.label ||
      location?.display_name ||
      location?.displayName ||
      location?.formatted_address ||
      location?.formattedAddress ||
      location?.address ||
      ""
  ).trim();
}

function extractRecruitCrmLocationParts(item = {}) {
  const location = recruitCrmLocationObject(item);
  const city = String(item?.city || location?.city || location?.city_name || location?.cityName || "").trim();
  const locality = String(item?.locality || location?.locality || location?.suburb || "").trim();
  const state = String(
    item?.state ||
      item?.province ||
      item?.region ||
      item?.state_name ||
      location?.state ||
      location?.province ||
      location?.region ||
      location?.state_name ||
      location?.stateName ||
      ""
  ).trim();
  const country = String(
    item?.country ||
      item?.country_name ||
      item?.countryCode ||
      item?.country_code ||
      location?.country ||
      location?.country_name ||
      location?.countryName ||
      location?.countryCode ||
      location?.country_code ||
      ""
  ).trim();
  const postalCode = String(item?.postalcode || item?.postal_code || location?.postalcode || location?.postal_code || "").trim();
  const locationText = recruitCrmLocationText(item);
  return {
    city,
    locality,
    state,
    country,
    postalCode,
    locationText
  };
}

function normalizeRecruitCrmJobUrl(config = {}, itemUrlRaw, slug) {
  const publicJobsUrl = String(config.publicJobsUrl || "").replace(/\/+$/, "");
  const rawUrl = String(itemUrlRaw || "").trim();
  if (rawUrl) {
    const parsed = parseUrl(rawUrl);
    if (parsed?.protocol && parsed?.host) return parsed.toString();
    if (publicJobsUrl && rawUrl.startsWith("/")) {
      try {
        return new URL(rawUrl, `${publicJobsUrl}/`).toString();
      } catch {
        // Fall through to slug fallback.
      }
    }
  }
  const stableSlug = String(slug || "").trim();
  return publicJobsUrl && stableSlug ? `${publicJobsUrl}/${encodeURIComponent(stableSlug)}` : "";
}

function normalizeRecruitCrmRemoteType(item = {}) {
  const rawRemote = String(item?.remote ?? item?.is_remote ?? item?.isRemote ?? "").trim().toLowerCase();
  if (["1", "true", "yes", "remote"].includes(rawRemote)) return "remote";
  if (["0", "false", "no", "onsite", "on-site", "non-remote"].includes(rawRemote)) return "onsite";

  const workplaceType = String(item?.workplace_type || item?.workplaceType || item?.workplace_type_text || "").trim().toLowerCase();
  if (["remote", "hybrid", "onsite", "on-site"].includes(workplaceType)) {
    return workplaceType === "on-site" ? "onsite" : workplaceType;
  }
  return "";
}

function extractRecruitCrmJobs(responseJson) {
  const data = responseJson?.data;
  const candidates = [
    data?.jobs,
    data?.records,
    data?.items,
    data?.jobs?.data,
    data?.result?.jobs,
    responseJson?.jobs,
    responseJson?.records,
    responseJson?.items,
    responseJson?.result?.jobs,
    data
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
  }
  return [];
}

function isRecruitCrmPlaceholderTitle(value) {
  return /^(untitled|unknown|n\/?a|not available|job opening|new job|open position|position)$/i.test(
    String(value || "").replace(/\s+/g, " ").trim()
  );
}

function parseRecruitCrmPostingsFromApi(companyNameForPostings, config, responseJson) {
  const jobs = extractRecruitCrmJobs(responseJson);
  const postings = [];
  const seenUrls = new Set();

  for (const row of jobs) {
    const item = row && typeof row === "object" ? row : {};
    const slug = String(item?.slug || "").trim();
    const itemUrlRaw = String(item?.url || item?.job_url || item?.jobUrl || item?.public_url || item?.publicUrl || item?.apply_url || item?.applyUrl || "").trim();
    const itemUrl = normalizeRecruitCrmJobUrl(config, itemUrlRaw, slug);
    if (!itemUrl || seenUrls.has(itemUrl)) continue;

    const postingDate =
      String(
        item?.posted_at ||
          item?.published_at ||
          item?.publishedAt ||
          item?.postedAt ||
          item?.created_at ||
          item?.createdAt ||
          item?.updated_at ||
          item?.updatedAt ||
          item?.createdon ||
          item?.updatedon ||
          ""
      ).trim() || null;
    const remoteType = normalizeRecruitCrmRemoteType(item);
    const locationParts = extractRecruitCrmLocationParts(item);
    const sourceCountry = locationParts.country;
    const sourceCity = locationParts.city;
    const sourceState = locationParts.state;
    const sourceLocality = locationParts.locality;
    const sourcePostalCode = locationParts.postalCode;
    const formattedLocation = formatRecruitCrmLocation(item);
    const hasStructuredGeo = Boolean(sourceCity || sourceLocality || sourceState || sourceCountry || sourcePostalCode);
    const sourceFailureReasons = [];
    if (remoteType === "onsite" && !hasStructuredGeo && !formattedLocation) {
      sourceFailureReasons.push("no_structured_location");
    }
    const sourceJobId =
      String(item?.id ?? item?.job_id ?? item?.jobId ?? item?.uuid ?? item?.jobcode ?? item?.job_code ?? item?.code ?? slug).trim() ||
      extractSourceIdFromPostingUrl(itemUrl, "recruitcrm");
    const rawTitle = String(item?.name || item?.job_title || item?.jobTitle || item?.title || "").trim();

    postings.push({
      company_name: companyNameForPostings,
      source_job_id: sourceJobId,
      id: String(item?.id ?? item?.job_id ?? item?.jobId ?? "").trim() || undefined,
      position_name: rawTitle && !isRecruitCrmPlaceholderTitle(rawTitle) ? rawTitle : "Untitled Position",
      job_posting_url: itemUrl,
      posting_date: postingDate,
      location: remoteType === "remote" ? "Remote" : formattedLocation,
      city: sourceCity || null,
      state: sourceState || null,
      country: normalizeCountryName(sourceCountry) ||
        normalizeCountryFromLocation(sourceCountry) ||
        normalizeCountryFromLocation(formattedLocation) ||
        null,
      remote_type: remoteType || null,
      employment_type: String(item?.employment_type || item?.job_type || item?.jobType || "").trim() || null,
      department: String(item?.department?.name || item?.department || item?.team?.name || item?.team || "").trim() || null,
      source_evidence: {
        route_kind: "recruitcrm_jobs_api",
        location_source: formattedLocation ? "list_api" : "",
        location_path: formattedLocation ? "location/job_location/city/state/country" : "",
        remote_source: remoteType ? "list_api" : "",
        remote_path: remoteType ? "remote/workplace_type" : "",
        posting_date_source: postingDate ? "list_api" : "",
        posting_date_path: postingDate ? "posted_at/published_at/created_at/updated_at" : ""
      },
      source_failure_reasons: sourceFailureReasons
    });
    seenUrls.add(itemUrl);
  }

  return postings;
}

function formatRipplingLocation(locationsValue) {
  const locations = Array.isArray(locationsValue) ? locationsValue : [];
  const values = [];
  const seen = new Set();

  for (const location of locations) {
    const item = location && typeof location === "object" ? location : {};
    const name = String(item?.name || "").trim();
    const city = String(item?.city || "").trim();
    const state = String(item?.state || item?.stateCode || "").trim();
    const country = String(item?.country || "").trim();
    const fallback = [city, state, country].filter(Boolean).join(", ");
    const label = name || fallback;
    const normalized = label.toLowerCase();
    if (!label || seen.has(normalized)) continue;
    seen.add(normalized);
    values.push(label);
  }

  return values.length > 0 ? values.join(" / ") : null;
}

function parseRipplingPostingsFromApi(companyNameForPostings, config, responseJson) {
  const items = Array.isArray(responseJson?.items) ? responseJson.items : [];
  const postings = [];
  const seenUrls = new Set();

  for (const row of items) {
    const item = row && typeof row === "object" ? row : {};
    const postingId = String(item?.id || "").trim();
    const itemUrlRaw = String(item?.url || "").trim();
    const jobUrl = itemUrlRaw || (postingId ? `${config.boardUrl}/${postingId}` : "");
    if (!jobUrl || seenUrls.has(jobUrl)) continue;

    const postingDate =
      String(item?.postedAt || item?.createdAt || item?.updatedAt || item?.publishedAt || "").trim() || null;
    const department = String(item?.department?.name || "").trim() || null;

    postings.push({
      company_name: companyNameForPostings,
      position_name: String(item?.name || "").trim() || "Untitled Position",
      job_posting_url: jobUrl,
      posting_date: postingDate,
      location: formatRipplingLocation(item?.locations),
      department,
      employment_type: String(item?.employmentType || item?.employment_type || "").trim() || null,
      workplace_type: String(item?.workplaceType || item?.workplace_type || "").trim() || null,
      language: String(item?.language || "").trim() || null
    });
    seenUrls.add(jobUrl);
  }

  return postings;
}

function parseTalexioPostingsFromApi(companyNameForPostings, config, responseJson) {
  const vacancies = Array.isArray(responseJson?.vacancies) ? responseJson.vacancies : [];
  const postings = [];
  const seenUrls = new Set();

  for (const vacancy of vacancies) {
    const item = vacancy && typeof vacancy === "object" ? vacancy : {};
    const vacancyId = String(item?.id || "").trim();
    const itemUrlRaw = String(item?.url || item?.jobUrl || item?.vacancyUrl || item?.applyUrl || "").trim();
    const itemUrl = itemUrlRaw
      ? new URL(itemUrlRaw, `${config.baseOrigin || config.jobsUrl || ""}/`).toString()
      : vacancyId
        ? `${config.jobsUrl}?vacancyId=${encodeURIComponent(vacancyId)}`
        : "";
    if (!itemUrl || seenUrls.has(itemUrl)) continue;

    const workLocation = String(item?.workLocation || "").trim();
    const country = String(item?.country || "").trim();
    const location = [workLocation, country].filter(Boolean).join(", ");
    const postingDate = String(item?.publishDate || "").trim() || null;

    postings.push({
      company_name: companyNameForPostings,
      position_name: String(item?.title || "").trim() || "Untitled Position",
      job_posting_url: itemUrl,
      posting_date: postingDate,
      location: location || null,
      reference: String(item?.reference || "").trim() || null,
      department: String(item?.department || "").trim() || null,
      employment_type: String(item?.jobType || "").trim() || null
    });
    seenUrls.add(itemUrl);
  }

  return postings;
}

function cleanSapHrCloudText(value) {
  if (value && typeof value === "object") {
    return cleanSapHrCloudText(
      value.value ||
        value.label ||
        value.name ||
        value.defaultValue ||
        value.localizedValue ||
        value.externalName ||
        ""
    );
  }
  return decodeHtmlEntities(String(value || "").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .replace(/\s*,\s*/g, ", ")
    .trim();
}

function firstSapHrCloudTextValue(value) {
  if (Array.isArray(value)) {
    for (const entry of value) {
      const cleaned = cleanSapHrCloudText(entry);
      if (cleaned) return cleaned;
    }
    return "";
  }
  return cleanSapHrCloudText(value);
}

function buildSapHrCloudJobUrl(config, item = {}, locale = "en_US") {
  const id = cleanSapHrCloudText(item?.id || "");
  if (!id) return "";

  const slugSourceRaw =
    cleanSapHrCloudText(item?.unifiedUrlTitle || "") ||
    cleanSapHrCloudText(item?.urlTitle || "") ||
    cleanSapHrCloudText(item?.unifiedStandardTitle || "") ||
    "untitled";
  let slugSource = slugSourceRaw;
  try {
    slugSource = decodeURIComponent(slugSourceRaw);
  } catch {
    slugSource = slugSourceRaw;
  }
  const slug = encodeURIComponent(
    String(slugSource || "")
      .replace(/[\\/]+/g, "-")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") || "untitled"
  );
  const localeValue = String(locale || config?.localeFromUrl || "en_US").trim() || "en_US";
  return `${config.baseOrigin}/job/${slug}/${encodeURIComponent(id)}-${encodeURIComponent(localeValue)}`;
}

function parseSapHrCloudPostingsFromApi(companyNameForPostings, config, responseJson, locale = "en_US") {
  const jobSearchResult = Array.isArray(responseJson?.jobSearchResult) ? responseJson.jobSearchResult : [];
  const postings = [];
  const seenUrls = new Set();

  for (const rawItem of jobSearchResult) {
    const item =
      rawItem && typeof rawItem === "object"
        ? rawItem.response && typeof rawItem.response === "object"
          ? rawItem.response
          : rawItem
        : {};

    const absoluteUrlRaw = String(item?.jobUrl || item?.url || item?.applyUrl || "").trim();
    const jobUrl = absoluteUrlRaw
      ? new URL(absoluteUrlRaw, `${config.baseOrigin}/`).toString()
      : buildSapHrCloudJobUrl(config, item, locale);
    if (!jobUrl || seenUrls.has(jobUrl)) continue;

    const locationFromCoordinates = Array.isArray(item?.jobLocationShortWithCoordinates)
      ? firstSapHrCloudTextValue(item.jobLocationShortWithCoordinates.map((entry) => entry?.value))
      : "";
    const location =
      firstSapHrCloudTextValue(item?.jobLocationShort) ||
      locationFromCoordinates ||
      firstSapHrCloudTextValue(item?.jobLocationState) ||
      firstSapHrCloudTextValue(item?.jobLocationCountry) ||
      null;
    const department =
      firstSapHrCloudTextValue(item?.filter8) ||
      firstSapHrCloudTextValue(item?.filter2) ||
      firstSapHrCloudTextValue(item?.businessUnit_obj) ||
      null;
    const postingDate =
      cleanSapHrCloudText(
        item?.unifiedStandardStart || item?.postedDate || item?.publishDate || item?.startDate || ""
      ) || null;

    postings.push({
      company_name: companyNameForPostings,
      source_job_id: cleanSapHrCloudText(item?.id || "") || undefined,
      id: cleanSapHrCloudText(item?.id || "") || undefined,
      position_name:
        cleanSapHrCloudText(item?.unifiedStandardTitle || item?.title || item?.urlTitle || "") || "Untitled Position",
      job_posting_url: jobUrl,
      posting_date: postingDate,
      location,
      department
    });
    seenUrls.add(jobUrl);
  }

  return postings;
}

function parseSapHrCloudPostingsFromHtml(companyNameForPostings, config, pageHtml, finalUrl = "") {
  const sourceHtml = String(pageHtml || "");
  if (!sourceHtml) return [];

  const postings = [];
  const seenUrls = new Set();
  const baseForUrls = String(finalUrl || config?.baseOrigin || "").trim() || String(config?.baseOrigin || "").trim();
  if (!baseForUrls) return [];

  const titleLinkPattern = /<a[^>]*class="[^"]*\bjobTitle-link\b[^"]*"[^>]*href="(?<href>[^"]+)"[^>]*>(?<title>[\s\S]*?)<\/a>/gi;

  for (const match of sourceHtml.matchAll(titleLinkPattern)) {
    const href = cleanSapHrCloudText(match?.groups?.href || "");
    const title = cleanSapHrCloudText(match?.groups?.title || "") || "Untitled Position";
    if (!href) continue;

    let jobUrl = "";
    try {
      jobUrl = new URL(href, baseForUrls).toString();
    } catch {
      jobUrl = "";
    }
    if (!jobUrl || seenUrls.has(jobUrl)) continue;

    const startIndex = Math.max(0, Number(match.index || 0) - 600);
    const endIndex = Math.min(sourceHtml.length, Number(match.index || 0) + String(match[0] || "").length + 1500);
    const context = sourceHtml.slice(startIndex, endIndex);

    const locationMatch =
      context.match(
        /<(?:span|div)[^>]*class="[^"]*\bjobLocation\b[^"]*"[^>]*>(?<value>[\s\S]*?)<\/(?:span|div)>/i
      ) ||
      context.match(/<div[^>]*id="job-\d+-desktop-section-city-value"[^>]*>(?<value>[\s\S]*?)<\/div>/i);
    const dateMatch = context.match(/<span[^>]*class="[^"]*\bjobDate\b[^"]*"[^>]*>(?<value>[\s\S]*?)<\/span>/i);
    const departmentMatch = context.match(
      /<span[^>]*class="[^"]*\bjobDepartment\b[^"]*"[^>]*>(?<value>[\s\S]*?)<\/span>/i
    );

    const location = cleanSapHrCloudText(locationMatch?.groups?.value || "") || null;
    const postingDate = cleanSapHrCloudText(dateMatch?.groups?.value || "") || null;
    const department = cleanSapHrCloudText(departmentMatch?.groups?.value || "") || null;

    postings.push({
      company_name: companyNameForPostings,
      position_name: title,
      job_posting_url: jobUrl,
      posting_date: postingDate,
      location,
      department
    });
    seenUrls.add(jobUrl);
  }

  return postings;
}

function decodeBase64Utf8(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    return Buffer.from(raw, "base64").toString("utf8");
  } catch {
    return "";
  }
}

function extractGemNumericJobId(rawId) {
  const direct = String(rawId || "").trim();
  if (/^\d+$/.test(direct)) return direct;

  const decoded = decodeBase64Utf8(direct);
  const match = decoded.match(/:(\d{2,})$/);
  return String(match?.[1] || "").trim();
}

function buildGemJobPostingUrl(config, posting) {
  const boardUrl = String(config?.boardUrl || "").replace(/\/+$/, "");
  const item = posting && typeof posting === "object" ? posting : {};
  const numericId = extractGemNumericJobId(item?.id);
  const extId = String(item?.extId || "").trim();
  const fallbackId = String(item?.id || "").trim();
  const identifier = numericId || extId || fallbackId;
  if (!boardUrl || !identifier) return boardUrl || "";
  return `${boardUrl}/${encodeURIComponent(identifier)}`;
}

function extractGemLocationLabel(posting) {
  const item = posting && typeof posting === "object" ? posting : {};
  const locations = Array.isArray(item?.locations) ? item.locations : [];
  const values = [];
  const seen = new Set();

  for (const location of locations) {
    const source = location && typeof location === "object" ? location : {};
    const name = String(source?.name || "").trim();
    const city = String(source?.city || "").trim();
    const country = String(source?.isoCountry || "").trim();
    const label = name || [city, country].filter(Boolean).join(", ");
    const normalized = label.toLowerCase();
    if (!label || seen.has(normalized)) continue;
    seen.add(normalized);
    values.push(label);
  }

  if (values.length > 0) return values.join(" / ");

  const locationType = String(item?.job?.locationType || "").trim().toUpperCase();
  if (locationType.includes("REMOTE")) return "Remote";
  return null;
}

function parseGemPostingsFromBatchResponse(companyNameForPostings, config, responseJson) {
  const payload = Array.isArray(responseJson) ? responseJson : [];
  let jobPostings = [];
  for (const item of payload) {
    const data = item && typeof item === "object" ? item.data : null;
    const external = data && typeof data === "object" ? data.oatsExternalJobPostings : null;
    const postings = external && typeof external === "object" ? external.jobPostings : null;
    if (!Array.isArray(postings)) continue;
    jobPostings = postings;
    break;
  }

  const collected = [];
  const seenUrls = new Set();

  for (const posting of jobPostings) {
    const item = posting && typeof posting === "object" ? posting : {};
    const postingUrl = buildGemJobPostingUrl(config, item);
    if (!postingUrl || seenUrls.has(postingUrl)) continue;

    const department = String(item?.job?.department?.name || "").trim();
    collected.push({
      company_name: companyNameForPostings,
      position_name: String(item?.title || "").trim() || "Untitled Position",
      job_posting_url: postingUrl,
      posting_date: null,
      location: extractGemLocationLabel(item),
      department: department || null
    });
    seenUrls.add(postingUrl);
  }

  return collected;
}

function cleanJobApsText(value) {
  return decodeHtmlEntities(String(value || "").replace(/<[^>]+>/g, " "))
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\s*,\s*/g, ", ")
    .trim();
}

function parseJobApsPostingsFromHtml(companyNameForPostings, _config, pageHtml, baseUrl) {
  const source = String(pageHtml || "");
  const postings = [];
  const seenUrls = new Set();
  const ignoredTitles = new Set(["application-on-file", "application on-file", "application on file", "applicant profile"]);

  const rowPattern = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  const titleLinkPattern =
    /<a[^>]*href=['"]([^'"]+)['"][^>]*class=['"][^'"]*\bJobTitle\b[^'"]*['"][^>]*>([\s\S]*?)<\/a>/i;
  const jobNumPattern =
    /<a[^>]*href=['"]([^'"]+)['"][^>]*class=['"][^'"]*\bJobNum\b[^'"]*['"][^>]*>([\s\S]*?)<\/a>/i;
  const locationPattern = /<td[^>]*class=['"][^'"]*\bLocs\b[^'"]*['"][^>]*>([\s\S]*?)<\/td>/i;
  const departmentPattern = /<td[^>]*class=['"][^'"]*\bDept\b[^'"]*['"][^>]*>([\s\S]*?)<\/td>/i;
  const salaryPattern = /<td[^>]*class=['"][^'"]*\bSalary\b[^'"]*['"][^>]*>([\s\S]*?)<\/td>/i;

  let rowMatch = rowPattern.exec(source);
  while (rowMatch) {
    const rowHtml = String(rowMatch[1] || "");
    const titleMatch = rowHtml.match(titleLinkPattern);
    if (!titleMatch?.[1]) {
      rowMatch = rowPattern.exec(source);
      continue;
    }

    const href = decodeHtmlEntities(String(titleMatch[1] || "").trim());
    const title = cleanJobApsText(titleMatch[2] || "") || "Untitled Position";
    if (!href) {
      rowMatch = rowPattern.exec(source);
      continue;
    }
    if (href.toLowerCase().includes("r1=af")) {
      rowMatch = rowPattern.exec(source);
      continue;
    }
    if (ignoredTitles.has(title.toLowerCase())) {
      rowMatch = rowPattern.exec(source);
      continue;
    }

    const jobNumValue = cleanJobApsText(rowHtml.match(jobNumPattern)?.[2] || "");
    if (!jobNumValue || jobNumValue.toLowerCase() === "update at any time") {
      rowMatch = rowPattern.exec(source);
      continue;
    }

    let absoluteUrl = "";
    try {
      absoluteUrl = new URL(href, String(baseUrl || "")).toString();
    } catch {
      rowMatch = rowPattern.exec(source);
      continue;
    }
    if (!absoluteUrl || seenUrls.has(absoluteUrl)) {
      rowMatch = rowPattern.exec(source);
      continue;
    }

    const location = cleanJobApsText(rowHtml.match(locationPattern)?.[1] || "");
    const department = cleanJobApsText(rowHtml.match(departmentPattern)?.[1] || "");
    const salary = cleanJobApsText(rowHtml.match(salaryPattern)?.[1] || "");

    postings.push({
      company_name: companyNameForPostings,
      position_name: title,
      job_posting_url: absoluteUrl,
      posting_date: null,
      location: location || null,
      department: department || null,
      salary: salary || null,
      external_id: jobNumValue || null
    });
    seenUrls.add(absoluteUrl);
    rowMatch = rowPattern.exec(source);
  }

  return postings;
}

function extractJoinNextDataJsonFromHtml(pageHtml) {
  const source = String(pageHtml || "");
  const match = source.match(
    /<script[^>]*id=["']__NEXT_DATA__["'][^>]*>\s*(\{[\s\S]*?\})\s*<\/script>/i
  );
  if (!match?.[1]) return {};
  try {
    return JSON.parse(String(match[1] || "").trim());
  } catch {
    return {};
  }
}

function cleanJoinText(value) {
  return decodeHtmlEntities(String(value || ""))
    .replace(/\s+/g, " ")
    .replace(/\s*,\s*/g, ", ")
    .trim();
}

function buildJoinJobUrl(companySlug, idParam) {
  const slug = cleanJoinText(companySlug);
  const jobIdParam = cleanJoinText(idParam);
  if (!slug || !jobIdParam) return "";
  return `https://join.com/companies/${encodeURIComponent(slug)}/${encodeURIComponent(jobIdParam)}`;
}

function parseJoinPostingsFromNextData(companyNameForPostings, companySlug, nextData) {
  const props = nextData && typeof nextData === "object" ? nextData.props : {};
  const pageProps = props && typeof props === "object" ? props.pageProps : {};
  const initialState = pageProps && typeof pageProps === "object" ? pageProps.initialState : {};
  const jobsState = initialState && typeof initialState === "object" ? initialState.jobs : {};
  const items = Array.isArray(jobsState?.items) ? jobsState.items : [];

  const postings = [];
  const seenUrls = new Set();

  for (const job of items) {
    const item = job && typeof job === "object" ? job : {};
    const idParam = cleanJoinText(item?.idParam || "");
    const postingUrl = buildJoinJobUrl(companySlug, idParam);
    if (!postingUrl || seenUrls.has(postingUrl)) continue;

    const city = item?.city && typeof item.city === "object" ? item.city : {};
    const cityName = cleanJoinText(city?.cityName || "");
    const countryName = cleanJoinText(city?.countryName || "");
    const locationParts = [cityName, countryName].filter(Boolean);
    let location = locationParts.join(", ");

    const workplaceType = cleanJoinText(item?.workplaceType || "");
    const remoteType = cleanJoinText(item?.remoteType || "");
    if (!location && workplaceType.toUpperCase() === "REMOTE") {
      location = "Remote";
    } else if (!location && remoteType) {
      location = remoteType;
    }

    const category = item?.category && typeof item.category === "object" ? item.category : {};
    const employmentType = item?.employmentType && typeof item.employmentType === "object" ? item.employmentType : {};

    postings.push({
      company_name: companyNameForPostings,
      position_name: cleanJoinText(item?.title || "") || "Untitled Position",
      job_posting_url: postingUrl,
      posting_date: cleanJoinText(item?.createdAt || "") || null,
      location: location || null,
      department: cleanJoinText(category?.name || "") || null,
      employment_type: cleanJoinText(employmentType?.name || "") || null
    });
    seenUrls.add(postingUrl);
  }

  return postings;
}

function extractTalentreefAliasData(aliasResponse) {
  if (!Array.isArray(aliasResponse) || aliasResponse.length === 0) return { clientId: "", brand: "" };
  const firstItem = aliasResponse[0];
  if (!firstItem || typeof firstItem !== "object") return { clientId: "", brand: "" };

  let clientId = "";
  const clients = Array.isArray(firstItem?.clients) ? firstItem.clients : [];
  if (clients.length > 0 && clients[0] && typeof clients[0] === "object") {
    clientId = String(clients[0]?.legacyClientId || clients[0]?.clientId || "").trim();
  }
  if (!clientId) {
    clientId = String(firstItem?.clientId || "").trim();
  }

  let brand = "";
  const brands = Array.isArray(firstItem?.brands) ? firstItem.brands : [];
  if (brands.length > 0) {
    const firstBrand = brands[0];
    if (firstBrand && typeof firstBrand === "object") {
      brand = String(firstBrand?.name || firstBrand?.brand || firstBrand?.title || "").trim();
    } else {
      brand = String(firstBrand || "").trim();
    }
  }
  if (!brand) {
    brand = String(firstItem?.brand || "").trim();
  }

  return { clientId, brand };
}

function buildTalentreefSearchPayload(clientId, brand = "", from = 0, size = 100) {
  const filters = [
    {
      terms: {
        "clientId.raw": [String(clientId || "").trim()]
      }
    }
  ];

  const normalizedBrand = String(brand || "").trim();
  if (normalizedBrand) {
    filters.push({
      terms: {
        "brand.raw": [normalizedBrand]
      }
    });
  }

  return {
    from: Number(from || 0),
    size: Number(size || 100),
    query: {
      bool: {
        filter: filters
      }
    },
    sort: [
      {
        jobId: {
          order: "desc"
        }
      }
    ]
  };
}

function parseTalentreefPostingsFromSearchResponse(companyNameForPostings, config, responseJson) {
  const hits = Array.isArray(responseJson?.hits?.hits) ? responseJson.hits.hits : [];
  const postings = [];
  const seenUrls = new Set();

  for (const hit of hits) {
    const source = hit && typeof hit === "object" && hit._source && typeof hit._source === "object" ? hit._source : {};
    const rawUrl = String(source?.url || "").trim();
    let postingUrl = "";
    try {
      postingUrl = rawUrl ? new URL(rawUrl, `${String(config?.baseOrigin || "").replace(/\/+$/, "")}/`).toString() : "";
    } catch {
      postingUrl = "";
    }
    if (!postingUrl || seenUrls.has(postingUrl)) continue;

    const address = source?.address && typeof source.address === "object" ? source.address : {};
    const city = String(address?.city || "").trim();
    const state = String(source?.stateOrProvinceFull || source?.stateOrProvince || "").trim();
    const location = [city, state].filter(Boolean).join(", ");
    const department = String(source?.department?.name || source?.category || "").trim();
    const postingDate = String(source?.createdDate || source?.startDate || source?.updatedDate || "").trim() || null;
    const sourceJobId =
      String(source?.jobId || source?.id || hit?._id || "").trim() ||
      extractSourceIdFromPostingUrl(postingUrl, "talentreef");

    postings.push({
      company_name: companyNameForPostings,
      source_job_id: sourceJobId,
      id: sourceJobId || undefined,
      position_name: String(source?.title || source?.positionType || "").trim() || "Untitled Position",
      job_posting_url: postingUrl,
      posting_date: postingDate,
      location: location || null,
      department: department || null,
      employment_type: String(source?.contractType || "").trim() || null
    });
    seenUrls.add(postingUrl);
  }

  return postings;
}

function extractGetroNextDataJsonFromHtml(pageHtml) {
  const source = String(pageHtml || "");
  const match = source.match(
    /<script[^>]*id=["']__NEXT_DATA__["'][^>]*>\s*(\{[\s\S]*?\})\s*<\/script>/i
  );
  if (!match?.[1]) return {};
  try {
    return JSON.parse(String(match[1] || "").trim());
  } catch {
    return {};
  }
}

function parseGetroPostingsFromHtml(companyNameForPostings, _config, pageHtml) {
  const nextData = extractGetroNextDataJsonFromHtml(pageHtml);
  const pageProps = nextData?.props?.pageProps && typeof nextData.props.pageProps === "object"
    ? nextData.props.pageProps
    : {};
  const initialState = pageProps?.initialState && typeof pageProps.initialState === "object"
    ? pageProps.initialState
    : {};
  const jobsState = initialState?.jobs && typeof initialState.jobs === "object"
    ? initialState.jobs
    : {};
  const foundJobs = Array.isArray(jobsState?.found) ? jobsState.found : [];

  const postings = [];
  const seenUrls = new Set();

  for (const job of foundJobs) {
    const item = job && typeof job === "object" ? job : {};
    const jobUrl = String(item?.url || "").trim();
    if (!jobUrl || seenUrls.has(jobUrl)) continue;

    const searchableLocations = Array.isArray(item?.searchableLocations) ? item.searchableLocations : [];
    const locations = Array.isArray(item?.locations) ? item.locations : [];
    const locationValue = String(searchableLocations[0] || locations[0] || "").trim();

    const createdAtRaw = item?.createdAt;
    let postingDate = null;
    if (Number.isFinite(Number(createdAtRaw)) && Number(createdAtRaw) > 0) {
      postingDate = String(Math.floor(Number(createdAtRaw)));
    } else if (typeof createdAtRaw === "string" && createdAtRaw.trim()) {
      postingDate = createdAtRaw.trim();
    }

    postings.push({
      company_name: companyNameForPostings,
      position_name: String(item?.title || "").trim() || "Untitled Position",
      job_posting_url: jobUrl,
      posting_date: postingDate,
      location: locationValue || null
    });
    seenUrls.add(jobUrl);
  }

  return postings;
}

function cleanTalentlyftText(value) {
  return decodeHtmlEntities(String(value || "").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function extractTalentlyftInitialConfig(pageHtml, fallbackUrl) {
  const source = String(pageHtml || "");
  const parsed = parseUrl(fallbackUrl);
  const websiteUrlDefault = parsed ? `${parsed.protocol}//${parsed.host}` : "";
  const subdomainDefault = parsed ? String(parsed.hostname || "").split(".")[0] : "";

  const pickFirst = (patterns) => {
    for (const pattern of patterns) {
      const match = source.match(pattern);
      if (match?.[1]) return String(match[1]).trim();
    }
    return "";
  };

  const layoutId = pickFirst([/layoutId\s*:\s*['"]([^'"]+)['"]/i, /layoutId\s*=\s*['"]([^'"]+)['"]/i]) || "Jobs-1";
  const themeId = pickFirst([/themeId\s*:\s*['"]([^'"]+)['"]/i, /themeId\s*=\s*['"]([^'"]+)['"]/i]) || "2";
  const language = pickFirst([/language\s*:\s*['"]([^'"]+)['"]/i, /language\s*=\s*['"]([^'"]+)['"]/i]) || "en";
  const subdomain =
    pickFirst([/subdomain\s*:\s*['"]([^'"]+)['"]/i, /subdomain\s*=\s*['"]([^'"]+)['"]/i]) || subdomainDefault;
  const websiteUrl =
    pickFirst([/websiteUrl\s*:\s*['"]([^'"]+)['"]/i, /websiteUrl\s*=\s*['"]([^'"]+)['"]/i]) || websiteUrlDefault;

  return {
    layoutId,
    themeId,
    language,
    subdomain,
    websiteUrl,
    apiUrl: websiteUrl ? `${websiteUrl}/JobList/` : ""
  };
}

function extractTalentlyftTotalPages(fragmentHtml) {
  const source = String(fragmentHtml || "");
  const matches = Array.from(source.matchAll(/data-page=['"](\d+)['"]/gi));
  const pages = matches
    .map((match) => Number(match?.[1] || 0))
    .filter((value) => Number.isFinite(value) && value > 0);
  return pages.length > 0 ? Math.max(...pages) : 1;
}

function parseTalentlyftPostingsFromFragment(companyNameForPostings, config, fragmentHtml) {
  const source = String(fragmentHtml || "");
  const postings = [];
  const seenUrls = new Set();
  const itemPattern =
    /<a[^>]*class=['"][^'"]*\bjobs__box\b[^'"]*['"][^>]*>([\s\S]*?)<\/a>/gi;

  let itemMatch = itemPattern.exec(source);
  while (itemMatch) {
    const blockHtml = String(itemMatch[0] || "");
    const bodyHtml = String(itemMatch[1] || "");

    const href = String(blockHtml.match(/\bhref=['"]([^'"]+)['"]/i)?.[1] || "").trim();
    const absoluteUrl = href ? new URL(href, `${config.baseOrigin || ""}/`).toString() : "";
    if (!absoluteUrl || seenUrls.has(absoluteUrl)) {
      itemMatch = itemPattern.exec(source);
      continue;
    }

    const id =
      String(blockHtml.match(/\bdata-job-id=['"](\d+)['"]/i)?.[1] || "").trim() ||
      String(blockHtml.match(/\bid=['"](\d+)['"]/i)?.[1] || "").trim() ||
      absoluteUrl;
    const title = cleanTalentlyftText(bodyHtml.match(/<h3[^>]*class=['"][^'"]*\bjobs__box__heading\b[^'"]*['"][^>]*>([\s\S]*?)<\/h3>/i)?.[1] || "");
    const location = cleanTalentlyftText(bodyHtml.match(/<p[^>]*class=['"][^'"]*\bjobs__box__text\b[^'"]*['"][^>]*>([\s\S]*?)<\/p>/i)?.[1] || "");

    postings.push({
      company_name: companyNameForPostings,
      position_name: title || "Untitled Position",
      job_posting_url: absoluteUrl,
      posting_date: null,
      location: location || null
    });
    seenUrls.add(absoluteUrl);
    itemMatch = itemPattern.exec(source);
  }

  return postings;
}

function cleanTheApplicantManagerText(value) {
  return decodeHtmlEntities(String(value || "").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function parseTheApplicantManagerPostingsFromHtml(companyNameForPostings, config, pageHtml) {
  const source = String(pageHtml || "");
  const postings = [];
  const seenUrls = new Set();
  let currentDepartment = "";

  const paragraphPattern =
    /<p[^>]*class=["']([^"']*\bpos_title_list\b[^"']*)["'][^>]*>([\s\S]*?)<\/p>/gi;
  const linkPattern =
    /<a[^>]*class=["'][^"']*\bpos_title_list\b[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i;

  let paragraphMatch = paragraphPattern.exec(source);
  while (paragraphMatch) {
    const classNames = String(paragraphMatch[1] || "").toLowerCase();
    const bodyHtml = String(paragraphMatch[2] || "");

    if (classNames.includes("bold_font")) {
      currentDepartment = cleanTheApplicantManagerText(bodyHtml);
      paragraphMatch = paragraphPattern.exec(source);
      continue;
    }

    const linkMatch = bodyHtml.match(linkPattern);
    if (!linkMatch?.[1]) {
      paragraphMatch = paragraphPattern.exec(source);
      continue;
    }

    const href = String(linkMatch[1] || "").trim();
    const absoluteUrl = href ? new URL(href, `${config.baseOrigin}/`).toString() : "";
    if (!absoluteUrl || seenUrls.has(absoluteUrl)) {
      paragraphMatch = paragraphPattern.exec(source);
      continue;
    }

    const title = cleanTheApplicantManagerText(linkMatch[2] || "");
    if (!title || title.toLowerCase() === "resume") {
      paragraphMatch = paragraphPattern.exec(source);
      continue;
    }

    postings.push({
      company_name: companyNameForPostings,
      position_name: title || "Untitled Position",
      job_posting_url: absoluteUrl,
      posting_date: null,
      location: null,
      department: currentDepartment || null
    });
    seenUrls.add(absoluteUrl);
    paragraphMatch = paragraphPattern.exec(source);
  }

  if (postings.length > 0) return postings;

  const fallbackLinkPattern =
    /<a[^>]*class=["'][^"']*\bpos_title_list\b[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let fallbackMatch = fallbackLinkPattern.exec(source);
  while (fallbackMatch) {
    const href = String(fallbackMatch[1] || "").trim();
    const absoluteUrl = href ? new URL(href, `${config.baseOrigin}/`).toString() : "";
    if (!absoluteUrl || seenUrls.has(absoluteUrl)) {
      fallbackMatch = fallbackLinkPattern.exec(source);
      continue;
    }

    const title = cleanTheApplicantManagerText(fallbackMatch[2] || "");
    if (!title || title.toLowerCase() === "resume") {
      fallbackMatch = fallbackLinkPattern.exec(source);
      continue;
    }

    const contextBefore = source.slice(Math.max(0, Number(fallbackMatch.index || 0) - 1200), Number(fallbackMatch.index || 0));
    const departmentMatches = Array.from(
      contextBefore.matchAll(
        /<p[^>]*class=["'][^"']*\bpos_title_list\b[^"']*\bbold_font\b[^"']*["'][^>]*>([\s\S]*?)<\/p>/gi
      )
    );
    const department =
      departmentMatches.length > 0 ? cleanTheApplicantManagerText(departmentMatches[departmentMatches.length - 1][1] || "") : "";

    postings.push({
      company_name: companyNameForPostings,
      position_name: title || "Untitled Position",
      job_posting_url: absoluteUrl,
      posting_date: null,
      location: null,
      department: department || null
    });
    seenUrls.add(absoluteUrl);
    fallbackMatch = fallbackLinkPattern.exec(source);
  }

  return postings;
}

function cleanApplicantAiText(value) {
  return decodeHtmlEntities(String(value || "").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function isApplicantAiJobHref(href) {
  const candidate = String(href || "").trim();
  if (!candidate || candidate.startsWith("#") || candidate.toLowerCase().startsWith("mailto:")) {
    return false;
  }

  const parsed = parseUrl(candidate);
  if (parsed?.host) {
    const host = String(parsed.host || "").split(":")[0].toLowerCase();
    if (host !== "applicantai.com" && host !== "www.applicantai.com") {
      return false;
    }
  }

  const path = parsed ? String(parsed.pathname || "") : candidate;
  const pathParts = path
    .split("/")
    .map((part) => String(part || "").trim())
    .filter(Boolean);
  if (pathParts.length < 3) return false;

  return /^\d+$/.test(String(pathParts[pathParts.length - 1] || ""));
}

function parseApplicantAiPostingsFromHtml(companyNameForPostings, config, pageHtml) {
  const source = String(pageHtml || "");
  const postings = [];
  const seenUrls = new Set();

  const blockPattern = /<div[^>]*class=["'][^"']*\bmy-4\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi;
  const headingLinkPattern = /<h4[^>]*>\s*<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>\s*<\/h4>/i;
  const locationPattern = /<small[^>]*class=["'][^"']*\btext-muted\b[^"']*["'][^>]*>([\s\S]*?)<\/small>/i;

  let blockMatch = blockPattern.exec(source);
  while (blockMatch) {
    const blockHtml = String(blockMatch[1] || "");
    const headingMatch = blockHtml.match(headingLinkPattern);
    if (!headingMatch?.[1]) {
      blockMatch = blockPattern.exec(source);
      continue;
    }

    const href = String(headingMatch[1] || "").trim();
    if (!isApplicantAiJobHref(href)) {
      blockMatch = blockPattern.exec(source);
      continue;
    }

    const absoluteUrl = new URL(href, `${config.baseOrigin}/`).toString();
    if (!absoluteUrl || seenUrls.has(absoluteUrl)) {
      blockMatch = blockPattern.exec(source);
      continue;
    }

    const locationMatch = blockHtml.match(locationPattern);
    const title = cleanApplicantAiText(headingMatch[2] || "") || "Untitled Position";

    postings.push({
      company_name: companyNameForPostings,
      position_name: title,
      job_posting_url: absoluteUrl,
      posting_date: null,
      location: cleanApplicantAiText(locationMatch?.[1] || "") || null
    });
    seenUrls.add(absoluteUrl);
    blockMatch = blockPattern.exec(source);
  }

  if (postings.length > 0) return postings;

  const fallbackPattern = /<h4[^>]*>\s*<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>\s*<\/h4>/gi;
  let fallbackMatch = fallbackPattern.exec(source);
  while (fallbackMatch) {
    const href = String(fallbackMatch[1] || "").trim();
    if (!isApplicantAiJobHref(href)) {
      fallbackMatch = fallbackPattern.exec(source);
      continue;
    }

    const absoluteUrl = new URL(href, `${config.baseOrigin}/`).toString();
    if (!absoluteUrl || seenUrls.has(absoluteUrl)) {
      fallbackMatch = fallbackPattern.exec(source);
      continue;
    }

    const contextHtml = source.slice(
      Number(fallbackMatch.index || 0),
      Math.min(source.length, Number(fallbackMatch.index || 0) + 700)
    );
    const locationMatch = contextHtml.match(locationPattern);
    const title = cleanApplicantAiText(fallbackMatch[2] || "") || "Untitled Position";

    postings.push({
      company_name: companyNameForPostings,
      position_name: title,
      job_posting_url: absoluteUrl,
      posting_date: null,
      location: cleanApplicantAiText(locationMatch?.[1] || "") || null
    });
    seenUrls.add(absoluteUrl);
    fallbackMatch = fallbackPattern.exec(source);
  }

  return postings;
}

function ensureIcimsIframeUrl(urlString) {
  const parsed = parseUrl(urlString);
  if (!parsed) return String(urlString || "").trim();
  parsed.searchParams.set("in_iframe", "1");
  return parsed.toString();
}

function extractIcimsIframeUrlFromHtml(pageHtml, baseUrl) {
  const source = String(pageHtml || "");
  const patterns = [
    /icimsFrame\.src\s*=\s*'([^']+)'/i,
    /icimsFrame\.src\s*=\s*"([^"]+)"/i,
    /<iframe[^>]*id=["']icims_content_iframe["'][^>]*src=["']([^"']+)["']/i
  ];

  for (const pattern of patterns) {
    const match = source.match(pattern);
    const rawValue = String(match?.[1] || "").trim();
    if (!rawValue) continue;

    let candidate = decodeHtmlEntities(rawValue).replace(/\\\//g, "/");
    if (!candidate) continue;

    if (candidate.startsWith("//")) {
      const parsedBase = parseUrl(baseUrl);
      const protocol = String(parsedBase?.protocol || "https:");
      candidate = `${protocol}${candidate}`;
    } else if (!/^https?:\/\//i.test(candidate)) {
      try {
        candidate = new URL(candidate, baseUrl).toString();
      } catch {
        continue;
      }
    }

    return ensureIcimsIframeUrl(candidate);
  }

  return ensureIcimsIframeUrl(baseUrl);
}

function extractIcimsNextPageUrlFromHtml(pageHtml, currentUrl) {
  const source = String(pageHtml || "");
  const patterns = [
    /<link[^>]*rel=["']next["'][^>]*href=["']([^"']+)["']/i,
    /<link[^>]*href=["']([^"']+)["'][^>]*rel=["']next["'][^>]*>/i
  ];

  for (const pattern of patterns) {
    const match = source.match(pattern);
    const rawValue = String(match?.[1] || "").trim();
    if (!rawValue) continue;

    let candidate = decodeHtmlEntities(rawValue).replace(/\\\//g, "/");
    if (!candidate) continue;

    if (candidate.startsWith("//")) {
      const parsedCurrent = parseUrl(currentUrl);
      const protocol = String(parsedCurrent?.protocol || "https:");
      candidate = `${protocol}${candidate}`;
    } else if (!/^https?:\/\//i.test(candidate)) {
      try {
        candidate = new URL(candidate, currentUrl).toString();
      } catch {
        continue;
      }
    }

    const normalizedCandidate = ensureIcimsIframeUrl(candidate);
    if (normalizedCandidate && normalizedCandidate !== String(currentUrl || "").trim()) {
      return normalizedCandidate;
    }
  }

  return null;
}

function buildAshbyJobUrl(organizationHostedJobsPageName, jobId) {
  if (!organizationHostedJobsPageName || !jobId) return "";
  return `https://jobs.ashbyhq.com/${organizationHostedJobsPageName}/${jobId}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getAtsRateLimitState(rateLimitKey) {
  return atsRateLimitStore.getState(rateLimitKey);
}

function parseRetryAfterMilliseconds(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;

  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.max(0, Math.ceil(seconds * 1000));
  }

  const parsedEpochMs = Date.parse(raw);
  if (!Number.isFinite(parsedEpochMs)) return null;
  return Math.max(0, parsedEpochMs - Date.now());
}

function resolveAtsRateLimitWaitMs(res, fallbackWaitMs) {
  const minimumWaitMs = Math.max(0, Number(fallbackWaitMs || 0));
  const retryAfterMs = parseRetryAfterMilliseconds(res?.headers?.get("retry-after"));
  if (!Number.isFinite(retryAfterMs)) return minimumWaitMs;
  return Math.max(minimumWaitMs, retryAfterMs);
}

async function acquireAtsRequestSlot(rateLimitKey) {
  const state = getAtsRateLimitState(rateLimitKey);
  if (state.active < atsRequestQueueConcurrency) {
    state.active += 1;
    return;
  }
  await new Promise((resolve) => {
    state.queue.push(resolve);
  });
}

function releaseAtsRequestSlot(rateLimitKey) {
  const state = getAtsRateLimitState(rateLimitKey);
  const next = state.queue.shift();
  if (typeof next === "function") {
    next();
    return;
  }
  state.active = Math.max(0, state.active - 1);
}

async function markAtsRateLimited(rateLimitKey, waitMs) {
  await atsRateLimitStore.markRateLimited(rateLimitKey, waitMs);
}

async function waitForAtsCooldown(rateLimitKey) {
  await atsRateLimitStore.hydrateCooldown(rateLimitKey);
  const state = getAtsRateLimitState(rateLimitKey);
  while (true) {
    const waitMs = Number(state.blockedUntilEpochMs || 0) - Date.now();
    if (waitMs <= 0) return;
    await sleep(waitMs);
  }
}

async function fetchWithAtsRateLimit(rateLimitKey, fallbackWaitMs, url, init = {}) {
  while (true) {
    await acquireAtsRequestSlot(rateLimitKey);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      await waitForAtsCooldown(rateLimitKey);
      const res = await safeFetch(url, {
        ...init,
        signal: controller.signal
      });

      if (res.status === 429) {
        await markAtsRateLimited(rateLimitKey, resolveAtsRateLimitWaitMs(res, fallbackWaitMs));
        continue;
      }

      return res;
    } finally {
      clearTimeout(timeout);
      releaseAtsRequestSlot(rateLimitKey);
    }
  }
}

async function fetchWorkdayPage(cxsUrl, limit, offset) {
  const res = await fetchWithAtsRateLimit("workday", WORKDAY_RATE_LIMIT_WAIT_MS, cxsUrl, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      appliedFacets: {},
      limit,
      offset,
      searchText: ""
    })
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Workday request failed (${res.status}): ${body.slice(0, 180)}`);
  }

  return res.json();
}

async function fetchAshbyJobBoard(organizationHostedJobsPageName) {
  const res = await fetchWithAtsRateLimit("ashby", ASHBY_RATE_LIMIT_WAIT_MS, ASHBY_API_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      operationName: "ApiJobBoardWithTeams",
      variables: {
        organizationHostedJobsPageName
      },
      query: ASHBY_QUERY
    })
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Ashby request failed (${res.status}): ${body.slice(0, 180)}`);
  }

  const data = await res.json();
  if (Array.isArray(data?.errors) && data.errors.length > 0) {
    const firstError = String(data.errors[0]?.message || "Unknown Ashby GraphQL error");
    throw new Error(`Ashby GraphQL error: ${firstError}`);
  }

  return data;
}

async function fetchGreenhouseJobBoard(boardToken) {
  const encodedBoardToken = encodeURIComponent(boardToken);
  const res = await fetchWithAtsRateLimit(
    "greenhouse",
    GREENHOUSE_RATE_LIMIT_WAIT_MS,
    `${GREENHOUSE_API_URL_BASE}/${encodedBoardToken}/jobs?content=true`,
    {
      method: "GET",
      headers: {
        Accept: "application/json"
      }
    }
  );

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Greenhouse request failed (${res.status}): ${body.slice(0, 180)}`);
  }

  return res.json();
}

async function fetchLeverJobBoard(organization) {
  const encodedOrganization = encodeURIComponent(organization);
  const res = await fetchWithAtsRateLimit(
    "lever",
    LEVER_RATE_LIMIT_WAIT_MS,
    `${LEVER_API_URL_BASE}/${encodedOrganization}?mode=json`,
    {
      method: "GET",
      headers: {
        Accept: "application/json"
      }
    }
  );

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Lever request failed (${res.status}): ${body.slice(0, 180)}`);
  }

  return res.json();
}

async function fetchRecruiteePublicApp(baseUrl) {
  const res = await fetchWithAtsRateLimit("recruitee", RECRUITEE_RATE_LIMIT_WAIT_MS, baseUrl, {
    method: "GET",
    headers: {
      Accept: "text/html,application/xhtml+xml"
    }
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Recruitee request failed (${res.status}): ${body.slice(0, 180)}`);
  }

  const pageHtml = await res.text();
  const props = extractRecruiteePropsFromHtml(pageHtml);
  if (!props) {
    throw new Error("Recruitee payload not found in PublicApp data-props");
  }
  return props;
}

async function fetchJobviteJobsPage(jobsUrl) {
  const res = await fetchWithAtsRateLimit("jobvite", JOBVITE_RATE_LIMIT_WAIT_MS, jobsUrl, {
    method: "GET",
    headers: {
      Accept: "text/html,application/xhtml+xml"
    }
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Jobvite request failed (${res.status}): ${body.slice(0, 180)}`);
  }

  return res.text();
}

async function fetchApplicantProJobsPage(jobsUrl) {
  const res = await fetchWithAtsRateLimit("applicantpro", APPLICANTPRO_RATE_LIMIT_WAIT_MS, jobsUrl, {
    method: "GET",
    headers: {
      Accept: "text/html,application/xhtml+xml"
    }
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`ApplicantPro page request failed (${res.status}): ${body.slice(0, 180)}`);
  }

  return res.text();
}

async function fetchApplicantProJobsList(config, domainId) {
  const apiUrl = new URL(`${String(config?.origin || "").replace(/\/+$/, "")}/core/jobs/${encodeURIComponent(domainId)}`);
  apiUrl.searchParams.set("getParams", "{}");

  const res = await fetchWithAtsRateLimit("applicantpro", APPLICANTPRO_RATE_LIMIT_WAIT_MS, apiUrl.toString(), {
    method: "GET",
    headers: {
      Accept: "application/json"
    }
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`ApplicantPro jobs request failed (${res.status}): ${body.slice(0, 180)}`);
  }

  const payload = await res.json();
  if (payload && typeof payload === "object" && payload.success === false) {
    const message = String(payload?.message || "Unknown ApplicantPro API error");
    throw new Error(`ApplicantPro jobs API returned success=false: ${message}`);
  }
  return payload;
}

async function fetchApplyToJobPage(applyUrl) {
  const res = await fetchWithAtsRateLimit("applytojob", APPLYTOJOB_RATE_LIMIT_WAIT_MS, applyUrl, {
    method: "GET",
    headers: {
      Accept: "text/html,application/xhtml+xml"
    }
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`ApplyToJob page request failed (${res.status}): ${body.slice(0, 180)}`);
  }

  return res.text();
}

async function fetchTheApplicantManagerPage(careersUrl) {
  const res = await fetchWithAtsRateLimit(
    "theapplicantmanager",
    THEAPPLICANTMANAGER_RATE_LIMIT_WAIT_MS,
    careersUrl,
    {
      method: "GET",
      headers: {
        Accept: "text/html,application/xhtml+xml"
      }
    }
  );

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`TheApplicantManager page request failed (${res.status}): ${body.slice(0, 180)}`);
  }

  return res.text();
}

async function fetchBreezyPortalPage(urlString) {
  const res = await fetchWithAtsRateLimit("breezy", BREEZY_RATE_LIMIT_WAIT_MS, urlString, {
    method: "GET",
    headers: {
      Accept: "text/html,application/xhtml+xml"
    }
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Breezy page request failed (${res.status}): ${body.slice(0, 180)}`);
  }

  const finalUrl = String(res.url || urlString || "").trim();
  const finalHost = String(parseUrl(finalUrl)?.hostname || "").toLowerCase();
  if (finalHost === "breezy.hr" || finalHost === "www.breezy.hr") {
    throw new Error(`Breezy URL redirected to main page: ${finalUrl}`);
  }

  return { pageHtml: await res.text(), finalUrl };
}

async function fetchIcimsPage(urlString) {
  const res = await fetchWithAtsRateLimit("icims", ICIMS_RATE_LIMIT_WAIT_MS, urlString, {
    method: "GET",
    headers: {
      Accept: "text/html,application/xhtml+xml"
    }
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`iCIMS page request failed (${res.status}): ${body.slice(0, 180)}`);
  }

  return res.text();
}

async function fetchZohoCareersPage(urlString) {
  const res = await fetchWithAtsRateLimit("zoho", ZOHO_RATE_LIMIT_WAIT_MS, urlString, {
    method: "GET",
    headers: {
      Accept: "text/html,application/xhtml+xml"
    }
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Zoho Recruit page request failed (${res.status}): ${body.slice(0, 180)}`);
  }

  return res.text();
}

async function fetchApplicantAiCareersPage(urlString) {
  const res = await fetchWithAtsRateLimit("applicantai", APPLICANTAI_RATE_LIMIT_WAIT_MS, urlString, {
    method: "GET",
    headers: {
      Accept: "text/html,application/xhtml+xml"
    }
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`ApplicantAI page request failed (${res.status}): ${body.slice(0, 180)}`);
  }

  return res.text();
}

async function fetchCareerplugJobsPage(urlString) {
  const res = await fetchWithAtsRateLimit("careerplug", CAREERPLUG_RATE_LIMIT_WAIT_MS, urlString, {
    method: "GET",
    headers: {
      Accept: "text/html,application/xhtml+xml"
    }
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`CareerPlug page request failed (${res.status}): ${body.slice(0, 180)}`);
  }

  return res.text();
}

async function fetchGemJobBoard(config) {
  const payload = [
    {
      operationName: "JobBoardTheme",
      variables: {
        boardId: config.boardId
      },
      query:
        "query JobBoardTheme($boardId: String!) { publicBrandingTheme(externalId: $boardId) { id theme __typename } }"
    },
    {
      operationName: "JobBoardList",
      variables: {
        boardId: config.boardId
      },
      query:
        "query JobBoardList($boardId: String!) { oatsExternalJobPostings(boardId: $boardId) { jobPostings { id extId title locations { id name city isoCountry isRemote extId __typename } job { id department { id name extId __typename } locationType employmentType __typename } __typename } __typename } jobBoardExternal(vanityUrlPath: $boardId) { id teamDisplayName descriptionHtml pageTitle __typename } }"
    }
  ];

  const res = await fetchWithAtsRateLimit("gem", GEM_RATE_LIMIT_WAIT_MS, config.apiUrl, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Gem API request failed (${res.status}): ${body.slice(0, 180)}`);
  }

  const responseJson = await res.json();
  if (!Array.isArray(responseJson)) {
    throw new Error("Gem API response is not a JSON array");
  }

  return responseJson;
}

async function fetchJobApsCareersPage(urlString) {
  const res = await fetchWithAtsRateLimit("jobaps", JOBAPS_RATE_LIMIT_WAIT_MS, urlString, {
    method: "GET",
    headers: {
      Accept: "text/html,application/xhtml+xml"
    }
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`JobAps page request failed (${res.status}): ${body.slice(0, 180)}`);
  }

  const finalUrl = String(res.url || urlString || "").trim();
  const finalHost = String(parseUrl(finalUrl)?.hostname || "").toLowerCase();
  if (!finalHost.endsWith(".jobapscloud.com")) {
    throw new Error(`JobAps URL redirected to unexpected host: ${finalUrl}`);
  }

  return { pageHtml: await res.text(), finalUrl };
}

async function fetchJoinCompanyPage(urlString) {
  const res = await fetchWithAtsRateLimit("join", JOIN_RATE_LIMIT_WAIT_MS, urlString, {
    method: "GET",
    headers: {
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    }
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`JOIN page request failed (${res.status}): ${body.slice(0, 180)}`);
  }

  const finalUrl = String(res.url || urlString || "").trim();
  const finalHost = String(parseUrl(finalUrl)?.hostname || "").toLowerCase();
  if (finalHost !== "join.com" && finalHost !== "www.join.com") {
    throw new Error(`JOIN URL redirected to unexpected host: ${finalUrl}`);
  }

  return { pageHtml: await res.text(), finalUrl };
}

async function fetchTalentreefAlias(config) {
  const res = await fetchWithAtsRateLimit("talentreef", TALENTREEF_RATE_LIMIT_WAIT_MS, config.aliasApiUrl, {
    method: "GET",
    headers: {
      Accept: "application/json"
    }
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`TalentReef alias request failed (${res.status}): ${body.slice(0, 180)}`);
  }

  return res.json();
}

async function fetchTalentreefSearchResults(config, clientId, brand, from = 0, size = 100) {
  const payload = buildTalentreefSearchPayload(clientId, brand, from, size);
  const res = await fetchWithAtsRateLimit("talentreef", TALENTREEF_RATE_LIMIT_WAIT_MS, config.searchApiUrl, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`TalentReef search request failed (${res.status}): ${body.slice(0, 180)}`);
  }

  return res.json();
}

async function fetchManatalCareersPage(urlString) {
  const res = await fetchWithAtsRateLimit("manatal", MANATAL_RATE_LIMIT_WAIT_MS, urlString, {
    method: "GET",
    headers: {
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    }
  });

  const finalUrl = String(res.url || urlString || "").trim();
  const pageHtml = await res.text();
  return {
    status: Number(res.status || 0),
    finalUrl,
    pageHtml
  };
}

async function fetchCareerspageBoardPage(urlString) {
  const res = await fetchWithAtsRateLimit("careerspage", CAREERSPAGE_RATE_LIMIT_WAIT_MS, urlString, {
    method: "GET",
    headers: {
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    }
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`CareersPage request failed (${res.status}): ${body.slice(0, 180)}`);
  }

  const finalUrl = String(res.url || urlString || "").trim();
  const finalHost = String(parseUrl(finalUrl)?.hostname || "").toLowerCase();
  if (finalHost !== "careerspage.io" && finalHost !== "www.careerspage.io") {
    throw new Error(`CareersPage URL redirected to unexpected host: ${finalUrl}`);
  }

  return { pageHtml: await res.text(), finalUrl };
}

async function fetchOracleJobRequisitionsPage(config, offset = 0, limit = 25) {
  const safeOffset = Number.isFinite(Number(offset)) && Number(offset) >= 0 ? Math.floor(Number(offset)) : 0;
  const safeLimit = Number.isFinite(Number(limit)) && Number(limit) > 0 ? Math.floor(Number(limit)) : 25;
  const finder = String(config?.finder || "").replace(/limit=\d+/i, `limit=${safeLimit}`);
  const url = new URL(String(config?.apiUrl || "").trim());
  url.searchParams.set("onlyData", "true");
  url.searchParams.set("expand", ORACLE_EXPAND_VALUE);
  if (finder) {
    url.searchParams.set("finder", finder);
  }
  url.searchParams.set("offset", String(safeOffset));
  url.searchParams.set("limit", String(safeLimit));

  const res = await fetchWithAtsRateLimit("oracle", ORACLE_RATE_LIMIT_WAIT_MS, url.toString(), {
    method: "GET",
    headers: {
      Accept: "application/json, text/plain, */*",
      "Accept-Language": "en-US,en;q=0.9",
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    }
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Oracle job requisitions request failed (${res.status}): ${body.slice(0, 180)}`);
  }

  const finalUrl = String(res.url || url.toString()).trim();
  const finalHost = String(parseUrl(finalUrl)?.hostname || "").toLowerCase();
  if (!finalHost.endsWith(".oraclecloud.com")) {
    throw new Error(`Oracle API URL redirected to unexpected host: ${finalUrl}`);
  }

  return res.json();
}

async function fetchPaylocityBoardPage(config) {
  const res = await fetchWithAtsRateLimit("paylocity", PAYLOCITY_RATE_LIMIT_WAIT_MS, config.boardUrl, {
    method: "GET",
    headers: {
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    }
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Paylocity board request failed (${res.status}): ${body.slice(0, 180)}`);
  }

  const finalUrl = String(res.url || config.boardUrl || "").trim();
  const finalHost = String(parseUrl(finalUrl)?.hostname || "").toLowerCase();
  if (finalHost !== "recruiting.paylocity.com" && finalHost !== "www.recruiting.paylocity.com") {
    throw new Error(`Paylocity URL redirected to unexpected host: ${finalUrl}`);
  }

  return {
    pageHtml: await res.text(),
    finalUrl
  };
}

async function fetchEightfoldCareersPage(config) {
  const res = await fetchWithAtsRateLimit("eightfold", EIGHTFOLD_RATE_LIMIT_WAIT_MS, config.boardUrl, {
    method: "GET",
    headers: {
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    }
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Eightfold careers page request failed (${res.status}): ${body.slice(0, 180)}`);
  }

  const finalUrl = String(res.url || config.boardUrl || "").trim();
  const finalHost = String(parseUrl(finalUrl)?.hostname || "").toLowerCase();
  if (!(finalHost.endsWith(".eightfold.ai") || finalHost === "eightfold.ai" || finalHost === "www.eightfold.ai")) {
    throw new Error(`Eightfold URL redirected to unexpected host: ${finalUrl}`);
  }

  return {
    pageHtml: await res.text(),
    finalUrl
  };
}

async function fetchEightfoldJobsApi(config, domainValue) {
  const apiUrl = buildEightfoldApiUrl(config, domainValue);
  if (!apiUrl) {
    throw new Error("Eightfold API URL could not be built from careers page metadata");
  }

  const res = await fetchWithAtsRateLimit("eightfold", EIGHTFOLD_RATE_LIMIT_WAIT_MS, apiUrl, {
    method: "GET",
    headers: {
      Accept: "application/json, text/plain, */*",
      "Accept-Language": "en-US,en;q=0.9",
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    }
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Eightfold jobs API request failed (${res.status}): ${body.slice(0, 180)}`);
  }

  const finalUrl = String(res.url || apiUrl || "").trim();
  const finalHost = String(parseUrl(finalUrl)?.hostname || "").toLowerCase();
  if (!(finalHost.endsWith(".eightfold.ai") || finalHost === "eightfold.ai" || finalHost === "www.eightfold.ai")) {
    throw new Error(`Eightfold API URL redirected to unexpected host: ${finalUrl}`);
  }

  const bodyText = await res.text();
  let responseJson = {};
  try {
    responseJson = JSON.parse(bodyText);
  } catch {
    throw new Error(`Eightfold jobs API response was not JSON: ${bodyText.slice(0, 180)}`);
  }

  return {
    responseJson,
    finalUrl
  };
}

async function fetchPageupBoardPage(config) {
  const res = await fetchWithAtsRateLimit("pageup", PAGEUP_RATE_LIMIT_WAIT_MS, config.boardUrl, {
    method: "GET",
    headers: {
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    }
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`PageUp board request failed (${res.status}): ${body.slice(0, 180)}`);
  }

  const finalUrl = String(res.url || config.boardUrl || "").trim();
  const finalHost = String(parseUrl(finalUrl)?.hostname || "").toLowerCase();
  if (finalHost !== "careers.pageuppeople.com" && finalHost !== "www.careers.pageuppeople.com") {
    throw new Error(`PageUp URL redirected to unexpected host: ${finalUrl}`);
  }

  return {
    pageHtml: await res.text(),
    finalUrl
  };
}

async function fetchPageupSearchResults(config) {
  const res = await fetchWithAtsRateLimit("pageup", PAGEUP_RATE_LIMIT_WAIT_MS, config.searchUrl, {
    method: "POST",
    headers: {
      Accept: "application/json, text/plain, */*",
      "Accept-Language": "en-US,en;q=0.9",
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
      Referer: String(config?.boardUrl || ""),
      "X-Requested-With": "XMLHttpRequest",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    }
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`PageUp search request failed (${res.status}): ${body.slice(0, 180)}`);
  }

  const finalUrl = String(res.url || config.searchUrl || "").trim();
  const finalHost = String(parseUrl(finalUrl)?.hostname || "").toLowerCase();
  if (finalHost !== "careers.pageuppeople.com" && finalHost !== "www.careers.pageuppeople.com") {
    throw new Error(`PageUp search URL redirected to unexpected host: ${finalUrl}`);
  }

  const bodyText = await res.text();
  let responseJson = {};
  try {
    responseJson = JSON.parse(bodyText);
  } catch {
    throw new Error(`PageUp search response was not JSON: ${bodyText.slice(0, 180)}`);
  }

  return {
    responseJson,
    finalUrl
  };
}

async function fetchPageupDetailsPage(jobPostingUrl) {
  const res = await fetchWithAtsRateLimit("pageup", PAGEUP_RATE_LIMIT_WAIT_MS, jobPostingUrl, {
    method: "GET",
    headers: {
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    }
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`PageUp details request failed (${res.status}): ${body.slice(0, 180)}`);
  }

  const finalUrl = String(res.url || jobPostingUrl || "").trim();
  const finalHost = String(parseUrl(finalUrl)?.hostname || "").toLowerCase();
  if (finalHost !== "careers.pageuppeople.com" && finalHost !== "www.careers.pageuppeople.com") {
    throw new Error(`PageUp details URL redirected to unexpected host: ${finalUrl}`);
  }

  return res.text();
}

async function fetchHirebridgeJobsPage(config) {
  const res = await fetchWithAtsRateLimit("hirebridge", HIREBRIDGE_RATE_LIMIT_WAIT_MS, config.boardUrl, {
    method: "GET",
    headers: {
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    }
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Hirebridge page request failed (${res.status}): ${body.slice(0, 180)}`);
  }

  const finalUrl = String(res.url || config.boardUrl || "").trim();
  const finalHost = String(parseUrl(finalUrl)?.hostname || "").toLowerCase();
  if (finalHost !== "recruit.hirebridge.com" && finalHost !== "www.recruit.hirebridge.com") {
    throw new Error(`Hirebridge URL redirected to unexpected host: ${finalUrl}`);
  }

  return { pageHtml: await res.text(), finalUrl };
}

async function fetchHirebridgeDetailsPage(config, jobPostingUrl) {
  const detailsUrl = buildHirebridgeDetailsUrl(config, jobPostingUrl);
  if (!detailsUrl) return "";

  const res = await fetchWithAtsRateLimit("hirebridge", HIREBRIDGE_RATE_LIMIT_WAIT_MS, detailsUrl, {
    method: "GET",
    headers: {
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    }
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Hirebridge details request failed (${res.status}): ${body.slice(0, 180)}`);
  }

  const finalUrl = String(res.url || detailsUrl || "").trim();
  const finalHost = String(parseUrl(finalUrl)?.hostname || "").toLowerCase();
  if (finalHost !== "recruit.hirebridge.com" && finalHost !== "www.recruit.hirebridge.com") {
    throw new Error(`Hirebridge details URL redirected to unexpected host: ${finalUrl}`);
  }

  return res.text();
}

async function fetchManatalJobsApiPage(config, page = 1, pageSize = 50) {
  const jobsApiUrl = String(config?.jobsApiUrl || "").trim();
  if (!jobsApiUrl) {
    throw new Error("Manatal API URL is missing");
  }

  const query = new URLSearchParams({
    page: String(page),
    page_size: String(pageSize),
    ordering: "-is_pinned_in_career_page,-last_published_at"
  }).toString();
  const url = `${jobsApiUrl}${jobsApiUrl.includes("?") ? "&" : "?"}${query}`;

  const res = await fetchWithAtsRateLimit("manatal", MANATAL_RATE_LIMIT_WAIT_MS, url, {
    method: "GET",
    headers: {
      Accept: "application/json, text/plain, */*",
      Referer: String(config?.boardUrl || ""),
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    }
  });

  if (!res.ok) {
    const body = await res.text();
    const error = new Error(`Manatal API request failed (${res.status}): ${body.slice(0, 180)}`);
    error.status = Number(res.status || 0);
    throw error;
  }

  return res.json();
}

async function fetchTeamtailorJobsPage(config) {
  const res = await fetchWithAtsRateLimit("teamtailor", TEAMTAILOR_RATE_LIMIT_WAIT_MS, config.jobsUrl, {
    method: "GET",
    headers: {
      Accept: "text/html,application/xhtml+xml"
    }
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Teamtailor page request failed (${res.status}): ${body.slice(0, 180)}`);
  }

  const finalUrl = String(res.url || config.jobsUrl || "").trim();
  const finalHost = String(parseUrl(finalUrl)?.hostname || "").toLowerCase();
  if (!finalHost.endsWith(".teamtailor.com")) {
    throw new Error(`Teamtailor URL redirected to unexpected host: ${finalUrl}`);
  }

  return { pageHtml: await res.text(), finalUrl };
}

async function fetchFreshteamJobsPage(config) {
  const res = await fetchWithAtsRateLimit("freshteam", FRESHTEAM_RATE_LIMIT_WAIT_MS, config.jobsUrl, {
    method: "GET",
    headers: {
      Accept: "text/html,application/xhtml+xml"
    }
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Freshteam page request failed (${res.status}): ${body.slice(0, 180)}`);
  }

  const finalUrl = String(res.url || config.jobsUrl || "").trim();
  const finalHost = String(parseUrl(finalUrl)?.hostname || "").toLowerCase();
  if (!finalHost.endsWith(".freshteam.com")) {
    throw new Error(`Freshteam URL redirected to unexpected host: ${finalUrl}`);
  }

  return { pageHtml: await res.text(), finalUrl };
}

async function fetchSagehrJobsPage(config) {
  const headers = {
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Cache-Control": "no-cache",
    Pragma: "no-cache",
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
  };

  const res = await fetchWithAtsRateLimit("sagehr", SAGEHR_RATE_LIMIT_WAIT_MS, config.boardUrl, {
    method: "GET",
    headers
  });

  let statusCode = Number(res.status || 0);
  let finalUrl = String(res.url || config.boardUrl || "").trim();
  let pageHtml = await res.text();

  // Disabled curl fallback to prevent external console process launches on Windows MSI runtime.

  if (statusCode !== 200 && statusCode !== 403) {
    throw new Error(`SageHR page request failed (${statusCode})`);
  }

  const finalHost = String(parseUrl(finalUrl)?.hostname || "").toLowerCase();
  if (finalHost !== "talent.sage.hr" && finalHost !== "www.talent.sage.hr") {
    throw new Error(`SageHR URL redirected to unexpected host: ${finalUrl}`);
  }

  if (!String(pageHtml || "").trim()) {
    throw new Error(`SageHR page response was empty (${statusCode})`);
  }

  const loweredPageHtml = String(pageHtml || "").toLowerCase();
  const hasExpectedLayout =
    loweredPageHtml.includes("title-wrap") ||
    loweredPageHtml.includes("other-jobs");
  if (statusCode === 403 && !hasExpectedLayout) {
    throw new Error("SageHR page request failed (403)");
  }

  return { pageHtml, finalUrl };
}

async function fetchPeopleforceJobsPage(config) {
  const headers = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Cache-Control": "no-cache",
    Pragma: "no-cache"
  };

  const res = await safeFetch(config.jobsUrl, {
    method: "GET",
    headers
  });

  let statusCode = Number(res.status || 0);
  let finalUrl = String(res.url || config.jobsUrl || "").trim();
  let pageHtml = statusCode === 200 ? await res.text() : "";

  // Disabled curl fallback to prevent external console process launches on Windows MSI runtime.

  if (statusCode !== 200) {
    throw new Error(`Peopleforce page request failed (${statusCode})`);
  }

  const finalHost = String(parseUrl(finalUrl)?.hostname || "").toLowerCase();
  if (!finalHost.endsWith(".peopleforce.io") || finalHost === "peopleforce.io" || finalHost === "www.peopleforce.io") {
    throw new Error(`Peopleforce URL redirected to unexpected host: ${finalUrl}`);
  }

  if (/\bclosed career site\b/i.test(pageHtml)) {
    return { pageHtml: "", finalUrl };
  }

  return { pageHtml, finalUrl };
}

async function fetchSimplicantJobsPage(config) {
  const res = await fetchWithAtsRateLimit("simplicant", SIMPLICANT_RATE_LIMIT_WAIT_MS, config.jobsUrl, {
    method: "GET",
    headers: {
      Accept: "text/html,application/xhtml+xml"
    }
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Simplicant page request failed (${res.status}): ${body.slice(0, 180)}`);
  }

  const finalUrl = String(res.url || config.jobsUrl || "").trim();
  const finalHost = String(parseUrl(finalUrl)?.hostname || "").toLowerCase();
  if (
    !finalHost.endsWith(".simplicant.com") ||
    ["simplicant.com", "www.simplicant.com", "assets.simplicant.com", "app.simplicant.com", "jobs.simplicant.com"].includes(
      finalHost
    )
  ) {
    throw new Error(`Simplicant URL redirected to unexpected host: ${finalUrl}`);
  }

  return { pageHtml: await res.text(), finalUrl };
}

async function fetchLoxoJobsPage(config) {
  const headers = {
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
  };

  const doRequest = async () =>
    safeFetch(config.boardUrl, {
      method: "GET",
      headers
    });

  let res = await doRequest();
  if (Number(res.status || 0) === 429) {
    await sleep(LOXO_RATE_LIMIT_WAIT_MS);
    res = await doRequest();
  }

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Loxo page request failed (${res.status}): ${body.slice(0, 180)}`);
  }

  const finalUrl = String(res.url || config.boardUrl || "").trim();
  const finalHost = String(parseUrl(finalUrl)?.hostname || "").toLowerCase();
  if (finalHost !== "app.loxo.co" && finalHost !== "www.app.loxo.co") {
    throw new Error(`Loxo URL redirected to unexpected host: ${finalUrl}`);
  }

  return { pageHtml: await res.text(), finalUrl };
}

async function fetchPinpointHqJobBoard(config) {
  const timestamp = Date.now().toString();
  const queryGlue = String(config.apiUrl || "").includes("?") ? "&" : "?";
  const requestUrl = `${config.apiUrl}${queryGlue}_=${encodeURIComponent(timestamp)}`;
  const res = await fetchWithAtsRateLimit("pinpointhq", PINPOINTHQ_RATE_LIMIT_WAIT_MS, requestUrl, {
    method: "GET",
    headers: {
      Accept: "application/json, text/plain, */*"
    }
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`PinpointHQ API request failed (${res.status}): ${body.slice(0, 180)}`);
  }

  const finalUrl = String(res.url || requestUrl || "").trim();
  const finalHost = String(parseUrl(finalUrl)?.hostname || "").toLowerCase();
  if (!finalHost.endsWith(".pinpointhq.com") || finalHost === "pinpointhq.com" || finalHost === "www.pinpointhq.com") {
    throw new Error(`PinpointHQ URL redirected to unexpected host: ${finalUrl}`);
  }

  return res.json();
}

async function fetchRecruitCrmJobsPage(config, limit = 100, offset = 0) {
  const payload = {
    limit,
    offset,
    search_data: "",
    onlyJobs: true
  };
  const res = await fetchWithAtsRateLimit("recruitcrm", RECRUITCRM_RATE_LIMIT_WAIT_MS, config.apiUrl, {
    method: "POST",
    headers: {
      Accept: "application/json, text/plain, */*",
      "Content-Type": "application/json",
      Origin: "https://recruitcrm.io",
      Referer: config.publicJobsUrl,
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`RecruitCRM API request failed (${res.status}): ${body.slice(0, 180)}`);
  }

  return res.json();
}

async function fetchRipplingJobsPage(config, page = 0, pageSize = 100) {
  const res = await fetchWithAtsRateLimit("rippling", RIPPLING_RATE_LIMIT_WAIT_MS, config.apiUrl, {
    method: "GET",
    headers: {
      Accept: "application/json, text/plain, */*"
    }
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Rippling API request failed (${res.status}): ${body.slice(0, 180)}`);
  }

  // Primary board API currently returns the first page without requiring params,
  // but we still keep page/pageSize inputs for future compatibility.
  const responseJson = await res.json();
  if (page > 0 || pageSize !== 100) {
    const pagedRes = await fetchWithAtsRateLimit(
      "rippling",
      RIPPLING_RATE_LIMIT_WAIT_MS,
      `${config.apiUrl}?page=${encodeURIComponent(page)}&pageSize=${encodeURIComponent(pageSize)}`,
      {
        method: "GET",
        headers: {
          Accept: "application/json, text/plain, */*"
        }
      }
    );
    if (!pagedRes.ok) {
      return responseJson;
    }
    return pagedRes.json();
  }

  return responseJson;
}

async function fetchBambooHrJobBoard(config) {
  const res = await fetchWithAtsRateLimit("bamboohr", BAMBOOHR_RATE_LIMIT_WAIT_MS, config.apiUrl, {
    method: "GET",
    headers: {
      Accept: "application/json, text/plain, */*"
    }
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`BambooHR API request failed (${res.status}): ${body.slice(0, 180)}`);
  }

  const finalUrl = String(res.url || config.apiUrl || "").trim();
  const finalHost = String(parseUrl(finalUrl)?.hostname || "").toLowerCase();
  if (!finalHost.endsWith(".bamboohr.com") || finalHost === "bamboohr.com" || finalHost === "www.bamboohr.com") {
    throw new Error(`BambooHR URL redirected to unexpected host: ${finalUrl}`);
  }

  return res.json();
}

async function fetchAdpMyjobsCareerSite(config) {
  const res = await fetchWithAtsRateLimit("adp_myjobs", ADP_MYJOBS_RATE_LIMIT_WAIT_MS, config.careerSiteUrl, {
    method: "GET",
    headers: {
      Accept: "application/json, text/plain, */*"
    }
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`ADP MyJobs career-site request failed (${res.status}): ${body.slice(0, 180)}`);
  }

  return res.json();
}

async function fetchAdpWorkforcenowContentLinks(config) {
  const url =
    `${config.contentLinksBaseUrl}?cid=${encodeURIComponent(config.cid)}` +
    `&timeStamp=${Date.now()}&ccId=${encodeURIComponent(config.ccId)}&locale=en_US&lang=en_US`;
  const res = await fetchWithAtsRateLimit("adp_workforcenow", ADP_WORKFORCENOW_RATE_LIMIT_WAIT_MS, url, {
    method: "GET",
    headers: {
      Accept: "application/json, text/plain, */*"
    }
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`ADP Workforce Now content-links request failed (${res.status}): ${body.slice(0, 180)}`);
  }
  return res.json();
}

async function fetchAdpWorkforcenowJobsPage(config) {
  const res = await fetchWithAtsRateLimit(
    "adp_workforcenow",
    ADP_WORKFORCENOW_RATE_LIMIT_WAIT_MS,
    config.jobRequisitionsUrl,
    {
      method: "GET",
      headers: {
        Accept: "application/json, text/plain, */*"
      }
    }
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`ADP Workforce Now job-requisitions request failed (${res.status}): ${body.slice(0, 180)}`);
  }
  return res.json();
}

function extractCookieHeaderFromResponse(response) {
  const setCookieValues =
    typeof response?.headers?.getSetCookie === "function"
      ? response.headers.getSetCookie()
      : String(response?.headers?.get("set-cookie") || "")
          .split(/,(?=[^;]+=)/g)
          .map((item) => item.trim())
          .filter(Boolean);
  const cookiePairs = [];
  const seenNames = new Set();
  for (const rawCookie of setCookieValues) {
    const cookie = String(rawCookie || "").trim();
    if (!cookie) continue;
    const firstPart = cookie.split(";")[0]?.trim() || "";
    if (!firstPart || !firstPart.includes("=")) continue;
    const name = firstPart.split("=")[0]?.trim().toLowerCase();
    if (!name || seenNames.has(name)) continue;
    seenNames.add(name);
    cookiePairs.push(firstPart);
  }
  return cookiePairs.join("; ");
}

async function fetchBrassringMatchedJobs(config) {
  const boardRes = await fetchWithAtsRateLimit("brassring", BRASSRING_RATE_LIMIT_WAIT_MS, config.boardUrl, {
    method: "GET",
    headers: {
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    }
  });
  if (!boardRes.ok) {
    const body = await boardRes.text();
    throw new Error(`BrassRing board request failed (${boardRes.status}): ${body.slice(0, 180)}`);
  }

  const finalBoardUrl = String(boardRes.url || config.boardUrl || "").trim();
  const finalHost = String(parseUrl(finalBoardUrl)?.hostname || "").toLowerCase();
  if (finalHost !== "sjobs.brassring.com" && finalHost !== "www.sjobs.brassring.com") {
    throw new Error(`BrassRing URL redirected to unexpected host: ${finalBoardUrl}`);
  }

  const pageHtml = await boardRes.text();
  const requestVerificationToken = extractBrassringHiddenInput(pageHtml, "__RequestVerificationToken");
  const encryptedSessionValue = extractBrassringHiddenInput(pageHtml, "CookieValue");
  const rftHeaderValue = requestVerificationToken || extractBrassringHiddenInput(pageHtml, "hdRft");
  const cookieHeader = extractCookieHeaderFromResponse(boardRes);
  const companyName = extractBrassringCompanyName(pageHtml);

  const payload = {
    PartnerId: config.partnerId,
    SiteId: config.siteId,
    Keyword: "",
    Location: "",
    LocationCustomSolrFields: "Location",
    FacetFilterFields: null,
    TurnOffHttps: false,
    Latitude: 0,
    Longitude: 0,
    PowerSearchOptions: { PowerSearchOption: [] },
    encryptedsessionvalue: encryptedSessionValue
  };

  const headers = {
    Accept: "application/json, text/javascript, */*; q=0.01",
    "Content-Type": "application/json; charset=utf-8",
    Origin: "https://sjobs.brassring.com",
    Referer: config.boardUrl,
    "X-Requested-With": "XMLHttpRequest",
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
  };
  if (rftHeaderValue) headers.RFT = rftHeaderValue;
  if (cookieHeader) headers.Cookie = cookieHeader;

  const res = await fetchWithAtsRateLimit("brassring", BRASSRING_RATE_LIMIT_WAIT_MS, config.apiUrl, {
    method: "POST",
    headers,
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`BrassRing MatchedJobs request failed (${res.status}): ${body.slice(0, 180)}`);
  }

  const responseJson = await res.json();
  return { responseJson, companyName };
}

async function fetchAdpMyjobsJobsPage(config, careerSiteJson, top = 100, skip = 0) {
  const myJobsToken = String(careerSiteJson?.myJobsToken || "").trim();
  const myadpUrl = String(careerSiteJson?.properties?.myadpUrl || "").trim().replace(/\/+$/, "");
  if (!myJobsToken || !myadpUrl) {
    return { count: 0, jobRequisitions: [] };
  }

  const params = new URLSearchParams({
    $select:
      "reqId,jobTitle,publishedJobTitle,type,jobDescription,jobQualifications,workLocations,workLevelCode,clientRequisitionID,postingDate,requisitionLocations,postingLocations,organizationalUnits",
    $top: String(Math.max(1, Number(top || 100))),
    $skip: String(Math.max(0, Number(skip || 0))),
    $filter: "",
    radius: "25",
    tz: "America/Los_Angeles"
  }).toString();
  const apiUrl = `${myadpUrl}/myadp_prefix/mycareer/public/staffing/v1/job-requisitions/apply-custom-filters?${params}`;

  const res = await fetchWithAtsRateLimit("adp_myjobs", ADP_MYJOBS_RATE_LIMIT_WAIT_MS, apiUrl, {
    method: "GET",
    headers: {
      Accept: "application/json, text/plain, */*",
      "Accept-Language": "en-US,en;q=0.9",
      myjobstoken: myJobsToken,
      rolecode: "manager",
      Origin: "https://myjobs.adp.com",
      Referer: config.boardUrl
    }
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`ADP MyJobs jobs request failed (${res.status}): ${body.slice(0, 180)}`);
  }

  return res.json();
}

async function fetchCareerpuckJobBoard(config) {
  const res = await fetchWithAtsRateLimit("careerpuck", CAREERPUCK_RATE_LIMIT_WAIT_MS, config.apiUrl, {
    method: "GET",
    headers: {
      Accept: "application/json"
    }
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`CareerPuck API request failed (${res.status}): ${body.slice(0, 180)}`);
  }

  return res.json();
}

async function fetchFountainJobBoard(config) {
  const res = await fetchWithAtsRateLimit("fountain", FOUNTAIN_RATE_LIMIT_WAIT_MS, config.apiUrl, {
    method: "GET",
    headers: {
      Accept: "application/json"
    }
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Fountain API request failed (${res.status}): ${body.slice(0, 180)}`);
  }

  return res.json();
}

async function fetchGetroJobsPage(urlString) {
  const res = await fetchWithAtsRateLimit("getro", GETRO_RATE_LIMIT_WAIT_MS, urlString, {
    method: "GET",
    headers: {
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    }
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Getro page request failed (${res.status}): ${body.slice(0, 180)}`);
  }

  return res.text();
}

async function fetchHrmDirectJobsPage(urlString) {
  const res = await fetchWithAtsRateLimit("hrmdirect", HRMDIRECT_RATE_LIMIT_WAIT_MS, urlString, {
    method: "GET",
    headers: {
      Accept: "text/html,application/xhtml+xml"
    }
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`HRMDirect page request failed (${res.status}): ${body.slice(0, 180)}`);
  }

  const finalUrl = String(res.url || urlString || "").trim();
  const finalHost = String(parseUrl(finalUrl)?.hostname || "").toLowerCase();
  if (!finalHost.endsWith(".hrmdirect.com")) {
    throw new Error(`HRMDirect URL redirected to unexpected host: ${finalUrl}`);
  }

  return { pageHtml: await res.text(), finalUrl };
}

async function fetchTalentlyftLandingPage(urlString) {
  const res = await fetchWithAtsRateLimit("talentlyft", TALENTLYFT_RATE_LIMIT_WAIT_MS, urlString, {
    method: "GET",
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    }
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Talentlyft landing page request failed (${res.status}): ${body.slice(0, 180)}`);
  }

  const finalUrl = String(res.url || urlString || "").trim();
  const finalHost = String(parseUrl(finalUrl)?.hostname || "").toLowerCase();
  if (!finalHost.endsWith(".talentlyft.com")) {
    throw new Error(`Talentlyft URL redirected to unexpected host: ${finalUrl}`);
  }

  return { pageHtml: await res.text(), finalUrl };
}

async function fetchTalentlyftJobListFragment(config, page = 1, pageSize = 20) {
  const apiUrl = String(config?.apiUrl || "").trim();
  if (!apiUrl) {
    throw new Error("Talentlyft API URL is missing");
  }

  const params = new URLSearchParams({
    layoutId: String(config?.layoutId || "Jobs-1"),
    websiteUrl: String(config?.websiteUrl || ""),
    themeId: String(config?.themeId || "2"),
    language: String(config?.language || "en"),
    subdomain: String(config?.subdomain || ""),
    page: String(page),
    pageSize: String(pageSize),
    contains: ""
  }).toString();
  const url = `${apiUrl}${apiUrl.includes("?") ? "&" : "?"}${params}`;

  const res = await fetchWithAtsRateLimit("talentlyft", TALENTLYFT_RATE_LIMIT_WAIT_MS, url, {
    method: "GET",
    headers: {
      Accept: "text/html, */*; q=0.01",
      "x-requested-with": "XMLHttpRequest",
      Referer: `${String(config?.websiteUrl || "").replace(/\/+$/, "")}/`,
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    }
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Talentlyft JobList request failed (${res.status}): ${body.slice(0, 180)}`);
  }

  return res.text();
}

async function fetchTalexioJobsPage(config, page = 1, limit = 10) {
  const apiUrl = String(config?.apiUrl || "").trim();
  if (!apiUrl) {
    throw new Error("Talexio API URL is missing");
  }

  const url = `${apiUrl}?${new URLSearchParams({
    search: "",
    sortBy: "relevance",
    page: String(page),
    limit: String(limit)
  }).toString()}`;

  const res = await fetchWithAtsRateLimit("talexio", TALEXIO_RATE_LIMIT_WAIT_MS, url, {
    method: "GET",
    headers: {
      Accept: "application/json"
    }
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Talexio API request failed (${res.status}): ${body.slice(0, 180)}`);
  }

  return res.json();
}

function buildSapHrCloudSearchPayload(locale = "en_US", pageNumber = 0) {
  const normalizedPage = Math.max(0, Math.floor(Number(pageNumber || 0)));
  return {
    locale: String(locale || "en_US"),
    pageNumber: normalizedPage,
    sortBy: "",
    keywords: "",
    location: "",
    facetFilters: {},
    brand: "",
    skills: [],
    categoryId: 0,
    alertId: "",
    rcmCandidateId: ""
  };
}

async function fetchSapHrCloudJobsPage(config, locale = "en_US", pageNumber = 0) {
  const payload = buildSapHrCloudSearchPayload(locale, pageNumber);
  const res = await fetchWithAtsRateLimit("saphrcloud", SAPHRCLOUD_RATE_LIMIT_WAIT_MS, config.apiUrl, {
    method: "POST",
    headers: {
      Accept: "application/json, text/plain, */*",
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`SAP HR Cloud API request failed (${res.status}): ${body.slice(0, 180)}`);
  }

  return res.json();
}

async function fetchSapHrCloudBoardPage(urlString) {
  const res = await fetchWithAtsRateLimit("saphrcloud", SAPHRCLOUD_RATE_LIMIT_WAIT_MS, urlString, {
    method: "GET",
    headers: {
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    }
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`SAP HR Cloud page request failed (${res.status}): ${body.slice(0, 180)}`);
  }

  return {
    pageHtml: await res.text(),
    finalUrl: String(res.url || urlString || "").trim()
  };
}

function buildUltiProSearchPayload(top, skip) {
  return {
    opportunitySearch: {
      Top: Number(top || ULTIPRO_PAGE_SIZE),
      Skip: Number(skip || 0),
      QueryString: "",
      OrderBy: [
        {
          Value: "postedDateDesc",
          PropertyName: "PostedDate",
          Ascending: false
        }
      ],
      Filters: [
        { t: "TermsSearchFilterDto", fieldName: 4, extra: null, values: [] },
        { t: "TermsSearchFilterDto", fieldName: 5, extra: null, values: [] },
        { t: "TermsSearchFilterDto", fieldName: 6, extra: null, values: [] },
        { t: "TermsSearchFilterDto", fieldName: 37, extra: null, values: [] }
      ]
    },
    matchCriteria: {
      PreferredJobs: [],
      Educations: [],
      LicenseAndCertifications: [],
      Skills: [],
      hasNoLicenses: false,
      SkippedSkills: []
    }
  };
}

async function fetchUltiProSearchResults(config, top, skip) {
  const tenantEncoded = encodeURIComponent(String(config?.tenant || "").trim());
  const boardIdEncoded = encodeURIComponent(String(config?.boardId || "").trim());
  const apiUrl = `https://recruiting.ultipro.com/${tenantEncoded}/JobBoard/${boardIdEncoded}/JobBoardView/LoadSearchResults`;
  const payload = buildUltiProSearchPayload(top, skip);

  const res = await fetchWithAtsRateLimit("ultipro", ULTIPRO_RATE_LIMIT_WAIT_MS, apiUrl, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`UltiPro request failed (${res.status}): ${body.slice(0, 180)}`);
  }

  return res.json();
}

async function fetchTaleoJobSearchPage(urlString) {
  const res = await fetchWithAtsRateLimit("taleo", TALEO_RATE_LIMIT_WAIT_MS, urlString, {
    method: "GET",
    headers: {
      Accept: "text/html,application/xhtml+xml"
    }
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Taleo page request failed (${res.status}): ${body.slice(0, 180)}`);
  }

  return res.text();
}

async function fetchTaleoRestSearchResults(config, portal, tokenName, tokenValue, pageNo) {
  const apiUrl = `${config.baseOrigin}/careersection/rest/jobboard/searchjobs?lang=${encodeURIComponent(
    config.lang
  )}&portal=${encodeURIComponent(portal)}`;
  const payload = buildTaleoRestPayload(pageNo);

  const headers = {
    Accept: "application/json, text/javascript, */*; q=0.01",
    "Content-Type": "application/json",
    "x-requested-with": "XMLHttpRequest",
    tz: "GMT-07:00",
    tzname: "America/Los_Angeles"
  };
  if (tokenName && tokenValue) {
    headers[tokenName] = tokenValue;
  }

  const res = await fetchWithAtsRateLimit("taleo", TALEO_RATE_LIMIT_WAIT_MS, apiUrl, {
    method: "POST",
    headers,
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Taleo REST request failed (${res.status}): ${body.slice(0, 180)}`);
  }

  return res.json();
}

async function fetchTaleoAjaxSearchResults(config, csrfToken = "") {
  const apiUrl = `${config.baseSectionUrl}/jobsearch.ajax`;
  const payload = new URLSearchParams(buildTaleoAjaxPayload(config.lang, csrfToken)).toString();

  const res = await fetchWithAtsRateLimit("taleo", TALEO_RATE_LIMIT_WAIT_MS, apiUrl, {
    method: "POST",
    headers: {
      Accept: "*/*",
      "Content-Type": "application/x-www-form-urlencoded",
      "x-requested-with": "XMLHttpRequest",
      tz: "GMT-07:00",
      tzname: "America/Los_Angeles"
    },
    body: payload
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Taleo AJAX request failed (${res.status}): ${body.slice(0, 180)}`);
  }

  return res.text();
}

async function collectTodayPostingsForWorkdayCompany(company) {
  const config = parseWorkdayCompany(company.url_string);
  if (!config) return [];

  const collected = [];
  const seenUrls = new Set();
  let offset = 0;

  for (let page = 0; page < MAX_PAGES_PER_COMPANY; page += 1) {
    const response = await fetchWorkdayPage(config.cxsUrl, WORKDAY_PAGE_SIZE, offset);
    const postings = Array.isArray(response?.jobPostings) ? response.jobPostings : [];
    if (postings.length === 0) break;

    for (const parsedPosting of parseWorkdayPostingsFromApi(company.company_name, config, response)) {
      if (!parsedPosting.job_posting_url || seenUrls.has(parsedPosting.job_posting_url)) continue;
      collected.push(parsedPosting);
      seenUrls.add(parsedPosting.job_posting_url);
    }

    if (postings.length < WORKDAY_PAGE_SIZE) break;
    offset += WORKDAY_PAGE_SIZE;
  }

  return collected;
}

function parseWorkdayPostingsFromApi(companyNameForPostings, config, response) {
  const postings = Array.isArray(response?.jobPostings)
    ? response.jobPostings
    : Array.isArray(response?.data?.jobPostings)
      ? response.data.jobPostings
      : Array.isArray(response?.data?.jobs)
        ? response.data.jobs
        : Array.isArray(response?.jobs)
          ? response.jobs
          : [];
  const companyName = String(companyNameForPostings || "").trim();
  const collected = [];
  const seenUrls = new Set();

  for (const posting of postings) {
    const jobUrl = buildJobUrl(config?.companyBaseUrl, posting?.externalPath);
    if (!jobUrl || seenUrls.has(jobUrl)) continue;
    const structuredLocation = extractWorkdayStructuredLocation(posting);

    collected.push({
      company_name: companyName,
      source_job_id: extractWorkdaySourceJobId(posting, jobUrl),
      id: String(posting?.id || posting?.jobId || "").trim() || undefined,
      position_name: String(posting?.title || "").trim() || "Untitled Position",
      job_posting_url: jobUrl,
      posting_date:
        String(
          posting?.postedOn ||
            posting?.postedOnDate ||
            posting?.postedDate ||
            posting?.postingDate ||
            posting?.externalPostedOn ||
            posting?.updatedOn ||
            ""
        ).trim() || null,
      location: extractWorkdayLocationLabel(posting, jobUrl),
      city: structuredLocation.city || null,
      state: structuredLocation.state || null,
      country: structuredLocation.country || null,
      workplaceType: extractWorkdayRemoteSignal(posting, jobUrl)
    });
    seenUrls.add(jobUrl);
  }

  return collected;
}

function parseAshbyPostingsFromApi(companyNameForPostings, config, response) {
  const graphQlJobBoard = response?.data?.jobBoard;
  const jobPostings = Array.isArray(graphQlJobBoard?.jobPostings)
    ? graphQlJobBoard.jobPostings
    : Array.isArray(response?.jobs)
      ? response.jobs
      : [];
  const teams = Array.isArray(graphQlJobBoard?.teams) ? graphQlJobBoard.teams : [];
  const teamNameById = new Map(
    teams
      .map((team) => [String(team?.id || "").trim(), String(team?.externalName || team?.name || "").trim()])
      .filter(([id, name]) => id && name)
  );
  const companyName = String(companyNameForPostings || config?.organizationHostedJobsPageNameLower || "").trim();
  const collected = [];
  const seenUrls = new Set();

  for (const posting of jobPostings) {
    const jobId = String(posting?.id || "").trim();
    const jobUrl = String(posting?.jobUrl || "").trim() || buildAshbyJobUrl(config?.organizationHostedJobsPageName, jobId);
    if (!jobUrl || seenUrls.has(jobUrl)) continue;
    const primaryLocation = extractAshbyPrimaryLocationParts(posting);

    collected.push({
      company_name: companyName,
      source_job_id: jobId || extractSourceIdFromPostingUrl(jobUrl, "ashby"),
      id: jobId || undefined,
      position_name: String(posting?.title || "").trim() || "Untitled Position",
      job_posting_url: jobUrl,
      apply_url: String(posting?.applyUrl || "").trim() || jobUrl,
      posting_date: String(posting?.publishedAt || posting?.createdAt || "").trim() || null,
      location: extractAshbyLocationName(posting),
      city: primaryLocation.city || null,
      state: primaryLocation.state || null,
      country: primaryLocation.country || null,
      workplaceType: String(posting?.workplaceType || "").trim() || (posting?.isRemote === true ? "Remote" : null),
      remote: posting?.isRemote === true,
      employment_type: String(posting?.employmentType || "").trim() || null,
      department:
        String(posting?.department || posting?.team || "").trim() ||
        teamNameById.get(String(posting?.teamId || "").trim()) ||
        null,
      description_html: String(posting?.descriptionHtml || "").trim() || null,
      description_plain: String(posting?.descriptionPlain || "").trim() || null
    });
    seenUrls.add(jobUrl);
  }

  return collected;
}

async function collectPostingsForAshbyCompany(company) {
  const config = parseAshbyCompany(company.url_string);
  if (!config) return [];

  const response = await fetchAshbyJobBoard(config.organizationHostedJobsPageName);
  return parseAshbyPostingsFromApi(company.company_name, config, response);
}

async function collectPostingsForGreenhouseCompany(company) {
  const config = parseGreenhouseCompany(company.url_string);
  if (!config) return [];

  const response = await fetchGreenhouseJobBoard(config.boardToken);
  return parseGreenhousePostingsFromApi(company.company_name, config, response);
}

async function collectPostingsForLeverCompany(company) {
  const config = parseLeverCompany(company.url_string);
  if (!config) return [];

  const response = await fetchLeverJobBoard(config.organization);
  return parseLeverPostingsFromApi(company.company_name, config, response);
}

async function collectPostingsForJobviteCompany(company) {
  const config = parseJobviteCompany(company.url_string);
  if (!config) return [];

  const normalizedCompanyName = String(company?.company_name || "").trim();
  const companyNameForPostings =
    normalizedCompanyName &&
    normalizedCompanyName.toLowerCase() !== "jobs" &&
    normalizedCompanyName.toLowerCase() !== "careers"
      ? normalizedCompanyName
      : config.companySlugLower;

  const pageHtml = await fetchJobviteJobsPage(config.jobsUrl);
  return parseJobvitePostingsFromHtml(companyNameForPostings, config, pageHtml);
}

function extractApplicantProLocationLabel(job) {
  const location = String(job?.jobLocation || job?.location || job?.locationName || "").trim();
  if (location) return location;

  const city = String(job?.city || "").trim();
  const state = String(job?.abbreviation || job?.stateName || "").trim();
  const country = String(job?.country || job?.countryName || job?.iso3 || "").trim();
  const values = [city, state, country].filter(Boolean);
  return values.length > 0 ? values.join(", ") : null;
}

function parseApplicantProPostingsFromApi(companyNameForPostings, config, response) {
  const jobs = Array.isArray(response?.data?.jobs)
    ? response.data.jobs
    : Array.isArray(response?.jobs)
      ? response.jobs
      : Array.isArray(response?.data)
        ? response.data
        : [];
  const origin = String(config?.origin || "").trim();
  const companyName = String(companyNameForPostings || config?.subdomainLower || "").trim();
  const collected = [];
  const seenUrls = new Set();

  for (const job of jobs) {
    const rawJobUrl = String(job?.jobUrl || job?.url || job?.applyUrl || job?.applicationUrl || "").trim();
    const fallbackJobId = String(job?.id ?? job?.job_id ?? job?.jobId ?? job?.jobID ?? "").trim();
    const absoluteUrl = rawJobUrl
      ? new URL(rawJobUrl, origin ? `${origin}/` : "https://example.invalid/").toString()
      : fallbackJobId && origin
        ? `${origin}/jobs/${encodeURIComponent(fallbackJobId)}`
        : "";
    if (!absoluteUrl || seenUrls.has(absoluteUrl)) continue;

    collected.push({
      company_name: companyName,
      source_job_id: fallbackJobId || extractSourceIdFromPostingUrl(absoluteUrl, "applicantpro"),
      id: fallbackJobId || undefined,
      position_name: String(job?.title || job?.jobTitle || job?.name || "").trim() || "Untitled Position",
      job_posting_url: absoluteUrl,
      posting_date: String(job?.startDateRef || job?.postedDate || job?.datePosted || job?.published_at || job?.created_at || "").trim() || null,
      location: extractApplicantProLocationLabel(job),
      city: String(job?.city || "").trim() || null,
      country: String(job?.country || job?.countryName || job?.iso3 || "").trim() || null,
      department: String(job?.department?.name || job?.department || job?.jobCategory || job?.category || "").trim() || null,
      employment_type: String(job?.employmentType || job?.jobType || job?.employment_type || "").trim() || null
    });
    seenUrls.add(absoluteUrl);
  }

  return collected;
}

async function collectPostingsForApplicantProCompany(company) {
  const config = parseApplicantProCompany(company.url_string);
  if (!config) return [];

  const normalizedCompanyName = String(company?.company_name || "").trim();
  const companyNameForPostings = normalizedCompanyName || config.subdomainLower;
  const jobsPageHtml = await fetchApplicantProJobsPage(config.jobsUrl);
  const domainId = extractApplicantProDomainId(jobsPageHtml);
  if (!domainId) {
    throw new Error("ApplicantPro domain_id was not found on the jobs page");
  }

  const response = await fetchApplicantProJobsList(config, domainId);
  return parseApplicantProPostingsFromApi(companyNameForPostings, config, response);
}

async function collectPostingsForApplyToJobCompany(company) {
  const config = parseApplyToJobCompany(company.url_string);
  if (!config) return [];

  const normalizedCompanyName = String(company?.company_name || "").trim();
  const companyNameForPostings = normalizedCompanyName || config.subdomainLower;
  const pageHtml = await fetchApplyToJobPage(config.applyUrl);
  return parseApplyToJobPostingsFromHtml(companyNameForPostings, config, pageHtml);
}

async function collectPostingsForTheApplicantManagerCompany(company) {
  const config = parseTheApplicantManagerCompany(company.url_string);
  if (!config) return [];

  const normalizedCompanyName = String(company?.company_name || "").trim();
  const companyNameForPostings = normalizedCompanyName || config.companyCodeLower;
  const pageHtml = await fetchTheApplicantManagerPage(config.careersUrl);
  return parseTheApplicantManagerPostingsFromHtml(companyNameForPostings, config, pageHtml);
}

async function collectPostingsForBreezyCompany(company) {
  const config = parseBreezyCompany(company.url_string);
  if (!config) return [];

  const normalizedCompanyName = String(company?.company_name || "").trim();
  const companyNameForPostings = normalizedCompanyName || config.subdomainLower;
  const { pageHtml, finalUrl } = await fetchBreezyPortalPage(config.portalUrl);
  const parseConfig = {
    ...config,
    origin: `${parseUrl(finalUrl)?.protocol || "https:"}//${parseUrl(finalUrl)?.host || config.host}`
  };
  return parseBreezyPostingsFromHtml(companyNameForPostings, parseConfig, pageHtml);
}

async function collectPostingsForIcimsCompany(company) {
  const config = parseIcimsCompany(company.url_string);
  if (!config) return [];

  const normalizedCompanyName = String(company?.company_name || "").trim();
  const companyNameForPostings = normalizedCompanyName || config.subdomainLower;

  const wrapperHtml = await fetchIcimsPage(config.searchUrl);
  let pageUrl = extractIcimsIframeUrlFromHtml(wrapperHtml, config.searchUrl);
  const collected = [];
  const seenPostingUrls = new Set();
  const seenPageUrls = new Set();
  let detailFetches = 0;

  for (let page = 0; page < MAX_PAGES_PER_COMPANY; page += 1) {
    const normalizedPageUrl = ensureIcimsIframeUrl(pageUrl);
    if (!normalizedPageUrl || seenPageUrls.has(normalizedPageUrl)) break;
    seenPageUrls.add(normalizedPageUrl);

    const pageHtml = await fetchIcimsPage(normalizedPageUrl);
    const batch = parseIcimsPostingsFromHtml(companyNameForPostings, config, pageHtml);
    for (let posting of batch) {
      const postingUrl = String(posting?.job_posting_url || "").trim();
      if (!postingUrl || seenPostingUrls.has(postingUrl)) continue;
      seenPostingUrls.add(postingUrl);
      if (
        detailFetches < ICIMS_DETAIL_FETCH_LIMIT_PER_COMPANY &&
        (
          !String(posting?.location || "").trim() ||
          !String(posting?.posting_date || "").trim() ||
          !String(posting?.remote_type || "").trim()
        )
      ) {
        try {
          const detailHtml = await fetchIcimsPage(postingUrl);
          detailFetches += 1;
          posting = {
            ...posting,
            posting_date: posting.posting_date || extractIcimsPostingDateFromHtml(detailHtml),
            remote_type: posting.remote_type || extractIcimsRemoteTypeFromHtml(detailHtml),
            location:
              posting.location ||
              extractIcimsLocationFromHtml(detailHtml) ||
              extractIcimsLocationFromTitleOrUrl(posting.position_name, postingUrl)
          };
        } catch {
          detailFetches += 1;
        }
      }
      collected.push(posting);
    }

    const nextPageUrl = extractIcimsNextPageUrlFromHtml(pageHtml, normalizedPageUrl);
    if (!nextPageUrl) break;
    pageUrl = nextPageUrl;
  }

  return collected;
}

async function collectPostingsForZohoCompany(company) {
  const config = parseZohoCompany(company.url_string);
  if (!config) return [];

  const normalizedCompanyName = String(company?.company_name || "").trim();
  const companyNameForPostings = normalizedCompanyName || config.subdomainLower;
  const pageHtml = await fetchZohoCareersPage(config.careersUrl);
  return parseZohoPostingsFromHtml(companyNameForPostings, config, pageHtml);
}

async function collectPostingsForApplicantAiCompany(company) {
  const config = parseApplicantAiCompany(company.url_string);
  if (!config) return [];

  const normalizedCompanyName = String(company?.company_name || "").trim();
  const companyNameForPostings = normalizedCompanyName || config.slugLower;
  const pageHtml = await fetchApplicantAiCareersPage(config.careersUrl);
  return parseApplicantAiPostingsFromHtml(companyNameForPostings, config, pageHtml);
}

async function collectPostingsForGemCompany(company) {
  const config = parseGemCompany(company.url_string);
  if (!config) return [];

  const normalizedCompanyName = String(company?.company_name || "").trim();
  const companyNameForPostings = normalizedCompanyName || config.boardIdLower;
  const responseJson = await fetchGemJobBoard(config);
  return parseGemPostingsFromBatchResponse(companyNameForPostings, config, responseJson);
}

async function collectPostingsForJobApsCompany(company) {
  const config = parseJobApsCompany(company.url_string);
  if (!config) return [];

  const normalizedCompanyName = String(company?.company_name || "").trim();
  const hostPrefix = String(config.host || "").split(".")[0];
  const companyNameForPostings = normalizedCompanyName || String(hostPrefix || "").toLowerCase();
  const { pageHtml, finalUrl } = await fetchJobApsCareersPage(config.boardUrl);
  return parseJobApsPostingsFromHtml(companyNameForPostings, config, pageHtml, finalUrl || config.boardUrl);
}

async function collectPostingsForJoinCompany(company) {
  const config = parseJoinCompany(company.url_string);
  if (!config) return [];

  const normalizedCompanyName = String(company?.company_name || "").trim();
  const companyNameForPostings = normalizedCompanyName || config.companySlugLower;
  const { pageHtml, finalUrl } = await fetchJoinCompanyPage(config.boardUrl);
  const finalConfig = parseJoinCompany(finalUrl || config.boardUrl) || config;
  const nextData = extractJoinNextDataJsonFromHtml(pageHtml);
  return parseJoinPostingsFromNextData(companyNameForPostings, finalConfig.companySlug || config.companySlug, nextData);
}

async function collectPostingsForTalentreefCompany(company) {
  const config = parseTalentreefCompany(company.url_string);
  if (!config) return [];

  const normalizedCompanyName = String(company?.company_name || "").trim();
  const companyNameForPostings = normalizedCompanyName || config.companyNameLower;
  const aliasResponse = await fetchTalentreefAlias(config);
  const { clientId, brand } = extractTalentreefAliasData(aliasResponse);
  if (!clientId) return [];

  const collected = [];
  const seenUrls = new Set();
  const pageSize = 100;
  let totalHits = null;

  for (let page = 0; page < MAX_PAGES_PER_COMPANY; page += 1) {
    const from = page * pageSize;
    const responseJson = await fetchTalentreefSearchResults(config, clientId, brand, from, pageSize);
    const batch = parseTalentreefPostingsFromSearchResponse(companyNameForPostings, config, responseJson);
    for (const posting of batch) {
      const postingUrl = String(posting?.job_posting_url || "").trim();
      if (!postingUrl || seenUrls.has(postingUrl)) continue;
      seenUrls.add(postingUrl);
      collected.push(posting);
    }

    const totalRaw = responseJson?.hits?.total;
    const totalValue =
      typeof totalRaw === "number"
        ? totalRaw
        : totalRaw && typeof totalRaw === "object"
          ? Number(totalRaw?.value || 0)
          : 0;
    if (Number.isFinite(totalValue) && totalValue >= 0) {
      totalHits = totalValue;
    }
    if (batch.length < pageSize) break;
    if (Number.isFinite(totalHits) && from + pageSize >= Number(totalHits)) break;
  }

  return collected;
}

async function collectPostingsForCareerplugCompany(company) {
  const config = parseCareerplugCompany(company.url_string);
  if (!config) return [];

  const normalizedCompanyName = String(company?.company_name || "").trim();
  const companyNameForPostings = normalizedCompanyName || config.subdomainLower;
  const pageHtml = await fetchCareerplugJobsPage(config.jobsUrl);
  return parseCareerplugPostingsFromHtml(companyNameForPostings, config, pageHtml);
}

async function collectPostingsForBambooHrCompany(company) {
  const config = parseBambooHrCompany(company.url_string);
  if (!config) return [];

  const normalizedCompanyName = String(company?.company_name || "").trim();
  const companyNameForPostings = normalizedCompanyName || config.companySubdomainLower;
  const responseJson = await fetchBambooHrJobBoard(config);
  return parseBambooHrPostingsFromApi(companyNameForPostings, config, responseJson);
}

async function collectPostingsForAdpMyjobsCompany(company) {
  const config = parseAdpMyjobsCompany(company.url_string);
  if (!config) return [];

  const normalizedCompanyName = String(company?.company_name || "").trim();
  const companyNameForPostings = normalizedCompanyName || config.companyNameLower;
  const careerSiteJson = await fetchAdpMyjobsCareerSite(config);
  const pageSize = 100;
  const seenUrls = new Set();
  const collected = [];

  for (let page = 0; page < MAX_PAGES_PER_COMPANY; page += 1) {
    const skip = page * pageSize;
    const responseJson = await fetchAdpMyjobsJobsPage(config, careerSiteJson, pageSize, skip);
    const batch = parseAdpMyjobsPostingsFromApi(companyNameForPostings, config, responseJson);

    for (const posting of batch) {
      const postingUrl = String(posting?.job_posting_url || "").trim();
      if (!postingUrl || seenUrls.has(postingUrl)) continue;
      seenUrls.add(postingUrl);
      collected.push(posting);
    }

    const totalCount = Number(responseJson?.count);
    if (batch.length < pageSize) break;
    if (Number.isFinite(totalCount) && totalCount >= 0 && skip + pageSize >= totalCount) break;
  }

  return collected;
}

async function collectPostingsForAdpWorkforcenowCompany(company) {
  const config = parseAdpWorkforcenowCompany(company.url_string);
  if (!config) return [];

  const contentLinksJson = await fetchAdpWorkforcenowContentLinks(config);
  const companyNameForPostings = resolveAdpWorkforcenowCompanyName(company, config, contentLinksJson);
  const responseJson = await fetchAdpWorkforcenowJobsPage(config);
  return parseAdpWorkforcenowPostingsFromApi(companyNameForPostings, config, responseJson);
}

async function collectPostingsForPaylocityCompany(company) {
  const config = parsePaylocityCompany(company.url_string);
  if (!config) return [];

  const normalizedCompanyName = String(company?.company_name || "").trim();
  const { pageHtml, finalUrl } = await fetchPaylocityBoardPage(config);
  const runtimeConfig = parsePaylocityCompany(finalUrl) || config;
  const companyNameForPostings = normalizedCompanyName || `paylocity_${String(runtimeConfig.companyId || "").toLowerCase()}`;
  const pageData = extractPaylocityPageDataJson(pageHtml);
  const rawPostings = parsePaylocityPostingsFromPageData(companyNameForPostings, runtimeConfig, pageData);
  const collected = [];
  const seenUrls = new Set();

  for (const posting of rawPostings) {
    const postingUrl = String(posting?.job_posting_url || "").trim();
    if (!postingUrl || seenUrls.has(postingUrl)) continue;
    if (!String(posting?.posting_date || "").trim()) continue;
    seenUrls.add(postingUrl);
    collected.push(posting);
  }

  return collected;
}

async function collectPostingsForEightfoldCompany(company) {
  const config = parseEightfoldCompany(company.url_string);
  if (!config) return [];

  const normalizedCompanyName = String(company?.company_name || "").trim();
  const { pageHtml, finalUrl } = await fetchEightfoldCareersPage(config);
  const runtimeConfig = parseEightfoldCompany(finalUrl) || config;
  const domainValue = extractEightfoldDomainFromHtml(pageHtml);
  if (!domainValue) {
    throw new Error("Eightfold window._EF_GROUP_ID value not found in careers page");
  }

  const { responseJson } = await fetchEightfoldJobsApi(runtimeConfig, domainValue);
  const fallbackCompanyName = `eightfold_${String(runtimeConfig.host || "").split(".")[0] || "board"}`;
  const companyNameForPostings = normalizedCompanyName || fallbackCompanyName;
  const rawPostings = parseEightfoldPostingsFromApi(companyNameForPostings, runtimeConfig, responseJson);
  const collected = [];
  const seenUrls = new Set();

  for (const posting of rawPostings) {
    const postingUrl = String(posting?.job_posting_url || "").trim();
    if (!postingUrl || seenUrls.has(postingUrl)) continue;
    if (!String(posting?.posting_date || "").trim()) continue;
    seenUrls.add(postingUrl);
    collected.push(posting);
  }

  return collected;
}

async function collectPostingsForOracleCompany(company) {
  const config = parseOracleCompany(company.url_string);
  if (!config) return [];

  const normalizedCompanyName = String(company?.company_name || "").trim();
  const companyNameForPostings = normalizedCompanyName || "";
  const pageSize = 25;
  const seenUrls = new Set();
  const collected = [];

  for (let page = 0; page < MAX_PAGES_PER_COMPANY; page += 1) {
    const offset = page * pageSize;
    const responseJson = await fetchOracleJobRequisitionsPage(config, offset, pageSize);
    const batch = parseOraclePostingsFromApi(companyNameForPostings, config, responseJson);

    for (const posting of batch) {
      const postingUrl = String(posting?.job_posting_url || "").trim();
      if (!postingUrl || seenUrls.has(postingUrl)) continue;
      if (!String(posting?.posting_date || "").trim()) continue;
      seenUrls.add(postingUrl);
      collected.push(posting);
    }

    if (!Boolean(responseJson?.hasMore)) break;
    if (batch.length === 0) break;
  }

  return collected;
}

async function collectPostingsForBrassringCompany(company) {
  const config = parseBrassringCompany(company.url_string);
  if (!config) return [];

  const normalizedCompanyName = String(company?.company_name || "").trim();
  const { responseJson, companyName } = await fetchBrassringMatchedJobs(config);
  const companyNameForPostings =
    normalizedCompanyName ||
    String(companyName || "").trim() ||
    `${String(config.partnerId || "").trim()}_${String(config.siteId || "").trim()}`;
  return parseBrassringPostingsFromApi(companyNameForPostings, config, responseJson);
}

function normalizeApplitrackUrl(url) {
  const normalizedUrl = String(url || "").trim();
  if (!normalizedUrl) throw new Error("Applitrack URL is required");

  const parsed = parseUrl(normalizedUrl);
  if (!parsed || !parsed.protocol || !parsed.host) {
    throw new Error("Invalid Applitrack URL");
  }

  const host = String(parsed.hostname || "").toLowerCase();
  if (!host.endsWith(".applitrack.com")) {
    throw new Error(`Unexpected Applitrack host: ${parsed.host}`);
  }

  const base = `${parsed.protocol}//${parsed.host}`;
  const pathValue = String(parsed.pathname || "/");
  const lowerPath = pathValue.toLowerCase();
  const onlineAppIndex = lowerPath.indexOf("/onlineapp/");
  const rootPath = onlineAppIndex >= 0
    ? pathValue.slice(0, onlineAppIndex + "/onlineapp/".length)
    : pathValue.endsWith("default.aspx")
      ? pathValue.slice(0, -1 * "default.aspx".length)
      : pathValue;
  const normalizedRootPath = rootPath.endsWith("/") ? rootPath : `${rootPath}/`;
  return `${base}${normalizedRootPath}`;
}

function parseApplitrackPostings(outputHtml, siteRoot, companyName) {
  const page = String(outputHtml || "").replace(/\\'/g, "'");
  const postings = [];
  const seenIds = new Set();
  const applyPattern = /applyFor\(\s*["'](\d+)["']\s*,\s*["']([^"']*)["']\s*,\s*["']([^"']*)["'][^)]*\)/gi;
  const linkPattern = /<a\b[^>]*href=["']([^"']*(?:JobPostings\/view\.asp|ApplyForJob\.aspx|_application\.aspx|default\.aspx\?[^"']*JobID=)[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match = applyPattern.exec(page);

  const extractRowContext = (matchIndex) => {
    const start = page.lastIndexOf("<tr", matchIndex);
    const end = page.indexOf("</tr>", matchIndex);
    if (start >= 0 && end > start) return page.slice(start, end + "</tr>".length);
    return page.slice(Math.max(0, matchIndex - 1200), Math.min(page.length, matchIndex + 1800));
  };
  const cleanApplitrackRowText = (rowHtml) =>
    decodeHtmlEntities(String(rowHtml || "").replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, " "))
      .replace(/\s+/g, " ")
      .trim();
  const extractDateFromRow = (rowText) => {
    const compact = String(rowText || "");
    return compact.match(/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/)?.[0] ||
      compact.match(/\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},\s+\d{4}\b/i)?.[0] ||
      null;
  };
  const extractLocationFromRow = (rowText, titleParts) => {
    const compact = String(rowText || "");
    if (/\b(remote|virtual|telework|work from home)\b/i.test(compact)) return "Remote";
    const usCityState = compact.match(/\b([A-Z][A-Za-z .'-]+,\s*(?:AL|AK|AZ|AR|CA|CO|CT|DC|DE|FL|GA|HI|IA|ID|IL|IN|KS|KY|LA|MA|MD|ME|MI|MN|MO|MS|MT|NC|ND|NE|NH|NJ|NM|NV|NY|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VA|VT|WA|WI|WV|WY)(?:\s+\d{5})?)\b/);
    if (usCityState?.[1]) return usCityState[1].trim();
    const countryMatch = compact.match(/\b(United States|USA|Canada|Turkey|T[üu]rkiye|United Kingdom|Germany|France|India|Australia)\b/i);
    if (countryMatch?.[1]) return countryMatch[1].trim();
    const withoutTitle = titleParts.reduce((text, part) => part ? text.replace(new RegExp(part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), " ") : text, compact);
    const locationLabel = withoutTitle.match(/\b(?:Location|School|Site|Campus)\s*:?\s*([A-Z][^|;]{2,80})/i);
    return locationLabel?.[1] ? locationLabel[1].trim().replace(/\s{2,}/g, " ") : null;
  };
  const extractRemoteTypeFromText = (rowText) => {
    const compact = String(rowText || "");
    if (/\bhybrid\b/i.test(compact)) return "hybrid";
    if (/\b(remote|primarily remote|virtual|telework|work from home|wfh)\b/i.test(compact)) return "remote";
    if (/\b(on[- ]?site|onsite|in person|in-person)\b/i.test(compact)) return "onsite";
    return null;
  };
  const stripTitleText = (value) => cleanSmartRecruitersText(
    decodeHtmlEntities(String(value || "").replace(/<[^>]+>/g, " "))
  );
  const queryValue = (urlValue, names) => {
    try {
      const parsed = new URL(String(urlValue || ""), siteRoot);
      for (const name of names) {
        const value = cleanSmartRecruitersText(parsed.searchParams.get(name));
        if (value) return value;
      }
    } catch {
      return "";
    }
    return "";
  };
  const addPosting = ({ jobId, category, specialty, linkText, rowContext, jobUrl }) => {
    const sourceJobId = cleanSmartRecruitersText(jobId);
    if (!sourceJobId || seenIds.has(sourceJobId)) return;
    const cleanCategory = cleanSmartRecruitersText(category);
    const cleanSpecialty = cleanSmartRecruitersText(specialty);
    const linkTitle = stripTitleText(linkText);
    const title = [cleanCategory, cleanSpecialty].filter(Boolean).join(" - ") || linkTitle || `Job ${sourceJobId}`;
    const canonicalUrl = jobUrl || new URL(`default.aspx?JobID=${encodeURIComponent(sourceJobId)}`, siteRoot).toString();
    const rowText = cleanApplitrackRowText(rowContext);

    postings.push({
      company_name: companyName,
      source_job_id: sourceJobId,
      position_name: title,
      job_posting_url: canonicalUrl,
      apply_url: canonicalUrl,
      remote_type: extractRemoteTypeFromText(rowText),
      posting_date: extractDateFromRow(rowText),
      location: extractLocationFromRow(rowText, [sourceJobId, cleanCategory, cleanSpecialty, title]),
      department: cleanCategory || null
    });
    seenIds.add(sourceJobId);
  };

  while (match) {
    const jobId = cleanSmartRecruitersText(match[1]);
    if (!jobId || seenIds.has(jobId)) {
      match = applyPattern.exec(page);
      continue;
    }

    const category = cleanSmartRecruitersText(match[2]);
    const specialty = cleanSmartRecruitersText(match[3]);
    const rowContext = extractRowContext(Number(match.index || 0));
    addPosting({
      jobId,
      category,
      specialty,
      rowContext
    });
    match = applyPattern.exec(page);
  }

  match = linkPattern.exec(page);
  while (match) {
    const href = String(match[1] || "").replace(/&amp;/gi, "&");
    let parsedLink = null;
    try {
      parsedLink = new URL(href, siteRoot);
    } catch {
      match = linkPattern.exec(page);
      continue;
    }
    const jobId =
      queryValue(parsedLink.toString(), ["AppliTrackJobId", "JobID", "jobid", "posJobCodes"]) ||
      String(parsedLink.pathname || "").match(/\/jobs?\/(\d+)/i)?.[1] ||
      "";
    const rowContext = extractRowContext(Number(match.index || 0));
    addPosting({
      jobId,
      category: queryValue(parsedLink.toString(), ["posFirstChoice", "category"]),
      specialty: queryValue(parsedLink.toString(), ["posSpecialty", "specialty"]),
      linkText: match[2],
      rowContext,
      jobUrl: new URL(`default.aspx?JobID=${encodeURIComponent(jobId)}`, siteRoot).toString()
    });
    match = linkPattern.exec(page);
  }

  return postings;
}

function extractApplitrackDetailFields(detailHtml) {
  const source = String(detailHtml || "");
  const text = decodeHtmlEntities(
    source
      .replace(/&nbsp;/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(?:tr|td|th|div|p|li|span)>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/\u00a0/g, " ")
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");

  const stopLabels = [
    "Date Posted",
    "Posted",
    "Posting Date",
    "Date Available",
    "Location",
    "School",
    "Site",
    "Campus",
    "Work Location",
    "Job Location",
    "Location(s)",
    "Building",
    "Worksite",
    "Assignment Location",
    "Closing Date",
    "Position Type",
    "Category",
    "Department",
    "Remote",
    "Work Location Type",
    "Work Type"
  ];
  const cleanDetailValue = (value) => String(value || "")
    .replace(/\s+/g, " ")
    .replace(/\s*&nbsp;\s*/gi, " ")
    .trim();
  const pickLabel = (labels) => {
    const sortedLabels = [...labels].sort((left, right) => String(right || "").length - String(left || "").length);
    const labelPattern = sortedLabels.map((label) => String(label || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
    if (!labelPattern) return null;
    const stopPattern = stopLabels
      .filter((label) => !labels.includes(label))
      .map((label) => String(label || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("|");
    const inlineMatch = text.match(new RegExp(`(?:${labelPattern})\\s*:?\\s*([^\\n]{1,180}?)(?=\\s+(?:${stopPattern})\\s*:|\\n|$)`, "i"));
    if (inlineMatch?.[1]) return cleanDetailValue(inlineMatch[1]);

    const lines = text.split(/\n+/);
    for (let index = 0; index < lines.length - 1; index += 1) {
      if (new RegExp(`^(?:${labelPattern})\\s*:?$`, "i").test(lines[index])) {
        return cleanDetailValue(lines[index + 1]) || null;
      }
    }
    return null;
  };
  const extractFooterAddressLocation = () => {
    const match = text.match(/\b([A-Z][A-Za-z .'-]+,\s*(?:AL|AK|AZ|AR|CA|CO|CT|DC|DE|FL|GA|HI|IA|ID|IL|IN|KS|KY|LA|MA|MD|ME|MI|MN|MO|MS|MT|NC|ND|NE|NH|NJ|NM|NV|NY|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VA|VT|WA|WI|WV|WY)\s+\d{5})\b/);
    return match?.[1] ? cleanDetailValue(match[1]) : null;
  };
  const rawLocation = pickLabel(["Location", "Location(s)", "School", "Site", "Campus", "Building", "Worksite", "Assignment Location", "Work Location", "Job Location"]);
  const genericLocation = /^(district\s*wide|various|multiple|tbd|n\/a|to be determined)$/i.test(cleanDetailValue(rawLocation));
  const footerAddress = extractFooterAddressLocation();

  return {
    posting_date:
      pickLabel(["Date Posted", "Posted", "Posting Date", "Date Available"]) ||
      text.match(/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/)?.[0] ||
      null,
    location: genericLocation ? rawLocation : (rawLocation || footerAddress),
    department: pickLabel(["Position Type", "Category", "Department"]),
    remote_type: normalizeExplicitRemoteValue(
      pickLabel(["Remote", "Work Location Type", "Work Type"]) ||
      text.match(/\b(?:primarily remote|remote|hybrid|telework|work from home|wfh|on[- ]?site|onsite)\b/i)?.[0] ||
      ""
    )
  };
}

function buildApplitrackDetailUrl(siteRoot, jobId, fallbackJobUrl = "") {
  const sourceJobId = String(jobId || "").trim();
  if (!sourceJobId) return String(fallbackJobUrl || "").trim();
  const detailUrl = new URL("JobPostings/view.asp", siteRoot);
  detailUrl.searchParams.set("AppliTrackJobId", sourceJobId);
  detailUrl.searchParams.set("AppliTrackLayoutMode", "detail");
  detailUrl.searchParams.set("AppliTrackViewPosting", "1");
  detailUrl.searchParams.set("all", "1");
  detailUrl.searchParams.set("embed", "1");
  return detailUrl.toString();
}

async function fetchApplitrackDetailFields(jobUrl) {
  const res = await fetchWithAtsRateLimit("applitrack", APPLITRACK_RATE_LIMIT_WAIT_MS, jobUrl, {
    method: "GET",
    headers: {
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9"
    }
  });
  if (!res.ok) return {};
  return extractApplitrackDetailFields(await res.text());
}

async function collectPostingsForApplitrackCompany(company) {
  const siteRoot = normalizeApplitrackUrl(company?.url_string);
  const outputUrl = new URL("jobpostings/Output.asp?all=1", siteRoot).toString();
  const res = await fetchWithAtsRateLimit("applitrack", APPLITRACK_RATE_LIMIT_WAIT_MS, outputUrl, {
    method: "GET",
    headers: {
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9"
    }
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Applitrack request failed (${res.status}): ${body.slice(0, 180)}`);
  }

  const pageHtml = await res.text();
  const companyName = String(company?.company_name || "").trim() || "Unknown Company";
  const postings = parseApplitrackPostings(pageHtml, siteRoot, companyName);
  let detailFetches = 0;
  for (const posting of postings) {
    if (detailFetches >= APPLITRACK_DETAIL_FETCH_LIMIT_PER_COMPANY) break;
    if (String(posting?.location || "").trim() && String(posting?.posting_date || "").trim()) continue;
    try {
      const detailUrl = buildApplitrackDetailUrl(siteRoot, posting.source_job_id, posting.job_posting_url);
      const detail = await fetchApplitrackDetailFields(detailUrl);
      detailFetches += 1;
      posting.location = posting.location || detail.location || null;
      posting.posting_date = posting.posting_date || detail.posting_date || null;
      posting.remote_type = posting.remote_type || detail.remote_type || null;
      posting.department = posting.department || detail.department || null;
    } catch {
      detailFetches += 1;
    }
  }
  return postings;
}

function parseHibobCompany(url) {
  const normalizedUrl = String(url || "").trim();
  if (!normalizedUrl) return null;

  const parsed = parseUrl(normalizedUrl);
  if (!parsed || !parsed.protocol || !parsed.host) return null;

  const host = String(parsed.hostname || "").toLowerCase();
  if (!host.endsWith(".careers.hibob.com")) return null;

  const companySubdomain = host.replace(".careers.hibob.com", "").trim();
  if (!companySubdomain) return null;

  return {
    baseOrigin: `${parsed.protocol}//${parsed.host}`,
    apiUrl: `${parsed.protocol}//${parsed.host}/api/job-ad`,
    companySubdomain
  };
}

async function fetchHibobJobBoard(config, boardUrl) {
  const boardResponse = await fetchWithAtsRateLimit("hibob", HIBOB_RATE_LIMIT_WAIT_MS, boardUrl, {
    method: "GET",
    headers: {
      "User-Agent": DEFAULT_BROWSER_USER_AGENT,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9"
    }
  });
  if (!boardResponse.ok) {
    const body = await boardResponse.text();
    throw new Error(`HiBob board request failed (${boardResponse.status}): ${body.slice(0, 180)}`);
  }

  const apiResponse = await fetchWithAtsRateLimit("hibob", HIBOB_RATE_LIMIT_WAIT_MS, config.apiUrl, {
    method: "GET",
    headers: {
      "User-Agent": DEFAULT_BROWSER_USER_AGENT,
      Accept: "application/json, text/plain, */*",
      "Accept-Language": "en-US,en;q=0.9",
      Referer: boardUrl,
      Origin: config.baseOrigin
    }
  });

  if (!apiResponse.ok) {
    const body = await apiResponse.text();
    throw new Error(`HiBob API request failed (${apiResponse.status}): ${body.slice(0, 180)}`);
  }
  return apiResponse.json();
}

function parseHibobPostingsFromApi(companyName, config, responseJson) {
  if (!responseJson || typeof responseJson !== "object") return [];
  const postings = [];
  const seenUrls = new Set();
  const jobAds = Array.isArray(responseJson.jobAdDetails) ? responseJson.jobAdDetails : [];

  for (const item of jobAds) {
    if (!item || typeof item !== "object") continue;
    const jobId = cleanText(item.id);
    if (!jobId) continue;

    const postingUrl = cleanText(item.jobUrl) || cleanText(item.absoluteUrl) || cleanText(item.url);
    const urlValue = postingUrl || `${config.baseOrigin}/job/${jobId}`;
    if (!urlValue || seenUrls.has(urlValue)) continue;

    const title = cleanText(item.title) || "Untitled Position";
    const location = cleanText(item.site) || cleanText(item.country) || null;
    const postingDate = cleanText(item.publishedAt) || null;

    postings.push({
      company_name: companyName,
      position_name: title,
      job_posting_url: urlValue,
      posting_date: postingDate,
      location
    });
    seenUrls.add(urlValue);
  }

  return postings;
}

async function collectPostingsForHibobCompany(company) {
  const config = parseHibobCompany(company?.url_string);
  if (!config) return [];

  const normalizedCompanyName = String(company?.company_name || "").trim();
  const companyNameForPostings = normalizedCompanyName || config.companySubdomain;
  const responseJson = await fetchHibobJobBoard(config, company.url_string);
  return parseHibobPostingsFromApi(companyNameForPostings, config, responseJson);
}

function parseIsolvisolvedhireCompany(url) {
  const normalizedUrl = String(url || "").trim();
  if (!normalizedUrl) return null;

  const parsed = parseUrl(normalizedUrl);
  if (!parsed || !parsed.protocol || !parsed.host) return null;
  const host = String(parsed.hostname || "").toLowerCase();
  if (!host.endsWith(".isolvedhire.com")) return null;

  return {
    baseOrigin: `${parsed.protocol}//${parsed.host}`,
    boardUrl: normalizedUrl,
    host
  };
}

function extractIsolvisolvedhireDomainId(pageHtml) {
  const page = String(pageHtml || "");
  const routeDataMatch = page.match(/courierCurrentRouteData\s*=\s*(\{[\s\S]*?\});/i);
  if (routeDataMatch) {
    try {
      const parsed = JSON.parse(routeDataMatch[1]);
      const domainId = cleanText(parsed?.domain_id);
      if (domainId) return domainId;
    } catch {}
  }

  const directMatch = page.match(/"domain_id"\s*:\s*"?(?<id>\d+)"?/i);
  if (directMatch?.groups?.id) return cleanText(directMatch.groups.id);
  return "";
}

async function fetchIsolvisolvedhireJobBoard(config) {
  const boardResponse = await fetchWithAtsRateLimit(
    "isolvisolvedhire",
    ISOLVISOLVEDHIRE_RATE_LIMIT_WAIT_MS,
    config.boardUrl,
    {
      method: "GET",
      headers: {
        "User-Agent": DEFAULT_BROWSER_USER_AGENT,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9"
      }
    }
  );
  if (!boardResponse.ok) {
    const body = await boardResponse.text();
    throw new Error(`isolvedhire board request failed (${boardResponse.status}): ${body.slice(0, 180)}`);
  }
  const boardHtml = await boardResponse.text();
  const domainId = extractIsolvisolvedhireDomainId(boardHtml);
  if (!domainId) throw new Error("isolvedhire domain_id not found in board HTML");

  const apiUrl = `${config.baseOrigin}/core/jobs/${encodeURIComponent(domainId)}?getParams=%7B%7D`;
  const apiResponse = await fetchWithAtsRateLimit(
    "isolvisolvedhire",
    ISOLVISOLVEDHIRE_RATE_LIMIT_WAIT_MS,
    apiUrl,
    {
      method: "GET",
      headers: {
        "User-Agent": DEFAULT_BROWSER_USER_AGENT,
        Accept: "application/json, text/plain, */*",
        "Accept-Language": "en-US,en;q=0.9",
        Referer: config.boardUrl,
        Origin: config.baseOrigin
      }
    }
  );
  if (!apiResponse.ok) {
    const body = await apiResponse.text();
    throw new Error(`isolvedhire API request failed (${apiResponse.status}): ${body.slice(0, 180)}`);
  }
  return apiResponse.json();
}

function parseIsolvisolvedhirePostingsFromApi(companyName, responseJson) {
  if (!responseJson || typeof responseJson !== "object") return [];
  const jobs = Array.isArray(responseJson?.data?.jobs) ? responseJson.data.jobs : [];
  const postings = [];
  const seenUrls = new Set();

  for (const job of jobs) {
    if (!job || typeof job !== "object") continue;
    const postingUrl = cleanText(job.jobUrl) || "";
    if (!postingUrl || seenUrls.has(postingUrl)) continue;
    const sourceJobId =
      cleanText(job.id) ||
      cleanText(job.jobId) ||
      extractSourceIdFromPostingUrl(postingUrl, "isolvisolvedhire");

    postings.push({
      company_name: companyName,
      source_job_id: sourceJobId,
      id: sourceJobId || undefined,
      position_name: cleanText(job.title) || "Untitled Position",
      job_posting_url: postingUrl,
      posting_date: cleanText(job.startDateRef) || null,
      location: cleanText(job.jobLocation) || null
    });
    seenUrls.add(postingUrl);
  }
  return postings;
}

async function collectPostingsForIsolvisolvedhireCompany(company) {
  const config = parseIsolvisolvedhireCompany(company?.url_string);
  if (!config) return [];

  const normalizedCompanyName = String(company?.company_name || "").trim();
  const companyNameForPostings = normalizedCompanyName || config.host.split(".")[0];
  const responseJson = await fetchIsolvisolvedhireJobBoard(config);
  return parseIsolvisolvedhirePostingsFromApi(companyNameForPostings, responseJson);
}

async function collectPostingsForManatalCompany(company) {
  const config = parseManatalCompany(company.url_string);
  if (!config) return [];

  const normalizedCompanyName = String(company?.company_name || "").trim();
  const companyNameForPostings = normalizedCompanyName || config.domainSlugLower;

  const landing = await fetchManatalCareersPage(config.careersUrl || company.url_string);
  const pageHtml = String(landing?.pageHtml || "");
  const runtimeConfig = extractManatalPageRuntimeConfig(pageHtml, config, landing?.finalUrl || config.careersUrl);

  const collected = [];
  const seenUrls = new Set();

  for (let page = 1; page <= MAX_PAGES_PER_COMPANY; page += 1) {
    let responseJson = {};
    try {
      responseJson = await fetchManatalJobsApiPage(runtimeConfig, page, 50);
    } catch (error) {
      const status = Number(error?.status || 0);
      if (status === 404) {
        break;
      }
      if (page > 1) break;
      throw error;
    }

    const batch = parseManatalPostingsFromApi(companyNameForPostings, runtimeConfig, responseJson);
    for (const posting of batch) {
      const postingUrl = String(posting?.job_posting_url || "").trim();
      if (!postingUrl || seenUrls.has(postingUrl)) continue;
      seenUrls.add(postingUrl);
      collected.push(posting);
    }

    const results = Array.isArray(responseJson?.results) ? responseJson.results : [];
    const totalCount = Number(responseJson?.count);
    const nextUrl = String(responseJson?.next || "").trim();
    if (results.length === 0) break;
    if (!nextUrl) break;
    if (Number.isFinite(totalCount) && totalCount >= 0 && collected.length >= totalCount) break;
  }

  if (collected.length > 0) return collected;

  if (pageHtml) {
    const fallbackPostings = parseManatalPostingsFromHtml(companyNameForPostings, runtimeConfig, pageHtml);
    for (const posting of fallbackPostings) {
      const postingUrl = String(posting?.job_posting_url || "").trim();
      if (!postingUrl || seenUrls.has(postingUrl)) continue;
      seenUrls.add(postingUrl);
      collected.push(posting);
    }
  }

  return collected;
}

async function collectPostingsForCareerspageCompany(company) {
  const config = parseCareerspageCompany(company.url_string);
  if (!config) return [];

  const normalizedCompanyName = String(company?.company_name || "").trim();
  const companyNameForPostings = normalizedCompanyName || config.companySlugLower;
  const { pageHtml } = await fetchCareerspageBoardPage(config.boardUrl);
  return parseCareerspagePostingsFromHtml(companyNameForPostings, config, pageHtml);
}

async function collectPostingsForPageupCompany(company) {
  const config = parsePageupCompany(company.url_string);
  if (!config) return [];

  const normalizedCompanyName = String(company?.company_name || "").trim();
  const { pageHtml, finalUrl } = await fetchPageupBoardPage(config);
  const finalParsed = parseUrl(finalUrl);
  const baseOrigin = `${finalParsed?.protocol || "https:"}//${finalParsed?.host || config.host}`;
  const routeConfig = extractPageupRouteConfigFromUrl(finalUrl, config.routeType, config.locale);
  const runtimeConfig = {
    ...config,
    baseOrigin,
    boardUrl: finalUrl || config.boardUrl,
    routeType: routeConfig.routeType,
    locale: routeConfig.locale,
    searchUrl: `${baseOrigin}/${encodeURIComponent(config.boardId)}/${routeConfig.routeType}/${routeConfig.locale}/search/`
  };

  const inferredCompanyName = extractPageupCompanyNameFromTitle(pageHtml);
  const companyNameForPostings =
    normalizedCompanyName ||
    (inferredCompanyName !== "Unknown Company" ? inferredCompanyName : "") ||
    `pageup_${String(config.boardId || "").toLowerCase()}`;
  const { responseJson } = await fetchPageupSearchResults(runtimeConfig);
  const resultsHtml = String(responseJson?.results || "");
  const rawPostings = parsePageupPostingsFromResults(companyNameForPostings, runtimeConfig, resultsHtml);
  const collected = [];
  const seenUrls = new Set();

  for (const posting of rawPostings) {
    const postingUrl = String(posting?.job_posting_url || "").trim();
    if (!postingUrl || seenUrls.has(postingUrl)) continue;

    let postingDate = "";
    try {
      const detailsHtml = await fetchPageupDetailsPage(postingUrl);
      postingDate = String(extractPageupPostingDateFromDetailHtml(detailsHtml) || "").trim();
    } catch {
      continue;
    }
    if (!postingDate) continue;

    collected.push({
      ...posting,
      posting_date: postingDate
    });
    seenUrls.add(postingUrl);
  }

  return collected;
}

async function collectPostingsForHirebridgeCompany(company) {
  const config = parseHirebridgeCompany(company.url_string);
  if (!config) return [];

  const normalizedCompanyName = String(company?.company_name || "").trim();
  const companyNameForPostings = normalizedCompanyName || `hirebridge_${config.cid}`;
  const { pageHtml, finalUrl } = await fetchHirebridgeJobsPage(config);
  const finalParsed = parseUrl(finalUrl);
  const parseConfig = {
    ...config,
    baseOrigin: `${finalParsed?.protocol || "https:"}//${finalParsed?.host || config.host}`,
    boardUrl: finalUrl || config.boardUrl
  };

  const rawPostings = parseHirebridgePostingsFromHtml(companyNameForPostings, parseConfig, pageHtml);
  const collected = [];
  const seenUrls = new Set();

  for (const posting of rawPostings) {
    const postingUrl = String(posting?.job_posting_url || "").trim();
    if (!postingUrl || seenUrls.has(postingUrl)) continue;

    let postingDate = "";
    try {
      const detailsHtml = await fetchHirebridgeDetailsPage(parseConfig, postingUrl);
      postingDate = String(extractHirebridgeDatePostedFromDetailHtml(detailsHtml) || "").trim();
    } catch {
      continue;
    }
    if (!postingDate) continue;

    collected.push({
      ...posting,
      posting_date: postingDate
    });
    seenUrls.add(postingUrl);
  }

  return collected;
}

async function collectPostingsForTeamtailorCompany(company) {
  const config = parseTeamtailorCompany(company.url_string);
  if (!config) return [];

  const normalizedCompanyName = String(company?.company_name || "").trim();
  const companyNameForPostings = normalizedCompanyName || config.subdomainLower;
  const { pageHtml, finalUrl } = await fetchTeamtailorJobsPage(config);
  const finalParsed = parseUrl(finalUrl);
  const parseConfig = {
    ...config,
    baseOrigin: `${finalParsed?.protocol || "https:"}//${finalParsed?.host || config.host}`,
    jobsUrl: finalUrl || config.jobsUrl
  };
  return parseTeamtailorPostingsFromHtml(companyNameForPostings, parseConfig, pageHtml);
}

async function collectPostingsForFreshteamCompany(company) {
  const config = parseFreshteamCompany(company.url_string);
  if (!config) return [];

  const normalizedCompanyName = String(company?.company_name || "").trim();
  const companyNameForPostings = normalizedCompanyName || config.subdomainLower;
  const { pageHtml, finalUrl } = await fetchFreshteamJobsPage(config);
  const finalParsed = parseUrl(finalUrl);
  const parseConfig = {
    ...config,
    baseOrigin: `${finalParsed?.protocol || "https:"}//${finalParsed?.host || config.host}`,
    jobsUrl: finalUrl || config.jobsUrl
  };
  return parseFreshteamPostingsFromHtml(companyNameForPostings, parseConfig, pageHtml);
}

async function collectPostingsForSagehrCompany(company) {
  const config = parseSagehrCompany(company.url_string);
  if (!config) return [];

  const normalizedCompanyName = String(company?.company_name || "").trim();
  const { pageHtml, finalUrl } = await fetchSagehrJobsPage(config);
  const finalParsed = parseUrl(finalUrl);
  const parseConfig = {
    ...config,
    baseOrigin: `${finalParsed?.protocol || "https:"}//${finalParsed?.host || config.host}`,
    boardUrl: finalUrl || config.boardUrl
  };
  const inferredCompanyName = extractSagehrCompanyNameFromHtml(pageHtml);
  const companyNameForPostings =
    normalizedCompanyName ||
    (inferredCompanyName !== "Unknown Company" ? inferredCompanyName : "") ||
    `sagehr_${config.companySlugLower}`;

  return parseSagehrPostingsFromHtml(companyNameForPostings, parseConfig, pageHtml);
}

async function collectPostingsForPeopleforceCompany(company) {
  const config = parsePeopleforceCompany(company.url_string);
  if (!config) return [];

  const normalizedCompanyName = String(company?.company_name || "").trim();
  const companyNameForPostings = normalizedCompanyName || config.subdomainLower;
  const { pageHtml, finalUrl } = await fetchPeopleforceJobsPage(config);
  if (!pageHtml) return [];

  const finalParsed = parseUrl(finalUrl);
  const parseConfig = {
    ...config,
    baseOrigin: `${finalParsed?.protocol || "https:"}//${finalParsed?.host || config.host}`,
    jobsUrl: finalUrl || config.jobsUrl
  };
  return parsePeopleforcePostingsFromHtml(companyNameForPostings, parseConfig, pageHtml);
}

async function collectPostingsForSimplicantCompany(company) {
  const config = parseSimplicantCompany(company.url_string);
  if (!config) return [];

  const normalizedCompanyName = String(company?.company_name || "").trim();
  const companyNameForPostings = normalizedCompanyName || config.subdomainLower;
  const { pageHtml, finalUrl } = await fetchSimplicantJobsPage(config);
  if (/page you were looking for could not be found/i.test(pageHtml)) return [];

  const finalParsed = parseUrl(finalUrl);
  const parseConfig = {
    ...config,
    baseOrigin: `${finalParsed?.protocol || "https:"}//${finalParsed?.host || config.host}`,
    jobsUrl: finalUrl || config.jobsUrl
  };
  return parseSimplicantPostingsFromHtml(companyNameForPostings, parseConfig, pageHtml);
}

async function collectPostingsForLoxoCompany(company) {
  const config = parseLoxoCompany(company.url_string);
  if (!config) return [];

  const normalizedCompanyName = String(company?.company_name || "").trim();
  const companyNameForPostings = normalizedCompanyName || config.companySlugLower;
  const { pageHtml, finalUrl } = await fetchLoxoJobsPage(config);
  const finalParsed = parseUrl(finalUrl);
  const parseConfig = {
    ...config,
    baseOrigin: `${finalParsed?.protocol || "https:"}//${finalParsed?.host || config.host}`,
    boardUrl: finalUrl || config.boardUrl
  };
  return parseLoxoPostingsFromHtml(companyNameForPostings, parseConfig, pageHtml);
}

async function collectPostingsForPinpointHqCompany(company) {
  const config = parsePinpointHqCompany(company.url_string);
  if (!config) return [];

  const normalizedCompanyName = String(company?.company_name || "").trim();
  const companyNameForPostings = normalizedCompanyName || config.subdomainLower;
  const responseJson = await fetchPinpointHqJobBoard(config);
  return parsePinpointHqPostingsFromApi(companyNameForPostings, config, responseJson);
}

async function collectPostingsForRecruitCrmCompany(company) {
  const config = parseRecruitCrmCompany(company.url_string);
  if (!config) return [];

  const normalizedCompanyName = String(company?.company_name || "").trim();
  const companyNameForPostings = normalizedCompanyName || config.account;
  const limit = 100;
  const seenUrls = new Set();
  const collected = [];

  for (let page = 0; page < MAX_PAGES_PER_COMPANY; page += 1) {
    const offset = page * limit;
    const responseJson = await fetchRecruitCrmJobsPage(config, limit, offset);
    const batch = parseRecruitCrmPostingsFromApi(companyNameForPostings, config, responseJson);

    for (const posting of batch) {
      const postingUrl = String(posting?.job_posting_url || "").trim();
      if (!postingUrl || seenUrls.has(postingUrl)) continue;
      seenUrls.add(postingUrl);
      collected.push(posting);
    }

    if (batch.length < limit) break;
  }

  return collected;
}

async function collectPostingsForRipplingCompany(company) {
  const config = parseRipplingCompany(company.url_string);
  if (!config) return [];

  const normalizedCompanyName = String(company?.company_name || "").trim();
  const companyNameForPostings = normalizedCompanyName || config.companySlug;
  const pageSize = 100;
  const seenUrls = new Set();
  const collected = [];

  for (let page = 0; page < MAX_PAGES_PER_COMPANY; page += 1) {
    const responseJson = await fetchRipplingJobsPage(config, page, pageSize);
    const batch = parseRipplingPostingsFromApi(companyNameForPostings, config, responseJson);

    for (const posting of batch) {
      const postingUrl = String(posting?.job_posting_url || "").trim();
      if (!postingUrl || seenUrls.has(postingUrl)) continue;
      seenUrls.add(postingUrl);
      collected.push(posting);
    }

    const totalPagesRaw = Number(responseJson?.totalPages);
    const totalPages = Number.isFinite(totalPagesRaw) && totalPagesRaw > 0 ? totalPagesRaw : 1;
    if (page + 1 >= totalPages) break;
    if (batch.length < pageSize) break;
  }

  return collected;
}

async function collectPostingsForCareerpuckCompany(company) {
  const config = parseCareerpuckCompany(company.url_string);
  if (!config) return [];

  const normalizedCompanyName = String(company?.company_name || "").trim();
  const companyNameForPostings = normalizedCompanyName || config.boardSlugLower;
  const responseJson = await fetchCareerpuckJobBoard(config);
  return parseCareerpuckPostingsFromApi(companyNameForPostings, responseJson);
}

async function collectPostingsForFountainCompany(company) {
  const config = parseFountainCompany(company.url_string);
  if (!config) return [];

  const normalizedCompanyName = String(company?.company_name || "").trim();
  const companyNameForPostings = normalizedCompanyName || config.companySlugLower;
  const responseJson = await fetchFountainJobBoard(config);
  return parseFountainPostingsFromApi(companyNameForPostings, config, responseJson);
}

async function collectPostingsForGetroCompany(company) {
  const config = parseGetroCompany(company.url_string);
  if (!config) return [];

  const normalizedCompanyName = String(company?.company_name || "").trim();
  const companyNameForPostings = normalizedCompanyName || config.subdomainLower;
  const pageHtml = await fetchGetroJobsPage(config.jobsUrl);
  return parseGetroPostingsFromHtml(companyNameForPostings, config, pageHtml);
}

async function collectPostingsForHrmDirectCompany(company) {
  const config = parseHrmDirectCompany(company.url_string);
  if (!config) return [];

  const normalizedCompanyName = String(company?.company_name || "").trim();
  const companyNameForPostings = normalizedCompanyName || config.subdomainLower;
  const { pageHtml, finalUrl } = await fetchHrmDirectJobsPage(config.jobsUrl);
  const finalParsed = parseUrl(finalUrl);
  const parseConfig = {
    ...config,
    baseOrigin: `${finalParsed?.protocol || "https:"}//${finalParsed?.host || config.host}`,
    jobsUrl: finalUrl || config.jobsUrl
  };
  return parseHrmDirectPostingsFromHtml(companyNameForPostings, parseConfig, pageHtml);
}

async function collectPostingsForTalentlyftCompany(company) {
  const config = parseTalentlyftCompany(company.url_string);
  if (!config) return [];

  const normalizedCompanyName = String(company?.company_name || "").trim();
  const companyNameForPostings = normalizedCompanyName || config.subdomainLower;
  const { pageHtml: landingHtml, finalUrl } = await fetchTalentlyftLandingPage(config.careersUrl);
  const initialConfig = extractTalentlyftInitialConfig(landingHtml, finalUrl || config.careersUrl);

  const finalParsed = parseUrl(finalUrl);
  const baseOrigin = `${finalParsed?.protocol || "https:"}//${finalParsed?.host || config.host}`;
  const runtimeConfig = {
    ...config,
    ...initialConfig,
    baseOrigin,
    websiteUrl: String(initialConfig?.websiteUrl || baseOrigin).replace(/\/+$/, ""),
    apiUrl: String(initialConfig?.apiUrl || `${baseOrigin}/JobList/`).replace(/\/+$/, "") + "/"
  };

  const collected = [];
  const seenUrls = new Set();
  let totalPages = 1;

  for (let page = 1; page <= Math.min(MAX_PAGES_PER_COMPANY, totalPages); page += 1) {
    const fragmentHtml = await fetchTalentlyftJobListFragment(runtimeConfig, page, 20);
    const batch = parseTalentlyftPostingsFromFragment(companyNameForPostings, runtimeConfig, fragmentHtml);

    for (const posting of batch) {
      const postingUrl = String(posting?.job_posting_url || "").trim();
      if (!postingUrl || seenUrls.has(postingUrl)) continue;
      seenUrls.add(postingUrl);
      collected.push(posting);
    }

    totalPages = Math.max(totalPages, extractTalentlyftTotalPages(fragmentHtml));
    if (batch.length === 0 && page >= totalPages) break;
  }

  return collected;
}

async function collectPostingsForTalexioCompany(company) {
  const config = parseTalexioCompany(company.url_string);
  if (!config) return [];

  const normalizedCompanyName = String(company?.company_name || "").trim();
  const companyNameForPostings = normalizedCompanyName || config.subdomainLower;

  const collected = [];
  const seenUrls = new Set();
  const pageSize = 10;
  let totalVacancies = null;

  for (let page = 1; page <= MAX_PAGES_PER_COMPANY; page += 1) {
    const responseJson = await fetchTalexioJobsPage(config, page, pageSize);
    const batch = parseTalexioPostingsFromApi(companyNameForPostings, config, responseJson);
    for (const posting of batch) {
      const postingUrl = String(posting?.job_posting_url || "").trim();
      if (!postingUrl || seenUrls.has(postingUrl)) continue;
      seenUrls.add(postingUrl);
      collected.push(posting);
    }

    const vacancies = Array.isArray(responseJson?.vacancies) ? responseJson.vacancies : [];
    const totalRaw = Number(responseJson?.totalVacancies);
    if (Number.isFinite(totalRaw) && totalRaw >= 0) {
      totalVacancies = totalRaw;
    }

    if (vacancies.length < pageSize) break;
    if (Number.isFinite(totalVacancies) && collected.length >= Number(totalVacancies)) break;
  }

  return collected;
}

async function collectPostingsForSapHrCloudCompany(company) {
  const config = parseSapHrCloudCompany(company.url_string);
  if (!config) return [];

  const normalizedCompanyName = String(company?.company_name || "").trim();
  const companyNameForPostings = normalizedCompanyName || config.companyNameLower;
  const { pageHtml, finalUrl } = await fetchSapHrCloudBoardPage(company.url_string || config.boardUrl);
  return parseSapHrCloudPostingsFromHtml(companyNameForPostings, config, pageHtml, finalUrl);
}

async function collectPostingsForRecruiteeCompany(company) {
  const config = parseRecruiteeCompany(company.url_string);
  if (!config) return [];

  const response = await fetchRecruiteePublicApp(config.baseUrl);
  const normalizedCompanyName = String(company?.company_name || "").trim();
  const companyNameForPostings =
    normalizedCompanyName && normalizedCompanyName.toLowerCase() !== "recruitee"
      ? normalizedCompanyName
      : config.subdomain;

  return parseRecruiteePostingsFromPublicApp(companyNameForPostings, config, response);
}

function extractUltiProLocationName(opportunity) {
  const locations = Array.isArray(opportunity?.Locations) ? opportunity.Locations : [];
  const values = [];
  const seen = new Set();

  for (const location of locations) {
    const item = location && typeof location === "object" ? location : {};
    const address = item.Address && typeof item.Address === "object" ? item.Address : {};
    const city = String(address.City || "").trim();
    const state = String(address?.State?.Code || "").trim();
    const country = String(address?.Country?.Name || "").trim();
    const fallback = String(item.LocalizedDescription || item.LocalizedName || "").trim();

    const cityState = [city, state].filter(Boolean).join(", ");
    let label = "";
    if (cityState && country) {
      label = `${cityState}, ${country}`;
    } else if (cityState) {
      label = cityState;
    } else if (fallback) {
      label = fallback;
    } else if (country) {
      label = country;
    }

    const normalized = label.toLowerCase();
    if (!label || seen.has(normalized)) continue;
    seen.add(normalized);
    values.push(label);
  }

  return values.length > 0 ? values.join(" / ") : null;
}

function parseUltiProPostingsFromApi(companyNameForPostings, config, responseJson) {
  const opportunities = Array.isArray(responseJson?.opportunities) ? responseJson.opportunities : [];
  const postings = [];
  const seenIds = new Set();
  const companyName = String(companyNameForPostings || config?.tenantLower || "").trim();

  for (const opportunity of opportunities) {
    const item = opportunity && typeof opportunity === "object" ? opportunity : {};
    const opportunityId = String(item?.Id || item?.OpportunityId || item?.opportunityId || "").trim();
    if (!opportunityId || seenIds.has(opportunityId)) continue;

    postings.push({
      company_name: companyName,
      source_job_id: opportunityId,
      id: opportunityId,
      position_name: String(item?.Title || item?.title || "").trim() || "Untitled Position",
      job_posting_url: `${String(config?.baseBoardUrl || "").replace(/\/+$/, "")}/OpportunityDetail?opportunityId=${encodeURIComponent(opportunityId)}`,
      posting_date: String(item?.PostedDate || item?.postedDate || item?.CreatedDate || "").trim() || null,
      location: extractUltiProLocationName(item),
      employment_type: String(item?.JobType || item?.EmploymentType || item?.JobCategory || "").trim() || null,
      department: String(item?.Department || item?.DepartmentName || "").trim() || null
    });
    seenIds.add(opportunityId);
  }

  return postings;
}

async function collectPostingsForUltiProCompany(company) {
  const config = parseUltiProCompany(company.url_string);
  if (!config) return [];

  const normalizedCompanyName = String(company?.company_name || "").trim();
  const companyNameForPostings = normalizedCompanyName || config.tenantLower;
  const postings = [];
  const seenIds = new Set();
  let skip = 0;

  for (let page = 0; page < MAX_PAGES_PER_COMPANY; page += 1) {
    const response = await fetchUltiProSearchResults(config, ULTIPRO_PAGE_SIZE, skip);
    const opportunities = Array.isArray(response?.opportunities) ? response.opportunities : [];
    if (opportunities.length === 0) break;

    for (const posting of parseUltiProPostingsFromApi(companyNameForPostings, config, response)) {
      const opportunityId = String(posting?.source_job_id || "").trim();
      if (!opportunityId || seenIds.has(opportunityId)) continue;
      postings.push(posting);
      seenIds.add(opportunityId);
    }

    const totalCount = Number(response?.totalCount);
    if (opportunities.length < ULTIPRO_PAGE_SIZE) break;
    if (Number.isFinite(totalCount) && skip + ULTIPRO_PAGE_SIZE >= totalCount) break;
    skip += ULTIPRO_PAGE_SIZE;
  }

  return postings;
}

async function collectPostingsForTaleoCompany(company) {
  const config = parseTaleoCompany(company.url_string);
  if (!config) return [];

  const normalizedCompanyName = String(company?.company_name || "").trim();
  const companyNameForPostings = normalizedCompanyName || config.careerSectionLower;
  const pageHtml = await fetchTaleoJobSearchPage(company.url_string);
  const { portal, tokenName, tokenValue } = extractTaleoRestConfig(pageHtml);
  const postings = [];
  const seenUrls = new Set();

  if (portal) {
    for (let pageNo = 1; pageNo <= MAX_PAGES_PER_COMPANY; pageNo += 1) {
      const response = await fetchTaleoRestSearchResults(config, portal, tokenName, tokenValue, pageNo);
      const requisitions = Array.isArray(response?.requisitionList) ? response.requisitionList : [];
      if (requisitions.length === 0) break;

      const batch = extractTaleoPostingsFromRest(companyNameForPostings, config, requisitions);
      for (const posting of batch) {
        if (seenUrls.has(posting.job_posting_url)) continue;
        seenUrls.add(posting.job_posting_url);
        postings.push(posting);
      }

      const pagingData = response?.pagingData && typeof response.pagingData === "object" ? response.pagingData : {};
      const totalCount = Number(pagingData?.totalCount);
      const pageSizeRaw = Number(pagingData?.pageSize);
      const pageSize = Number.isFinite(pageSizeRaw) && pageSizeRaw > 0 ? pageSizeRaw : requisitions.length;
      if (requisitions.length < pageSize) break;
      if (Number.isFinite(totalCount) && pageNo * pageSize >= totalCount) break;
    }
  }

  if (postings.length > 0) {
    return postings;
  }

  const ajaxText = await fetchTaleoAjaxSearchResults(config, tokenValue);
  const ajaxPostings = extractTaleoPostingsFromAjax(companyNameForPostings, config, ajaxText);
  for (const posting of ajaxPostings) {
    if (seenUrls.has(posting.job_posting_url)) continue;
    seenUrls.add(posting.job_posting_url);
    postings.push(posting);
  }

  return postings;
}

function cleanGovernmentJobsText(value) {
  return decodeHtmlEntities(String(value || "").replace(/<[^>]+>/g, " "))
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractGovernmentJobsLastPage(viewHtml) {
  const source = String(viewHtml || "");
  const pageValues = [];
  const pageRegex = /[?&]page=(\d+)/gi;
  let match = pageRegex.exec(source);
  while (match) {
    const pageNumber = Number.parseInt(String(match[1] || "").trim(), 10);
    if (Number.isFinite(pageNumber) && pageNumber > 0) {
      pageValues.push(pageNumber);
    }
    match = pageRegex.exec(source);
  }
  return pageValues.length > 0 ? Math.max(...pageValues) : 1;
}

function extractGovernmentJobsViewHtmlFromResponse(response, bodyText) {
  const contentType = String(response?.headers?.get("content-type") || "").toLowerCase();
  const rawBody = String(bodyText || "");
  if (!contentType.includes("application/json")) {
    return rawBody;
  }
  try {
    const parsed = JSON.parse(rawBody);
    if (parsed && typeof parsed === "object") {
      return String(parsed.view1 || "");
    }
  } catch {
    return "";
  }
  return "";
}

function parseGovernmentJobsPostingsFromViewHtml(viewHtml) {
  const source = String(viewHtml || "");
  if (!source) return [];

  const postings = [];
  const seenUrls = new Set();
  const itemRegex = /<li[^>]*class=["'][^"']*\bjob-item\b[^"']*["'][^>]*>([\s\S]*?)<\/li>/gi;
  const linkRegex =
    /<a[^>]*class=["'][^"']*\bjob-details-link\b[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i;
  const orgRegex = /<div[^>]*class=["'][^"']*\bjob-organization\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i;
  const locationRegex = /<span[^>]*class=["'][^"']*\bjob-location\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i;

  let itemMatch = itemRegex.exec(source);
  while (itemMatch) {
    const itemHtml = String(itemMatch[1] || "");
    const linkMatch = linkRegex.exec(itemHtml);
    if (!linkMatch) {
      itemMatch = itemRegex.exec(source);
      continue;
    }

    const href = cleanGovernmentJobsText(linkMatch[1]).replace(/\s+/g, "");
    const jobPostingUrl = href ? new URL(href, "https://www.governmentjobs.com/").toString() : "";
    if (!jobPostingUrl || !jobPostingUrl.toLowerCase().includes("governmentjobs.com/jobs/") || seenUrls.has(jobPostingUrl)) {
      itemMatch = itemRegex.exec(source);
      continue;
    }

    const companyName = cleanGovernmentJobsText((orgRegex.exec(itemHtml) || [])[1]) || "Unknown Company";
    const positionName = cleanGovernmentJobsText(linkMatch[2]) || "Untitled Position";
    const location = cleanGovernmentJobsText((locationRegex.exec(itemHtml) || [])[1]) || null;

    postings.push({
      company_name: companyName,
      position_name: positionName,
      job_posting_url: jobPostingUrl,
      posting_date: "Posted Today",
      location
    });
    seenUrls.add(jobPostingUrl);
    itemMatch = itemRegex.exec(source);
  }

  return postings;
}

async function fetchGovernmentJobsViewHtml(url, params) {
  const requestUrl = new URL(url);
  for (const [key, value] of Object.entries(params || {})) {
    requestUrl.searchParams.set(key, String(value));
  }

  const res = await fetchWithAtsRateLimit("governmentjobs", GOVERNMENTJOBS_RATE_LIMIT_WAIT_MS, requestUrl.toString(), {
    method: "GET",
    headers: {
      Accept: "application/json, text/plain, */*",
      "Accept-Language": "en-US,en;q=0.9",
      "X-Requested-With": "XMLHttpRequest"
    }
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GovernmentJobs request failed (${res.status}): ${body.slice(0, 180)}`);
  }

  const text = await res.text();
  return extractGovernmentJobsViewHtmlFromResponse(res, text);
}

async function collectPostingsForGovernmentJobsDynamic() {
  const postings = [];
  const seenUrls = new Set();
  const timestamp = Date.now().toString();

  const firstViewHtml = await fetchGovernmentJobsViewHtml("https://www.governmentjobs.com/jobs", {
    keyword: "",
    location: "",
    daysposted: "1",
    isFiltered: "true",
    _: timestamp
  });

  const firstBatch = parseGovernmentJobsPostingsFromViewHtml(firstViewHtml);
  for (const posting of firstBatch) {
    if (seenUrls.has(posting.job_posting_url)) continue;
    seenUrls.add(posting.job_posting_url);
    postings.push(posting);
  }

  const lastPage = extractGovernmentJobsLastPage(firstViewHtml);
  for (let page = 2; page <= lastPage; page += 1) {
    const pageViewHtml = await fetchGovernmentJobsViewHtml("https://www.governmentjobs.com/jobs", {
      page: String(page),
      daysPosted: "1",
      isTransfer: "False",
      isPromotional: "False",
      _: Date.now().toString()
    });

    const batch = parseGovernmentJobsPostingsFromViewHtml(pageViewHtml);
    for (const posting of batch) {
      if (seenUrls.has(posting.job_posting_url)) continue;
      seenUrls.add(posting.job_posting_url);
      postings.push(posting);
    }
  }

  return postings;
}

function cleanSmartRecruitersText(value) {
  return decodeHtmlEntities(String(value || "").replace(/<[^>]+>/g, " "))
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildSmartRecruitersLocationLabel(locationObj, shortLocation) {
  const locationData = locationObj && typeof locationObj === "object" ? locationObj : {};
  const city = cleanSmartRecruitersText(locationData.city);
  const region = cleanSmartRecruitersText(locationData.region);
  const country = cleanSmartRecruitersText(locationData.country);
  const structuredParts = [city, region, country].filter(Boolean);
  const structured = structuredParts.length > 0 ? structuredParts.join(", ") : "";
  const shortValue = cleanSmartRecruitersText(shortLocation);
  if (structured && shortValue && normalizeRemoteType(shortValue) !== "unknown") {
    return `${shortValue} - ${structured}`;
  }
  return structured || shortValue || null;
}

function extractSmartRecruitersLocationParts(locationObj) {
  const locationData = locationObj && typeof locationObj === "object" ? locationObj : {};
  const city = cleanSmartRecruitersText(locationData.city);
  const region = cleanSmartRecruitersText(locationData.region);
  const country = cleanSmartRecruitersText(locationData.country);
  return {
    city: isRemoteOnlyLocationValue(city) ? "" : city,
    state: region,
    country: normalizeCountryName(country) || normalizeCountryFromLocation(country)
  };
}

function parseSmartRecruitersPostingsFromApi(companyNameForPostings, config, payload) {
  const contentItems = Array.isArray(payload?.content)
    ? payload.content
    : Array.isArray(payload?.jobs)
      ? payload.jobs
      : Array.isArray(payload)
        ? payload
        : [];
  const postings = [];
  const seenUrls = new Set();

  for (const item of contentItems) {
    if (!item || typeof item !== "object") continue;

    const rawJobUrl =
      cleanSmartRecruitersText(item.applyUrl) ||
      cleanSmartRecruitersText(item.ref) ||
      cleanSmartRecruitersText(item.jobUrl) ||
      cleanSmartRecruitersText(item.url);
    if (!rawJobUrl || seenUrls.has(rawJobUrl)) continue;

    const company = item.company && typeof item.company === "object" ? item.company : {};
    const companyName =
      cleanSmartRecruitersText(companyNameForPostings) ||
      cleanSmartRecruitersText(company.name) ||
      cleanSmartRecruitersText(config?.companySlug);
    const title = cleanSmartRecruitersText(item.name || item.title) || "Untitled Position";
    const location = buildSmartRecruitersLocationLabel(item.location, item.shortLocation);
    const locationParts = extractSmartRecruitersLocationParts(item.location);
    const postedDate = cleanSmartRecruitersText(item.releasedDate || item.updatedOn || item.createdOn) || null;
    const department =
      cleanSmartRecruitersText(item.department?.label || item.department?.name || item.department) || null;
    const employmentType =
      cleanSmartRecruitersText(item.typeOfEmployment?.label || item.typeOfEmployment?.name || item.typeOfEmployment || item.employmentType) || null;
    const jobAdSections = item.jobAd?.sections && typeof item.jobAd.sections === "object" ? item.jobAd.sections : {};

    postings.push({
      company_name: companyName,
      source_job_id:
        String(item?.id ?? item?.uuid ?? item?.refNumber ?? "").trim() ||
        extractSourceIdFromPostingUrl(rawJobUrl, "smartrecruiters"),
      id: String(item?.id ?? "").trim() || undefined,
      position_name: title,
      job_posting_url: rawJobUrl,
      posting_date: postedDate,
      location,
      city: locationParts.city || null,
      state: locationParts.state || null,
      country: locationParts.country || null,
      department,
      employment_type: employmentType,
      workplaceType:
        cleanSmartRecruitersText(item.workplaceType || item.locationType || item.remoteStatus) ||
        (item.remote === true ? "remote" : null),
      remote: item.remote === true || item.isRemote === true,
      industry: cleanSmartRecruitersText(item.industry?.label || item.industry?.name || item.industry) || null,
      description_html: cleanSmartRecruitersText(jobAdSections.jobDescription || item.descriptionHtml) || null,
      description_plain: cleanSmartRecruitersText(item.descriptionPlain || item.description) || null
    });
    seenUrls.add(rawJobUrl);
  }

  return postings;
}

async function collectPostingsForSmartRecruitersDynamic(limit = 100) {
  const cappedLimit = Math.max(1, Math.min(100, Number(limit) || 100));
  const endpoint = new URL("https://jobs.smartrecruiters.com/sr-jobs/search");
  endpoint.searchParams.set("limit", String(cappedLimit));
  endpoint.searchParams.set("_", String(Date.now()));

  const res = await fetchWithAtsRateLimit(
    "smartrecruiters",
    SMARTRECRUITERS_RATE_LIMIT_WAIT_MS,
    endpoint.toString(),
    {
      method: "GET",
      headers: {
        Accept: "application/json, text/plain, */*",
        "Accept-Language": "en-US,en;q=0.9"
      }
    }
  );

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`SmartRecruiters request failed (${res.status}): ${body.slice(0, 180)}`);
  }

  const payload = await res.json();
  return parseSmartRecruitersPostingsFromApi("", {}, payload);
}

function cleanPoliceappText(value) {
  return decodeHtmlEntities(String(value || "").replace(/<[^>]+>/g, " "))
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizePoliceappJobUrl(rawUrl, baseOrigin = "https://www.policeapp.com") {
  let value = String(rawUrl || "").trim();
  if (!value) return "";
  if (value.startsWith("/")) {
    value = new URL(value, `${baseOrigin}/`).toString();
  } else if (!/^https?:\/\//i.test(value)) {
    value = new URL(value, `${baseOrigin}/`).toString();
  }
  value = value.replace(
    /^(https?:\/\/www\.policeapp\.com\/)jobs\/urlrewrite_jobpostings\//i,
    "$1"
  );
  return value;
}

function parsePoliceappPostingsFromHtml(responseHtml) {
  const source = String(responseHtml || "");
  if (!source) return [];

  const postings = [];
  const seenUrls = new Set();
  const linkRegex = /<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;

  let linkMatch = linkRegex.exec(source);
  while (linkMatch) {
    const hrefRaw = cleanPoliceappText(linkMatch[1]);
    const hrefLower = hrefRaw.toLowerCase();
    if (!hrefLower || hrefLower.startsWith("javascript:") || hrefLower.startsWith("#")) {
      linkMatch = linkRegex.exec(source);
      continue;
    }
    if (!/\/\d+\/?$/.test(hrefLower)) {
      linkMatch = linkRegex.exec(source);
      continue;
    }

    const jobPostingUrl = normalizePoliceappJobUrl(hrefRaw);
    if (!jobPostingUrl || seenUrls.has(jobPostingUrl)) {
      linkMatch = linkRegex.exec(source);
      continue;
    }

    const bodyText = cleanPoliceappText(linkMatch[2]);
    const titlePart = bodyText.split(/deadline\s*:/i)[0].trim();
    const positionName = titlePart || "Untitled Position";

    const companyName = positionName.includes(" - ")
      ? positionName.split(" - ", 1)[0].trim() || "Unknown Company"
      : "Unknown Company";

    postings.push({
      company_name: companyName,
      position_name: positionName,
      job_posting_url: jobPostingUrl,
      posting_date: "Posted Today",
      location: null
    });
    seenUrls.add(jobPostingUrl);
    linkMatch = linkRegex.exec(source);
  }

  return postings;
}

async function collectPostingsForPoliceappDynamic() {
  const endpoint =
    "https://www.policeapp.com/jobs/urlrewrite_jobpostings/jobResultsAjax.ashx?j=0&r=50&s=0&p=0";
  const res = await fetchWithAtsRateLimit("policeapp", POLICEAPP_RATE_LIMIT_WAIT_MS, endpoint, {
    method: "GET",
    headers: {
      Accept: "text/html, */*; q=0.01",
      "Accept-Language": "en-US,en;q=0.9",
      "X-Requested-With": "XMLHttpRequest"
    }
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`PoliceApp request failed (${res.status}): ${body.slice(0, 180)}`);
  }

  const html = await res.text();
  return parsePoliceappPostingsFromHtml(html);
}

function cleanUsajobsText(value) {
  return decodeHtmlEntities(String(value || "").replace(/<[^>]+>/g, " "))
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractUsajobsOpenDate(dateDisplay) {
  const raw = cleanUsajobsText(dateDisplay);
  if (!raw) return null;
  const match = raw.match(/open\s+(\d{2}\/\d{2}\/\d{4})\s+to/i);
  return match?.[1] || null;
}

function getUsajobsApiConfig(env = process.env) {
  const authorizationKey = String(
    env.OPENJOBSLOTS_USAJOBS_AUTHORIZATION_KEY ||
    env.USAJOBS_AUTHORIZATION_KEY ||
    env.USAJOBS_API_KEY ||
    ""
  ).trim();
  if (!authorizationKey) {
    throw new Error("USAJobs official API key is not configured; set OPENJOBSLOTS_USAJOBS_AUTHORIZATION_KEY");
  }
  const userAgent = String(
    env.OPENJOBSLOTS_USAJOBS_USER_AGENT ||
    env.USAJOBS_USER_AGENT ||
    env.OPENJOBSLOTS_CONTACT_EMAIL ||
    "openjobslots.com"
  ).trim();
  return { authorizationKey, userAgent };
}

function normalizeUsajobsRemoteType(value) {
  if (value === true) return "remote";
  const normalized = cleanUsajobsText(value).toLowerCase();
  if (["true", "yes", "y", "remote"].includes(normalized)) return "remote";
  return "unknown";
}

function getUsajobsStructuredLocation(descriptor = {}) {
  const locations = Array.isArray(descriptor.PositionLocation) ? descriptor.PositionLocation : [];
  const first = locations.find((location) => location && typeof location === "object") || {};
  const city = cleanUsajobsText(first.CityName);
  const region = cleanUsajobsText(first.CountrySubDivisionCode || first.CountrySubDivision);
  const countryCode = cleanUsajobsText(first.CountryCode);
  const country = countryCode ? normalizeCountryName(countryCode) : cleanUsajobsText(first.CountryName);
  const display = cleanUsajobsText(descriptor.PositionLocationDisplay);
  const location = display || [city, region, country].filter(Boolean).join(", ");
  return { city, region, country, location };
}

function parseUsajobsOfficialSearchPayload(payload) {
  const items = Array.isArray(payload?.SearchResult?.SearchResultItems)
    ? payload.SearchResult.SearchResultItems
    : [];
  const postings = [];
  const seenUrls = new Set();
  for (const item of items) {
    const descriptor = item?.MatchedObjectDescriptor;
    if (!descriptor || typeof descriptor !== "object") continue;
    const sourceJobId = cleanUsajobsText(descriptor.PositionID || descriptor.DocumentID || descriptor.MatchedObjectId);
    let jobPostingUrl = cleanUsajobsText(descriptor.PositionURI);
    if (!jobPostingUrl && sourceJobId) jobPostingUrl = `https://www.usajobs.gov/job/${sourceJobId}`;
    if (!jobPostingUrl || seenUrls.has(jobPostingUrl)) continue;

    const details = descriptor.UserArea?.Details || {};
    const location = getUsajobsStructuredLocation(descriptor);
    postings.push({
      company_name: cleanUsajobsText(descriptor.OrganizationName || descriptor.DepartmentName) || "Unknown Agency",
      position_name: cleanUsajobsText(descriptor.PositionTitle) || "Untitled Position",
      job_posting_url: jobPostingUrl,
      source_job_id: sourceJobId,
      posting_date: cleanUsajobsText(descriptor.PublicationStartDate),
      location: location.location || null,
      city: location.city || null,
      region: location.region || null,
      country: location.country || null,
      remote_type: normalizeUsajobsRemoteType(details.RemoteIndicator),
      description_plain: cleanUsajobsText(details.JobSummary || details.MajorDuties || details.Requirements || "")
    });
    seenUrls.add(jobPostingUrl);
  }
  return postings;
}

function parseUsajobsPostingsFromPayload(payload) {
  if (!payload || typeof payload !== "object") return [];
  const officialPostings = parseUsajobsOfficialSearchPayload(payload);
  if (officialPostings.length > 0) return officialPostings;
  const jobs = Array.isArray(payload.Jobs) ? payload.Jobs : [];
  const postings = [];
  const seenUrls = new Set();

  for (const job of jobs) {
    if (!job || typeof job !== "object") continue;

    let jobPostingUrl = cleanUsajobsText(job.PositionURI);
    if (!jobPostingUrl) {
      const documentId = cleanUsajobsText(job.DocumentID);
      if (documentId) {
        jobPostingUrl = `https://www.usajobs.gov/job/${documentId}`;
      }
    }
    if (!jobPostingUrl || seenUrls.has(jobPostingUrl)) continue;

    const positionName = cleanUsajobsText(job.Title) || "Untitled Position";
    const companyName = cleanUsajobsText(job.Agency) || "Unknown Agency";
    const location = cleanUsajobsText(job.LocationName || job.Location) || null;
    const postingDate = extractUsajobsOpenDate(job.DateDisplay);

    postings.push({
      company_name: companyName,
      position_name: positionName,
      job_posting_url: jobPostingUrl,
      posting_date: postingDate,
      location
    });
    seenUrls.add(jobPostingUrl);
  }

  return postings;
}

async function collectPostingsForUsajobsDynamic(maxPages = 2, resultsPerPage = 25) {
  const { authorizationKey, userAgent } = getUsajobsApiConfig(process.env);
  const collected = [];
  const seenUrls = new Set();
  let totalPages = 1;
  const pageLimit = Math.max(1, Math.min(20, Number(maxPages) || 2));
  const perPage = Math.max(1, Math.min(500, Number(resultsPerPage) || 25));

  for (let page = 1; page <= pageLimit; page += 1) {
    const url = new URL(USAJOBS_SEARCH_API_URL);
    url.searchParams.set("HiringPath", "public");
    url.searchParams.set("DatePosted", "30");
    url.searchParams.set("SortField", "DatePosted");
    url.searchParams.set("SortDirection", "Desc");
    url.searchParams.set("ResultsPerPage", String(perPage));
    url.searchParams.set("Page", String(page));

    const res = await fetchWithAtsRateLimit("usajobs", USAJOBS_RATE_LIMIT_WAIT_MS, url.toString(), {
      method: "GET",
      headers: {
        Accept: "application/json",
        Host: "data.usajobs.gov",
        "User-Agent": userAgent,
        "Authorization-Key": authorizationKey
      }
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`USAJobs official search request failed (${res.status}): ${body.slice(0, 180)}`);
    }

    const payload = await res.json();
    const numberOfPagesRaw = Number(payload?.SearchResult?.UserArea?.NumberOfPages || payload?.Pager?.NumberOfPages);
    if (Number.isFinite(numberOfPagesRaw) && numberOfPagesRaw > 0) {
      totalPages = numberOfPagesRaw;
    }

    const batch = parseUsajobsPostingsFromPayload(payload);
    for (const posting of batch) {
      const postingUrl = String(posting?.job_posting_url || "").trim();
      if (!postingUrl || seenUrls.has(postingUrl)) continue;
      collected.push(posting);
      seenUrls.add(postingUrl);
    }

    if (page >= totalPages) break;
  }

  return collected;
}

function cleanK12jobspotText(value) {
  return decodeHtmlEntities(String(value || "").replace(/<[^>]+>/g, " "))
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseK12jobspotPostingsFromPayload(payload) {
  if (!payload || typeof payload !== "object") return [];
  const jobs = Array.isArray(payload.jobs) ? payload.jobs : [];
  const postings = [];
  const seenUrls = new Set();

  for (const job of jobs) {
    if (!job || typeof job !== "object") continue;
    const jobId = cleanK12jobspotText(job.id);
    if (!jobId) continue;

    const jobPostingUrl = `https://www.k12jobspot.com/Job/Detail/${jobId}`;
    if (seenUrls.has(jobPostingUrl)) continue;

    const companyName = cleanK12jobspotText(job.hiringOrganization) || "Unknown Organization";
    const positionName = cleanK12jobspotText(job.title) || "Untitled Position";
    const locationObj = job.location && typeof job.location === "object" ? job.location : {};
    const city = cleanK12jobspotText(locationObj.city);
    const region = cleanK12jobspotText(locationObj.regionCode);
    const postal = cleanK12jobspotText(locationObj.postalCode);
    const locationParts = [city, region, postal].filter(Boolean);
    const location = locationParts.length > 0 ? locationParts.join(", ") : null;
    const postingDate = cleanK12jobspotText(job.postedDate) || null;

    postings.push({
      company_name: companyName,
      position_name: positionName,
      job_posting_url: jobPostingUrl,
      posting_date: postingDate,
      location
    });
    seenUrls.add(jobPostingUrl);
  }

  return postings;
}

async function fetchK12jobspotSearchPayload(pageStartIndex, pageEndIndex) {
  const endpoint = "https://api.k12jobspot.com/api/Jobs/Search";
  const requestBody = {
    searchPhrase: "",
    filters: [
      { name: "positionAreas", filters: [] },
      { name: "gradeLevels", filters: [] },
      { name: "jobTypes", filters: [] }
    ],
    pageStartIndex,
    pageEndIndex
  };

  const res = await fetchWithAtsRateLimit("k12jobspot", K12JOBSPOT_RATE_LIMIT_WAIT_MS, endpoint, {
    method: "POST",
    headers: {
      Accept: "application/json, text/plain, */*",
      "Accept-Language": "en-US,en;q=0.9",
      "Content-Type": "application/json",
      Origin: "https://www.k12jobspot.com",
      Referer: "https://www.k12jobspot.com/"
    },
    body: JSON.stringify(requestBody)
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`K12JobSpot request failed (${res.status}): ${body.slice(0, 180)}`);
  }
  return res.json();
}

async function collectPostingsForK12jobspotDynamic(pageWindowSize = 25) {
  const windowSize = Math.max(1, Number(pageWindowSize) || 25);
  const postings = [];
  const seenUrls = new Set();
  const referenceEpoch = nowEpochSeconds();
  let pageStartIndex = 1;

  while (true) {
    const pageEndIndex = pageStartIndex + windowSize - 1;
    const payload = await fetchK12jobspotSearchPayload(pageStartIndex, pageEndIndex);
    const batch = parseK12jobspotPostingsFromPayload(payload);
    if (batch.length === 0) break;

    let hasWithin24h = false;
    for (const posting of batch) {
      const postingUrl = String(posting?.job_posting_url || "").trim();
      if (!postingUrl || seenUrls.has(postingUrl)) continue;
      if (!shouldStorePostingByDate(posting?.posting_date, referenceEpoch)) continue;
      hasWithin24h = true;
      postings.push(posting);
      seenUrls.add(postingUrl);
    }

    if (!hasWithin24h) break;
    pageStartIndex = pageEndIndex + 1;
  }

  return postings;
}

function parseSchoolspringPostingsFromPayload(payload) {
  const jobs = payload?.value?.jobsList;
  if (!Array.isArray(jobs)) return [];

  const postings = [];
  const seenUrls = new Set();
  for (const job of jobs) {
    const jobId = Number(job?.jobId || 0);
    if (!Number.isFinite(jobId) || jobId <= 0) continue;
    const jobPostingUrl = `https://www.schoolspring.com/job.cfm?jid=${jobId}`;
    if (seenUrls.has(jobPostingUrl)) continue;
    seenUrls.add(jobPostingUrl);

    postings.push({
      company_name: String(job?.employer || "").trim() || "Unknown Employer",
      position_name: String(job?.title || "").trim() || "Untitled Position",
      job_posting_url: jobPostingUrl,
      posting_date: String(job?.displayDate || "").trim() || null,
      location: String(job?.location || "").trim() || null
    });
  }
  return postings;
}

async function fetchSchoolspringSearchPayload(page, size = 25) {
  const endpoint = new URL("https://api.schoolspring.com/api/Jobs/GetPagedJobsWithSearch");
  endpoint.searchParams.set("domainName", "");
  endpoint.searchParams.set("keyword", "");
  endpoint.searchParams.set("location", "");
  endpoint.searchParams.set("category", "");
  endpoint.searchParams.set("gradelevel", "");
  endpoint.searchParams.set("jobtype", "");
  endpoint.searchParams.set("organization", "");
  endpoint.searchParams.set("swLat", "");
  endpoint.searchParams.set("swLon", "");
  endpoint.searchParams.set("neLat", "");
  endpoint.searchParams.set("neLon", "");
  endpoint.searchParams.set("page", String(page));
  endpoint.searchParams.set("size", String(size));
  endpoint.searchParams.set("sortDateAscending", "false");

  const res = await fetchWithAtsRateLimit("schoolspring", SCHOOLSPRING_RATE_LIMIT_WAIT_MS, endpoint.toString(), {
    headers: {
      Accept: "application/json, text/plain, */*",
      "Accept-Language": "en-US,en;q=0.9",
      Origin: "https://www.schoolspring.com",
      Referer: "https://www.schoolspring.com/"
    }
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`SchoolSpring request failed (${res.status}): ${body.slice(0, 180)}`);
  }
  return res.json();
}

async function collectPostingsForSchoolspringDynamic(pageSize = 25) {
  const size = Math.max(1, Number(pageSize) || 25);
  const postings = [];
  const seenUrls = new Set();
  const referenceEpoch = nowEpochSeconds();
  let page = 1;

  while (true) {
    const payload = await fetchSchoolspringSearchPayload(page, size);
    const batch = parseSchoolspringPostingsFromPayload(payload);
    if (batch.length === 0) break;

    let hasWithin24h = false;
    for (const posting of batch) {
      const postingUrl = String(posting?.job_posting_url || "").trim();
      if (!postingUrl || seenUrls.has(postingUrl)) continue;
      if (!shouldStorePostingByDate(posting?.posting_date, referenceEpoch)) continue;
      hasWithin24h = true;
      postings.push(posting);
      seenUrls.add(postingUrl);
    }

    if (!hasWithin24h) break;
    page += 1;
  }

  return postings;
}

function cleanCalcareersText(value) {
  return decodeHtmlEntities(String(value || "").replace(/<[^>]+>/g, " "))
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractCalcareersHiddenInputs(htmlSource) {
  const source = String(htmlSource || "");
  const hidden = {};
  const regex = /<input[^>]+type=["']hidden["'][^>]*>/gi;
  let match = regex.exec(source);
  while (match) {
    const tag = String(match[0] || "");
    const nameMatch = tag.match(/\bname=["']([^"']+)["']/i);
    if (!nameMatch?.[1]) {
      match = regex.exec(source);
      continue;
    }
    const valueMatch = tag.match(/\bvalue=["']([^"']*)["']/i);
    hidden[nameMatch[1]] = valueMatch?.[1] || "";
    match = regex.exec(source);
  }
  return hidden;
}

function extractCalcareersPagerTargets(htmlSource) {
  const source = String(htmlSource || "");
  const targets = [];
  const seen = new Set();
  const regex = /__doPostBack\(&#39;([^']+btnPagerItem[^']*)&#39;,\s*&#39;[^']*&#39;\)/gi;
  let match = regex.exec(source);
  while (match) {
    const target = String(match[1] || "").trim();
    if (target && !seen.has(target)) {
      seen.add(target);
      targets.push(target);
    }
    match = regex.exec(source);
  }
  return targets;
}

function parseCalcareersPostingsFromHtml(htmlSource) {
  const source = String(htmlSource || "");
  if (!source) return [];

  const postings = [];
  const seenUrls = new Set();
  const cardRegex = new RegExp(
    String.raw`Working Title:\s*</div>\s*<div class="col-xs-6 job-details">\s*<span[^>]*>(.*?)</span>` +
      String.raw`[\s\S]*?Job Control:\s*</div>\s*<div class="col-xs-6 job-details">\s*(\d+)\s*</div>` +
      String.raw`[\s\S]*?Department:\s*</div>\s*<div class="col-xs-6 job-details">\s*(.*?)\s*</div>` +
      String.raw`[\s\S]*?Location:\s*</div>\s*<div class="col-xs-6 job-details">\s*(.*?)\s*</div>` +
      String.raw`[\s\S]*?Publish Date:\s*</div>\s*<div class="col-xs-6 job-details">\s*<time[^>]*>\s*([^<]+)\s*</time>` +
      String.raw`[\s\S]*?href="(https:\/\/www\.calcareers\.ca\.gov\/CalHrPublic\/Jobs\/JobPosting\.aspx\?JobControlId=\d+)"`,
    "gi"
  );

  let match = cardRegex.exec(source);
  while (match) {
    const positionName = cleanCalcareersText(match[1]) || "Untitled Position";
    const companyName = cleanCalcareersText(match[3]) || "Unknown Department";
    const location = cleanCalcareersText(match[4]) || null;
    const postingDate = cleanCalcareersText(match[5]) || null;
    const jobPostingUrl = cleanCalcareersText(match[6]);
    if (!jobPostingUrl || seenUrls.has(jobPostingUrl)) {
      match = cardRegex.exec(source);
      continue;
    }
    postings.push({
      company_name: companyName,
      position_name: positionName,
      job_posting_url: jobPostingUrl,
      posting_date: postingDate,
      location
    });
    seenUrls.add(jobPostingUrl);
    match = cardRegex.exec(source);
  }

  return postings;
}

function buildCalcareersPostPayload(hiddenFields, eventTarget) {
  const payload = { ...(hiddenFields || {}) };
  payload.__EVENTTARGET = eventTarget;
  payload.__EVENTARGUMENT = "";
  payload["ctl00$cphMainContent$txtKeyword"] = "";
  payload["ctl00$cphMainContent$chkExactWordMatch"] = "on";
  payload["ctl00$cphMainContent$hdnInit"] = "true";
  payload["ctl00$ucUtilityHeader1$txtGoogleSiteSearch"] = payload["ctl00$ucUtilityHeader1$txtGoogleSiteSearch"] || "";
  payload["ctl00$hdnShowHeaderPadding"] = payload["ctl00$hdnShowHeaderPadding"] || "1";
  payload["ctl00$ucSessionTimeoutDialog$tmrCountdown"] = payload["ctl00$ucSessionTimeoutDialog$tmrCountdown"] || "1200";
  return payload;
}

async function collectPostingsForCalcareersDynamic() {
  const endpoint = "https://calcareers.ca.gov/CalHRPublic/Search/JobSearchResults.aspx";
  const headers = {
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Content-Type": "application/x-www-form-urlencoded",
    Referer: endpoint
  };
  const referenceEpoch = nowEpochSeconds();
  const postings = [];
  const seenUrls = new Set();
  const pendingTargets = [];
  const visitedTargets = new Set();

  const landing = await fetchWithAtsRateLimit("calcareers", CALCAREERS_RATE_LIMIT_WAIT_MS, endpoint, {
    method: "GET",
    headers
  });
  if (!landing.ok) {
    const body = await landing.text();
    throw new Error(`CalCareers landing request failed (${landing.status}): ${body.slice(0, 180)}`);
  }

  let hidden = extractCalcareersHiddenInputs(await landing.text());
  let nextEventTarget = "ctl00$cphMainContent$btnSearch";
  let rowCountApplied = false;

  while (true) {
    const payload = buildCalcareersPostPayload(hidden, nextEventTarget);
    if (nextEventTarget === "ctl00$cphMainContent$ddlRowCount") {
      payload["ctl00$cphMainContent$ddlRowCount"] = "100";
    }

    const res = await fetchWithAtsRateLimit("calcareers", CALCAREERS_RATE_LIMIT_WAIT_MS, endpoint, {
      method: "POST",
      headers,
      body: new URLSearchParams(payload).toString()
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`CalCareers postback failed (${res.status}): ${body.slice(0, 180)}`);
    }
    const pageHtml = await res.text();
    hidden = extractCalcareersHiddenInputs(pageHtml);

    const batch = parseCalcareersPostingsFromHtml(pageHtml);
    let hasWithin24h = false;
    for (const posting of batch) {
      const postingUrl = String(posting?.job_posting_url || "").trim();
      if (!postingUrl || seenUrls.has(postingUrl)) continue;
      if (!shouldStorePostingByDate(posting?.posting_date, referenceEpoch)) continue;
      postings.push(posting);
      seenUrls.add(postingUrl);
      hasWithin24h = true;
    }

    if (!rowCountApplied) {
      rowCountApplied = true;
      nextEventTarget = "ctl00$cphMainContent$ddlRowCount";
      continue;
    }

    if (!hasWithin24h) break;

    const pagerTargets = extractCalcareersPagerTargets(pageHtml);
    for (const target of pagerTargets) {
      if (visitedTargets.has(target)) continue;
      if (!pendingTargets.includes(target)) {
        pendingTargets.push(target);
      }
    }
    while (pendingTargets.length > 0 && visitedTargets.has(pendingTargets[0])) {
      pendingTargets.shift();
    }
    if (pendingTargets.length === 0) break;

    nextEventTarget = pendingTargets.shift();
    visitedTargets.add(nextEventTarget);
  }

  return postings;
}

function cleanCaloppsText(value) {
  return decodeHtmlEntities(String(value || "").replace(/<[^>]+>/g, " "))
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function inferCaloppsCompanyFromPath(pathValue) {
  const path = String(pathValue || "").trim().replace(/^\/+|\/+$/g, "");
  if (!path) return "Unknown Agency";
  const firstSegment = path.split("/", 1)[0];
  const company = firstSegment.replace(/-/g, " ").trim();
  return company ? toTitleCase(company) : "Unknown Agency";
}

function parseCaloppsPostingsFromHtml(pageHtml, pageUrl) {
  const source = String(pageHtml || "");
  if (!source) return [];

  const postings = [];
  const seenUrls = new Set();
  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  const cellRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
  const linkRegex = /<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i;

  let rowMatch = rowRegex.exec(source);
  while (rowMatch) {
    const rowHtml = String(rowMatch[1] || "");
    if (!rowHtml.toLowerCase().includes("views-field-label")) {
      rowMatch = rowRegex.exec(source);
      continue;
    }

    const cells = [];
    let cellMatch = cellRegex.exec(rowHtml);
    while (cellMatch) {
      cells.push(String(cellMatch[1] || ""));
      cellMatch = cellRegex.exec(rowHtml);
    }
    if (cells.length < 5) {
      rowMatch = rowRegex.exec(source);
      continue;
    }

    const linkMatch = linkRegex.exec(cells[0]);
    if (!linkMatch) {
      rowMatch = rowRegex.exec(source);
      continue;
    }

    const href = cleanCaloppsText(linkMatch[1]);
    const jobPostingUrl = urljoin(pageUrl, href);
    if (!jobPostingUrl || seenUrls.has(jobPostingUrl)) {
      rowMatch = rowRegex.exec(source);
      continue;
    }

    const title = cleanCaloppsText(linkMatch[2]) || "Untitled Position";
    const region = cleanCaloppsText(cells[1]) || null;
    const category = cleanCaloppsText(cells[2]) || null;
    const jobType = cleanCaloppsText(cells[3]) || null;
    const closeDate = cleanCaloppsText(cells[4]) || null;
    const postingIdMatch = href.match(/\/job-(\d+)/i);
    const postingId = postingIdMatch?.[1] || jobPostingUrl;

    postings.push({
      id: postingId,
      company_name: inferCaloppsCompanyFromPath(href),
      position_name: title,
      job_posting_url: jobPostingUrl,
      posting_date: new Date().toISOString(),
      location: region,
      category,
      work_type: jobType,
      close_date: closeDate
    });
    seenUrls.add(jobPostingUrl);

    rowMatch = rowRegex.exec(source);
  }

  return postings;
}

function extractCaloppsNextPageUrl(pageHtml, pageUrl) {
  const source = String(pageHtml || "");
  const match = source.match(
    /<li[^>]*class=["'][^"']*\bnext\b[^"']*["'][^>]*>\s*<a[^>]*href=["']([^"']+)["']/i
  );
  if (!match?.[1]) return null;
  return urljoin(pageUrl, cleanCaloppsText(match[1]));
}

async function collectPostingsForCaloppsDynamic(maxPages = 25) {
  let nextPageUrl = "https://www.calopps.org/job-search-list";
  let pagesFetched = 0;
  const pageLimit = Math.max(1, Math.min(100, Number(maxPages) || 25));
  const postings = [];
  const seenUrls = new Set();

  while (nextPageUrl && pagesFetched < pageLimit) {
    const res = await fetchWithAtsRateLimit("calopps", CALOPPS_RATE_LIMIT_WAIT_MS, nextPageUrl, {
      method: "GET",
      headers: {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9"
      }
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`CalOpps request failed (${res.status}): ${body.slice(0, 180)}`);
    }
    const pageHtml = await res.text();
    const batch = parseCaloppsPostingsFromHtml(pageHtml, nextPageUrl);
    for (const posting of batch) {
      const postingUrl = String(posting?.job_posting_url || "").trim();
      if (!postingUrl || seenUrls.has(postingUrl)) continue;
      postings.push(posting);
      seenUrls.add(postingUrl);
    }

    pagesFetched += 1;
    nextPageUrl = extractCaloppsNextPageUrl(pageHtml, nextPageUrl);
  }

  return postings;
}

function formatStatejobsnyDate(dateValue) {
  const date = dateValue instanceof Date ? dateValue : new Date(dateValue);
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const year = String(date.getUTCFullYear()).slice(-2);
  return `${month}/${day}/${year}`;
}

function buildStatejobsnyWindowUrl() {
  const baseUrl = new URL("https://www.statejobsny.com/public/vacancyTable.cfm");
  const now = new Date();
  const startUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1));
  const endUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  baseUrl.searchParams.set("searchResults", "yes");
  baseUrl.searchParams.set("minDate", formatStatejobsnyDate(startUtc));
  baseUrl.searchParams.set("maxDate", formatStatejobsnyDate(endUtc));
  return baseUrl.toString();
}

function cleanStatejobsnyText(value) {
  return decodeHtmlEntities(String(value || "").replace(/<[^>]+>/g, " "))
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseStatejobsnyPostingsFromHtml(pageHtml, pageUrl) {
  const source = String(pageHtml || "");
  if (!source) return [];

  const postings = [];
  const seenUrls = new Set();
  const tbodyMatch = source.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/i);
  const tbodyHtml = tbodyMatch?.[1] || source;
  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  const cellRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
  const linkRegex = /<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i;

  let rowMatch = rowRegex.exec(tbodyHtml);
  while (rowMatch) {
    const rowHtml = String(rowMatch[1] || "");
    const cells = [];
    let cellMatch = cellRegex.exec(rowHtml);
    while (cellMatch) {
      cells.push(String(cellMatch[1] || ""));
      cellMatch = cellRegex.exec(rowHtml);
    }

    if (cells.length < 7) {
      rowMatch = rowRegex.exec(tbodyHtml);
      continue;
    }

    const titleLink = linkRegex.exec(cells[1]);
    if (!titleLink) {
      rowMatch = rowRegex.exec(tbodyHtml);
      continue;
    }

    const href = cleanStatejobsnyText(titleLink[1]);
    const jobPostingUrl = urljoin(pageUrl, href);
    if (!jobPostingUrl || seenUrls.has(jobPostingUrl)) {
      rowMatch = rowRegex.exec(tbodyHtml);
      continue;
    }

    const positionName = cleanStatejobsnyText(titleLink[2]) || "Untitled Position";
    const companyName = cleanStatejobsnyText(cells[5]) || "Unknown Agency";
    const location = cleanStatejobsnyText(cells[6]) || null;
    const postingDate = cleanStatejobsnyText(cells[3]) || null;

    postings.push({
      company_name: companyName,
      position_name: positionName,
      job_posting_url: jobPostingUrl,
      posting_date: postingDate,
      location
    });
    seenUrls.add(jobPostingUrl);
    rowMatch = rowRegex.exec(tbodyHtml);
  }

  return postings;
}

async function collectPostingsForStatejobsnyDynamic() {
  const endpoint = buildStatejobsnyWindowUrl();
  const res = await fetchWithAtsRateLimit("statejobsny", STATEJOBSNY_RATE_LIMIT_WAIT_MS, endpoint, {
    method: "GET",
    headers: {
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "Cache-Control": "no-cache",
      Pragma: "no-cache"
    }
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`StateJobsNY request failed (${res.status}): ${body.slice(0, 180)}`);
  }

  const pageHtml = await res.text();
  return parseStatejobsnyPostingsFromHtml(pageHtml, endpoint);
}

async function collectPostingsForCompany(company) {
  const atsName = String(company?.ATS_name || "").trim().toLowerCase();
  if (atsName === "workday") {
    return collectTodayPostingsForWorkdayCompany(company);
  }
  if (atsName === "ashbyhq") {
    return collectPostingsForAshbyCompany(company);
  }
  if (atsName === "greenhouseio" || atsName === "greenhouse.io" || atsName === "greenhouse") {
    return collectPostingsForGreenhouseCompany(company);
  }
  if (atsName === "leverco" || atsName === "lever.co" || atsName === "lever") {
    return collectPostingsForLeverCompany(company);
  }
  if (atsName === "jobvite" || atsName === "jobvite.com" || atsName === "jobvitecom") {
    return collectPostingsForJobviteCompany(company);
  }
  if (atsName === "applicantpro" || atsName === "applicantpro.com" || atsName === "applicantprocom") {
    return collectPostingsForApplicantProCompany(company);
  }
  if (atsName === "applytojob" || atsName === "applytojob.com" || atsName === "applytojobcom") {
    return collectPostingsForApplyToJobCompany(company);
  }
  if (
    atsName === "theapplicantmanager" ||
    atsName === "theapplicantmanager.com" ||
    atsName === "theapplicantmanagercom"
  ) {
    return collectPostingsForTheApplicantManagerCompany(company);
  }
  if (atsName === "breezy" || atsName === "breezyhr" || atsName === "breezy.hr" || atsName === "breezyhrcom") {
    return collectPostingsForBreezyCompany(company);
  }
  if (atsName === "icims" || atsName === "icims.com" || atsName === "icimscom") {
    return collectPostingsForIcimsCompany(company);
  }
  if (atsName === "zoho" || atsName === "zohorecruit" || atsName === "zohorecruit.com" || atsName === "zohorecruitcom") {
    return collectPostingsForZohoCompany(company);
  }
  if (atsName === "applicantai" || atsName === "applicantai.com" || atsName === "applicantaicom") {
    return collectPostingsForApplicantAiCompany(company);
  }
  if (atsName === "gem" || atsName === "jobs.gem.com" || atsName === "gem.com" || atsName === "gemcom") {
    return collectPostingsForGemCompany(company);
  }
  if (atsName === "jobaps" || atsName === "jobapscloud.com" || atsName === "jobapscloudcom") {
    return collectPostingsForJobApsCompany(company);
  }
  if (atsName === "join" || atsName === "join.com" || atsName === "joincom") {
    return collectPostingsForJoinCompany(company);
  }
  if (
    atsName === "talentreef" ||
    atsName === "jobappnetwork.com" ||
    atsName === "jobappnetworkcom" ||
    atsName === "apply.jobappnetwork.com" ||
    atsName === "applyjobappnetworkcom"
  ) {
    return collectPostingsForTalentreefCompany(company);
  }
  if (atsName === "careerplug" || atsName === "careerplug.com" || atsName === "careerplugcom") {
    return collectPostingsForCareerplugCompany(company);
  }
  if (atsName === "bamboohr" || atsName === "bamboohr.com" || atsName === "bamboohrcom") {
    return collectPostingsForBambooHrCompany(company);
  }
  if (atsName === "adp_myjobs" || atsName === "adpmyjobs") {
    return collectPostingsForAdpMyjobsCompany(company);
  }
  if (
    atsName === "adp_workforcenow" ||
    atsName === "adpworkforcenow" ||
    atsName === "workforcenow.adp.com" ||
    atsName === "workforcenowadpcom"
  ) {
    return collectPostingsForAdpWorkforcenowCompany(company);
  }
  if (
    atsName === "paylocity" ||
    atsName === "paylocity.com" ||
    atsName === "paylocitycom" ||
    atsName === "recruiting.paylocity.com" ||
    atsName === "recruitingpaylocitycom"
  ) {
    return collectPostingsForPaylocityCompany(company);
  }
  if (atsName === "eightfold" || atsName === "eightfold.ai" || atsName === "eightfoldai") {
    return collectPostingsForEightfoldCompany(company);
  }
  if (
    atsName === "oracle" ||
    atsName === "oraclecloud" ||
    atsName === "oraclecloud.com" ||
    atsName === "oraclecloudcom"
  ) {
    return collectPostingsForOracleCompany(company);
  }
  if (
    atsName === "brassring" ||
    atsName === "brassring.com" ||
    atsName === "brassringcom" ||
    atsName === "sjobs.brassring.com" ||
    atsName === "sjobsbrassringcom"
  ) {
    return collectPostingsForBrassringCompany(company);
  }
  if (atsName === "applitrack" || atsName === "applitrack.com" || atsName === "applitrackcom") {
    return collectPostingsForApplitrackCompany(company);
  }
  if (atsName === "hibob" || atsName === "hibob.com" || atsName === "hibobcom" || atsName === "careers.hibob.com" || atsName === "careershibobcom") {
    return collectPostingsForHibobCompany(company);
  }
  if (
    atsName === "isolvisolvedhire" ||
    atsName === "isolvedhire" ||
    atsName === "isolvedhire.com" ||
    atsName === "isolvedhirecom"
  ) {
    return collectPostingsForIsolvisolvedhireCompany(company);
  }
  if (
    atsName === "manatal" ||
    atsName === "manatal.com" ||
    atsName === "manatalcom" ||
    atsName === "careers-page.com" ||
    atsName === "careerspagecom"
  ) {
    return collectPostingsForManatalCompany(company);
  }
  if (atsName === "careerspage" || atsName === "careerspage.io" || atsName === "careerspageio") {
    return collectPostingsForCareerspageCompany(company);
  }
  if (
    atsName === "pageup" ||
    atsName === "pageuppeople" ||
    atsName === "pageuppeople.com" ||
    atsName === "pageuppeoplecom" ||
    atsName === "careers.pageuppeople.com" ||
    atsName === "careerspageuppeoplecom"
  ) {
    return collectPostingsForPageupCompany(company);
  }
  if (
    atsName === "hirebridge" ||
    atsName === "hirebridge.com" ||
    atsName === "hirebridgecom" ||
    atsName === "recruit.hirebridge.com" ||
    atsName === "recruithirebridgecom"
  ) {
    return collectPostingsForHirebridgeCompany(company);
  }
  if (atsName === "teamtailor" || atsName === "teamtailor.com" || atsName === "teamtailorcom") {
    return collectPostingsForTeamtailorCompany(company);
  }
  if (atsName === "freshteam" || atsName === "freshteam.com" || atsName === "freshteamcom") {
    return collectPostingsForFreshteamCompany(company);
  }
  if (
    atsName === "sagehr" ||
    atsName === "sage.hr" ||
    atsName === "talent.sage.hr" ||
    atsName === "talentsagehr"
  ) {
    return collectPostingsForSagehrCompany(company);
  }
  if (atsName === "loxo" || atsName === "loxo.co" || atsName === "loxoco") {
    return collectPostingsForLoxoCompany(company);
  }
  if (atsName === "peopleforce" || atsName === "peopleforce.io" || atsName === "peopleforceio") {
    return collectPostingsForPeopleforceCompany(company);
  }
  if (atsName === "simplicant" || atsName === "simplicant.com" || atsName === "simplicantcom") {
    return collectPostingsForSimplicantCompany(company);
  }
  if (atsName === "pinpointhq" || atsName === "pinpointhq.com" || atsName === "pinpointhqcom") {
    return collectPostingsForPinpointHqCompany(company);
  }
  if (atsName === "recruitcrm" || atsName === "recruitcrm.io" || atsName === "recruitcrmiocom" || atsName === "recruitcrmio") {
    return collectPostingsForRecruitCrmCompany(company);
  }
  if (atsName === "rippling" || atsName === "rippling.com" || atsName === "ripplingcom" || atsName === "ats.rippling.com" || atsName === "atsripplingcom") {
    return collectPostingsForRipplingCompany(company);
  }
  if (atsName === "careerpuck" || atsName === "careerpuck.com" || atsName === "careerpuckcom") {
    return collectPostingsForCareerpuckCompany(company);
  }
  if (atsName === "fountain" || atsName === "fountain.com" || atsName === "fountaincom") {
    return collectPostingsForFountainCompany(company);
  }
  if (atsName === "getro" || atsName === "getro.com" || atsName === "getrocom") {
    return collectPostingsForGetroCompany(company);
  }
  if (atsName === "governmentjobs" || atsName === "governmentjobs.com" || atsName === "governmentjobscom") {
    return collectPostingsForGovernmentJobsDynamic();
  }
  if (
    atsName === "smartrecruiters" ||
    atsName === "smartrecruiters.com" ||
    atsName === "smartrecruiterscom" ||
    atsName === "jobs.smartrecruiters.com" ||
    atsName === "jobssmartrecruiterscom"
  ) {
    return collectPostingsForSmartRecruitersDynamic();
  }
  if (atsName === "policeapp" || atsName === "policeapp.com" || atsName === "policeappcom" || atsName === "www.policeapp.com" || atsName === "wwwpoliceappcom") {
    return collectPostingsForPoliceappDynamic();
  }
  if (atsName === "usajobs" || atsName === "usajobs.gov" || atsName === "usajobsgov" || atsName === "www.usajobs.gov" || atsName === "wwwusajobsgov") {
    return collectPostingsForUsajobsDynamic();
  }
  if (atsName === "k12jobspot" || atsName === "k12jobspot.com" || atsName === "k12jobspotcom" || atsName === "www.k12jobspot.com" || atsName === "wwwk12jobspotcom" || atsName === "api.k12jobspot.com" || atsName === "apik12jobspotcom") {
    return collectPostingsForK12jobspotDynamic();
  }
  if (atsName === "schoolspring" || atsName === "schoolspring.com" || atsName === "schoolspringcom" || atsName === "api.schoolspring.com" || atsName === "apischoolspringcom" || atsName === "www.schoolspring.com" || atsName === "wwwschoolspringcom") {
    return collectPostingsForSchoolspringDynamic();
  }
  if (
    atsName === "calcareers" ||
    atsName === "calcareers.ca.gov" ||
    atsName === "calcareerscagov" ||
    atsName === "www.calcareers.ca.gov" ||
    atsName === "wwwcalcareerscagov"
  ) {
    return collectPostingsForCalcareersDynamic();
  }
  if (
    atsName === "calopps" ||
    atsName === "calopps.org" ||
    atsName === "caloppsorg" ||
    atsName === "www.calopps.org" ||
    atsName === "wwwcaloppsorg"
  ) {
    return collectPostingsForCaloppsDynamic();
  }
  if (
    atsName === "statejobsny" ||
    atsName === "statejobsny.com" ||
    atsName === "statejobsnycom" ||
    atsName === "www.statejobsny.com" ||
    atsName === "wwwstatejobsnycom"
  ) {
    return collectPostingsForStatejobsnyDynamic();
  }
  if (atsName === "hrmdirect" || atsName === "hrmdirect.com" || atsName === "hrmdirectcom") {
    return collectPostingsForHrmDirectCompany(company);
  }
  if (atsName === "talentlyft" || atsName === "talentlyft.com" || atsName === "talentlyftcom") {
    return collectPostingsForTalentlyftCompany(company);
  }
  if (atsName === "talexio" || atsName === "talexio.com" || atsName === "talexiocom") {
    return collectPostingsForTalexioCompany(company);
  }
  if (
    atsName === "saphrcloud" ||
    atsName === "saphrcloud.com" ||
    atsName === "saphrcloudcom" ||
    atsName === "jobs.hr.cloud.sap" ||
    atsName === "jobshrcloudsap"
  ) {
    return collectPostingsForSapHrCloudCompany(company);
  }
  if (atsName === "recruiteecom" || atsName === "recruitee.com" || atsName === "recruitee") {
    return collectPostingsForRecruiteeCompany(company);
  }
  if (atsName === "ultipro" || atsName === "ukg") {
    return collectPostingsForUltiProCompany(company);
  }
  if (atsName === "taleo" || atsName === "taleo.net" || atsName === "taleonet") {
    return collectPostingsForTaleoCompany(company);
  }
  return [];
}

async function ensureCompaniesTableSchema() {
  const tableInfo = await db.all(`PRAGMA table_info('companies');`);
  const columns = new Set(tableInfo.map((column) => String(column?.name || "")));
}

async function initDb() {
  db = await open({
    filename: DB_PATH,
    driver: sqlite3.Database
  });

  await db.exec(`
    PRAGMA busy_timeout = 15000;
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS companies (
      id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      company_name TEXT NOT NULL,
      url_string TEXT NOT NULL,
      ATS_name TEXT NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_companies_url_string
      ON companies(url_string);

    CREATE INDEX IF NOT EXISTS idx_companies_company_name
      ON companies(company_name);
  `);

  await ensurePostingsTable();
  await hydratePostingLocationMapFromDb();
  await ensureJobIndustryTables();
  await ensureStateLocationIndexTable();
  await seedReferenceDataFromBundledDb();
  await ensureIngestionTables(db);
  await seedAtsSources(db, ATS_FILTER_OPTION_ITEMS);
  await ensurePersonalInformationTable();
  await ensureApplicationsTable();
  await ensureBlockedCompaniesTable();
  await ensureSyncServiceSettingsTable();
  await loadSyncServiceSettingsIntoRuntime();
  await ensureCompaniesTableSchema();

  if (DB_BACKEND === "postgres") {
    postgresPool = createPostgresPool();
    await ensurePostgresSchema(postgresPool);
    await seedPostgresAtsSources(postgresPool, ATS_FILTER_OPTION_ITEMS);
  }

  if (SEARCH_BACKEND === "meili") {
    await ensureMeiliPostingsIndex();
  }
}

async function hydratePostingLocationMapFromDb() {
  const rows = await db.all(
    `
      SELECT job_posting_url, location
      FROM Postings
      WHERE location IS NOT NULL
        AND TRIM(location) <> '';
    `
  );

  postingLocationByJobUrl = new Map();
  for (const row of rows) {
    const url = String(row?.job_posting_url || "").trim();
    const location = String(row?.location || "").trim();
    if (url && location) {
      postingLocationByJobUrl.set(url, location);
    }
  }
  postingLocationVersion += 1;
  postingLocationGeoFilterOptionsCache = {
    mapRef: null,
    version: -1,
    countries: [],
    regions: []
  };
}

async function ensureJobIndustryTables() {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS job_industry_categories (
      id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      industry_key TEXT NOT NULL UNIQUE,
      industry_label TEXT NOT NULL,
      priority INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS job_position_industry (
      id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      job_title TEXT NOT NULL,
      normalized_job_title TEXT NOT NULL UNIQUE,
      industry_key TEXT NOT NULL,
      industry_label TEXT NOT NULL,
      matched_rules TEXT NOT NULL,
      confidence_score REAL NOT NULL,
      rule_version TEXT NOT NULL DEFAULT 'rule_bootstrap_v4',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (industry_key) REFERENCES job_industry_categories(industry_key)
    );

    CREATE INDEX IF NOT EXISTS idx_job_position_industry_key
      ON job_position_industry(industry_key);
  `);
}

async function ensureStateLocationIndexTable() {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS state_location_index (
      id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      location_type TEXT NOT NULL CHECK (location_type IN ('city', 'county')),
      state_usps TEXT NOT NULL,
      state_geoid TEXT,
      location_geoid TEXT NOT NULL,
      ansicode TEXT,
      location_name TEXT NOT NULL,
      search_location_name TEXT NOT NULL,
      normalized_location_name TEXT NOT NULL,
      normalized_search_location_name TEXT NOT NULL,
      lsad_code TEXT,
      funcstat TEXT,
      aland INTEGER,
      awater INTEGER,
      aland_sqmi REAL,
      awater_sqmi REAL,
      intptlat REAL,
      intptlong REAL,
      source_file TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(location_type, location_geoid)
    );
  `);
}

async function getTableCount(tableName) {
  const row = await db.get(`SELECT COUNT(*) AS count FROM ${tableName};`);
  return Number(row?.count || 0);
}

async function seedReferenceTableWhenEmpty(tableName, columns) {
  const source = await db.get(
    `
      SELECT name
      FROM seed_ref.sqlite_master
      WHERE type = 'table'
        AND name = ?;
    `,
    [tableName]
  );
  if (!source?.name) return 0;

  const targetCount = await getTableCount(tableName);
  if (targetCount > 0) return 0;

  const columnList = columns.join(", ");
  const result = await db.run(
    `
      INSERT OR IGNORE INTO ${tableName} (${columnList})
      SELECT ${columnList}
      FROM seed_ref.${tableName};
    `
  );
  return Number(result?.changes || 0);
}

async function seedReferenceDataFromBundledDb() {
  const resolvedDbPath = path.resolve(DB_PATH);
  const resolvedBundledDbPath = path.resolve(BUNDLED_DB_PATH);
  if (resolvedDbPath === resolvedBundledDbPath || !fs.existsSync(resolvedBundledDbPath)) {
    return;
  }

  try {
    await db.run(`ATTACH DATABASE ? AS seed_ref;`, [resolvedBundledDbPath]);
    await seedReferenceTableWhenEmpty("companies", ["company_name", "url_string", "ATS_name"]);
    await seedReferenceTableWhenEmpty("job_industry_categories", [
      "industry_key",
      "industry_label",
      "priority",
      "created_at"
    ]);
    await seedReferenceTableWhenEmpty("job_position_industry", [
      "job_title",
      "normalized_job_title",
      "industry_key",
      "industry_label",
      "matched_rules",
      "confidence_score",
      "rule_version",
      "created_at",
      "updated_at"
    ]);
    await seedReferenceTableWhenEmpty("state_location_index", [
      "location_type",
      "state_usps",
      "state_geoid",
      "location_geoid",
      "ansicode",
      "location_name",
      "search_location_name",
      "normalized_location_name",
      "normalized_search_location_name",
      "lsad_code",
      "funcstat",
      "aland",
      "awater",
      "aland_sqmi",
      "awater_sqmi",
      "intptlat",
      "intptlong",
      "source_file",
      "created_at"
    ]);
  } catch (error) {
    console.warn(`[openjobslots API] reference seed skipped: ${String(error?.message || error)}`);
  } finally {
    try {
      await db.exec(`DETACH DATABASE seed_ref;`);
    } catch {}
  }
}

async function createCanonicalPostingsTable() {
  await db.exec(`
    CREATE TABLE Postings (
      id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      company_name TEXT NOT NULL,
      position_name TEXT NOT NULL,
      job_posting_url TEXT NOT NULL UNIQUE,
      location TEXT,
      posting_date TEXT,
      first_seen_epoch INTEGER,
      last_seen_epoch INTEGER,
      source_job_id TEXT NOT NULL DEFAULT '',
      parser_version TEXT NOT NULL DEFAULT 'legacy-adapter-v1',
      confidence REAL NOT NULL DEFAULT 0,
      quality_score INTEGER NOT NULL DEFAULT 0,
      quality_flags TEXT NOT NULL DEFAULT '[]',
      rejection_reason TEXT NOT NULL DEFAULT '',
      hidden INTEGER NOT NULL DEFAULT 0,
      hidden_at_epoch INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_postings_company_name
      ON Postings(company_name);

    CREATE INDEX IF NOT EXISTS idx_postings_position_name
      ON Postings(position_name);

    CREATE INDEX IF NOT EXISTS idx_postings_last_seen_epoch
      ON Postings(last_seen_epoch);

    CREATE INDEX IF NOT EXISTS idx_postings_first_seen_epoch
      ON Postings(first_seen_epoch);

    CREATE INDEX IF NOT EXISTS idx_postings_hidden_first_seen_epoch
      ON Postings(hidden, first_seen_epoch);

    CREATE INDEX IF NOT EXISTS idx_postings_hidden_last_seen_epoch
      ON Postings(hidden, last_seen_epoch DESC);
  `);
}

function isSqliteDuplicateColumnError(error) {
  return String(error?.message || error || "").toLowerCase().includes("duplicate column name");
}

async function addPostingsColumnIfMissing(columnName, definition) {
  const columns = await db.all(`PRAGMA table_info('Postings');`);
  const existing = new Set(columns.map((column) => String(column?.name || "")));
  if (existing.has(columnName)) return;
  try {
    await db.exec(`ALTER TABLE Postings ADD COLUMN ${columnName} ${definition};`);
  } catch (error) {
    if (isSqliteDuplicateColumnError(error)) return;
    throw error;
  }
}

async function ensurePostingsTable() {
  const tableInfo = await db.all(`PRAGMA table_info('Postings');`);

  if (!Array.isArray(tableInfo) || tableInfo.length === 0) {
    await createCanonicalPostingsTable();
    return;
  }

  const requiredColumns = new Set(["id", "company_name", "position_name", "job_posting_url", "posting_date"]);
  const existingColumns = new Set(tableInfo.map((column) => String(column.name)));
  const requiredPresent = Array.from(requiredColumns).every((column) => existingColumns.has(column));

  let incompatibleExtraRequiredColumns = false;
  for (const column of tableInfo) {
    const name = String(column.name);
    if (requiredColumns.has(name)) continue;
    if (Number(column.notnull) === 1 && column.dflt_value === null) {
      incompatibleExtraRequiredColumns = true;
      break;
    }
  }

  if (!requiredPresent || incompatibleExtraRequiredColumns) {
    await db.exec(`DROP TABLE IF EXISTS Postings;`);
    await createCanonicalPostingsTable();
    return;
  }

  if (!existingColumns.has("last_seen_epoch")) {
    await addPostingsColumnIfMissing("last_seen_epoch", "INTEGER");
    await db.run(`UPDATE Postings SET last_seen_epoch = ? WHERE last_seen_epoch IS NULL;`, [nowEpochSeconds()]);
  }

  if (!existingColumns.has("first_seen_epoch")) {
    await addPostingsColumnIfMissing("first_seen_epoch", "INTEGER");
  }
  await db.run(
    `
      UPDATE Postings
      SET first_seen_epoch = COALESCE(first_seen_epoch, last_seen_epoch, ?)
      WHERE first_seen_epoch IS NULL;
    `,
    [nowEpochSeconds()]
  );

  if (!existingColumns.has("hidden")) {
    await addPostingsColumnIfMissing("hidden", "INTEGER NOT NULL DEFAULT 0");
  }

  if (!existingColumns.has("hidden_at_epoch")) {
    await addPostingsColumnIfMissing("hidden_at_epoch", "INTEGER");
  }

  if (!existingColumns.has("location")) {
    await addPostingsColumnIfMissing("location", "TEXT");
  }

  if (!existingColumns.has("source_job_id")) {
    await addPostingsColumnIfMissing("source_job_id", "TEXT NOT NULL DEFAULT ''");
  }

  if (!existingColumns.has("parser_version")) {
    await addPostingsColumnIfMissing("parser_version", "TEXT NOT NULL DEFAULT 'legacy-adapter-v1'");
  }

  if (!existingColumns.has("confidence")) {
    await addPostingsColumnIfMissing("confidence", "REAL NOT NULL DEFAULT 0");
  }

  if (!existingColumns.has("quality_score")) {
    await addPostingsColumnIfMissing("quality_score", "INTEGER NOT NULL DEFAULT 0");
  }

  if (!existingColumns.has("quality_flags")) {
    await addPostingsColumnIfMissing("quality_flags", "TEXT NOT NULL DEFAULT '[]'");
  }

  if (!existingColumns.has("rejection_reason")) {
    await addPostingsColumnIfMissing("rejection_reason", "TEXT NOT NULL DEFAULT ''");
  }

  await db.run(`UPDATE Postings SET last_seen_epoch = ? WHERE last_seen_epoch IS NULL;`, [nowEpochSeconds()]);

  await db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_postings_job_posting_url
      ON Postings(job_posting_url);

    CREATE INDEX IF NOT EXISTS idx_postings_company_name
      ON Postings(company_name);

    CREATE INDEX IF NOT EXISTS idx_postings_position_name
      ON Postings(position_name);

    CREATE INDEX IF NOT EXISTS idx_postings_last_seen_epoch
      ON Postings(last_seen_epoch);

    CREATE INDEX IF NOT EXISTS idx_postings_first_seen_epoch
      ON Postings(first_seen_epoch);

    CREATE INDEX IF NOT EXISTS idx_postings_hidden_first_seen_epoch
      ON Postings(hidden, first_seen_epoch);

    CREATE INDEX IF NOT EXISTS idx_postings_hidden_last_seen_epoch
      ON Postings(hidden, last_seen_epoch DESC);
  `);
}

async function ensurePersonalInformationTable() {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS PersonalInformation (
      first_name TEXT NOT NULL,
      middle_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone_number TEXT NOT NULL,
      address TEXT NOT NULL,
      linkedin_url TEXT NOT NULL,
      github_url TEXT NOT NULL,
      portfolio_url TEXT NOT NULL,
      resume_file_path TEXT NOT NULL,
      projects_portfolio_file_path TEXT NOT NULL,
      certifications_folder_path TEXT NOT NULL,
      ethnicity TEXT NOT NULL,
      gender TEXT NOT NULL,
      age INTEGER NOT NULL,
      veteran_status TEXT NOT NULL,
      disability_status TEXT NOT NULL,
      education_level TEXT NOT NULL,
      years_of_experience INTEGER NOT NULL
    );
  `);

  const tableInfo = await db.all(`PRAGMA table_info('PersonalInformation');`);
  const existingColumns = new Set(tableInfo.map((column) => String(column?.name || "")));

  if (!existingColumns.has("years_of_experience")) {
    await db.exec(`
      ALTER TABLE PersonalInformation
      ADD COLUMN years_of_experience INTEGER NOT NULL DEFAULT 0;
    `);
  }
}

async function ensureApplicationsTable() {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS applications (
      id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER NOT NULL,
      position_name TEXT NOT NULL,
      application_date INTEGER NOT NULL,
      status TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_applications_company_id
      ON applications(company_id);

    CREATE INDEX IF NOT EXISTS idx_applications_application_date
      ON applications(application_date);

    CREATE INDEX IF NOT EXISTS idx_applications_status
      ON applications(status);

    CREATE TABLE IF NOT EXISTS application_attribution (
      application_id INTEGER NOT NULL PRIMARY KEY,
      applied_by_type TEXT NOT NULL,
      applied_by_label TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS posting_application_state (
      job_posting_url TEXT NOT NULL PRIMARY KEY,
      applied INTEGER NOT NULL DEFAULT 0,
      applied_by_type TEXT NOT NULL,
      applied_by_label TEXT NOT NULL,
      applied_at_epoch INTEGER,
      last_application_id INTEGER,
      ignored INTEGER NOT NULL DEFAULT 0,
      ignored_at_epoch INTEGER,
      ignored_by_label TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_posting_application_state_applied
      ON posting_application_state(applied);

    CREATE INDEX IF NOT EXISTS idx_posting_application_state_ignored
      ON posting_application_state(ignored);

    CREATE TABLE IF NOT EXISTS McpSettings (
      id INTEGER NOT NULL PRIMARY KEY CHECK (id = 1),
      enabled INTEGER NOT NULL DEFAULT 0,
      preferred_agent_name TEXT NOT NULL DEFAULT 'openjobslots Agent',
      agent_login_email TEXT NOT NULL DEFAULT '',
      agent_login_password TEXT NOT NULL DEFAULT '',
      mfa_login_email TEXT NOT NULL DEFAULT '',
      mfa_login_notes TEXT NOT NULL DEFAULT '',
      dry_run_only INTEGER NOT NULL DEFAULT 1,
      require_final_approval INTEGER NOT NULL DEFAULT 1,
      max_applications_per_run INTEGER NOT NULL DEFAULT 10,
      preferred_search TEXT NOT NULL DEFAULT '',
      preferred_remote TEXT NOT NULL DEFAULT 'all',
      preferred_industries TEXT NOT NULL DEFAULT '[]',
      preferred_regions TEXT NOT NULL DEFAULT '[]',
      preferred_countries TEXT NOT NULL DEFAULT '[]',
      preferred_states TEXT NOT NULL DEFAULT '[]',
      preferred_counties TEXT NOT NULL DEFAULT '[]',
      instructions_for_agent TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  await db.run(
    `
      INSERT INTO McpSettings (
        id,
        enabled,
        preferred_agent_name,
        agent_login_email,
        mfa_login_email,
        mfa_login_notes,
        dry_run_only,
        require_final_approval,
        max_applications_per_run,
        preferred_search,
        preferred_remote,
        preferred_industries,
        preferred_regions,
        preferred_countries,
        preferred_states,
        preferred_counties,
        instructions_for_agent
      ) VALUES (1, 0, ?, '', '', '', 1, 1, 10, '', 'all', '[]', '[]', '[]', '[]', '[]', '')
      ON CONFLICT(id) DO NOTHING;
    `,
    [MCP_SETTINGS_DEFAULTS.preferred_agent_name]
  );

  const postingStateColumns = await db.all(`PRAGMA table_info('posting_application_state');`);
  const postingStateColumnNames = new Set(postingStateColumns.map((column) => String(column?.name || "")));
  const mcpSettingsColumns = await db.all(`PRAGMA table_info('McpSettings');`);
  const mcpSettingsColumnNames = new Set(mcpSettingsColumns.map((column) => String(column?.name || "")));

  if (!postingStateColumnNames.has("ignored")) {
    await db.exec(`
      ALTER TABLE posting_application_state
      ADD COLUMN ignored INTEGER NOT NULL DEFAULT 0;
    `);
  }
  if (!postingStateColumnNames.has("ignored_at_epoch")) {
    await db.exec(`
      ALTER TABLE posting_application_state
      ADD COLUMN ignored_at_epoch INTEGER;
    `);
  }
  if (!postingStateColumnNames.has("ignored_by_label")) {
    await db.exec(`
      ALTER TABLE posting_application_state
      ADD COLUMN ignored_by_label TEXT NOT NULL DEFAULT '';
    `);
  }
  await db.exec(`
    CREATE INDEX IF NOT EXISTS idx_posting_application_state_ignored
      ON posting_application_state(ignored);
  `);

  if (!mcpSettingsColumnNames.has("agent_login_password")) {
    await db.exec(`
      ALTER TABLE McpSettings
      ADD COLUMN agent_login_password TEXT NOT NULL DEFAULT '';
    `);
  }
  if (!mcpSettingsColumnNames.has("preferred_regions")) {
    await db.exec(`
      ALTER TABLE McpSettings
      ADD COLUMN preferred_regions TEXT NOT NULL DEFAULT '[]';
    `);
  }
  if (!mcpSettingsColumnNames.has("preferred_countries")) {
    await db.exec(`
      ALTER TABLE McpSettings
      ADD COLUMN preferred_countries TEXT NOT NULL DEFAULT '[]';
    `);
  }
}

async function ensureSyncServiceSettingsTable() {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS SyncServiceSettings (
      id INTEGER NOT NULL PRIMARY KEY CHECK (id = 1),
      ats_request_queue_concurrency INTEGER NOT NULL DEFAULT 1,
      sync_enabled_ats TEXT NOT NULL DEFAULT '[]',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const syncSettingsColumns = await db.all(`PRAGMA table_info(SyncServiceSettings);`);
  const syncSettingsColumnNames = new Set(
    (Array.isArray(syncSettingsColumns) ? syncSettingsColumns : []).map((column) => String(column?.name || ""))
  );
  if (!syncSettingsColumnNames.has("sync_enabled_ats")) {
    await db.exec(`
      ALTER TABLE SyncServiceSettings
      ADD COLUMN sync_enabled_ats TEXT NOT NULL DEFAULT '[]';
    `);
  }

  await db.run(
    `
      INSERT INTO SyncServiceSettings (
        id,
        ats_request_queue_concurrency,
        sync_enabled_ats,
        updated_at
      ) VALUES (1, ?, ?, datetime('now'))
      ON CONFLICT(id) DO NOTHING;
    `,
    [
      SYNC_SERVICE_SETTINGS_DEFAULTS.ats_request_queue_concurrency,
      JSON.stringify(SYNC_SERVICE_SETTINGS_DEFAULTS.sync_enabled_ats)
    ]
  );
}

function normalizeCompanyNameForBlockList(value) {
  return normalizeLikeText(value);
}

async function ensureBlockedCompaniesTable() {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS blocked_companies (
      normalized_company_name TEXT NOT NULL PRIMARY KEY,
      company_name TEXT NOT NULL,
      blocked_at_epoch INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_blocked_companies_company_name
      ON blocked_companies(company_name);
  `);
}

async function listBlockedCompanies() {
  const rows = await db.all(`
    SELECT normalized_company_name, company_name, blocked_at_epoch
    FROM blocked_companies
    ORDER BY company_name ASC;
  `);

  return rows.map((row) => ({
    normalized_company_name: String(row?.normalized_company_name || ""),
    company_name: String(row?.company_name || ""),
    blocked_at_epoch: Number(row?.blocked_at_epoch || 0)
  }));
}

async function blockCompanyByName(rawCompanyName) {
  const companyName = String(rawCompanyName || "").trim();
  const normalizedCompanyName = normalizeCompanyNameForBlockList(companyName);
  if (!companyName || !normalizedCompanyName) {
    throw new Error("company_name is required");
  }

  await db.run(
    `
      INSERT INTO blocked_companies (
        normalized_company_name,
        company_name,
        blocked_at_epoch
      ) VALUES (?, ?, ?)
      ON CONFLICT(normalized_company_name) DO UPDATE SET
        company_name = excluded.company_name,
        blocked_at_epoch = excluded.blocked_at_epoch;
    `,
    [normalizedCompanyName, companyName, nowEpochSeconds()]
  );

  return db.get(
    `
      SELECT normalized_company_name, company_name, blocked_at_epoch
      FROM blocked_companies
      WHERE normalized_company_name = ?
      LIMIT 1;
    `,
    [normalizedCompanyName]
  );
}

async function unblockCompanyByName(rawCompanyName) {
  const normalizedCompanyName = normalizeCompanyNameForBlockList(rawCompanyName);
  if (!normalizedCompanyName) {
    throw new Error("company_name is required");
  }

  const result = await db.run(
    `
      DELETE FROM blocked_companies
      WHERE normalized_company_name = ?;
    `,
    [normalizedCompanyName]
  );

  return Number(result?.changes || 0) > 0;
}

async function getStoredSyncServiceSettings() {
  const row = await db.get(
    `
      SELECT
        ats_request_queue_concurrency,
        sync_enabled_ats
      FROM SyncServiceSettings
      WHERE id = 1
      LIMIT 1;
    `
  );

  return normalizeSyncServiceSettingsInput(
    {
      ...SYNC_SERVICE_SETTINGS_DEFAULTS,
      ats_request_queue_concurrency: row?.ats_request_queue_concurrency,
      sync_enabled_ats: row?.sync_enabled_ats
    },
    SYNC_SERVICE_SETTINGS_DEFAULTS
  );
}

async function loadSyncServiceSettingsIntoRuntime() {
  const stored = await getStoredSyncServiceSettings();
  atsRequestQueueConcurrency = normalizeAtsRequestQueueConcurrency(stored?.ats_request_queue_concurrency);
  syncEnabledAts = new Set(normalizeSyncEnabledAts(stored?.sync_enabled_ats));
  return stored;
}

async function getSyncServiceSettings() {
  const stored = await getStoredSyncServiceSettings();
  return {
    ...stored,
    active_ats_request_queue_concurrency: atsRequestQueueConcurrency,
    min_ats_request_queue_concurrency: MIN_ATS_REQUEST_QUEUE_CONCURRENCY,
    max_ats_request_queue_concurrency: MAX_ATS_REQUEST_QUEUE_CONCURRENCY,
    applies_after_service_restart: true
  };
}

async function upsertSyncServiceSettings(input = {}) {
  const existing = await getStoredSyncServiceSettings();
  const normalized = normalizeSyncServiceSettingsInput(input, existing);

  await db.run(
    `
      INSERT INTO SyncServiceSettings (
        id,
        ats_request_queue_concurrency,
        sync_enabled_ats,
        updated_at
      ) VALUES (1, ?, ?, datetime('now'))
      ON CONFLICT(id) DO UPDATE SET
        ats_request_queue_concurrency = excluded.ats_request_queue_concurrency,
        sync_enabled_ats = excluded.sync_enabled_ats,
        updated_at = datetime('now');
    `,
    [normalized.ats_request_queue_concurrency, JSON.stringify(normalized.sync_enabled_ats)]
  );

  syncEnabledAts = new Set(normalized.sync_enabled_ats);
  return getSyncServiceSettings();
}

async function getMcpSettings() {
  const row = await db.get(
    `
      SELECT
        id,
        enabled,
        preferred_agent_name,
        agent_login_email,
        agent_login_password,
        mfa_login_email,
        mfa_login_notes,
        dry_run_only,
        require_final_approval,
        max_applications_per_run,
        preferred_search,
        preferred_remote,
        preferred_industries,
        preferred_states,
        preferred_counties,
        instructions_for_agent
      FROM McpSettings
      WHERE id = 1
      LIMIT 1;
    `
  );

  const settings = normalizeMcpSettingsInput({
    ...MCP_SETTINGS_DEFAULTS,
    enabled: Boolean(Number(row?.enabled || 0)),
    preferred_agent_name: row?.preferred_agent_name,
    agent_login_email: row?.agent_login_email,
    agent_login_password: row?.agent_login_password,
    mfa_login_email: row?.mfa_login_email,
    mfa_login_notes: row?.mfa_login_notes,
    dry_run_only: Boolean(Number(row?.dry_run_only ?? 1)),
    require_final_approval: Boolean(Number(row?.require_final_approval ?? 1)),
    max_applications_per_run: row?.max_applications_per_run,
    preferred_search: row?.preferred_search,
    preferred_remote: row?.preferred_remote,
    preferred_industries: parseJsonArray(row?.preferred_industries),
    preferred_regions: parseJsonArray(row?.preferred_regions),
    preferred_countries: parseJsonArray(row?.preferred_countries),
    preferred_states: parseJsonArray(row?.preferred_states),
    preferred_counties: parseJsonArray(row?.preferred_counties),
    instructions_for_agent: row?.instructions_for_agent
  });

  return settings;
}

async function upsertMcpSettings(input) {
  const normalized = normalizeMcpSettingsInput(input);
  await db.run(
    `
      INSERT INTO McpSettings (
        id,
        enabled,
        preferred_agent_name,
        agent_login_email,
        agent_login_password,
        mfa_login_email,
        mfa_login_notes,
        dry_run_only,
        require_final_approval,
        max_applications_per_run,
        preferred_search,
        preferred_remote,
        preferred_industries,
        preferred_regions,
        preferred_countries,
        preferred_states,
        preferred_counties,
        instructions_for_agent,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(id) DO UPDATE SET
        enabled = excluded.enabled,
        preferred_agent_name = excluded.preferred_agent_name,
        agent_login_email = excluded.agent_login_email,
        agent_login_password = excluded.agent_login_password,
        mfa_login_email = excluded.mfa_login_email,
        mfa_login_notes = excluded.mfa_login_notes,
        dry_run_only = excluded.dry_run_only,
        require_final_approval = excluded.require_final_approval,
        max_applications_per_run = excluded.max_applications_per_run,
        preferred_search = excluded.preferred_search,
        preferred_remote = excluded.preferred_remote,
        preferred_industries = excluded.preferred_industries,
        preferred_regions = excluded.preferred_regions,
        preferred_countries = excluded.preferred_countries,
        preferred_states = excluded.preferred_states,
        preferred_counties = excluded.preferred_counties,
        instructions_for_agent = excluded.instructions_for_agent,
        updated_at = datetime('now');
    `,
    [
      1,
      normalized.enabled ? 1 : 0,
      normalized.preferred_agent_name,
      normalized.agent_login_email,
      normalized.agent_login_password,
      normalized.mfa_login_email,
      normalized.mfa_login_notes,
      normalized.dry_run_only ? 1 : 0,
      normalized.require_final_approval ? 1 : 0,
      normalized.max_applications_per_run,
      normalized.preferred_search,
      normalized.preferred_remote,
      JSON.stringify(normalized.preferred_industries || []),
      JSON.stringify(normalized.preferred_regions || []),
      JSON.stringify(normalized.preferred_countries || []),
      JSON.stringify(normalized.preferred_states || []),
      JSON.stringify(normalized.preferred_counties || []),
      normalized.instructions_for_agent
    ]
  );

  return getMcpSettings();
}

async function markPostingAppliedState(payload) {
  const jobPostingUrl = String(payload?.job_posting_url || "").trim();
  if (!jobPostingUrl) return;

  const applied = normalizeBoolean(payload?.applied, true);
  const appliedByType = normalizeAppliedByType(payload?.applied_by_type);
  const appliedByLabel = normalizeAppliedByLabel(payload?.applied_by_label, appliedByType);
  const appliedAtEpoch = parseNonNegativeInteger(payload?.applied_at_epoch) || nowEpochSeconds();
  const lastApplicationId = parseNonNegativeInteger(payload?.last_application_id) || null;

  await db.run(
    `
      INSERT INTO posting_application_state (
        job_posting_url,
        applied,
        applied_by_type,
        applied_by_label,
        applied_at_epoch,
        last_application_id,
        ignored,
        ignored_at_epoch,
        ignored_by_label,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 0, NULL, '', datetime('now'))
      ON CONFLICT(job_posting_url) DO UPDATE SET
        applied = excluded.applied,
        applied_by_type = excluded.applied_by_type,
        applied_by_label = excluded.applied_by_label,
        applied_at_epoch = excluded.applied_at_epoch,
        last_application_id = excluded.last_application_id,
        ignored = 0,
        ignored_at_epoch = NULL,
        ignored_by_label = '',
        updated_at = datetime('now');
    `,
    [jobPostingUrl, applied ? 1 : 0, appliedByType, appliedByLabel, appliedAtEpoch, lastApplicationId]
  );
}

async function setPostingIgnoredState(payload) {
  const jobPostingUrl = String(payload?.job_posting_url || "").trim();
  if (!jobPostingUrl) {
    throw new Error("job_posting_url is required");
  }

  const ignored = normalizeBoolean(payload?.ignored, true);
  const ignoredAtEpoch = parseNonNegativeInteger(payload?.ignored_at_epoch) || nowEpochSeconds();
  const ignoredByLabel = normalizeIgnoredByLabel(payload?.ignored_by_label);

  await db.run(
    `
      INSERT INTO posting_application_state (
        job_posting_url,
        applied,
        applied_by_type,
        applied_by_label,
        applied_at_epoch,
        last_application_id,
        ignored,
        ignored_at_epoch,
        ignored_by_label,
        updated_at
      ) VALUES (?, 0, 'manual', '', NULL, NULL, ?, ?, ?, datetime('now'))
      ON CONFLICT(job_posting_url) DO UPDATE SET
        ignored = excluded.ignored,
        ignored_at_epoch = CASE
          WHEN excluded.ignored = 1 THEN excluded.ignored_at_epoch
          ELSE NULL
        END,
        ignored_by_label = CASE
          WHEN excluded.ignored = 1 THEN excluded.ignored_by_label
          ELSE ''
        END,
        updated_at = datetime('now');
    `,
    [jobPostingUrl, ignored ? 1 : 0, ignoredAtEpoch, ignoredByLabel]
  );

  const row = await db.get(
    `
      SELECT
        job_posting_url,
        applied,
        ignored,
        ignored_at_epoch,
        ignored_by_label
      FROM posting_application_state
      WHERE job_posting_url = ?
      LIMIT 1;
    `,
    [jobPostingUrl]
  );

  return {
    job_posting_url: jobPostingUrl,
    applied: Boolean(Number(row?.applied || 0)),
    ignored: Boolean(Number(row?.ignored || 0)),
    ignored_at_epoch: Number(row?.ignored_at_epoch || 0),
    ignored_by_label: String(row?.ignored_by_label || "")
  };
}

async function enrichPostingsWithApplicationState(items) {
  const rows = Array.isArray(items) ? items : [];
  const urls = rows
    .map((row) => String(row?.job_posting_url || "").trim())
    .filter(Boolean);
  if (urls.length === 0) return rows;

  const uniqueUrls = Array.from(new Set(urls));
  const placeholders = uniqueUrls.map(() => "?").join(", ");
  const stateRows = await db.all(
    `
      SELECT
        job_posting_url,
        applied,
        applied_by_type,
        applied_by_label,
        applied_at_epoch,
        last_application_id,
        ignored,
        ignored_at_epoch,
        ignored_by_label
      FROM posting_application_state
      WHERE job_posting_url IN (${placeholders});
    `,
    uniqueUrls
  );

  const byUrl = new Map();
  for (const row of stateRows) {
    byUrl.set(String(row?.job_posting_url || "").trim(), row);
  }

  return rows.map((item) => {
    const key = String(item?.job_posting_url || "").trim();
    const state = byUrl.get(key);
    const applied = Boolean(Number(state?.applied || 0));
    const ignored = Boolean(Number(state?.ignored || 0));
    const appliedByType = applied ? normalizeAppliedByType(state?.applied_by_type) : "";
    return {
      ...item,
      applied,
      ignored,
      applied_by_type: appliedByType,
      applied_by_label: applied ? normalizeAppliedByLabel(state?.applied_by_label, appliedByType) : "",
      applied_at_epoch: Number(state?.applied_at_epoch || 0),
      last_application_id: Number(state?.last_application_id || 0),
      ignored_at_epoch: Number(state?.ignored_at_epoch || 0),
      ignored_by_label: ignored ? normalizeIgnoredByLabel(state?.ignored_by_label) : ""
    };
  });
}

async function listPostingsWithFilters(options = {}) {
  const search = String(options?.search || "").trim();
  const limit = Math.max(1, Math.min(2000, Number(options?.limit || 500)));
  const offset = Math.max(0, Number(options?.offset || 0));
  const sortBy = normalizePostingSort(options?.sort_by);
  const orderByClause = getPostingsOrderByClause(sortBy);
  const atsFilters = normalizeAtsFilters(options?.ats || []);
  const industryKeys = normalizeStringArray(options?.industries).map((key) => normalizeLikeText(key));
  const stateCodes = normalizeStringArray(options?.states).map((state) => state.toUpperCase());
  const countyFilters = parseCountyFilters(normalizeStringArray(options?.counties));
  const countryFilters = parseCountryFilters(normalizeStringArray(options?.countries));
  const regionFilters = parseRegionFilters(normalizeStringArray(options?.regions));
  const remoteFilter = normalizeRemoteFilter(options?.remote);
  const hideNoDate = normalizeBoolean(options?.hide_no_date, false);
  const freshnessDays = normalizeFreshnessDays(options?.freshness_days);
  const freshnessCutoffEpoch = freshnessDays ? nowEpochSeconds() - freshnessDays * 24 * 60 * 60 : 0;
  const includeApplied = normalizeBoolean(options?.include_applied, true);
  const includeIgnored = normalizeBoolean(options?.include_ignored, false);
  const requiresInMemorySort = sortBy === "relevance" || sortBy === "posted_date" || sortBy === "ats_source";
  const hasStructuredFilters =
    atsFilters.length > 0 ||
    industryKeys.length > 0 ||
    stateCodes.length > 0 ||
    countyFilters.length > 0 ||
    countryFilters.length > 0 ||
    regionFilters.length > 0 ||
    remoteFilter !== "all" ||
    Boolean(freshnessDays) ||
    requiresInMemorySort;

  let rows = [];
  let totalCount = 0;
  let sourceFacets = [];
  if (!search && !hasStructuredFilters) {
    if (includeApplied && includeIgnored) {
      const [countRow, pageRows] = await Promise.all([
        db.get(
          `
            SELECT COUNT(*) AS count
            FROM Postings
            WHERE COALESCE(hidden, 0) = 0
              AND (? = 0 OR (posting_date IS NOT NULL AND TRIM(posting_date) <> ''))
              AND NOT EXISTS (
                SELECT 1
                FROM blocked_companies b
                WHERE b.normalized_company_name = LOWER(TRIM(Postings.company_name))
              );
          `,
          [hideNoDate ? 1 : 0]
        ),
        db.all(
          `
          SELECT id, company_name, position_name, job_posting_url, location, posting_date, first_seen_epoch, last_seen_epoch, confidence, quality_score
          FROM Postings
          WHERE COALESCE(hidden, 0) = 0
            AND (? = 0 OR (posting_date IS NOT NULL AND TRIM(posting_date) <> ''))
            AND NOT EXISTS (
              SELECT 1
              FROM blocked_companies b
              WHERE b.normalized_company_name = LOWER(TRIM(Postings.company_name))
            )
          ORDER BY ${orderByClause}
          LIMIT ? OFFSET ?;
        `,
          [hideNoDate ? 1 : 0, limit, offset]
        )
      ]);
      rows = pageRows;
      totalCount = Number(countRow?.count || 0);
    } else {
      const [countRow, pageRows] = await Promise.all([
        db.get(
          `
            SELECT COUNT(*) AS count
            FROM Postings p
            LEFT JOIN posting_application_state s
              ON s.job_posting_url = p.job_posting_url
              AND (
                (${includeApplied ? 0 : 1} = 1 AND COALESCE(s.applied, 0) = 1)
                OR
                (${includeIgnored ? 0 : 1} = 1 AND COALESCE(s.ignored, 0) = 1)
              )
            WHERE COALESCE(p.hidden, 0) = 0
              AND (? = 0 OR (p.posting_date IS NOT NULL AND TRIM(p.posting_date) <> ''))
              AND NOT EXISTS (
                SELECT 1
                FROM blocked_companies b
                WHERE b.normalized_company_name = LOWER(TRIM(p.company_name))
              )
              AND s.job_posting_url IS NULL;
          `,
          [hideNoDate ? 1 : 0]
        ),
        db.all(
          `
          SELECT p.id, p.company_name, p.position_name, p.job_posting_url, p.location, p.posting_date, p.first_seen_epoch, p.last_seen_epoch, p.confidence, p.quality_score
          FROM Postings p
          LEFT JOIN posting_application_state s
            ON s.job_posting_url = p.job_posting_url
            AND (
              (${includeApplied ? 0 : 1} = 1 AND COALESCE(s.applied, 0) = 1)
              OR
              (${includeIgnored ? 0 : 1} = 1 AND COALESCE(s.ignored, 0) = 1)
            )
          WHERE COALESCE(p.hidden, 0) = 0
            AND (? = 0 OR (p.posting_date IS NOT NULL AND TRIM(p.posting_date) <> ''))
            AND NOT EXISTS (
              SELECT 1
              FROM blocked_companies b
              WHERE b.normalized_company_name = LOWER(TRIM(p.company_name))
            )
            AND s.job_posting_url IS NULL
          ORDER BY ${orderByClause}
          LIMIT ? OFFSET ?;
        `,
          [hideNoDate ? 1 : 0, limit, offset]
        )
      ]);
      rows = pageRows;
      totalCount = Number(countRow?.count || 0);
    }
  } else {
    rows = await db.all(
      `
        SELECT id, company_name, position_name, job_posting_url, location, posting_date, first_seen_epoch, last_seen_epoch, confidence, quality_score
        FROM Postings
        WHERE COALESCE(hidden, 0) = 0
          AND NOT EXISTS (
          SELECT 1
          FROM blocked_companies b
          WHERE b.normalized_company_name = LOWER(TRIM(Postings.company_name))
        )
        ORDER BY ${orderByClause};
      `
    );
  }

  const enrichedRows = rows.map((row) => ({
    ...row,
    location: String(row?.location || "").trim() || inferPostingLocationFromJobUrl(row?.job_posting_url),
    ats: inferAtsFromJobPostingUrl(row?.job_posting_url)
  }));

  const searchTermGroups = tokenizeSearchText(search);
  const industryMatchersByKey = await buildIndustryMatchersByKey(industryKeys);

  let items = enrichedRows;
  if (search || hasStructuredFilters) {
    items = enrichedRows.filter((row) => {
      const ats = String(row?.ats || "").toLowerCase();

      const matchesSearch = searchTermGroups.every((aliases) =>
        aliases.some((term) => searchTokenMatchesPosting(term, row))
      );
      if (!matchesSearch) return false;

      if (atsFilters.length > 0 && !atsFilters.includes(ats)) return false;

      const matchesIndustry = rowMatchesIndustryLikeParts(
        row?.position_name,
        industryKeys,
        industryMatchersByKey
      );
      if (!matchesIndustry) return false;

      const matchesLocation = rowMatchesLocationFilters(
        row?.location,
        stateCodes,
        countyFilters,
        countryFilters,
        regionFilters
      );
      if (!matchesLocation) return false;

      const matchesRemote = rowMatchesRemoteFilter(row?.location, remoteFilter);
      if (!matchesRemote) return false;

      if (hideNoDate && !String(row?.posting_date || "").trim()) return false;
      if (freshnessCutoffEpoch && Number(row?.last_seen_epoch || 0) < freshnessCutoffEpoch) return false;

      return true;
    });
    items = sortSqlitePostingItems(items, sortBy, search);
    totalCount = items.length;
    sourceFacets = buildPublicSourceFacets(items);
    items = items.slice(offset, offset + limit);
  } else {
    sourceFacets = buildPublicSourceFacets(enrichedRows);
  }

  items = await enrichPostingsWithApplicationState(items);

  if (!includeApplied) {
    items = items.filter((item) => !item.applied);
  }
  if (!includeIgnored) {
    items = items.filter((item) => !item.ignored);
  }

  return {
    items,
    count: totalCount || items.length,
    count_exact: true,
    source_facets: sourceFacets,
    limit,
    offset,
    filters: {
      search,
      ats: atsFilters,
      sort_by: sortBy,
      freshness_days: freshnessDays,
      industries: industryKeys,
      states: stateCodes,
      counties: countyFilters.map((filter) =>
        filter?.stateCode ? `${filter.stateCode}|${filter.countyLikePart}` : filter.countyLikePart
      ),
      countries: countryFilters.map((filter) => filter.value),
      regions: regionFilters,
      remote: remoteFilter,
      hide_no_date: hideNoDate,
      include_ignored: includeIgnored
    }
  };
}

function buildMcpRunbook(settings, personalInformation, candidates) {
  const preferredAgent = String(settings?.preferred_agent_name || "openjobslots Agent").trim();
  const applicantFullName = [
    String(personalInformation?.first_name || "").trim(),
    String(personalInformation?.middle_name || "").trim(),
    String(personalInformation?.last_name || "").trim()
  ]
    .filter(Boolean)
    .join(" ");

  return {
    preferred_agent_name: preferredAgent,
    summary:
      "Use your existing browser/web automation tools to open each job URL, complete the application form, and submit only when allowed by settings and credentials.",
    steps: [
      "Read applicantee information and MCP settings from this payload.",
      "For each candidate posting, open job_posting_url and validate role relevance before applying.",
      "Fill application fields using applicantee information. Keep applicant email separate from agent login email.",
      "If an account or MFA is required, use agent_login_email + agent_login_password for account creation and sign-in flows.",
      "Use the same agent_login_email for MFA/approval flows when required.",
      "Draft a job-specific cover letter aligned to the posting requirements and applicant background.",
      "If dry_run_only is true, stop before final submit and return a dry-run result.",
      "When application is submitted, call record_application_result with commit=true to write outcomes."
    ],
    guardrails: {
      dry_run_only: Boolean(settings?.dry_run_only),
      require_final_approval: Boolean(settings?.require_final_approval)
    },
    applicant_display_name: applicantFullName || "Applicant",
    applicant_email: String(personalInformation?.email || "").trim(),
    agent_login_email: String(settings?.agent_login_email || "").trim(),
    agent_login_password: String(settings?.agent_login_password || ""),
    mfa_login_email: String(settings?.agent_login_email || "").trim(),
    mfa_login_notes: String(settings?.mfa_login_notes || "").trim(),
    custom_instructions: String(settings?.instructions_for_agent || "").trim(),
    candidate_count: Array.isArray(candidates) ? candidates.length : 0
  };
}

function buildCoverLetterDraft(personalInformation, posting, instructions = "") {
  const firstName = String(personalInformation?.first_name || "").trim() || "Applicant";
  const lastName = String(personalInformation?.last_name || "").trim();
  const fullName = `${firstName}${lastName ? ` ${lastName}` : ""}`.trim();
  const yearsOfExperience = parseNonNegativeInteger(personalInformation?.years_of_experience);
  const positionName = String(posting?.position_name || "the role").trim();
  const companyName = String(posting?.company_name || "your company").trim();
  const linkedinUrl = String(personalInformation?.linkedin_url || "").trim();
  const githubUrl = String(personalInformation?.github_url || "").trim();
  const portfolioUrl = String(personalInformation?.portfolio_url || "").trim();
  const educationLevel = String(personalInformation?.education_level || "").trim();
  const extraInstructions = String(instructions || "").trim();

  const profileDetails = [];
  if (yearsOfExperience > 0) profileDetails.push(`${yearsOfExperience}+ years of relevant experience`);
  if (educationLevel) profileDetails.push(`education in ${educationLevel}`);
  if (linkedinUrl) profileDetails.push(`LinkedIn: ${linkedinUrl}`);
  if (githubUrl) profileDetails.push(`GitHub: ${githubUrl}`);
  if (portfolioUrl) profileDetails.push(`Portfolio: ${portfolioUrl}`);

  const profileSentence =
    profileDetails.length > 0
      ? `My background includes ${profileDetails.join(", ")}.`
      : "I bring hands-on experience delivering high-quality work in fast-moving environments.";

  const instructionSentence = extraInstructions
    ? `I am especially aligned with these priorities: ${extraInstructions}.`
    : "";

  return `Dear Hiring Team,

I am excited to apply for the ${positionName} role at ${companyName}. ${profileSentence}

I am motivated by opportunities where I can contribute quickly, collaborate with a strong team, and improve outcomes for customers and the business. ${instructionSentence}

Thank you for your consideration. I would value the chance to discuss how I can support ${companyName}.

Sincerely,
${fullName}`.trim();
}

async function resolveCompanyIdForApplication(companyName) {
  const normalized = normalizeLikeText(companyName);
  if (!normalized) return null;

  return db.get(
    `
      SELECT id, company_name
      FROM companies
      WHERE LOWER(company_name) = ?
      ORDER BY id ASC
      LIMIT 1;
    `,
    [normalized]
  );
}

async function resolveCompanyIdFromPostingUrl(jobPostingUrl) {
  const normalizedUrl = String(jobPostingUrl || "").trim();
  if (!normalizedUrl) return null;

  const posting = await db.get(
    `
      SELECT company_name
      FROM Postings
      WHERE job_posting_url = ?
      LIMIT 1;
    `,
    [normalizedUrl]
  );

  const normalizedCompanyName = normalizeLikeText(posting?.company_name);
  if (!normalizedCompanyName) return null;

  return db.get(
    `
      SELECT id, company_name
      FROM companies
      WHERE LOWER(company_name) = ?
      ORDER BY id ASC
      LIMIT 1;
    `,
    [normalizedCompanyName]
  );
}

async function getExistingAppliedApplicationByPostingUrl(jobPostingUrl) {
  const normalizedUrl = String(jobPostingUrl || "").trim();
  if (!normalizedUrl) return null;

  const state = await db.get(
    `
      SELECT last_application_id
      FROM posting_application_state
      WHERE job_posting_url = ?
        AND COALESCE(applied, 0) = 1
      LIMIT 1;
    `,
    [normalizedUrl]
  );
  const lastApplicationId = parseNonNegativeInteger(state?.last_application_id);
  if (!lastApplicationId) return null;

  return getApplicationById(lastApplicationId);
}

function mapApplicationRow(row) {
  if (!row) return null;
  const status = normalizeApplicationStatus(row?.status);
  const appliedByType = normalizeAppliedByType(row?.applied_by_type);
  return {
    id: Number(row?.id || 0),
    company_id: Number(row?.company_id || 0),
    company_name: String(row?.company_name || "").trim(),
    position_name: String(row?.position_name || "").trim(),
    application_date: Number(row?.application_date || 0),
    status,
    applied_by_type: appliedByType,
    applied_by_label: normalizeAppliedByLabel(row?.applied_by_label, appliedByType)
  };
}

async function getApplicationById(applicationId) {
  const row = await db.get(
    `
      SELECT
        a.id,
        a.company_id,
        c.company_name,
        a.position_name,
        a.application_date,
        a.status,
        attr.applied_by_type,
        attr.applied_by_label
      FROM applications a
      LEFT JOIN companies c
        ON c.id = a.company_id
      LEFT JOIN application_attribution attr
        ON attr.application_id = a.id
      WHERE a.id = ?;
    `,
    [applicationId]
  );

  return mapApplicationRow(row);
}

async function listApplications(options = {}) {
  const limit = Math.max(1, Math.min(2000, Number(options?.limit || 500)));
  const offset = Math.max(0, Number(options?.offset || 0));
  const status = normalizeLikeText(options?.status);

  let rows = [];
  if (status && status !== "all") {
    rows = await db.all(
      `
        SELECT
          a.id,
          a.company_id,
          c.company_name,
          a.position_name,
          a.application_date,
          a.status,
          attr.applied_by_type,
          attr.applied_by_label
        FROM applications a
        LEFT JOIN companies c
          ON c.id = a.company_id
        LEFT JOIN application_attribution attr
          ON attr.application_id = a.id
        WHERE LOWER(COALESCE(a.status, '')) = ?
        ORDER BY a.application_date DESC, a.id DESC
        LIMIT ? OFFSET ?;
      `,
      [status, limit, offset]
    );
  } else {
    rows = await db.all(
      `
        SELECT
          a.id,
          a.company_id,
          c.company_name,
          a.position_name,
          a.application_date,
          a.status,
          attr.applied_by_type,
          attr.applied_by_label
        FROM applications a
        LEFT JOIN companies c
          ON c.id = a.company_id
        LEFT JOIN application_attribution attr
          ON attr.application_id = a.id
        ORDER BY a.application_date DESC, a.id DESC
        LIMIT ? OFFSET ?;
      `,
      [limit, offset]
    );
  }

  const items = rows.map(mapApplicationRow).filter(Boolean);
  return {
    items,
    count: items.length,
    limit,
    offset
  };
}

async function createApplication(input) {
  const companyName = String(input?.company_name || "").trim();
  const positionName = String(input?.position_name || "").trim();
  const jobPostingUrl = String(input?.job_posting_url || "").trim();
  if (!companyName && !jobPostingUrl) {
    throw new Error("company_name or job_posting_url is required");
  }
  if (!positionName) {
    throw new Error("position_name is required");
  }

  if (jobPostingUrl) {
    const existing = await getExistingAppliedApplicationByPostingUrl(jobPostingUrl);
    if (existing) return existing;
  }

  const companyFromPosting = await resolveCompanyIdFromPostingUrl(jobPostingUrl);
  const company = companyFromPosting || (companyName ? await resolveCompanyIdForApplication(companyName) : null);
  if (!company?.id) {
    throw new Error(
      jobPostingUrl
        ? `Unable to resolve company_id for job_posting_url='${jobPostingUrl}'`
        : `Unable to resolve company_id for company_name='${companyName}'`
    );
  }

  const status = normalizeApplicationStatus(input?.status);
  const applicationDate = parseNonNegativeInteger(input?.application_date) || nowEpochSeconds();
  const appliedByType = normalizeAppliedByType(input?.applied_by_type);
  const appliedByLabel = normalizeAppliedByLabel(input?.applied_by_label, appliedByType);

  await db.exec("BEGIN TRANSACTION;");
  try {
    const result = await db.run(
      `
        INSERT INTO applications (
          company_id,
          position_name,
          application_date,
          status
        ) VALUES (?, ?, ?, ?);
      `,
      [company.id, positionName, applicationDate, status]
    );

    await db.run(
      `
        INSERT INTO application_attribution (
          application_id,
          applied_by_type,
          applied_by_label,
          updated_at
        ) VALUES (?, ?, ?, datetime('now'))
        ON CONFLICT(application_id) DO UPDATE SET
          applied_by_type = excluded.applied_by_type,
          applied_by_label = excluded.applied_by_label,
          updated_at = datetime('now');
      `,
      [result.lastID, appliedByType, appliedByLabel]
    );

    if (jobPostingUrl) {
      await markPostingAppliedState({
        job_posting_url: jobPostingUrl,
        applied: true,
        applied_by_type: appliedByType,
        applied_by_label: appliedByLabel,
        applied_at_epoch: applicationDate,
        last_application_id: result.lastID
      });
    }

    await db.exec("COMMIT;");
    return getApplicationById(result.lastID);
  } catch (error) {
    try {
      await db.exec("ROLLBACK;");
    } catch {
      // A failed BEGIN leaves no open transaction to roll back.
    }
    throw error;
  }
}

async function updateApplicationStatus(applicationId, statusValue) {
  const status = normalizeApplicationStatus(statusValue);
  const result = await db.run(
    `
      UPDATE applications
      SET status = ?
      WHERE id = ?;
    `,
    [status, applicationId]
  );

  if (Number(result?.changes || 0) === 0) {
    return null;
  }

  return getApplicationById(applicationId);
}

async function deleteApplicationById(applicationId) {
  await db.exec("BEGIN TRANSACTION;");
  try {
    const trackedPostingRows = await db.all(
      `
        SELECT job_posting_url
        FROM posting_application_state
        WHERE last_application_id = ?;
      `,
      [applicationId]
    );
    const trackedPostingUrls = trackedPostingRows
      .map((row) => String(row?.job_posting_url || "").trim())
      .filter(Boolean);

    await db.run(`DELETE FROM application_attribution WHERE application_id = ?;`, [applicationId]);
    const result = await db.run(`DELETE FROM applications WHERE id = ?;`, [applicationId]);

    for (const jobPostingUrl of trackedPostingUrls) {
      const posting = await db.get(
        `
          SELECT company_name, position_name
          FROM Postings
          WHERE job_posting_url = ?
          LIMIT 1;
        `,
        [jobPostingUrl]
      );

      const companyName = normalizeLikeText(posting?.company_name);
      const positionName = normalizeLikeText(posting?.position_name);

      let replacement = null;
      if (companyName && positionName) {
        replacement = await db.get(
          `
            SELECT
              a.id,
              a.application_date,
              attr.applied_by_type,
              attr.applied_by_label
            FROM applications a
            INNER JOIN companies c
              ON c.id = a.company_id
            LEFT JOIN application_attribution attr
              ON attr.application_id = a.id
            WHERE LOWER(c.company_name) = ?
              AND LOWER(a.position_name) = ?
            ORDER BY a.application_date DESC, a.id DESC
            LIMIT 1;
          `,
          [companyName, positionName]
        );
      }

      if (replacement?.id) {
        const appliedByType = normalizeAppliedByType(replacement?.applied_by_type);
        const appliedByLabel = normalizeAppliedByLabel(replacement?.applied_by_label, appliedByType);
        await db.run(
          `
            UPDATE posting_application_state
            SET
              applied = 1,
              applied_by_type = ?,
              applied_by_label = ?,
              applied_at_epoch = ?,
              last_application_id = ?,
              updated_at = datetime('now')
            WHERE job_posting_url = ?;
          `,
          [
            appliedByType,
            appliedByLabel,
            parseNonNegativeInteger(replacement?.application_date) || nowEpochSeconds(),
            Number(replacement?.id),
            jobPostingUrl
          ]
        );
      } else {
        await db.run(
          `
            UPDATE posting_application_state
            SET
              applied = 0,
              applied_by_type = 'manual',
              applied_by_label = '',
              applied_at_epoch = NULL,
              last_application_id = NULL,
              updated_at = datetime('now')
            WHERE job_posting_url = ?;
          `,
          [jobPostingUrl]
        );
      }
    }

    await db.exec("COMMIT;");
    return Number(result?.changes || 0) > 0;
  } catch (error) {
    await db.exec("ROLLBACK;");
    throw error;
  }
}

async function getPersonalInformation() {
  const row = await db.get(
    `
      SELECT
        first_name,
        middle_name,
        last_name,
        email,
        phone_number,
        address,
        linkedin_url,
        github_url,
        portfolio_url,
        resume_file_path,
        projects_portfolio_file_path,
        certifications_folder_path,
        ethnicity,
        gender,
        age,
        veteran_status,
        disability_status,
        education_level,
        years_of_experience
      FROM PersonalInformation
      ORDER BY rowid ASC
      LIMIT 1;
    `
  );

  if (!row) {
    return createDefaultPersonalInformation();
  }

  return normalizePersonalInformationInput(row);
}

async function tableExists(databaseHandle, tableName) {
  const row = await databaseHandle.get(
    `
      SELECT name
      FROM sqlite_master
      WHERE type = 'table'
        AND LOWER(name) = LOWER(?)
      LIMIT 1;
    `,
    [String(tableName || "").trim()]
  );
  return Boolean(row?.name);
}

async function resolveCompanyIdByName(companyName) {
  const normalized = normalizeLikeText(companyName);
  if (!normalized) return null;
  const row = await db.get(
    `
      SELECT id
      FROM companies
      WHERE LOWER(company_name) = ?
      ORDER BY id ASC
      LIMIT 1;
    `,
    [normalized]
  );
  return Number(row?.id || 0) || null;
}

function normalizeMigrationSelection(input = {}) {
  const source = input && typeof input === "object" ? input : {};
  return {
    personal_information:
      source.personal_information === undefined ? true : normalizeBoolean(source.personal_information, true),
    mcp_settings: source.mcp_settings === undefined ? true : normalizeBoolean(source.mcp_settings, true),
    blocked_companies:
      source.blocked_companies === undefined ? true : normalizeBoolean(source.blocked_companies, true),
    applications: source.applications === undefined ? true : normalizeBoolean(source.applications, true)
  };
}

async function migrateSettingsAndApplicationsFromDatabase(rawSourceDbPath, selectionInput = {}) {
  const sourceDbPath = String(rawSourceDbPath || "").trim();
  if (!sourceDbPath) {
    throw new Error("source_db_path is required");
  }
  const selection = normalizeMigrationSelection(selectionInput);
  if (!selection.personal_information && !selection.mcp_settings && !selection.blocked_companies && !selection.applications) {
    throw new Error("At least one migration option must be selected");
  }

  const resolvedSourcePath = path.resolve(sourceDbPath);
  const resolvedTargetPath = path.resolve(DB_PATH);
  if (!fs.existsSync(resolvedSourcePath)) {
    throw new Error(`Source database not found at path: ${resolvedSourcePath}`);
  }
  if (resolvedSourcePath === resolvedTargetPath) {
    throw new Error("Source database path is the same as the active database");
  }

  const summary = {
    source_db_path: resolvedSourcePath,
    target_db_path: resolvedTargetPath,
    selected: selection,
    personal_information_copied: false,
    mcp_settings_copied: false,
    blocked_companies_copied: 0,
    applications_inserted: 0,
    applications_reused: 0,
    applications_skipped_missing_company: 0,
    application_attribution_upserts: 0,
    posting_application_state_upserts: 0
  };

  let sourceDb;
  try {
    sourceDb = await open({
      filename: resolvedSourcePath,
      driver: sqlite3.Database,
      mode: sqlite3.OPEN_READONLY
    });

    if (selection.personal_information && (await tableExists(sourceDb, "PersonalInformation"))) {
      const sourcePersonalInformation = await sourceDb.get(
        `
          SELECT *
          FROM PersonalInformation
          ORDER BY rowid DESC
          LIMIT 1;
        `
      );
      if (sourcePersonalInformation) {
        await upsertPersonalInformation(sourcePersonalInformation);
        summary.personal_information_copied = true;
      }
    }

    if (selection.mcp_settings && (await tableExists(sourceDb, "McpSettings"))) {
      const sourceMcpSettings = await sourceDb.get(
        `
          SELECT *
          FROM McpSettings
          WHERE id = 1
          LIMIT 1;
        `
      );
      if (sourceMcpSettings) {
        await upsertMcpSettings(sourceMcpSettings);
        summary.mcp_settings_copied = true;
      }
    }

    if (selection.blocked_companies && (await tableExists(sourceDb, "blocked_companies"))) {
      const sourceBlockedCompanies = await sourceDb.all(
        `
          SELECT normalized_company_name, company_name, blocked_at_epoch
          FROM blocked_companies;
        `
      );
      for (const item of sourceBlockedCompanies) {
        const companyName = String(item?.company_name || "").trim();
        const normalizedCompanyName =
          String(item?.normalized_company_name || "").trim() || normalizeCompanyNameForBlockList(companyName);
        if (!companyName || !normalizedCompanyName) continue;

        await db.run(
          `
            INSERT INTO blocked_companies (
              normalized_company_name,
              company_name,
              blocked_at_epoch
            ) VALUES (?, ?, ?)
            ON CONFLICT(normalized_company_name) DO UPDATE SET
              company_name = excluded.company_name,
              blocked_at_epoch = excluded.blocked_at_epoch;
          `,
          [normalizedCompanyName, companyName, parseNonNegativeInteger(item?.blocked_at_epoch) || nowEpochSeconds()]
        );
        summary.blocked_companies_copied += 1;
      }
    }

    const hasApplications = selection.applications && (await tableExists(sourceDb, "applications"));
    if (hasApplications) {
      const hasSourceCompanies = await tableExists(sourceDb, "companies");
      const hasSourceAttribution = await tableExists(sourceDb, "application_attribution");
      const sourceApplications = await sourceDb.all(
        `
          SELECT
            a.id AS source_application_id,
            a.company_id AS source_company_id,
            ${
              hasSourceCompanies
                ? "COALESCE(c.company_name, '')"
                : "''"
            } AS source_company_name,
            a.position_name,
            a.application_date,
            a.status,
            ${
              hasSourceAttribution
                ? "attr.applied_by_type"
                : "NULL"
            } AS applied_by_type,
            ${
              hasSourceAttribution
                ? "attr.applied_by_label"
                : "NULL"
            } AS applied_by_label
          FROM applications a
          ${
            hasSourceCompanies
              ? "LEFT JOIN companies c ON c.id = a.company_id"
              : ""
          }
          ${
            hasSourceAttribution
              ? "LEFT JOIN application_attribution attr ON attr.application_id = a.id"
              : ""
          }
          ORDER BY a.application_date ASC, a.id ASC;
        `
      );

      const sourceToTargetApplicationId = new Map();

      await db.exec("BEGIN TRANSACTION;");
      try {
        for (const item of sourceApplications) {
          const sourceCompanyName = String(item?.source_company_name || "").trim();
          const targetCompanyId = await resolveCompanyIdByName(sourceCompanyName);
          if (!targetCompanyId) {
            summary.applications_skipped_missing_company += 1;
            continue;
          }

          const positionName = String(item?.position_name || "").trim() || "Untitled Position";
          const applicationDate = parseNonNegativeInteger(item?.application_date) || nowEpochSeconds();
          const status = normalizeApplicationStatus(item?.status);

          const existing = await db.get(
            `
              SELECT id
              FROM applications
              WHERE company_id = ?
                AND LOWER(position_name) = LOWER(?)
                AND application_date = ?
                AND LOWER(COALESCE(status, '')) = LOWER(?)
              LIMIT 1;
            `,
            [targetCompanyId, positionName, applicationDate, status]
          );

          let targetApplicationId = Number(existing?.id || 0);
          if (!targetApplicationId) {
            const inserted = await db.run(
              `
                INSERT INTO applications (
                  company_id,
                  position_name,
                  application_date,
                  status
                ) VALUES (?, ?, ?, ?);
              `,
              [targetCompanyId, positionName, applicationDate, status]
            );
            targetApplicationId = Number(inserted?.lastID || 0);
            summary.applications_inserted += 1;
          } else {
            summary.applications_reused += 1;
          }

          if (targetApplicationId) {
            sourceToTargetApplicationId.set(Number(item?.source_application_id || 0), targetApplicationId);
            const appliedByType = normalizeAppliedByType(item?.applied_by_type);
            const appliedByLabel = normalizeAppliedByLabel(item?.applied_by_label, appliedByType);
            await db.run(
              `
                INSERT INTO application_attribution (
                  application_id,
                  applied_by_type,
                  applied_by_label,
                  updated_at
                ) VALUES (?, ?, ?, datetime('now'))
                ON CONFLICT(application_id) DO UPDATE SET
                  applied_by_type = excluded.applied_by_type,
                  applied_by_label = excluded.applied_by_label,
                  updated_at = datetime('now');
              `,
              [targetApplicationId, appliedByType, appliedByLabel]
            );
            summary.application_attribution_upserts += 1;
          }
        }

        if (await tableExists(sourceDb, "posting_application_state")) {
          const sourcePostingStateRows = await sourceDb.all(
            `
              SELECT
                job_posting_url,
                applied,
                applied_by_type,
                applied_by_label,
                applied_at_epoch,
                last_application_id,
                ignored,
                ignored_at_epoch,
                ignored_by_label
              FROM posting_application_state;
            `
          );
          for (const row of sourcePostingStateRows) {
            const jobPostingUrl = String(row?.job_posting_url || "").trim();
            if (!jobPostingUrl) continue;

            const appliedByType = normalizeAppliedByType(row?.applied_by_type);
            const appliedByLabel = normalizeAppliedByLabel(row?.applied_by_label, appliedByType);
            const ignoredByLabel = normalizeIgnoredByLabel(row?.ignored_by_label);
            const sourceLastApplicationId = parseNonNegativeInteger(row?.last_application_id);
            const mappedLastApplicationId = sourceToTargetApplicationId.get(sourceLastApplicationId) || null;

            await db.run(
              `
                INSERT INTO posting_application_state (
                  job_posting_url,
                  applied,
                  applied_by_type,
                  applied_by_label,
                  applied_at_epoch,
                  last_application_id,
                  ignored,
                  ignored_at_epoch,
                  ignored_by_label,
                  updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
                ON CONFLICT(job_posting_url) DO UPDATE SET
                  applied = excluded.applied,
                  applied_by_type = excluded.applied_by_type,
                  applied_by_label = excluded.applied_by_label,
                  applied_at_epoch = excluded.applied_at_epoch,
                  last_application_id = excluded.last_application_id,
                  ignored = excluded.ignored,
                  ignored_at_epoch = excluded.ignored_at_epoch,
                  ignored_by_label = excluded.ignored_by_label,
                  updated_at = datetime('now');
              `,
              [
                jobPostingUrl,
                normalizeBoolean(row?.applied, false) ? 1 : 0,
                appliedByType,
                appliedByLabel,
                parseNonNegativeInteger(row?.applied_at_epoch) || null,
                mappedLastApplicationId,
                normalizeBoolean(row?.ignored, false) ? 1 : 0,
                parseNonNegativeInteger(row?.ignored_at_epoch) || null,
                ignoredByLabel
              ]
            );
            summary.posting_application_state_upserts += 1;
          }
        }

        await db.exec("COMMIT;");
      } catch (error) {
        await db.exec("ROLLBACK;");
        throw error;
      }
    }
  } finally {
    if (sourceDb) {
      await sourceDb.close();
    }
  }

  return summary;
}

async function upsertPersonalInformation(value) {
  const normalized = normalizePersonalInformationInput(value);
  const values = PERSONAL_INFORMATION_FIELDS.map((field) => normalized[field]);
  const updateAssignments = PERSONAL_INFORMATION_FIELDS.map((field) => `${field} = ?`).join(", ");
  const existing = await db.get(
    `
      SELECT rowid
      FROM PersonalInformation
      ORDER BY rowid ASC
      LIMIT 1;
    `
  );

  await db.exec("BEGIN TRANSACTION;");
  try {
    if (existing?.rowid) {
      await db.run(
        `
          UPDATE PersonalInformation
          SET ${updateAssignments}
          WHERE rowid = ?;
        `,
        [...values, existing.rowid]
      );

      await db.run(`DELETE FROM PersonalInformation WHERE rowid <> ?;`, [existing.rowid]);
    } else {
      await db.run(
        `
          INSERT INTO PersonalInformation (${PERSONAL_INFORMATION_FIELDS.join(", ")})
          VALUES (${PERSONAL_INFORMATION_FIELDS.map(() => "?").join(", ")});
        `,
        values
      );
    }

    await db.exec("COMMIT;");
  } catch (error) {
    await db.exec("ROLLBACK;");
    throw error;
  }

  return normalized;
}

async function getSyncScopeStats() {
  const rows = await db.all(
    `
      SELECT ATS_name
      FROM companies
      WHERE NOT EXISTS (
        SELECT 1
        FROM blocked_companies b
        WHERE b.normalized_company_name = LOWER(TRIM(companies.company_name))
      );
    `
  );

  const enabledAts = new Set(normalizeSyncEnabledAts(Array.from(syncEnabledAts)));
  let syncEnabledCompanyCount = 0;
  for (const row of rows) {
    const normalizedAts = normalizeAtsFilterValue(row?.ATS_name);
    if (!ATS_FILTER_OPTIONS.has(normalizedAts)) continue;
    if (enabledAts.has(normalizedAts)) {
      syncEnabledCompanyCount += 1;
    }
  }
  if (enabledAts.has("governmentjobs")) {
    syncEnabledCompanyCount += GOVERNMENTJOBS_ESTIMATED_COMPANY_COUNT;
  }
  if (enabledAts.has("smartrecruiters")) {
    syncEnabledCompanyCount += SMARTRECRUITERS_ESTIMATED_COMPANY_COUNT;
  }
  if (enabledAts.has("policeapp")) {
    syncEnabledCompanyCount += POLICEAPP_ESTIMATED_COMPANY_COUNT;
  }
  if (enabledAts.has("usajobs")) {
    syncEnabledCompanyCount += USAJOBS_ESTIMATED_COMPANY_COUNT;
  }
  if (enabledAts.has("k12jobspot")) {
    syncEnabledCompanyCount += K12JOBSPOT_ESTIMATED_COMPANY_COUNT;
  }
  if (enabledAts.has("schoolspring")) {
    syncEnabledCompanyCount += SCHOOLSPRING_ESTIMATED_COMPANY_COUNT;
  }
  if (enabledAts.has("calcareers")) {
    syncEnabledCompanyCount += CALCAREERS_ESTIMATED_COMPANY_COUNT;
  }
  if (enabledAts.has("calopps")) {
    syncEnabledCompanyCount += CALOPPS_ESTIMATED_COMPANY_COUNT;
  }
  if (enabledAts.has("statejobsny")) {
    syncEnabledCompanyCount += STATEJOBSNY_ESTIMATED_COMPANY_COUNT;
  }

  return {
    sync_enabled_company_count: syncEnabledCompanyCount,
    configured_enabled_ats_count: enabledAts.size,
    excluded_ats_count: Math.max(0, ATS_FILTER_OPTION_ITEMS.length - enabledAts.size)
  };
}

async function getCompaniesForSync() {
  const rows = await db.all(
    `
      SELECT id, company_name, url_string, ATS_name
      FROM companies
      WHERE NOT EXISTS (
        SELECT 1
        FROM blocked_companies b
        WHERE b.normalized_company_name = LOWER(TRIM(companies.company_name))
      );
    `
  );

  const enabledAts = new Set(normalizeSyncEnabledAts(Array.from(syncEnabledAts)));
  return rows
    .filter((row) => enabledAts.has(normalizeAtsFilterValue(row?.ATS_name)))
    .sort((a, b) => {
      const aAts = String(a?.ATS_name || "");
      const bAts = String(b?.ATS_name || "");
      const atsCompare = aAts.localeCompare(bAts);
      if (atsCompare !== 0) return atsCompare;
      return String(a?.company_name || "").localeCompare(String(b?.company_name || ""));
    });
}

async function upsertPostings(postings, lastSeenEpoch) {
  if (!Array.isArray(postings) || postings.length === 0) return;
  const seenEpoch = Number(lastSeenEpoch || nowEpochSeconds());

  await db.exec("BEGIN TRANSACTION;");
  try {
    for (const posting of postings) {
      const companyName = String(posting.company_name || "").trim();
      const positionName = String(posting.position_name || "").trim();
      const jobPostingUrl = String(posting.job_posting_url || "").trim();
      if (!companyName || !positionName || !jobPostingUrl) continue;
      const location = String(posting.location || "").trim() || null;
      const postingDateRaw = String(posting.posting_date ?? "").trim();
      const postingDate = postingDateRaw || null;
      const atsKey = String(posting.ats_key || posting.ATS_name || inferAtsFromJobPostingUrl(jobPostingUrl)).trim();
      const sourceJobId = String(
        posting.source_job_id ||
          extractSourceIdFromPostingUrl(jobPostingUrl, atsKey) ||
          ""
      ).trim();
      const parserVersion = String(posting.parser_version || "legacy-adapter-v1").trim();
      const confidence = Number(posting.confidence || posting.parser_confidence || 0.5);
      const quality = buildStoredQualityFields(
        {
          ...posting,
          company_name: companyName,
          position_name: positionName,
          job_posting_url: jobPostingUrl,
          canonical_url: jobPostingUrl,
          source_job_id: sourceJobId,
          ats_key: atsKey,
          location,
          posting_date: postingDate,
          parser_version: parserVersion,
          confidence,
          last_seen_epoch: seenEpoch
        },
        { nowEpoch: seenEpoch }
      );

      await db.run(
        `
          INSERT INTO Postings (
            company_name,
            position_name,
            job_posting_url,
            location,
            posting_date,
            first_seen_epoch,
            source_job_id,
            parser_version,
            confidence,
            quality_score,
            quality_flags,
            rejection_reason,
            hidden,
            hidden_at_epoch,
            last_seen_epoch
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?)
          ON CONFLICT(job_posting_url) DO UPDATE SET
            company_name = excluded.company_name,
            position_name = excluded.position_name,
            location = COALESCE(excluded.location, Postings.location),
            posting_date = COALESCE(excluded.posting_date, Postings.posting_date),
            first_seen_epoch = COALESCE(Postings.first_seen_epoch, Postings.last_seen_epoch, excluded.first_seen_epoch),
            source_job_id = COALESCE(NULLIF(excluded.source_job_id, ''), Postings.source_job_id),
            parser_version = excluded.parser_version,
            confidence = excluded.confidence,
            quality_score = excluded.quality_score,
            quality_flags = excluded.quality_flags,
            rejection_reason = excluded.rejection_reason,
            last_seen_epoch = excluded.last_seen_epoch
          WHERE COALESCE(Postings.hidden, 0) = 0;
        `,
        [
          companyName,
          positionName,
          jobPostingUrl,
          location,
          postingDate,
          seenEpoch,
          sourceJobId,
          parserVersion,
          Number.isFinite(confidence) ? confidence : 0.5,
          quality.quality_score,
          quality.quality_flags,
          quality.rejection_reason,
          seenEpoch
        ]
      );
    }
    await db.exec("COMMIT;");
  } catch (error) {
    try {
      await db.exec("ROLLBACK;");
    } catch {
      // A failed BEGIN leaves no open transaction to roll back.
    }
    throw error;
  }
}

async function pruneExpiredPostings(referenceEpoch = nowEpochSeconds()) {
  const resolvedReferenceEpoch = Number(referenceEpoch || nowEpochSeconds());
  const cutoffEpoch = resolvedReferenceEpoch - POSTING_TTL_SECONDS;
  const result = await db.run(
    `
      UPDATE Postings
      SET
        hidden = 1,
        hidden_at_epoch = COALESCE(hidden_at_epoch, ?)
      WHERE COALESCE(hidden, 0) = 0
        AND COALESCE(last_seen_epoch, first_seen_epoch, 0) < ?;
    `,
    [resolvedReferenceEpoch, cutoffEpoch]
  );
  return Number(result?.changes || 0);
}

async function prunePostingsOutsideDateWindow(referenceEpoch = nowEpochSeconds()) {
  const rows = await db.all(
    `
      SELECT id, posting_date
      FROM Postings
      WHERE COALESCE(hidden, 0) = 0
        AND posting_date IS NOT NULL
        AND TRIM(posting_date) <> '';
    `
  );
  if (!Array.isArray(rows) || rows.length === 0) return 0;

  const idsToHide = [];
  for (const row of rows) {
    const postingId = Number(row?.id || 0);
    if (!Number.isFinite(postingId) || postingId <= 0) continue;
    if (shouldStorePostingByDate(row?.posting_date, referenceEpoch)) continue;
    idsToHide.push(postingId);
  }

  if (idsToHide.length === 0) return 0;

  let totalHidden = 0;
  await db.exec("BEGIN TRANSACTION;");
  try {
    const chunkSize = 800;
    for (let offset = 0; offset < idsToHide.length; offset += chunkSize) {
      const chunk = idsToHide.slice(offset, offset + chunkSize);
      if (chunk.length === 0) continue;
      const placeholders = chunk.map(() => "?").join(", ");
      const result = await db.run(
        `
          UPDATE Postings
          SET
            hidden = 1,
            hidden_at_epoch = COALESCE(hidden_at_epoch, ?)
          WHERE COALESCE(hidden, 0) = 0
            AND id IN (${placeholders});
        `,
        [Number(referenceEpoch || nowEpochSeconds()), ...chunk]
      );
      totalHidden += Number(result?.changes || 0);
    }

    await db.exec("COMMIT;");
  } catch (error) {
    await db.exec("ROLLBACK;");
    throw error;
  }

  return totalHidden;
}

async function runWorkdaySyncInternal() {
  const syncReferenceEpoch = nowEpochSeconds();
  syncStatus.running = true;
  syncStatus.started_at = new Date().toISOString();
  syncStatus.progress = { current: 0, total: 0, company_name: "", total_collected: 0 };
  syncStatus.last_error = null;

  try {
    const companies = await getCompaniesForSync();
    const enabledAts = new Set(normalizeSyncEnabledAts(Array.from(syncEnabledAts)));
    const shuffledCompanies = shuffleArrayInPlace([...companies]);
    const syncTargets = [];
    let smartRecruitersInserted = false;
    let companyInsertionsSinceSmartRecruiters = 0;
    for (const company of shuffledCompanies) {
      syncTargets.push(company);
      companyInsertionsSinceSmartRecruiters += 1;

      if (
        enabledAts.has("smartrecruiters") &&
        companyInsertionsSinceSmartRecruiters >= SMARTRECRUITERS_INSERT_EVERY_N_TARGETS
      ) {
        syncTargets.push({
          id: null,
          company_name: "SmartRecruiters (dynamic)",
          url_string: "https://jobs.smartrecruiters.com/sr-jobs/search",
          ATS_name: "smartrecruiters"
        });
        smartRecruitersInserted = true;
        companyInsertionsSinceSmartRecruiters = 0;
      }
    }

    if (enabledAts.has("smartrecruiters") && companyInsertionsSinceSmartRecruiters > 0) {
      syncTargets.push({
        id: null,
        company_name: "SmartRecruiters (dynamic)",
        url_string: "https://jobs.smartrecruiters.com/sr-jobs/search",
        ATS_name: "smartrecruiters"
      });
      smartRecruitersInserted = true;
    }

    if (enabledAts.has("smartrecruiters") && !smartRecruitersInserted) {
      syncTargets.push({
        id: null,
        company_name: "SmartRecruiters (dynamic)",
        url_string: "https://jobs.smartrecruiters.com/sr-jobs/search",
        ATS_name: "smartrecruiters"
      });
    }

    if (enabledAts.has("governmentjobs")) {
      syncTargets.push({
        id: null,
        company_name: "GovernmentJobs (dynamic)",
        url_string: "https://www.governmentjobs.com/jobs",
        ATS_name: "governmentjobs"
      });
    }
    if (enabledAts.has("policeapp")) {
      syncTargets.push({
        id: null,
        company_name: "PoliceApp (dynamic)",
        url_string:
          "https://www.policeapp.com/jobs/urlrewrite_jobpostings/jobResultsAjax.ashx?j=0&r=50&s=0&p=0",
        ATS_name: "policeapp"
      });
    }
    if (enabledAts.has("usajobs")) {
      syncTargets.push({
        id: null,
        company_name: "USAJobs (dynamic)",
        url_string: USAJOBS_SEARCH_API_URL,
        ATS_name: "usajobs"
      });
    }
    if (enabledAts.has("k12jobspot")) {
      syncTargets.push({
        id: null,
        company_name: "K12JobSpot (dynamic)",
        url_string: "https://api.k12jobspot.com/api/Jobs/Search",
        ATS_name: "k12jobspot"
      });
    }
    if (enabledAts.has("schoolspring")) {
      syncTargets.push({
        id: null,
        company_name: "SchoolSpring (dynamic)",
        url_string:
          "https://api.schoolspring.com/api/Jobs/GetPagedJobsWithSearch?domainName=&keyword=&location=&category=&gradelevel=&jobtype=&organization=&swLat=&swLon=&neLat=&neLon=&page=1&size=25&sortDateAscending=false",
        ATS_name: "schoolspring"
      });
    }
    if (enabledAts.has("calcareers")) {
      syncTargets.push({
        id: null,
        company_name: "CalCareers (dynamic)",
        url_string: "https://calcareers.ca.gov/CalHRPublic/Search/JobSearchResults.aspx",
        ATS_name: "calcareers"
      });
    }
    if (enabledAts.has("calopps")) {
      syncTargets.push({
        id: null,
        company_name: "CalOpps (dynamic)",
        url_string: "https://www.calopps.org/job-search-list",
        ATS_name: "calopps"
      });
    }
    if (enabledAts.has("statejobsny")) {
      syncTargets.push({
        id: null,
        company_name: "StateJobsNY (dynamic)",
        url_string: "https://www.statejobsny.com/public/vacancyTable.cfm",
        ATS_name: "statejobsny"
      });
    }

    syncStatus.progress.total = syncTargets.length;
    let totalPruned = await pruneExpiredPostings(syncReferenceEpoch);
    let postingDatePruned = await prunePostingsOutsideDateWindow(syncReferenceEpoch);
    const nextPostingLocationByJobUrl = new Map();

    const dedupedPostings = new Map();
    const pendingPostingsForUpsert = [];
    const errors = [];
    let excludedByPostingDate = 0;
    let nextCompanyIndex = 0;
    let completedCompanies = 0;
    const workerCount = Math.min(SYNC_WORKER_CONCURRENCY, Math.max(1, syncTargets.length));
    let flushPromise = Promise.resolve();

    const flushPendingPostings = async (force = false) => {
      if (!Array.isArray(pendingPostingsForUpsert) || pendingPostingsForUpsert.length === 0) return;
      if (!force && pendingPostingsForUpsert.length < SYNC_POSTING_FLUSH_BATCH_SIZE) return;

      const batch = pendingPostingsForUpsert.splice(0, pendingPostingsForUpsert.length);
      if (batch.length === 0) return;
      await upsertPostings(batch, syncReferenceEpoch);
    };

    const queueFlushPendingPostings = (force = false) => {
      flushPromise = flushPromise.then(() => flushPendingPostings(force));
      return flushPromise;
    };

    const runSyncWorker = async () => {
      while (true) {
        const currentIndex = nextCompanyIndex;
        if (currentIndex >= syncTargets.length) return;
        nextCompanyIndex += 1;

        const company = syncTargets[currentIndex];
        try {
          const companyAts = normalizeAtsFilterValue(company?.ATS_name);
          const currentlyEnabledAts = new Set(normalizeSyncEnabledAts(Array.from(syncEnabledAts)));
          if (!currentlyEnabledAts.has(companyAts)) {
            continue;
          }

          const postings = await collectPostingsForCompany(company);
          for (const posting of postings) {
            if (!shouldStorePostingByDate(posting?.posting_date, syncReferenceEpoch)) {
              excludedByPostingDate += 1;
              continue;
            }
            if (dedupedPostings.has(posting.job_posting_url)) continue;
            dedupedPostings.set(posting.job_posting_url, posting);
            pendingPostingsForUpsert.push(posting);
            const location = String(posting?.location || "").trim();
            if (location) {
              nextPostingLocationByJobUrl.set(posting.job_posting_url, location);
              postingLocationByJobUrl.set(posting.job_posting_url, location);
              postingLocationVersion += 1;
            }
          }
        } catch (error) {
          errors.push({
            company_name: company.company_name,
            message: String(error?.message || error)
          });
        } finally {
          if (pendingPostingsForUpsert.length >= SYNC_POSTING_FLUSH_BATCH_SIZE) {
            await queueFlushPendingPostings(false);
          }
          completedCompanies += 1;
          syncStatus.progress = {
            current: completedCompanies,
            total: syncTargets.length,
            company_name: `${company.company_name} (${company.ATS_name})`,
            total_collected: dedupedPostings.size
          };
        }
      }
    };

    if (syncTargets.length > 0) {
      await Promise.all(Array.from({ length: workerCount }, () => runSyncWorker()));
    }

    await queueFlushPendingPostings(true);

    totalPruned += await pruneExpiredPostings(syncReferenceEpoch);
    postingDatePruned += await prunePostingsOutsideDateWindow(syncReferenceEpoch);
    postingLocationByJobUrl = nextPostingLocationByJobUrl;
    postingLocationVersion += 1;
    const syncScopeStats = await getSyncScopeStats();

    syncStatus.last_sync_at = new Date().toISOString();
    syncStatus.last_sync_summary = {
      total_companies: syncTargets.length,
      ...syncScopeStats,
      total_postings_stored: dedupedPostings.size,
      worker_concurrency: workerCount,
      ats_request_queue_concurrency: atsRequestQueueConcurrency,
      failed_companies: errors.length,
      expired_pruned: totalPruned,
      posting_date_pruned: postingDatePruned,
      excluded_during_sync_by_posting_date: excludedByPostingDate,
      errors: errors.slice(0, 30)
    };
  } catch (error) {
    syncStatus.last_error = String(error?.message || error);
  } finally {
    syncStatus.running = false;
    syncStatus.progress = null;
  }
}

function runWorkdaySync() {
  if (syncPromise) return syncPromise;
  syncPromise = runWorkdaySyncInternal().finally(() => {
    syncPromise = null;
  });
  return syncPromise;
}

function getDb() {
  if (!db) {
    throw new Error("Database is not initialized");
  }
  return db;
}

async function getCounts() {
  const companyRow = await db.get(`SELECT COUNT(*) AS count FROM companies;`);
  const postingRow = await db.get(
    `
      SELECT COUNT(*) AS count
      FROM Postings
      WHERE COALESCE(hidden, 0) = 0;
    `
  );
  const seen24hRow = await db.get(
    `
      SELECT COUNT(*) AS count
      FROM Postings
      WHERE COALESCE(hidden, 0) = 0
        AND COALESCE(last_seen_epoch, 0) >= ?;
    `,
    [nowEpochSeconds() - 24 * 60 * 60]
  );
  const byAtsRows = await db.all(`
    SELECT ATS_name, COUNT(*) AS count
    FROM companies
    GROUP BY ATS_name;
  `);

  const companyCountByAts = {};
  for (const row of byAtsRows) {
    const key = String(row?.ATS_name || "").trim() || "Unknown";
    companyCountByAts[key] = Number(row?.count || 0);
  }

  return {
    company_count: Number(companyRow?.count || 0),
    posting_count: Number(postingRow?.count || 0),
    postings_seen_24h_count: Number(seen24hRow?.count || 0),
    company_count_by_ats: companyCountByAts
  };
}

async function getIngestionWorkerStatus() {
  const latestRun = await db.get(
    `
      SELECT
        id,
        started_at_epoch,
        finished_at_epoch,
        status,
        total_targets,
        success_count,
        failure_count,
        cache_hit_count,
        cache_write_count,
        posting_upsert_count,
        rejected_count,
        duplicate_count,
        db_busy_count,
        current_ats,
        current_company_url,
        current_company_name,
        http_status_counts,
        active_ats,
        last_error
      FROM ingestion_runs
      ORDER BY id DESC
      LIMIT 1;
    `
  );
  const dueRow = await db.get(
    `
      SELECT COUNT(*) AS count
      FROM company_sync_state
      WHERE next_sync_epoch <= ?;
    `,
    [nowEpochSeconds()]
  );
  const parserErrorRow = await db.get(
    `
      SELECT COUNT(*) AS count
      FROM ingestion_run_errors
      WHERE created_at >= datetime('now', '-24 hours')
        AND error_type LIKE 'parser_%';
    `
  );

  let activeAts = [];
  try {
    activeAts = JSON.parse(String(latestRun?.active_ats || "[]"));
  } catch {
    activeAts = [];
  }

  return {
    latest_run_id: Number(latestRun?.id || 0),
    latest_status: String(latestRun?.status || ""),
    started_at_epoch: Number(latestRun?.started_at_epoch || 0),
    finished_at_epoch: Number(latestRun?.finished_at_epoch || 0),
    last_run_duration_seconds:
      latestRun?.finished_at_epoch && latestRun?.started_at_epoch
        ? Math.max(0, Number(latestRun.finished_at_epoch) - Number(latestRun.started_at_epoch))
        : 0,
    total_targets: Number(latestRun?.total_targets || 0),
    success_count: Number(latestRun?.success_count || 0),
    failure_count: Number(latestRun?.failure_count || 0),
    cache_hit_count: Number(latestRun?.cache_hit_count || 0),
    cache_write_count: Number(latestRun?.cache_write_count || 0),
    posting_upsert_count: Number(latestRun?.posting_upsert_count || 0),
    rejected_count: Number(latestRun?.rejected_count || 0),
    duplicate_count: Number(latestRun?.duplicate_count || 0),
    db_busy_count: Number(latestRun?.db_busy_count || 0),
    queue_due_count: Number(dueRow?.count || 0),
    parser_error_count_24h: Number(parserErrorRow?.count || 0),
    current_ats: String(latestRun?.current_ats || ""),
    current_company_url: String(latestRun?.current_company_url || ""),
    current_company_name: String(latestRun?.current_company_name || ""),
    http_status_counts: parseJsonObject(latestRun?.http_status_counts),
    active_ats: Array.isArray(activeAts) ? activeAts : [],
    last_error: String(latestRun?.last_error || "")
  };
}

async function getParserAttentionByAts(limit = 20) {
  const rows = await db.all(
    `
      SELECT
        ats_key,
        COUNT(*) AS error_count,
        MAX(created_at) AS latest_error_at,
        (
          SELECT e2.error_message
          FROM ingestion_run_errors e2
          WHERE e2.ats_key = ingestion_run_errors.ats_key
            AND e2.error_type LIKE 'parser_%'
          ORDER BY e2.id DESC
          LIMIT 1
        ) AS latest_error
      FROM ingestion_run_errors
      WHERE created_at >= datetime('now', '-24 hours')
        AND error_type LIKE 'parser_%'
      GROUP BY ats_key
      ORDER BY error_count DESC, latest_error_at DESC
      LIMIT ?;
    `,
    [Math.max(1, Math.min(100, Number(limit || 20)))]
  );

  return rows.map((row) => ({
    ats_key: String(row?.ats_key || ""),
    error_count: Number(row?.error_count || 0),
    latest_error_at: String(row?.latest_error_at || ""),
    latest_error: String(row?.latest_error || "")
  }));
}

function getWritePressure(ingestionWorker = {}) {
  if (syncStatus.running || String(ingestionWorker?.latest_status || "").toLowerCase() === "running") {
    return "active";
  }
  if (Number(ingestionWorker?.queue_due_count || 0) > 0) {
    return "due";
  }
  return "idle";
}

function buildPublicIngestionStatusItem(ingestionWorker = {}, options = {}) {
  const item = {
    latest_run_id: Number(ingestionWorker?.latest_run_id || 0),
    latest_status: String(ingestionWorker?.latest_status || ""),
    started_at_epoch: Number(ingestionWorker?.started_at_epoch || 0),
    finished_at_epoch: Number(ingestionWorker?.finished_at_epoch || 0),
    last_run_duration_seconds: Number(ingestionWorker?.last_run_duration_seconds || 0),
    total_targets: Number(ingestionWorker?.total_targets || 0),
    success_count: Number(ingestionWorker?.success_count || 0),
    failure_count: Number(ingestionWorker?.failure_count || 0),
    queue_due_count: Number(ingestionWorker?.queue_due_count || 0),
    parser_error_count_24h: Number(ingestionWorker?.parser_error_count_24h || 0),
    db_backend: String(options.db_backend || DB_BACKEND),
    search_backend: String(options.search_backend || SEARCH_BACKEND),
    search_reindex: options.search_reindex || readMeiliReindexStatus(),
    queue_backend: String(options.queue_backend || QUEUE_BACKEND),
    write_pressure: String(options.write_pressure || getWritePressure(ingestionWorker)),
    parser_attention_count: Number(options.parser_attention_count || 0)
  };
  if (Object.prototype.hasOwnProperty.call(options, "growth_24h")) {
    item.growth_24h = options.growth_24h || createEmptyGrowthSummary({ hours: 24 });
  }
  if (options.include_worker_diagnostics) {
    item.auto_sync_budget_usage = ingestionWorker?.auto_sync_budget_usage || null;
    item.worker_health_24h = ingestionWorker?.worker_health_24h || null;
  }
  return item;
}

function normalizePublicSuggestionFilter(filter = {}) {
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
  const ats = normalizeAtsFilterValue(source.ats || source.source || "");
  if (ATS_FILTER_OPTIONS.has(ats)) {
    patch.ats = ats;
  }
  return Object.keys(patch).length > 0 ? patch : null;
}

function addSuggestion(suggestions, seen, type, value, count = 1, extras = {}) {
  const label = String(extras.label || value || "").trim();
  const suggestionValue = String(value || label || "").trim();
  const suggestionType = String(type || "search").trim().toLowerCase() || "search";
  if (!label || !suggestionValue) return;
  const intentType = String(extras.intent_type || "").trim().toLowerCase();
  const key = `${suggestionType}:${normalizeSearchText(suggestionValue)}:${intentType}`;
  if (seen.has(key)) return;
  seen.add(key);
  const suggestion = {
    type: suggestionType,
    value: suggestionValue,
    label,
    count: Number(count || 1)
  };
  const filter = normalizePublicSuggestionFilter(extras.filter);
  if (intentType) suggestion.intent_type = intentType;
  if (filter) suggestion.filter = filter;
  suggestions.push(suggestion);
}

function normalizedSuggestionContainsTerm(text, term) {
  const normalizedText = normalizeSearchText(text);
  const normalizedTerm = normalizeSearchText(term);
  if (!normalizedText || !normalizedTerm) return false;
  const escaped = normalizedTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (new RegExp(`(^|\\s)${escaped}(\\s|$)`).test(normalizedText)) return true;
  return normalizedTerm.length >= 4 && normalizedText.includes(normalizedTerm);
}

function addSearchIntentSuggestions(suggestions, seen, search, atsItems = ATS_FILTER_OPTION_ITEMS) {
  const query = normalizeSearchText(search);
  if (query.length < 2) return;
  if (normalizedSuggestionContainsTerm(query, "remote") || normalizedSuggestionContainsTerm(query, "wfh") || query.includes("work from home")) {
    addSuggestion(suggestions, seen, "intent", "remote", 1, {
      label: "Remote",
      intent_type: "remote",
      filter: { remote: "remote" }
    });
  }
  if (normalizedSuggestionContainsTerm(query, "hybrid")) {
    addSuggestion(suggestions, seen, "intent", "hybrid", 1, {
      label: "Hybrid",
      intent_type: "hybrid",
      filter: { remote: "hybrid" }
    });
  }
  if (normalizedSuggestionContainsTerm(query, "onsite") || query.includes("on site") || query.includes("in office")) {
    addSuggestion(suggestions, seen, "intent", "onsite", 1, {
      label: "On-site",
      intent_type: "onsite",
      filter: { remote: "non_remote" }
    });
  }
  if (/(^|\s)(last|past|within)\s+3\s+(days?|d)(\s|$)/.test(query) || /(^|\s)3\s+(days?|d)(\s|$)/.test(query) || /(^|\s)3d(\s|$)/.test(query)) {
    addSuggestion(suggestions, seen, "intent", "3", 1, {
      label: "Last 3 days",
      intent_type: "freshness",
      filter: { freshness_days: 3 }
    });
  }
  for (const item of atsItems || []) {
    const value = normalizeAtsFilterValue(item?.value || item?.label || "");
    const label = String(item?.label || item?.value || "").trim();
    if (!value || !label || !ATS_FILTER_OPTIONS.has(value)) continue;
    if (normalizedSuggestionContainsTerm(query, value) || normalizedSuggestionContainsTerm(query, label)) {
      addSuggestion(suggestions, seen, "source", value, Number(item?.count || 1), {
        label,
        intent_type: "source",
        filter: { ats: value }
      });
    }
  }
}

async function getSearchSuggestions(search, limit = 8) {
  const query = String(search || "").trim();
  const resolvedLimit = Math.max(1, Math.min(20, Number(limit || 8)));
  const suggestions = [];
  const seen = new Set();

  addSearchIntentSuggestions(suggestions, seen, query, ATS_FILTER_OPTION_ITEMS);

  for (const alias of ["remote jobs", "turkish jobs", "t\u00fcrkiye", "turkiye", "turkey"]) {
    if (!query || normalizeSearchText(alias).includes(normalizeSearchText(query))) {
      addSuggestion(suggestions, seen, "shortcut", alias);
    }
  }

  if (query) {
    const like = `%${query.replace(/[%_]/g, "")}%`;
    const rows = await db.all(
      `
        SELECT 'title' AS type, position_name AS value, COUNT(*) AS count
        FROM Postings
        WHERE COALESCE(hidden, 0) = 0
          AND position_name LIKE ?
        GROUP BY position_name
        UNION ALL
        SELECT 'company' AS type, company_name AS value, COUNT(*) AS count
        FROM Postings
        WHERE COALESCE(hidden, 0) = 0
          AND company_name LIKE ?
        GROUP BY company_name
        UNION ALL
        SELECT 'location' AS type, location AS value, COUNT(*) AS count
        FROM Postings
        WHERE COALESCE(hidden, 0) = 0
          AND location IS NOT NULL
          AND TRIM(location) <> ''
          AND location LIKE ?
        GROUP BY location
        ORDER BY count DESC
        LIMIT ?;
      `,
      [like, like, like, resolvedLimit * 3]
    );

    for (const row of rows) {
      addSuggestion(suggestions, seen, row?.type, row?.value, row?.count);
      if (suggestions.length >= resolvedLimit) break;
    }
  }

  return suggestions.slice(0, resolvedLimit);
}

function createServer() {
  const app = express();
  const allowedOrigins = getAllowedOrigins();
  const publicLimiter = createRateLimiter({
    windowMs: RATE_LIMIT_WINDOW_MS,
    max: PUBLIC_RATE_LIMIT_MAX,
    name: "public"
  });
  const controlLimiter = createRateLimiter({
    windowMs: RATE_LIMIT_WINDOW_MS,
    max: CONTROL_RATE_LIMIT_MAX,
    name: "control"
  });
  const frontendLogLimiter = createRateLimiter({
    windowMs: RATE_LIMIT_WINDOW_MS,
    max: FRONTEND_LOG_RATE_LIMIT_MAX,
    name: "frontend-log"
  });
  const publicReadCache = createTtlJsonCache({
    ttlMs: PUBLIC_READ_CACHE_TTL_MS,
    maxEntries: PUBLIC_READ_CACHE_MAX_ENTRIES
  });

  app.disable("x-powered-by");
  if (TRUST_PROXY) app.set("trust proxy", 1);
  app.use(securityHeadersMiddleware);
  app.use(cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      const normalized = normalizeOrigin(origin);
      if (allowedOrigins.has(normalized) || isLocalDevelopmentOrigin(origin)) return callback(null, true);
      const error = new Error("CORS origin is not allowed");
      error.statusCode = 403;
      return callback(error);
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-OpenJobSlots-Admin-Token"],
    maxAge: 600
  }));
  app.use(express.json({ limit: API_JSON_LIMIT }));
  app.use("/frontend/log", frontendLogLimiter);
  app.use((req, res, next) => (isControlRoute(req) ? controlLimiter(req, res, next) : publicLimiter(req, res, next)));
  app.use(adminGateMiddleware);

  const webDistPath = path.resolve(__dirname, "..", "dist");
  const webIndexPath = path.join(webDistPath, "index.html");
  const routeContext = {
    APPLICATION_STATUS_OPTIONS,
    ATS_FILTER_OPTION_ITEMS,
    DB_BACKEND,
    DB_PATH,
    MCP_SETTINGS_DEFAULTS,
    PORT,
    QUEUE_BACKEND,
    SEARCH_BACKEND,
    STATE_CODE_TO_NAME,
    appendFrontendLogEntry,
    blockCompanyByName,
    buildCoverLetterDraft,
    buildMcpRunbook,
    buildPublicIngestionStatusItem,
    buildPublicPreferences,
    buildRobotsTxt,
    buildSitemapXml,
    createApplication,
    createEmptyGrowthSummary,
    db,
    deleteApplicationById,
    ensureMcpAgentEnabled,
    express,
    fs,
    getAdapterMetadata,
    getCounts,
    getIngestionWorkerStatus,
    getMcpSettings,
    getMeiliSettingsStatus,
    getParserAttentionByAts,
    getPersonalInformation,
    getPostgresAtsAdmin,
    getPostgresAtsFieldQualityByAts,
    getPostgresCounts,
    getPostgresFilterOptions,
    getPostgresGrowthSummary,
    getPostgresParserAdmin,
    getPostgresParserAttentionByAts,
    getPostgresParserStats,
    getPostgresPostingDiagnostics,
    getPostgresPublicSearchReport,
    getPostgresQualitySummary,
    getPostgresQuarantineSummary,
    getPostgresSourceQualityDashboard,
    getPostgresSuggestions,
    getPostgresSyncStatus,
    getPostingLocationGeoFilterOptions,
    getPublicPostingSortOptions,
    getSearchSuggestions,
    getSqliteParserStats,
    getSqlitePostingDiagnostics,
    getSqliteQualitySummary,
    getSyncPromise: () => syncPromise,
    getSyncScopeStats,
    getSyncServiceSettings,
    getWritePressure,
    hasAdminAccess,
    listApplications,
    listBlockedCompanies,
    listPostgresIngestionErrors,
    listPostgresIngestionRuns,
    listPostgresIngestionSources,
    listPostgresParserDriftEvents,
    listPostgresPostings,
    listPostgresRejections,
    listPostingsWithFilters,
    listSqliteRejections,
    migrateSettingsAndApplicationsFromDatabase,
    normalizeAtsFilterValue,
    normalizeBoolean,
    normalizeFreshnessDays,
    normalizeGrowthHours,
    normalizePostingSort,
    normalizeRemoteFilter,
    normalizeStringArray,
    normalizeSyncEnabledAts,
    nowEpochSeconds,
    parseCsvParam,
    parseJsonArray,
    parseJsonObject,
    parseNonNegativeInteger,
    path,
    postgresPool,
    publicReadCache,
    readMeiliReindexStatus,
    readSourceQualityThresholds,
    renderSeoIndexHtml,
    recordPostgresPublicSearchEvent,
    requestSyncStart,
    requestSyncStop,
    runWorkdaySync,
    sanitizeFrontendValue,
    sanitizePublicPostings,
    sanitizePublicSourceFacets,
    sendCachedPublicJson,
    setPostingIgnoredState,
    syncStatus,
    unblockCompanyByName,
    updateApplicationStatus,
    upsertMcpSettings,
    upsertPersonalInformation,
    upsertSyncServiceSettings,
    webDistPath,
    webIndexPath
  };

  registerAdminRoutes(app, routeContext);
  registerUserRoutes(app, routeContext);
  registerPublicRoutes(app, routeContext);

  app.use(genericErrorMiddleware);

  return app;
}

async function start() {
  await initDb();

  const app = createServer();
  app.listen(PORT, () => {
    console.log(`[openjobslots API] listening on http://localhost:${PORT}`);
    console.log(`[openjobslots API] using database ${DB_PATH}`);
    console.log(
      `[openjobslots API] ATS request queue concurrency (runtime): ${atsRequestQueueConcurrency} (saved changes apply after restart)`
    );
  });

  if (!DISABLE_API_SCHEDULER && DB_BACKEND !== "postgres") {
    runWorkdaySync().catch((error) => {
      console.error("[openjobslots API] initial sync failed:", error);
    });

    setInterval(() => {
      runWorkdaySync().catch((error) => {
        console.error("[openjobslots API] scheduled sync failed:", error);
      });
    }, SYNC_INTERVAL_MS);
  } else {
    console.log("[openjobslots API] internal sync scheduler disabled; ingestion worker handles sync");
  }
}

function isRetryableStartupError(error) {
  const code = String(error?.code || "").toUpperCase();
  const message = String(error?.message || error || "").toLowerCase();
  return (
    ["EAI_AGAIN", "ECONNREFUSED", "ENOTFOUND", "ETIMEDOUT", "ECONNRESET"].includes(code) ||
    /getaddrinfo|connect econnrefused|connection terminated|timeout|database system is starting up/.test(message)
  );
}

async function startWithBackoff() {
  let attempt = 0;
  while (true) {
    try {
      await start();
      return;
    } catch (error) {
      if (!isRetryableStartupError(error)) throw error;
      attempt += 1;
      const delayMs = Math.min(60000, 2000 * Math.pow(2, Math.min(attempt - 1, 5)));
      console.error(
        `[openjobslots API] startup dependency unavailable; retrying in ${delayMs}ms: ${error?.message || error}`
      );
      await sleep(delayMs);
    }
  }
}

module.exports = {
  ATS_FILTER_OPTION_ITEMS,
  ATS_FILTER_OPTIONS,
  DB_PATH,
  collectPostingsForCompany,
  createServer,
  getCompaniesForSync,
  getCounts,
  getDb,
  getIngestionWorkerStatus,
  inferAtsFromJobPostingUrl,
  getParserAttentionByAts,
  getSyncScopeStats,
  initDb,
  normalizeAtsFilterValue,
  normalizeSyncEnabledAts,
  nowEpochSeconds,
  buildApplitrackDetailUrl,
  extractAdpWorkforcenowCompanyName,
  extractApplitrackDetailFields,
  extractApplicantProDomainId,
  extractIcimsLocationFromHtml,
  extractIcimsPostingDateFromHtml,
  extractIcimsRemoteTypeFromHtml,
  extractSourceIdFromPostingUrl,
  extractTaleoPostingsFromRest,
  extractTaleoPostingsFromAjax,
  extractWorkdayLocationLabel,
  extractWorkdaySourceJobId,
  parseAdpWorkforcenowPostingsFromApi,
  parseAdpMyjobsPostingsFromApi,
  parseApplicantProPostingsFromApi,
  parseApplitrackPostings,
  parseApplyToJobPostingsFromHtml,
  parseAshbyPostingsFromApi,
  parseAshbyCompany,
  parseBambooHrPostingsFromApi,
  parseBrassringPostingsFromApi,
  parseBreezyPostingsFromHtml,
  parseCareerplugPostingsFromHtml,
  parseFountainPostingsFromApi,
  parseGreenhousePostingsFromApi,
  parseHrmDirectPostingsFromHtml,
  parseHirebridgePostingsFromHtml,
  parseIcimsPostingsFromHtml,
  parseJobvitePostingsFromHtml,
  parseLeverPostingsFromApi,
  parseManatalPostingsFromApi,
  parseManatalPostingsFromHtml,
  parseOraclePostingsFromApi,
  parsePageupPostingsFromResults,
  parsePaylocityPostingsFromPageData,
  parsePinpointHqPostingsFromApi,
  parseRecruitCrmPostingsFromApi,
  parseRecruiteePostingsFromPublicApp,
  parseSapHrCloudPostingsFromApi,
  parseSmartRecruitersPostingsFromApi,
  parseTalentreefPostingsFromSearchResponse,
  parseTeamtailorPostingsFromHtml,
  parseUltiProPostingsFromApi,
  parseUsajobsPostingsFromPayload,
  parseWorkdayPostingsFromApi,
  parseZohoPostingsFromHtml,
  resolveAdpWorkforcenowCompanyName,
  runWorkdaySync,
  upsertPostings
};

if (require.main === module) {
  startWithBackoff().catch((error) => {
    console.error("[openjobslots API] startup failed:", error);
    process.exit(1);
  });
}
