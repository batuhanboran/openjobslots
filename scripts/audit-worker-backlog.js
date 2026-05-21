const fs = require("fs");
const path = require("path");
const { createPostgresPool } = require("../server/backends/postgres");

function parseBacklogArgs(argv = process.argv.slice(2)) {
  const options = {
    json: false,
    limit: 100,
    output: "",
    nowEpoch: 0
  };
  for (const arg of argv) {
    if (arg === "--json") options.json = true;
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
    }
  }
  options.limit = Math.max(1, Math.min(500, Math.floor(Number(options.limit || 100))));
  options.nowEpoch = Math.max(0, Math.floor(Number(options.nowEpoch || 0)));
  return options;
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
    last_failure_epoch: Number(row.last_failure_epoch || 0)
  };
}

function summarizeBacklogRows(rows = [], options = {}) {
  const autoSyncDailyTargetBudget = nonNegativeInteger(
    options.autoSyncDailyTargetBudget ?? process.env.INGESTION_AUTO_SYNC_DAILY_TARGET_BUDGET,
    250
  );
  const autoSyncTargetsPerRun = positiveInteger(
    options.autoSyncTargetsPerRun ?? process.env.INGESTION_AUTO_SYNC_TARGETS_PER_RUN,
    50
  );
  const sourceDailyTargetBudget = nonNegativeInteger(
    options.sourceDailyTargetBudget ?? process.env.INGESTION_SOURCE_DAILY_TARGET_BUDGET,
    100
  );
  const items = (Array.isArray(rows) ? rows : []).map(normalizeBacklogRow);
  const totals = createEmptyTotals();
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

  return {
    totals,
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

async function runPostgresBacklogAudit(pool, options = {}) {
  const nowEpoch = Math.max(0, Math.floor(Number(options.nowEpoch || Math.floor(Date.now() / 1000))));
  const query = buildWorkerBacklogQuery({ ...options, nowEpoch });
  const result = await pool.query(query.sql, query.values);
  const summary = summarizeBacklogRows(result.rows, options);
  return {
    ok: true,
    db_backend: "postgres",
    read_only: true,
    generated_at_epoch: nowEpoch,
    filters: {
      limit: query.values[1]
    },
    ...summary
  };
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
  buildWorkerBacklogQuery,
  parseBacklogArgs,
  runAudit,
  runPostgresBacklogAudit,
  summarizeBacklogRows,
  writeOutput
};
