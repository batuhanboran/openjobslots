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
    else if (arg.startsWith("--now-epoch=")) options.nowEpoch = Number(arg.slice("--now-epoch=".length));
    else if (arg === "--now-epoch") options.expectNowEpoch = true;
    else if (arg.startsWith("--output=")) options.output = arg.slice("--output=".length);
    else if (options.expectLimit) {
      options.limit = Number(arg);
      options.expectLimit = false;
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

function normalizeHttpStatus(value) {
  const status = Number(value || 0);
  if (!Number.isFinite(status) || status <= 0) return 0;
  return Math.floor(status);
}

function classifyFailureReason(errorType, httpStatus = 0) {
  const type = String(errorType || "unknown").trim().toLowerCase() || "unknown";
  const status = normalizeHttpStatus(httpStatus);
  if (status === 429 || RATE_LIMIT_ERROR_TYPES.includes(type)) return "rate_limit";
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
  return {
    values: [nowEpoch, limit],
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
        COUNT(*)::int AS count
      FROM ingestion_run_errors
      WHERE created_at >= now() - ($1::int * interval '1 hour')
        AND (
          cardinality($2::text[]) = 0
          OR ats_key = ANY($2::text[])
        )
      GROUP BY ats_key, error_type, http_status
      ORDER BY count DESC, ats_key ASC, error_type ASC, http_status ASC;
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
    const failureReason = classifyFailureReason(errorType, httpStatus);
    current.total_count += count;
    current.by_type[errorType] = (current.by_type[errorType] || 0) + count;
    current.by_reason[failureReason] = (current.by_reason[failureReason] || 0) + count;
    if (errorType === "parser_drift") current.parser_drift_count += count;
    if (isParserAttentionErrorType(errorType)) current.parser_attention_count += count;
    if (SOURCE_POLICY_BLOCK_ERROR_TYPES.includes(errorType)) current.source_policy_block_count += count;
    current[`${failureReason}_count`] = Number(current[`${failureReason}_count`] || 0) + count;
  }
  return byAts;
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

function attachBacklogDiagnostics(report, options = {}) {
  const recentByAts = summarizeRecentErrors(options.recentErrorRows || []);
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
  const latestRunRows = Array.isArray(options.latestRunRows) ? options.latestRunRows : [];
  return {
    ...report,
    diagnostics: {
      read_only: true,
      error_window_hours: errorWindowHours,
      target_ats_keys: targetAtsKeys,
      parser_attention_count: parserAttentionCount,
      source_policy_block_count: sourcePolicyBlockCount,
      failure_reason_counts: failureReasonCounts,
      latest_run: summarizeLatestRun(latestRunRows[0] || options.latestRun || {}),
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
      limit: query.values[1]
    },
    ...summary
  };
  if (!options.diagnostics) return report;
  const recentErrorsQuery = buildRecentErrorsQuery(options);
  const recentErrors = await pool.query(recentErrorsQuery.sql, recentErrorsQuery.values);
  const latestRunQuery = buildLatestRunSummaryQuery();
  const latestRun = await pool.query(latestRunQuery.sql, latestRunQuery.values);
  return attachBacklogDiagnostics(report, {
    ...options,
    recentErrorRows: recentErrors.rows,
    latestRunRows: latestRun.rows
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
  buildLatestRunSummaryQuery,
  buildRecentErrorsQuery,
  buildWorkerBacklogQuery,
  classifyFailureReason,
  getFixtureCoverage,
  parseBacklogArgs,
  runAudit,
  runPostgresBacklogAudit,
  summarizeBacklogRows,
  writeOutput
};
