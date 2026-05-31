const cors = require("cors");
const express = require("express");
const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");
const { open } = require("sqlite");
const sqlite3 = require("sqlite3");
const { ensureIngestionTables, seedAtsSources } = require("./ingestion/schema");
const { getAdapterMetadata, isAtsEnabledByDefault } = require("./ingestion/adapter-metadata");
const { inferAtsFromJobPostingUrl } = require("./ingestion/atsUrlInference");
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
const { createSourceFetchRuntime } = require("./ingestion/sourceFetch");
const { createSourceCollectorRuntime } = require("./ingestion/sourceCollectors");
const { createSqliteAppStateRuntime } = require("./state/sqliteAppState");
const { createSqliteSchemaRuntime } = require("./state/sqliteSchema");
const {
  createPostgresPool,
  ensurePostgresSchema,
  seedPostgresAtsSources
} = require("./backends/postgres");
const {
  getPostgresAtsAdmin,
  getPostgresAtsFieldQualityByAts,
  getPostgresCounts,
  getPostgresFilterOptions,
  getPostgresParserStats,
  getPostgresParserAdmin,
  getPostgresParserAttentionByAts,
  getPostgresPostingDiagnostics,
  getPostgresDailyRedditPost,
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
const {
  STATE_CODE_TO_NAME,
  buildPostingLocationGeoFilterOptions,
  classifyLocationWorkMode,
  parseCountryFilters,
  parseCountyFilters,
  parseRegionFilters,
  rowMatchesLocationFilters,
  searchTokenMatchesPosting,
  tokenizeSearchText,
  normalizeSearchText
} = require("./search/locationFilters");
const { registerAdminRoutes } = require("./http/registerAdminRoutes");
const { registerPublicRoutes } = require("./http/registerPublicRoutes");
const { registerUserRoutes } = require("./http/registerUserRoutes");
const { createPublicSeoHelpers } = require("./http/publicSeo");
const { createPublicSerializers } = require("./http/publicSerializers");
const { createHttpSecurity } = require("./http/security");
const {
  buildPublicWebAnalyticsHeadTags,
  readPublicWebAnalyticsConfig,
  stripPublicWebAnalyticsHeadTags
} = require("./analytics/publicWebAnalytics");
const { readThresholds: readSourceQualityThresholds } = require("./ingestion/sourceQualityPolicy");
const { extractSourceIdFromPostingUrl } = require("./ingestion/parsers/shared/sourceIds");
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
  "Find fresh job openings from public employer ATS boards. Search by role, company, location, remote mode, source, and posting freshness with no sign-up.";
const PUBLIC_SUPPORTED_LANGUAGES = Object.freeze([
  { code: "en", label: "English", native_label: "English", country_code: "US" },
  { code: "tr", label: "Turkish", native_label: "Türkçe", country_code: "TR" },
  { code: "de", label: "German", native_label: "Deutsch", country_code: "DE" },
  { code: "fr", label: "French", native_label: "Français", country_code: "FR" },
  { code: "es", label: "Spanish", native_label: "Español", country_code: "ES" },
  { code: "pt-BR", label: "Portuguese (Brazil)", native_label: "Português (BR)", country_code: "BR" },
  { code: "pt-PT", label: "Portuguese (Portugal)", native_label: "Português (PT)", country_code: "PT" },
  { code: "it", label: "Italian", native_label: "Italiano", country_code: "IT" },
  { code: "nl", label: "Dutch", native_label: "Nederlands", country_code: "NL" },
  { code: "pl", label: "Polish", native_label: "Polski", country_code: "PL" },
  { code: "ja", label: "Japanese", native_label: "日本語", country_code: "JP" },
  { code: "ko", label: "Korean", native_label: "한국어", country_code: "KR" },
  { code: "zh-CN", label: "Chinese (Simplified)", native_label: "简体中文", country_code: "CN" },
  { code: "hi", label: "Hindi", native_label: "हिन्दी", country_code: "IN" },
  { code: "ar", label: "Arabic", native_label: "العربية", country_code: "AE" },
  { code: "id", label: "Indonesian", native_label: "Bahasa Indonesia", country_code: "ID" },
  { code: "sv", label: "Swedish", native_label: "Svenska", country_code: "SE" },
  { code: "da", label: "Danish", native_label: "Dansk", country_code: "DK" },
  { code: "no", label: "Norwegian", native_label: "Norsk", country_code: "NO" },
  { code: "fi", label: "Finnish", native_label: "Suomi", country_code: "FI" }
]);
const PUBLIC_SUPPORTED_LANGUAGE_CODES = new Set(PUBLIC_SUPPORTED_LANGUAGES.map((language) => language.code));
const PUBLIC_SUPPORTED_LANGUAGE_BY_NORMALIZED_CODE = new Map(
  PUBLIC_SUPPORTED_LANGUAGES.map((language) => [String(language.code).toLowerCase(), language.code])
);
const PUBLIC_SUPPORTED_LANGUAGE_PRIMARY_FALLBACKS = new Map([
  ["pt", "pt-BR"],
  ["zh", "zh-CN"],
  ...PUBLIC_SUPPORTED_LANGUAGES
    .filter((language) => !String(language.code).includes("-"))
    .map((language) => [String(language.code).toLowerCase(), language.code])
]);
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
  TR: "tr",
  BR: "pt-BR",
  PT: "pt-PT",
  IT: "it",
  NL: "nl",
  PL: "pl",
  JP: "ja",
  KR: "ko",
  CN: "zh-CN",
  IN: "hi",
  AE: "ar",
  ID: "id",
  SE: "sv",
  DK: "da",
  NO: "no",
  FI: "fi"
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
const USAJOBS_SEARCH_API_URL = "https://data.usajobs.gov/api/Search";
const GOVERNMENTJOBS_ESTIMATED_COMPANY_COUNT = 2400;
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
const atsRateLimitStore = createAtsRateLimitStateStore({
  getPool: () => (DB_BACKEND === "postgres" ? postgresPool : null)
});
let atsRequestQueueConcurrency = ATS_REQUEST_QUEUE_CONCURRENCY_DEFAULT;
const {
  fetchWithAtsRateLimit
} = createSourceFetchRuntime({
  atsRateLimitStore,
  fetchTimeoutMs: FETCH_TIMEOUT_MS,
  getAtsRequestQueueConcurrency: () => atsRequestQueueConcurrency
});
const {
  collectPostingsForCompany,
  inferPostingLocationFromJobUrl,
  shouldStorePostingByDate
} = createSourceCollectorRuntime({
  fetchWithAtsRateLimit,
  getPostingLocationByJobUrl: () => postingLocationByJobUrl,
  nowEpochSeconds,
  postingTtlSeconds: POSTING_TTL_SECONDS
});
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

const {
  buildPublicSourceFacets,
  sanitizePublicPostings,
  sanitizePublicSourceFacets
} = createPublicSerializers({
  atsFilterLabelByValue: ATS_FILTER_LABEL_BY_VALUE,
  inferAtsFromJobPostingUrl,
  normalizeAtsFilterValue,
  nowEpochSeconds,
  sanitizeFrontendText,
  sourceFacetFreshDays: PUBLIC_SOURCE_FACET_FRESH_DAYS,
  sourceFacetLimit: PUBLIC_SOURCE_FACET_LIMIT
});

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

const {
  buildLlmsTxt,
  buildRobotsTxt,
  buildSitemapXml,
  renderSeoIndexHtml
} = createPublicSeoHelpers({
  buildPublicWebAnalyticsHeadTags,
  nodeEnv: NODE_ENV,
  port: PORT,
  publicSiteUrl: PUBLIC_SITE_URL,
  readPublicWebAnalyticsConfig,
  seoDescription: SEO_SITE_DESCRIPTION,
  seoTitle: SEO_SITE_TITLE,
  stripPublicWebAnalyticsHeadTags
});

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

const {
  adminGateMiddleware,
  buildSecurityContentSecurityPolicy,
  createRateLimiter,
  genericErrorMiddleware,
  hasAdminAccess,
  isControlRoute,
  securityHeadersMiddleware
} = createHttpSecurity({
  adminToken: ADMIN_TOKEN,
  allowLocalAdmin: ALLOW_LOCAL_ADMIN,
  nodeEnv: NODE_ENV
});

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
  const exact = PUBLIC_SUPPORTED_LANGUAGE_BY_NORMALIZED_CODE.get(normalized);
  if (exact) return exact;
  const primary = normalized.split("-")[0];
  return PUBLIC_SUPPORTED_LANGUAGE_PRIMARY_FALLBACKS.get(primary) || "";
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

function getPostingLocationGeoFilterOptions() {
  if (
    postingLocationGeoFilterOptionsCache.mapRef === postingLocationByJobUrl &&
    postingLocationGeoFilterOptionsCache.version === postingLocationVersion
  ) {
    return postingLocationGeoFilterOptionsCache;
  }

  const { countries, regions } = buildPostingLocationGeoFilterOptions(postingLocationByJobUrl.values());
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

const {
  ensureCompaniesTableSchema,
  ensureJobIndustryTables,
  ensurePostingsTable,
  ensureStateLocationIndexTable,
  hydratePostingLocationMapFromDb,
  seedReferenceDataFromBundledDb
} = createSqliteSchemaRuntime({
  getDb: () => db,
  dbPath: DB_PATH,
  bundledDbPath: BUNDLED_DB_PATH,
  nowEpochSeconds,
  setPostingLocationState: (nextPostingLocationByJobUrl) => {
    postingLocationByJobUrl = nextPostingLocationByJobUrl;
    postingLocationVersion += 1;
    postingLocationGeoFilterOptionsCache = {
      mapRef: null,
      version: -1,
      countries: [],
      regions: []
    };
  }
});

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

const {
  blockCompanyByName,
  buildCoverLetterDraft,
  buildMcpRunbook,
  createApplication,
  deleteApplicationById,
  ensureApplicationsTable,
  ensureBlockedCompaniesTable,
  ensurePersonalInformationTable,
  ensureSyncServiceSettingsTable,
  enrichPostingsWithApplicationState,
  getApplicationById,
  getExistingAppliedApplicationByPostingUrl,
  getMcpSettings,
  getPersonalInformation,
  getStoredSyncServiceSettings,
  getSyncServiceSettings,
  listApplications,
  listBlockedCompanies,
  listPostingsWithFilters,
  loadSyncServiceSettingsIntoRuntime,
  mapApplicationRow,
  markPostingAppliedState,
  migrateSettingsAndApplicationsFromDatabase,
  normalizeCompanyNameForBlockList,
  normalizeMigrationSelection,
  resolveCompanyIdByName,
  resolveCompanyIdForApplication,
  resolveCompanyIdFromPostingUrl,
  setPostingIgnoredState,
  tableExists,
  unblockCompanyByName,
  updateApplicationStatus,
  upsertMcpSettings,
  upsertPersonalInformation,
  upsertSyncServiceSettings
} = createSqliteAppStateRuntime({
  getDb: () => db,
  dbPath: DB_PATH,
  personalInformationFields: PERSONAL_INFORMATION_FIELDS,
  mcpSettingsDefaults: MCP_SETTINGS_DEFAULTS,
  syncServiceSettingsDefaults: SYNC_SERVICE_SETTINGS_DEFAULTS,
  minAtsRequestQueueConcurrency: MIN_ATS_REQUEST_QUEUE_CONCURRENCY,
  maxAtsRequestQueueConcurrency: MAX_ATS_REQUEST_QUEUE_CONCURRENCY,
  getAtsRequestQueueConcurrency: () => atsRequestQueueConcurrency,
  setAtsRequestQueueConcurrency: (value) => {
    atsRequestQueueConcurrency = value;
  },
  setSyncEnabledAts: (values) => {
    syncEnabledAts = new Set(Array.isArray(values) ? values : normalizeSyncEnabledAts(values));
  },
  buildIndustryMatchersByKey,
  buildPublicSourceFacets,
  createDefaultPersonalInformation,
  getPostingsOrderByClause,
  inferAtsFromJobPostingUrl,
  inferPostingLocationFromJobUrl,
  normalizeApplicationStatus,
  normalizeAppliedByLabel,
  normalizeAppliedByType,
  normalizeAtsFilters,
  normalizeAtsRequestQueueConcurrency,
  normalizeBoolean,
  normalizeFreshnessDays,
  normalizeIgnoredByLabel,
  normalizeLikeText,
  normalizeMcpSettingsInput,
  normalizePersonalInformationInput,
  normalizePostingSort,
  normalizeRemoteFilter,
  normalizeStringArray,
  normalizeSyncEnabledAts,
  normalizeSyncServiceSettingsInput,
  nowEpochSeconds,
  parseCountryFilters,
  parseCountyFilters,
  parseJsonArray,
  parseNonNegativeInteger,
  parseRegionFilters,
  rowMatchesIndustryLikeParts,
  rowMatchesLocationFilters,
  rowMatchesRemoteFilter,
  searchTokenMatchesPosting,
  sortSqlitePostingItems,
  tokenizeSearchText
});

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
  const configuredAtsRow = await db.get(`SELECT COUNT(DISTINCT ATS_name) AS count FROM companies;`);
  const postingRow = await db.get(
    `
      SELECT COUNT(*) AS count
      FROM Postings
      WHERE COALESCE(hidden, 0) = 0;
    `
  );
  const visibleCompanyRow = await db.get(
    `
      SELECT COUNT(DISTINCT company_name) AS count
      FROM Postings
      WHERE COALESCE(hidden, 0) = 0
        AND COALESCE(company_name, '') <> '';
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
  const visibleAtsCount = Number(configuredAtsRow?.count || 0);

  return {
    company_count: Number(companyRow?.count || 0),
    visible_company_count: Number(visibleCompanyRow?.count || 0),
    configured_ats_count: Number(configuredAtsRow?.count || 0),
    visible_ats_count: visibleAtsCount,
    posting_count: Number(postingRow?.count || 0),
    job_slot_count: Number(postingRow?.count || 0),
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
    buildLlmsTxt,
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
    getPostgresDailyRedditPost,
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
    publicSiteUrl: PUBLIC_SITE_URL,
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
  runWorkdaySync,
  upsertPostings
};

if (require.main === module) {
  startWithBackoff().catch((error) => {
    console.error("[openjobslots API] startup failed:", error);
    process.exit(1);
  });
}
