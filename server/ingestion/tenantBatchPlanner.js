const fs = require("node:fs");
const path = require("node:path");
const { createPostgresPool } = require("../backends/postgres");
const { acquireHeavyJobLock } = require("../backends/heavyJobLock");
const { normalizeAtsKey } = require("../backends/postgresStore");
const {
  MAX_RUN_LIMIT,
  discoverSourceTargets
} = require("./sourceRunner");
const {
  countConfiguredTargets,
  createEmptyClassificationCounts,
  runNetNewEstimate
} = require("./netNewEstimator");

const DEFAULT_TARGET_GAIN = 5000;
const DEFAULT_COMPANY_LIMIT = 1000;
const DEFAULT_ROW_LIMIT = 100_000;
const DEFAULT_STATEMENT_TIMEOUT_MS = 30_000;
const MAX_COMPANY_LIMIT = 1_000_000;
const MAX_ROW_LIMIT = 5_000_000;
const MAX_RUNTIME_MS = 6 * 60 * 60 * 1000;
const STAGE_TARGETS = Object.freeze([250, 1000, 2500, 5000, 10000]);
const BLANK_VALUES = Object.freeze(["", "unknown", "n/a", "na", "none", "null", "undefined", "not available", "not applicable", "not specified", "unspecified"]);
const WEAK_REMOTE_VALUES = BLANK_VALUES;

function nowIso() {
  return new Date().toISOString();
}

function clean(value, max = 1000) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function asInt(value, fallback, min, max) {
  const parsed = Number(value);
  const number = Number.isFinite(parsed) ? Math.floor(parsed) : fallback;
  return Math.max(min, Math.min(max, number));
}

function asBool(value) {
  return ["1", "true", "yes", "y", "on"].includes(String(value || "").trim().toLowerCase());
}

function pct(numerator, denominator) {
  if (!denominator) return 0;
  return Number(((Number(numerator || 0) / Number(denominator || 1)) * 100).toFixed(4));
}

function incrementCounter(map, key, amount = 1) {
  const normalized = clean(key || "unknown", 180);
  map[normalized] = Number(map[normalized] || 0) + Number(amount || 0);
}

function mergeCounter(target, source) {
  for (const [key, value] of Object.entries(source || {})) incrementCounter(target, key, Number(value || 0));
}

function parseBatchPlannerArgs(argv = process.argv.slice(2), env = process.env) {
  const companyLimit = asInt(env.OPENJOBSLOTS_ATS_BATCH_COMPANY_LIMIT, DEFAULT_COMPANY_LIMIT, 1, MAX_COMPANY_LIMIT);
  const options = {
    source: clean(env.OPENJOBSLOTS_ATS_BATCH_SOURCE).toLowerCase(),
    targetGain: asInt(env.OPENJOBSLOTS_ATS_BATCH_TARGET_GAIN, DEFAULT_TARGET_GAIN, 1, 1_000_000),
    companyLimit,
    requestedCompanyLimit: companyLimit,
    rowLimit: asInt(env.OPENJOBSLOTS_ATS_BATCH_ROW_LIMIT, DEFAULT_ROW_LIMIT, 1, MAX_ROW_LIMIT),
    pageSize: asInt(env.OPENJOBSLOTS_ATS_BATCH_PAGE_SIZE, MAX_RUN_LIMIT, 1, MAX_RUN_LIMIT),
    offset: asInt(env.OPENJOBSLOTS_ATS_BATCH_OFFSET, 0, 0, MAX_COMPANY_LIMIT),
    concurrency: asInt(env.OPENJOBSLOTS_ATS_BATCH_CONCURRENCY, 1, 1, 4),
    hostConcurrency: asInt(env.OPENJOBSLOTS_ATS_BATCH_HOST_CONCURRENCY, 1, 1, 4),
    statementTimeoutMs: asInt(
      env.OPENJOBSLOTS_HEAVY_SOURCE_STATEMENT_TIMEOUT_MS,
      DEFAULT_STATEMENT_TIMEOUT_MS,
      1000,
      120_000
    ),
    maxRuntimeMs: asInt(env.OPENJOBSLOTS_ATS_BATCH_MAX_RUNTIME_MS, MAX_RUNTIME_MS, 1000, MAX_RUNTIME_MS),
    includeDisabled: asBool(env.OPENJOBSLOTS_ATS_BATCH_INCLUDE_DISABLED),
    json: asBool(env.OPENJOBSLOTS_ATS_BATCH_JSON),
    output: clean(env.OPENJOBSLOTS_ATS_BATCH_OUTPUT, 4000),
    apply: false,
    confirmProduction: false
  };
  for (const arg of argv) {
    if (arg === "--json") options.json = true;
    else if (arg === "--include-disabled") options.includeDisabled = true;
    else if (arg === "--apply" || arg === "--confirm-production" || arg.startsWith("--max-updates=")) {
      options.apply = true;
    } else if (arg.startsWith("--source=")) options.source = clean(arg.slice("--source=".length)).toLowerCase();
    else if (arg.startsWith("--target-gain=")) options.targetGain = asInt(arg.slice("--target-gain=".length), options.targetGain, 1, 1_000_000);
    else if (arg.startsWith("--company-limit=") || arg.startsWith("--limit=")) {
      const value = arg.includes("--company-limit=") ? arg.slice("--company-limit=".length) : arg.slice("--limit=".length);
      options.companyLimit = asInt(value, options.companyLimit, 1, MAX_COMPANY_LIMIT);
      options.requestedCompanyLimit = options.companyLimit;
    } else if (arg.startsWith("--row-limit=")) options.rowLimit = asInt(arg.slice("--row-limit=".length), options.rowLimit, 1, MAX_ROW_LIMIT);
    else if (arg.startsWith("--page-size=")) options.pageSize = asInt(arg.slice("--page-size=".length), options.pageSize, 1, MAX_RUN_LIMIT);
    else if (arg.startsWith("--offset=")) options.offset = asInt(arg.slice("--offset=".length), options.offset, 0, MAX_COMPANY_LIMIT);
    else if (arg.startsWith("--concurrency=")) options.concurrency = asInt(arg.slice("--concurrency=".length), options.concurrency, 1, 4);
    else if (arg.startsWith("--host-concurrency=")) options.hostConcurrency = asInt(arg.slice("--host-concurrency=".length), options.hostConcurrency, 1, 4);
    else if (arg.startsWith("--statement-timeout-ms=")) options.statementTimeoutMs = asInt(arg.slice("--statement-timeout-ms=".length), options.statementTimeoutMs, 1000, 120_000);
    else if (arg.startsWith("--max-runtime-ms=")) options.maxRuntimeMs = asInt(arg.slice("--max-runtime-ms=".length), options.maxRuntimeMs, 1000, MAX_RUNTIME_MS);
    else if (arg.startsWith("--output=")) options.output = clean(arg.slice("--output=".length), 4000);
  }
  return options;
}

function ensureReadOnlyOptions(options = {}) {
  if (options.apply || options.confirmProduction) {
    throw new Error("ats:plan-batches is read-only and refuses apply/canary/write flags");
  }
}

function blankSql(column) {
  return `lower(btrim(coalesce(${column}, ''))) = ANY($2::text[])`;
}

function weakSql(column) {
  return `lower(btrim(coalesce(${column}, ''))) = ANY($3::text[])`;
}

async function getQualityBaseline(pool, source) {
  const result = await pool.query(
    `
      SELECT
        COUNT(*) FILTER (WHERE hidden = false)::int AS global_visible_count,
        COUNT(*) FILTER (
          WHERE hidden = false AND ((${blankSql("country")}) OR (${blankSql("region")}) OR (${blankSql("city")}))
        )::int AS global_missing_any_geo_count,
        COUNT(*) FILTER (
          WHERE hidden = false AND (${weakSql("remote_type")})
        )::int AS global_weak_unknown_remote_count,
        COUNT(*) FILTER (WHERE hidden = false AND ats_key = $1)::int AS source_visible_count,
        COUNT(*) FILTER (
          WHERE hidden = false AND ats_key = $1 AND ((${blankSql("country")}) OR (${blankSql("region")}) OR (${blankSql("city")}))
        )::int AS source_missing_any_geo_count,
        COUNT(*) FILTER (
          WHERE hidden = false AND ats_key = $1 AND (${weakSql("remote_type")})
        )::int AS source_weak_unknown_remote_count
      FROM postings;
    `,
    [normalizeAtsKey(source), BLANK_VALUES, WEAK_REMOTE_VALUES]
  );
  const row = result.rows[0] || {};
  const baseline = {
    global_visible_count: Number(row.global_visible_count || 0),
    global_missing_any_geo_count: Number(row.global_missing_any_geo_count || 0),
    global_weak_unknown_remote_count: Number(row.global_weak_unknown_remote_count || 0),
    source_visible_count: Number(row.source_visible_count || 0),
    source_missing_any_geo_count: Number(row.source_missing_any_geo_count || 0),
    source_weak_unknown_remote_count: Number(row.source_weak_unknown_remote_count || 0)
  };
  baseline.global_missing_any_geo_pct = pct(baseline.global_missing_any_geo_count, baseline.global_visible_count);
  baseline.global_weak_unknown_remote_pct = pct(baseline.global_weak_unknown_remote_count, baseline.global_visible_count);
  baseline.source_missing_any_geo_pct = pct(baseline.source_missing_any_geo_count, baseline.source_visible_count);
  baseline.source_weak_unknown_remote_pct = pct(baseline.source_weak_unknown_remote_count, baseline.source_visible_count);
  return baseline;
}

function projectQuality(baseline, tenantOrSum = {}) {
  const gain = Number(tenantOrSum.net_new_clean_public_candidates || tenantOrSum.net_new || 0);
  const missingAny = Number(tenantOrSum.missing_any_geo_count || tenantOrSum.missing_any_geo || 0);
  const weakRemote = Number(tenantOrSum.weak_unknown_remote_count || tenantOrSum.weak_unknown_remote || 0);
  const globalVisibleAfter = Number(baseline.global_visible_count || 0) + gain;
  const sourceVisibleAfter = Number(baseline.source_visible_count || 0) + gain;
  return {
    expected_global_visible_count_after: globalVisibleAfter,
    expected_global_missing_any_geo_pct_after: pct(Number(baseline.global_missing_any_geo_count || 0) + missingAny, globalVisibleAfter),
    expected_global_weak_unknown_remote_pct_after: pct(Number(baseline.global_weak_unknown_remote_count || 0) + weakRemote, globalVisibleAfter),
    expected_source_visible_count_after: sourceVisibleAfter,
    expected_source_missing_any_geo_pct_after: pct(Number(baseline.source_missing_any_geo_count || 0) + missingAny, sourceVisibleAfter),
    expected_source_weak_unknown_remote_pct_after: pct(Number(baseline.source_weak_unknown_remote_count || 0) + weakRemote, sourceVisibleAfter)
  };
}

function predictedGuardFailures(baseline, tenantOrSum = {}, projection = projectQuality(baseline, tenantOrSum)) {
  const failures = [];
  const gain = Number(tenantOrSum.net_new_clean_public_candidates || tenantOrSum.net_new || 0);
  if (gain <= 0) failures.push("no_net_new_clean_public_candidates");
  if (Number(tenantOrSum.no_geo_no_remote_count || 0) > 0) failures.push("new_no_geo_no_remote_candidates");
  if (projection.expected_global_missing_any_geo_pct_after > Number(baseline.global_missing_any_geo_pct || 0)) {
    failures.push("global_missing_any_geo_pct_would_increase");
  }
  if (projection.expected_global_weak_unknown_remote_pct_after > Number(baseline.global_weak_unknown_remote_pct || 0)) {
    failures.push("global_weak_unknown_remote_pct_would_increase");
  }
  if (projection.expected_source_missing_any_geo_pct_after > Number(baseline.source_missing_any_geo_pct || 0)) {
    failures.push("source_missing_any_geo_pct_would_increase");
  }
  if (projection.expected_source_weak_unknown_remote_pct_after > Number(baseline.source_weak_unknown_remote_pct || 0)) {
    failures.push("source_weak_unknown_remote_pct_would_increase");
  }
  return failures;
}

function normalizeTenantForPlan(tenant = {}, baseline = {}) {
  const netNew = Number(tenant.net_new_clean_public_candidates || 0);
  const projection = projectQuality(baseline, tenant);
  const failures = predictedGuardFailures(baseline, tenant, projection);
  return {
    source: tenant.source,
    tenant_key: tenant.tenant_key,
    tenant_host: tenant.tenant_host,
    company: tenant.company,
    target_url: tenant.target_url,
    rows_fetched: Number(tenant.rows_fetched || 0),
    rows_parsed: Number(tenant.rows_parsed || 0),
    net_new_clean_public_candidates: netNew,
    duplicate_existing_public_rows: Number(tenant.duplicate_existing_public_rows || 0),
    quarantine_candidates: Number(tenant.quarantine_candidates || 0),
    no_geo_no_remote_count: Number(tenant.no_geo_no_remote_count || 0),
    missing_any_geo_count: Number(tenant.missing_any_geo_count || 0),
    missing_any_geo_pct: pct(tenant.missing_any_geo_count, netNew),
    weak_unknown_remote_count: Number(tenant.weak_unknown_remote_count || 0),
    weak_unknown_remote_pct: pct(tenant.weak_unknown_remote_count, netNew),
    ...projection,
    predicted_guard_result: failures.length === 0 ? "pass" : "fail",
    fail_reasons: failures,
    classifications: tenant.classifications || {},
    parser_failure_reasons: tenant.parser_failure_reasons || {},
    sample_urls: tenant.sample_urls || []
  };
}

function projectTenantSet(baseline, tenants = []) {
  return tenants.reduce((sum, tenant) => ({
    net_new_clean_public_candidates: sum.net_new_clean_public_candidates + Number(tenant.net_new_clean_public_candidates || 0),
    missing_any_geo_count: sum.missing_any_geo_count + Number(tenant.missing_any_geo_count || 0),
    weak_unknown_remote_count: sum.weak_unknown_remote_count + Number(tenant.weak_unknown_remote_count || 0),
    no_geo_no_remote_count: sum.no_geo_no_remote_count + Number(tenant.no_geo_no_remote_count || 0)
  }), {
    net_new_clean_public_candidates: 0,
    missing_any_geo_count: 0,
    weak_unknown_remote_count: 0,
    no_geo_no_remote_count: 0
  });
}

function selectGuardSafeBatch(baseline, tenantPlans = [], targetGain = DEFAULT_TARGET_GAIN) {
  const selected = [];
  const candidates = tenantPlans
    .filter((tenant) => tenant.predicted_guard_result === "pass")
    .sort((a, b) => Number(b.net_new_clean_public_candidates || 0) - Number(a.net_new_clean_public_candidates || 0));
  for (const tenant of candidates) {
    const candidateSet = [...selected, tenant];
    const cumulative = projectTenantSet(baseline, candidateSet);
    const projection = projectQuality(baseline, cumulative);
    const failures = predictedGuardFailures(baseline, cumulative, projection);
    if (failures.length > 0) continue;
    selected.push(tenant);
    if (cumulative.net_new_clean_public_candidates >= Number(targetGain || DEFAULT_TARGET_GAIN)) break;
  }
  const cumulative = projectTenantSet(baseline, selected);
  const projection = projectQuality(baseline, cumulative);
  const failures = predictedGuardFailures(baseline, cumulative, projection);
  if (cumulative.net_new_clean_public_candidates < Number(targetGain || DEFAULT_TARGET_GAIN)) {
    failures.push("insufficient_guard_safe_tenant_rows");
  }
  return {
    target_gain: Number(targetGain || DEFAULT_TARGET_GAIN),
    selected_tenant_count: selected.length,
    selected_tenants: selected,
    cumulative_net_new_clean_public_candidates: cumulative.net_new_clean_public_candidates,
    cumulative_missing_any_geo_count: cumulative.missing_any_geo_count,
    cumulative_weak_unknown_remote_count: cumulative.weak_unknown_remote_count,
    cumulative_no_geo_no_remote_count: cumulative.no_geo_no_remote_count,
    ...projection,
    predicted_guard_result: failures.length === 0 ? "pass" : "fail",
    fail_reasons: Array.from(new Set(failures))
  };
}

function buildStagePlans(baseline, tenantPlans, requestedTargetGain = DEFAULT_TARGET_GAIN) {
  const stages = Array.from(new Set([...STAGE_TARGETS, Number(requestedTargetGain || DEFAULT_TARGET_GAIN)]))
    .filter((value) => value > 0)
    .sort((a, b) => a - b);
  return stages.map((stage) => selectGuardSafeBatch(baseline, tenantPlans, stage));
}

function createEmptyReport(options = {}) {
  return {
    ok: true,
    generated_at: nowIso(),
    mode: "tenant-batch-plan",
    read_only: true,
    source: normalizeAtsKey(options.source),
    target_gain: Number(options.targetGain || DEFAULT_TARGET_GAIN),
    requested_company_limit: Number(options.requestedCompanyLimit || options.companyLimit || 0),
    page_size: Number(options.pageSize || MAX_RUN_LIMIT),
    row_limit: Number(options.rowLimit || DEFAULT_ROW_LIMIT),
    configured_targets: 0,
    scanned_targets: 0,
    unscanned_targets: 0,
    target_coverage_pct: 0,
    rows_fetched: 0,
    rows_parsed: 0,
    clean_candidates: 0,
    net_new_clean_public_candidates: 0,
    duplicate_existing_public_rows: 0,
    quarantine_candidates: 0,
    rejected_candidates: 0,
    classifications: createEmptyClassificationCounts(),
    parser_failure_reasons: {},
    baseline: {},
    tenant_plans: [],
    guard_safe_tenants: [],
    unsafe_tenants: [],
    staged_plans: [],
    selected_plan: null,
    errors: [],
    stop_reason: ""
  };
}

function mergeEstimate(report, estimate = {}) {
  report.rows_fetched += Number(estimate.rows_fetched || 0);
  report.rows_parsed += Number(estimate.rows_parsed || 0);
  report.clean_candidates += Number(estimate.clean_candidates || 0);
  report.net_new_clean_public_candidates += Number(estimate.net_new_clean_public_candidates || 0);
  report.duplicate_existing_public_rows += Number(estimate.duplicate_count || 0);
  report.quarantine_candidates += Number(estimate.quarantine_count || 0);
  report.rejected_candidates += Number(estimate.rejected_count || 0);
  mergeCounter(report.classifications, estimate.classifications || {});
  mergeCounter(report.parser_failure_reasons, estimate.parser_failure_reasons || {});
  for (const error of estimate.errors || []) {
    if (report.errors.length < 100) report.errors.push(error);
  }
}

function mergeTenantSummaries(existing = new Map(), summaries = []) {
  for (const tenant of summaries || []) {
    const key = tenant.tenant_key || clean(tenant.tenant_host || tenant.target_url || "unknown");
    const current = existing.get(key) || {
      ...tenant,
      rows_fetched: 0,
      rows_parsed: 0,
      clean_candidates: 0,
      net_new_clean_public_candidates: 0,
      duplicate_existing_public_rows: 0,
      existing_public_update_candidates: 0,
      stale_or_hidden_reactivation_candidates: 0,
      quarantine_candidates: 0,
      rejected_candidates: 0,
      no_geo_no_remote_count: 0,
      missing_any_geo_count: 0,
      weak_unknown_remote_count: 0,
      classifications: createEmptyClassificationCounts(),
      parser_failure_reasons: {},
      quality_risk_of_net_new_rows: {},
      sample_urls: []
    };
    for (const field of [
      "rows_fetched",
      "rows_parsed",
      "clean_candidates",
      "net_new_clean_public_candidates",
      "duplicate_existing_public_rows",
      "existing_public_update_candidates",
      "stale_or_hidden_reactivation_candidates",
      "quarantine_candidates",
      "rejected_candidates",
      "no_geo_no_remote_count",
      "missing_any_geo_count",
      "weak_unknown_remote_count"
    ]) {
      current[field] = Number(current[field] || 0) + Number(tenant[field] || 0);
    }
    mergeCounter(current.classifications, tenant.classifications || {});
    mergeCounter(current.parser_failure_reasons, tenant.parser_failure_reasons || {});
    current.sample_urls = Array.from(new Set([...(current.sample_urls || []), ...(tenant.sample_urls || [])])).slice(0, 10);
    existing.set(key, current);
  }
  return existing;
}

async function runTenantBatchPlanner(options = parseBatchPlannerArgs(), env = process.env) {
  ensureReadOnlyOptions(options);
  const source = normalizeAtsKey(options.source);
  if (!source) throw new Error("--source=<ats> is required");
  const poolEnv = {
    ...env,
    POSTGRES_STATEMENT_TIMEOUT_MS: String(options.statementTimeoutMs || DEFAULT_STATEMENT_TIMEOUT_MS),
    OPENJOBSLOTS_POSTGRES_STATEMENT_TIMEOUT_MS: String(options.statementTimeoutMs || DEFAULT_STATEMENT_TIMEOUT_MS)
  };
  const pool = options.pool || createPostgresPool({
    enabled: true,
    connectionString: env.DATABASE_URL || env.POSTGRES_URL || "",
    env: poolEnv
  });
  let lock = null;
  const report = createEmptyReport({ ...options, source });
  const startedAt = Date.now();
  const tenantMap = new Map();
  try {
    if (!options.pool) lock = await acquireHeavyJobLock(pool, `ats-plan-batches-${source}`);
    const countTargets = options.countConfiguredTargets || countConfiguredTargets;
    const discoverTargets = options.discoverTargets || discoverSourceTargets;
    const estimateWindow = options.estimateWindow || runNetNewEstimate;
    report.baseline = options.baseline || await getQualityBaseline(pool, source);
    report.configured_targets = await countTargets(pool, source, options);
    const companyLimit = Math.min(Number(options.companyLimit || DEFAULT_COMPANY_LIMIT), report.configured_targets || Number(options.companyLimit || DEFAULT_COMPANY_LIMIT));
    const endOffset = Math.min(report.configured_targets, Number(options.offset || 0) + companyLimit);
    let nextOffset = Number(options.offset || 0);
    while (nextOffset < endOffset) {
      if (Date.now() - startedAt >= Number(options.maxRuntimeMs || MAX_RUNTIME_MS)) {
        report.stop_reason = "max_runtime_reached";
        break;
      }
      if (report.rows_parsed >= Number(options.rowLimit || DEFAULT_ROW_LIMIT)) {
        report.stop_reason = "row_limit_reached";
        break;
      }
      const pageLimit = Math.min(Number(options.pageSize || MAX_RUN_LIMIT), endOffset - nextOffset, MAX_RUN_LIMIT);
      const targets = await discoverTargets(pool, { ...options, source, limit: pageLimit, offset: nextOffset });
      if (targets.length === 0) break;
      const windowOffset = nextOffset;
      nextOffset += targets.length;
      report.scanned_targets += targets.length;
      const estimate = await estimateWindow({
        ...options,
        source,
        pool,
        targets,
        configuredTargets: report.configured_targets,
        requestedLimit: pageLimit,
        limit: targets.length,
        offset: windowOffset
      }, env);
      mergeEstimate(report, estimate);
      mergeTenantSummaries(tenantMap, estimate.tenant_summaries || []);
    }
    report.unscanned_targets = Math.max(0, report.configured_targets - nextOffset);
    report.target_coverage_pct = pct(report.scanned_targets, report.configured_targets);
    report.tenant_plans = Array.from(tenantMap.values()).map((tenant) => normalizeTenantForPlan(tenant, report.baseline));
    report.guard_safe_tenants = report.tenant_plans.filter((tenant) => tenant.predicted_guard_result === "pass");
    report.unsafe_tenants = report.tenant_plans.filter((tenant) => tenant.predicted_guard_result !== "pass");
    report.staged_plans = buildStagePlans(report.baseline, report.tenant_plans, options.targetGain);
    report.selected_plan = report.staged_plans.find((stage) => stage.target_gain === Number(options.targetGain || DEFAULT_TARGET_GAIN)) ||
      report.staged_plans[report.staged_plans.length - 1] || null;
    report.has_guard_safe_5k_batch = report.staged_plans.some((stage) => stage.target_gain === 5000 && stage.predicted_guard_result === "pass");
    report.has_guard_safe_10k_batch = report.staged_plans.some((stage) => stage.target_gain === 10000 && stage.predicted_guard_result === "pass");
    report.runtime_ms = Date.now() - startedAt;
    if (lock) await lock.release("succeeded");
    lock = null;
    return report;
  } catch (error) {
    report.ok = false;
    report.error_message = clean(error?.message || error, 1000);
    if (lock) await lock.release("failed");
    lock = null;
    throw error;
  } finally {
    if (!options.pool && pool && typeof pool.end === "function") await pool.end();
  }
}

function writeBatchPlannerOutput(report, outputPath) {
  if (!outputPath) return;
  const resolved = path.resolve(outputPath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, `${JSON.stringify(report, null, 2)}\n`);
}

module.exports = {
  STAGE_TARGETS,
  buildStagePlans,
  getQualityBaseline,
  normalizeTenantForPlan,
  parseBatchPlannerArgs,
  predictedGuardFailures,
  projectQuality,
  runTenantBatchPlanner,
  selectGuardSafeBatch,
  writeBatchPlannerOutput
};
