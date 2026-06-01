const { validateNormalizedPostingContract } = require("../../parserContract");
const { buildEvidenceMetadata, evaluatePublicPosting } = require("../../publicPostingGate");
const { decideDetailEscalation } = require("../../parserEvidence");
const { canonicalizePostingUrl, normalizePosting, validatePosting } = require("../../posting");
const parser = require("./parse");
const { TEAMTAILOR_DOCS_URL, TEAMTAILOR_SOURCE_FAMILY, clean, createDiscover } = require("./discover");
const { createFetchList } = require("./fetchList");

const atsKey = "teamtailor";
const parserVersion = "source-teamtailor-v1";
const parserConfidence = 0.55;
const discover = createDiscover();
const fetchList = createFetchList({ discover });
const payloadShapePolicy = Object.freeze({
  optional_enrichment_prefixes: Object.freeze([
    "__detailHtmlByUrl",
    "__detailStatusByUrl"
  ])
});
const TEAMTAILOR_CITY_COUNTRY_HINTS = Object.freeze({
  "batumi, georgia": { city: "Batumi", country: "Georgia", region: "EMEA" },
  "tbilisi, georgia": { city: "Tbilisi", country: "Georgia", region: "EMEA" }
});

function normalizeCompanyName(company = {}, fallback = "teamtailor") {
  return clean(company.company_name || company.companyName || company.name || fallback) || fallback;
}

function normalizeHintKey(value) {
  return clean(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function teamtailorCityCountryHint(locationText) {
  return TEAMTAILOR_CITY_COUNTRY_HINTS[normalizeHintKey(locationText)] || null;
}

function applyTeamtailorSourceGeoHints(normalized) {
  const hint = teamtailorCityCountryHint(normalized.location_text || normalized.location);
  if (!hint) return;
  normalized.city = hint.city;
  normalized.country = hint.country;
  normalized.region = hint.region;
  normalized.source_evidence = {
    ...(normalized.source_evidence || {}),
    location_source: normalized.source_evidence?.location_source || "list_or_rss_location",
    location_path: normalized.source_evidence?.location_path || "teamtailor_location_text",
    country_source: "list_or_rss_location",
    country_path: "teamtailor_location_text",
    country_rule_name: "teamtailor_city_country_hint",
    city_source: "list_or_rss_location",
    city_path: "teamtailor_location_text",
    city_rule_name: "teamtailor_city_country_hint"
  };
}

function stripInternalPayloadFields(rawPayload) {
  if (!rawPayload || typeof rawPayload !== "object" || Array.isArray(rawPayload)) return rawPayload;
  return Object.fromEntries(Object.entries(rawPayload).filter(([name]) => !String(name).startsWith("__")));
}

function parse(rawPayload, company = {}) {
  const target = discover(company);
  const config = rawPayload?.__sourceConfig || target.config || {};
  const payload = stripInternalPayloadFields(rawPayload);
  if (payload && typeof payload === "object" && typeof payload.rss === "string") {
    const companyName = normalizeCompanyName(company, config.subdomainLower || "teamtailor");
    const rssPostings = parser.parseTeamtailorPostingsFromRss(
      companyName,
      payload.rss
    );
    const htmlPostings = typeof payload.html === "string"
      ? parser.parseTeamtailorPostingsFromHtml(
        companyName,
        config,
        payload.html
      )
      : [];
    return parser.enrichTeamtailorPostingsWithDetailJsonLd(
      parser.mergeTeamtailorRssAndHtmlPostings(rssPostings, htmlPostings),
      rawPayload.__detailHtmlByUrl,
      rawPayload.__detailStatusByUrl
    );
  }
  const html = typeof payload === "string" ? payload : String(payload?.html || payload?.body || "");
  return parser.parseTeamtailorPostingsFromHtml(
    normalizeCompanyName(company, config.subdomainLower || "teamtailor"),
    config,
    html
  );
}

function normalize(posting, company = {}, options = {}) {
  const normalized = normalizePosting(posting, company, atsKey, {
    parserVersion,
    confidence: options.confidence || parserConfidence,
    ...options
  });
  normalized.parser_key = atsKey;
  normalized.parser_version = parserVersion;
  normalized.parser_confidence = Number(normalized.parser_confidence || parserConfidence);
  normalized.confidence_score = normalized.parser_confidence;
  normalized.canonical_url = canonicalizePostingUrl(normalized.canonical_url || normalized.job_posting_url);
  normalized.job_posting_url = normalized.canonical_url;
  normalized.apply_url = canonicalizePostingUrl(normalized.apply_url || normalized.canonical_url);
  normalized.source_family = TEAMTAILOR_SOURCE_FAMILY;
  applyTeamtailorSourceGeoHints(normalized);
  normalized.evidence = buildEvidenceMetadata(normalized, {
    parserVersion,
    sourceFamily: TEAMTAILOR_SOURCE_FAMILY
  });
  normalized.detail_escalation_decision = decideDetailEscalation(normalized, {
    sourceFamily: TEAMTAILOR_SOURCE_FAMILY,
    detailSupported: false
  });
  return normalized;
}

function validate(posting) {
  const basic = validatePosting(posting);
  if (!basic.ok) return basic;
  const contract = validateNormalizedPostingContract(posting);
  if (!contract.ok) return contract;
  if (!clean(posting?.source_job_id)) {
    return { ok: false, error: "missing source_job_id", status: "quarantined" };
  }
  return { ok: true, error: "", status: "valid" };
}

function validatePublic(posting) {
  return evaluatePublicPosting(posting, { parserVersion });
}

function rateLimit() {
  return {
    requestsPerMinute: 8,
    strategy: "teamtailor-rss-first-per-host-serialized"
  };
}

function qualityThreshold() {
  return {
    parse_success_minimum_pct: 95,
    max_batch_bad_row_pct: 5,
    requires_title_company_canonical_url: true,
    public_requires_geo_or_explicit_remote: true,
    ambiguous_rows: "quarantine"
  };
}

function fixtures() {
  return [
    "server/ingestion/sources/teamtailor/fixtures/list.json",
    "server/ingestion/sources/teamtailor/fixtures/expected-normalized.json",
    "server/ingestion/sources/teamtailor/fixtures/invalid-shapes.json"
  ];
}

module.exports = {
  ...parser,
  atsKey,
  key: atsKey,
  family: "vendor-specific",
  status: "disabled",
  parserVersion,
  officialDocs: TEAMTAILOR_DOCS_URL,
  discover,
  fetchList,
  fetchDetail: async () => null,
  parse,
  normalize,
  validate,
  validatePublic,
  rateLimit,
  qualityThreshold,
  payloadShapePolicy,
  fixtures
};
