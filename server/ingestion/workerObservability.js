const { normalizeAtsFilterValue } = require("./atsFilters");
const { normalizeAtsKey } = require("../backends/postgresStore");

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

function sanitizeUrlForLog(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw);
    return `${url.origin}${url.pathname}`;
  } catch {
    return raw.split(/[?#]/)[0].slice(0, 500);
  }
}

function sanitizeLogMessage(value, maxLength = 500) {
  const limit = Math.max(1, Math.floor(Number(maxLength || 500)));
  const text = String(value || "");
  const withoutUrlQueries = text.replace(/https?:\/\/[^\s"'<>]+/gi, (match) => sanitizeUrlForLog(match));
  const withoutTokenPairs = withoutUrlQueries.replace(
    /\b(token|access_token|refresh_token|api_key|apikey|secret|password|email)=([^\s&]+)/gi,
    "$1=[redacted]"
  );
  const withoutMarkupBodies = withoutTokenPairs.replace(/<[^>\n]{1,200}>/g, "[redacted_body]");
  return withoutMarkupBodies.slice(0, limit);
}

function incrementCounterMap(target, key, amount = 1) {
  if (!target) return;
  const normalizedKey = String(key || "unknown").trim().toLowerCase() || "unknown";
  target[normalizedKey] = Number(target[normalizedKey] || 0) + Number(amount || 0);
}

function incrementNestedCounterMap(target, firstKey, secondKey, amount = 1) {
  if (!target) return;
  const normalizedFirst = String(firstKey || "unknown").trim().toLowerCase() || "unknown";
  const normalizedSecond = String(secondKey || "unknown").trim().toLowerCase() || "unknown";
  if (!target[normalizedFirst]) target[normalizedFirst] = {};
  incrementCounterMap(target[normalizedFirst], normalizedSecond, amount);
}

function sourceKeyForObservability(value) {
  return normalizeAtsKey(String(value || "unknown").trim() || "unknown");
}

function normalizeFailureReason(value, fallback = "network") {
  const reason = String(value || "").trim().toLowerCase();
  if (!reason) return fallback;
  if (WORKER_FAILURE_REASON_TAXONOMY.includes(reason)) return reason;
  return reason.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || fallback;
}

function extractHttpStatus(error) {
  const explicit = Number(error?.status || error?.statusCode || error?.httpStatus || error?.response?.status || 0);
  if (Number.isFinite(explicit) && explicit >= 100 && explicit <= 599) return explicit;
  const match = String(error?.message || error || "").match(/\b([1-5][0-9]{2})\b/);
  const parsed = match ? Number(match[1]) : 0;
  return Number.isFinite(parsed) && parsed >= 100 && parsed <= 599 ? parsed : null;
}

function classifyIngestionError(error, fallback = "network") {
  const explicit = String(error?.ingestionErrorType || error?.errorType || "").trim();
  const message = String(error?.message || error || "").toLowerCase();
  const code = String(error?.code || "").toUpperCase();
  const httpStatus = extractHttpStatus(error);
  if (explicit) {
    const normalizedExplicit = normalizeFailureReason(explicit, fallback);
    if (WORKER_FAILURE_REASON_TAXONOMY.includes(normalizedExplicit)) return normalizedExplicit;
    if (normalizedExplicit === "parser_drift" || normalizedExplicit === "parser_quarantine" || normalizedExplicit === "parser_normalize") {
      return "parser_validation";
    }
    if (normalizedExplicit === "parser_parse") return "invalid_shape";
    if (normalizedExplicit === "blocked_or_rate_limited") return "rate_limit";
    if (normalizedExplicit === "portal_search_empty") return "no_jobs";
    if (normalizedExplicit === "output_empty") return "empty_payload";
    if (normalizedExplicit === "fetch") {
      if (httpStatus === 429) return "rate_limit";
      if (httpStatus === 401 || httpStatus === 403) return "auth";
      if (httpStatus === 404 || httpStatus === 410) return "source_quality";
      if (httpStatus === 408) return "timeout";
      if (httpStatus >= 500) return "network";
    }
    return explicit;
  }
  if (message.includes("source_disabled_by_threshold")) return "source_disabled_by_threshold";
  if (message.includes("source_auto_disabled") || message.includes("source_quarantine_only")) {
    return "source_quality";
  }
  if (message.includes("cooldown")) return "cooldown";
  if (httpStatus === 429 || message.includes("rate limit") || message.includes("too many request")) return "rate_limit";
  if (httpStatus === 401 || httpStatus === 403 || message.includes("unauthorized") || message.includes("forbidden")) return "auth";
  if (httpStatus === 404 || httpStatus === 410) return "source_quality";
  if (httpStatus === 408 || code === "ETIMEDOUT" || message.includes("timeout") || message.includes("timed out")) return "timeout";
  if (["ECONNRESET", "ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN"].includes(code) ||
    message.includes("request failed") ||
    message.includes("fetch failed") ||
    message.includes("network") ||
    message.includes("connection") ||
    httpStatus >= 500) {
    return "network";
  }
  if (message.includes("empty payload") || message.includes("blank payload") || message.includes("output_empty")) return "empty_payload";
  if (message.includes("no parseable postings") || message.includes("no jobs") || message.includes("portal_search_empty")) return "no_jobs";
  if (message.includes("unexpected token") || message.includes("invalid shape") || message.includes("malformed") || message.includes("json")) {
    return "invalid_shape";
  }
  if (message.includes("no_geo_no_remote") || message.includes("ambiguous_location") || message.includes("weak_remote_evidence")) {
    return "parser_validation";
  }
  if (message.includes("missing ") || message.includes("placeholder ") || message.includes("invalid job_posting_url")) {
    return "parser_validation";
  }
  return fallback;
}

function incrementHttpStatusCount(counters, httpStatus) {
  const status = Number(httpStatus || 0);
  if (!Number.isFinite(status) || status < 100 || status > 599) return;
  const key = String(status);
  counters.httpStatusCounts = counters.httpStatusCounts || {};
  counters.httpStatusCounts[key] = Number(counters.httpStatusCounts[key] || 0) + 1;
  const family = `${Math.floor(status / 100)}xx`;
  counters.httpStatusFamilyCounts = counters.httpStatusFamilyCounts || {};
  counters.httpStatusFamilyCounts[family] = Number(counters.httpStatusFamilyCounts[family] || 0) + 1;
}

function incrementDbBusyCount(counters) {
  if (!counters) return;
  counters.dbBusyCount = Number(counters.dbBusyCount || 0) + 1;
}

function createRunCounters() {
  return {
    successCount: 0,
    failureCount: 0,
    cacheHitCount: 0,
    cacheWriteCount: 0,
    postingUpsertCount: 0,
    rejectedCount: 0,
    quarantinedCount: 0,
    duplicateCount: 0,
    dbBusyCount: 0,
    httpStatusCounts: {},
    httpStatusFamilyCounts: {},
    dueByAts: {},
    selectedByAts: {},
    adaptiveSourceSelectionByAts: {},
    skippedByReason: {},
    skippedByAtsAndReason: {},
    successByReason: {},
    successByAts: {},
    failureByReason: {},
    failureByAts: {},
    failureByAtsAndReason: {},
    failureReasonTaxonomy: [...WORKER_FAILURE_REASON_TAXONOMY],
    lastError: ""
  };
}

function recordDueTargetsByAts(counters, rows = []) {
  if (!counters) return;
  counters.dueByAts = counters.dueByAts || {};
  for (const row of Array.isArray(rows) ? rows : []) {
    const atsKey = sourceKeyForObservability(row?.ats_key || row?.atsKey);
    const count = Number(row?.due_count ?? row?.count ?? row?.due ?? 0);
    if (count > 0) incrementCounterMap(counters.dueByAts, atsKey, count);
  }
}

function recordSelectedTarget(counters, target) {
  if (!counters) return;
  counters.selectedByAts = counters.selectedByAts || {};
  incrementCounterMap(counters.selectedByAts, sourceKeyForObservability(target?.atsKey || target?.ats_key));
}

function recordAdaptiveSourceDecision(counters, atsKey, decision) {
  if (!counters || !decision) return;
  const key = sourceKeyForObservability(atsKey || decision.ats_key);
  counters.adaptiveSourceSelectionByAts = counters.adaptiveSourceSelectionByAts || {};
  counters.adaptiveSourceSelectionByAts[key] = {
    lane: String(decision.lane || "healthy"),
    maxTargetsPerRun: Number(decision.maxTargetsPerRun || 0),
    dueCount: Number(decision.due_count || 0),
    recentAttemptCount: Number(decision.recent_attempt_count || 0),
    successRatePct: decision.success_rate_pct == null ? null : Number(decision.success_rate_pct),
    reasons: Array.isArray(decision.reasons) ? decision.reasons.slice(0, 6) : []
  };
}

function recordSkippedTarget(counters, targetOrAtsKey, reason = "unknown") {
  if (!counters) return;
  const atsKey = sourceKeyForObservability(
    typeof targetOrAtsKey === "string" ? targetOrAtsKey : targetOrAtsKey?.atsKey || targetOrAtsKey?.ats_key
  );
  const normalizedReason = normalizeFailureReason(reason, "unknown");
  counters.skippedByReason = counters.skippedByReason || {};
  counters.skippedByAtsAndReason = counters.skippedByAtsAndReason || {};
  incrementCounterMap(counters.skippedByReason, normalizedReason);
  incrementNestedCounterMap(counters.skippedByAtsAndReason, atsKey, normalizedReason);
}

function recordFailureReason(counters, target, reason) {
  if (!counters) return;
  const atsKey = sourceKeyForObservability(target?.atsKey || target?.ats_key);
  const normalizedReason = reason instanceof Error || typeof reason === "object"
    ? classifyIngestionError(reason)
    : normalizeFailureReason(reason, "network");
  counters.failureByReason = counters.failureByReason || {};
  counters.failureByAts = counters.failureByAts || {};
  counters.failureByAtsAndReason = counters.failureByAtsAndReason || {};
  incrementCounterMap(counters.failureByReason, normalizedReason);
  incrementCounterMap(counters.failureByAts, atsKey);
  incrementNestedCounterMap(counters.failureByAtsAndReason, atsKey, normalizedReason);
}

function recordTargetOutcome(counters, target, outcome, reason = "ok") {
  if (!counters) return;
  const atsKey = sourceKeyForObservability(target?.atsKey || target?.ats_key);
  const outcomeKey = String(outcome || "").trim().toLowerCase();
  if (outcomeKey === "success") {
    const normalizedReason = normalizeFailureReason(reason, "ok");
    counters.successByReason = counters.successByReason || {};
    counters.successByAts = counters.successByAts || {};
    incrementCounterMap(counters.successByReason, normalizedReason);
    incrementCounterMap(counters.successByAts, atsKey);
    return;
  }
  recordFailureReason(counters, target, reason);
}

function dedupeValidPosting(posting, seenCanonicalUrls, counters) {
  const canonicalUrl = String(posting?.canonical_url || posting?.job_posting_url || "").trim();
  if (!canonicalUrl) return true;
  if (seenCanonicalUrls.has(canonicalUrl)) {
    counters.duplicateCount += 1;
    return false;
  }
  seenCanonicalUrls.add(canonicalUrl);
  return true;
}

module.exports = {
  WORKER_FAILURE_REASON_TAXONOMY,
  sanitizeUrlForLog,
  sanitizeLogMessage,
  incrementCounterMap,
  incrementNestedCounterMap,
  sourceKeyForObservability,
  normalizeFailureReason,
  extractHttpStatus,
  classifyIngestionError,
  incrementHttpStatusCount,
  incrementDbBusyCount,
  createRunCounters,
  recordDueTargetsByAts,
  recordSelectedTarget,
  recordAdaptiveSourceDecision,
  recordSkippedTarget,
  recordFailureReason,
  recordTargetOutcome,
  dedupeValidPosting
};
