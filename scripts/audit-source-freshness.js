const fs = require("fs");
const path = require("path");
const { createPostgresPool } = require("../server/backends/postgres");
const { withHeavyJobLock } = require("../server/backends/heavyJobLock");
const { readWorkerBudgetConfig } = require("../server/ingestion/workerConfig");
const {
  getPostgresSourceFreshnessReport,
  getSqliteSourceFreshnessReport,
  openSqliteReadOnly
} = require("../server/ingestion/dataQualityAudit");
const {
  adjustFailureReasonCountsByScopeForParserDriftRecheck,
  adjustFailureReasonCountsForParserDriftRecheck,
  buildParserDriftRecheckQuery,
  buildRecentErrorScopeQuery,
  classifyFailureReason,
  summarizeFailureReasonCountsByScope,
  summarizeParserDriftRecheck
} = require("./audit-worker-backlog");

function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    json: false,
    days: 30,
    limit: 100,
    output: "",
    dbPath: "",
    healthWindowHours: 24,
    nowEpoch: 0
  };
  for (const arg of argv) {
    if (arg === "--json") options.json = true;
    else if (arg.startsWith("--days=")) options.days = Number(arg.slice("--days=".length));
    else if (arg === "--days") options.expectDays = true;
    else if (arg.startsWith("--limit=")) options.limit = Number(arg.slice("--limit=".length));
    else if (arg === "--limit") options.expectLimit = true;
    else if (arg.startsWith("--health-window-hours=")) options.healthWindowHours = Number(arg.slice("--health-window-hours=".length));
    else if (arg === "--health-window-hours") options.expectHealthWindowHours = true;
    else if (arg.startsWith("--now-epoch=")) options.nowEpoch = Number(arg.slice("--now-epoch=".length));
    else if (arg === "--now-epoch") options.expectNowEpoch = true;
    else if (options.expectDays) {
      options.days = Number(arg);
      options.expectDays = false;
    } else if (options.expectLimit) {
      options.limit = Number(arg);
      options.expectLimit = false;
    } else if (options.expectHealthWindowHours) {
      options.healthWindowHours = Number(arg);
      options.expectHealthWindowHours = false;
    } else if (options.expectNowEpoch) {
      options.nowEpoch = Number(arg);
      options.expectNowEpoch = false;
    } else if (arg.startsWith("--db=")) options.dbPath = arg.slice("--db=".length);
    else if (arg.startsWith("--output=")) options.output = arg.slice("--output=".length);
  }
  options.days = Math.max(1, Math.min(365, Math.floor(Number(options.days || 30))));
  options.limit = Math.max(1, Math.min(1000, Math.floor(Number(options.limit || 100))));
  options.healthWindowHours = Math.max(1, Math.min(168, Math.floor(Number(options.healthWindowHours || 24))));
  options.nowEpoch = Math.max(0, Math.floor(Number(options.nowEpoch || 0)));
  return options;
}

function writeOutput(report, outputPath) {
  if (!outputPath) return;
  const resolved = path.resolve(outputPath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, `${JSON.stringify(report, null, 2)}\n`);
}

function formatEpoch(epoch) {
  const value = Number(epoch || 0);
  if (!value) return "";
  return new Date(value * 1000).toISOString();
}

function pct(numerator, denominator) {
  const top = Number(numerator || 0);
  const bottom = Number(denominator || 0);
  if (bottom <= 0) return null;
  return Number(((top / bottom) * 100).toFixed(2));
}

function sparsePositiveCounts(counts = {}) {
  const result = {};
  for (const [key, value] of Object.entries(counts || {})) {
    const count = Number(value || 0);
    if (count > 0) result[key] = count;
  }
  return result;
}

function addCount(target, key, count) {
  if (!key) return;
  const value = Number(count || 0);
  if (value <= 0) return;
  target[key] = Number(target[key] || 0) + value;
}

function summarizeFailureSources(failureRows = [], options = {}) {
  const bySource = new Map();
  const globalReasonCounts = {};
  for (const row of Array.isArray(failureRows) ? failureRows : []) {
    const atsKey = String(row?.ats_key || "unknown").trim().toLowerCase() || "unknown";
    const errorType = String(row?.error_type || "unknown").trim() || "unknown";
    const httpStatus = Number(row?.http_status || 0);
    const errorMessage = String(row?.error_message || "");
    const count = Number(row?.count || 0);
    if (count <= 0) continue;
    const reason = classifyFailureReason(errorType, httpStatus, errorMessage);
    addCount(globalReasonCounts, reason, count);
    const current = bySource.get(atsKey) || {
      ats_key: atsKey,
      total_count: 0,
      by_reason: {},
      by_type: {}
    };
    current.total_count += count;
    addCount(current.by_reason, reason, count);
    addCount(current.by_type, errorType, count);
    bySource.set(atsKey, current);
  }

  const topLimit = Math.max(1, Math.min(25, Math.floor(Number(options.failureSourceLimit || 10))));
  const topFailureSources = Array.from(bySource.values())
    .map((source) => {
      const dominantFailureReason = Object.entries(source.by_reason)
        .sort((left, right) => Number(right[1] || 0) - Number(left[1] || 0) || left[0].localeCompare(right[0]))[0]?.[0] || "unknown";
      return {
        ...source,
        by_reason: sparsePositiveCounts(source.by_reason),
        by_type: sparsePositiveCounts(source.by_type),
        dominant_failure_reason: dominantFailureReason
      };
    })
    .sort((left, right) => Number(right.total_count || 0) - Number(left.total_count || 0) || left.ats_key.localeCompare(right.ats_key))
    .slice(0, topLimit);

  return {
    failure_reason_counts: sparsePositiveCounts(globalReasonCounts),
    top_failure_sources: topFailureSources
  };
}

function summarizeQualityGateSources(rows = []) {
  return (Array.isArray(rows) ? rows : [])
    .map((row) => ({
      ats_key: String(row?.ats_key || "unknown").trim().toLowerCase() || "unknown",
      new_missing_any_normalized_geo_rows_24h: Number(row?.new_missing_any_normalized_geo_rows || 0),
      new_weak_unknown_remote_rows_24h: Number(row?.new_weak_unknown_remote_rows || 0),
      new_no_geo_no_remote_public_rows_24h: Number(row?.new_no_geo_no_remote_rows || 0)
    }))
    .filter((row) => (
      row.new_missing_any_normalized_geo_rows_24h > 0 ||
      row.new_weak_unknown_remote_rows_24h > 0 ||
      row.new_no_geo_no_remote_public_rows_24h > 0
    ));
}

function sparseFailureReasonCountsByScope(countsByScope = {}) {
  return {
    target_failure: sparsePositiveCounts(countsByScope.target_failure || {}),
    posting_rejection: sparsePositiveCounts(countsByScope.posting_rejection || {}),
    unknown: sparsePositiveCounts(countsByScope.unknown || {}),
    total: countsByScope.total || {},
    adjustments: countsByScope.adjustments || {}
  };
}

function dominantFailureReason(counts = {}) {
  return Object.entries(counts || {})
    .filter(([, value]) => Number(value || 0) > 0)
    .sort((left, right) => Number(right[1] || 0) - Number(left[1] || 0) || left[0].localeCompare(right[0]))[0]?.[0] || "unknown";
}

function annotateCurrentPolicyFailureSources(topFailureSources = [], parserDriftRecheck = {}) {
  return (Array.isArray(topFailureSources) ? topFailureSources : []).map((source) => {
    const atsKey = String(source?.ats_key || "").trim().toLowerCase();
    const sourceRecheck = parserDriftRecheck?.by_source?.[atsKey] || {};
    const adjusted = adjustFailureReasonCountsForParserDriftRecheck(source?.by_reason || {}, sourceRecheck);
    const adjustedByReason = sparsePositiveCounts(adjusted.counts);
    return {
      ...source,
      current_policy_adjusted_by_reason: adjustedByReason,
      current_policy_dominant_failure_reason: dominantFailureReason(adjustedByReason),
      current_policy_failure_adjustments: adjusted.adjustments
    };
  });
}

function buildThroughputReadiness({
  targetSuccessPct = null,
  noGeoNoRemoteCount = 0,
  adjustedFailureReasonCounts = {},
  minimumSuccessRatePct = 80
} = {}) {
  const blockers = [];
  const successRate = targetSuccessPct === null || targetSuccessPct === undefined
    ? null
    : Number(targetSuccessPct);
  if (successRate === null || !Number.isFinite(successRate)) {
    blockers.push({
      code: "target_success_rate_missing",
      message: "24h worker target success rate is unavailable."
    });
  } else if (successRate < minimumSuccessRatePct) {
    blockers.push({
      code: "target_success_rate_below_threshold",
      message: `24h worker target success rate ${successRate}% is below the ${minimumSuccessRatePct}% threshold.`,
      value: successRate,
      threshold: minimumSuccessRatePct
    });
  }

  const unsafePublicRows = Number(noGeoNoRemoteCount || 0);
  if (unsafePublicRows > 0) {
    blockers.push({
      code: "new_no_geo_no_remote_public_rows_present",
      message: `24h public freshness introduced ${unsafePublicRows} no_geo_no_remote rows.`,
      count: unsafePublicRows
    });
  }

  for (const reason of ["parser_bug", "source_quality", "empty_no_jobs", "rate_limit", "network", "auth", "unknown"]) {
    const count = Number(adjustedFailureReasonCounts?.[reason] || 0);
    if (count <= 0) continue;
    blockers.push({
      code: `${reason}_failures_present`,
      message: reason === "parser_bug"
        ? "current-policy parser_bug failures are present in the 24h worker window."
        : `${reason} failures are present in the 24h worker window.`,
      count
    });
  }

  return {
    read_only: true,
    allowed: blockers.length === 0,
    decision: blockers.length === 0 ? "candidate_for_small_increase" : "hold",
    minimum_success_rate_pct: minimumSuccessRatePct,
    target_success_pct_24h: successRate,
    new_no_geo_no_remote_public_rows_24h: unsafePublicRows,
    current_policy_adjusted_failure_reason_counts_24h: sparsePositiveCounts(adjustedFailureReasonCounts),
    blockers,
    required_checks_before_increase: [
      "/health",
      "search:reindex:check",
      "search:parity",
      "worker trend",
      "parser_attention_count",
      "due-by-ATS"
    ],
    next_action: blockers.length === 0
      ? "Run required external checks before considering only a small budget or targets-per-run increase."
      : "Hold throughput and improve worker/source quality before increasing budget or targets-per-run."
  };
}

function createDailySourceHealthSummary(rows = {}, options = {}) {
  const nowEpoch = Math.max(0, Math.floor(Number(options.nowEpoch || Math.floor(Date.now() / 1000))));
  const windowHours = Math.max(1, Math.min(168, Math.floor(Number(options.healthWindowHours || 24))));
  const windowStartEpoch = Math.max(0, nowEpoch - (windowHours * 3600));
  const budgetConfig = readWorkerBudgetConfig(options.env || process.env, options);
  const dueRow = Array.isArray(rows.dueRows) ? (rows.dueRows[0] || {}) : {};
  const runRow = Array.isArray(rows.runRows) ? (rows.runRows[0] || {}) : {};
  const postingRow = Array.isArray(rows.postingRows) ? (rows.postingRows[0] || {}) : {};
  const successCount = Number(runRow.success_count || 0);
  const failureCount = Number(runRow.failure_count || 0);
  const targetsProcessed = Number(runRow.targets_processed || runRow.total_targets || (successCount + failureCount) || 0);
  const failureSummary = summarizeFailureSources(rows.failureRows || [], options);
  const parserDriftRecheck = summarizeParserDriftRecheck(rows.parserDriftRecheckRows || [], {
    parserDriftRecheckLimit: options.parserDriftRecheckLimit || 100
  });
  const adjustedFailureSummary = adjustFailureReasonCountsForParserDriftRecheck(
    failureSummary.failure_reason_counts,
    parserDriftRecheck
  );
  const rawFailureCountsByScope = summarizeFailureReasonCountsByScope(rows.failureScopeRows || []);
  const adjustedFailureCountsByScope = adjustFailureReasonCountsByScopeForParserDriftRecheck(
    rawFailureCountsByScope,
    parserDriftRecheck
  );
  const topFailureSources = annotateCurrentPolicyFailureSources(
    failureSummary.top_failure_sources,
    parserDriftRecheck
  );
  const qualityGateSources = summarizeQualityGateSources(rows.qualityGateRows || []);
  const targetSuccessPct = pct(successCount, successCount + failureCount);
  const sparseAdjustedFailureCounts = sparsePositiveCounts(adjustedFailureSummary.counts);

  return {
    read_only: true,
    window_hours: windowHours,
    window_start_epoch: windowStartEpoch,
    window_end_epoch: nowEpoch,
    daily_target_budget: Number(budgetConfig.autoSyncDailyTargetBudget || 0),
    targets_per_run: Number(budgetConfig.autoSyncTargetsPerRun || 0),
    targets_due: Number(dueRow.targets_due || dueRow.count || 0),
    targets_processed_24h: targetsProcessed,
    target_success_count_24h: successCount,
    target_failure_count_24h: failureCount,
    target_success_pct_24h: targetSuccessPct,
    rows_seen_24h: Number(postingRow.rows_seen || 0),
    rows_new_24h: Number(postingRow.rows_new || 0),
    new_missing_any_normalized_geo_rows_24h: Number(postingRow.new_missing_any_normalized_geo_rows || 0),
    new_weak_unknown_remote_rows_24h: Number(postingRow.new_weak_unknown_remote_rows || 0),
    new_no_geo_no_remote_public_rows_24h: Number(postingRow.new_no_geo_no_remote_rows || 0),
    quality_gate_sources_24h: qualityGateSources,
    rows_upserted_24h: Number(runRow.posting_upsert_count || 0),
    rejected_candidates_24h: Number(runRow.rejected_count || 0),
    failure_reason_counts_24h: failureSummary.failure_reason_counts,
    failure_reason_counts_by_scope_24h: sparseFailureReasonCountsByScope(rawFailureCountsByScope),
    current_policy_adjusted_failure_reason_counts_24h: sparseAdjustedFailureCounts,
    current_policy_failure_adjustments_24h: adjustedFailureSummary.adjustments,
    current_policy_adjusted_failure_reason_counts_by_scope_24h: sparseFailureReasonCountsByScope(adjustedFailureCountsByScope),
    parser_drift_recheck_24h: parserDriftRecheck,
    throughput_readiness: buildThroughputReadiness({
      targetSuccessPct,
      noGeoNoRemoteCount: Number(postingRow.new_no_geo_no_remote_rows || 0),
      adjustedFailureReasonCounts: sparseAdjustedFailureCounts
    }),
    top_failure_sources: topFailureSources,
    next_action: "do not increase throughput unless success rate, parity, parser attention, and due-by-ATS gates are clean"
  };
}

function buildPostgresDailySourceHealthQueries(options = {}) {
  const nowEpoch = Math.max(0, Math.floor(Number(options.nowEpoch || Math.floor(Date.now() / 1000))));
  const windowHours = Math.max(1, Math.min(168, Math.floor(Number(options.healthWindowHours || 24))));
  const windowStartEpoch = Math.max(0, nowEpoch - (windowHours * 3600));
  const failureGroupLimit = Math.max(25, Math.min(1000, Math.floor(Number(options.failureGroupLimit || 500))));
  const qualityGateSourceLimit = Math.max(1, Math.min(100, Math.floor(Number(options.qualityGateSourceLimit || 25))));
  return {
    due: {
      values: [nowEpoch],
      sql: `
        SELECT COUNT(c.id)::int AS targets_due
        FROM companies c
        INNER JOIN ats_sources s
          ON s.ats_key = c.ats_key
        LEFT JOIN company_sync_state st
          ON st.ats_key = c.ats_key
          AND st.company_url = c.url_string
        WHERE s.enabled = true
          AND COALESCE(NULLIF(s.protection_status, ''), 'normal') NOT IN ('disabled', 'auto_disabled')
          AND COALESCE(st.next_sync_epoch, 0) <= $1;
      `
    },
    runs: {
      values: [windowStartEpoch],
      sql: `
        SELECT
          COALESCE(SUM(total_targets), 0)::int AS targets_processed,
          COALESCE(SUM(success_count), 0)::int AS success_count,
          COALESCE(SUM(failure_count), 0)::int AS failure_count,
          COALESCE(SUM(posting_upsert_count), 0)::int AS posting_upsert_count,
          COALESCE(SUM(rejected_count), 0)::int AS rejected_count
        FROM ingestion_runs
        WHERE started_at_epoch >= $1;
      `
    },
    postings: {
      values: [windowStartEpoch],
      sql: `
        SELECT
          COUNT(*) FILTER (WHERE hidden = false AND COALESCE(last_seen_epoch, 0) >= $1)::int AS rows_seen,
          COUNT(*) FILTER (WHERE hidden = false AND COALESCE(first_seen_epoch, 0) >= $1)::int AS rows_new,
          COUNT(*) FILTER (
            WHERE hidden = false
              AND COALESCE(first_seen_epoch, 0) >= $1
              AND (
                NULLIF(btrim(country), '') IS NULL
                OR NULLIF(btrim(region), '') IS NULL
                OR NULLIF(btrim(city), '') IS NULL
              )
          )::int AS new_missing_any_normalized_geo_rows,
          COUNT(*) FILTER (
            WHERE hidden = false
              AND COALESCE(first_seen_epoch, 0) >= $1
              AND (
                NULLIF(btrim(remote_type), '') IS NULL
                OR lower(btrim(remote_type)) IN ('unknown', 'unspecified', 'n/a', 'na', 'none')
              )
          )::int AS new_weak_unknown_remote_rows,
          COUNT(*) FILTER (
            WHERE hidden = false
              AND COALESCE(first_seen_epoch, 0) >= $1
              AND NULLIF(btrim(country), '') IS NULL
              AND NULLIF(btrim(region), '') IS NULL
              AND NULLIF(btrim(city), '') IS NULL
              AND (
                NULLIF(btrim(remote_type), '') IS NULL
                OR lower(btrim(remote_type)) IN ('unknown', 'unspecified', 'n/a', 'na', 'none')
              )
          )::int AS new_no_geo_no_remote_rows
        FROM postings;
      `
    },
    qualityGateSources: {
      values: [windowStartEpoch, qualityGateSourceLimit],
      sql: `
        SELECT
          COALESCE(NULLIF(btrim(ats_key), ''), 'unknown') AS ats_key,
          COUNT(*) FILTER (
            WHERE (
              NULLIF(btrim(country), '') IS NULL
              OR NULLIF(btrim(region), '') IS NULL
              OR NULLIF(btrim(city), '') IS NULL
            )
          )::int AS new_missing_any_normalized_geo_rows,
          COUNT(*) FILTER (
            WHERE (
              NULLIF(btrim(remote_type), '') IS NULL
              OR lower(btrim(remote_type)) IN ('unknown', 'unspecified', 'n/a', 'na', 'none')
            )
          )::int AS new_weak_unknown_remote_rows,
          COUNT(*) FILTER (
            WHERE NULLIF(btrim(country), '') IS NULL
              AND NULLIF(btrim(region), '') IS NULL
              AND NULLIF(btrim(city), '') IS NULL
              AND (
                NULLIF(btrim(remote_type), '') IS NULL
                OR lower(btrim(remote_type)) IN ('unknown', 'unspecified', 'n/a', 'na', 'none')
              )
          )::int AS new_no_geo_no_remote_rows
        FROM postings
        WHERE hidden = false
          AND COALESCE(first_seen_epoch, 0) >= $1
        GROUP BY ats_key
        HAVING
          COUNT(*) FILTER (
            WHERE NULLIF(btrim(country), '') IS NULL
              AND NULLIF(btrim(region), '') IS NULL
              AND NULLIF(btrim(city), '') IS NULL
              AND (
                NULLIF(btrim(remote_type), '') IS NULL
                OR lower(btrim(remote_type)) IN ('unknown', 'unspecified', 'n/a', 'na', 'none')
              )
          ) > 0
          OR COUNT(*) FILTER (
            WHERE (
              NULLIF(btrim(country), '') IS NULL
              OR NULLIF(btrim(region), '') IS NULL
              OR NULLIF(btrim(city), '') IS NULL
            )
          ) > 0
          OR COUNT(*) FILTER (
            WHERE (
              NULLIF(btrim(remote_type), '') IS NULL
              OR lower(btrim(remote_type)) IN ('unknown', 'unspecified', 'n/a', 'na', 'none')
            )
          ) > 0
        ORDER BY new_no_geo_no_remote_rows DESC,
          new_missing_any_normalized_geo_rows DESC,
          new_weak_unknown_remote_rows DESC,
          ats_key ASC
        LIMIT $2;
      `
    },
    failures: {
      values: [windowStartEpoch, failureGroupLimit],
      sql: `
        SELECT
          ats_key,
          error_type,
          COALESCE(http_status, 0)::int AS http_status,
          COALESCE(error_message, '') AS error_message,
          COUNT(*)::int AS count
        FROM ingestion_run_errors
        WHERE created_at >= to_timestamp($1)
        GROUP BY ats_key, error_type, COALESCE(http_status, 0), COALESCE(error_message, '')
        ORDER BY count DESC, ats_key ASC, error_type ASC
        LIMIT $2;
      `
    },
    failureScopes: buildRecentErrorScopeQuery({
      errorWindowHours: windowHours,
      targetAtsKeys: []
    }),
    parserDriftRecheck: buildParserDriftRecheckQuery({
      errorWindowHours: windowHours,
      targetAtsKeys: [],
      parserDriftRecheckLimit: options.parserDriftRecheckLimit || 100
    })
  };
}

async function getPostgresDailySourceHealthSummary(pool, options = {}) {
  const queries = buildPostgresDailySourceHealthQueries(options);
  const [due, runs, postings, qualityGateSources, failures, failureScopes, parserDriftRecheck] = await Promise.all([
    pool.query(queries.due.sql, queries.due.values),
    pool.query(queries.runs.sql, queries.runs.values),
    pool.query(queries.postings.sql, queries.postings.values),
    pool.query(queries.qualityGateSources.sql, queries.qualityGateSources.values),
    pool.query(queries.failures.sql, queries.failures.values),
    pool.query(queries.failureScopes.sql, queries.failureScopes.values),
    pool.query(queries.parserDriftRecheck.sql, queries.parserDriftRecheck.values)
  ]);
  return createDailySourceHealthSummary({
    dueRows: due.rows,
    runRows: runs.rows,
    postingRows: postings.rows,
    qualityGateRows: qualityGateSources.rows,
    failureRows: failures.rows,
    failureScopeRows: failureScopes.rows,
    parserDriftRecheckRows: parserDriftRecheck.rows
  }, options);
}

function printReport(report) {
  console.log("OpenJobSlots source freshness audit");
  console.log(`Backend: ${report.db_backend}`);
  console.log(`Due window: ${report.filters?.stale_days || 30} days`);
  if (report.daily_source_health) {
    const health = report.daily_source_health;
    console.log(`Daily budget: ${health.daily_target_budget} targets / ${health.targets_per_run} per run`);
    console.log(`24h: ${health.targets_processed_24h} targets, ${health.target_success_pct_24h ?? "n/a"}% success, ${health.rows_seen_24h} rows seen, ${health.rows_new_24h} new rows`);
    console.log(`24h quality gate: ${health.new_no_geo_no_remote_public_rows_24h} new no_geo_no_remote public rows`);
    const topQualitySource = (health.quality_gate_sources_24h || [])[0];
    if (topQualitySource) {
      console.log(`Top quality source: ${topQualitySource.ats_key} (${topQualitySource.new_no_geo_no_remote_public_rows_24h} no_geo_no_remote, ${topQualitySource.new_missing_any_normalized_geo_rows_24h} missing geo, ${topQualitySource.new_weak_unknown_remote_rows_24h} weak remote)`);
    }
    console.log(`Due targets: ${health.targets_due}`);
  }
  console.table((report.items || []).slice(0, 25).map((item) => ({
    ats: item.ats_key,
    enabled: item.enabled,
    state: item.protection_status,
    targets: item.target_count,
    visible: item.visible_rows,
    seen_in_window: item.visible_rows_seen_within_window,
    latest_seen: formatEpoch(item.latest_seen_epoch),
    latest_source_run: formatEpoch(item.latest_source_run_epoch),
    due: item.is_due,
    reason: item.due_reason
  })));
}

async function runAudit(options = parseArgs(), env = process.env) {
  const dbBackend = String(env.OPENJOBSLOTS_DB_BACKEND || "sqlite").trim().toLowerCase();
  const auditOptions = {
    ...options,
    env,
    nowEpoch: options.nowEpoch || Math.floor(Date.now() / 1000)
  };
  if (dbBackend === "postgres") {
    const pool = createPostgresPool({ enabled: true, connectionString: env.DATABASE_URL || env.POSTGRES_URL || "" });
    try {
      const { audit, dailySourceHealth } = await withHeavyJobLock(
        pool,
        "source-freshness-audit",
        async () => ({
          audit: await getPostgresSourceFreshnessReport(pool, { staleDays: options.days, limit: options.limit, nowEpoch: auditOptions.nowEpoch }),
          dailySourceHealth: await getPostgresDailySourceHealthSummary(pool, auditOptions)
        })
      );
      return {
        ok: true,
        db_backend: "postgres",
        filters: audit.filters,
        daily_source_health: dailySourceHealth,
        items: audit.items
      };
    } finally {
      await pool.end();
    }
  }

  const dbPath = options.dbPath || env.DB_PATH || path.resolve(__dirname, "..", "jobs.db");
  const db = await openSqliteReadOnly(dbPath);
  try {
    const audit = await getSqliteSourceFreshnessReport(db, { staleDays: options.days, limit: options.limit });
    return {
      ok: true,
      db_backend: "sqlite",
      db_path: path.resolve(dbPath),
      filters: audit.filters,
      daily_source_health: createDailySourceHealthSummary({}, auditOptions),
      items: audit.items
    };
  } finally {
    await db.close();
  }
}

if (require.main === module) {
  const options = parseArgs(process.argv.slice(2));
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
  buildPostgresDailySourceHealthQueries,
  createDailySourceHealthSummary,
  getPostgresDailySourceHealthSummary,
  parseArgs,
  runAudit,
  summarizeFailureSources,
  writeOutput
};
