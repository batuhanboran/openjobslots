const { buildEvidenceMetadata, evaluatePublicPosting } = require("../../publicPostingGate");
const { decideDetailEscalation } = require("../../parserEvidence");
const { canonicalizePostingUrl, normalizePosting, validatePosting } = require("../../posting");
const { validateNormalizedPostingContract } = require("../../parserContract");
const parser = require("./parse");
const { GOVERNMENTJOBS_SOURCE_FAMILY, clean, createDiscover } = require("./discover");
const { createFetchList } = require("./fetchList");

const ATS_KEY = "governmentjobs";
const PARSER_VERSION = "source-governmentjobs-v1";
const PARSER_CONFIDENCE = 0.72;

const discover = createDiscover();
const fetchList = createFetchList({ discover });

function parse(rawPayload, _company = {}) {
  if (rawPayload && Array.isArray(rawPayload.__legacyParsed)) return rawPayload.__legacyParsed;

  const pages = Array.isArray(rawPayload?.view_html_pages)
    ? rawPayload.view_html_pages
    : [rawPayload?.view1 || rawPayload?.html || rawPayload?.body || rawPayload].filter(Boolean);
  const postings = [];
  const seenUrls = new Set();

  for (const pageHtml of pages) {
    for (const posting of parser.parseGovernmentJobsPostingsFromViewHtml(pageHtml)) {
      const canonical = canonicalizePostingUrl(posting.job_posting_url);
      if (!canonical || seenUrls.has(canonical)) continue;
      seenUrls.add(canonical);
      postings.push({
        ...posting,
        job_posting_url: canonical,
        source_evidence: {
          ...(posting.source_evidence || {}),
          list_url: clean(rawPayload?.__sourceConfig?.listUrl || rawPayload?.__sourceFetchFinalUrl || "https://www.governmentjobs.com/jobs"),
          route_kind: posting.source_evidence?.route_kind || "governmentjobs_public_search_ajax"
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
  normalized.source_family = GOVERNMENTJOBS_SOURCE_FAMILY;
  normalized.evidence = buildEvidenceMetadata(normalized, {
    parserVersion: PARSER_VERSION,
    sourceFamily: GOVERNMENTJOBS_SOURCE_FAMILY
  });
  normalized.detail_escalation_decision = decideDetailEscalation(normalized, {
    sourceFamily: GOVERNMENTJOBS_SOURCE_FAMILY,
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
    strategy: "public-sector-search-ajax"
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
    "server/ingestion/sources/governmentjobs/fixtures/list.json",
    "server/ingestion/sources/governmentjobs/fixtures/expected-normalized.json",
    "server/ingestion/sources/governmentjobs/fixtures/invalid-shapes.json"
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
