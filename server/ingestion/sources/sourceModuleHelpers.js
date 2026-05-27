const { buildEvidenceMetadata, evaluatePublicPosting } = require("../publicPostingGate");
const { decideDetailEscalation } = require("../parserEvidence");
const { canonicalizePostingUrl, normalizePosting, validatePosting } = require("../posting");
const { validateNormalizedPostingContract } = require("../parserContract");

function clean(value) {
  return String(value || "").trim();
}

function makeSourceFetchError(reason, message, details = {}) {
  const error = new Error(message || reason);
  error.ingestionErrorType = reason;
  Object.assign(error, details);
  return error;
}

function responseStatus(payload) {
  return Number(payload?.status || payload?.statusCode || 200);
}

async function payloadToText(payload) {
  if (typeof payload === "string") return payload;
  if (typeof payload?.text === "function") return payload.text();
  if (typeof payload?.body === "string") return payload.body;
  if (typeof payload?.html === "string") return payload.html;
  return "";
}

function finalUrlFromPayload(payload, fallbackUrl = "") {
  return clean(payload?.url || payload?.__sourceFetchFinalUrl || fallbackUrl);
}

function createBasicSourceContract(options = {}) {
  const atsKey = clean(options.atsKey);
  const sourceFamily = clean(options.sourceFamily || "html_detail");
  const parserVersion = clean(options.parserVersion || `source-${atsKey}-v1`);
  const parserConfidence = Number(options.parserConfidence || 0.65);
  const detailSupported = Boolean(options.detailSupported);
  const requestsPerMinute = Number(options.requestsPerMinute || 8);
  const rateLimitStrategy = clean(options.rateLimitStrategy || "source-local-per-host-serialized");
  const fixturePaths = Array.isArray(options.fixturePaths) ? options.fixturePaths : [];

  function normalize(posting, company = {}, normalizeOptions = {}) {
    const normalized = normalizePosting(posting, company, atsKey, {
      parserVersion,
      confidence: normalizeOptions.confidence || parserConfidence,
      ...normalizeOptions
    });
    normalized.parser_key = atsKey;
    normalized.parser_version = parserVersion;
    normalized.parser_confidence = Number(normalized.parser_confidence || parserConfidence);
    normalized.confidence_score = normalized.parser_confidence;
    normalized.canonical_url = canonicalizePostingUrl(normalized.canonical_url || normalized.job_posting_url);
    normalized.job_posting_url = normalized.canonical_url;
    normalized.apply_url = canonicalizePostingUrl(normalized.apply_url || normalized.canonical_url);
    normalized.source_family = sourceFamily;
    normalized.evidence = buildEvidenceMetadata(normalized, {
      parserVersion,
      sourceFamily
    });
    normalized.detail_escalation_decision = decideDetailEscalation(normalized, {
      sourceFamily,
      detailSupported
    });
    return normalized;
  }

  function validate(posting) {
    const basic = validatePosting(posting);
    if (!basic.ok) return basic;
    const contract = validateNormalizedPostingContract(posting);
    if (!contract.ok) return contract;
    return { ok: true, error: "", status: "valid" };
  }

  function validatePublic(posting) {
    return evaluatePublicPosting(posting, { parserVersion });
  }

  function rateLimit() {
    return {
      requestsPerMinute,
      strategy: rateLimitStrategy
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
    return fixturePaths;
  }

  return {
    normalize,
    validate,
    validatePublic,
    rateLimit,
    qualityThreshold,
    fixtures
  };
}

module.exports = {
  clean,
  createBasicSourceContract,
  finalUrlFromPayload,
  makeSourceFetchError,
  payloadToText,
  responseStatus
};
