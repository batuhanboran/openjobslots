"use strict";

const { buildEvidenceMetadata, evaluatePublicPosting } = require("../../publicPostingGate");
const { decideDetailEscalation } = require("../../parserEvidence");
const { canonicalizePostingUrl, normalizePosting, validatePosting } = require("../../posting");
const { validateNormalizedPostingContract } = require("../../parserContract");
const parser = require("./parse");
const { CALCAREERS_SOURCE_FAMILY, clean, createDiscover } = require("./discover");
const { createFetchList } = require("./fetchList");

const ATS_KEY = "calcareers";
const PARSER_VERSION = "source-calcareers-v1";
const PARSER_CONFIDENCE = 0.62;

const discover = createDiscover();
const fetchList = createFetchList({ discover });

function pagesFromPayload(rawPayload) {
  if (Array.isArray(rawPayload?.html_pages)) return rawPayload.html_pages;
  if (Array.isArray(rawPayload?.pages)) return rawPayload.pages;
  return [rawPayload?.html || rawPayload?.body || rawPayload].filter(Boolean);
}

function parse(rawPayload, company = {}) {
  if (rawPayload && Array.isArray(rawPayload.__legacyParsed)) return rawPayload.__legacyParsed;

  const target = discover(company);
  const listUrl = clean(rawPayload?.__sourceFetchFinalUrl || rawPayload?.__sourceConfig?.listUrl || target.list_url);
  const postings = [];
  const seenUrls = new Set();
  for (const page of pagesFromPayload(rawPayload)) {
    for (const posting of parser.parseCalcareersPostingsFromHtml(page, listUrl)) {
      const canonical = canonicalizePostingUrl(posting.job_posting_url);
      if (!canonical || seenUrls.has(canonical)) continue;
      seenUrls.add(canonical);
      postings.push({
        ...posting,
        job_posting_url: canonical,
        source_evidence: {
          ...(posting.source_evidence || {}),
          list_url: listUrl,
          route_kind: "calcareers_aspnet_postback"
        }
      });
    }
  }
  return postings;
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
  normalized.source_family = CALCAREERS_SOURCE_FAMILY;
  normalized.evidence = buildEvidenceMetadata(normalized, {
    parserVersion: PARSER_VERSION,
    sourceFamily: CALCAREERS_SOURCE_FAMILY
  });
  normalized.detail_escalation_decision = decideDetailEscalation(normalized, {
    sourceFamily: CALCAREERS_SOURCE_FAMILY,
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
    requestsPerMinute: 4,
    strategy: "public-sector-aspnet-postback"
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
    "server/ingestion/sources/calcareers/fixtures/list.json",
    "server/ingestion/sources/calcareers/fixtures/expected-normalized.json",
    "server/ingestion/sources/calcareers/fixtures/invalid-shapes.json"
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
