const { validateNormalizedPostingContract } = require("../../parserContract");
const { buildEvidenceMetadata, evaluatePublicPosting } = require("../../publicPostingGate");
const { decideDetailEscalation } = require("../../parserEvidence");
const { canonicalizePostingUrl, normalizePosting, validatePosting } = require("../../posting");
const parser = require("./parse");
const { RIPPLING_DOCS_URL, RIPPLING_SOURCE_FAMILY, clean, createDiscover } = require("./discover");
const { createFetchList } = require("./fetchList");

const atsKey = "rippling";
const parserVersion = "source-rippling-v1";
const parserConfidence = 0.55;
const discover = createDiscover();
const fetchList = createFetchList({ discover });

function normalizeCompanyName(company = {}, fallback = "rippling") {
  return clean(company.company_name || company.companyName || company.name || fallback) || fallback;
}

function stripInternalPayloadFields(rawPayload) {
  if (!rawPayload || typeof rawPayload !== "object" || Array.isArray(rawPayload)) return rawPayload;
  return Object.fromEntries(Object.entries(rawPayload).filter(([name]) => !String(name).startsWith("__")));
}

function parse(rawPayload, company = {}) {
  const target = discover(company);
  const config = rawPayload?.__sourceConfig || target.config || {};
  const payload = stripInternalPayloadFields(rawPayload);
  return parser.parseRipplingPostingsFromApi(
    normalizeCompanyName(company, config.companySlug || "rippling"),
    config,
    payload
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
  normalized.source_family = RIPPLING_SOURCE_FAMILY;
  normalized.evidence = buildEvidenceMetadata(normalized, {
    parserVersion,
    sourceFamily: RIPPLING_SOURCE_FAMILY
  });
  normalized.detail_escalation_decision = decideDetailEscalation(normalized, {
    sourceFamily: RIPPLING_SOURCE_FAMILY,
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
    requestsPerMinute: 1,
    strategy: "rippling-board-api-per-host-serialized"
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
    "server/ingestion/sources/rippling/fixtures/list.json",
    "server/ingestion/sources/rippling/fixtures/expected-normalized.json",
    "server/ingestion/sources/rippling/fixtures/invalid-shapes.json"
  ];
}

module.exports = {
  ...parser,
  atsKey,
  key: atsKey,
  family: "vendor-specific",
  status: "disabled",
  parserVersion,
  officialDocs: RIPPLING_DOCS_URL,
  discover,
  fetchList,
  fetchDetail: async () => null,
  parse,
  normalize,
  validate,
  validatePublic,
  rateLimit,
  qualityThreshold,
  fixtures
};
