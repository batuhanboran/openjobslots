const WORKER_FAILURE_REASON_TAXONOMY = Object.freeze([
  "parser_validation",
  "source_quality",
  "source_disabled_by_threshold",
  "rate_limit",
  "cooldown",
  "timeout",
  "network",
  "auth",
  "empty_payload",
  "invalid_shape",
  "no_jobs"
]);

const PARSER_ATTENTION_ERROR_TYPES = Object.freeze([
  "parser_drift",
  "parser_validation",
  "invalid_shape",
  "parser_adapter_not_implemented"
]);

const LEGACY_PARSER_ATTENTION_ERROR_TYPES = Object.freeze([
  "parser_parse",
  "parser_quarantine",
  "parser_normalize"
]);

const SOURCE_POLICY_BLOCK_ERROR_TYPES = Object.freeze([
  "source_quality",
  "source_disabled_by_threshold"
]);

const FAILURE_REASON_BUCKETS = Object.freeze([
  "parser_bug",
  "source_quality",
  "rate_limit",
  "network",
  "empty_no_jobs",
  "auth",
  "unknown"
]);

const SOURCE_QUALITY_ERROR_TYPES = Object.freeze([
  "source_quality",
  "source_disabled_by_threshold",
  "response_too_large",
  "source_policy",
  "source_disabled",
  "source_auto_disabled",
  "source_blocked",
  "quality_gate"
]);

const RATE_LIMIT_ERROR_TYPES = Object.freeze([
  "rate_limit",
  "rate_limited",
  "blocked_or_rate_limited",
  "cooldown",
  "http_429"
]);

const NETWORK_ERROR_TYPES = Object.freeze([
  "fetch",
  "network",
  "timeout",
  "request_timeout",
  "connection_timeout",
  "econnreset",
  "etimedout",
  "enotfound",
  "eai_again",
  "http_error"
]);

const EMPTY_NO_JOBS_ERROR_TYPES = Object.freeze([
  "empty_payload",
  "output_empty",
  "portal_search_empty",
  "no_jobs",
  "no_postings",
  "no_results",
  "empty_result",
  "empty_results"
]);

const AUTH_ERROR_TYPES = Object.freeze([
  "auth",
  "unauthorized",
  "forbidden",
  "login_required"
]);

function normalizeHttpStatus(value) {
  const status = Number(value || 0);
  if (!Number.isFinite(status) || status <= 0) return 0;
  return Math.floor(status);
}

function extractHttpStatusFromMessage(message = "") {
  const text = String(message || "").trim().toLowerCase();
  const match = text.match(/\b(?:http|status|code)\s*[:=]?\s*(\d{3})\b/);
  if (!match) return 0;
  return normalizeHttpStatus(match[1]);
}

function isSourceQualityValidationMessage(message) {
  const text = String(message || "").trim().toLowerCase();
  return text.includes("no_geo_no_remote") ||
    text.includes("ambiguous_location") ||
    text.includes("weak_remote_evidence") ||
    text.includes("no_normalized_geo_or_explicit_remote");
}

function isParserAttentionErrorType(errorType) {
  return PARSER_ATTENTION_ERROR_TYPES.includes(errorType) ||
    LEGACY_PARSER_ATTENTION_ERROR_TYPES.includes(errorType);
}

function isSourceQualityParserValidation(errorType, errorMessage) {
  const type = String(errorType || "unknown").trim().toLowerCase() || "unknown";
  return isSourceQualityValidationMessage(errorMessage) &&
    (type === "parser_validation" || LEGACY_PARSER_ATTENTION_ERROR_TYPES.includes(type));
}

function isParserAttentionError(errorType, errorMessage = "") {
  if (isSourceQualityParserValidation(errorType, errorMessage)) return false;
  return isParserAttentionErrorType(String(errorType || "unknown").trim().toLowerCase() || "unknown");
}

function classifyFailureReason(errorType, httpStatus = 0, errorMessage = "") {
  const type = String(errorType || "unknown").trim().toLowerCase() || "unknown";
  const message = String(errorMessage || "").trim().toLowerCase();
  const status = normalizeHttpStatus(httpStatus) || extractHttpStatusFromMessage(message);
  if (status === 429 || RATE_LIMIT_ERROR_TYPES.includes(type)) return "rate_limit";
  if (isSourceQualityParserValidation(type, errorMessage)) return "source_quality";
  if (type === "unknown" && isSourceQualityValidationMessage(errorMessage)) return "source_quality";
  if (message.includes("no parseable postings") || message.includes("no parseable jobs") || message.includes("no jobs")) {
    return "empty_no_jobs";
  }
  if (message.includes("parser drift") || message.includes("payload shape similarity")) return "parser_bug";
  if (isParserAttentionErrorType(type) || type.startsWith("parser_")) return "parser_bug";
  if (SOURCE_QUALITY_ERROR_TYPES.includes(type)) return "source_quality";
  if (EMPTY_NO_JOBS_ERROR_TYPES.includes(type)) return "empty_no_jobs";
  if (status === 404 || status === 410) return "source_quality";
  if (AUTH_ERROR_TYPES.includes(type) || status === 401 || status === 403) return "auth";
  if (NETWORK_ERROR_TYPES.includes(type) || status >= 500) return "network";
  return "unknown";
}

function createFailureReasonCounts() {
  const counts = {};
  for (const bucket of FAILURE_REASON_BUCKETS) counts[bucket] = 0;
  return counts;
}

function addFailureReasonCount(counts, reason, count) {
  if (!counts || !reason) return;
  counts[reason] = Number(counts[reason] || 0) + Number(count || 0);
}

module.exports = {
  AUTH_ERROR_TYPES,
  EMPTY_NO_JOBS_ERROR_TYPES,
  FAILURE_REASON_BUCKETS,
  LEGACY_PARSER_ATTENTION_ERROR_TYPES,
  NETWORK_ERROR_TYPES,
  PARSER_ATTENTION_ERROR_TYPES,
  RATE_LIMIT_ERROR_TYPES,
  SOURCE_POLICY_BLOCK_ERROR_TYPES,
  SOURCE_QUALITY_ERROR_TYPES,
  WORKER_FAILURE_REASON_TAXONOMY,
  addFailureReasonCount,
  classifyFailureReason,
  createFailureReasonCounts,
  extractHttpStatusFromMessage,
  isParserAttentionError,
  isParserAttentionErrorType,
  isSourceQualityParserValidation,
  isSourceQualityValidationMessage,
  normalizeHttpStatus
};
