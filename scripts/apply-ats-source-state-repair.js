#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const { createPostgresPool, ensurePostgresSchema, getPostgresConfig } = require("../server/backends/postgres");

const DEFAULT_PLAN_FILE = path.join("docs", "reference", "ats-source-state-repair-plan.json");
const APPLY_ACTION_TYPES = Object.freeze([
  "seed_source_row",
  "reset_source_protection_to_canary",
  "canonicalize_legacy_alias"
]);
const ALIAS_CANONICALIZATION_TABLES = Object.freeze([
  "companies",
  "company_sync_state",
  "posting_cache",
  "postings",
  "ingestion_run_errors",
  "source_quality_events",
  "source_payload_shapes",
  "parser_drift_events",
  "ats_source_runs",
  "ats_source_run_errors",
  "ats_source_run_metrics",
  "ats_source_run_rollbacks",
  "ats_source_run_posting_changes"
]);
const SUPPORTED_ALIAS_CONFLICT_MERGE_TABLES = Object.freeze(["company_sync_state"]);

let stdinCache = null;

function clean(value) {
  return String(value || "").trim();
}

function parseCsv(value) {
  return clean(value).split(",").map(clean).filter(Boolean);
}

function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    planFile: DEFAULT_PLAN_FILE,
    output: "",
    preflightReport: "",
    expectedPlanHash: "",
    sourceFilters: [],
    actionTypes: [],
    execute: false,
    confirmProduction: false,
    allowAliasCanonicalization: false,
    aliasConflictReviewed: false,
    allowAliasConflictMerge: false,
    aliasConflictReport: "",
    json: false,
    maxActions: 25,
    maxLongRunningQueries: 0,
    preflightMaxAgeMinutes: 60
  };

  for (const arg of argv) {
    if (arg === "--json") options.json = true;
    else if (arg === "--execute" || arg === "--apply") options.execute = true;
    else if (arg === "--dry-run") options.execute = false;
    else if (arg === "--confirm-production") options.confirmProduction = true;
    else if (arg === "--allow-alias-canonicalization") options.allowAliasCanonicalization = true;
    else if (arg === "--alias-conflict-reviewed") options.aliasConflictReviewed = true;
    else if (arg === "--allow-alias-conflict-merge") options.allowAliasConflictMerge = true;
    else if (arg.startsWith("--alias-conflict-report=")) options.aliasConflictReport = arg.slice("--alias-conflict-report=".length);
    else if (arg.startsWith("--plan-file=")) options.planFile = arg.slice("--plan-file=".length);
    else if (arg.startsWith("--output=")) options.output = arg.slice("--output=".length);
    else if (arg.startsWith("--preflight-report=")) options.preflightReport = arg.slice("--preflight-report=".length);
    else if (arg.startsWith("--expected-plan-hash=")) options.expectedPlanHash = arg.slice("--expected-plan-hash=".length);
    else if (arg.startsWith("--source=")) options.sourceFilters.push(...parseCsv(arg.slice("--source=".length)));
    else if (arg.startsWith("--action=")) options.actionTypes.push(...parseCsv(arg.slice("--action=".length)));
    else if (arg.startsWith("--max-actions=")) options.maxActions = Number(arg.slice("--max-actions=".length));
    else if (arg.startsWith("--max-long-running-queries=")) {
      options.maxLongRunningQueries = Number(arg.slice("--max-long-running-queries=".length));
    } else if (arg.startsWith("--preflight-max-age-minutes=")) {
      options.preflightMaxAgeMinutes = Number(arg.slice("--preflight-max-age-minutes=".length));
    }
  }

  if (!Number.isFinite(options.maxActions) || options.maxActions < 1) options.maxActions = 25;
  options.maxActions = Math.floor(options.maxActions);
  if (!Number.isFinite(options.maxLongRunningQueries) || options.maxLongRunningQueries < 0) options.maxLongRunningQueries = 0;
  options.maxLongRunningQueries = Math.floor(options.maxLongRunningQueries);
  if (!Number.isFinite(options.preflightMaxAgeMinutes) || options.preflightMaxAgeMinutes < 1) {
    options.preflightMaxAgeMinutes = 60;
  }
  options.preflightMaxAgeMinutes = Math.floor(options.preflightMaxAgeMinutes);
  return options;
}

function readStdinJson() {
  if (stdinCache === null) stdinCache = fs.readFileSync(0, "utf8");
  return JSON.parse(stdinCache.replace(/^\uFEFF/, ""));
}

function readJson(filePath) {
  if (!filePath) return null;
  if (filePath === "-") return readStdinJson();
  return JSON.parse(fs.readFileSync(path.resolve(filePath), "utf8").replace(/^\uFEFF/, ""));
}

function writeJson(filePath, payload) {
  if (!filePath) return;
  const resolved = path.resolve(filePath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, `${JSON.stringify(payload, null, 2)}\n`);
}

function titleFromAtsKey(atsKey) {
  return clean(atsKey)
    .split(/[_-]+/)
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ") || clean(atsKey);
}

function planActions(plan = {}) {
  const actions = [];
  for (const target of plan.targets || []) {
    for (const action of target.actions || []) {
      if (!APPLY_ACTION_TYPES.includes(clean(action.type))) continue;
      actions.push({
        ...action,
        ats_key: clean(action.ats_key || target.ats_key),
        target_production_state: target.production_state || {}
      });
    }
  }
  return actions;
}

function selectActions(plan = {}, options = {}) {
  const sourceFilters = new Set((options.sourceFilters || []).map(clean).filter(Boolean));
  const actionTypes = new Set((options.actionTypes || []).map(clean).filter(Boolean));
  return planActions(plan).filter((action) => {
    if (sourceFilters.size > 0 && !sourceFilters.has(clean(action.ats_key))) return false;
    if (actionTypes.size > 0 && !actionTypes.has(clean(action.type))) return false;
    return true;
  });
}

function firstMeaningful(...values) {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    if (typeof value === "string" && value.trim().length === 0) continue;
    return value;
  }
  return undefined;
}

function toNumber(value) {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function preflightCommitMatches(actual, expected) {
  const actualClean = clean(actual);
  const expectedClean = clean(expected);
  if (!actualClean || !expectedClean) return false;
  return actualClean.startsWith(expectedClean) || expectedClean.startsWith(actualClean);
}

function preflightWorkerSafe(checks = {}, report = {}) {
  if (checks.worker_isolated === true || report.worker_isolated === true || report.worker?.isolated === true) return true;
  const state = clean(firstMeaningful(checks.worker_state, report.worker_state, report.worker?.state)).toLowerCase();
  return ["stopped", "exited", "paused", "not_running", "not running", "disabled", "inactive", "dead"].includes(state);
}

function preflightAutodeploySafe(checks = {}, report = {}) {
  if (checks.autodeploy_recovery_safe === true || report.autodeploy_recovery_safe === true || report.autodeploy?.recovery_safe === true) return true;
  const state = clean(firstMeaningful(checks.autodeploy_timer_state, report.autodeploy_timer_state, report.autodeploy?.timer_state)).toLowerCase();
  return ["inactive", "disabled", "stopped", "not_found", "not-found", "failed", "dead"].includes(state);
}

function preflightReportStatus(report = {}, options = {}) {
  const failures = [];
  const checks = report?.checks && typeof report.checks === "object" && !Array.isArray(report.checks)
    ? report.checks
    : {};
  const generatedAt = clean(firstMeaningful(report.generated_at, report.generatedAt, report.timestamp));
  const generatedMs = generatedAt ? Date.parse(generatedAt) : NaN;
  const productionCommit = clean(firstMeaningful(checks.production_checkout_commit, report.production_checkout_commit, report.checkout_commit, report.git?.commit));
  const expectedCommit = clean(firstMeaningful(checks.expected_commit, report.expected_commit));
  const backupPath = clean(firstMeaningful(checks.backup_path, report.backup_path));
  const backupFileExists = firstMeaningful(checks.backup_file_exists, report.backup_file_exists, report.backup_exists, report.backup?.exists);
  const backupSizeBytes = toNumber(firstMeaningful(checks.backup_size_bytes, report.backup_size_bytes, report.backup_bytes, report.backup?.size_bytes));
  const longRunningQueries = toNumber(firstMeaningful(checks.long_running_postgres_queries, report.long_running_postgres_queries, report.postgres?.long_running_queries));
  const meiliPostgresDelta = toNumber(firstMeaningful(checks.meili_postgres_delta, report.meili_postgres_delta, report.meili?.postgres_delta));
  const heavyJobActive = firstMeaningful(checks.heavy_job_active, report.heavy_job_active, report.heavy_job?.active);

  if (!report || Object.keys(report).length === 0) failures.push("preflight_report_missing");
  if (report.ok !== true || report.unsafe === true) failures.push("preflight_report_not_safe");
  if (Array.isArray(report.failures) && report.failures.length > 0) failures.push("preflight_report_failures_present");
  if (!generatedAt) failures.push("preflight_generated_at_missing");
  else if (!Number.isFinite(generatedMs)) failures.push("preflight_generated_at_invalid");
  else if (Date.now() - generatedMs > Number(options.preflightMaxAgeMinutes || 60) * 60 * 1000) {
    failures.push("preflight_report_stale");
  }
  if (!productionCommit) failures.push("preflight_production_commit_missing");
  if (!expectedCommit) failures.push("preflight_expected_commit_missing");
  if (productionCommit && expectedCommit && !preflightCommitMatches(productionCommit, expectedCommit)) {
    failures.push("preflight_production_commit_mismatch");
  }
  if (!preflightWorkerSafe(checks, report)) failures.push("preflight_worker_not_isolated");
  if (!preflightAutodeploySafe(checks, report)) failures.push("preflight_autodeploy_timer_unsafe");
  if (heavyJobActive !== false) failures.push("preflight_heavy_job_lock_not_clear");
  if (longRunningQueries === null) failures.push("preflight_long_running_queries_missing");
  else if (longRunningQueries > Number(options.maxLongRunningQueries || 0)) failures.push("preflight_long_running_queries_active");
  if (meiliPostgresDelta !== 0) failures.push("preflight_meili_postgres_delta_nonzero");
  if (!backupPath) failures.push("preflight_backup_path_missing");
  else if (!/[/\\]backups[/\\]/.test(backupPath)) failures.push("preflight_backup_path_not_under_backups");
  if (backupFileExists !== true) failures.push("preflight_backup_file_missing");
  if (backupSizeBytes === null || backupSizeBytes <= 0) failures.push("preflight_backup_file_empty");

  return {
    ok: failures.length === 0,
    failures: Array.from(new Set(failures)),
    checks: {
      generated_at: generatedAt || null,
      production_checkout_commit: productionCommit || null,
      expected_commit: expectedCommit || null,
      worker_safe: preflightWorkerSafe(checks, report),
      autodeploy_safe: preflightAutodeploySafe(checks, report),
      heavy_job_active: heavyJobActive,
      long_running_postgres_queries: longRunningQueries,
      meili_postgres_delta: meiliPostgresDelta,
      backup_path: backupPath || null,
      backup_file_exists: backupFileExists === true,
      backup_size_bytes: backupSizeBytes
    }
  };
}

function evaluateExecutionGate(plan = {}, selectedActions = [], options = {}, preflightReport = null) {
  const failures = [];
  const aliasActions = selectedActions.filter((action) => action.type === "canonicalize_legacy_alias");
  const expectedPlanHash = clean(options.expectedPlanHash);
  const planHash = clean(plan.plan_hash);
  const preflightStatus = options.execute ? preflightReportStatus(preflightReport || {}, options) : { ok: false, failures: ["preflight_not_required_for_dry_run"] };

  if (!options.execute) {
    return {
      ok: false,
      operation_requested: false,
      operation_authorized: false,
      failures: ["dry_run_mode"],
      preflight_status: preflightStatus
    };
  }

  if (!options.confirmProduction) failures.push("--confirm-production");
  if (!expectedPlanHash) failures.push("--expected-plan-hash=<hash>");
  else if (!planHash || expectedPlanHash !== planHash) failures.push("plan_hash_mismatch");
  if (!preflightReport) failures.push("--preflight-report=<report>");
  else if (!preflightStatus.ok) failures.push(...preflightStatus.failures);
  if (selectedActions.length === 0) failures.push("selected_action_missing");
  if (selectedActions.length > Number(options.maxActions || 25)) failures.push("selected_action_count_exceeds_max_actions");
  if (aliasActions.length > 0 && !options.allowAliasCanonicalization) failures.push("--allow-alias-canonicalization");
  if (aliasActions.length > 0 && !options.aliasConflictReviewed) failures.push("--alias-conflict-reviewed");
  if (aliasActions.length > 0 && !clean(options.aliasConflictReport)) failures.push("--alias-conflict-report=<report>");
  const aliasConflictStatus = aliasConflictReportStatus(plan, aliasActions, options.aliasConflictReportPayload, options);
  if (aliasActions.length > 0 && !aliasConflictStatus.ok) failures.push(...aliasConflictStatus.failures);

  return {
    ok: failures.length === 0,
    operation_requested: true,
    operation_authorized: failures.length === 0,
    failures: Array.from(new Set(failures)),
    preflight_status: preflightStatus,
    alias_conflict_status: aliasConflictStatus
  };
}

async function applySeedSourceRow(pool, action) {
  const desired = action.desired_state || {};
  const result = await pool.query(
    `
      INSERT INTO ats_sources (ats_key, display_name, enabled, protection_status, disabled_reason, disabled_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, NULL, now())
      ON CONFLICT (ats_key) DO NOTHING
      RETURNING ats_key;
    `,
    [
      clean(action.ats_key),
      clean(action.display_name) || titleFromAtsKey(action.ats_key),
      desired.enabled === true,
      clean(desired.protection_status || "canary_only"),
      clean(desired.disabled_reason || "pending bounded canary proof")
    ]
  );
  return { type: action.type, ats_key: clean(action.ats_key), row_count: Number(result.rowCount || 0) };
}

async function applyResetProtection(pool, action) {
  const desired = action.desired_state || {};
  const result = await pool.query(
    `
      UPDATE ats_sources
      SET enabled = $2,
          protection_status = $3,
          disabled_reason = $4,
          disabled_at = NULL,
          updated_at = now()
      WHERE ats_key = $1
        AND COALESCE(NULLIF(protection_status, ''), 'normal') IN ('disabled', 'auto_disabled')
      RETURNING ats_key;
    `,
    [
      clean(action.ats_key),
      desired.enabled === true,
      clean(desired.protection_status || "canary_only"),
      clean(desired.disabled_reason || "pending bounded canary proof")
    ]
  );
  return { type: action.type, ats_key: clean(action.ats_key), row_count: Number(result.rowCount || 0) };
}

function safeAliasTableName(table) {
  const name = clean(table);
  if (!ALIAS_CANONICALIZATION_TABLES.includes(name)) {
    throw new Error(`unsafe alias canonicalization table: ${name}`);
  }
  return name;
}

async function applyAliasCanonicalization(pool, action) {
  const atsKey = clean(action.ats_key);
  const aliases = Array.from(new Set((action.legacy_alias_rows || []).map(clean).filter(Boolean)));
  const tables = (action.tables_to_review || ALIAS_CANONICALIZATION_TABLES).map(safeAliasTableName);
  const updates = [];
  for (const alias of aliases) {
    const mergedConflicts = await mergeCompanySyncStateConflicts(pool, alias, atsKey);
    for (const table of tables) {
      const result = await pool.query(`UPDATE ${table} SET ats_key = $1 WHERE ats_key = $2;`, [atsKey, alias]);
      updates.push({ table, legacy_alias: alias, row_count: Number(result.rowCount || 0) });
    }
    await pool.query("DELETE FROM ats_sources WHERE ats_key = $1;", [alias]);
    if (mergedConflicts.merged_row_count > 0 || mergedConflicts.deleted_legacy_row_count > 0) {
      updates.push({ table: "company_sync_state", legacy_alias: alias, conflict_merge: mergedConflicts });
    }
  }
  return { type: action.type, ats_key: atsKey, alias_count: aliases.length, updates };
}

async function mergeCompanySyncStateConflicts(pool, alias, canonical) {
  const mergeResult = await pool.query(
    `
      UPDATE company_sync_state canonical
      SET company_id = COALESCE(canonical.company_id, legacy.company_id),
          company_name = COALESCE(NULLIF(canonical.company_name, ''), NULLIF(legacy.company_name, ''), canonical.company_name, ''),
          last_success_epoch = GREATEST(COALESCE(canonical.last_success_epoch, 0), COALESCE(legacy.last_success_epoch, 0)),
          last_failure_epoch = GREATEST(COALESCE(canonical.last_failure_epoch, 0), COALESCE(legacy.last_failure_epoch, 0)),
          next_sync_epoch = LEAST(COALESCE(canonical.next_sync_epoch, 0), COALESCE(legacy.next_sync_epoch, 0)),
          etag = COALESCE(NULLIF(canonical.etag, ''), legacy.etag, ''),
          last_modified = COALESCE(NULLIF(canonical.last_modified, ''), legacy.last_modified, ''),
          consecutive_failures = GREATEST(COALESCE(canonical.consecutive_failures, 0), COALESCE(legacy.consecutive_failures, 0)),
          last_http_status = COALESCE(canonical.last_http_status, legacy.last_http_status),
          last_error = COALESCE(NULLIF(canonical.last_error, ''), legacy.last_error, ''),
          updated_at = now()
      FROM company_sync_state legacy
      WHERE canonical.ats_key = $1
        AND legacy.ats_key = $2
        AND canonical.company_url = legacy.company_url;
    `,
    [clean(canonical), clean(alias)]
  );
  const deleteResult = await pool.query(
    `
      DELETE FROM company_sync_state legacy
      USING company_sync_state canonical
      WHERE legacy.ats_key = $2
        AND canonical.ats_key = $1
        AND canonical.company_url = legacy.company_url;
    `,
    [clean(canonical), clean(alias)]
  );
  return {
    merged_row_count: Number(mergeResult.rowCount || 0),
    deleted_legacy_row_count: Number(deleteResult.rowCount || 0)
  };
}

async function applyAction(pool, action) {
  if (action.type === "seed_source_row") return applySeedSourceRow(pool, action);
  if (action.type === "reset_source_protection_to_canary") return applyResetProtection(pool, action);
  if (action.type === "canonicalize_legacy_alias") return applyAliasCanonicalization(pool, action);
  throw new Error(`unsupported repair action: ${action.type}`);
}

function aliasConflictActionSummaries(selectedActions = []) {
  return selectedActions
    .filter((action) => action.type === "canonicalize_legacy_alias")
    .map((action) => ({
      ats_key: clean(action.ats_key),
      legacy_alias_rows: Array.from(new Set((action.legacy_alias_rows || []).map(clean).filter(Boolean))),
      tables_to_review: (action.tables_to_review || ALIAS_CANONICALIZATION_TABLES).map(clean).filter(Boolean)
    }));
}

function aliasConflictTables(report = {}) {
  const tables = [];
  for (const sourceReport of report.reports || []) {
    for (const tableReport of sourceReport.tables || []) {
      if (Number(tableReport.conflict_count || 0) > 0) tables.push(clean(tableReport.table));
    }
  }
  return Array.from(new Set(tables.filter(Boolean)));
}

function aliasConflictReportStatus(plan = {}, aliasActions = [], report = null, options = {}) {
  if (aliasActions.length === 0) return { ok: true, failures: [] };
  const failures = [];
  if (!report || typeof report !== "object" || Array.isArray(report)) {
    failures.push("alias_conflict_report_missing");
    return { ok: false, failures };
  }
  const conflictTables = aliasConflictTables(report);
  const unsupportedConflictTables = conflictTables.filter((table) => !SUPPORTED_ALIAS_CONFLICT_MERGE_TABLES.includes(table));
  const conflictCount = Number(report.conflict_count || 0);
  const conflictsAllowed = conflictCount > 0 &&
    options.allowAliasConflictMerge === true &&
    unsupportedConflictTables.length === 0;

  if (report.ok !== true && !conflictsAllowed) failures.push("alias_conflict_report_not_ok");
  if (report.read_only !== true) failures.push("alias_conflict_report_not_read_only");
  if (conflictCount !== 0 && !conflictsAllowed) failures.push("alias_conflict_report_conflicts_present");
  if (report.safe_to_canonicalize_without_merge !== true && !conflictsAllowed) {
    failures.push("alias_conflict_report_not_safe_without_merge");
  }
  if (conflictCount > 0 && options.allowAliasConflictMerge !== true) failures.push("--allow-alias-conflict-merge");
  for (const table of unsupportedConflictTables) failures.push(`alias_conflict_report_unsupported_conflict_table:${table}`);
  if (clean(report.plan_hash) !== clean(plan.plan_hash)) failures.push("alias_conflict_report_plan_hash_mismatch");
  if (!clean(report.generated_at) || !Number.isFinite(Date.parse(clean(report.generated_at)))) {
    failures.push("alias_conflict_report_generated_at_invalid");
  }

  const reportsByKey = new Map((report.reports || []).map((item) => [clean(item.ats_key), item]));
  for (const action of aliasActions) {
    const atsKey = clean(action.ats_key);
    const item = reportsByKey.get(atsKey);
    if (!item) {
      failures.push(`alias_conflict_report_missing_source:${atsKey}`);
      continue;
    }
    if (Number(item.conflict_count || 0) !== 0 && !conflictsAllowed) {
      failures.push(`alias_conflict_report_source_conflicts_present:${atsKey}`);
    }
    const reportedAliases = new Set((item.legacy_alias_rows || []).map(clean).filter(Boolean));
    for (const alias of action.legacy_alias_rows || []) {
      if (!reportedAliases.has(clean(alias))) failures.push(`alias_conflict_report_missing_alias:${atsKey}:${clean(alias)}`);
    }
  }

  return {
    ok: failures.length === 0,
    failures: Array.from(new Set(failures)),
    conflict_count: conflictCount,
    conflict_tables: conflictTables,
    conflict_merge_required: conflictCount > 0,
    conflict_merge_allowed: conflictsAllowed
  };
}

async function runRepair({ plan, options, preflightReport = null, aliasConflictReport = null, pool = null, ensureSchema = ensurePostgresSchema } = {}) {
  const selectedActions = selectActions(plan, options);
  const gateOptions = {
    ...options,
    aliasConflictReportPayload: aliasConflictReport
  };
  const safety = evaluateExecutionGate(plan, selectedActions, gateOptions, preflightReport);
  const baseReport = {
    ok: !options.execute,
    dry_run: !options.execute || !safety.operation_authorized,
    generated_at: new Date().toISOString(),
    plan_hash: clean(plan?.plan_hash),
    expected_plan_hash: clean(options?.expectedPlanHash),
    selected_action_count: selectedActions.length,
    selected_actions: selectedActions.map((action) => ({
      type: action.type,
      ats_key: action.ats_key,
      status: action.status,
      sql_preview: action.sql_preview || []
    })),
    alias_conflict_report: clean(options.aliasConflictReport) || "",
    alias_conflict_review_required: aliasConflictActionSummaries(selectedActions),
    safety
  };

  if (!safety.operation_authorized) return baseReport;

  let ownedPool = false;
  let activePool = pool;
  if (!activePool) {
    activePool = createPostgresPool(getPostgresConfig());
    ownedPool = true;
  }
  if (!activePool) throw new Error("ats source-state repair requires OPENJOBSLOTS_DB_BACKEND=postgres");

  const applied = [];
  try {
    await ensureSchema(activePool);
    await activePool.query("BEGIN");
    for (const action of selectedActions) applied.push(await applyAction(activePool, action));
    await activePool.query("COMMIT");
    return {
      ...baseReport,
      ok: true,
      dry_run: false,
      applied_action_count: applied.length,
      applied_actions: applied
    };
  } catch (error) {
    try {
      await activePool.query("ROLLBACK");
    } catch (_) {
      // Rollback failure is less useful than the original write failure here.
    }
    throw error;
  } finally {
    if (ownedPool && typeof activePool.end === "function") await activePool.end();
  }
}

async function main() {
  const options = parseArgs();
  const plan = readJson(options.planFile);
  const preflightReport = options.preflightReport ? readJson(options.preflightReport) : null;
  const aliasConflictReport = options.aliasConflictReport ? readJson(options.aliasConflictReport) : null;
  const report = await runRepair({ plan, options, preflightReport, aliasConflictReport });
  writeJson(options.output, report);
  if (options.json || !report.ok) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else process.stdout.write("ATS source-state repair dry-run completed\n");
  if (!report.ok) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error?.stack || error?.message || String(error));
    process.exit(1);
  });
}

module.exports = {
  APPLY_ACTION_TYPES,
  ALIAS_CANONICALIZATION_TABLES,
  SUPPORTED_ALIAS_CONFLICT_MERGE_TABLES,
  aliasConflictActionSummaries,
  aliasConflictTables,
  aliasConflictReportStatus,
  evaluateExecutionGate,
  mergeCompanySyncStateConflicts,
  parseArgs,
  preflightReportStatus,
  runRepair,
  selectActions
};
