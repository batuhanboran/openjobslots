const fs = require("node:fs");
const path = require("node:path");
const { createPostgresPool } = require("../backends/postgres");
const { acquireHeavyJobLock } = require("../backends/heavyJobLock");
const { normalizeAtsKey } = require("../backends/postgresStore");
const {
  DEFAULT_SOURCE_TIMEOUT_MS,
  countConfiguredTargets,
  createEmptyClassificationCounts,
  runNetNewEstimate,
  writeEstimatorOutput
} = require("./netNewEstimator");
const {
  MAX_RUN_LIMIT,
  discoverSourceTargets,
  sourceHost
} = require("./sourceRunner");

const DEFAULT_STATEMENT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RUNTIME_MS = 30 * 60 * 1000;
const DEFAULT_ROW_LIMIT = 50_000;
const DEFAULT_COMPANY_LIMIT = 1000;
const DEFAULT_MAX_FETCHES = 100_000;
const DEFAULT_CHECKPOINT_EVERY_WINDOWS = 1;
const MAX_COMPANY_LIMIT = 1_000_000;
const MAX_ROW_LIMIT = 5_000_000;
const MAX_RUNTIME_MS = 6 * 60 * 60 * 1000;
const MAX_FETCHES = 5_000_000;
const MAX_DELAY_MS = 10_000;

function nowIso() {
  return new Date().toISOString();
}

function asInt(value, fallback, min, max) {
  const parsed = Number(value);
  const number = Number.isFinite(parsed) ? Math.floor(parsed) : fallback;
  return Math.max(min, Math.min(max, number));
}

function asBool(value) {
  return ["1", "true", "yes", "y", "on"].includes(String(value || "").trim().toLowerCase());
}

function clean(value, max = 1000) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms || 0))));
}

function incrementCounter(map, key, amount = 1) {
  const normalized = String(key || "unknown");
  map[normalized] = Number(map[normalized] || 0) + Number(amount || 0);
}

function mergeCounter(target, source) {
  for (const [key, value] of Object.entries(source || {})) {
    incrementCounter(target, key, Number(value || 0));
  }
}

function pct(numerator, denominator) {
  if (!denominator) return 0;
  return Number(((Number(numerator || 0) / Number(denominator || 1)) * 100).toFixed(2));
}

function parseInventoryArgs(argv = process.argv.slice(2), env = process.env) {
  const companyLimitFromEnv = asInt(
    env.OPENJOBSLOTS_ATS_INVENTORY_COMPANY_LIMIT,
    DEFAULT_COMPANY_LIMIT,
    1,
    MAX_COMPANY_LIMIT
  );
  const rowLimitFromEnv = asInt(
    env.OPENJOBSLOTS_ATS_INVENTORY_ROW_LIMIT,
    DEFAULT_ROW_LIMIT,
    1,
    MAX_ROW_LIMIT
  );
  const options = {
    source: clean(env.OPENJOBSLOTS_ATS_INVENTORY_SOURCE).toLowerCase(),
    requestedCompanyLimit: companyLimitFromEnv,
    companyLimit: companyLimitFromEnv,
    rowLimit: rowLimitFromEnv,
    pageSize: asInt(env.OPENJOBSLOTS_ATS_INVENTORY_PAGE_SIZE, MAX_RUN_LIMIT, 1, MAX_RUN_LIMIT),
    offset: asInt(env.OPENJOBSLOTS_ATS_INVENTORY_OFFSET, 0, 0, MAX_COMPANY_LIMIT),
    concurrency: asInt(env.OPENJOBSLOTS_ATS_INVENTORY_CONCURRENCY, 1, 1, 4),
    hostConcurrency: asInt(env.OPENJOBSLOTS_ATS_INVENTORY_HOST_CONCURRENCY, 1, 1, 4),
    statementTimeoutMs: asInt(
      env.OPENJOBSLOTS_HEAVY_SOURCE_STATEMENT_TIMEOUT_MS,
      DEFAULT_STATEMENT_TIMEOUT_MS,
      1000,
      120_000
    ),
    sourceTimeoutMs: asInt(
      env.OPENJOBSLOTS_ATS_INVENTORY_SOURCE_TIMEOUT_MS,
      DEFAULT_SOURCE_TIMEOUT_MS,
      1000,
      3_600_000
    ),
    maxRuntimeMs: asInt(env.OPENJOBSLOTS_ATS_INVENTORY_MAX_RUNTIME_MS, DEFAULT_MAX_RUNTIME_MS, 1000, MAX_RUNTIME_MS),
    maxFetches: asInt(env.OPENJOBSLOTS_ATS_INVENTORY_MAX_FETCHES, DEFAULT_MAX_FETCHES, 1, MAX_FETCHES),
    hostCap: asInt(env.OPENJOBSLOTS_ATS_INVENTORY_HOST_CAP, 0, 0, MAX_COMPANY_LIMIT),
    delayMs: asInt(env.OPENJOBSLOTS_ATS_INVENTORY_DELAY_MS, 0, 0, MAX_DELAY_MS),
    jitterMs: asInt(env.OPENJOBSLOTS_ATS_INVENTORY_JITTER_MS, 0, 0, MAX_DELAY_MS),
    checkpointEveryWindows: asInt(
      env.OPENJOBSLOTS_ATS_INVENTORY_CHECKPOINT_EVERY_WINDOWS,
      DEFAULT_CHECKPOINT_EVERY_WINDOWS,
      1,
      1000
    ),
    checkpoint: clean(env.OPENJOBSLOTS_ATS_INVENTORY_CHECKPOINT, 2000),
    resume: asBool(env.OPENJOBSLOTS_ATS_INVENTORY_RESUME),
    includeDisabled: asBool(env.OPENJOBSLOTS_ATS_INVENTORY_INCLUDE_DISABLED),
    json: asBool(env.OPENJOBSLOTS_ATS_INVENTORY_JSON),
    output: clean(env.OPENJOBSLOTS_ATS_INVENTORY_OUTPUT, 2000),
    apply: false,
    confirmProduction: false
  };

  for (const arg of argv) {
    if (arg === "--json") options.json = true;
    else if (arg === "--resume") options.resume = true;
    else if (arg === "--include-disabled") options.includeDisabled = true;
    else if (arg === "--apply") options.apply = true;
    else if (arg === "--confirm-production") options.confirmProduction = true;
    else if (arg.startsWith("--source=")) options.source = clean(arg.slice("--source=".length)).toLowerCase();
    else if (arg.startsWith("--company-limit=")) {
      options.requestedCompanyLimit = asInt(arg.slice("--company-limit=".length), options.requestedCompanyLimit, 1, MAX_COMPANY_LIMIT);
      options.companyLimit = options.requestedCompanyLimit;
    } else if (arg.startsWith("--limit=")) {
      options.requestedCompanyLimit = asInt(arg.slice("--limit=".length), options.requestedCompanyLimit, 1, MAX_COMPANY_LIMIT);
      options.companyLimit = options.requestedCompanyLimit;
    } else if (arg.startsWith("--row-limit=")) {
      options.rowLimit = asInt(arg.slice("--row-limit=".length), options.rowLimit, 1, MAX_ROW_LIMIT);
    } else if (arg.startsWith("--page-size=")) {
      options.pageSize = asInt(arg.slice("--page-size=".length), options.pageSize, 1, MAX_RUN_LIMIT);
    } else if (arg.startsWith("--offset=")) {
      options.offset = asInt(arg.slice("--offset=".length), options.offset, 0, MAX_COMPANY_LIMIT);
    } else if (arg.startsWith("--concurrency=")) {
      options.concurrency = asInt(arg.slice("--concurrency=".length), options.concurrency, 1, 4);
    } else if (arg.startsWith("--host-concurrency=")) {
      options.hostConcurrency = asInt(arg.slice("--host-concurrency=".length), options.hostConcurrency, 1, 4);
    } else if (arg.startsWith("--statement-timeout-ms=")) {
      options.statementTimeoutMs = asInt(arg.slice("--statement-timeout-ms=".length), options.statementTimeoutMs, 1000, 120_000);
    } else if (arg.startsWith("--source-timeout-ms=")) {
      options.sourceTimeoutMs = asInt(arg.slice("--source-timeout-ms=".length), options.sourceTimeoutMs, 1000, 3_600_000);
    } else if (arg.startsWith("--max-runtime-ms=")) {
      options.maxRuntimeMs = asInt(arg.slice("--max-runtime-ms=".length), options.maxRuntimeMs, 1000, MAX_RUNTIME_MS);
    } else if (arg.startsWith("--max-fetches=")) {
      options.maxFetches = asInt(arg.slice("--max-fetches=".length), options.maxFetches, 1, MAX_FETCHES);
    } else if (arg.startsWith("--host-cap=")) {
      options.hostCap = asInt(arg.slice("--host-cap=".length), options.hostCap, 0, MAX_COMPANY_LIMIT);
    } else if (arg.startsWith("--delay-ms=")) {
      options.delayMs = asInt(arg.slice("--delay-ms=".length), options.delayMs, 0, MAX_DELAY_MS);
    } else if (arg.startsWith("--jitter-ms=")) {
      options.jitterMs = asInt(arg.slice("--jitter-ms=".length), options.jitterMs, 0, MAX_DELAY_MS);
    } else if (arg.startsWith("--checkpoint=")) {
      options.checkpoint = clean(arg.slice("--checkpoint=".length), 2000);
    } else if (arg.startsWith("--output=")) {
      options.output = clean(arg.slice("--output=".length), 2000);
    } else if (arg.startsWith("--max-updates=")) {
      options.apply = true;
    }
  }

  return options;
}

function ensureReadOnlyOptions(options = {}) {
  if (options.apply || options.confirmProduction) {
    throw new Error("ats:inventory:scan is read-only and refuses apply/production write flags");
  }
}

function readCheckpoint(checkpointPath, options = {}) {
  if (!options.resume || !checkpointPath || !fs.existsSync(checkpointPath)) return null;
  const parsed = JSON.parse(fs.readFileSync(checkpointPath, "utf8"));
  if (normalizeAtsKey(parsed.source) !== normalizeAtsKey(options.source)) {
    throw new Error(`checkpoint source mismatch: ${parsed.source || ""} != ${options.source || ""}`);
  }
  return parsed;
}

function writeCheckpoint(checkpointPath, checkpoint = {}) {
  if (!checkpointPath) return;
  const resolved = path.resolve(checkpointPath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, `${JSON.stringify(checkpoint, null, 2)}\n`);
}

function checkpointPathForOptions(options = {}) {
  if (options.checkpoint) return options.checkpoint;
  if (options.output) return `${options.output}.checkpoint.json`;
  return "";
}

function createEmptyInventoryReport(options = {}) {
  return {
    ok: true,
    generated_at: nowIso(),
    source: normalizeAtsKey(options.source),
    mode: "inventory-scan",
    read_only: true,
    requested_company_limit: Number(options.requestedCompanyLimit || options.companyLimit || 0),
    effective_page_limit: Number(options.pageSize || MAX_RUN_LIMIT),
    row_limit: Number(options.rowLimit || 0),
    max_runtime_ms: Number(options.maxRuntimeMs || 0),
    max_fetches: Number(options.maxFetches || 0),
    host_cap: Number(options.hostCap || 0),
    delay_ms: Number(options.delayMs || 0),
    jitter_ms: Number(options.jitterMs || 0),
    offset_resume_supported: true,
    unsupported_inventory_resume: false,
    runner_cap_detected: Number(options.requestedCompanyLimit || options.companyLimit || 0) > Number(options.pageSize || MAX_RUN_LIMIT),
    runner_cap_fixed_by_pagination: Number(options.requestedCompanyLimit || options.companyLimit || 0) > Number(options.pageSize || MAX_RUN_LIMIT),
    configured_targets: 0,
    scanned_targets: 0,
    unscanned_targets: 0,
    unreachable_targets: 0,
    successful_targets: 0,
    failed_targets: 0,
    host_cap_skipped_targets: 0,
    rows_fetched: 0,
    rows_parsed: 0,
    clean_candidates: 0,
    net_new_clean_candidates: 0,
    duplicate_existing_public_rows: 0,
    existing_public_update_candidates: 0,
    stale_or_hidden_reactivation_candidates: 0,
    quarantine_candidates: 0,
    rejected_candidates: 0,
    expected_public_row_gain: 0,
    candidate_pool_exhausted: false,
    cannot_prove_remaining_inventory: true,
    estimate_confidence: "low",
    selection_eligible_for_5k_apply: false,
    stop_reason: "",
    classifications: createEmptyClassificationCounts(),
    parser_failure_reasons: {},
    http_status_counts: {},
    quality_risk_of_net_new_rows: {
      missing_country: 0,
      missing_region: 0,
      missing_city: 0,
      missing_any_geo: 0,
      missing_all_geo: 0,
      weak_unknown_remote: 0,
      no_geo_no_remote: 0
    },
    windows: [],
    errors: [],
    samples: []
  };
}

function mergeWindowReport(report, windowReport, windowMeta = {}) {
  const inventory = windowReport.inventory || {};
  const classifications = windowReport.classifications || {};
  const sourceFetchFailures = Number(classifications.source_fetch_failure || 0);
  const targetErrors = new Set((windowReport.errors || []).map((error) => clean(error.source_url || error.error, 400))).size;
  const failedTargets = Math.max(sourceFetchFailures, targetErrors);
  const scannedTargets = Number(inventory.targets_scanned || windowMeta.scanned_targets || 0);
  report.scanned_targets += scannedTargets;
  report.unreachable_targets += sourceFetchFailures;
  report.failed_targets += failedTargets;
  report.successful_targets += Math.max(0, scannedTargets - failedTargets);
  report.rows_fetched += Number(windowReport.rows_fetched || 0);
  report.rows_parsed += Number(windowReport.rows_parsed || 0);
  report.clean_candidates += Number(windowReport.clean_candidates || 0);
  report.net_new_clean_candidates += Number(windowReport.net_new_clean_public_candidates || 0);
  report.duplicate_existing_public_rows += Number(windowReport.duplicate_count || 0);
  report.existing_public_update_candidates += Number(windowReport.update_count || 0);
  report.stale_or_hidden_reactivation_candidates += Number(windowReport.stale_or_hidden_reactivation_candidates || 0);
  report.quarantine_candidates += Number(windowReport.quarantine_count || 0);
  report.rejected_candidates += Number(windowReport.rejected_count || 0);
  report.expected_public_row_gain += Number(windowReport.expected_public_row_gain || 0);
  mergeCounter(report.classifications, classifications);
  mergeCounter(report.parser_failure_reasons, windowReport.parser_failure_reasons || {});
  mergeCounter(report.http_status_counts, windowReport.http_status_counts || {});
  for (const [key, value] of Object.entries(windowReport.quality_risk_of_net_new_rows || {})) {
    report.quality_risk_of_net_new_rows[key] = Number(report.quality_risk_of_net_new_rows[key] || 0) + Number(value || 0);
  }
  for (const error of windowReport.errors || []) {
    if (report.errors.length >= 100) break;
    report.errors.push(error);
  }
  for (const sample of windowReport.samples || []) {
    if (report.samples.length >= 50) break;
    report.samples.push(sample);
  }
}

function estimateConfidence(report = {}) {
  if (report.candidate_pool_exhausted && !report.stop_reason) return "high";
  if (Number(report.net_new_clean_candidates || 0) >= 5000) return "medium";
  return "low";
}

function finalizeInventoryReport(report, options = {}, runtime = {}) {
  const configured = Number(report.configured_targets || 0);
  const nextOffset = Number(runtime.nextOffset || 0);
  const hostSkipped = Number(report.host_cap_skipped_targets || 0);
  report.unscanned_targets = Math.max(0, configured - nextOffset) + hostSkipped;
  report.candidate_pool_exhausted = configured > 0
    && nextOffset >= configured
    && hostSkipped === 0
    && !["row_limit_reached", "max_fetches_reached", "max_runtime_reached", "company_limit_reached"].includes(report.stop_reason);
  report.cannot_prove_remaining_inventory = !report.candidate_pool_exhausted;
  report.target_coverage_pct = pct(report.scanned_targets, configured);
  report.estimate_confidence = estimateConfidence(report);
  report.selection_eligible_for_5k_apply = Number(report.net_new_clean_candidates || 0) >= 5000
    && (report.candidate_pool_exhausted || report.estimate_confidence === "medium");
  report.next_offset = nextOffset;
  report.page_count = report.windows.length;
  report.summary = {
    source: report.source,
    configured_targets: report.configured_targets,
    scanned_targets: report.scanned_targets,
    unscanned_targets: report.unscanned_targets,
    successful_targets: report.successful_targets,
    failed_targets: report.failed_targets,
    parsed_rows: report.rows_parsed,
    clean_candidates: report.clean_candidates,
    net_new_clean_candidates: report.net_new_clean_candidates,
    duplicate_existing_public_rows: report.duplicate_existing_public_rows,
    expected_public_row_gain: report.expected_public_row_gain,
    candidate_pool_exhausted: report.candidate_pool_exhausted,
    estimate_confidence: report.estimate_confidence
  };
  return report;
}

function checkpointFromReport(report, options = {}, runtime = {}) {
  return {
    source: report.source,
    updated_at: nowIso(),
    next_offset: Number(runtime.nextOffset || report.next_offset || 0),
    configured_targets: report.configured_targets,
    scanned_targets: report.scanned_targets,
    rows_parsed: report.rows_parsed,
    net_new_clean_candidates: report.net_new_clean_candidates,
    windows: report.windows.map((window) => ({
      offset: window.offset,
      requested_limit: window.requested_limit,
      targets_scanned: window.targets_scanned,
      next_offset: window.next_offset
    }))
  };
}

function filterTargetsByHostCap(targets = [], hostCounts = new Map(), hostCap = 0) {
  if (!hostCap) return { targets, skipped: 0 };
  const allowed = [];
  let skipped = 0;
  for (const target of targets) {
    const host = target.host || sourceHost(target.companyUrl);
    const count = Number(hostCounts.get(host) || 0);
    if (host && count >= hostCap) {
      skipped += 1;
      continue;
    }
    allowed.push(target);
    if (host) hostCounts.set(host, count + 1);
  }
  return { targets: allowed, skipped };
}

async function runInventoryScan(options = parseInventoryArgs(), env = process.env) {
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
  const report = createEmptyInventoryReport({ ...options, source });
  const startedAt = Date.now();
  const checkpointPath = checkpointPathForOptions(options);
  const checkpoint = readCheckpoint(checkpointPath, { ...options, source });
  const hostCounts = new Map();
  let nextOffset = checkpoint ? Number(checkpoint.next_offset || 0) : Number(options.offset || 0);
  let scannedThisRun = 0;

  try {
    if (!options.pool) {
      lock = await acquireHeavyJobLock(pool, `ats-inventory-scan-${source}`);
    }
    const countTargets = options.countConfiguredTargets || countConfiguredTargets;
    const discoverTargets = options.discoverTargets || discoverSourceTargets;
    const estimateWindow = options.estimateWindow || runNetNewEstimate;
    report.configured_targets = await countTargets(pool, source, options);
    const companyLimit = Math.min(
      Number(options.companyLimit || options.requestedCompanyLimit || DEFAULT_COMPANY_LIMIT),
      report.configured_targets || Number(options.companyLimit || DEFAULT_COMPANY_LIMIT)
    );
    const scanEndOffset = Math.min(report.configured_targets, Number(options.offset || 0) + companyLimit);
    while (nextOffset < scanEndOffset) {
      const elapsed = Date.now() - startedAt;
      if (elapsed >= Number(options.maxRuntimeMs || DEFAULT_MAX_RUNTIME_MS)) {
        report.stop_reason = "max_runtime_reached";
        break;
      }
      if (report.scanned_targets >= Number(options.maxFetches || DEFAULT_MAX_FETCHES)) {
        report.stop_reason = "max_fetches_reached";
        break;
      }
      if (report.rows_parsed >= Number(options.rowLimit || DEFAULT_ROW_LIMIT)) {
        report.stop_reason = "row_limit_reached";
        break;
      }
      if (report.windows.length > 0 && (options.delayMs || options.jitterMs)) {
        const jitter = options.jitterMs ? Math.floor(Math.random() * (Number(options.jitterMs) + 1)) : 0;
        await sleep(Number(options.delayMs || 0) + jitter);
      }
      const remainingCompanies = Math.max(0, scanEndOffset - nextOffset);
      const remainingFetches = Math.max(
        1,
        Number(options.maxFetches || DEFAULT_MAX_FETCHES) - Number(report.scanned_targets || 0)
      );
      const pageLimit = Math.min(Number(options.pageSize || MAX_RUN_LIMIT), remainingCompanies, remainingFetches, MAX_RUN_LIMIT);
      const discoveredTargets = await discoverTargets(pool, {
        ...options,
        source,
        limit: pageLimit,
        offset: nextOffset
      });
      if (discoveredTargets.length === 0) break;
      const { targets, skipped } = filterTargetsByHostCap(discoveredTargets, hostCounts, Number(options.hostCap || 0));
      report.host_cap_skipped_targets += skipped;
      const windowOffset = nextOffset;
      nextOffset += discoveredTargets.length;
      if (targets.length === 0) {
        report.windows.push({
          offset: windowOffset,
          requested_limit: pageLimit,
          targets_discovered: discoveredTargets.length,
          targets_scanned: 0,
          targets_skipped_by_host_cap: skipped,
          next_offset: nextOffset,
          stop_reason: "host_cap_window_skipped"
        });
        continue;
      }
      const windowReport = await estimateWindow({
        ...options,
        source,
        pool,
        targets,
        configuredTargets: report.configured_targets,
        requestedLimit: pageLimit,
        limit: targets.length,
        offset: windowOffset
      }, env);
      mergeWindowReport(report, windowReport, { scanned_targets: targets.length });
      scannedThisRun += targets.length;
      report.windows.push({
        offset: windowOffset,
        requested_limit: pageLimit,
        targets_discovered: discoveredTargets.length,
        targets_scanned: targets.length,
        targets_skipped_by_host_cap: skipped,
        next_offset: nextOffset,
        rows_fetched: windowReport.rows_fetched,
        rows_parsed: windowReport.rows_parsed,
        clean_candidates: windowReport.clean_candidates,
        net_new_clean_candidates: windowReport.net_new_clean_public_candidates,
        duplicate_existing_public_rows: windowReport.duplicate_count,
        expected_public_row_gain: windowReport.expected_public_row_gain,
        target_coverage_pct: pct(nextOffset, report.configured_targets)
      });
      if (checkpointPath && report.windows.length % Number(options.checkpointEveryWindows || 1) === 0) {
        writeCheckpoint(checkpointPath, checkpointFromReport(report, options, { nextOffset }));
      }
    }
    if (!report.stop_reason && nextOffset < report.configured_targets) {
      report.stop_reason = nextOffset >= scanEndOffset ? "company_limit_reached" : "";
    }
    finalizeInventoryReport(report, options, { nextOffset });
    if (checkpointPath) writeCheckpoint(checkpointPath, checkpointFromReport(report, options, { nextOffset }));
    if (lock) await lock.release("succeeded");
    lock = null;
    report.runtime_ms = Date.now() - startedAt;
    report.scanned_targets_this_run = scannedThisRun;
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

function printInventorySummary(report = {}) {
  process.stdout.write(
    [
      `ATS inventory scan: ${report.source}`,
      `  configured_targets: ${report.configured_targets || 0}`,
      `  scanned_targets: ${report.scanned_targets || 0}`,
      `  unscanned_targets: ${report.unscanned_targets || 0}`,
      `  successful_targets: ${report.successful_targets || 0}`,
      `  failed_targets: ${report.failed_targets || 0}`,
      `  rows_parsed: ${report.rows_parsed || 0}`,
      `  clean_candidates: ${report.clean_candidates || 0}`,
      `  net_new_clean_candidates: ${report.net_new_clean_candidates || 0}`,
      `  duplicate_existing_public_rows: ${report.duplicate_existing_public_rows || 0}`,
      `  candidate_pool_exhausted: ${Boolean(report.candidate_pool_exhausted)}`,
      `  estimate_confidence: ${report.estimate_confidence || "low"}`,
      `  stop_reason: ${report.stop_reason || "none"}`
    ].join("\n") + "\n"
  );
}

function writeInventoryOutput(report, outputPath) {
  writeEstimatorOutput(report, outputPath);
}

module.exports = {
  DEFAULT_MAX_RUNTIME_MS,
  DEFAULT_ROW_LIMIT,
  filterTargetsByHostCap,
  finalizeInventoryReport,
  mergeWindowReport,
  parseInventoryArgs,
  printInventorySummary,
  runInventoryScan,
  writeCheckpoint,
  readCheckpoint,
  writeInventoryOutput
};
