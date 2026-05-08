const ADAPTER_METADATA_VERSION = "adapter-certification-v2";

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
  "getro"
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
const UNSUPPORTED_ATS = new Set(["dayforcehcm"]);

const FIXTURE_BACKED = new Set([
  "greenhouse",
  "lever",
  "ashby",
  "smartrecruiters",
  "recruitee",
  "bamboohr",
  "applicantpro",
  "applytojob",
  "breezy",
  "hrmdirect",
  "icims",
  "zoho",
  "applitrack",
  "pinpointhq",
  "recruitcrm",
  "fountain",
  "paylocity",
  "oracle",
  "adp_workforcenow",
  "careerplug",
  "manatal"
]);

const PARSER_FIXTURE_BACKED = new Set([
  "adp_workforcenow",
  "applicantpro",
  "applitrack",
  "fountain",
  "icims",
  "oracle",
  "paylocity",
  "pinpointhq",
  "recruitcrm",
  "careerplug",
  "manatal"
]);

const FUTURE_DIRECT_SOURCE_CANDIDATES = Object.freeze([
  {
    key: "personio",
    displayName: "Personio",
    priority: "wave-1",
    sourceType: "direct-public-feed",
    docsUrl: "https://developer.personio.de/v1.0/reference/get_xml",
    endpointPattern: "https://{company}.jobs.personio.de/xml?language=en",
    notes: "Official XML open positions feed. Strong candidate for EU coverage."
  },
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
    key: "workable",
    displayName: "Workable",
    priority: "wave-2",
    sourceType: "direct-or-public-widget",
    docsUrl: "https://help.workable.com/hc/en-us/articles/115012771647-Using-the-Workable-API-to-create-a-careers-page",
    endpointPattern: "Requires reviewed public widget config or r_jobs token.",
    notes: "High-value source; enable only after token/config handling is reviewed."
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
  return !UNSUPPORTED_ATS.has(String(atsKey || "").trim().toLowerCase());
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
  return {
    key,
    displayName: String(displayName || key).trim(),
    metadataVersion: ADAPTER_METADATA_VERSION,
    tier: getAdapterTier(key),
    fixtureStatus: getFixtureStatus(key),
    parserFixtureStatus: getParserFixtureStatus(key),
    enabledByDefault: isAtsEnabledByDefault(key),
    confidence: getDefaultConfidence(key),
    parseStrategy: getAdapterParseStrategy(key),
    normalizedShape: [
      "source_job_id",
      "canonical_url",
      "apply_url",
      "title",
      "company",
      "location_text",
      "country",
      "region",
      "city",
      "remote_type",
      "department",
      "employment_type",
      "description_plain",
      "description_html",
      "industry",
      "posted_at",
      "posted_at_epoch",
      "first_seen",
      "first_seen_epoch",
      "last_seen",
      "last_seen_epoch",
      "ats_key",
      "parser_version",
      "raw_hash",
      "parser_confidence"
    ]
  };
}

module.exports = {
  ADAPTER_METADATA_VERSION,
  AGGREGATOR_SOURCE_CANDIDATES,
  BRITTLE_HIGH_RISK,
  DIRECT_JSON_STABLE,
  EMBEDDED_OR_SEMI_STRUCTURED,
  ENTERPRISE_DIRECT,
  FIXTURE_BACKED,
  FUTURE_DIRECT_SOURCE_CANDIDATES,
  PARSER_FIXTURE_BACKED,
  PUBLIC_SECTOR_EDUCATION,
  UNSUPPORTED_ATS,
  VENDOR_SPECIFIC,
  getFixtureStatus,
  getParserFixtureStatus,
  getAdapterMetadata,
  getAdapterParseStrategy,
  getAdapterTier,
  isAtsEnabledByDefault
};
