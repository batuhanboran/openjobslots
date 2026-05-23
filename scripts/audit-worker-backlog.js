const fs = require("fs");
const path = require("path");
const { createPostgresPool } = require("../server/backends/postgres");
const { readWorkerBudgetConfig } = require("../server/ingestion/workerConfig");

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
  "invalid_shape"
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

function parseBacklogArgs(argv = process.argv.slice(2)) {
  const options = {
    diagnostics: false,
    errorWindowHours: 24,
    json: false,
    limit: 100,
    output: "",
    nowEpoch: 0,
    recentRunLimit: 20,
    targetAtsKeys: [],
    probeEmptyTargets: false,
    probeEmptyTargetLimit: 10,
    probeEmptyTargetTimeoutMs: 12000
  };
  for (const arg of argv) {
    if (arg === "--json") options.json = true;
    else if (arg === "--diagnostics") options.diagnostics = true;
    else if (arg.startsWith("--targets=")) options.targetAtsKeys = parseTargetAtsKeys(arg.slice("--targets=".length));
    else if (arg.startsWith("--sources=")) options.targetAtsKeys = parseTargetAtsKeys(arg.slice("--sources=".length));
    else if (arg === "--targets") options.expectTargets = true;
    else if (arg === "--sources") options.expectTargets = true;
    else if (arg.startsWith("--error-window-hours=")) options.errorWindowHours = Number(arg.slice("--error-window-hours=".length));
    else if (arg === "--error-window-hours") options.expectErrorWindowHours = true;
    else if (arg.startsWith("--limit=")) options.limit = Number(arg.slice("--limit=".length));
    else if (arg === "--limit") options.expectLimit = true;
    else if (arg.startsWith("--recent-run-limit=")) options.recentRunLimit = Number(arg.slice("--recent-run-limit=".length));
    else if (arg === "--recent-run-limit") options.expectRecentRunLimit = true;
    else if (arg === "--probe-empty-targets") options.probeEmptyTargets = true;
    else if (arg.startsWith("--probe-empty-target-limit=")) {
      options.probeEmptyTargets = true;
      options.probeEmptyTargetLimit = Number(arg.slice("--probe-empty-target-limit=".length));
    } else if (arg === "--probe-empty-target-limit") {
      options.probeEmptyTargets = true;
      options.expectProbeEmptyTargetLimit = true;
    } else if (arg.startsWith("--probe-empty-target-timeout-ms=")) {
      options.probeEmptyTargets = true;
      options.probeEmptyTargetTimeoutMs = Number(arg.slice("--probe-empty-target-timeout-ms=".length));
    } else if (arg === "--probe-empty-target-timeout-ms") {
      options.probeEmptyTargets = true;
      options.expectProbeEmptyTargetTimeoutMs = true;
    }
    else if (arg.startsWith("--now-epoch=")) options.nowEpoch = Number(arg.slice("--now-epoch=".length));
    else if (arg === "--now-epoch") options.expectNowEpoch = true;
    else if (arg.startsWith("--output=")) options.output = arg.slice("--output=".length);
    else if (options.expectLimit) {
      options.limit = Number(arg);
      options.expectLimit = false;
    } else if (options.expectRecentRunLimit) {
      options.recentRunLimit = Number(arg);
      options.expectRecentRunLimit = false;
    } else if (options.expectProbeEmptyTargetLimit) {
      options.probeEmptyTargetLimit = Number(arg);
      options.expectProbeEmptyTargetLimit = false;
    } else if (options.expectProbeEmptyTargetTimeoutMs) {
      options.probeEmptyTargetTimeoutMs = Number(arg);
      options.expectProbeEmptyTargetTimeoutMs = false;
    } else if (options.expectNowEpoch) {
      options.nowEpoch = Number(arg);
      options.expectNowEpoch = false;
    } else if (options.expectErrorWindowHours) {
      options.errorWindowHours = Number(arg);
      options.expectErrorWindowHours = false;
    } else if (options.expectTargets) {
      options.targetAtsKeys = parseTargetAtsKeys(arg);
      options.expectTargets = false;
    }
  }
  options.limit = Math.max(1, Math.min(500, Math.floor(Number(options.limit || 100))));
  options.recentRunLimit = Math.max(1, Math.min(100, Math.floor(Number(options.recentRunLimit || 20))));
  options.probeEmptyTargetLimit = Math.max(1, Math.min(50, Math.floor(Number(options.probeEmptyTargetLimit || 10))));
  options.probeEmptyTargetTimeoutMs = Math.max(1000, Math.min(30000, Math.floor(Number(options.probeEmptyTargetTimeoutMs || 12000))));
  options.nowEpoch = Math.max(0, Math.floor(Number(options.nowEpoch || 0)));
  options.errorWindowHours = Math.max(1, Math.min(168, Math.floor(Number(options.errorWindowHours || 24))));
  return options;
}

function parseTargetAtsKeys(value = "") {
  return String(value || "")
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean)
    .filter((part, index, list) => list.indexOf(part) === index);
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return fallback;
  return Math.floor(number);
}

function nonNegativeInteger(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return fallback;
  return Math.floor(number);
}

function epochToIso(epoch) {
  const value = Number(epoch || 0);
  return value > 0 ? new Date(value * 1000).toISOString() : "";
}

function startOfUtcDayEpoch(epoch) {
  const value = Math.max(0, Math.floor(Number(epoch || 0)));
  return Math.floor(value / 86400) * 86400;
}

function createImpactSummary() {
  return {
    source_count: 0,
    target_count: 0,
    due_count: 0,
    runnable_due_count: 0,
    failure_pressure: 0,
    sources: []
  };
}

function addImpactSource(impact, item) {
  if (!impact || !item) return;
  impact.source_count += 1;
  impact.target_count += Number(item.target_count || 0);
  impact.due_count += Number(item.due_count || 0);
  impact.runnable_due_count += Number(item.runnable_due_count || 0);
  impact.failure_pressure += Number(item.failure_pressure || 0);
  impact.sources.push(item.ats_key);
}

function buildEstimatedDaysByBudget(runnableDueCount, budgets = []) {
  const output = {};
  for (const budget of budgets) {
    const normalized = nonNegativeInteger(budget, 0);
    if (normalized <= 0) continue;
    output[String(normalized)] = Math.ceil(Number(runnableDueCount || 0) / normalized);
  }
  return output;
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

function cloneFailureReasonCounts(counts = {}) {
  const cloned = createFailureReasonCounts();
  for (const bucket of FAILURE_REASON_BUCKETS) {
    cloned[bucket] = Number(counts?.[bucket] || 0);
  }
  return cloned;
}

function sumFailureReasonCounts(counts = {}) {
  return FAILURE_REASON_BUCKETS.reduce((sum, bucket) => sum + Number(counts?.[bucket] || 0), 0);
}

function addFailureReasonCount(counts, reason, count) {
  if (!counts || !reason) return;
  counts[reason] = Number(counts[reason] || 0) + Number(count || 0);
}

function adjustFailureReasonCountsForParserDriftRecheck(counts = {}, parserDriftRecheck = {}) {
  const adjusted = cloneFailureReasonCounts(counts);
  const parserBugCount = Math.max(0, Number(adjusted.parser_bug || 0));
  const emptyNoJobsResolvedCount = Math.max(0, Number(parserDriftRecheck?.current_policy_empty_no_jobs_count || 0));
  const currentPolicyPassCount = Math.max(0, Number(parserDriftRecheck?.current_policy_pass_count || 0));
  const parserBugToEmptyNoJobs = Math.min(parserBugCount, emptyNoJobsResolvedCount);
  const parserBugAfterEmptyNoJobs = Math.max(0, parserBugCount - parserBugToEmptyNoJobs);
  const parserBugToCurrentPolicyPass = Math.min(parserBugAfterEmptyNoJobs, currentPolicyPassCount);
  const parserBugResolvedTotal = parserBugToEmptyNoJobs + parserBugToCurrentPolicyPass;

  adjusted.parser_bug = Math.max(0, parserBugCount - parserBugResolvedTotal);
  adjusted.empty_no_jobs = Number(adjusted.empty_no_jobs || 0) + parserBugToEmptyNoJobs;

  return {
    counts: adjusted,
    adjustments: {
      parser_bug_to_current_policy_pass: parserBugToCurrentPolicyPass,
      parser_bug_to_empty_no_jobs: parserBugToEmptyNoJobs,
      parser_bug_resolved_total: parserBugResolvedTotal
    }
  };
}

function adjustFailureReasonCountsByScopeForParserDriftRecheck(countsByScope = {}, parserDriftRecheck = {}) {
  const targetFailure = adjustFailureReasonCountsForParserDriftRecheck(
    countsByScope?.target_failure || {},
    parserDriftRecheck
  );
  const postingRejection = cloneFailureReasonCounts(countsByScope?.posting_rejection || {});
  const unknown = cloneFailureReasonCounts(countsByScope?.unknown || {});
  return {
    target_failure: targetFailure.counts,
    posting_rejection: postingRejection,
    unknown,
    total: {
      target_failure_count: sumFailureReasonCounts(targetFailure.counts),
      posting_rejection_count: sumFailureReasonCounts(postingRejection),
      unknown_count: sumFailureReasonCounts(unknown)
    },
    adjustments: {
      target_failure: targetFailure.adjustments
    }
  };
}

function buildWorkerBacklogQuery(options = {}) {
  const nowEpoch = Math.max(0, Math.floor(Number(options.nowEpoch || Math.floor(Date.now() / 1000))));
  const limit = Math.max(1, Math.min(500, Math.floor(Number(options.limit || 100))));
  const targetAtsKeys = Array.isArray(options.targetAtsKeys) ? options.targetAtsKeys : [];
  return {
    values: [nowEpoch, limit, targetAtsKeys],
    sql: `
      WITH target_state AS (
        SELECT
          c.ats_key,
          c.url_string,
          c.company_name,
          COALESCE(st.next_sync_epoch, 0)::bigint AS next_sync_epoch,
          COALESCE(st.last_success_epoch, 0)::bigint AS last_success_epoch,
          COALESCE(st.last_failure_epoch, 0)::bigint AS last_failure_epoch,
          COALESCE(st.consecutive_failures, 0)::bigint AS consecutive_failures
        FROM companies c
        LEFT JOIN company_sync_state st
          ON st.ats_key = c.ats_key
          AND st.company_url = c.url_string
      )
      SELECT
        s.ats_key,
        s.display_name,
        s.enabled,
        COALESCE(NULLIF(s.protection_status, ''), 'normal') AS protection_status,
        COALESCE(s.disabled_reason, '') AS disabled_reason,
        COUNT(t.url_string)::int AS target_count,
        COUNT(t.url_string) FILTER (WHERE t.next_sync_epoch <= $1)::int AS due_count,
        COUNT(t.url_string) FILTER (
          WHERE t.next_sync_epoch <= $1
            AND s.enabled = true
            AND COALESCE(NULLIF(s.protection_status, ''), 'normal') NOT IN ('disabled', 'auto_disabled')
        )::int AS runnable_due_count,
        MIN(t.next_sync_epoch) FILTER (WHERE t.next_sync_epoch <= $1)::bigint AS oldest_due_epoch,
        SUM(t.consecutive_failures) FILTER (WHERE t.next_sync_epoch <= $1)::bigint AS failure_pressure,
        COUNT(t.url_string) FILTER (
          WHERE t.next_sync_epoch <= $1
            AND COALESCE(t.consecutive_failures, 0) > 0
        )::int AS failing_due_count,
        MAX(t.last_success_epoch)::bigint AS last_success_epoch,
        MAX(t.last_failure_epoch)::bigint AS last_failure_epoch
      FROM ats_sources s
      LEFT JOIN target_state t
        ON t.ats_key = s.ats_key
      WHERE (
        cardinality($3::text[]) = 0
        OR s.ats_key = ANY($3::text[])
      )
      GROUP BY s.ats_key, s.display_name, s.enabled, s.protection_status, s.disabled_reason
      ORDER BY due_count DESC, failure_pressure DESC, s.ats_key ASC
      LIMIT $2;
    `
  };
}

function buildRecentErrorsQuery(options = {}) {
  const errorWindowHours = Math.max(1, Math.min(168, Math.floor(Number(options.errorWindowHours || 24))));
  const targetAtsKeys = Array.isArray(options.targetAtsKeys) ? options.targetAtsKeys : [];
  return {
    values: [errorWindowHours, targetAtsKeys],
    sql: `
      SELECT
        ats_key,
        error_type,
        COALESCE(http_status, 0)::int AS http_status,
        COALESCE(error_message, '') AS error_message,
        COUNT(*)::int AS count
      FROM ingestion_run_errors
      WHERE created_at >= now() - ($1::int * interval '1 hour')
        AND (
          cardinality($2::text[]) = 0
          OR ats_key = ANY($2::text[])
        )
      GROUP BY ats_key, error_type, http_status, error_message
      ORDER BY count DESC, ats_key ASC, error_type ASC, http_status ASC, error_message ASC;
    `
  };
}

function buildRecentErrorScopeQuery(options = {}) {
  const errorWindowHours = Math.max(1, Math.min(168, Math.floor(Number(options.errorWindowHours || 24))));
  const targetAtsKeys = Array.isArray(options.targetAtsKeys) ? options.targetAtsKeys : [];
  return {
    values: [errorWindowHours, targetAtsKeys],
    sql: `
      WITH scoped_errors AS (
        SELECT
          e.ats_key,
          CASE WHEN st.last_success_epoch >= r.started_at_epoch
              AND st.last_success_epoch <= COALESCE(r.finished_at_epoch, EXTRACT(EPOCH FROM now())::bigint)
            THEN 'posting_rejection'
            ELSE 'target_failure'
          END AS error_scope,
          e.error_type,
          COALESCE(e.http_status, 0)::int AS http_status,
          COALESCE(e.error_message, '') AS error_message,
          COUNT(*)::int AS count
        FROM ingestion_run_errors e
        LEFT JOIN ingestion_runs r
          ON r.id = e.run_id
        LEFT JOIN company_sync_state st
          ON st.ats_key = e.ats_key
          AND st.company_url = e.company_url
        WHERE e.created_at >= now() - ($1::int * interval '1 hour')
          AND (
            cardinality($2::text[]) = 0
            OR e.ats_key = ANY($2::text[])
          )
        GROUP BY e.ats_key, error_scope, e.error_type, COALESCE(e.http_status, 0), e.error_message
      )
      SELECT *
      FROM scoped_errors
      ORDER BY count DESC, ats_key ASC, error_scope ASC, error_type ASC, http_status ASC, error_message ASC;
    `
  };
}

function buildLatestRunSummaryQuery() {
  return {
    values: [],
    sql: `
      SELECT
        id,
        status,
        started_at_epoch,
        finished_at_epoch,
        total_targets,
        success_count,
        failure_count
      FROM ingestion_runs
      ORDER BY id DESC
      LIMIT 1;
    `
  };
}

function buildRecentRunTrendQuery(options = {}) {
  const limit = Math.max(1, Math.min(100, Math.floor(Number(options.recentRunLimit || 20))));
  const targetAtsKeys = Array.isArray(options.targetAtsKeys) ? options.targetAtsKeys : [];
  return {
    values: [limit, targetAtsKeys],
    sql: `
      WITH recent_runs AS (
        SELECT
          id,
          status,
          started_at_epoch,
          finished_at_epoch,
          total_targets,
          success_count,
          failure_count,
          active_ats
        FROM ingestion_runs
        WHERE (
          cardinality($2::text[]) = 0
          OR active_ats ?| $2::text[]
        )
        ORDER BY id DESC
        LIMIT $1
      )
      SELECT *
      FROM recent_runs
      ORDER BY id DESC;
    `
  };
}

function buildRecentRunTrendBySourceQuery(options = {}) {
  const limit = Math.max(1, Math.min(100, Math.floor(Number(options.recentRunLimit || 20))));
  const targetAtsKeys = Array.isArray(options.targetAtsKeys) ? options.targetAtsKeys : [];
  return {
    values: [limit, targetAtsKeys],
    sql: `
      WITH recent_runs AS (
        SELECT
          id,
          status,
          started_at_epoch,
          COALESCE(finished_at_epoch, EXTRACT(EPOCH FROM now())::bigint) AS finished_at_epoch,
          active_ats
        FROM ingestion_runs
        WHERE (
          cardinality($2::text[]) = 0
          OR active_ats ?| $2::text[]
        )
        ORDER BY id DESC
        LIMIT $1
      ),
      successes AS (
        SELECT
          r.id AS run_id,
          st.ats_key,
          COUNT(*)::int AS success_count
        FROM recent_runs r
        JOIN company_sync_state st
          ON st.last_success_epoch >= r.started_at_epoch
          AND st.last_success_epoch <= r.finished_at_epoch
        WHERE (
          cardinality($2::text[]) = 0
          OR st.ats_key = ANY($2::text[])
        )
        GROUP BY r.id, st.ats_key
      ),
      failures AS (
        SELECT
          r.id AS run_id,
          e.ats_key,
          COUNT(DISTINCT COALESCE(NULLIF(e.company_url, ''), e.id::text))::int AS failure_count
        FROM recent_runs r
        JOIN ingestion_run_errors e
          ON e.run_id = r.id
        WHERE (
          cardinality($2::text[]) = 0
          OR e.ats_key = ANY($2::text[])
        )
        GROUP BY r.id, e.ats_key
      ),
      by_run AS (
        SELECT
          COALESCE(s.run_id, f.run_id)::bigint AS run_id,
          COALESCE(s.ats_key, f.ats_key) AS ats_key,
          COALESCE(s.success_count, 0)::int AS success_count,
          COALESCE(f.failure_count, 0)::int AS failure_count
        FROM successes s
        FULL OUTER JOIN failures f
          ON f.run_id = s.run_id
          AND f.ats_key = s.ats_key
      )
      SELECT
        b.run_id,
        r.status,
        r.started_at_epoch,
        r.finished_at_epoch,
        b.ats_key,
        b.success_count,
        b.failure_count,
        (b.success_count + b.failure_count)::int AS total_targets
      FROM by_run b
      JOIN recent_runs r
        ON r.id = b.run_id
      ORDER BY b.ats_key ASC, b.run_id DESC;
    `
  };
}

function buildLatestRunBySourceQuery(options = {}) {
  const targetAtsKeys = Array.isArray(options.targetAtsKeys) ? options.targetAtsKeys : [];
  return {
    values: [targetAtsKeys],
    sql: `
      WITH latest AS (
        SELECT
          id,
          started_at_epoch,
          COALESCE(finished_at_epoch, EXTRACT(EPOCH FROM now())::bigint) AS finished_at_epoch
        FROM ingestion_runs
        ORDER BY id DESC
        LIMIT 1
      ),
      successes AS (
        SELECT
          l.id AS latest_run_id,
          st.ats_key,
          COUNT(*)::int AS success_count
        FROM company_sync_state st
        JOIN latest l
          ON st.last_success_epoch >= l.started_at_epoch
          AND st.last_success_epoch <= l.finished_at_epoch
        WHERE (
          cardinality($1::text[]) = 0
          OR st.ats_key = ANY($1::text[])
        )
        GROUP BY l.id, st.ats_key
      ),
      failures AS (
        SELECT
          l.id AS latest_run_id,
          e.ats_key,
          COUNT(DISTINCT COALESCE(NULLIF(e.company_url, ''), e.id::text))::int AS failure_count
        FROM ingestion_run_errors e
        JOIN latest l
          ON e.run_id = l.id
        WHERE (
          cardinality($1::text[]) = 0
          OR e.ats_key = ANY($1::text[])
        )
        GROUP BY l.id, e.ats_key
      )
      SELECT
        COALESCE(s.latest_run_id, f.latest_run_id)::bigint AS latest_run_id,
        COALESCE(s.ats_key, f.ats_key) AS ats_key,
        COALESCE(s.success_count, 0)::int AS success_count,
        COALESCE(f.failure_count, 0)::int AS failure_count
      FROM successes s
      FULL OUTER JOIN failures f
        ON f.latest_run_id = s.latest_run_id
        AND f.ats_key = s.ats_key
      ORDER BY ats_key ASC;
    `
  };
}

function buildLatestRunFailureReasonsQuery(options = {}) {
  const targetAtsKeys = Array.isArray(options.targetAtsKeys) ? options.targetAtsKeys : [];
  return {
    values: [targetAtsKeys],
    sql: `
      WITH latest AS (
        SELECT id
        FROM ingestion_runs
        ORDER BY id DESC
        LIMIT 1
      )
      SELECT
        e.ats_key,
        e.error_type,
        COALESCE(e.http_status, 0)::int AS http_status,
        COALESCE(e.error_message, '') AS error_message,
        COUNT(*)::int AS count
      FROM ingestion_run_errors e
      JOIN latest l
        ON e.run_id = l.id
      WHERE (
        cardinality($1::text[]) = 0
        OR e.ats_key = ANY($1::text[])
      )
      GROUP BY e.ats_key, e.error_type, COALESCE(e.http_status, 0), e.error_message
      ORDER BY count DESC, e.ats_key ASC, e.error_type ASC, http_status ASC, error_message ASC;
    `
  };
}

function buildAutoSyncBudgetUsageQuery(options = {}) {
  const nowEpoch = Math.max(0, Math.floor(Number(options.nowEpoch || Math.floor(Date.now() / 1000))));
  const dayStartEpoch = startOfUtcDayEpoch(nowEpoch);
  return {
    values: [dayStartEpoch],
    sql: `
      SELECT COALESCE(SUM(total_targets), 0)::int AS targets_started_today
      FROM ingestion_runs
      WHERE started_at_epoch >= $1;
    `
  };
}

function buildSourceBudgetUsageQuery(options = {}) {
  const nowEpoch = Math.max(0, Math.floor(Number(options.nowEpoch || Math.floor(Date.now() / 1000))));
  const dayStartEpoch = startOfUtcDayEpoch(nowEpoch);
  return {
    values: [dayStartEpoch],
    sql: `
      SELECT
        ats_key,
        COUNT(*)::int AS successful_targets_today
      FROM company_sync_state
      WHERE last_success_epoch >= $1
      GROUP BY ats_key
      ORDER BY ats_key ASC;
    `
  };
}

function buildTargetFailurePressureQuery(options = {}) {
  const nowEpoch = Math.max(0, Math.floor(Number(options.nowEpoch || Math.floor(Date.now() / 1000))));
  const errorWindowHours = Math.max(1, Math.min(168, Math.floor(Number(options.errorWindowHours || 24))));
  const targetAtsKeys = Array.isArray(options.targetAtsKeys) ? options.targetAtsKeys : [];
  return {
    values: [nowEpoch, errorWindowHours, targetAtsKeys],
    sql: `
      WITH due_targets AS (
        SELECT
          c.ats_key,
          c.url_string AS company_url,
          c.company_name,
          COALESCE(EXTRACT(EPOCH FROM c.created_at)::bigint, 0)::bigint AS company_created_at_epoch,
          COALESCE(NULLIF(s.protection_status, ''), 'normal') AS protection_status,
          COALESCE(st.next_sync_epoch, 0)::bigint AS next_sync_epoch,
          COALESCE(st.last_success_epoch, 0)::bigint AS last_success_epoch,
          COALESCE(st.last_failure_epoch, 0)::bigint AS last_failure_epoch,
          COALESCE(st.consecutive_failures, 0)::bigint AS consecutive_failures,
          COALESCE(st.last_http_status, 0)::int AS last_http_status,
          COALESCE(st.last_error, '') AS last_error
        FROM companies c
        INNER JOIN ats_sources s
          ON s.ats_key = c.ats_key
        LEFT JOIN company_sync_state st
          ON st.ats_key = c.ats_key
          AND st.company_url = c.url_string
        WHERE s.enabled = true
          AND COALESCE(NULLIF(s.protection_status, ''), 'normal') NOT IN ('disabled', 'auto_disabled')
          AND COALESCE(st.next_sync_epoch, 0) <= $1
          AND (
            cardinality($3::text[]) = 0
            OR c.ats_key = ANY($3::text[])
          )
      ),
      recent_error_groups AS (
        SELECT
          e.ats_key,
          e.company_url,
          e.error_type,
          COALESCE(e.http_status, 0)::int AS http_status,
          COALESCE(e.error_message, '') AS error_message,
          COUNT(*)::int AS count
        FROM ingestion_run_errors e
        LEFT JOIN ingestion_runs r
          ON r.id = e.run_id
        LEFT JOIN company_sync_state error_state
          ON error_state.ats_key = e.ats_key
          AND error_state.company_url = e.company_url
        WHERE e.created_at >= now() - ($2::int * interval '1 hour')
          AND COALESCE(e.company_url, '') <> ''
          AND (
            r.id IS NULL
            OR error_state.last_success_epoch IS NULL
            OR error_state.last_success_epoch < r.started_at_epoch
            OR error_state.last_success_epoch > COALESCE(r.finished_at_epoch, EXTRACT(EPOCH FROM now())::bigint)
          )
          AND (
            cardinality($3::text[]) = 0
            OR e.ats_key = ANY($3::text[])
          )
        GROUP BY e.ats_key, e.company_url, e.error_type, COALESCE(e.http_status, 0), e.error_message
      ),
      recent_target_errors AS (
        SELECT
          ats_key,
          company_url,
          COALESCE(SUM(count), 0)::int AS recent_error_count,
          jsonb_agg(
            jsonb_build_object(
              'error_type', error_type,
              'http_status', http_status,
              'error_message', error_message,
              'count', count
            )
            ORDER BY count DESC, error_type ASC, http_status ASC, error_message ASC
          ) AS recent_error_groups
        FROM recent_error_groups
        GROUP BY ats_key, company_url
      )
      SELECT
        d.ats_key,
        d.company_url,
        d.company_name,
        d.company_created_at_epoch,
        d.protection_status,
        d.next_sync_epoch,
        d.last_success_epoch,
        d.last_failure_epoch,
        d.consecutive_failures,
        d.last_http_status,
        d.last_error,
        COALESCE(r.recent_error_count, 0)::int AS recent_error_count,
        COALESCE(r.recent_error_groups, '[]'::jsonb) AS recent_error_groups
      FROM due_targets d
      LEFT JOIN recent_target_errors r
        ON r.ats_key = d.ats_key
        AND r.company_url = d.company_url
      WHERE d.consecutive_failures > 0
        OR COALESCE(r.recent_error_count, 0) > 0
      ORDER BY d.consecutive_failures DESC,
        COALESCE(r.recent_error_count, 0) DESC,
        d.last_failure_epoch DESC,
        d.ats_key ASC,
        d.company_name ASC,
        d.company_url ASC;
    `
  };
}

function buildParserDriftRecheckQuery(options = {}) {
  const errorWindowHours = Math.max(1, Math.min(168, Math.floor(Number(options.errorWindowHours || 24))));
  const targetAtsKeys = Array.isArray(options.targetAtsKeys) ? options.targetAtsKeys : [];
  const limit = Math.max(1, Math.min(500, Math.floor(Number(options.parserDriftRecheckLimit || 100))));
  return {
    values: [errorWindowHours, targetAtsKeys, limit],
    sql: `
      SELECT
        e.ats_key,
        e.parser_version,
        e.similarity AS stored_similarity,
        e.reason,
        e.shape_paths AS observed_shape_paths,
        s.shape_paths AS baseline_shape_paths
      FROM parser_drift_events e
      LEFT JOIN source_payload_shapes s
        ON s.ats_key = e.ats_key
        AND s.parser_version = e.parser_version
      WHERE e.created_at >= now() - ($1::int * interval '1 hour')
        AND (
          cardinality($2::text[]) = 0
          OR e.ats_key = ANY($2::text[])
        )
      ORDER BY e.created_at DESC
      LIMIT $3;
    `
  };
}

function createEmptyTotals() {
  return {
    source_count: 0,
    target_count: 0,
    due_count: 0,
    runnable_due_count: 0,
    quarantine_only_due_count: 0,
    auto_disabled_due_count: 0,
    disabled_due_count: 0,
    failure_pressure: 0,
    failing_due_count: 0,
    oldest_due_epoch: 0,
    by_protection_status: {}
  };
}

function normalizeBacklogRow(row = {}) {
  const protectionStatus = String(row.protection_status || "normal").trim() || "normal";
  return {
    ats_key: String(row.ats_key || ""),
    display_name: String(row.display_name || row.ats_key || ""),
    enabled: Boolean(row.enabled),
    protection_status: protectionStatus,
    disabled_reason: String(row.disabled_reason || ""),
    target_count: Number(row.target_count || 0),
    due_count: Number(row.due_count || 0),
    runnable_due_count: Number(row.runnable_due_count || 0),
    oldest_due_epoch: Number(row.oldest_due_epoch || 0),
    failure_pressure: Number(row.failure_pressure || 0),
    failing_due_count: Number(row.failing_due_count || 0),
    last_success_epoch: Number(row.last_success_epoch || 0),
    last_success_at: epochToIso(row.last_success_epoch),
    last_failure_epoch: Number(row.last_failure_epoch || 0),
    last_failure_at: epochToIso(row.last_failure_epoch)
  };
}

function summarizeBacklogRows(rows = [], options = {}) {
  const workerBudgetConfig = readWorkerBudgetConfig(options.env || process.env, options);
  const autoSyncDailyTargetBudget = workerBudgetConfig.autoSyncDailyTargetBudget;
  const autoSyncTargetsPerRun = workerBudgetConfig.autoSyncTargetsPerRun;
  const sourceDailyTargetBudget = workerBudgetConfig.sourceDailyTargetBudget;
  const items = (Array.isArray(rows) ? rows : []).map(normalizeBacklogRow);
  const totals = createEmptyTotals();
  const dueBySource = {};
  const oldestDueBySource = {};
  const failurePressureBySource = {};
  const lastSuccessAtBySource = {};
  const lastFailureAtBySource = {};
  const quarantineOnlyImpact = createImpactSummary();
  const autoDisabledImpact = createImpactSummary();
  for (const item of items) {
    totals.source_count += 1;
    totals.target_count += item.target_count;
    totals.due_count += item.due_count;
    totals.runnable_due_count += item.runnable_due_count;
    totals.failure_pressure += item.failure_pressure;
    totals.failing_due_count += item.failing_due_count;
    totals.by_protection_status[item.protection_status] =
      (totals.by_protection_status[item.protection_status] || 0) + item.due_count;
    if (item.protection_status === "quarantine_only") totals.quarantine_only_due_count += item.due_count;
    if (item.protection_status === "auto_disabled") totals.auto_disabled_due_count += item.due_count;
    if (!item.enabled || item.protection_status === "disabled") totals.disabled_due_count += item.due_count;
    if (item.due_count > 0) dueBySource[item.ats_key] = item.due_count;
    if (item.oldest_due_epoch > 0) oldestDueBySource[item.ats_key] = item.oldest_due_epoch;
    if (item.failure_pressure > 0) failurePressureBySource[item.ats_key] = item.failure_pressure;
    if (item.last_success_at) lastSuccessAtBySource[item.ats_key] = item.last_success_at;
    if (item.last_failure_at) lastFailureAtBySource[item.ats_key] = item.last_failure_at;
    if (item.protection_status === "quarantine_only") addImpactSource(quarantineOnlyImpact, item);
    if (item.protection_status === "auto_disabled") addImpactSource(autoDisabledImpact, item);
    if (item.oldest_due_epoch > 0 && (totals.oldest_due_epoch === 0 || item.oldest_due_epoch < totals.oldest_due_epoch)) {
      totals.oldest_due_epoch = item.oldest_due_epoch;
    }
  }
  const sourceBudgetLimitedDueCount = sourceDailyTargetBudget > 0
    ? items.reduce((sum, item) => sum + Math.min(item.runnable_due_count, sourceDailyTargetBudget), 0)
    : totals.runnable_due_count;
  const dailyBudget = autoSyncDailyTargetBudget > 0
    ? Math.min(autoSyncDailyTargetBudget, sourceBudgetLimitedDueCount)
    : sourceBudgetLimitedDueCount;
  const estimatedDaysByBudget = buildEstimatedDaysByBudget(totals.runnable_due_count, [
    autoSyncDailyTargetBudget,
    sourceBudgetLimitedDueCount,
    dailyBudget,
    250,
    500,
    1000,
    2000
  ]);

  return {
    totals,
    due_by_source: dueBySource,
    oldest_due_by_source: oldestDueBySource,
    failure_pressure_by_source: failurePressureBySource,
    quarantine_only_impact: quarantineOnlyImpact,
    auto_disabled_impact: autoDisabledImpact,
    estimated_days_by_budget: estimatedDaysByBudget,
    last_success_at_by_source: lastSuccessAtBySource,
    last_failure_at_by_source: lastFailureAtBySource,
    daily_budget_projection: {
      auto_sync_daily_target_budget: autoSyncDailyTargetBudget,
      auto_sync_targets_per_run: autoSyncTargetsPerRun,
      source_daily_target_budget: sourceDailyTargetBudget,
      source_budget_limited_due_count: sourceBudgetLimitedDueCount,
      effective_daily_target_budget: dailyBudget,
      estimated_auto_runs_to_clear: autoSyncTargetsPerRun > 0
        ? Math.ceil(totals.runnable_due_count / autoSyncTargetsPerRun)
        : null,
      estimated_days_to_clear: dailyBudget > 0
        ? Math.ceil(totals.runnable_due_count / dailyBudget)
        : null
    },
    items
  };
}

function boolPath(filePath) {
  return fs.existsSync(filePath);
}

function getFixtureCoverage(atsKey, options = {}) {
  const key = String(atsKey || "").trim().toLowerCase();
  const repoRoot = path.resolve(options.repoRoot || path.join(__dirname, ".."));
  const sourceFixtureDir = path.join(repoRoot, "server", "ingestion", "sources", key, "fixtures");
  const legacyFixtureDir = path.join(repoRoot, "server", "ingestion", "fixtures");
  return {
    source_module_dir: boolPath(path.join(repoRoot, "server", "ingestion", "sources", key)),
    source_fixture_dir: boolPath(sourceFixtureDir),
    source_fixtures: {
      company: boolPath(path.join(sourceFixtureDir, "company.json")),
      list: boolPath(path.join(sourceFixtureDir, "list.json")),
      expected_normalized: boolPath(path.join(sourceFixtureDir, "expected-normalized.json")),
      invalid_shapes: boolPath(path.join(sourceFixtureDir, "invalid-shapes.json")),
      route_detection: boolPath(path.join(sourceFixtureDir, "route-detection.json")),
      malformed_list_shapes: boolPath(path.join(sourceFixtureDir, "malformed-list-shapes.json")),
      missing_geo_list: boolPath(path.join(sourceFixtureDir, "missing-geo-list.json"))
    },
    legacy_fixtures: {
      postings: boolPath(path.join(legacyFixtureDir, `${key}-postings.json`)),
      direct: boolPath(path.join(legacyFixtureDir, `${key}-direct.json`)),
      failures: boolPath(path.join(legacyFixtureDir, `${key}-failures.json`)),
      detail_certification: boolPath(path.join(legacyFixtureDir, `${key}-detail-certification.json`))
    }
  };
}

function summarizeRecentErrors(rows = []) {
  const byAts = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const atsKey = String(row.ats_key || "").trim().toLowerCase();
    const errorType = String(row.error_type || "unknown").trim() || "unknown";
    const errorMessage = String(row.error_message || "");
    const httpStatus = normalizeHttpStatus(row.http_status);
    const count = Number(row.count || 0);
    if (!atsKey || count <= 0) continue;
    if (!byAts.has(atsKey)) {
      byAts.set(atsKey, {
        total_count: 0,
        parser_drift_count: 0,
        parser_attention_count: 0,
        source_policy_block_count: 0,
        parser_bug_count: 0,
        source_quality_count: 0,
        rate_limit_count: 0,
        network_count: 0,
        empty_no_jobs_count: 0,
        auth_count: 0,
        unknown_count: 0,
        by_reason: {},
        by_type: {}
      });
    }
    const current = byAts.get(atsKey);
    const failureReason = classifyFailureReason(errorType, httpStatus, errorMessage);
    current.total_count += count;
    current.by_type[errorType] = (current.by_type[errorType] || 0) + count;
    current.by_reason[failureReason] = (current.by_reason[failureReason] || 0) + count;
    if (errorType === "parser_drift") current.parser_drift_count += count;
    if (isParserAttentionError(errorType, errorMessage)) current.parser_attention_count += count;
    if (SOURCE_POLICY_BLOCK_ERROR_TYPES.includes(errorType)) current.source_policy_block_count += count;
    current[`${failureReason}_count`] = Number(current[`${failureReason}_count`] || 0) + count;
  }
  return byAts;
}

function summarizeFailureReasonCountsByScope(rows = []) {
  const targetFailure = createFailureReasonCounts();
  const postingRejection = createFailureReasonCounts();
  const unknown = createFailureReasonCounts();
  const total = {
    target_failure_count: 0,
    posting_rejection_count: 0,
    unknown_count: 0
  };
  for (const row of Array.isArray(rows) ? rows : []) {
    const scope = String(row?.error_scope || "").trim().toLowerCase();
    const errorType = String(row?.error_type || "unknown").trim().toLowerCase() || "unknown";
    const errorMessage = String(row?.error_message || "");
    const httpStatus = normalizeHttpStatus(row?.http_status);
    const count = Number(row?.count || 0);
    if (count <= 0) continue;
    const failureReason = classifyFailureReason(errorType, httpStatus, errorMessage);
    if (scope === "posting_rejection") {
      addFailureReasonCount(postingRejection, failureReason, count);
      total.posting_rejection_count += count;
    } else if (scope === "target_failure") {
      addFailureReasonCount(targetFailure, failureReason, count);
      total.target_failure_count += count;
    } else {
      addFailureReasonCount(unknown, failureReason, count);
      total.unknown_count += count;
    }
  }
  return {
    target_failure: targetFailure,
    posting_rejection: postingRejection,
    unknown,
    total
  };
}

function summarizeLatestRun(row = {}) {
  const totalTargets = Number(row?.total_targets || 0);
  const successCount = Number(row?.success_count || 0);
  const failureCount = Number(row?.failure_count || 0);
  const successRatePct = totalTargets > 0
    ? Number(((successCount / totalTargets) * 100).toFixed(2))
    : null;
  const failureRatePct = totalTargets > 0
    ? Number(((failureCount / totalTargets) * 100).toFixed(2))
    : null;
  return {
    latest_run_id: Number(row?.id || row?.latest_run_id || 0),
    latest_status: String(row?.status || row?.latest_status || ""),
    started_at_epoch: Number(row?.started_at_epoch || 0),
    finished_at_epoch: Number(row?.finished_at_epoch || 0),
    total_targets: totalTargets,
    success_count: successCount,
    failure_count: failureCount,
    success_rate_pct: successRatePct,
    failure_rate_pct: failureRatePct
  };
}

function normalizeActiveAts(value) {
  if (Array.isArray(value)) return value.map((item) => String(item || "").trim()).filter(Boolean);
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.map((item) => String(item || "").trim()).filter(Boolean);
    } catch (_) {
      return value.split(",").map((item) => item.trim()).filter(Boolean);
    }
  }
  return [];
}

function summarizeRecentRunTrendRows(rows = [], options = {}) {
  const normalizedRuns = (Array.isArray(rows) ? rows : []).map((row) => {
    const totalTargets = Number(row?.total_targets || 0);
    const successCount = Number(row?.success_count || 0);
    const failureCount = Number(row?.failure_count || 0);
    return {
      run_id: Number(row?.id || row?.run_id || 0),
      status: String(row?.status || ""),
      started_at_epoch: Number(row?.started_at_epoch || 0),
      finished_at_epoch: Number(row?.finished_at_epoch || 0),
      total_targets: totalTargets,
      success_count: successCount,
      failure_count: failureCount,
      success_rate_pct: totalTargets > 0
        ? Number(((successCount / totalTargets) * 100).toFixed(2))
        : null,
      failure_rate_pct: totalTargets > 0
        ? Number(((failureCount / totalTargets) * 100).toFixed(2))
        : null,
      active_ats: normalizeActiveAts(row?.active_ats)
    };
  });
  const totals = normalizedRuns.reduce((acc, run) => {
    acc.total_targets += run.total_targets;
    acc.success_count += run.success_count;
    acc.failure_count += run.failure_count;
    if (run.status === "completed") acc.completed_count += 1;
    else if (run.status === "completed_with_errors") acc.completed_with_errors_count += 1;
    else if (run.status === "running") acc.running_count += 1;
    return acc;
  }, {
    total_targets: 0,
    success_count: 0,
    failure_count: 0,
    completed_count: 0,
    completed_with_errors_count: 0,
    running_count: 0
  });
  return {
    read_only: true,
    recent_run_limit: Math.max(1, Math.min(100, Math.floor(Number(options.recentRunLimit || 20)))),
    target_ats_keys: Array.isArray(options.targetAtsKeys) ? options.targetAtsKeys : [],
    run_count: normalizedRuns.length,
    ...totals,
    success_rate_pct: totals.total_targets > 0
      ? Number(((totals.success_count / totals.total_targets) * 100).toFixed(2))
      : null,
    failure_rate_pct: totals.total_targets > 0
      ? Number(((totals.failure_count / totals.total_targets) * 100).toFixed(2))
      : null,
    runs: normalizedRuns
  };
}

function summarizeRecentRunTrendBySourceRows(rows = [], options = {}) {
  const bySource = {};
  for (const row of Array.isArray(rows) ? rows : []) {
    const atsKey = String(row?.ats_key || "").trim().toLowerCase();
    if (!atsKey) continue;
    const successCount = Number(row?.success_count || 0);
    const failureCount = Number(row?.failure_count || 0);
    const totalTargets = Number(row?.total_targets || successCount + failureCount);
    if (!bySource[atsKey]) {
      bySource[atsKey] = {
        read_only: true,
        recent_run_limit: Math.max(1, Math.min(100, Math.floor(Number(options.recentRunLimit || 20)))),
        target_ats_keys: Array.isArray(options.targetAtsKeys) ? options.targetAtsKeys : [],
        run_count: 0,
        total_targets: 0,
        success_count: 0,
        failure_count: 0,
        success_rate_pct: null,
        failure_rate_pct: null,
        runs: []
      };
    }
    const source = bySource[atsKey];
    source.run_count += 1;
    source.total_targets += totalTargets;
    source.success_count += successCount;
    source.failure_count += failureCount;
    source.runs.push({
      run_id: Number(row?.run_id || row?.id || 0),
      status: String(row?.status || ""),
      started_at_epoch: Number(row?.started_at_epoch || 0),
      finished_at_epoch: Number(row?.finished_at_epoch || 0),
      total_targets: totalTargets,
      success_count: successCount,
      failure_count: failureCount,
      success_rate_pct: totalTargets > 0
        ? Number(((successCount / totalTargets) * 100).toFixed(2))
        : null,
      failure_rate_pct: totalTargets > 0
        ? Number(((failureCount / totalTargets) * 100).toFixed(2))
        : null
    });
  }
  for (const source of Object.values(bySource)) {
    source.success_rate_pct = source.total_targets > 0
      ? Number(((source.success_count / source.total_targets) * 100).toFixed(2))
      : null;
    source.failure_rate_pct = source.total_targets > 0
      ? Number(((source.failure_count / source.total_targets) * 100).toFixed(2))
      : null;
  }
  return bySource;
}

function summarizeLatestRunBySourceRow(row = {}) {
  const successCount = Number(row?.success_count || 0);
  const failureCount = Number(row?.failure_count || 0);
  const totalTargets = successCount + failureCount;
  return {
    latest_run_id: Number(row?.latest_run_id || row?.id || 0),
    total_targets: totalTargets,
    success_count: successCount,
    failure_count: failureCount,
    success_rate_pct: totalTargets > 0
      ? Number(((successCount / totalTargets) * 100).toFixed(2))
      : null,
    failure_rate_pct: totalTargets > 0
      ? Number(((failureCount / totalTargets) * 100).toFixed(2))
      : null
  };
}

function summarizeLatestRunBySourceRows(rows = []) {
  const bySource = {};
  for (const row of Array.isArray(rows) ? rows : []) {
    const atsKey = String(row.ats_key || "").trim().toLowerCase();
    if (!atsKey) continue;
    bySource[atsKey] = summarizeLatestRunBySourceRow(row);
  }
  return bySource;
}

function calculateSuccessRate(successCount, totalTargets) {
  return totalTargets > 0
    ? Number(((successCount / totalTargets) * 100).toFixed(2))
    : null;
}

function normalizeTargetAtsKeys(value) {
  return (Array.isArray(value) ? value : [])
    .map((item) => String(item || "").trim().toLowerCase())
    .filter(Boolean);
}

function selectGateRecentRunTrend(recentRunTrend = {}, recentRunTrendBySource = {}, targetAtsKeys = []) {
  const targets = normalizeTargetAtsKeys(targetAtsKeys);
  if (targets.length === 0) {
    return {
      ...recentRunTrend,
      scope: "all_runs"
    };
  }

  const selectedSources = targets
    .map((atsKey) => recentRunTrendBySource[atsKey])
    .filter(Boolean);
  const totals = selectedSources.reduce((acc, source) => {
    acc.total_targets += Number(source.total_targets || 0);
    acc.success_count += Number(source.success_count || 0);
    acc.failure_count += Number(source.failure_count || 0);
    for (const run of Array.isArray(source.runs) ? source.runs : []) {
      acc.run_ids.add(Number(run.run_id || 0));
      acc.runs.push({ ...run });
    }
    return acc;
  }, {
    total_targets: 0,
    success_count: 0,
    failure_count: 0,
    run_ids: new Set(),
    runs: []
  });

  totals.runs.sort((left, right) => Number(right.run_id || 0) - Number(left.run_id || 0));
  return {
    read_only: true,
    scope: "target_sources",
    recent_run_limit: Number(recentRunTrend.recent_run_limit || selectedSources[0]?.recent_run_limit || 0),
    target_ats_keys: targets,
    source_count: selectedSources.length,
    run_count: totals.run_ids.size,
    total_targets: totals.total_targets,
    success_count: totals.success_count,
    failure_count: totals.failure_count,
    success_rate_pct: calculateSuccessRate(totals.success_count, totals.total_targets),
    failure_rate_pct: calculateSuccessRate(totals.failure_count, totals.total_targets),
    runs: totals.runs
  };
}

function selectGateLatestRun(latestRun = {}, recentRunTrendBySource = {}, targetAtsKeys = []) {
  const targets = normalizeTargetAtsKeys(targetAtsKeys);
  if (targets.length === 0) {
    return {
      ...latestRun,
      scope: "all_runs"
    };
  }

  const sourceRuns = [];
  for (const atsKey of targets) {
    const source = recentRunTrendBySource[atsKey];
    for (const run of Array.isArray(source?.runs) ? source.runs : []) {
      sourceRuns.push({ ...run, ats_key: atsKey });
    }
  }
  if (sourceRuns.length === 0) {
    return {
      latest_run_id: Number(latestRun.latest_run_id || 0),
      latest_status: "",
      started_at_epoch: 0,
      finished_at_epoch: 0,
      total_targets: 0,
      success_count: 0,
      failure_count: 0,
      success_rate_pct: null,
      failure_rate_pct: null,
      scope: "target_sources",
      target_ats_keys: targets
    };
  }

  const latestRunId = Math.max(...sourceRuns.map((run) => Number(run.run_id || 0)));
  const latestSourceRuns = sourceRuns.filter((run) => Number(run.run_id || 0) === latestRunId);
  const totalTargets = latestSourceRuns.reduce((sum, run) => sum + Number(run.total_targets || 0), 0);
  const successCount = latestSourceRuns.reduce((sum, run) => sum + Number(run.success_count || 0), 0);
  const failureCount = latestSourceRuns.reduce((sum, run) => sum + Number(run.failure_count || 0), 0);
  const status = latestSourceRuns.some((run) => Number(run.failure_count || 0) > 0)
    ? "completed_with_errors"
    : String(latestSourceRuns[0]?.status || "");
  return {
    latest_run_id: latestRunId,
    latest_status: status,
    started_at_epoch: Math.min(...latestSourceRuns.map((run) => Number(run.started_at_epoch || 0))),
    finished_at_epoch: Math.max(...latestSourceRuns.map((run) => Number(run.finished_at_epoch || 0))),
    total_targets: totalTargets,
    success_count: successCount,
    failure_count: failureCount,
    success_rate_pct: calculateSuccessRate(successCount, totalTargets),
    failure_rate_pct: calculateSuccessRate(failureCount, totalTargets),
    scope: "target_sources",
    target_ats_keys: targets
  };
}

function summarizeTargetAtsPatchEffect({
  targetAtsKeys = [],
  latestRun = {},
  latestRunBySource = {},
  recentRunTrendBySource = {},
  autoSyncBudgetUsage = {}
} = {}) {
  const targets = normalizeTargetAtsKeys(targetAtsKeys);
  const latestRunId = Number(latestRun.latest_run_id || 0);
  const autoSyncBudgetExhausted = Boolean(autoSyncBudgetUsage?.daily_budget_exhausted);
  const sources = targets.map((atsKey) => {
    const latestSourceRun = latestRunBySource[atsKey] || emptyLatestRunBySourceSummary(latestRunId);
    const recentTrend = recentRunTrendBySource[atsKey] || null;
    const latestSourceRunId = Number(latestSourceRun.latest_run_id || 0);
    const latestRunTotalTargets = Number(latestSourceRun.total_targets || 0);
    const measuredInLatestRun = latestRunId > 0 &&
      latestSourceRunId === latestRunId &&
      latestRunTotalTargets > 0;
    return {
      ats_key: atsKey,
      latest_run_id: latestRunId,
      latest_source_run_id: latestSourceRunId,
      latest_run_total_targets: latestRunTotalTargets,
      latest_run_success_count: Number(latestSourceRun.success_count || 0),
      latest_run_failure_count: Number(latestSourceRun.failure_count || 0),
      latest_run_success_rate_pct: latestSourceRun.success_rate_pct ?? null,
      recent_run_total_targets: Number(recentTrend?.total_targets || 0),
      recent_run_success_rate_pct: recentTrend?.success_rate_pct ?? null,
      measured_in_latest_run: measuredInLatestRun,
      status: measuredInLatestRun ? "measured_in_latest_run" : "pending_new_worker_run",
      measurement_blocker_code: !measuredInLatestRun && autoSyncBudgetExhausted
        ? "daily_budget_exhausted"
        : "",
      next_action: measuredInLatestRun
        ? "Use latest-run source success and failure taxonomy before changing throughput."
        : autoSyncBudgetExhausted
          ? "Automatic worker daily budget is exhausted; wait for the UTC reset or an approved manual run before judging this ATS patch effect."
          : "Wait for a new worker run that includes this ATS before judging the patch effect."
    };
  });
  const allTargetsMeasured = sources.length > 0 && sources.every((source) => source.measured_in_latest_run);
  const needsNewMeasurement = targets.length > 0 && !allTargetsMeasured;
  const measurementBlocker = needsNewMeasurement && autoSyncBudgetExhausted
    ? {
        code: "daily_budget_exhausted",
        message: "Automatic worker daily budget is exhausted; wait for the UTC reset or an approved manual run before judging target ATS patch effect.",
        daily_budget: Number(autoSyncBudgetUsage.daily_budget || 0),
        targets_per_run: Number(autoSyncBudgetUsage.targets_per_run || 0),
        targets_started_today: Number(autoSyncBudgetUsage.targets_started_today || 0),
        remaining_daily_budget: autoSyncBudgetUsage.remaining_daily_budget ?? null,
        utc_day_reset_epoch: Number(autoSyncBudgetUsage.utc_day_reset_epoch || 0),
        utc_day_reset_at: epochToIso(autoSyncBudgetUsage.utc_day_reset_epoch)
      }
    : null;
  return {
    read_only: true,
    latest_run_id: latestRunId,
    target_ats_keys: targets,
    source_count: sources.length,
    all_targets_measured_in_latest_run: allTargetsMeasured,
    status: targets.length === 0
      ? "not_scoped"
      : allTargetsMeasured
        ? "measured_in_latest_run"
        : "pending_new_worker_run",
    next_action: targets.length === 0
      ? "Run diagnostics with --targets=<ats_key,...> to measure a specific parser or source patch."
      : allTargetsMeasured
        ? "Compare latest-run source success, failures, and quality-gate output before any throughput change."
        : measurementBlocker
          ? "Hold throughput; wait for the UTC daily budget reset or an approved manual run, then measure the target ATS in a completed worker run."
          : "Hold throughput until the target ATS appears in a completed worker run.",
    ...(measurementBlocker ? { measurement_blocker: measurementBlocker } : {}),
    sources
  };
}

function failureReasonCountsFromRecentErrorSummary(summary = {}) {
  const counts = createFailureReasonCounts();
  for (const bucket of FAILURE_REASON_BUCKETS) {
    counts[bucket] = Number(summary?.by_reason?.[bucket] || summary?.[`${bucket}_count`] || 0);
  }
  return counts;
}

function summarizeParserBugEvidenceForPriority(recentSummary = {}, parserDriftRecheck = {}, adjustedCounts = {}) {
  const rawParserBugCount = Math.max(
    0,
    Number(recentSummary?.parser_bug_count || recentSummary?.by_reason?.parser_bug || 0)
  );
  const rawParserDriftCount = Math.max(
    0,
    Number(recentSummary?.parser_drift_count || recentSummary?.by_type?.parser_drift || 0)
  );
  const rawNonDriftParserBugCount = Math.max(0, rawParserBugCount - rawParserDriftCount);
  const sampleCount = Math.max(0, Number(parserDriftRecheck?.sample_count || 0));
  const stillDriftCount = Math.max(0, Number(parserDriftRecheck?.still_drift_count || 0));
  const currentPolicyPassCount = Math.max(0, Number(parserDriftRecheck?.current_policy_pass_count || 0));
  const currentPolicyEmptyNoJobsCount = Math.max(
    0,
    Number(parserDriftRecheck?.current_policy_empty_no_jobs_count || 0)
  );
  const currentPolicyResolvedCount = Math.max(
    0,
    Number(parserDriftRecheck?.current_policy_resolved_count || currentPolicyPassCount + currentPolicyEmptyNoJobsCount)
  );
  const skippedNoBaselineCount = Math.max(0, Number(parserDriftRecheck?.skipped_no_baseline_count || 0));
  const adjustedParserBugCount = Math.max(0, Number(adjustedCounts?.parser_bug || 0));
  const parserDriftUnrecheckedCount = Math.max(0, rawParserDriftCount - sampleCount);
  const parserDriftUnverifiedCount = parserDriftUnrecheckedCount + skippedNoBaselineCount;
  const confirmedParserBugCount = Math.min(adjustedParserBugCount, rawNonDriftParserBugCount + stillDriftCount);
  const status = rawParserBugCount <= 0
    ? "none"
    : adjustedParserBugCount <= 0
      ? "current_policy_resolved"
      : confirmedParserBugCount > 0
      ? "confirmed_parser_bug"
      : parserDriftUnverifiedCount > 0
        ? "parser_bug_unrechecked"
        : "parser_bug_unclassified";

  return {
    status,
    raw_parser_bug_count: rawParserBugCount,
    raw_parser_drift_count: rawParserDriftCount,
    raw_non_drift_parser_bug_count: rawNonDriftParserBugCount,
    parser_drift_recheck_sample_count: sampleCount,
    parser_drift_still_drift_count: stillDriftCount,
    parser_drift_current_policy_pass_count: currentPolicyPassCount,
    parser_drift_current_policy_empty_no_jobs_count: currentPolicyEmptyNoJobsCount,
    parser_drift_current_policy_resolved_count: currentPolicyResolvedCount,
    parser_drift_skipped_no_baseline_count: skippedNoBaselineCount,
    parser_drift_unrechecked_count: parserDriftUnrecheckedCount,
    parser_drift_unverified_count: parserDriftUnverifiedCount,
    confirmed_parser_bug_count: confirmedParserBugCount
  };
}

function priorityLaneForFailureCounts(counts = {}, parserBugEvidence = {}) {
  if (Number(counts.parser_bug || 0) > 0) {
    return parserBugEvidence.status === "parser_bug_unrechecked" ? "parser_bug_unrechecked" : "parser_bug";
  }
  if (Number(counts.source_quality || 0) > 0) return "source_quality";
  if (
    Number(counts.rate_limit || 0) > 0 ||
    Number(counts.network || 0) > 0 ||
    Number(counts.auth || 0) > 0 ||
    Number(counts.unknown || 0) > 0
  ) return "stability";
  if (Number(counts.empty_no_jobs || 0) > 0) return "empty_no_jobs_cleanup";
  return "healthy_or_no_recent_failures";
}

function priorityLaneRank(lane) {
  switch (lane) {
    case "parser_bug":
      return 0;
    case "parser_bug_unrechecked":
      return 1;
    case "source_quality":
      return 2;
    case "stability":
      return 3;
    case "empty_no_jobs_cleanup":
      return 4;
    default:
      return 5;
  }
}

function buildWorkerSuccessRecoveryPriorities({
  items = [],
  recentByAts = new Map(),
  recentRunTrendBySource = {},
  parserDriftRecheck = {},
  options = {}
} = {}) {
  const limit = Math.max(1, Math.min(50, Math.floor(Number(options.workerSuccessPriorityLimit || 10))));
  const minimumSuccessRatePct = Number.isFinite(Number(options.minimumSuccessRatePct))
    ? Number(options.minimumSuccessRatePct)
    : 80;
  const parserDriftBySource = parserDriftRecheck?.by_source || {};
  const sources = [];

  for (const item of Array.isArray(items) ? items : []) {
    const atsKey = String(item?.ats_key || "").trim().toLowerCase();
    if (!atsKey) continue;
    const recentSummary = recentByAts.get(atsKey) || {};
    const parserDriftSource = parserDriftBySource[atsKey] || {};
    const rawFailureCounts = failureReasonCountsFromRecentErrorSummary(recentSummary);
    const adjusted = adjustFailureReasonCountsForParserDriftRecheck(rawFailureCounts, parserDriftSource);
    const adjustedCounts = adjusted.counts;
    const parserBugEvidence = summarizeParserBugEvidenceForPriority(
      recentSummary,
      parserDriftSource,
      adjustedCounts
    );
    const recentTrend = recentRunTrendBySource[atsKey] || null;
    const recentSuccessRate = recentTrend?.success_rate_pct ?? null;
    const runnableDueCount = Number(item.runnable_due_count || item.due_count || 0);
    const failurePressure = Number(item.failure_pressure || 0);
    const actionableFailureCount =
      Number(adjustedCounts.parser_bug || 0) +
      Number(adjustedCounts.source_quality || 0) +
      Number(adjustedCounts.rate_limit || 0) +
      Number(adjustedCounts.network || 0) +
      Number(adjustedCounts.auth || 0) +
      Number(adjustedCounts.unknown || 0);
    const lane = priorityLaneForFailureCounts(adjustedCounts, parserBugEvidence);
    const reasons = [];
    if (Number(adjustedCounts.parser_bug || 0) > 0) {
      if (parserBugEvidence.status === "parser_bug_unrechecked") {
        reasons.push("parser_bug_unrechecked");
      } else if (parserBugEvidence.status === "parser_bug_unclassified") {
        reasons.push("parser_bug_unclassified");
      } else {
        reasons.push("real_parser_bug");
      }
    }
    if (Number(adjustedCounts.source_quality || 0) > 0) reasons.push("source_quality");
    if (Number(adjustedCounts.rate_limit || 0) > 0) reasons.push("rate_limit");
    if (Number(adjustedCounts.network || 0) > 0) reasons.push("network");
    if (Number(adjustedCounts.auth || 0) > 0) reasons.push("auth");
    if (Number(adjustedCounts.unknown || 0) > 0) reasons.push("unknown");
    if (Number(adjustedCounts.empty_no_jobs || 0) > 0) reasons.push("empty_no_jobs_cleanup");
    if (recentSuccessRate != null && recentSuccessRate < minimumSuccessRatePct) reasons.push("low_success_rate");
    if (failurePressure > 0) reasons.push("failure_pressure");
    if (runnableDueCount > 0) reasons.push("due_backlog");
    if (reasons.length === 0) continue;

    const nextAction = lane === "parser_bug"
      ? "Add or update raw fixtures and fix the parser before counting this source as scalable."
      : lane === "parser_bug_unrechecked"
        ? "Increase parser-drift recheck coverage or wait for a new worker run before treating this as a real parser bug."
      : lane === "source_quality"
        ? "Review source evidence and quality-gate rejects; do not relax thresholds or invent missing fields."
        : lane === "stability"
          ? "Separate rate-limit, network, and auth handling before increasing target volume."
          : lane === "empty_no_jobs_cleanup"
            ? "Audit stale or empty boards so worker slots are not spent on no-job targets."
            : "Keep monitoring; no active failure lane is dominant.";

    sources.push({
      ats_key: atsKey,
      priority_lane: lane,
      lane_rank: priorityLaneRank(lane),
      runnable_due_count: runnableDueCount,
      failure_pressure: failurePressure,
      recent_run_total_targets: Number(recentTrend?.total_targets || 0),
      recent_run_success_rate_pct: recentSuccessRate,
      current_policy_adjusted_failure_reason_counts: adjustedCounts,
      parser_drift_recheck_adjustments: adjusted.adjustments,
      parser_bug_evidence: parserBugEvidence,
      actionable_failure_count: actionableFailureCount,
      empty_no_jobs_count: Number(adjustedCounts.empty_no_jobs || 0),
      reasons,
      next_action: nextAction
    });
  }

  sources.sort((left, right) =>
    left.lane_rank - right.lane_rank ||
    Number(right.failure_pressure || 0) - Number(left.failure_pressure || 0) ||
    Number(right.current_policy_adjusted_failure_reason_counts?.parser_bug || 0) -
      Number(left.current_policy_adjusted_failure_reason_counts?.parser_bug || 0) ||
    Number(right.actionable_failure_count || 0) - Number(left.actionable_failure_count || 0) ||
    Number(right.runnable_due_count || 0) - Number(left.runnable_due_count || 0) ||
    String(left.ats_key || "").localeCompare(String(right.ats_key || ""))
  );

  return {
    read_only: true,
    minimum_success_rate_pct: minimumSuccessRatePct,
    source_count: sources.length,
    prioritization: "confirmed parser_bug lane first, then unrechecked parser drift, source_quality, stability, and empty/no-jobs cleanup; ties use failure pressure, adjusted parser bugs, actionable failures, and runnable due.",
    sources: sources.slice(0, limit)
  };
}

function normalizeParserDriftRecheckForGate(value = {}) {
  const currentPolicyPassCount = Number(value?.current_policy_pass_count || 0);
  const currentPolicyEmptyNoJobsCount = Number(value?.current_policy_empty_no_jobs_count || 0);
  return {
    sample_count: Number(value?.sample_count || 0),
    still_drift_count: Number(value?.still_drift_count || 0),
    current_policy_pass_count: currentPolicyPassCount,
    current_policy_empty_no_jobs_count: currentPolicyEmptyNoJobsCount,
    current_policy_resolved_count: Number(value?.current_policy_resolved_count || currentPolicyPassCount + currentPolicyEmptyNoJobsCount),
    skipped_no_baseline_count: Number(value?.skipped_no_baseline_count || 0)
  };
}

function buildThroughputScalingGate({
  latestRun = {},
  recentRunTrend = {},
  parserAttentionCount = 0,
  failureReasonCounts = {},
  targetFailureReasonCounts = null,
  postingRejectionReasonCounts = null,
  parserDriftRecheck = null,
  totals = {},
  options = {}
} = {}) {
  const minimumSuccessRatePct = Number.isFinite(Number(options.minimumSuccessRatePct))
    ? Number(options.minimumSuccessRatePct)
    : 80;
  const parserAttentionThreshold = Number.isFinite(Number(options.parserAttentionThreshold))
    ? Number(options.parserAttentionThreshold)
    : 0;
  const successRatePct = latestRun.success_rate_pct == null ? null : Number(latestRun.success_rate_pct);
  const recentRunSuccessRatePct = recentRunTrend.success_rate_pct == null
    ? null
    : Number(recentRunTrend.success_rate_pct);
  const recentRunTotalTargets = Number(recentRunTrend.total_targets || 0);
  const minimumTrendTargetCount = Number.isFinite(Number(options.minimumTrendTargetCount))
    ? Number(options.minimumTrendTargetCount)
    : 50;
  const latestStatus = String(latestRun.latest_status || "").trim();
  const blockers = [];
  const cautions = [];
  const targetFailureCounts = targetFailureReasonCounts || failureReasonCounts || {};
  const postingRejectionCounts = postingRejectionReasonCounts || {};
  const parserDriftRecheckSummary = normalizeParserDriftRecheckForGate(parserDriftRecheck || {});
  const parserAttentionTotal = Number(parserAttentionCount || 0);
  const parserBugTargetFailureCount = Number(targetFailureCounts?.parser_bug || 0);
  const parserDriftRecheckHasCoverage = parserDriftRecheckSummary.sample_count > 0;
  const parserAttentionCurrentPolicyResolvedCount = parserDriftRecheckHasCoverage
    ? Math.min(parserAttentionTotal, parserDriftRecheckSummary.current_policy_resolved_count)
    : 0;
  const parserAttentionCurrentPolicyPassCount = parserDriftRecheckHasCoverage
    ? Math.min(parserAttentionCurrentPolicyResolvedCount, parserDriftRecheckSummary.current_policy_pass_count)
    : 0;
  const parserAttentionCurrentPolicyEmptyNoJobsCount = parserDriftRecheckHasCoverage
    ? Math.min(
        Math.max(0, parserAttentionCurrentPolicyResolvedCount - parserAttentionCurrentPolicyPassCount),
        parserDriftRecheckSummary.current_policy_empty_no_jobs_count
      )
    : 0;
  const parserAttentionUnresolvedCount = Math.max(0, parserAttentionTotal - parserAttentionCurrentPolicyResolvedCount);
  const parserAttentionStatus = parserAttentionTotal <= parserAttentionThreshold
    ? "none"
    : !parserDriftRecheckHasCoverage
      ? "unrechecked"
      : parserAttentionUnresolvedCount <= parserAttentionThreshold
        ? "rechecked_current_policy_pass"
        : parserAttentionCurrentPolicyPassCount > 0
          ? "partially_rechecked_unresolved"
          : "unresolved";
  const parserDriftFullyCurrentPolicyPass = parserDriftRecheckHasCoverage &&
    parserDriftRecheckSummary.still_drift_count === 0 &&
    parserDriftRecheckSummary.skipped_no_baseline_count === 0;
  const parserAttentionFullyRechecked = parserDriftFullyCurrentPolicyPass &&
    parserDriftRecheckSummary.current_policy_resolved_count >= parserAttentionTotal;
  const parserBugFailuresFullyRechecked = parserDriftFullyCurrentPolicyPass &&
    parserDriftRecheckSummary.current_policy_resolved_count >= parserBugTargetFailureCount;

  if (!Number(latestRun.latest_run_id || 0) || Number(latestRun.total_targets || 0) <= 0 || successRatePct == null) {
    blockers.push({
      code: "latest_run_missing",
      message: "Latest worker run evidence is missing or has no targets."
    });
  } else if (latestStatus === "running") {
    blockers.push({
      code: "latest_run_still_running",
      message: "Latest worker run is still running; wait for a completed run before changing throughput."
    });
  } else if (successRatePct < minimumSuccessRatePct) {
    blockers.push({
      code: "latest_run_success_rate_below_threshold",
      message: `Latest worker success rate ${successRatePct}% is below the ${minimumSuccessRatePct}% threshold.`
    });
  }

  if (
    recentRunTotalTargets >= minimumTrendTargetCount &&
    recentRunSuccessRatePct != null &&
    recentRunSuccessRatePct < minimumSuccessRatePct
  ) {
    blockers.push({
      code: "recent_run_success_rate_below_threshold",
      message: `Recent worker trend success rate ${recentRunSuccessRatePct}% over ${recentRunTotalTargets} targets is below the ${minimumSuccessRatePct}% threshold.`
    });
  }

  if (parserDriftRecheckHasCoverage && parserDriftRecheckSummary.current_policy_pass_count > 0) {
    cautions.push({
      code: "parser_drift_current_policy_pass",
      message: `Parser drift recheck passed current policy for ${parserDriftRecheckSummary.current_policy_pass_count} sampled events.`,
      count: parserDriftRecheckSummary.current_policy_pass_count,
      still_drift_count: parserDriftRecheckSummary.still_drift_count,
      skipped_no_baseline_count: parserDriftRecheckSummary.skipped_no_baseline_count
    });
  }

  if (parserDriftRecheckHasCoverage && parserDriftRecheckSummary.current_policy_empty_no_jobs_count > 0) {
    cautions.push({
      code: "parser_drift_current_policy_empty_no_jobs",
      message: `Parser drift recheck matched explicit empty job-list shape for ${parserDriftRecheckSummary.current_policy_empty_no_jobs_count} sampled events.`,
      count: parserDriftRecheckSummary.current_policy_empty_no_jobs_count,
      still_drift_count: parserDriftRecheckSummary.still_drift_count,
      skipped_no_baseline_count: parserDriftRecheckSummary.skipped_no_baseline_count
    });
  }

  if (parserAttentionUnresolvedCount > parserAttentionThreshold && !parserAttentionFullyRechecked) {
    blockers.push({
      code: "parser_attention_present",
      message: `Parser attention unresolved count ${parserAttentionUnresolvedCount} is above the ${parserAttentionThreshold} threshold.`,
      count: parserAttentionUnresolvedCount,
      total_count: parserAttentionTotal,
      current_policy_pass_count: parserDriftRecheckSummary.current_policy_pass_count,
      current_policy_empty_no_jobs_count: parserDriftRecheckSummary.current_policy_empty_no_jobs_count,
      current_policy_resolved_count: parserDriftRecheckSummary.current_policy_resolved_count,
      still_drift_count: parserDriftRecheckSummary.still_drift_count,
      skipped_no_baseline_count: parserDriftRecheckSummary.skipped_no_baseline_count,
      unrechecked_or_non_drift_count: Math.max(0, parserAttentionTotal - parserDriftRecheckSummary.current_policy_resolved_count)
    });
  }

  const blockingFailureReasons = ["parser_bug", "source_quality", "rate_limit", "network", "auth", "unknown"];
  for (const reason of blockingFailureReasons) {
    const count = Number(targetFailureCounts?.[reason] || 0);
    if (count > 0) {
      if (reason === "parser_bug" && parserBugFailuresFullyRechecked) continue;
      const blockerCount = reason === "parser_bug"
        ? Math.max(0, count - Math.min(count, parserDriftRecheckSummary.current_policy_resolved_count))
        : count;
      if (blockerCount <= 0) continue;
      blockers.push({
        code: `${reason}_failures_present`,
        message: `${reason} target failures are present in the diagnostics window.`,
        count: blockerCount,
        total_count: count,
        ...(reason === "parser_bug"
          ? {
              current_policy_pass_count: parserDriftRecheckSummary.current_policy_pass_count,
              current_policy_empty_no_jobs_count: parserDriftRecheckSummary.current_policy_empty_no_jobs_count,
              current_policy_resolved_count: parserDriftRecheckSummary.current_policy_resolved_count,
              still_drift_count: parserDriftRecheckSummary.still_drift_count,
              skipped_no_baseline_count: parserDriftRecheckSummary.skipped_no_baseline_count,
              unrechecked_or_non_drift_count: Math.max(0, count - parserDriftRecheckSummary.current_policy_resolved_count)
            }
          : {})
      });
    }
  }

  for (const reason of ["parser_bug", "source_quality"]) {
    const count = Number(postingRejectionCounts?.[reason] || 0);
    if (count > 0) {
      blockers.push({
        code: `posting_${reason}_rejections_present`,
        message: `${reason} posting rejections are present in the diagnostics window.`,
        count
      });
    }
  }

  if (Number(totals.failure_pressure || 0) > 0) {
    cautions.push({
      code: "failure_pressure_present",
      message: "Due queue still contains targets with prior consecutive failures.",
      count: Number(totals.failure_pressure || 0)
    });
  }

  const allowed = blockers.length === 0;
  return {
    read_only: true,
    allowed,
    decision: allowed ? "eligible_for_small_increase" : "hold",
    latest_run_id: Number(latestRun.latest_run_id || 0),
    latest_run_scope: String(latestRun.scope || "all_runs"),
    latest_run_status: latestStatus,
    latest_run_success_rate_pct: successRatePct,
    recent_run_scope: String(recentRunTrend.scope || "all_runs"),
    recent_run_success_rate_pct: recentRunSuccessRatePct,
    recent_run_total_targets: recentRunTotalTargets,
    minimum_success_rate_pct: minimumSuccessRatePct,
    minimum_trend_target_count: minimumTrendTargetCount,
    parser_attention_count: parserAttentionTotal,
    parser_attention_current_policy_pass_count: parserAttentionCurrentPolicyPassCount,
    parser_attention_current_policy_empty_no_jobs_count: parserAttentionCurrentPolicyEmptyNoJobsCount,
    parser_attention_current_policy_resolved_count: parserAttentionCurrentPolicyResolvedCount,
    parser_attention_unresolved_count: parserAttentionUnresolvedCount,
    parser_attention_status: parserAttentionStatus,
    parser_attention_threshold: parserAttentionThreshold,
    parser_drift_recheck: parserDriftRecheckSummary,
    target_failure_reason_counts: targetFailureCounts,
    posting_rejection_reason_counts: postingRejectionCounts,
    runnable_due_count: Number(totals.runnable_due_count || 0),
    failure_pressure: Number(totals.failure_pressure || 0),
    max_recommended_step: allowed ? "small" : "none",
    blockers,
    cautions,
    required_checks_before_increase: [
      "/health",
      "search:reindex:check",
      "search:parity",
      "worker trend",
      "parser_attention_count",
      "due_by_source"
    ],
    next_action: allowed
      ? "Consider only a small budget or targets-per-run increase after external health and parity checks pass."
      : "Hold throughput and improve worker success rate before increasing budget or targets-per-run."
  };
}

function emptyLatestRunBySourceSummary(latestRunId = 0) {
  return {
    latest_run_id: Number(latestRunId || 0),
    total_targets: 0,
    success_count: 0,
    failure_count: 0,
    success_rate_pct: null,
    failure_rate_pct: null,
    failure_reasons: emptyRecentErrorSummary()
  };
}

function summarizeAutoSyncBudgetUsage(rows = [], options = {}) {
  const workerBudgetConfig = readWorkerBudgetConfig(options.env || process.env, options);
  const nowEpoch = Math.max(0, Math.floor(Number(options.nowEpoch || Math.floor(Date.now() / 1000))));
  const dayStartEpoch = startOfUtcDayEpoch(nowEpoch);
  const row = Array.isArray(rows) ? (rows[0] || {}) : {};
  const dailyBudget = Number(workerBudgetConfig.autoSyncDailyTargetBudget || 0);
  const targetsStartedToday = Number(row.targets_started_today || row.count || 0);
  const remainingDailyBudget = dailyBudget > 0
    ? Math.max(0, dailyBudget - targetsStartedToday)
    : null;
  return {
    read_only: true,
    utc_day_start_epoch: dayStartEpoch,
    utc_day_reset_epoch: dayStartEpoch + 86400,
    daily_budget: dailyBudget,
    targets_per_run: Number(workerBudgetConfig.autoSyncTargetsPerRun || 0),
    targets_started_today: targetsStartedToday,
    remaining_daily_budget: remainingDailyBudget,
    daily_budget_exhausted: dailyBudget > 0 && targetsStartedToday >= dailyBudget
  };
}

function sourceBudgetUsageSummary(successfulTargetsToday, options = {}) {
  const workerBudgetConfig = readWorkerBudgetConfig(options.env || process.env, options);
  const dailyBudget = Number(workerBudgetConfig.sourceDailyTargetBudget || 0);
  const successCount = Number(successfulTargetsToday || 0);
  const remainingDailyBudget = dailyBudget > 0
    ? Math.max(0, dailyBudget - successCount)
    : null;
  return {
    read_only: true,
    daily_budget: dailyBudget,
    successful_targets_today: successCount,
    remaining_daily_budget: remainingDailyBudget,
    daily_budget_exhausted: dailyBudget > 0 && successCount >= dailyBudget
  };
}

function summarizeSourceBudgetUsageRows(rows = [], options = {}) {
  const bySource = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const atsKey = String(row.ats_key || "").trim().toLowerCase();
    if (!atsKey) continue;
    bySource.set(atsKey, sourceBudgetUsageSummary(row.successful_targets_today || row.count || 0, options));
  }
  return bySource;
}

function shapePathsFromRowValue(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function emptyArrayPathStem(path) {
  const match = String(path || "").match(/^(.*)\[\]:empty$/);
  return match ? match[1] : "";
}

function isJobListArrayStem(stem) {
  const leaf = String(stem || "").split(".").pop().toLowerCase();
  return /^(jobs?|postings?|positions?|openings?|offers?|result|items|records)$/.test(leaf);
}

function hasPopulatedArrayItemShape(paths = [], stem = "") {
  return (Array.isArray(paths) ? paths : []).some((path) =>
    String(path || "").startsWith(`${stem}[]:`) && String(path || "") !== `${stem}[]:empty`
  );
}

function hasExplicitEmptyJobListShape(paths = []) {
  const shapePaths = Array.isArray(paths) ? paths : [];
  const emptyJobListStems = shapePaths
    .map(emptyArrayPathStem)
    .filter((stem) => stem && isJobListArrayStem(stem));
  return emptyJobListStems.some((stem) => !hasPopulatedArrayItemShape(shapePaths, stem));
}

function createParserDriftRecheckSourceSummary() {
  return {
    sample_count: 0,
    still_drift_count: 0,
    current_policy_pass_count: 0,
    current_policy_empty_no_jobs_count: 0,
    current_policy_resolved_count: 0,
    skipped_no_baseline_count: 0
  };
}

function summarizeParserDriftRecheck(rows = [], options = {}) {
  const { detectParserDrift } = require("../server/ingestion/sourceQualityPolicy");
  const sampleLimit = Math.max(1, Math.min(500, Math.floor(Number(options.parserDriftRecheckLimit || 100))));
  const summary = {
    read_only: true,
    sample_limit: sampleLimit,
    sample_count: 0,
    still_drift_count: 0,
    current_policy_pass_count: 0,
    current_policy_empty_no_jobs_count: 0,
    current_policy_resolved_count: 0,
    skipped_no_baseline_count: 0,
    by_source: {}
  };

  for (const row of Array.isArray(rows) ? rows : []) {
    const atsKey = String(row.ats_key || "").trim().toLowerCase();
    if (!atsKey) continue;
    if (!summary.by_source[atsKey]) summary.by_source[atsKey] = createParserDriftRecheckSourceSummary();
    const source = summary.by_source[atsKey];
    summary.sample_count += 1;
    source.sample_count += 1;

    const baselineShapePaths = shapePathsFromRowValue(row.baseline_shape_paths);
    const observedShapePaths = shapePathsFromRowValue(row.observed_shape_paths || row.shape_paths);
    if (hasExplicitEmptyJobListShape(observedShapePaths)) {
      summary.current_policy_empty_no_jobs_count += 1;
      summary.current_policy_resolved_count += 1;
      source.current_policy_empty_no_jobs_count += 1;
      source.current_policy_resolved_count += 1;
      continue;
    }
    if (baselineShapePaths.length === 0) {
      summary.skipped_no_baseline_count += 1;
      source.skipped_no_baseline_count += 1;
      continue;
    }

    const result = detectParserDrift(
      { shape_paths: baselineShapePaths },
      { shape_paths: observedShapePaths },
      options
    );
    if (result.drift) {
      summary.still_drift_count += 1;
      source.still_drift_count += 1;
    } else {
      summary.current_policy_pass_count += 1;
      summary.current_policy_resolved_count += 1;
      source.current_policy_pass_count += 1;
      source.current_policy_resolved_count += 1;
    }
  }

  return summary;
}

function emptyRecentErrorSummary() {
  return {
    total_count: 0,
    parser_drift_count: 0,
    parser_attention_count: 0,
    source_policy_block_count: 0,
    parser_bug_count: 0,
    source_quality_count: 0,
    rate_limit_count: 0,
    network_count: 0,
    empty_no_jobs_count: 0,
    auth_count: 0,
    unknown_count: 0,
    by_reason: {},
    by_type: {}
  };
}

function parseRecentErrorGroups(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function summarizeRecentErrorGroups(groups = []) {
  const summary = emptyRecentErrorSummary();
  for (const group of Array.isArray(groups) ? groups : []) {
    const errorType = String(group?.error_type || "unknown").trim() || "unknown";
    const errorMessage = String(group?.error_message || "");
    const httpStatus = normalizeHttpStatus(group?.http_status);
    const count = Number(group?.count || 0);
    if (count <= 0) continue;
    const failureReason = classifyFailureReason(errorType, httpStatus, errorMessage);
    summary.total_count += count;
    summary.by_type[errorType] = (summary.by_type[errorType] || 0) + count;
    summary.by_reason[failureReason] = (summary.by_reason[failureReason] || 0) + count;
    if (errorType === "parser_drift") summary.parser_drift_count += count;
    if (isParserAttentionError(errorType, errorMessage)) summary.parser_attention_count += count;
    if (SOURCE_POLICY_BLOCK_ERROR_TYPES.includes(errorType)) summary.source_policy_block_count += count;
    summary[`${failureReason}_count`] = Number(summary[`${failureReason}_count`] || 0) + count;
  }
  return summary;
}

function dominantFailureReason(summary = {}) {
  const entries = Object.entries(summary.by_reason || {})
    .filter(([, count]) => Number(count || 0) > 0)
    .sort((left, right) => Number(right[1] || 0) - Number(left[1] || 0) || left[0].localeCompare(right[0]));
  return entries[0]?.[0] || "";
}

function lastErrorFailureReason(row = {}) {
  const message = String(row?.last_error || "").trim();
  if (!message) return "";
  const reason = classifyFailureReason("unknown", row?.last_http_status, message);
  return reason || "";
}

function currentPolicyFailureReasonAdjustment(atsKey = "", reason = "", parserDriftRecheck = {}) {
  const rawReason = String(reason || "unknown").trim() || "unknown";
  if (rawReason !== "parser_bug") return null;
  const source = parserDriftRecheck?.by_source?.[String(atsKey || "").trim().toLowerCase()];
  if (!source) return null;
  const sampleCount = Math.max(0, Number(source.sample_count || 0));
  const emptyNoJobsCount = Math.max(0, Number(source.current_policy_empty_no_jobs_count || 0));
  const passCount = Math.max(0, Number(source.current_policy_pass_count || 0));
  const resolvedCount = Math.max(0, Number(source.current_policy_resolved_count || 0));
  const stillDriftCount = Math.max(0, Number(source.still_drift_count || 0));
  const skippedNoBaselineCount = Math.max(0, Number(source.skipped_no_baseline_count || 0));
  if (
    sampleCount <= 0 ||
    resolvedCount < sampleCount ||
    stillDriftCount > 0 ||
    skippedNoBaselineCount > 0
  ) {
    return null;
  }
  if (emptyNoJobsCount > 0 && emptyNoJobsCount >= sampleCount) {
    return {
      reason: "parser_drift_recheck_empty_no_jobs",
      raw_failure_reason: rawReason,
      adjusted_failure_reason: "empty_no_jobs",
      source_sample_count: sampleCount,
      current_policy_pass_count: passCount,
      current_policy_empty_no_jobs_count: emptyNoJobsCount,
      current_policy_resolved_count: resolvedCount,
      still_drift_count: stillDriftCount,
      skipped_no_baseline_count: skippedNoBaselineCount
    };
  }
  return {
    reason: "parser_drift_recheck_passed_current_policy",
    raw_failure_reason: rawReason,
    adjusted_failure_reason: "current_policy_resolved",
    source_sample_count: sampleCount,
    current_policy_pass_count: passCount,
    current_policy_empty_no_jobs_count: emptyNoJobsCount,
    current_policy_resolved_count: resolvedCount,
    still_drift_count: stillDriftCount,
    skipped_no_baseline_count: skippedNoBaselineCount
  };
}

function adjustRecentErrorSummaryForCurrentPolicy(recentErrors = {}, adjustment = null) {
  if (!adjustment) return recentErrors;
  const parserBugCount = Math.max(
    0,
    Number(recentErrors.parser_bug_count || recentErrors.by_reason?.parser_bug || 0)
  );
  if (parserBugCount <= 0) return recentErrors;
  const adjusted = {
    ...recentErrors,
    by_reason: { ...(recentErrors.by_reason || {}) },
    by_type: { ...(recentErrors.by_type || {}) },
    raw_by_reason: { ...(recentErrors.by_reason || {}) },
    current_policy_adjustment: adjustment
  };
  adjusted.parser_bug_count = Math.max(0, Number(adjusted.parser_bug_count || 0) - parserBugCount);
  adjusted.by_reason.parser_bug = Math.max(0, Number(adjusted.by_reason.parser_bug || 0) - parserBugCount);
  if (adjusted.by_reason.parser_bug === 0) delete adjusted.by_reason.parser_bug;
  if (adjustment.adjusted_failure_reason === "empty_no_jobs") {
    adjusted.empty_no_jobs_count = Number(adjusted.empty_no_jobs_count || 0) + parserBugCount;
    adjusted.by_reason.empty_no_jobs = Number(adjusted.by_reason.empty_no_jobs || 0) + parserBugCount;
  } else {
    adjusted.current_policy_resolved_count = Number(adjusted.current_policy_resolved_count || 0) + parserBugCount;
    adjusted.by_reason.current_policy_resolved = Number(adjusted.by_reason.current_policy_resolved || 0) + parserBugCount;
  }
  return adjusted;
}

function targetPressureNextAction(reason) {
  if (reason === "current_policy_resolved") return "wait for a new worker run before treating this historical parser drift as an active parser bug";
  if (reason === "parser_bug") return "add fixture and fix parser before counting this source as scalable";
  if (reason === "source_quality") return "review source evidence and quality gates before re-running at higher volume";
  if (reason === "rate_limit") return "review backoff, target pacing, and source rate limits before increasing volume";
  if (reason === "network") return "confirm network failure pattern before retrying at scale";
  if (reason === "empty_no_jobs") return "audit stale or empty boards so worker slots are not spent on no-job targets";
  if (reason === "auth") return "remove or quarantine inaccessible targets before increasing volume";
  if (reason === "unknown") return "classify unknown worker errors before changing throughput";
  return "keep target under observation";
}

function mergeReasonCounts(target, source = {}) {
  for (const [reason, count] of Object.entries(source || {})) {
    target[reason] = Number(target[reason] || 0) + Number(count || 0);
  }
}

function emptyNoJobsClassificationNextAction(className) {
  if (className === "real_empty_after_prior_success") {
    return "treat as likely real empty board; keep scheduled only if the source has recent useful output";
  }
  if (className === "stale_never_success_empty") {
    return "review stale never-success empty targets; quarantine or remove only after explicit approval; no source apply/backfill/reindex in audit";
  }
  if (className === "new_never_success_empty") {
    return "let new never-success empty targets age before cleanup decisions unless repeated failures continue";
  }
  return "review empty/no-jobs target classification before changing throughput";
}

function createEmptyNoJobsCleanupCandidates(staleDays = 7, sampleLimit = 5) {
  const boundedSampleLimit = Math.max(1, Math.min(25, Math.floor(Number(sampleLimit || 5))));
  return {
    read_only: true,
    write_actions_performed: false,
    requires_explicit_approval: true,
    criteria: {
      empty_no_jobs_class: "stale_never_success_empty",
      no_prior_success: true,
      stale_never_success_after_days: staleDays
    },
    candidate_count: 0,
    worker_slot_pressure: 0,
    recent_error_count: 0,
    sample_limit: boundedSampleLimit,
    sample_targets: [],
    review_groups: [],
    next_action: "review stale never-success empty targets for quarantine or removal only after explicit approval"
  };
}

function createEmptyNoJobsClassificationSummary(staleDays = 7, sampleLimit = 5) {
  const byClass = {};
  const boundedSampleLimit = Math.max(1, Math.min(25, Math.floor(Number(sampleLimit || 5))));
  for (const name of [
    "real_empty_after_prior_success",
    "stale_never_success_empty",
    "new_never_success_empty"
  ]) {
    byClass[name] = {
      target_count: 0,
      failure_pressure: 0,
      recent_error_count: 0,
      sample_targets: [],
      next_action: emptyNoJobsClassificationNextAction(name)
    };
  }
  return {
    read_only: true,
    stale_never_success_after_days: staleDays,
    sample_limit: boundedSampleLimit,
    total_targets: 0,
    failure_pressure: 0,
    recent_error_count: 0,
    cleanup_candidates: createEmptyNoJobsCleanupCandidates(staleDays, boundedSampleLimit),
    by_class: byClass
  };
}

function createEmptyNoJobsClassificationSample(row = {}) {
  return {
    ats_key: String(row.ats_key || "").trim().toLowerCase(),
    company_url: String(row.company_url || "").trim(),
    company_name: String(row.company_name || ""),
    protection_status: String(row.protection_status || "normal") || "normal",
    company_created_at: epochToIso(row.company_created_at_epoch),
    last_success_at: epochToIso(row.last_success_epoch),
    last_failure_at: epochToIso(row.last_failure_epoch),
    consecutive_failures: Number(row.consecutive_failures || 0),
    recent_error_count: Number(row.recent_error_count || 0),
    last_http_status: normalizeHttpStatus(row.last_http_status),
    last_error: String(row.last_error || "").slice(0, 240)
  };
}

function cleanupErrorSignature(row = {}) {
  const signature = String(row.last_error || "empty/no jobs")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .slice(0, 120);
  return signature || "empty/no jobs";
}

function addFailureReasonReviewGroup(groups = [], row = {}, reason = "", sample = {}, sampleLimit = 5) {
  const failureReason = String(reason || "unknown").trim() || "unknown";
  const atsKey = String(row.ats_key || sample.ats_key || "").trim().toLowerCase();
  const protectionStatus = String(row.protection_status || sample.protection_status || "normal") || "normal";
  const errorSignature = cleanupErrorSignature(row);
  const groupKey = `${failureReason}|${atsKey}|${protectionStatus}|${errorSignature}`;
  const boundedSampleLimit = Math.max(1, Math.min(25, Math.floor(Number(sampleLimit || 5))));
  const rawFailureReason = String(row.raw_failure_reason || sample.raw_failure_reason || "").trim();
  const currentPolicyAdjustment = row.current_policy_adjustment || sample.current_policy_adjustment || null;
  let group = groups.find((item) => item.group_key === groupKey);
  if (!group) {
    group = {
      group_key: groupKey,
      failure_reason: failureReason,
      ats_key: atsKey,
      protection_status: protectionStatus,
      error_signature: errorSignature,
      target_count: 0,
      failure_pressure: 0,
      recent_error_count: 0,
      sample_targets: []
    };
    groups.push(group);
  }
  if (rawFailureReason && rawFailureReason !== failureReason) {
    group.raw_failure_reason = rawFailureReason;
    group.current_policy_adjusted_failure_reason = failureReason;
    if (currentPolicyAdjustment) group.current_policy_adjustment = currentPolicyAdjustment;
  }
  group.target_count += 1;
  group.failure_pressure += Number(row.consecutive_failures || 0);
  group.recent_error_count += Number(row.recent_error_count || 0);
  if (group.sample_targets.length < boundedSampleLimit) {
    group.sample_targets.push(sample);
  }
}

function finalizeFailureReasonReviewGroups(groups = [], limit = 25) {
  const boundedLimit = Math.max(1, Math.min(100, Math.floor(Number(limit || 25))));
  return groups
    .sort((left, right) => (
      Number(right.failure_pressure || 0) - Number(left.failure_pressure || 0)
      || Number(right.target_count || 0) - Number(left.target_count || 0)
      || String(left.group_key || "").localeCompare(String(right.group_key || ""))
    ))
    .slice(0, boundedLimit);
}

function addEmptyNoJobsCleanupReviewGroup(cleanup, row = {}, sample = {}) {
  if (!cleanup) return;
  const sampleLimit = Math.max(1, Math.min(25, Math.floor(Number(cleanup.sample_limit || 5))));
  const atsKey = String(row.ats_key || sample.ats_key || "").trim().toLowerCase();
  const protectionStatus = String(row.protection_status || sample.protection_status || "normal") || "normal";
  const errorSignature = cleanupErrorSignature(row);
  const groupKey = `${atsKey}|${protectionStatus}|${errorSignature}`;
  let group = cleanup.review_groups.find((item) => item.group_key === groupKey);
  if (!group) {
    group = {
      group_key: groupKey,
      ats_key: atsKey,
      protection_status: protectionStatus,
      error_signature: errorSignature,
      candidate_count: 0,
      worker_slot_pressure: 0,
      recent_error_count: 0,
      sample_targets: []
    };
    cleanup.review_groups.push(group);
  }
  group.candidate_count += 1;
  group.worker_slot_pressure += Number(row.consecutive_failures || 0);
  group.recent_error_count += Number(row.recent_error_count || 0);
  if (group.sample_targets.length < sampleLimit) {
    group.sample_targets.push(sample);
  }
}

function finalizeEmptyNoJobsClassificationSummary(summary) {
  const cleanup = summary?.cleanup_candidates;
  if (!cleanup) return summary;
  cleanup.group_count = cleanup.review_groups.length;
  cleanup.review_groups.sort((left, right) => (
    Number(right.worker_slot_pressure || 0) - Number(left.worker_slot_pressure || 0)
    || Number(right.candidate_count || 0) - Number(left.candidate_count || 0)
    || String(left.group_key || "").localeCompare(String(right.group_key || ""))
  ));
  return summary;
}

function addEmptyNoJobsClassification(summary, className, row = {}) {
  if (!summary || !className || !summary.by_class[className]) return;
  const consecutiveFailures = Number(row.consecutive_failures || 0);
  const recentErrorCount = Number(row.recent_error_count || 0);
  const classSummary = summary.by_class[className];
  const sample = createEmptyNoJobsClassificationSample(row);
  summary.total_targets += 1;
  summary.failure_pressure += consecutiveFailures;
  summary.recent_error_count += recentErrorCount;
  classSummary.target_count += 1;
  classSummary.failure_pressure += consecutiveFailures;
  classSummary.recent_error_count += recentErrorCount;
  const sampleLimit = Math.max(1, Math.min(25, Math.floor(Number(summary.sample_limit || 5))));
  if (classSummary.sample_targets.length < sampleLimit) {
    classSummary.sample_targets.push(sample);
  }
  if (className === "stale_never_success_empty" && summary.cleanup_candidates) {
    const cleanup = summary.cleanup_candidates;
    cleanup.candidate_count += 1;
    cleanup.worker_slot_pressure += consecutiveFailures;
    cleanup.recent_error_count += recentErrorCount;
    const cleanupSampleLimit = Math.max(1, Math.min(25, Math.floor(Number(cleanup.sample_limit || sampleLimit))));
    if (cleanup.sample_targets.length < cleanupSampleLimit) {
      cleanup.sample_targets.push(sample);
    }
    addEmptyNoJobsCleanupReviewGroup(cleanup, row, sample);
  }
}

function classifyEmptyNoJobsTarget(row = {}, recentErrors = {}, reason = "", options = {}) {
  const emptyCount = Number(recentErrors?.empty_no_jobs_count || recentErrors?.by_reason?.empty_no_jobs || 0);
  if (reason !== "empty_no_jobs" && emptyCount <= 0) return "";
  if (Number(row.last_success_epoch || 0) > 0) return "real_empty_after_prior_success";
  const nowEpoch = Math.max(0, Math.floor(Number(options.nowEpoch || Math.floor(Date.now() / 1000))));
  const staleDays = Math.max(1, Math.min(365, Math.floor(Number(options.emptyNoJobsStaleDays || 7))));
  const companyCreatedAtEpoch = Number(row.company_created_at_epoch || 0);
  if (companyCreatedAtEpoch > 0 && nowEpoch - companyCreatedAtEpoch < staleDays * 86400) {
    return "new_never_success_empty";
  }
  return "stale_never_success_empty";
}

function extractEmptyNoJobsProbeSignals(html = "") {
  const raw = String(html || "");
  const text = raw
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  return {
    has_no_positions_token: /%LABEL_NO_POSITIONS%|LABEL_NO_POSITIONS/i.test(raw),
    has_no_openings_copy: [
      /no open positions/,
      /no current openings/,
      /currently no open/,
      /not currently hiring/,
      /there are no jobs/,
      /check back later/,
      /no positions available/
    ].some((pattern) => pattern.test(text)),
    has_job_link: /href=["'][^"']*\/p\/[^"']+["']|https?:\/\/[^"']*\.breezy\.hr\/p\//i.test(raw),
    has_breezy_marker: /breezy|breezy\.hr|breezy-portal/i.test(raw),
    has_position_card_marker: /position-card|positions-list|bzy-positions|job-list|opening/i.test(raw)
  };
}

function classifyEmptyNoJobsSourceProbe(probe = {}) {
  const status = normalizeHttpStatus(probe.status);
  const parseCount = Math.max(0, Math.floor(Number(probe.parseCount || 0)));
  const fetchError = String(probe.fetchError || "").trim();
  const signals = extractEmptyNoJobsProbeSignals(probe.html || "");
  let classification = "unknown";
  if (fetchError) classification = "network_or_fetch_error";
  else if (status === 429) classification = "rate_limited";
  else if (status === 401 || status === 403) classification = "auth_or_blocked";
  else if (status === 404 || status === 410) classification = "stale_removed_or_bad_target";
  else if (status >= 500) classification = "source_server_error";
  else if (parseCount > 0) classification = "current_parser_success_previous_failure_stale";
  else if (status >= 200 && status < 300 && (signals.has_no_positions_token || signals.has_no_openings_copy) && !signals.has_job_link) {
    classification = "source_reported_empty_board";
  } else if (status >= 200 && status < 300 && signals.has_job_link) {
    classification = "parser_bug_candidate";
  } else if (status >= 200 && status < 300 && signals.has_breezy_marker) {
    classification = "unsupported_or_empty_breezy_shape";
  } else if (status >= 200 && status < 300) {
    classification = "non_breezy_or_unrecognized_empty_shape";
  }
  return {
    classification,
    signals
  };
}

async function readProbeResponseBody(response = {}) {
  if (typeof response.text === "function") return response.text();
  if (typeof response.html === "string") return response.html;
  if (typeof response.body === "string") return response.body;
  return "";
}

async function fetchProbeResponse(url, options = {}) {
  if (typeof options.fetcher === "function") return options.fetcher(url);
  const timeoutMs = Math.max(1000, Math.min(30000, Math.floor(Number(options.probeEmptyTargetTimeoutMs || 12000))));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: {
        "user-agent": "OpenJobSlotsAudit/1.0 (+https://openjobslots.com; read-only)",
        accept: "text/html,application/xhtml+xml"
      }
    });
  } finally {
    clearTimeout(timer);
  }
}

async function probeEmptyNoJobsTargets(rows = [], options = {}) {
  const limit = Math.max(1, Math.min(50, Math.floor(Number(options.probeEmptyTargetLimit || 10))));
  const getSourceModule = typeof options.getSourceModule === "function"
    ? options.getSourceModule
    : require("../server/ingestion/sources").getSourceModule;
  const candidates = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const groups = parseRecentErrorGroups(row?.recent_error_groups);
    const recentErrors = summarizeRecentErrorGroups(groups);
    const reason = dominantFailureReason(recentErrors) || lastErrorFailureReason(row);
    if (reason !== "empty_no_jobs") continue;
    candidates.push(row);
    if (candidates.length >= limit) break;
  }

  const samples = [];
  const byClassification = {};
  for (const row of candidates) {
    const atsKey = String(row?.ats_key || "").trim().toLowerCase();
    const companyUrl = String(row?.company_url || "").trim();
    const source = getSourceModule(atsKey);
    let status = 0;
    let finalUrl = companyUrl;
    let html = "";
    let parseCount = 0;
    let parserError = "";
    let fetchError = "";

    if (!source || typeof source.parse !== "function") {
      fetchError = "source module unavailable for empty target probe";
    } else {
      try {
        const response = await fetchProbeResponse(companyUrl, options);
        status = normalizeHttpStatus(response?.status);
        finalUrl = String(response?.url || companyUrl);
        html = await readProbeResponseBody(response);
        try {
          const parsed = source.parse({
            html,
            __listUrl: finalUrl || companyUrl
          }, {
            url_string: companyUrl,
            company_name: String(row?.company_name || ""),
            ATS_name: atsKey
          });
          parseCount = Array.isArray(parsed) ? parsed.length : 0;
        } catch (error) {
          parserError = String(error?.message || error || "").slice(0, 240);
        }
      } catch (error) {
        fetchError = String(error?.message || error || "").slice(0, 240);
      }
    }

    const classification = classifyEmptyNoJobsSourceProbe({
      status,
      html,
      parseCount,
      fetchError
    });
    byClassification[classification.classification] = Number(byClassification[classification.classification] || 0) + 1;
    samples.push({
      ats_key: atsKey,
      company_url: companyUrl,
      company_name: String(row?.company_name || ""),
      stored_last_error: String(row?.last_error || "").slice(0, 240),
      consecutive_failures: Number(row?.consecutive_failures || 0),
      recent_error_count: Number(row?.recent_error_count || 0),
      http_status: status,
      final_url: finalUrl,
      html_bytes: Buffer.byteLength(html || "", "utf8"),
      parse_count: parseCount,
      parser_error: parserError,
      fetch_error: fetchError,
      classification: classification.classification,
      signals: classification.signals
    });
  }

  return {
    read_only: true,
    write_actions_performed: false,
    requires_explicit_approval_for_cleanup: true,
    sampled_target_count: samples.length,
    sample_limit: limit,
    by_classification: byClassification,
    samples,
    next_action: "use source-reported empty boards as cleanup candidates only after explicit approval; parser_bug_candidate requires fixture-backed parser work"
  };
}

function summarizeTargetFailurePressureRows(rows = [], options = {}) {
  const errorWindowHours = Math.max(1, Math.min(168, Math.floor(Number(options.errorWindowHours || 24))));
  const limit = Math.max(1, Math.min(100, Math.floor(Number(options.targetPressureLimit || options.limit || 25))));
  const staleDays = Math.max(1, Math.min(365, Math.floor(Number(options.emptyNoJobsStaleDays || 7))));
  const emptyNoJobsSampleLimit = Math.max(1, Math.min(25, Math.floor(Number(options.emptyNoJobsSampleLimit || 5))));
  const bySource = {};
  const topTargets = [];
  const failureReasonReviewGroups = [];
  const emptyNoJobsClassification = createEmptyNoJobsClassificationSummary(staleDays, emptyNoJobsSampleLimit);
  let failurePressure = 0;
  let recentErrorCount = 0;

  for (const row of Array.isArray(rows) ? rows : []) {
    const atsKey = String(row?.ats_key || "").trim().toLowerCase();
    const companyUrl = String(row?.company_url || "").trim();
    if (!atsKey || !companyUrl) continue;
    const groups = parseRecentErrorGroups(row.recent_error_groups);
    const recentErrors = summarizeRecentErrorGroups(groups);
    const consecutiveFailures = Number(row?.consecutive_failures || 0);
    const rowRecentErrorCount = Number(row?.recent_error_count || recentErrors.total_count || 0);
    const rawReason = dominantFailureReason(recentErrors) || lastErrorFailureReason(row);
    const currentPolicyAdjustment = currentPolicyFailureReasonAdjustment(
      atsKey,
      rawReason,
      options.parserDriftRecheck
    );
    const reason = currentPolicyAdjustment?.adjusted_failure_reason || rawReason;
    const reportRecentErrors = adjustRecentErrorSummaryForCurrentPolicy(recentErrors, currentPolicyAdjustment);

    failurePressure += consecutiveFailures;
    recentErrorCount += rowRecentErrorCount;
    if (!bySource[atsKey]) {
      bySource[atsKey] = {
        target_count: 0,
        failure_pressure: 0,
        recent_error_count: 0,
        empty_no_jobs_classification: createEmptyNoJobsClassificationSummary(staleDays, emptyNoJobsSampleLimit),
        failure_reason_review_groups: [],
        by_reason: {}
      };
    }
    bySource[atsKey].target_count += 1;
    bySource[atsKey].failure_pressure += consecutiveFailures;
    bySource[atsKey].recent_error_count += rowRecentErrorCount;
    mergeReasonCounts(bySource[atsKey].by_reason, reportRecentErrors.by_reason);
    if (reason && reportRecentErrors.total_count <= 0) {
      bySource[atsKey].by_reason[reason] = Number(bySource[atsKey].by_reason[reason] || 0) + 1;
    }
    const emptyNoJobsClass = classifyEmptyNoJobsTarget(row, reportRecentErrors, reason, options);
    if (emptyNoJobsClass) {
      const classificationRow = {
        ats_key: atsKey,
        company_url: companyUrl,
        company_name: String(row?.company_name || ""),
        protection_status: String(row?.protection_status || "normal") || "normal",
        company_created_at_epoch: Number(row?.company_created_at_epoch || 0),
        last_success_epoch: Number(row?.last_success_epoch || 0),
        last_failure_epoch: Number(row?.last_failure_epoch || 0),
        consecutive_failures: consecutiveFailures,
        recent_error_count: rowRecentErrorCount,
        last_http_status: row?.last_http_status,
        last_error: String(row?.last_error || "")
      };
      addEmptyNoJobsClassification(emptyNoJobsClassification, emptyNoJobsClass, classificationRow);
      addEmptyNoJobsClassification(bySource[atsKey].empty_no_jobs_classification, emptyNoJobsClass, classificationRow);
    }
    const reviewSample = {
      ...createEmptyNoJobsClassificationSample({
        ats_key: atsKey,
        company_url: companyUrl,
        company_name: String(row?.company_name || ""),
        protection_status: String(row?.protection_status || "normal") || "normal",
        company_created_at_epoch: Number(row?.company_created_at_epoch || 0),
        last_success_epoch: Number(row?.last_success_epoch || 0),
        last_failure_epoch: Number(row?.last_failure_epoch || 0),
        consecutive_failures: consecutiveFailures,
        recent_error_count: rowRecentErrorCount,
        last_http_status: row?.last_http_status,
        last_error: String(row?.last_error || "")
      }),
      ...(currentPolicyAdjustment
        ? {
            raw_failure_reason: rawReason,
            current_policy_adjusted_failure_reason: reason,
            current_policy_adjustment: currentPolicyAdjustment
          }
        : {})
    };
    const reviewRow = {
      ats_key: atsKey,
      protection_status: String(row?.protection_status || "normal") || "normal",
      consecutive_failures: consecutiveFailures,
      recent_error_count: rowRecentErrorCount,
      last_error: String(row?.last_error || ""),
      ...(currentPolicyAdjustment
        ? {
            raw_failure_reason: rawReason,
            current_policy_adjusted_failure_reason: reason,
            current_policy_adjustment: currentPolicyAdjustment
          }
        : {})
    };
    addFailureReasonReviewGroup(failureReasonReviewGroups, reviewRow, reason || "unknown", reviewSample, emptyNoJobsSampleLimit);
    addFailureReasonReviewGroup(bySource[atsKey].failure_reason_review_groups, reviewRow, reason || "unknown", reviewSample, emptyNoJobsSampleLimit);

    const topTarget = {
      ats_key: atsKey,
      company_url: companyUrl,
      company_name: String(row?.company_name || ""),
      protection_status: String(row?.protection_status || "normal") || "normal",
      next_sync_epoch: Number(row?.next_sync_epoch || 0),
      next_sync_at: epochToIso(row?.next_sync_epoch),
      last_success_epoch: Number(row?.last_success_epoch || 0),
      last_success_at: epochToIso(row?.last_success_epoch),
      last_failure_epoch: Number(row?.last_failure_epoch || 0),
      last_failure_at: epochToIso(row?.last_failure_epoch),
      consecutive_failures: consecutiveFailures,
      last_http_status: normalizeHttpStatus(row?.last_http_status),
      last_error: String(row?.last_error || ""),
      recent_error_count: rowRecentErrorCount,
      recent_errors: reportRecentErrors,
      dominant_failure_reason: reason,
      empty_no_jobs_class: emptyNoJobsClass || null,
      next_action: targetPressureNextAction(reason)
    };
    if (currentPolicyAdjustment) {
      topTarget.raw_dominant_failure_reason = rawReason;
      topTarget.raw_recent_errors = recentErrors;
      topTarget.current_policy_adjustment = currentPolicyAdjustment;
    }
    topTargets.push(topTarget);
  }

  finalizeEmptyNoJobsClassificationSummary(emptyNoJobsClassification);
  for (const source of Object.values(bySource)) {
    source.dominant_failure_reason = dominantFailureReason({ by_reason: source.by_reason });
    finalizeEmptyNoJobsClassificationSummary(source.empty_no_jobs_classification);
    source.failure_reason_review_group_count = source.failure_reason_review_groups.length;
    source.failure_reason_review_groups = finalizeFailureReasonReviewGroups(source.failure_reason_review_groups, limit);
  }

  return {
    read_only: true,
    error_window_hours: errorWindowHours,
    sample_limit: limit,
    target_count: topTargets.length,
    failure_pressure: failurePressure,
    recent_error_count: recentErrorCount,
    empty_no_jobs_classification: emptyNoJobsClassification,
    failure_reason_review_group_count: failureReasonReviewGroups.length,
    failure_reason_review_groups: finalizeFailureReasonReviewGroups(failureReasonReviewGroups, limit),
    by_source: bySource,
    top_targets: topTargets.slice(0, limit)
  };
}

function attachBacklogDiagnostics(report, options = {}) {
  const recentByAts = summarizeRecentErrors(options.recentErrorRows || []);
  const sourceBudgetUsageByAts = summarizeSourceBudgetUsageRows(options.sourceBudgetUsageRows || [], options);
  const targetAtsKeys = Array.isArray(options.targetAtsKeys) ? options.targetAtsKeys : [];
  const errorWindowHours = Math.max(1, Math.min(168, Math.floor(Number(options.errorWindowHours || 24))));
  const parserAttentionCount = Array.from(recentByAts.values())
    .reduce((sum, item) => sum + Number(item.parser_attention_count || 0), 0);
  const sourcePolicyBlockCount = Array.from(recentByAts.values())
    .reduce((sum, item) => sum + Number(item.source_policy_block_count || 0), 0);
  const failureReasonCounts = createFailureReasonCounts();
  for (const item of recentByAts.values()) {
    for (const [reason, count] of Object.entries(item.by_reason || {})) {
      addFailureReasonCount(failureReasonCounts, reason, count);
    }
  }
  const failureReasonCountsByScope = summarizeFailureReasonCountsByScope(options.scopedRecentErrorRows || []);
  const latestRunRows = Array.isArray(options.latestRunRows) ? options.latestRunRows : [];
  const latestRun = summarizeLatestRun(latestRunRows[0] || options.latestRun || {});
  const latestRunBySource = summarizeLatestRunBySourceRows(options.latestRunBySourceRows || []);
  const latestRunFailureReasonsByAts = summarizeRecentErrors(options.latestRunFailureReasonRows || []);
  for (const [atsKey, failureReasons] of latestRunFailureReasonsByAts.entries()) {
    latestRunBySource[atsKey] = {
      ...(latestRunBySource[atsKey] || emptyLatestRunBySourceSummary(latestRun.latest_run_id)),
      failure_reasons: failureReasons
    };
  }
  for (const [atsKey, summary] of Object.entries(latestRunBySource)) {
    if (!summary.failure_reasons) {
      latestRunBySource[atsKey] = {
        ...summary,
        failure_reasons: emptyRecentErrorSummary()
      };
    }
  }
  const autoSyncBudgetUsage = summarizeAutoSyncBudgetUsage(options.autoSyncBudgetUsageRows || [], options);
  const recentRunTrend = summarizeRecentRunTrendRows(options.recentRunTrendRows || [], options);
  const recentRunTrendBySource = summarizeRecentRunTrendBySourceRows(options.recentRunTrendBySourceRows || [], options);
  const parserDriftRecheck = summarizeParserDriftRecheck(options.parserDriftRecheckRows || [], options);
  const adjustedFailureReasonCounts = adjustFailureReasonCountsForParserDriftRecheck(
    failureReasonCounts,
    parserDriftRecheck
  );
  const adjustedFailureReasonCountsByScope = adjustFailureReasonCountsByScopeForParserDriftRecheck(
    failureReasonCountsByScope,
    parserDriftRecheck
  );
  const targetFailurePressure = summarizeTargetFailurePressureRows(options.targetFailurePressureRows || [], {
    ...options,
    parserDriftRecheck
  });
  const targetAtsPatchEffect = summarizeTargetAtsPatchEffect({
    targetAtsKeys,
    latestRun,
    latestRunBySource,
    recentRunTrendBySource,
    autoSyncBudgetUsage
  });
  const workerSuccessRecoveryPriorities = buildWorkerSuccessRecoveryPriorities({
    items: report.items || [],
    recentByAts,
    recentRunTrendBySource,
    parserDriftRecheck,
    options
  });
  const gateLatestRun = selectGateLatestRun(latestRun, recentRunTrendBySource, targetAtsKeys);
  const gateRecentRunTrend = selectGateRecentRunTrend(recentRunTrend, recentRunTrendBySource, targetAtsKeys);
  const throughputScalingGate = buildThroughputScalingGate({
    latestRun: gateLatestRun,
    recentRunTrend: gateRecentRunTrend,
    parserAttentionCount,
    failureReasonCounts,
    targetFailureReasonCounts: failureReasonCountsByScope.target_failure,
    postingRejectionReasonCounts: failureReasonCountsByScope.posting_rejection,
    parserDriftRecheck,
    totals: report.totals || {},
    options
  });
  return {
    ...report,
    diagnostics: {
      read_only: true,
      error_window_hours: errorWindowHours,
      target_ats_keys: targetAtsKeys,
      parser_attention_count: parserAttentionCount,
      source_policy_block_count: sourcePolicyBlockCount,
      failure_reason_counts: failureReasonCounts,
      failure_reason_counts_by_scope: failureReasonCountsByScope,
      current_policy_adjusted_failure_reason_counts: adjustedFailureReasonCounts.counts,
      parser_drift_recheck_adjustments: adjustedFailureReasonCounts.adjustments,
      current_policy_adjusted_failure_reason_counts_by_scope: adjustedFailureReasonCountsByScope,
      latest_run: latestRun,
      recent_run_trend: recentRunTrend,
      recent_run_trend_by_source: recentRunTrendBySource,
      latest_run_by_source: latestRunBySource,
      target_ats_patch_effect: targetAtsPatchEffect,
      worker_success_recovery_priorities: workerSuccessRecoveryPriorities,
      auto_sync_budget_usage: autoSyncBudgetUsage,
      parser_drift_recheck: parserDriftRecheck,
      target_failure_pressure: targetFailurePressure,
      ...(options.emptyNoJobsSourceProbe
        ? { empty_no_jobs_source_probe: options.emptyNoJobsSourceProbe }
        : {}),
      throughput_scaling_gate: throughputScalingGate,
      error_taxonomy: {
        failure_reason_buckets: [...FAILURE_REASON_BUCKETS],
        failure_reason_types: [...WORKER_FAILURE_REASON_TAXONOMY],
        parser_attention_types: [...PARSER_ATTENTION_ERROR_TYPES],
        legacy_parser_attention_types: [...LEGACY_PARSER_ATTENTION_ERROR_TYPES],
        source_policy_block_types: [...SOURCE_POLICY_BLOCK_ERROR_TYPES]
      }
    },
    items: (report.items || []).map((item) => {
      const atsKey = String(item.ats_key || "").trim().toLowerCase();
      return {
        ...item,
        latest_run: latestRunBySource[atsKey] || emptyLatestRunBySourceSummary(latestRun.latest_run_id),
        recent_run_trend: recentRunTrendBySource[atsKey] || null,
        source_daily_budget_usage: sourceBudgetUsageByAts.get(atsKey) || sourceBudgetUsageSummary(0, options),
        recent_errors: recentByAts.get(atsKey) || emptyRecentErrorSummary(),
        fixture_coverage: getFixtureCoverage(atsKey, options)
      };
    })
  };
}

async function runPostgresBacklogAudit(pool, options = {}) {
  const nowEpoch = Math.max(0, Math.floor(Number(options.nowEpoch || Math.floor(Date.now() / 1000))));
  const query = buildWorkerBacklogQuery({ ...options, nowEpoch });
  const result = await pool.query(query.sql, query.values);
  const summary = summarizeBacklogRows(result.rows, options);
  const report = {
    ok: true,
    db_backend: "postgres",
    read_only: true,
    generated_at_epoch: nowEpoch,
    filters: {
      limit: query.values[1],
      target_ats_keys: query.values[2]
    },
    ...summary
  };
  if (!options.diagnostics) return report;
  const recentErrorsQuery = buildRecentErrorsQuery(options);
  const recentErrors = await pool.query(recentErrorsQuery.sql, recentErrorsQuery.values);
  const recentErrorScopeQuery = buildRecentErrorScopeQuery(options);
  const recentErrorScope = await pool.query(recentErrorScopeQuery.sql, recentErrorScopeQuery.values);
  const latestRunQuery = buildLatestRunSummaryQuery();
  const latestRun = await pool.query(latestRunQuery.sql, latestRunQuery.values);
  const recentRunTrendQuery = buildRecentRunTrendQuery(options);
  const recentRunTrend = await pool.query(recentRunTrendQuery.sql, recentRunTrendQuery.values);
  const recentRunTrendBySourceQuery = buildRecentRunTrendBySourceQuery(options);
  const recentRunTrendBySource = await pool.query(recentRunTrendBySourceQuery.sql, recentRunTrendBySourceQuery.values);
  const latestRunBySourceQuery = buildLatestRunBySourceQuery(options);
  const latestRunBySource = await pool.query(latestRunBySourceQuery.sql, latestRunBySourceQuery.values);
  const latestRunFailureReasonsQuery = buildLatestRunFailureReasonsQuery(options);
  const latestRunFailureReasons = await pool.query(latestRunFailureReasonsQuery.sql, latestRunFailureReasonsQuery.values);
  const autoSyncBudgetUsageQuery = buildAutoSyncBudgetUsageQuery({ ...options, nowEpoch });
  const autoSyncBudgetUsage = await pool.query(autoSyncBudgetUsageQuery.sql, autoSyncBudgetUsageQuery.values);
  const sourceBudgetUsageQuery = buildSourceBudgetUsageQuery({ ...options, nowEpoch });
  const sourceBudgetUsage = await pool.query(sourceBudgetUsageQuery.sql, sourceBudgetUsageQuery.values);
  const parserDriftRecheckQuery = buildParserDriftRecheckQuery(options);
  const parserDriftRecheck = await pool.query(parserDriftRecheckQuery.sql, parserDriftRecheckQuery.values);
  const targetFailurePressureQuery = buildTargetFailurePressureQuery({ ...options, nowEpoch });
  const targetFailurePressure = await pool.query(targetFailurePressureQuery.sql, targetFailurePressureQuery.values);
  const emptyNoJobsSourceProbe = options.probeEmptyTargets
    ? await probeEmptyNoJobsTargets(targetFailurePressure.rows, options)
    : null;
  return attachBacklogDiagnostics(report, {
    ...options,
    nowEpoch,
    recentErrorRows: recentErrors.rows,
    scopedRecentErrorRows: recentErrorScope.rows,
    latestRunRows: latestRun.rows,
    recentRunTrendRows: recentRunTrend.rows,
    recentRunTrendBySourceRows: recentRunTrendBySource.rows,
    latestRunBySourceRows: latestRunBySource.rows,
    latestRunFailureReasonRows: latestRunFailureReasons.rows,
    autoSyncBudgetUsageRows: autoSyncBudgetUsage.rows,
    sourceBudgetUsageRows: sourceBudgetUsage.rows,
    parserDriftRecheckRows: parserDriftRecheck.rows,
    targetFailurePressureRows: targetFailurePressure.rows,
    emptyNoJobsSourceProbe
  });
}

function writeOutput(report, outputPath) {
  if (!outputPath) return;
  const resolved = path.resolve(outputPath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, `${JSON.stringify(report, null, 2)}\n`);
}

function formatEpoch(epoch) {
  const value = Number(epoch || 0);
  return value > 0 ? new Date(value * 1000).toISOString() : "";
}

function printReport(report) {
  console.log("OpenJobSlots worker backlog audit");
  console.log(`Backend: ${report.db_backend}`);
  console.log(`Due: ${report.totals.due_count} total, ${report.totals.runnable_due_count} runnable`);
  console.log(`Oldest due: ${formatEpoch(report.totals.oldest_due_epoch) || "n/a"}`);
  console.log(`Estimated days to clear: ${report.daily_budget_projection.estimated_days_to_clear ?? "n/a"}`);
  console.table((report.items || []).slice(0, 30).map((item) => ({
    ats: item.ats_key,
    enabled: item.enabled,
    state: item.protection_status,
    targets: item.target_count,
    due: item.due_count,
    runnable_due: item.runnable_due_count,
    oldest_due: formatEpoch(item.oldest_due_epoch),
    failing_due: item.failing_due_count,
    failure_pressure: item.failure_pressure
  })));
}

async function runAudit(options = parseBacklogArgs(), env = process.env) {
  const dbBackend = String(env.OPENJOBSLOTS_DB_BACKEND || "sqlite").trim().toLowerCase();
  if (dbBackend !== "postgres") {
    throw new Error("Worker backlog audit requires OPENJOBSLOTS_DB_BACKEND=postgres.");
  }
  const pool = createPostgresPool({ enabled: true, connectionString: env.DATABASE_URL || env.POSTGRES_URL || "" });
  try {
    return await runPostgresBacklogAudit(pool, options);
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  const options = parseBacklogArgs(process.argv.slice(2));
  runAudit(options)
    .then((report) => {
      writeOutput(report, options.output);
      if (options.json) {
        console.log(JSON.stringify(report, null, 2));
        return;
      }
      printReport(report);
    })
    .catch((error) => {
      console.error(error?.stack || error);
      process.exit(1);
    });
}

module.exports = {
  attachBacklogDiagnostics,
  adjustFailureReasonCountsByScopeForParserDriftRecheck,
  adjustFailureReasonCountsForParserDriftRecheck,
  buildAutoSyncBudgetUsageQuery,
  buildLatestRunFailureReasonsQuery,
  buildLatestRunBySourceQuery,
  buildLatestRunSummaryQuery,
  buildParserDriftRecheckQuery,
  buildRecentErrorScopeQuery,
  buildRecentErrorsQuery,
  buildRecentRunTrendQuery,
  buildRecentRunTrendBySourceQuery,
  buildSourceBudgetUsageQuery,
  buildTargetFailurePressureQuery,
  buildThroughputScalingGate,
  buildWorkerBacklogQuery,
  classifyEmptyNoJobsSourceProbe,
  classifyFailureReason,
  getFixtureCoverage,
  parseBacklogArgs,
  probeEmptyNoJobsTargets,
  runAudit,
  runPostgresBacklogAudit,
  summarizeAutoSyncBudgetUsage,
  summarizeFailureReasonCountsByScope,
  summarizeLatestRunBySourceRows,
  summarizeRecentRunTrendRows,
  summarizeRecentRunTrendBySourceRows,
  summarizeSourceBudgetUsageRows,
  summarizeTargetFailurePressureRows,
  summarizeParserDriftRecheck,
  summarizeBacklogRows,
  writeOutput
};
