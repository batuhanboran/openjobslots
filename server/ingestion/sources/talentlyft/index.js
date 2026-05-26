const { buildEvidenceMetadata, evaluatePublicPosting } = require("../../publicPostingGate");
const { decideDetailEscalation } = require("../../parserEvidence");
const { canonicalizePostingUrl, normalizePosting, validatePosting } = require("../../posting");
const { validateNormalizedPostingContract } = require("../../parserContract");
const parser = require("./parse");
const { clean, createDiscover } = require("./discover");
const { createFetchList } = require("./fetchList");

const ATS_KEY = "talentlyft";
const SOURCE_FAMILY = "html_detail";
const PARSER_VERSION = "source-talentlyft-v1";
const PARSER_CONFIDENCE = 0.75;

const discover = createDiscover();
const fetchList = createFetchList({ discover });

function normalizeCompanyName(company = {}, fallback = "talentlyft") {
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
  const fragments = Array.isArray(payload?.fragments)
    ? payload.fragments
    : [{ html: String(payload?.html || payload?.body || payload || ""), finalUrl: config.careersUrl }];
  const companyName = normalizeCompanyName(company, config.subdomainLower || "talentlyft");
  const postings = [];
  const seenUrls = new Set();
  const listUrl = clean(rawPayload?.__sourceFetchFinalUrl || config.careersUrl || target.list_url);

  for (const fragment of fragments) {
    const batch = parser.parseTalentlyftPostingsFromFragment(companyName, config, fragment?.html || fragment);
    for (const posting of batch) {
      const postingUrl = clean(posting.job_posting_url);
      if (!postingUrl || seenUrls.has(postingUrl)) continue;
      seenUrls.add(postingUrl);
      postings.push({
        ...posting,
        source_evidence: {
          ...(posting.source_evidence || {}),
          list_url: listUrl,
          route_kind: posting.source_evidence?.route_kind || "talentlyft_fragment_list"
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
  normalized.source_family = SOURCE_FAMILY;
  normalized.evidence = buildEvidenceMetadata(normalized, {
    parserVersion: PARSER_VERSION,
    sourceFamily: SOURCE_FAMILY
  });
  normalized.detail_escalation_decision = decideDetailEscalation(normalized, {
    sourceFamily: SOURCE_FAMILY,
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
    requestsPerMinute: 8,
    strategy: "enterprise-brittle-per-host-serialized"
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
    "server/ingestion/sources/talentlyft/fixtures/list.json",
    "server/ingestion/sources/talentlyft/fixtures/expected-normalized.json",
    "server/ingestion/sources/talentlyft/fixtures/invalid-shapes.json"
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
