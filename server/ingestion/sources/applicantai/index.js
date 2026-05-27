"use strict";

const { buildEvidenceMetadata, evaluatePublicPosting } = require("../../publicPostingGate");
const { decideDetailEscalation } = require("../../parserEvidence");
const { canonicalizePostingUrl, normalizePosting, validatePosting } = require("../../posting");
const { validateNormalizedPostingContract } = require("../../parserContract");
const parser = require("./parse");
const {
  APPLICANTAI_DOCS_URL,
  APPLICANTAI_PARSER_VERSION,
  APPLICANTAI_SOURCE_FAMILY,
  clean,
  createDiscover
} = require("./discover");
const { createFetchList } = require("./fetchList");

const ATS_KEY = "applicantai";
const PARSER_CONFIDENCE = 0.56;

const discover = createDiscover();
const fetchList = createFetchList({ discover });

function normalizeCompanyName(company = {}, fallback = ATS_KEY) {
  return clean(company.company_name || company.companyName || company.name || fallback) || fallback;
}

function stripInternalPayloadFields(rawPayload) {
  if (!rawPayload || typeof rawPayload !== "object" || Array.isArray(rawPayload)) return rawPayload;
  return Object.fromEntries(Object.entries(rawPayload).filter(([name]) => !String(name).startsWith("__")));
}

function isWeakApplicantAiLocationLabel(value) {
  return /^(flexible|various|multiple|n\/?a|not specified|to be determined)$/i.test(clean(value));
}

function parse(rawPayload, company = {}) {
  if (rawPayload && Array.isArray(rawPayload.__legacyParsed)) return rawPayload.__legacyParsed;

  const target = discover(company);
  const config = rawPayload?.__sourceConfig || target.config || {};
  const payload = stripInternalPayloadFields(rawPayload);
  const html = typeof payload === "string" ? payload : String(payload?.html || payload?.body || "");
  const listUrl = clean(rawPayload?.__sourceFetchFinalUrl || config.careersUrl || target.list_url);
  const postings = parser.parseApplicantAiPostingsFromHtml(
    normalizeCompanyName(company, config.slugLower || ATS_KEY),
    {
      ...config,
      careersUrl: listUrl || config.careersUrl
    },
    html
  );

  return postings.map((posting) => ({
    ...posting,
    source_evidence: {
      ...(posting.source_evidence || {}),
      list_url: listUrl,
      route_kind: posting.source_evidence?.route_kind || "applicantai_public_careers_html"
    }
  }));
}

function normalize(posting, company = {}, options = {}) {
  const normalized = normalizePosting(posting, company, ATS_KEY, {
    parserVersion: APPLICANTAI_PARSER_VERSION,
    confidence: options.confidence || PARSER_CONFIDENCE,
    ...options
  });
  normalized.parser_key = ATS_KEY;
  normalized.parser_version = APPLICANTAI_PARSER_VERSION;
  normalized.parser_confidence = Number(normalized.parser_confidence || PARSER_CONFIDENCE);
  normalized.confidence_score = normalized.parser_confidence;
  normalized.canonical_url = canonicalizePostingUrl(normalized.canonical_url || normalized.job_posting_url);
  normalized.job_posting_url = normalized.canonical_url;
  normalized.apply_url = canonicalizePostingUrl(normalized.apply_url || normalized.canonical_url);
  if (
    isWeakApplicantAiLocationLabel(normalized.location_text) &&
    clean(normalized.city).toLowerCase() === clean(normalized.location_text).toLowerCase() &&
    !clean(normalized.country)
  ) {
    normalized.location = "";
    normalized.location_text = "";
    normalized.city = "";
    normalized.region = "";
  }
  normalized.source_family = APPLICANTAI_SOURCE_FAMILY;
  normalized.evidence = buildEvidenceMetadata(normalized, {
    parserVersion: APPLICANTAI_PARSER_VERSION,
    sourceFamily: APPLICANTAI_SOURCE_FAMILY
  });
  normalized.detail_escalation_decision = decideDetailEscalation(normalized, {
    sourceFamily: APPLICANTAI_SOURCE_FAMILY,
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
  const gate = evaluatePublicPosting(posting, { parserVersion: APPLICANTAI_PARSER_VERSION });
  const hasGeo = Boolean(clean(posting?.country) || clean(posting?.region) || clean(posting?.city));
  const hasExplicitRemote = ["remote", "hybrid"].includes(clean(posting?.remote_type).toLowerCase());
  if (gate.status === "accepted" && !hasGeo && !hasExplicitRemote) {
    return {
      ...gate,
      status: "quarantined",
      public: false,
      ok: false,
      reason_codes: [...(gate.reason_codes || []), "no_geo_no_remote"],
      reason: "no_geo_no_remote"
    };
  }
  return gate;
}

function rateLimit() {
  return {
    requestsPerMinute: 8,
    strategy: "applicantai-careers-page-per-host-serialized"
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
    "server/ingestion/sources/applicantai/fixtures/list.json",
    "server/ingestion/sources/applicantai/fixtures/expected-normalized.json",
    "server/ingestion/sources/applicantai/fixtures/invalid-shapes.json"
  ];
}

module.exports = {
  ...parser,
  atsKey: ATS_KEY,
  key: ATS_KEY,
  family: "vendor-specific",
  status: "disabled",
  parserVersion: APPLICANTAI_PARSER_VERSION,
  officialDocs: APPLICANTAI_DOCS_URL,
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
