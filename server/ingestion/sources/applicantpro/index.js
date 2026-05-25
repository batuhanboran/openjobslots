"use strict";

const { validateNormalizedPostingContract } = require("../../parserContract");
const { buildEvidenceMetadata, evaluatePublicPosting } = require("../../publicPostingGate");
const { decideDetailEscalation } = require("../../parserEvidence");
const { canonicalizePostingUrl, normalizePosting, validatePosting } = require("../../posting");
const { createDiscover } = require("./discover");
const { createFetchList } = require("./fetchList");
const { normalizeCompanyName } = require("./helpers");
const { parseApplicantProPostingsFromApi } = require("./parse");

const atsKey = "applicantpro";
const parserVersion = "source-applicantpro-v1";
const sourceFamily = "embedded_json";
const parserConfidence = 0.75;
const discover = createDiscover(parserVersion);
const fetchList = createFetchList(discover);

function stripSourceConfig(rawPayload) {
  if (!rawPayload || typeof rawPayload !== "object" || Array.isArray(rawPayload)) return rawPayload;
  return Object.fromEntries(Object.entries(rawPayload).filter(([name]) => name !== "__sourceConfig"));
}

function parse(rawPayload, company = {}) {
  const target = discover(company);
  const config = rawPayload?.__sourceConfig || target.config || {};
  return parseApplicantProPostingsFromApi(
    normalizeCompanyName(company, config.subdomainLower || atsKey),
    config,
    stripSourceConfig(rawPayload)
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
  normalized.source_family = sourceFamily;
  normalized.evidence = buildEvidenceMetadata(normalized, { parserVersion, sourceFamily });
  normalized.detail_escalation_decision = decideDetailEscalation(normalized, {
    sourceFamily,
    detailSupported: false
  });
  return normalized;
}

function validate(posting) {
  const basic = validatePosting(posting);
  if (!basic.ok) return basic;
  const contract = validateNormalizedPostingContract(posting);
  if (!contract.ok) return contract;
  if (!String(posting?.source_job_id || "").trim()) {
    return { ok: false, error: "missing source_job_id", status: "quarantined" };
  }
  return { ok: true, error: "", status: "valid" };
}

function validatePublic(posting) {
  return evaluatePublicPosting(posting, { parserVersion });
}

function rateLimit() {
  return Object.freeze({
    requestsPerMinute: 8,
    strategy: "embedded-json-html-bootstrap-per-host-serialized"
  });
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
    "server/ingestion/fixtures/applicantpro-direct.json",
    "server/ingestion/fixtures/applicantpro-failures.json"
  ];
}

module.exports = {
  atsKey,
  key: atsKey,
  parserVersion,
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
