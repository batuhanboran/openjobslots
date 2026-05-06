const ADAPTER_METADATA_VERSION = "adapter-certification-v1";

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

const FIXTURE_BACKED = new Set([
  "greenhouse",
  "lever",
  "ashby",
  "smartrecruiters",
  "recruitee",
  "bamboohr",
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
  "adp_workforcenow"
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

function getDefaultConfidence(atsKey) {
  if (FIXTURE_BACKED.has(atsKey)) return "medium";
  if (DIRECT_JSON_STABLE.includes(atsKey)) return "medium-pending-fixture";
  if (ENTERPRISE_DIRECT.includes(atsKey)) return "medium-low-pending-fixture";
  if (BRITTLE_HIGH_RISK.includes(atsKey)) return "low";
  return "pending-fixture";
}

function getAdapterParseStrategy(atsKey) {
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
    fixtureStatus: FIXTURE_BACKED.has(key) ? "fixture-backed" : "pending-fixture",
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
      "remote_type",
      "industry",
      "posted_at",
      "first_seen",
      "last_seen",
      "ats_key",
      "parser_version",
      "raw_hash",
      "confidence"
    ]
  };
}

module.exports = {
  ADAPTER_METADATA_VERSION,
  BRITTLE_HIGH_RISK,
  DIRECT_JSON_STABLE,
  EMBEDDED_OR_SEMI_STRUCTURED,
  ENTERPRISE_DIRECT,
  FIXTURE_BACKED,
  PUBLIC_SECTOR_EDUCATION,
  VENDOR_SPECIFIC,
  getAdapterMetadata,
  getAdapterParseStrategy,
  getAdapterTier
};
