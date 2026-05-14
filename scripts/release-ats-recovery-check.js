const fs = require("fs");
const path = require("path");
const {
  evaluateRecoveryGuard,
  globalMissingAnyGeoPct,
  globalWeakUnknownRemotePct,
  visibleCount
} = require("./ats-recovery-guard");
const { normalizeSourceRecoveryReport } = require("../server/ingestion/sourceRecoveryReport");

let stdinCache = null;

function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    before: "",
    after: "",
    sourceReport: "",
    meiliCheck: "",
    guardReport: "",
    testsReport: "",
    preflightReport: "",
    releaseReport: "",
    output: "",
    json: false,
    selfTest: false
  };
  for (const arg of argv) {
    if (arg === "--json") options.json = true;
    else if (arg === "--self-test") options.selfTest = true;
    else if (arg.startsWith("--before=")) options.before = arg.slice("--before=".length);
    else if (arg.startsWith("--before-data-quality=")) options.before = arg.slice("--before-data-quality=".length);
    else if (arg.startsWith("--after=")) options.after = arg.slice("--after=".length);
    else if (arg.startsWith("--after-data-quality=")) options.after = arg.slice("--after-data-quality=".length);
    else if (arg.startsWith("--source-report=")) options.sourceReport = arg.slice("--source-report=".length);
    else if (arg.startsWith("--meili-check=")) options.meiliCheck = arg.slice("--meili-check=".length);
    else if (arg.startsWith("--guard-report=")) options.guardReport = arg.slice("--guard-report=".length);
    else if (arg.startsWith("--guard-result=")) options.guardReport = arg.slice("--guard-result=".length);
    else if (arg.startsWith("--tests-report=")) options.testsReport = arg.slice("--tests-report=".length);
    else if (arg.startsWith("--preflight-report=")) options.preflightReport = arg.slice("--preflight-report=".length);
    else if (arg.startsWith("--release-report=")) options.releaseReport = arg.slice("--release-report=".length);
    else if (arg.startsWith("--output=")) options.output = arg.slice("--output=".length);
  }
  return options;
}

function readStdinJson() {
  if (stdinCache === null) stdinCache = fs.readFileSync(0, "utf8");
  return JSON.parse(stdinCache);
}

function readJson(filePath) {
  if (!filePath) return null;
  if (filePath === "-") return readStdinJson();
  return JSON.parse(fs.readFileSync(path.resolve(filePath), "utf8"));
}

function writeJson(filePath, payload) {
  if (!filePath) return;
  const resolved = path.resolve(filePath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, `${JSON.stringify(payload, null, 2)}\n`);
}

function toNumber(value) {
  const parsed = Number(String(value ?? "").replace("%", ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function firstNumber(...values) {
  for (const value of values) {
    const parsed = toNumber(value);
    if (parsed !== null) return parsed;
  }
  return null;
}

function summary(report = {}) {
  return report.summary || report.item?.summary || report;
}

function missingAllGeoWeakCount(report = {}) {
  const data = summary(report);
  return firstNumber(
    data.missing_all_geo_and_weak_remote_count,
    data.missing_all_geo_plus_weak_remote_count,
    data.no_geo_no_remote_count,
    data.field_gap_counts?.missing_all_geo_and_weak_remote,
    data.field_gap_counts?.no_geo_no_remote
  );
}

function meiliDelta(report = {}) {
  return firstNumber(
    report.count_delta,
    report.meili_postgres_delta,
    report.delta,
    report.summary?.count_delta,
    report.summary?.meili_postgres_delta,
    report.result?.count_delta,
    report.result?.meili_postgres_delta
  );
}

function testsPassed(report = {}) {
  if (!report || Object.keys(report).length === 0) return false;
  if (report.ok === true || report.passed === true || report.success === true) return true;
  const status = String(report.status || report.result || "").trim().toLowerCase();
  if (["pass", "passed", "success", "ok"].includes(status)) return true;
  if (report.commands && typeof report.commands === "object") {
    return Object.values(report.commands).every((value) => {
      if (value === true) return true;
      if (value && typeof value === "object") return testsPassed(value);
      return ["pass", "passed", "success", "ok"].includes(String(value).trim().toLowerCase());
    });
  }
  return false;
}

function guardPassed(report = {}) {
  return report.ok === true && report.success === true && report.release_allowed === true;
}

function preflightPassed(report = {}) {
  return report.ok === true && !report.unsafe;
}

function addFailure(failures, noReleaseAllowed, code, message, detail = {}) {
  failures.push({ code, message, ...detail });
  noReleaseAllowed.push({ code, message });
}

function evaluateReleaseCheck(input = {}) {
  const failures = [];
  const warnings = [];
  const noReleaseAllowed = [];
  const before = input.before || null;
  const after = input.after || null;
  const sourceReport = input.sourceReport ? normalizeSourceRecoveryReport(input.sourceReport) : null;
  const guardReport = input.guardReport || null;
  const testsReport = input.testsReport || null;
  const preflightReport = input.preflightReport || null;
  const meiliCheck = input.meiliCheck || null;

  if (!before) addFailure(failures, noReleaseAllowed, "missing_before_data_quality", "before data-quality report is required");
  if (!after) addFailure(failures, noReleaseAllowed, "missing_after_data_quality", "after data-quality report is required");
  if (!sourceReport) addFailure(failures, noReleaseAllowed, "missing_source_recovery_report", "source recovery report is required");
  if (!guardReport) addFailure(failures, noReleaseAllowed, "missing_guard_report", "ats:recovery:guard result is required");
  if (!testsReport) addFailure(failures, noReleaseAllowed, "missing_tests_report", "test result report is required");
  if (!preflightReport) addFailure(failures, noReleaseAllowed, "missing_preflight_report", "preflight report is required");
  if (!meiliCheck) addFailure(failures, noReleaseAllowed, "missing_meili_check", "Meili/Postgres parity report is required");

  const beforeVisible = before ? visibleCount(before) : null;
  const afterVisible = after ? visibleCount(after) : null;
  if (before && after && afterVisible < beforeVisible) {
    addFailure(failures, noReleaseAllowed, "visible_count_decreased", "visible_count_after is lower than visible_count_before", {
      before: beforeVisible,
      after: afterVisible
    });
  }

  if (sourceReport && sourceReport.accepted_public_rows_after <= sourceReport.accepted_public_rows_before) {
    addFailure(
      failures,
      noReleaseAllowed,
      "accepted_public_rows_not_increased",
      "accepted_public_rows_after must be greater than accepted_public_rows_before",
      {
        source: sourceReport.source,
        before: sourceReport.accepted_public_rows_before,
        after: sourceReport.accepted_public_rows_after
      }
    );
  }

  const beforeMissingAnyGeoPct = before ? globalMissingAnyGeoPct(before) : null;
  const afterMissingAnyGeoPct = after ? globalMissingAnyGeoPct(after) : null;
  if (beforeMissingAnyGeoPct !== null && afterMissingAnyGeoPct !== null && afterMissingAnyGeoPct > beforeMissingAnyGeoPct) {
    addFailure(failures, noReleaseAllowed, "global_missing_any_geo_pct_increased", "global missing-any-geo percentage regressed", {
      before: beforeMissingAnyGeoPct,
      after: afterMissingAnyGeoPct
    });
  }

  const beforeWeakUnknownRemotePct = before ? globalWeakUnknownRemotePct(before) : null;
  const afterWeakUnknownRemotePct = after ? globalWeakUnknownRemotePct(after) : null;
  if (
    beforeWeakUnknownRemotePct !== null &&
    afterWeakUnknownRemotePct !== null &&
    afterWeakUnknownRemotePct > beforeWeakUnknownRemotePct
  ) {
    addFailure(
      failures,
      noReleaseAllowed,
      "global_weak_unknown_remote_pct_increased",
      "global weak/unknown remote percentage regressed",
      { before: beforeWeakUnknownRemotePct, after: afterWeakUnknownRemotePct }
    );
  }

  const beforeNoGeoWeak = before ? missingAllGeoWeakCount(before) : null;
  const afterNoGeoWeak = after ? missingAllGeoWeakCount(after) : null;
  if (before && after && (beforeNoGeoWeak === null || afterNoGeoWeak === null)) {
    addFailure(
      failures,
      noReleaseAllowed,
      "missing_all_geo_weak_metric_unavailable",
      "missing-all-geo plus weak/unknown remote count must be present before release"
    );
  } else if (beforeNoGeoWeak !== null && afterNoGeoWeak !== null && afterNoGeoWeak > beforeNoGeoWeak) {
    addFailure(
      failures,
      noReleaseAllowed,
      "missing_all_geo_and_weak_remote_count_increased",
      "missing all geo plus weak/unknown remote count increased",
      { before: beforeNoGeoWeak, after: afterNoGeoWeak }
    );
  }

  const newNoGeoNoRemote = sourceReport
    ? firstNumber(sourceReport.rows_newly_accepted_no_geo_no_remote, sourceReport.newly_accepted_no_geo_no_remote_count) || 0
    : null;
  if (newNoGeoNoRemote > 0) {
    addFailure(failures, noReleaseAllowed, "new_no_geo_no_remote_accepted", "new accepted rows include no_geo_no_remote rows", {
      count: newNoGeoNoRemote
    });
  }

  const delta = meiliCheck ? meiliDelta(meiliCheck) : null;
  if (delta === null) {
    addFailure(failures, noReleaseAllowed, "meili_delta_unavailable", "Meili/Postgres delta is required");
  } else if (delta !== 0) {
    addFailure(failures, noReleaseAllowed, "meili_postgres_delta_nonzero", "Meili/Postgres delta must be 0", { delta });
  }

  if (guardReport && !guardPassed(guardReport)) {
    addFailure(failures, noReleaseAllowed, "ats_recovery_guard_failed", "ats:recovery:guard did not pass with success=true");
  }

  if (testsReport && !testsPassed(testsReport)) {
    addFailure(failures, noReleaseAllowed, "tests_not_passed", "required tests did not pass or were not documented");
  }

  if (preflightReport && !preflightPassed(preflightReport)) {
    addFailure(failures, noReleaseAllowed, "preflight_unsafe_or_undocumented", "worker/autodeploy/heavy-job state is unsafe or undocumented");
  }

  if (guardReport && guardReport.no_release_allowed?.length) {
    for (const reason of guardReport.no_release_allowed) {
      warnings.push({ code: "guard_no_release_reason", reason });
    }
  }

  return {
    ok: failures.length === 0,
    release_allowed: failures.length === 0,
    generated_at: new Date().toISOString(),
    metrics: {
      visible_count_before: beforeVisible,
      visible_count_after: afterVisible,
      accepted_public_rows_before: sourceReport?.accepted_public_rows_before ?? null,
      accepted_public_rows_after: sourceReport?.accepted_public_rows_after ?? null,
      missing_any_geo_pct_before: beforeMissingAnyGeoPct,
      missing_any_geo_pct_after: afterMissingAnyGeoPct,
      weak_unknown_remote_pct_before: beforeWeakUnknownRemotePct,
      weak_unknown_remote_pct_after: afterWeakUnknownRemotePct,
      missing_all_geo_and_weak_remote_count_before: beforeNoGeoWeak,
      missing_all_geo_and_weak_remote_count_after: afterNoGeoWeak,
      new_no_geo_no_remote_accepted_count: newNoGeoNoRemote,
      meili_postgres_delta: delta
    },
    failures,
    warnings,
    no_release_allowed: noReleaseAllowed
  };
}

function selfTestPayload() {
  const before = {
    summary: {
      total_visible_postings: 100,
      missing_any_normalized_geo_pct: 12,
      weak_unknown_remote_type_pct: 8,
      missing_all_geo_and_weak_remote_count: 2
    }
  };
  const after = {
    summary: {
      total_visible_postings: 110,
      missing_any_normalized_geo_pct: 11,
      weak_unknown_remote_type_pct: 7,
      missing_all_geo_and_weak_remote_count: 1
    }
  };
  const sourceReport = {
    source: "lever",
    tenants_considered: 1,
    tenants_fetched: 1,
    rows_parsed: 12,
    accepted_public_rows_before: 20,
    accepted_public_rows_after: 30,
    public_row_gain: 10,
    rows_updated_existing: 0,
    rows_newly_accepted: 10,
    quarantined: 0,
    skipped_ambiguous: 0,
    missing_geo_before: 2,
    missing_geo_after: 1,
    weak_remote_before: 1,
    weak_remote_after: 1,
    no_improvement_reasons: [],
    rows_newly_accepted_no_geo_no_remote: 0
  };
  const guardReport = evaluateRecoveryGuard({
    before,
    after,
    sourceReport,
    meiliCheck: { count_delta: 0 },
    ingestionStatus: { ok: true, item: { write_pressure: "idle", heavy_job: { active: false } } },
    serviceStats: [{ name: "openjobslots-app", cpu_percent: "0.10%" }]
  });
  return {
    before,
    after,
    sourceReport,
    meiliCheck: { count_delta: 0 },
    guardReport,
    testsReport: { ok: true, commands: { backend: "passed", parsers: "passed", api: "passed" } },
    preflightReport: { ok: true, unsafe: false }
  };
}

async function main() {
  const options = parseArgs();
  let payload;
  if (options.selfTest) {
    payload = selfTestPayload();
  } else if (options.releaseReport) {
    const report = readJson(options.releaseReport);
    payload = {
      before: report.before || report.before_data_quality,
      after: report.after || report.after_data_quality,
      sourceReport: report.source_report || report.sourceRecoveryReport,
      meiliCheck: report.meili_check || report.search_reindex_check,
      guardReport: report.guard_report || report.ats_recovery_guard,
      testsReport: report.tests_report || report.tests,
      preflightReport: report.preflight_report || report.preflight
    };
  } else {
    payload = {
      before: readJson(options.before),
      after: readJson(options.after),
      sourceReport: readJson(options.sourceReport),
      meiliCheck: readJson(options.meiliCheck),
      guardReport: readJson(options.guardReport),
      testsReport: readJson(options.testsReport),
      preflightReport: readJson(options.preflightReport)
    };
  }

  const result = evaluateReleaseCheck(payload);
  writeJson(options.output, result);
  if (options.json || !result.ok) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    process.stdout.write("ATS recovery release check passed\n");
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
  evaluateReleaseCheck,
  missingAllGeoWeakCount,
  parseArgs,
  selfTestPayload
};
