"use strict";

const { buildEvidenceMetadata, evaluatePublicPosting } = require("../../publicPostingGate");
const { decideDetailEscalation } = require("../../parserEvidence");
const { canonicalizePostingUrl, normalizePosting, validatePosting } = require("../../posting");
const { validateNormalizedPostingContract } = require("../../parserContract");
const parser = require("./parse");
const { SIMPLICANT_SOURCE_FAMILY, clean, createDiscover } = require("./discover");
const { createFetchList } = require("./fetchList");

const ATS_KEY = "simplicant";
const PARSER_VERSION = "source-simplicant-v1";
const PARSER_CONFIDENCE = 0.73;

const discover = createDiscover();
const fetchList = createFetchList({ discover });

function normalizeCompanyName(company = {}, fallback = "simplicant") {
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
  const html = typeof payload === "string" ? payload : String(payload?.html || payload?.body || payload?.text || "");
  const companyName = normalizeCompanyName(company, config.subdomainLower || "simplicant");
  const postings = parser.parseSimplicantPostingsFromHtml(companyName, config, html);
  const listUrl = clean(rawPayload?.__sourceFetchFinalUrl || config.jobsUrl || target.list_url);

  return postings.map((posting) => ({
    ...posting,
    source_evidence: {
      ...(posting.source_evidence || {}),
      list_url: listUrl,
      route_kind: posting.source_evidence?.route_kind || "simplicant_public_board_html"
    }
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
  normalized.source_family = SIMPLICANT_SOURCE_FAMILY;
  normalized.evidence = buildEvidenceMetadata(normalized, {
    parserVersion: PARSER_VERSION,
    sourceFamily: SIMPLICANT_SOURCE_FAMILY
  });
  normalized.detail_escalation_decision = decideDetailEscalation(normalized, {
    sourceFamily: SIMPLICANT_SOURCE_FAMILY,
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
    strategy: "html-board-per-host-serialized"
  };
}

function qualityThreshold() {
  return {
    parse_success_minimum_pct: 95,
    max_batch_bad_row_pct: 5,
    requires_title_company_canonical_url: true,
    requires_source_job_id: true,
    public_requires_geo_or_explicit_remote: true,
    ambiguous_rows: "quarantine"
  };
}

function fixtures() {
  return [
    "server/ingestion/sources/simplicant/fixtures/list.json",
    "server/ingestion/sources/simplicant/fixtures/expected-normalized.json",
    "server/ingestion/sources/simplicant/fixtures/invalid-shapes.json"
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
