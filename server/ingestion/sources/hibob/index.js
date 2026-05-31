const { validateNormalizedPostingContract } = require("../../parserContract");
const { buildEvidenceMetadata, evaluatePublicPosting } = require("../../publicPostingGate");
const { decideDetailEscalation } = require("../../parserEvidence");
const { canonicalizePostingUrl, normalizePosting, validatePosting } = require("../../posting");
const parser = require("./parse");
const { HIBOB_DOCS_URL, HIBOB_SOURCE_FAMILY, clean, createDiscover } = require("./discover");
const { createFetchList } = require("./fetchList");

const atsKey = "hibob";
const parserVersion = "source-hibob-v1";
const parserConfidence = 0.57;
const discover = createDiscover();
const fetchList = createFetchList({ discover });
const payloadShapePolicy = Object.freeze({
  empty_job_list_stems: Object.freeze(["jobAdDetails"])
});

function normalizeCompanyName(company = {}, fallback = "hibob") {
  return clean(company.company_name || company.companyName || company.name || fallback) || fallback;
}

function stripInternalPayloadFields(rawPayload) {
  if (!rawPayload || typeof rawPayload !== "object" || Array.isArray(rawPayload)) return rawPayload;
  return Object.fromEntries(Object.entries(rawPayload).filter(([name]) => !String(name).startsWith("__")));
}

function parse(rawPayload, company = {}) {
  if (rawPayload && Array.isArray(rawPayload.__legacyParsed)) return rawPayload.__legacyParsed;

  const target = discover(company);
  const config = rawPayload?.__sourceConfig || target.config || {};
  const payload = stripInternalPayloadFields(rawPayload);
  const postings = parser.parseHibobPostingsFromApi(
    normalizeCompanyName(company, config.companySubdomainLower || "hibob"),
    config,
    payload
  );

  return postings.map((posting) => ({
    ...posting,
    source_evidence: {
      ...(posting.source_evidence || {}),
      list_url: clean(rawPayload?.__sourceFetchFinalUrl || config.apiUrl || target.list_url),
      route_kind: posting.source_evidence?.route_kind || "hibob_job_ad_api"
    }
  }));
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
  normalized.source_family = HIBOB_SOURCE_FAMILY;
  normalized.evidence = buildEvidenceMetadata(normalized, {
    parserVersion,
    sourceFamily: HIBOB_SOURCE_FAMILY
  });
  normalized.detail_escalation_decision = decideDetailEscalation(normalized, {
    sourceFamily: HIBOB_SOURCE_FAMILY,
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
    strategy: "hibob-board-plus-job-ad-api"
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
    "server/ingestion/sources/hibob/fixtures/list.json",
    "server/ingestion/sources/hibob/fixtures/expected-normalized.json",
    "server/ingestion/sources/hibob/fixtures/invalid-shapes.json"
  ];
}

module.exports = {
  ...parser,
  atsKey,
  key: atsKey,
  family: "vendor-specific",
  status: "disabled",
  parserVersion,
  officialDocs: HIBOB_DOCS_URL,
  payloadShapePolicy,
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
