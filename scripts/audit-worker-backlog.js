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
    targetAtsKeys: []
  };
  for (const arg of argv) {
    if (arg === "--json") options.json = true;
    else if (arg === "--diagnostics") options.diagnostics = true;
    else if (arg.startsWith("--targets=")) options.targetAtsKeys = parseTargetAtsKeys(arg.slice("--targets=".length));
    else if (arg === "--targets") options.expectTargets = true;
    else if (arg.startsWith("--error-window-hours=")) options.errorWindowHours = Number(arg.slice("--error-window-hours=".length));
    else if (arg === "--error-window-hours") options.expectErrorWindowHours = true;
    else if (arg.startsWith("--limit=")) options.limit = Number(arg.slice("--limit=".length));
    else if (arg === "--limit") options.expectLimit = true;
    else if (arg.startsWith("--recent-run-limit=")) options.recentRunLimit = Number(arg.slice("--recent-run-limit=".length));
    else if (arg === "--recent-run-limit") options.expectRecentRunLimit = true;
    else if (arg.startsWith("--now-epoch=")) options.nowEpoch = Number(arg.slice("--now-epoch=".length));
    else if (arg === "--now-epoch") options.expectNowEpoch = true;
    else if (arg.startsWith("--output=")) options.output = arg.slice("--output=".length);
    else if (options.expectLimit) {
      options.limit = Number(arg);
      options.expectLimit = false;
    } else if (options.expectRecentRunLimit) {
      options.recentRunLimit = Number(arg);
      options.expectRecentRunLimit = false;
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

function isSourceQualityValidationMessage(message) {
  const text = String(message || "").trim().toLowerCase();
  return text.includes("no_geo_no_remote") ||
    text.includes("ambiguous_location") ||
    text.includes("weak_remote_evidence") ||
    text.includes("no_normalized_geo_or_explicit_remote");
}

function classifyFailureReason(errorType, httpStatus = 0, errorMessage = "") {
  const type = String(errorType || "unknown").trim().toLowerCase() || "unknown";
  const status = normalizeHttpStatus(httpStatus);
  const message = String(errorMessage || "").trim().toLowerCase();
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

function normalizeParserDriftRecheckForGate(value = {}) {
  return {
    sample_count: Number(value?.sample_count || 0),
    still_drift_count: Number(value?.still_drift_count || 0),
    current_policy_pass_count: Number(value?.current_policy_pass_count || 0),
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
  const parserDriftFullyCurrentPolicyPass = parserDriftRecheckHasCoverage &&
    parserDriftRecheckSummary.still_drift_count === 0 &&
    parserDriftRecheckSummary.skipped_no_baseline_count === 0;
  const parserAttentionFullyRechecked = parserDriftFullyCurrentPolicyPass &&
    parserDriftRecheckSummary.current_policy_pass_count >= parserAttentionTotal;
  const parserBugFailuresFullyRechecked = parserDriftFullyCurrentPolicyPass &&
    parserDriftRecheckSummary.current_policy_pass_count >= parserBugTargetFailureCount;

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

  if (parserAttentionTotal > parserAttentionThreshold && !parserAttentionFullyRechecked) {
    blockers.push({
      code: "parser_attention_present",
      message: `Parser attention count ${parserAttentionTotal} is above the ${parserAttentionThreshold} threshold.`,
      current_policy_pass_count: parserDriftRecheckSummary.current_policy_pass_count,
      still_drift_count: parserDriftRecheckSummary.still_drift_count,
      skipped_no_baseline_count: parserDriftRecheckSummary.skipped_no_baseline_count,
      unrechecked_or_non_drift_count: Math.max(0, parserAttentionTotal - parserDriftRecheckSummary.current_policy_pass_count)
    });
  }

  const blockingFailureReasons = ["parser_bug", "source_quality", "rate_limit", "network", "auth", "unknown"];
  for (const reason of blockingFailureReasons) {
    const count = Number(targetFailureCounts?.[reason] || 0);
    if (count > 0) {
      if (reason === "parser_bug" && parserBugFailuresFullyRechecked) continue;
      blockers.push({
        code: `${reason}_failures_present`,
        message: `${reason} target failures are present in the diagnostics window.`,
        count,
        ...(reason === "parser_bug"
          ? {
              current_policy_pass_count: parserDriftRecheckSummary.current_policy_pass_count,
              still_drift_count: parserDriftRecheckSummary.still_drift_count,
              skipped_no_baseline_count: parserDriftRecheckSummary.skipped_no_baseline_count,
              unrechecked_or_non_drift_count: Math.max(0, count - parserDriftRecheckSummary.current_policy_pass_count)
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

function createParserDriftRecheckSourceSummary() {
  return {
    sample_count: 0,
    still_drift_count: 0,
    current_policy_pass_count: 0,
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
      source.current_policy_pass_count += 1;
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

function targetPressureNextAction(reason) {
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

function summarizeTargetFailurePressureRows(rows = [], options = {}) {
  const errorWindowHours = Math.max(1, Math.min(168, Math.floor(Number(options.errorWindowHours || 24))));
  const limit = Math.max(1, Math.min(100, Math.floor(Number(options.targetPressureLimit || options.limit || 25))));
  const staleDays = Math.max(1, Math.min(365, Math.floor(Number(options.emptyNoJobsStaleDays || 7))));
  const emptyNoJobsSampleLimit = Math.max(1, Math.min(25, Math.floor(Number(options.emptyNoJobsSampleLimit || 5))));
  const bySource = {};
  const topTargets = [];
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
    const reason = dominantFailureReason(recentErrors) || lastErrorFailureReason(row);

    failurePressure += consecutiveFailures;
    recentErrorCount += rowRecentErrorCount;
    if (!bySource[atsKey]) {
      bySource[atsKey] = {
        target_count: 0,
        failure_pressure: 0,
        recent_error_count: 0,
        empty_no_jobs_classification: createEmptyNoJobsClassificationSummary(staleDays, emptyNoJobsSampleLimit),
        by_reason: {}
      };
    }
    bySource[atsKey].target_count += 1;
    bySource[atsKey].failure_pressure += consecutiveFailures;
    bySource[atsKey].recent_error_count += rowRecentErrorCount;
    mergeReasonCounts(bySource[atsKey].by_reason, recentErrors.by_reason);
    if (reason && recentErrors.total_count <= 0) {
      bySource[atsKey].by_reason[reason] = Number(bySource[atsKey].by_reason[reason] || 0) + 1;
    }
    const emptyNoJobsClass = classifyEmptyNoJobsTarget(row, recentErrors, reason, options);
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

    topTargets.push({
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
      recent_errors: recentErrors,
      dominant_failure_reason: reason,
      empty_no_jobs_class: emptyNoJobsClass || null,
      next_action: targetPressureNextAction(reason)
    });
  }

  for (const source of Object.values(bySource)) {
    source.dominant_failure_reason = dominantFailureReason({ by_reason: source.by_reason });
  }

  return {
    read_only: true,
    error_window_hours: errorWindowHours,
    sample_limit: limit,
    target_count: topTargets.length,
    failure_pressure: failurePressure,
    recent_error_count: recentErrorCount,
    empty_no_jobs_classification: emptyNoJobsClassification,
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
  const targetFailurePressure = summarizeTargetFailurePressureRows(options.targetFailurePressureRows || [], options);
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
      latest_run: latestRun,
      recent_run_trend: recentRunTrend,
      recent_run_trend_by_source: recentRunTrendBySource,
      latest_run_by_source: latestRunBySource,
      auto_sync_budget_usage: autoSyncBudgetUsage,
      parser_drift_recheck: parserDriftRecheck,
      target_failure_pressure: targetFailurePressure,
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
    targetFailurePressureRows: targetFailurePressure.rows
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
  classifyFailureReason,
  getFixtureCoverage,
  parseBacklogArgs,
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
