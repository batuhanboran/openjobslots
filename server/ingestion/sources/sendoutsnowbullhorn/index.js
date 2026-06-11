const { buildEvidenceMetadata, evaluatePublicPosting } = require("../../publicPostingGate");
const { decideDetailEscalation } = require("../../parserEvidence");
const { discover } = require("./discover");
const { fetchList } = require("./fetchList");
const { fetchDetail } = require("./fetchDetail");
const parse = require("./parse");
const normalizeImpl = require("./normalize");
const { validate } = require("./validate");
const { canonicalizePostingUrl, normalizePosting, validatePosting } = require("../../posting");

const ATS_KEY = "sendoutsnowbullhorn";
const PARSER_VERSION = "source-sendoutsnowbullhorn-v1";
const PARSER_CONFIDENCE = 0.75;
const SOURCE_FAMILY = "direct_json";

function normalize(posting, company = {}, options = {}) {
  const extracted = normalizeImpl(posting, company);
  const normalized = normalizePosting({...posting, ...extracted}, company, ATS_KEY, {
    parserVersion: PARSER_VERSION,
    confidence: options.confidence || PARSER_CONFIDENCE,
    ...options
  });
  normalized.evidence = buildEvidenceMetadata(normalized, { parserVersion: PARSER_VERSION, sourceFamily: SOURCE_FAMILY });
  normalized.detail_escalation_decision = decideDetailEscalation(normalized, {
    sourceFamily: SOURCE_FAMILY,
    detailSupported: false
  });
  return normalized;
}

function validatePublic(posting) {
  return evaluatePublicPosting(posting, { parserVersion: PARSER_VERSION });
}

function rateLimit() {
  return {
    requestsPerMinute: 30,
    strategy: "direct-json-api-per-host-serialized"
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
    `server/ingestion/sources/${ATS_KEY}/fixtures/list.json`,
    `server/ingestion/sources/${ATS_KEY}/fixtures/expected-normalized.json`,
    `server/ingestion/sources/${ATS_KEY}/fixtures/invalid-shapes.json`
  ];
}

module.exports = {
  atsKey: ATS_KEY,
  key: ATS_KEY,
  parserVersion: PARSER_VERSION,
  discover,
  fetchList,
  fetchDetail,
  parse,
  normalize,
  validate,
  validatePublic,
  rateLimit,
  qualityThreshold,
  fixtures
};