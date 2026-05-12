const fs = require("fs");
const path = require("path");
const { SOURCE_RECOVERY_REPORT_SCHEMA, validateSourceRecoveryReport } = require("../server/ingestion/sourceRecoveryReport");

function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    before: "",
    after: "",
    beforeSourceQuality: "",
    afterSourceQuality: "",
    sourceReport: "",
    meiliCheck: "",
    ingestionStatus: "",
    serviceStats: "",
    output: "",
    json: false,
    maxCpuPct: 85,
    maxActivePostgresQueries: 0
  };
  for (const arg of argv) {
    if (arg === "--json") options.json = true;
    else if (arg.startsWith("--before=")) options.before = arg.slice("--before=".length);
    else if (arg.startsWith("--after=")) options.after = arg.slice("--after=".length);
    else if (arg.startsWith("--before-source-quality=")) options.beforeSourceQuality = arg.slice("--before-source-quality=".length);
    else if (arg.startsWith("--after-source-quality=")) options.afterSourceQuality = arg.slice("--after-source-quality=".length);
    else if (arg.startsWith("--source-report=")) options.sourceReport = arg.slice("--source-report=".length);
    else if (arg.startsWith("--meili-check=")) options.meiliCheck = arg.slice("--meili-check=".length);
    else if (arg.startsWith("--ingestion-status=")) options.ingestionStatus = arg.slice("--ingestion-status=".length);
    else if (arg.startsWith("--service-stats=")) options.serviceStats = arg.slice("--service-stats=".length);
    else if (arg.startsWith("--output=")) options.output = arg.slice("--output=".length);
    else if (arg.startsWith("--max-cpu-pct=")) options.maxCpuPct = Number(arg.slice("--max-cpu-pct=".length));
    else if (arg.startsWith("--max-active-postgres-queries=")) {
      options.maxActivePostgresQueries = Number(arg.slice("--max-active-postgres-queries=".length));
    }
  }
  if (!Number.isFinite(options.maxCpuPct)) options.maxCpuPct = 85;
  if (!Number.isFinite(options.maxActivePostgresQueries)) options.maxActivePostgresQueries = 0;
  return options;
}

function readJson(filePath) {
  if (!filePath) return null;
  return JSON.parse(fs.readFileSync(path.resolve(filePath), "utf8"));
}

function writeJson(filePath, payload) {
  if (!filePath) return;
  const resolved = path.resolve(filePath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, `${JSON.stringify(payload, null, 2)}\n`);
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clean(value) {
  return String(value ?? "").trim();
}

function pctNumber(value) {
  if (typeof value === "number") return value;
  const text = clean(value).replace("%", "");
  return toNumber(text, 0);
}

function visibleCount(report = {}) {
  const summary = report.summary || report;
  return toNumber(
    summary.total_visible_postings ??
    summary.visible_count ??
    summary.visible_rows ??
    report.total_visible_postings ??
    report.visible_count
  );
}

function sourceRows(payload = {}) {
  if (!payload) return [];
  if (Array.isArray(payload.items)) return payload.items;
  if (Array.isArray(payload.by_source)) return payload.by_source;
  if (Array.isArray(payload.source_quality)) return payload.source_quality;
  if (Array.isArray(payload.item?.source_quality)) return payload.item.source_quality;
  if (Array.isArray(payload.source_quality?.items)) return payload.source_quality.items;
  return [];
}

function sourceKey(row = {}) {
  return clean(row.ats_key || row.source_ats || row.source || row.key).toLowerCase();
}

function acceptedRows(row = {}) {
  return toNumber(row.accepted_public_rows ?? row.accepted_rows ?? row.accepted_count ?? row.visible_rows ?? row.total_visible_rows);
}

function sourceAcceptedMap(payload = {}) {
  const map = new Map();
  for (const row of sourceRows(payload)) {
    const key = sourceKey(row);
    if (!key) continue;
    map.set(key, acceptedRows(row));
  }
  return map;
}

function meiliDelta(report = {}) {
  if (!report) return 0;
  return toNumber(report.count_delta ?? report.meili_postgres_delta ?? report.delta ?? report.summary?.count_delta);
}

function getIngestionItem(status = {}) {
  return status.item || status;
}

function collectSafetyViolations({ ingestionStatus, serviceStats, maxCpuPct, maxActivePostgresQueries }) {
  const violations = [];
  const item = getIngestionItem(ingestionStatus || {});
  const heavyJob = item.heavy_job || ingestionStatus?.heavy_job || {};
  if (heavyJob.active) {
    violations.push({
      code: "unsafe_heavy_job_lock_active",
      message: "heavy-job advisory lock is active",
      detail: heavyJob
    });
  }
  if (clean(item.write_pressure).toLowerCase() === "active") {
    violations.push({
      code: "unsafe_write_pressure_active",
      message: "ingestion write pressure is active"
    });
  }
  const activeQueries = toNumber(
    item.active_postgres_queries ??
    item.db_active_queries ??
    item.postgres?.active_queries ??
    ingestionStatus?.active_postgres_queries,
    0
  );
  if (activeQueries > maxActivePostgresQueries) {
    violations.push({
      code: "unsafe_postgres_active_queries",
      message: `active Postgres queries ${activeQueries} > ${maxActivePostgresQueries}`,
      active_queries: activeQueries
    });
  }
  const stats = Array.isArray(serviceStats) ? serviceStats : serviceStats?.items || serviceStats?.services || [];
  for (const row of stats) {
    const cpu = pctNumber(row.cpu_percent ?? row.cpu ?? row.CPUPerc);
    if (cpu > maxCpuPct) {
      violations.push({
        code: "unsafe_service_cpu",
        message: `service ${clean(row.name || row.container || row.Name || "unknown")} CPU ${cpu}% > ${maxCpuPct}%`,
        service: clean(row.name || row.container || row.Name || "unknown"),
        cpu_percent: cpu
      });
    }
  }
  return violations;
}

function compareSourceAccepted(beforePayload, afterPayload) {
  const before = sourceAcceptedMap(beforePayload);
  const after = sourceAcceptedMap(afterPayload);
  const decreases = [];
  for (const [source, beforeCount] of before.entries()) {
    if (!after.has(source)) continue;
    const afterCount = after.get(source);
    if (afterCount < beforeCount) {
      decreases.push({ source, before: beforeCount, after: afterCount, delta: afterCount - beforeCount });
    }
  }
  return decreases;
}

function evaluateRecoveryGuard(input = {}) {
  const failures = [];
  const warnings = [];
  if (!input.before) {
    failures.push({
      code: "missing_before_report",
      message: "before data-quality/source-quality report is required"
    });
  }
  if (!input.after) {
    failures.push({
      code: "missing_after_report",
      message: "after data-quality/source-quality report is required"
    });
  }
  if (!input.sourceReport) {
    failures.push({
      code: "missing_source_recovery_report",
      message: "source recovery report is required"
    });
  }
  if (!input.meiliCheck) {
    failures.push({
      code: "missing_meili_check",
      message: "Meili/Postgres bounded indexing check report is required"
    });
  }
  if (!input.ingestionStatus) {
    failures.push({
      code: "missing_ingestion_status",
      message: "live ingestion status report is required for heavy-lock/write-pressure checks"
    });
  }
  if (!input.serviceStats) {
    failures.push({
      code: "missing_service_stats",
      message: "service CPU/memory stats report is required for CPU safety checks"
    });
  }
  const beforeVisible = visibleCount(input.before || {});
  const afterVisible = visibleCount(input.after || {});

  if (beforeVisible > 0 && afterVisible > 0 && afterVisible < beforeVisible) {
    failures.push({
      code: "visible_count_decreased",
      message: `visible_count_after ${afterVisible} < visible_count_before ${beforeVisible}`,
      before: beforeVisible,
      after: afterVisible
    });
  }

  const sourceDecreases = compareSourceAccepted(
    input.beforeSourceQuality || input.before,
    input.afterSourceQuality || input.after
  );
  for (const decrease of sourceDecreases) {
    failures.push({
      code: "source_accepted_public_rows_decreased",
      message: `accepted public rows decreased for ${decrease.source}`,
      ...decrease
    });
  }

  let sourceReportValidation = null;
  if (input.sourceReport) {
    sourceReportValidation = validateSourceRecoveryReport(input.sourceReport);
    const report = sourceReportValidation.report;
    for (const error of sourceReportValidation.errors) {
      failures.push({
        code: "invalid_source_recovery_report",
        message: error,
        source: report.source
      });
    }
    if (report.accepted_public_rows_after < report.accepted_public_rows_before) {
      failures.push({
        code: "source_accepted_public_rows_decreased",
        message: `accepted public rows decreased for ${report.source}`,
        source: report.source,
        before: report.accepted_public_rows_before,
        after: report.accepted_public_rows_after,
        delta: report.accepted_public_rows_after - report.accepted_public_rows_before
      });
    }
    if (report.rows_newly_accepted_no_geo_no_remote > 0) {
      failures.push({
        code: "new_accepted_no_geo_no_remote",
        message: `newly accepted rows include ${report.rows_newly_accepted_no_geo_no_remote} no_geo_no_remote rows`,
        source: report.source,
        count: report.rows_newly_accepted_no_geo_no_remote
      });
    }
    const geoImproved = report.missing_geo_after < report.missing_geo_before;
    const remoteImproved = report.weak_remote_after < report.weak_remote_before;
    const rowsGained = report.public_row_gain > 0;
    if (!geoImproved && !remoteImproved && !rowsGained) {
      const reasons = report.no_improvement_reasons || {};
      const reasonCount = Object.keys(reasons.by_tenant || {}).length +
        Object.keys(reasons.by_source || {}).length +
        Object.keys(reasons.by_error || {}).length +
        (Array.isArray(reasons.items) ? reasons.items.length : 0);
      if (reasonCount === 0) {
        failures.push({
          code: "missing_no_improvement_reasons",
          message: `no improvement recorded for ${report.source} without tenant/source/error reasons`,
          source: report.source
        });
      } else {
        warnings.push({
          code: "no_improvement_reasons_recorded",
          message: `no improvement recorded for ${report.source}; reasons are grouped by tenant/source/error`,
          source: report.source,
          no_improvement_reasons: reasons
        });
      }
    }
  }

  if (input.meiliCheck) {
    const delta = meiliDelta(input.meiliCheck);
    if (delta !== 0) {
      failures.push({
        code: "meili_postgres_delta_nonzero",
        message: `Meili/Postgres delta is ${delta}`,
        delta
      });
    }
  }

  failures.push(...collectSafetyViolations({
    ingestionStatus: input.ingestionStatus,
    serviceStats: input.serviceStats,
    maxCpuPct: toNumber(input.maxCpuPct, 85),
    maxActivePostgresQueries: toNumber(input.maxActivePostgresQueries, 0)
  }));

  return {
    ok: failures.length === 0,
    generated_at: new Date().toISOString(),
    visible_count_before: beforeVisible,
    visible_count_after: afterVisible,
    failures,
    warnings,
    source_recovery_report_schema: SOURCE_RECOVERY_REPORT_SCHEMA,
    source_recovery_report: sourceReportValidation?.report || null
  };
}

async function main() {
  const options = parseArgs();
  const result = evaluateRecoveryGuard({
    before: readJson(options.before),
    after: readJson(options.after),
    beforeSourceQuality: readJson(options.beforeSourceQuality),
    afterSourceQuality: readJson(options.afterSourceQuality),
    sourceReport: readJson(options.sourceReport),
    meiliCheck: readJson(options.meiliCheck),
    ingestionStatus: readJson(options.ingestionStatus),
    serviceStats: readJson(options.serviceStats),
    maxCpuPct: options.maxCpuPct,
    maxActivePostgresQueries: options.maxActivePostgresQueries
  });
  writeJson(options.output, result);
  if (options.json || !result.ok) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    process.stdout.write(`ATS recovery guard passed: visible ${result.visible_count_before} -> ${result.visible_count_after}\n`);
  }
  if (!result.ok) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error?.stack || error);
    process.exit(1);
  });
}

module.exports = {
  collectSafetyViolations,
  compareSourceAccepted,
  evaluateRecoveryGuard,
  parseArgs,
  sourceAcceptedMap,
  visibleCount
};
