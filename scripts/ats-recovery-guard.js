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

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(String(value).replace("%", ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function firstNumber(...values) {
  for (const value of values) {
    const parsed = numberOrNull(value);
    if (parsed !== null) return parsed;
  }
  return null;
}

function pctFromCount(count, total) {
  const parsedCount = numberOrNull(count);
  const parsedTotal = numberOrNull(total);
  if (parsedCount === null || parsedTotal === null || parsedTotal <= 0) return null;
  return Number(((parsedCount * 100) / parsedTotal).toFixed(2));
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

function globalMissingAnyGeoPct(report = {}) {
  const summary = report.summary || report;
  return firstNumber(
    summary.missing_any_normalized_geo_pct,
    summary.missing_any_geo_pct,
    summary.field_gap_percentages?.missing_any_normalized_geo,
    summary.field_gap_percentages?.missing_any_geo,
    pctFromCount(
      summary.missing_any_normalized_geo_count ?? summary.missing_any_geo_count,
      summary.total_visible_postings ?? summary.visible_count ?? summary.visible_rows
    )
  );
}

function globalWeakUnknownRemotePct(report = {}) {
  const summary = report.summary || report;
  return firstNumber(
    summary.weak_unknown_remote_type_pct,
    summary.weak_unknown_remote_pct,
    summary.weak_remote_pct,
    summary.unknown_remote_pct,
    summary.field_gap_percentages?.weak_unknown_remote_type,
    pctFromCount(
      summary.weak_unknown_remote_type_count ??
        summary.weak_unknown_remote_count ??
        summary.weak_remote_count ??
        summary.unknown_remote_count,
      summary.total_visible_postings ?? summary.visible_count ?? summary.visible_rows
    )
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

function sourceRow(payload = {}, source = "") {
  const key = clean(source).toLowerCase();
  if (!key) return null;
  return sourceRows(payload).find((row) => sourceKey(row) === key) || null;
}

function acceptedRows(row = {}) {
  return toNumber(row.accepted_public_rows ?? row.accepted_rows ?? row.accepted_count ?? row.visible_rows ?? row.total_visible_rows);
}

function totalSourceRows(row = {}) {
  return firstNumber(
    row.total_visible_rows,
    row.visible_rows,
    row.total_visible_postings,
    row.accepted_public_rows,
    row.accepted_rows
  );
}

function sourceMissingAnyGeoPct(payload = {}, source = "", fallbackReport = null, phase = "before") {
  const row = sourceRow(payload, source);
  const rowPct = row
    ? firstNumber(
        row.missing_any_normalized_geo_pct,
        row.missing_any_geo_pct,
        pctFromCount(
          row.missing_any_normalized_geo_count ?? row.missing_any_geo_count ?? row.missing_geo_count,
          totalSourceRows(row)
        )
      )
    : null;
  if (rowPct !== null) return rowPct;
  if (!fallbackReport) return null;
  const count = phase === "after" ? fallbackReport.missing_geo_after : fallbackReport.missing_geo_before;
  const total = phase === "after" ? fallbackReport.accepted_public_rows_after : fallbackReport.accepted_public_rows_before;
  return pctFromCount(count, total);
}

function sourceWeakUnknownRemotePct(payload = {}, source = "", fallbackReport = null, phase = "before") {
  const row = sourceRow(payload, source);
  const rowPct = row
    ? firstNumber(
        row.weak_unknown_remote_type_pct,
        row.weak_unknown_remote_pct,
        row.weak_remote_pct,
        row.unknown_remote_pct,
        pctFromCount(
          row.weak_unknown_remote_type_count ??
            row.weak_unknown_remote_count ??
            row.weak_remote_count ??
            row.unknown_remote_count,
          totalSourceRows(row)
        )
      )
    : null;
  if (rowPct !== null) return rowPct;
  if (!fallbackReport) return null;
  const count = phase === "after" ? fallbackReport.weak_remote_after : fallbackReport.weak_remote_before;
  const total = phase === "after" ? fallbackReport.accepted_public_rows_after : fallbackReport.accepted_public_rows_before;
  return pctFromCount(count, total);
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
    const serviceName = clean(row.name || row.container || row.Name || "unknown");
    const statusText = clean(row.status || row.state || row.Status || row.State).toLowerCase();
    if (
      serviceName.toLowerCase().includes("worker") &&
      (statusText.includes("up") || statusText.includes("running")) &&
      !Boolean(row.worker_isolated || row.isolated || item.worker_isolated || item.source_scope_isolated)
    ) {
      violations.push({
        code: "unsafe_worker_running_unisolated",
        message: `worker service ${serviceName} is running without explicit source isolation`,
        service: serviceName,
        status: statusText
      });
    }
    const cpu = pctNumber(row.cpu_percent ?? row.cpu ?? row.CPUPerc);
    if (cpu > maxCpuPct) {
      violations.push({
        code: "unsafe_service_cpu",
        message: `service ${serviceName} CPU ${cpu}% > ${maxCpuPct}%`,
        service: serviceName,
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

function reasonCount(reasons = {}) {
  return Object.keys(reasons.by_tenant || {}).length +
    Object.keys(reasons.by_source || {}).length +
    Object.keys(reasons.by_error || {}).length +
    (Array.isArray(reasons.items) ? reasons.items.length : 0);
}

function rowEvidenceList(report = {}) {
  const candidates = [
    report.newly_accepted_row_evidence,
    report.newly_accepted_rows,
    report.accepted_row_evidence,
    report.clean_row_evidence
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
  }
  return [];
}

function hasRowIdentifier(row = {}) {
  return Boolean(clean(row.source_job_id || row.canonical_url || row.url || row.id));
}

function hasExplicitRemoteHybridEvidence(row = {}) {
  const remoteType = clean(row.remote_type || row.workplace_type || row.work_type).toLowerCase();
  const remoteOrHybrid = remoteType === "remote" || remoteType === "hybrid";
  return hasRowIdentifier(row) && (
    row.explicit_remote_evidence === true ||
    (remoteOrHybrid && Boolean(row.remote_evidence || row.evidence?.remote || row.evidence?.workplace_type))
  );
}

function hasUsefulNormalizedGeoEvidence(row = {}) {
  const hasStructuredGeo = Boolean(clean(row.country) && (clean(row.region) || clean(row.city)));
  return hasRowIdentifier(row) && (
    row.useful_normalized_geo === true ||
    (hasStructuredGeo && Boolean(row.geo_evidence || row.evidence?.geo || row.evidence?.location))
  );
}

function allNewRowsDocumented(report = {}, predicate) {
  const expected = Math.max(0, toNumber(report.rows_newly_accepted, report.public_row_gain));
  if (expected <= 0) return false;
  const rows = rowEvidenceList(report);
  if (rows.length < expected) return false;
  return rows.slice(0, expected).every(predicate);
}

function isNoImprovementBlockerOnly(report = {}) {
  return report.no_improvement_blocker_only === true &&
    report.public_row_gain === 0 &&
    report.rows_newly_accepted === 0 &&
    report.rows_updated_existing === 0 &&
    reasonCount(report.no_improvement_reasons) > 0;
}

function addNoReleaseReason(reasons, code, message, detail = {}) {
  if (reasons.some((reason) => reason.code === code)) return;
  reasons.push({ code, message, ...detail });
}

function evaluateRecoveryGuard(input = {}) {
  const failures = [];
  const warnings = [];
  const noReleaseAllowed = [];
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
  const beforeGlobalMissingAnyGeoPct = globalMissingAnyGeoPct(input.before || {});
  const afterGlobalMissingAnyGeoPct = globalMissingAnyGeoPct(input.after || {});
  const beforeGlobalWeakRemotePct = globalWeakUnknownRemotePct(input.before || {});
  const afterGlobalWeakRemotePct = globalWeakUnknownRemotePct(input.after || {});

  if (beforeVisible > 0 && afterVisible > 0 && afterVisible < beforeVisible) {
    failures.push({
      code: "visible_count_decreased",
      message: `visible_count_after ${afterVisible} < visible_count_before ${beforeVisible}`,
      before: beforeVisible,
      after: afterVisible
    });
  }

  if (
    beforeGlobalMissingAnyGeoPct !== null &&
    afterGlobalMissingAnyGeoPct !== null &&
    afterGlobalMissingAnyGeoPct > beforeGlobalMissingAnyGeoPct
  ) {
    failures.push({
      code: "global_missing_any_geo_pct_increased",
      message: `global missing_any_geo_pct_after ${afterGlobalMissingAnyGeoPct} > before ${beforeGlobalMissingAnyGeoPct}`,
      before: beforeGlobalMissingAnyGeoPct,
      after: afterGlobalMissingAnyGeoPct
    });
  }

  if (
    beforeGlobalWeakRemotePct !== null &&
    afterGlobalWeakRemotePct !== null &&
    afterGlobalWeakRemotePct > beforeGlobalWeakRemotePct
  ) {
    failures.push({
      code: "global_weak_unknown_remote_pct_increased",
      message: `global weak_unknown_remote_pct_after ${afterGlobalWeakRemotePct} > before ${beforeGlobalWeakRemotePct}`,
      before: beforeGlobalWeakRemotePct,
      after: afterGlobalWeakRemotePct
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
  let recoverySuccess = false;
  let noImprovementBlockerOnly = false;
  if (input.sourceReport) {
    sourceReportValidation = validateSourceRecoveryReport(input.sourceReport);
    const report = sourceReportValidation.report;
    noImprovementBlockerOnly = isNoImprovementBlockerOnly(report);
    recoverySuccess = report.public_row_gain > 0;
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
    if (report.accepted_public_rows_after <= report.accepted_public_rows_before && !noImprovementBlockerOnly) {
      failures.push({
        code: "target_accepted_public_rows_not_increased",
        message: `accepted public rows did not increase for ${report.source}`,
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
    const beforeSourceMissingGeoPct = sourceMissingAnyGeoPct(
      input.beforeSourceQuality || input.before,
      report.source,
      report,
      "before"
    );
    const afterSourceMissingGeoPct = sourceMissingAnyGeoPct(
      input.afterSourceQuality || input.after,
      report.source,
      report,
      "after"
    );
    const beforeSourceWeakRemotePct = sourceWeakUnknownRemotePct(
      input.beforeSourceQuality || input.before,
      report.source,
      report,
      "before"
    );
    const afterSourceWeakRemotePct = sourceWeakUnknownRemotePct(
      input.afterSourceQuality || input.after,
      report.source,
      report,
      "after"
    );
    if (
      beforeSourceMissingGeoPct !== null &&
      afterSourceMissingGeoPct !== null &&
      afterSourceMissingGeoPct > beforeSourceMissingGeoPct &&
      !allNewRowsDocumented(report, hasExplicitRemoteHybridEvidence)
    ) {
      failures.push({
        code: "source_missing_any_geo_pct_increased",
        message: `source missing_any_geo_pct_after ${afterSourceMissingGeoPct} > before ${beforeSourceMissingGeoPct} without row-by-row explicit remote/hybrid evidence`,
        source: report.source,
        before: beforeSourceMissingGeoPct,
        after: afterSourceMissingGeoPct
      });
    }
    if (
      beforeSourceWeakRemotePct !== null &&
      afterSourceWeakRemotePct !== null &&
      afterSourceWeakRemotePct > beforeSourceWeakRemotePct &&
      !allNewRowsDocumented(report, hasUsefulNormalizedGeoEvidence)
    ) {
      failures.push({
        code: "source_weak_unknown_remote_pct_increased",
        message: `source weak_unknown_remote_pct_after ${afterSourceWeakRemotePct} > before ${beforeSourceWeakRemotePct} without row-by-row useful normalized geo evidence`,
        source: report.source,
        before: beforeSourceWeakRemotePct,
        after: afterSourceWeakRemotePct
      });
    }
    const geoImproved = report.missing_geo_after < report.missing_geo_before;
    const remoteImproved = report.weak_remote_after < report.weak_remote_before;
    const rowsGained = report.public_row_gain > 0;
    if (!geoImproved && !remoteImproved && !rowsGained) {
      const reasons = report.no_improvement_reasons || {};
      if (reasonCount(reasons) === 0) {
        failures.push({
          code: "missing_no_improvement_reasons",
          message: `no improvement recorded for ${report.source} without tenant/source/error reasons`,
          source: report.source
        });
      } else if (!noImprovementBlockerOnly) {
        failures.push({
          code: "no_improvement_not_marked_blocker_only",
          message: `no improvement recorded for ${report.source} but report is not explicitly marked no_improvement_blocker_only`,
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

  const failureCodes = failures.map((failure) => failure.code);
  const hasGlobalQualityRegression =
    failureCodes.includes("global_missing_any_geo_pct_increased") ||
    failureCodes.includes("global_weak_unknown_remote_pct_increased");

  if (afterVisible > beforeVisible && hasGlobalQualityRegression) {
    addNoReleaseReason(
      noReleaseAllowed,
      "quality_regressed_with_visible_gain",
      "visible rows increased but global quality percentages regressed",
      { visible_count_before: beforeVisible, visible_count_after: afterVisible }
    );
  }
  if (failureCodes.length === 1 && failureCodes[0] === "meili_postgres_delta_nonzero") {
    addNoReleaseReason(
      noReleaseAllowed,
      "meili_delta_nonzero_only_failure",
      "guard failed only because Meili/Postgres delta is nonzero"
    );
  }
  if (recoverySuccess && hasGlobalQualityRegression && !failureCodes.includes("new_accepted_no_geo_no_remote")) {
    addNoReleaseReason(
      noReleaseAllowed,
      "clean_source_writes_global_quality_regressed",
      "source writes are clean but global quality regressed"
    );
  }
  if (!recoverySuccess && noImprovementBlockerOnly) {
    addNoReleaseReason(
      noReleaseAllowed,
      "no_improvement_blocker_only",
      "no release allowed because the source recovery report is blocker-only and records no production row gain"
    );
  }

  return {
    ok: failures.length === 0,
    success: recoverySuccess,
    release_allowed: failures.length === 0 && recoverySuccess,
    no_release_allowed: noReleaseAllowed,
    generated_at: new Date().toISOString(),
    visible_count_before: beforeVisible,
    visible_count_after: afterVisible,
    global_missing_any_geo_pct_before: beforeGlobalMissingAnyGeoPct,
    global_missing_any_geo_pct_after: afterGlobalMissingAnyGeoPct,
    global_weak_unknown_remote_pct_before: beforeGlobalWeakRemotePct,
    global_weak_unknown_remote_pct_after: afterGlobalWeakRemotePct,
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
  globalMissingAnyGeoPct,
  globalWeakUnknownRemotePct,
  parseArgs,
  sourceAcceptedMap,
  sourceMissingAnyGeoPct,
  sourceWeakUnknownRemotePct,
  visibleCount
};
