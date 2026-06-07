const { NORMALIZED_POSTING_FIELDS } = require("./parserContract");

const ADAPTER_METADATA_VERSION = "adapter-certification-v3";

const DIRECT_JSON_STABLE = [
  "greenhouse",
  "lever",
  "ashby",
  "smartrecruiters",
  "recruitee",
  "bamboohr",
  "teamtailor",
  "freshteam",
  "pinpointhq",
  "recruitcrm",
  "fountain",
  "getro",
  "personio",
  "workable"
];

const ENTERPRISE_DIRECT = [
  "workday",
  "oracle",
  "adp_myjobs",
  "adp_workforcenow",
  "paylocity",
  "dayforcehcm",
  "eightfold",
  "saphrcloud",
  "ultipro",
  "pageup"
];

const EMBEDDED_OR_SEMI_STRUCTURED = [
  "jobvite",
  "icims",
  "zoho",
  "breezy",
  "applicantpro",
  "applytojob",
  "theapplicantmanager",
  "careerplug",
  "talentreef",
  "hirebridge",
  "hrmdirect",
  "isolvisolvedhire"
];

const VENDOR_SPECIFIC = [
  "applicantai",
  "gem",
  "join",
  "careerspage",
  "manatal",
  "hibob",
  "sagehr",
  "loxo",
  "peopleforce",
  "simplicant",
  "rippling",
  "careerpuck",
  "talentlyft",
  "talexio"
];

const PUBLIC_SECTOR_EDUCATION = [
  "governmentjobs",
  "usajobs",
  "k12jobspot",
  "schoolspring",
  "calcareers",
  "calopps",
  "statejobsny",
  "policeapp",
  "jobaps",
  "applitrack"
];

const BRITTLE_HIGH_RISK = ["taleo", "brassring"];
const UNSUPPORTED_ATS = new Set([]);
const DISABLED_BY_DEFAULT_ATS = new Set(["dayforcehcm", "personio", "workable"]);

const SOURCE_FIXTURE_BACKED_ATS = [
  "adp_myjobs",
  "adp_workforcenow",
  "applicantai",
  "applicantpro",
  "applitrack",
  "applytojob",
  "ashby",
  "bamboohr",
  "brassring",
  "breezy",
  "calcareers",
  "calopps",
  "careerplug",
  "careerpuck",
  "careerspage",
  "dayforcehcm",
  "eightfold",
  "fountain",
  "freshteam",
  "gem",
  "getro",
  "governmentjobs",
  "greenhouse",
  "hibob",
  "hirebridge",
  "hrmdirect",
  "icims",
  "isolvisolvedhire",
  "jobaps",
  "jobvite",
  "join",
  "k12jobspot",
  "lever",
  "loxo",
  "manatal",
  "oracle",
  "pageup",
  "paylocity",
  "peopleforce",
  "personio",
  "pinpointhq",
  "policeapp",
  "recruitcrm",
  "recruitee",
  "rippling",
  "sagehr",
  "saphrcloud",
  "schoolspring",
  "simplicant",
  "smartrecruiters",
  "statejobsny",
  "talentlyft",
  "talentreef",
  "taleo",
  "talexio",
  "teamtailor",
  "theapplicantmanager",
  "ultipro",
  "usajobs",
  "workable",
  "workday",
  "zoho"
];

const FIXTURE_BACKED = new Set(SOURCE_FIXTURE_BACKED_ATS);

const PARSER_FIXTURE_BACKED = new Set(SOURCE_FIXTURE_BACKED_ATS);

const ADAPTER_CERTIFICATION_DETAILS = Object.freeze({
  greenhouse: {
    sourceEndpointPattern: "GET https://boards-api.greenhouse.io/v1/boards/{board_token}/jobs?content=true",
    paginationBehavior: "Single list response with jobs[] and meta.total.",
    detailPageRequirement: "Not required for core fields; retrieve-job endpoint can enrich questions/pay transparency.",
    dateParsingRule: "Use updated_at, then first_published when present.",
    locationParsingRule: "Use location.name; office.location can provide country evidence.",
    remoteParsingRule: "Infer from title/location/description evidence; Greenhouse does not expose a universal remote flag.",
    canonicalUrlRule: "Use absolute_url and strip fragments/tracking query params while preserving gh_jid/job id.",
    expectedFailureModes: ["missing absolute_url", "blank title", "prospect posts with null internal job id"],
    fixtureCoverageCount: 2,
    confidenceLevel: "medium"
  },
  lever: {
    sourceEndpointPattern: "GET https://api.lever.co/v0/postings/{site}?mode=json",
    paginationBehavior: "Supports skip/limit; current collector uses one public list response.",
    detailPageRequirement: "Not required; list JSON includes id, hostedUrl, applyUrl, categories, descriptions, createdAt.",
    dateParsingRule: "Convert createdAt epoch milliseconds when present.",
    locationParsingRule: "Use categories.allLocations, then categories.location, plus country code when present.",
    remoteParsingRule: "Use workplaceType and location/title evidence.",
    canonicalUrlRule: "Use hostedUrl and strip tracking query params such as lever-source.",
    expectedFailureModes: ["missing hostedUrl", "blank text title", "missing company context"],
    fixtureCoverageCount: 2,
    confidenceLevel: "medium"
  },
  ashby: {
    sourceEndpointPattern: "Current collector POSTs https://jobs.ashbyhq.com/api/non-user-graphql?op=ApiJobBoardWithTeams; official public API is https://api.ashbyhq.com/posting-api/job-board/{JOB_BOARD_NAME}.",
    paginationBehavior: "Current GraphQL response is one jobPostings[] list; official public API returns jobs[].",
    detailPageRequirement: "Not required for core public fields when source exposes jobUrl/applyUrl/location/description.",
    dateParsingRule: "Use official publishedAt/createdAt when present; current hosted GraphQL query omits dates.",
    locationParsingRule: "Use locationName/location/address plus secondaryLocations.",
    remoteParsingRule: "Use workplaceType and isRemote.",
    canonicalUrlRule: "Use jobUrl when present, otherwise jobs.ashbyhq.com/{board}/{id}.",
    expectedFailureModes: ["missing jobUrl with missing id", "blank title", "missing company context"],
    fixtureCoverageCount: 2,
    confidenceLevel: "medium"
  },
  smartrecruiters: {
    sourceEndpointPattern: "Public search JSON at https://jobs.smartrecruiters.com/sr-jobs/search and SmartRecruiters Posting API where credentials exist.",
    paginationBehavior: "Public search supports limit; authenticated API supports paged job search.",
    detailPageRequirement: "Not required for list-visible fields; detail pages may enrich descriptions.",
    dateParsingRule: "Use releasedDate/updatedOn/createdOn when present.",
    locationParsingRule: "Use shortLocation or location.city/region/country.",
    remoteParsingRule: "Use remote/isRemote/workplaceType/locationType plus text evidence.",
    canonicalUrlRule: "Use applyUrl/ref/jobUrl/url and strip tracking fragments/query params.",
    expectedFailureModes: ["missing applyUrl/ref URL", "blank title", "missing company context"],
    fixtureCoverageCount: 2,
    confidenceLevel: "medium"
  },
  workday: {
    sourceEndpointPattern: "POST {origin}/wday/cxs/{tenant}/{site}/jobs",
    paginationBehavior: "CXS limit/offset pagination.",
    detailPageRequirement: "Not required for list-visible source id/location/date; detail can enrich descriptions.",
    dateParsingRule: "Use postedOn/postedOnDate/postedDate/postingDate/externalPostedOn/updatedOn.",
    locationParsingRule: "Use Workday location fields plus URL location segment fallback.",
    remoteParsingRule: "Use remoteType/workplaceType/locationType/timeType/URL evidence.",
    canonicalUrlRule: "Build URL from companyBaseUrl plus externalPath.",
    expectedFailureModes: ["missing externalPath", "blank title", "generic postedOn text without exact date"],
    fixtureCoverageCount: 2,
    confidenceLevel: "medium"
  },
  dayforcehcm: {
    sourceEndpointPattern: "POST https://jobs.dayforcehcm.com/api/geo/{clientNamespace}/jobposting/search",
    paginationBehavior: "Search body carries paginationStart; response exposes offset, count, maxCount, and jobPostings[].",
    detailPageRequirement: "Not required for core fields when the search API returns jobPostingId, title, locations, virtual flag, and posting timestamp.",
    dateParsingRule: "Use postingStartTimestampUTC when present; do not infer dates from canonical URL or title.",
    locationParsingRule: "Use postingLocations[].isoCountryCode, stateCode, cityName, and formattedAddress; virtual rows may only expose country.",
    remoteParsingRule: "hasVirtualLocation true maps to remote; structured physical locations with one concrete country map to onsite.",
    canonicalUrlRule: "Build {boardUrl}/jobs/{jobPostingId} from the discovered culture/clientNamespace/jobBoardCode route.",
    expectedFailureModes: ["401/403/429 bot or rate-limit response", "missing jobPostingId", "missing board route", "blank title"],
    fixtureCoverageCount: 2,
    confidenceLevel: "medium-low"
  },
  taleo: {
    sourceEndpointPattern: "Taleo careersection REST/AJAX jobsearch endpoints.",
    paginationBehavior: "Tokenized REST/AJAX pages; shape varies by tenant.",
    detailPageRequirement: "May be required when list columns omit date/location.",
    dateParsingRule: "Scan columns and accept only date-like values; reject boolean values.",
    locationParsingRule: "Scan columns for country, remote, or state/city evidence.",
    remoteParsingRule: "Infer from picked location/title evidence.",
    canonicalUrlRule: "Build jobdetail.ftl?job={contestNo|jobId}&lang={lang}.",
    expectedFailureModes: ["unstable column order", "boolean columns mistaken for dates", "missing job id"],
    fixtureCoverageCount: 2,
    confidenceLevel: "low"
  }
});

const FUTURE_DIRECT_SOURCE_CANDIDATES = Object.freeze([
  {
    key: "recruiterbox",
    displayName: "Trakstar Hire / Recruiterbox",
    priority: "wave-1",
    sourceType: "direct-public-feed",
    docsUrl: "https://apiv1.recruiterbox.com/frontend_api.html",
    endpointPattern: "https://jsapi.recruiterbox.com/v1/openings?client_name={client}",
    notes: "Official frontend openings API; public opening data does not require auth."
  },
  {
    key: "jobscore",
    displayName: "JobScore",
    priority: "wave-1",
    sourceType: "direct-public-feed",
    docsUrl: "https://support.jobscore.com/hc/en-us/articles/202001320-Developers-Guide-to-Job-Feed-APIs",
    endpointPattern: "https://careers.jobscore.com/jobs/{company}/feed.json",
    notes: "Official JSON/XML job feed with clear polling guidance."
  },
  {
    key: "bullhorn",
    displayName: "Bullhorn",
    priority: "wave-2",
    sourceType: "direct-public-feed",
    docsUrl: "https://bullhorn.github.io/Public-API/",
    endpointPattern: "Requires customer cls and corpToken discovery/config.",
    notes: "Useful for staffing/recruiting boards; needs tenant config certification."
  },
  {
    key: "comeet",
    displayName: "Comeet / Spark Hire Recruit",
    priority: "wave-2",
    sourceType: "direct-public-feed",
    docsUrl: "https://developers.comeet.com/reference",
    endpointPattern: "https://www.comeet.co/careers-api/2.0/company/{uid}/positions?token={token}",
    notes: "Published positions API; token handling must be documented before enabling."
  }
]);

const AGGREGATOR_SOURCE_CANDIDATES = Object.freeze([
  {
    key: "remotive",
    displayName: "Remotive",
    sourceType: "remote-job-aggregator",
    docsUrl: "https://remotive.com/remote-jobs/api",
    notes: "Keep separate from ATS adapters and dedupe against canonical apply URLs."
  },
  {
    key: "himalayas",
    displayName: "Himalayas",
    sourceType: "remote-job-aggregator",
    docsUrl: "https://himalayas.app/api",
    notes: "Keep separate from ATS adapters and review attribution/link-back terms."
  },
  {
    key: "arbeitnow",
    displayName: "Arbeitnow",
    sourceType: "job-board-aggregator",
    docsUrl: "https://www.arbeitnow.com/blog/job-board-api",
    notes: "Keep separate from ATS adapters and dedupe aggressively."
  }
]);

function getAdapterTier(atsKey) {
  if (DIRECT_JSON_STABLE.includes(atsKey)) return "direct-json-stable";
  if (ENTERPRISE_DIRECT.includes(atsKey)) return "enterprise-direct";
  if (EMBEDDED_OR_SEMI_STRUCTURED.includes(atsKey)) return "embedded-or-semi-structured";
  if (VENDOR_SPECIFIC.includes(atsKey)) return "vendor-specific";
  if (PUBLIC_SECTOR_EDUCATION.includes(atsKey)) return "public-sector-education";
  if (BRITTLE_HIGH_RISK.includes(atsKey)) return "brittle-high-risk";
  return "uncategorized";
}

function getFixtureStatus(atsKey) {
  const key = String(atsKey || "").trim().toLowerCase();
  if (UNSUPPORTED_ATS.has(key)) return "unsupported";
  return FIXTURE_BACKED.has(key) ? "fixture-backed" : "pending-fixture";
}

function getParserFixtureStatus(atsKey) {
  const key = String(atsKey || "").trim().toLowerCase();
  if (UNSUPPORTED_ATS.has(key)) return "unsupported";
  if (PARSER_FIXTURE_BACKED.has(key)) return "parser-fixture-backed";
  if (FIXTURE_BACKED.has(key)) return "normalized-fixture-only";
  return "pending-parser-fixture";
}

function isAtsEnabledByDefault(atsKey) {
  const key = String(atsKey || "").trim().toLowerCase();
  return !UNSUPPORTED_ATS.has(key) && !DISABLED_BY_DEFAULT_ATS.has(key);
}

function getDefaultConfidence(atsKey) {
  if (UNSUPPORTED_ATS.has(String(atsKey || "").trim().toLowerCase())) return "unsupported";
  if (FIXTURE_BACKED.has(atsKey)) return "medium";
  if (DIRECT_JSON_STABLE.includes(atsKey)) return "medium-pending-fixture";
  if (ENTERPRISE_DIRECT.includes(atsKey)) return "medium-low-pending-fixture";
  if (BRITTLE_HIGH_RISK.includes(atsKey)) return "low";
  return "pending-fixture";
}

function getAdapterParseStrategy(atsKey) {
  if (UNSUPPORTED_ATS.has(String(atsKey || "").trim().toLowerCase())) {
    return "Disabled until a direct parser and fixture set exist; do not include in active sync.";
  }
  const tier = getAdapterTier(atsKey);
  if (tier === "direct-json-stable") return "Prefer public JSON job-board endpoint, cache raw response metadata, parse pagination before HTML fallback.";
  if (tier === "enterprise-direct") return "Extract tenant/site identifiers, prefer direct candidate API responses, normalize product-specific location/date fields.";
  if (tier === "embedded-or-semi-structured") return "Fetch public board HTML, extract embedded JSON first, then fall back to conservative DOM parsing.";
  if (tier === "vendor-specific") return "Use vendor-specific public payloads when stable; otherwise parse only validated cards with canonical URLs.";
  if (tier === "public-sector-education") return "Treat board as source-of-record, preserve agency/school location fields, enforce polite pagination.";
  if (tier === "brittle-high-risk") return "Keep low confidence until fixtures prove stability; rate-limit heavily and reject ambiguous postings.";
  return "Parser metadata pending.";
}

function getAdapterMetadata(atsKey, displayName = "") {
  const key = String(atsKey || "").trim().toLowerCase();
  const certification = ADAPTER_CERTIFICATION_DETAILS[key] || null;
  return {
    key,
    displayName: String(displayName || key).trim(),
    metadataVersion: ADAPTER_METADATA_VERSION,
    tier: getAdapterTier(key),
    fixtureStatus: getFixtureStatus(key),
    parserFixtureStatus: getParserFixtureStatus(key),
    enabledByDefault: isAtsEnabledByDefault(key),
    confidence: certification?.confidenceLevel || getDefaultConfidence(key),
    parseStrategy: getAdapterParseStrategy(key),
    certification,
    normalizedShape: NORMALIZED_POSTING_FIELDS
  };
}

module.exports = {
  ADAPTER_METADATA_VERSION,
  AGGREGATOR_SOURCE_CANDIDATES,
  BRITTLE_HIGH_RISK,
  DIRECT_JSON_STABLE,
  DISABLED_BY_DEFAULT_ATS,
  EMBEDDED_OR_SEMI_STRUCTURED,
  ENTERPRISE_DIRECT,
  FIXTURE_BACKED,
  FUTURE_DIRECT_SOURCE_CANDIDATES,
  PARSER_FIXTURE_BACKED,
  PUBLIC_SECTOR_EDUCATION,
  UNSUPPORTED_ATS,
  VENDOR_SPECIFIC,
  ADAPTER_CERTIFICATION_DETAILS,
  getFixtureStatus,
  getParserFixtureStatus,
  getAdapterMetadata,
  getAdapterParseStrategy,
  getAdapterTier,
  isAtsEnabledByDefault
};
