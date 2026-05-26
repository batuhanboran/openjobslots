"use strict";

const { buildEvidenceMetadata, evaluatePublicPosting } = require("../../publicPostingGate");
const { decideDetailEscalation } = require("../../parserEvidence");
const { canonicalizePostingUrl, normalizePosting, validatePosting } = require("../../posting");
const { validateNormalizedPostingContract } = require("../../parserContract");
const parser = require("./parse");
const { K12JOBSPOT_API_URL, K12JOBSPOT_SOURCE_FAMILY, clean, createDiscover } = require("./discover");
const { createFetchList } = require("./fetchList");

const ATS_KEY = "k12jobspot";
const PARSER_VERSION = "source-k12jobspot-v1";
const PARSER_CONFIDENCE = 0.74;

const discover = createDiscover();
const fetchList = createFetchList({ discover });

function parse(rawPayload, company = {}) {
  if (rawPayload && Array.isArray(rawPayload.__legacyParsed)) return rawPayload.__legacyParsed;
  const postings = parser.parseK12jobspotPostingsFromPayload(rawPayload);
  const listUrl = clean(rawPayload?.__sourceFetchFinalUrl || rawPayload?.__sourceConfig?.apiUrl || K12JOBSPOT_API_URL);
  return postings.map((posting) => ({
    ...posting,
    source_evidence: {
      ...(posting.source_evidence || {}),
      list_url: listUrl,
      route_kind: posting.source_evidence?.route_kind || "k12jobspot_public_jobs_api"
    },
    company_name: clean(posting.company_name) || clean(company.company_name) || "K12JobSpot"
  }));
}

function normalize(posting, company = {}, options = {}) {
  const normalized = normalizePosting(posting, company, ATS_KEY, {
    parserVersion: PARSER_VERSION,
    confidence: options.confidence || PARSER_CONFIDENCE,
    ...options
  });
  normalized.parser_key = ATS_KEY;
  normalized.parser_version = PARSER_VERSION;
  normalized.parser_confidence = Number(normalized.parser_confidence || PARSER_CONFIDENCE);
  normalized.confidence_score = normalized.parser_confidence;
  normalized.canonical_url = canonicalizePostingUrl(normalized.canonical_url || normalized.job_posting_url);
  normalized.job_posting_url = normalized.canonical_url;
  normalized.apply_url = canonicalizePostingUrl(normalized.apply_url || normalized.canonical_url);
  normalized.source_family = K12JOBSPOT_SOURCE_FAMILY;
  normalized.evidence = buildEvidenceMetadata(normalized, {
    parserVersion: PARSER_VERSION,
    sourceFamily: K12JOBSPOT_SOURCE_FAMILY
  });
  normalized.detail_escalation_decision = decideDetailEscalation(normalized, {
    sourceFamily: K12JOBSPOT_SOURCE_FAMILY,
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
  return evaluatePublicPosting(posting, { parserVersion: PARSER_VERSION });
}

function rateLimit() {
  return {
    requestsPerMinute: 6,
    strategy: "public-sector-json-api"
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
    "server/ingestion/sources/k12jobspot/fixtures/list.json",
    "server/ingestion/sources/k12jobspot/fixtures/expected-normalized.json",
    "server/ingestion/sources/k12jobspot/fixtures/invalid-shapes.json"
  ];
}

module.exports = {
  ...parser,
  atsKey: ATS_KEY,
  key: ATS_KEY,
  parserVersion: PARSER_VERSION,
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
