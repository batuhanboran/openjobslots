"use strict";

const { buildEvidenceMetadata, evaluatePublicPosting } = require("../../publicPostingGate");
const { decideDetailEscalation } = require("../../parserEvidence");
const { canonicalizePostingUrl, normalizePosting, validatePosting } = require("../../posting");
const { validateNormalizedPostingContract } = require("../../parserContract");
const parser = require("./parse");
const { STATEJOBSNY_SOURCE_FAMILY, clean, createDiscover } = require("./discover");
const { createFetchList } = require("./fetchList");

const ATS_KEY = "statejobsny";
const PARSER_VERSION = "source-statejobsny-v1";
const PARSER_CONFIDENCE = 0.58;

const discover = createDiscover();
const fetchList = createFetchList({ discover });

function stripInternalPayloadFields(rawPayload) {
  if (!rawPayload || typeof rawPayload !== "object" || Array.isArray(rawPayload)) return rawPayload;
  return Object.fromEntries(Object.entries(rawPayload).filter(([name]) => !String(name).startsWith("__")));
}

function htmlFromPayload(rawPayload) {
  const payload = stripInternalPayloadFields(rawPayload);
  if (typeof payload === "string") return payload;
  return String(payload?.html || payload?.body || "");
}

function detailMapFromPayload(rawPayload) {
  if (!rawPayload || typeof rawPayload !== "object") return {};
  return rawPayload.detail_html_by_source_job_id || rawPayload.detail_pages_by_source_job_id || {};
}

function parse(rawPayload, company = {}) {
  if (rawPayload && Array.isArray(rawPayload.__legacyParsed)) return rawPayload.__legacyParsed;

  const target = discover(company);
  const config = rawPayload?.__sourceConfig || target.config || {};
  const listUrl = clean(rawPayload?.__sourceFetchFinalUrl || config.listUrl || target.list_url);
  const details = detailMapFromPayload(rawPayload);
  const postings = parser.parseStatejobsnyPostingsFromHtml(htmlFromPayload(rawPayload), listUrl);

  return postings.map((posting) => {
    const detailHtml = details[posting.source_job_id];
    if (!detailHtml) {
      return {
        ...posting,
        source_evidence: {
          ...(posting.source_evidence || {}),
          list_url: listUrl,
          detail_supported: true,
          detail_present: false
        }
      };
    }
    const detail = parser.parseStatejobsnyDetailFromHtml(detailHtml);
    return parser.mergeStatejobsnyDetailEvidence({
      ...posting,
      source_evidence: {
        ...(posting.source_evidence || {}),
        list_url: listUrl,
        detail_supported: true,
        detail_present: true
      }
    }, detail, posting.job_posting_url);
  });
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
  normalized.source_family = STATEJOBSNY_SOURCE_FAMILY;
  normalized.evidence = buildEvidenceMetadata(normalized, {
    parserVersion: PARSER_VERSION,
    sourceFamily: STATEJOBSNY_SOURCE_FAMILY
  });
  normalized.detail_escalation_decision = decideDetailEscalation(normalized, {
    sourceFamily: STATEJOBSNY_SOURCE_FAMILY,
    detailSupported: true
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
    requestsPerMinute: 4,
    strategy: "public-sector-html-detail"
  };
}

function qualityThreshold() {
  return {
    parse_success_minimum_pct: 95,
    max_batch_bad_row_pct: 5,
    requires_title_company_canonical_url: true,
    public_requires_geo_or_explicit_remote: true,
    county_only_rows: "quarantine",
    ambiguous_rows: "quarantine"
  };
}

function fixtures() {
  return [
    "server/ingestion/sources/statejobsny/fixtures/list.json",
    "server/ingestion/sources/statejobsny/fixtures/detail-pages.json",
    "server/ingestion/sources/statejobsny/fixtures/expected-normalized.json",
    "server/ingestion/sources/statejobsny/fixtures/invalid-shapes.json"
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
