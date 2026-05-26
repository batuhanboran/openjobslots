const {
  buildEvidenceMetadata,
  evaluatePublicPosting
} = require("../../publicPostingGate");
const { decideDetailEscalation } = require("../../parserEvidence");
const { validateNormalizedPostingContract } = require("../../parserContract");
const { canonicalizePostingUrl, normalizePosting, validatePosting } = require("../../posting");
const { createDiscover } = require("./discover");
const { createFetchList } = require("./fetchList");
const parser = require("./parse");

const GEM_SOURCE_FAMILY = "direct_json";
const GEM_PARSER_VERSION = "source-gem-v1";
const DEFAULT_PARSER_CONFIDENCE = 0.75;
const DEFAULT_RATE_LIMIT = Object.freeze({
  requestsPerMinute: 30,
  strategy: "direct-json-api-per-host-serialized"
});

function clean(value) {
  return String(value || "").trim();
}

function parseSourceName(company = {}) {
  return clean(company.company_name || company.companyName || company.name || "Gem");
}

const discover = createDiscover(GEM_PARSER_VERSION);
const fetchList = createFetchList(discover);

function parse(rawPayload, company = {}) {
  const target = discover(company);
  const config = rawPayload?.__sourceConfig || target.config || {};
  const payload = rawPayload && typeof rawPayload === "object" && !Array.isArray(rawPayload)
    ? Object.fromEntries(Object.entries(rawPayload).filter(([name]) => !name.startsWith("__")))
    : rawPayload;
  return parser.parseGemPostingsFromBatchResponse(
    parseSourceName(company),
    config,
    payload
  );
}

function normalize(posting, company = {}, options = {}) {
  const normalized = normalizePosting(posting, company, "gem", {
    parserVersion: GEM_PARSER_VERSION,
    confidence: options.confidence || DEFAULT_PARSER_CONFIDENCE,
    ...options
  });

  normalized.parser_key = "gem";
  normalized.parser_version = GEM_PARSER_VERSION;
  normalized.parser_confidence = Number(normalized.parser_confidence || DEFAULT_PARSER_CONFIDENCE);
  normalized.confidence_score = normalized.parser_confidence;
  normalized.canonical_url = canonicalizePostingUrl(normalized.canonical_url || normalized.job_posting_url);
  normalized.job_posting_url = normalized.canonical_url;
  normalized.apply_url = canonicalizePostingUrl(normalized.apply_url || normalized.canonical_url);
  normalized.source_family = GEM_SOURCE_FAMILY;
  normalized.evidence = buildEvidenceMetadata(normalized, {
    parserVersion: GEM_PARSER_VERSION,
    sourceFamily: GEM_SOURCE_FAMILY
  });
  normalized.detail_escalation_decision = decideDetailEscalation(normalized, {
    sourceFamily: GEM_SOURCE_FAMILY,
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
  return evaluatePublicPosting(posting, { parserVersion: GEM_PARSER_VERSION });
}

function rateLimit() {
  return DEFAULT_RATE_LIMIT;
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
    "server/ingestion/sources/gem/fixtures/list.json",
    "server/ingestion/sources/gem/fixtures/expected-normalized.json",
    "server/ingestion/sources/gem/fixtures/invalid-shapes.json"
  ];
}

module.exports = {
  atsKey: "gem",
  key: "gem",
  parserVersion: GEM_PARSER_VERSION,
  discover,
  fetchList,
  fetchDetail: async () => null,
  parse,
  normalize,
  validate,
  validatePublic,
  rateLimit,
  qualityThreshold,
  fixtures,
  ...parser
};
