const fs = require("fs");
const path = require("path");
const {
  evaluateRecoveryGuard,
  globalMissingAnyGeoPct,
  globalWeakUnknownRemotePct,
  visibleCount
} = require("./ats-recovery-guard");
const { validateSourceRecoveryReport } = require("../server/ingestion/sourceRecoveryReport");

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

function nonZeroFacetDeltas(delta = {}) {
  if (!delta || typeof delta !== "object" || Array.isArray(delta)) return [];
  const entries = [];
  for (const [key, value] of Object.entries(delta)) {
    const parsed = value && typeof value === "object" && !Array.isArray(value)
      ? firstNumber(value.delta, value.count_delta)
      : firstNumber(value);
    if (parsed === null || parsed !== 0) entries.push({ key, delta: parsed });
  }
  return entries;
}

function arrayLength(value) {
  return Array.isArray(value) ? value.length : 0;
}

function meiliParityStatus(report = {}) {
  const failures = [];
  const countDelta = meiliDelta(report);
  const remoteFacetDeltas = nonZeroFacetDeltas(
    report.remote_facet_delta ||
    report.remote_facet_deltas ||
    report.facet_delta?.remote_type ||
    report.facets?.remote_type?.delta
  );
  const sampleMissing = firstNumber(
    report.sample_mismatch_summary?.missing_documents,
    report.drift_diagnosis?.sampled_mismatch_missing_document_count
  ) || 0;
  const sampleFieldMismatches = firstNumber(report.sample_mismatch_summary?.field_mismatches) || 0;
  const extraDocuments = firstNumber(
    report.extra_meili_document_count,
    report.drift_diagnosis?.extra_meili_document_count
  ) || 0;
  const missingDocuments = firstNumber(
    report.missing_meili_document_count,
    report.drift_diagnosis?.missing_meili_document_count
  ) || 0;
  const settingsMismatchCount = arrayLength(report.meili_settings_mismatches);
  const sampleMismatchCount = arrayLength(report.sample_mismatches) + sampleMissing + sampleFieldMismatches;

  if (report.ok !== true) failures.push("meili_parity_check_not_ok");
  if (countDelta === null) failures.push("meili_delta_unavailable");
  else if (countDelta !== 0) failures.push("meili_postgres_delta_nonzero");
  if (remoteFacetDeltas.length > 0) failures.push("meili_remote_facet_delta_nonzero");
  if (settingsMismatchCount > 0) failures.push("meili_settings_mismatches_present");
  if (sampleMismatchCount > 0) failures.push("meili_sample_mismatches_present");
  if (extraDocuments > 0) failures.push("meili_extra_documents_present");
  if (missingDocuments > 0) failures.push("meili_missing_documents_present");

  return {
    ok: failures.length === 0,
    failures: Array.from(new Set(failures)),
    count_delta: countDelta,
    remote_facet_deltas: remoteFacetDeltas,
    settings_mismatch_count: settingsMismatchCount,
    sample_mismatch_count: sampleMismatchCount,
    extra_document_count: extraDocuments,
    missing_document_count: missingDocuments
  };
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

function firstMeaningful(...values) {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    if (typeof value === "string" && value.trim().length === 0) continue;
    return value;
  }
  return undefined;
}

function preflightNumber(...values) {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    if (typeof value === "string" && value.trim().length === 0) continue;
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function preflightWorkerSafe(checks = {}, report = {}) {
  if (checks.worker_isolated === true || report.worker_isolated === true || report.worker?.isolated === true) return true;
  const state = String(firstMeaningful(checks.worker_state, report.worker_state, report.worker?.state) || "").trim().toLowerCase();
  return ["stopped", "exited", "paused", "not_running", "not running", "disabled", "inactive", "dead"].includes(state);
}

function preflightAutodeploySafe(checks = {}, report = {}) {
  if (checks.autodeploy_recovery_safe === true || report.autodeploy_recovery_safe === true || report.autodeploy?.recovery_safe === true) return true;
  const state = String(firstMeaningful(checks.autodeploy_timer_state, report.autodeploy_timer_state, report.autodeploy?.timer_state) || "").trim().toLowerCase();
  return ["inactive", "disabled", "stopped", "not_found", "not-found", "failed", "dead"].includes(state);
}

function preflightCommitMatches(actual, expected) {
  if (!actual || !expected) return false;
  return actual.startsWith(expected) || expected.startsWith(actual);
}

function preflightProofStatus(report = {}) {
  const failures = [];
  const checks = report?.checks && typeof report.checks === "object" && !Array.isArray(report.checks)
    ? report.checks
    : {};
  const backupPath = String(firstMeaningful(checks.backup_path, report.backup_path) || "").trim();
  const backupFileExists = firstMeaningful(checks.backup_file_exists, report.backup_file_exists, report.backup_exists, report.backup?.exists);
  const backupSizeBytes = preflightNumber(checks.backup_size_bytes, report.backup_size_bytes, report.backup_bytes, report.backup?.size_bytes);
  const generatedAt = String(firstMeaningful(report.generated_at, report.generatedAt, report.timestamp) || "").trim();
  const productionCommit = String(firstMeaningful(checks.production_checkout_commit, report.production_checkout_commit, report.checkout_commit, report.git?.commit) || "").trim();
  const expectedCommit = String(firstMeaningful(checks.expected_commit, report.expected_commit) || "").trim();
  const longRunningQueries = preflightNumber(checks.long_running_postgres_queries, report.long_running_postgres_queries, report.postgres?.long_running_queries);
  const meiliPostgresDelta = preflightNumber(checks.meili_postgres_delta, report.meili_postgres_delta, report.meili?.postgres_delta);
  const heavyJobActive = firstMeaningful(checks.heavy_job_active, report.heavy_job_active, report.heavy_job?.active);

  if (report.ok !== true || report.unsafe === true) failures.push("preflight_report_not_safe");
  if (Array.isArray(report.failures) && report.failures.length > 0) failures.push("preflight_report_failures_present");
  if (!generatedAt) failures.push("preflight_generated_at_missing");
  else if (!Number.isFinite(Date.parse(generatedAt))) failures.push("preflight_generated_at_invalid");
  if (!productionCommit) failures.push("preflight_production_commit_missing");
  if (!expectedCommit) failures.push("preflight_expected_commit_missing");
  if (productionCommit && expectedCommit && !preflightCommitMatches(productionCommit, expectedCommit)) failures.push("preflight_production_commit_mismatch");
  if (longRunningQueries === null) failures.push("preflight_long_running_queries_missing");
  else if (longRunningQueries > 0) failures.push("preflight_long_running_queries_active");
  if (!backupPath) failures.push("preflight_backup_path_missing");
  else if (!/[/\\]backups[/\\]/.test(backupPath)) failures.push("preflight_backup_path_not_under_backups");
  if (backupFileExists !== true) failures.push("preflight_backup_file_missing");
  if (backupSizeBytes === null || backupSizeBytes <= 0) failures.push("preflight_backup_file_empty");
  if (!preflightWorkerSafe(checks, report)) failures.push("preflight_worker_not_isolated");
  if (!preflightAutodeploySafe(checks, report)) failures.push("preflight_autodeploy_timer_unsafe");
  if (heavyJobActive !== false) failures.push("preflight_heavy_job_lock_not_clear");
  if (meiliPostgresDelta !== 0) failures.push("preflight_meili_postgres_delta_nonzero");

  return {
    ok: failures.length === 0,
    failures: Array.from(new Set(failures)),
    generated_at: generatedAt,
    production_checkout_commit: productionCommit,
    expected_commit: expectedCommit,
    backup_path: backupPath,
    backup_size_bytes: backupSizeBytes,
    long_running_postgres_queries: longRunningQueries,
    meili_postgres_delta: meiliPostgresDelta
  };
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object || {}, key);
}

function hasMeaningfulValue(value) {
  if (value === undefined || value === null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return true;
}

const SOURCE_REPORT_FIELD_ALIASES = Object.freeze({
  inventory_scan_report: Object.freeze(["inventory_report"]),
  net_new_clean_public_estimate: Object.freeze(["net_new_clean_public_candidates", "net_new_clean_candidates"]),
  duplicate_existing_public_candidates: Object.freeze(["duplicate_existing_public_rows", "duplicate_count"]),
  bounded_outbox_or_upsert_status: Object.freeze(["search_upsert_status", "meili_upsert_status"]),
  planned_tenant_batch_file_path: Object.freeze([
    "planned_batch_report",
    "planned_batch",
    "batch_plan_report",
    "tenant_batch_plan_report"
  ]),
  predicted_guard_result: Object.freeze([
    "planned_batch_predicted_guard_result",
    "batch_predicted_guard_result"
  ]),
  rollback_command: Object.freeze(["source_rollback_command"])
});

function rawSourceReportValue(report = {}, field, options = {}) {
  for (const key of [field, ...(SOURCE_REPORT_FIELD_ALIASES[field] || [])]) {
    if (options.allowEmptyArray && hasOwn(report, key) && Array.isArray(report[key])) return report[key];
    if (hasOwn(report, key) && hasMeaningfulValue(report[key])) return report[key];
  }
  return undefined;
}

function inventoryReportObject(report = {}) {
  const value = rawSourceReportValue(report, "inventory_scan_report");
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function sourceEvidenceValue(report = {}, field, options = {}) {
  const direct = rawSourceReportValue(report, field, options);
  if (direct !== undefined) return direct;
  const inventory = inventoryReportObject(report);
  if (options.allowEmptyArray && inventory && hasOwn(inventory, field) && Array.isArray(inventory[field])) return inventory[field];
  if (inventory && hasOwn(inventory, field) && hasMeaningfulValue(inventory[field])) return inventory[field];
  return undefined;
}

function numberOrCount(value) {
  if (Array.isArray(value)) return value.length;
  return firstNumber(value);
}

function sourceEvidenceNumber(report = {}, field) {
  const value = sourceEvidenceValue(report, field, { allowEmptyArray: field === "duplicate_existing_public_candidates" });
  return value === undefined ? null : numberOrCount(value);
}

function booleanTrue(value) {
  if (value === true) return true;
  return String(value || "").trim().toLowerCase() === "true";
}

function confidenceAllowsSubsetProof(value) {
  return ["medium", "high"].includes(String(value || "").trim().toLowerCase());
}

function candidatePoolProven(rawSourceReport = {}, sourceReport = {}, netNewEstimate = null) {
  const exhausted = sourceEvidenceValue(rawSourceReport, "candidate_pool_exhausted");
  if (booleanTrue(exhausted) || sourceReport.candidate_pool_exhausted === true) return true;
  const confidence = sourceEvidenceValue(rawSourceReport, "estimate_confidence") || sourceReport.estimate_confidence;
  return netNewEstimate !== null && netNewEstimate >= 5000 && confidenceAllowsSubsetProof(confidence);
}

function inventoryScanProofPassed(rawSourceReport = {}) {
  const value = rawSourceReportValue(rawSourceReport, "inventory_scan_report");
  if (!hasMeaningfulValue(value)) return false;
  if (value && typeof value === "object" && !Array.isArray(value)) {
    if (value.ok === false || value.success === false) return false;
  }
  return true;
}

function boundedOutboxStatusPassed(value) {
  if (!hasMeaningfulValue(value)) return false;
  if (value === true) return true;
  if (value && typeof value === "object" && !Array.isArray(value)) {
    if (value.ok === true || value.success === true) return true;
    if (value.ok === false || value.success === false) return false;
    return boundedOutboxStatusPassed(value.status || value.result || value.state);
  }
  const normalized = String(value).trim().toLowerCase().replace(/[\s-]+/g, "_");
  return new Set([
    "ok",
    "pass",
    "passed",
    "success",
    "succeeded",
    "complete",
    "completed",
    "processed",
    "upserted",
    "no_op",
    "noop",
    "not_required",
    "not_applicable"
  ]).has(normalized);
}

function plannedBatchProofPassed(value) {
  if (!hasMeaningfulValue(value)) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (value && typeof value === "object" && !Array.isArray(value)) {
    if (value.ok === false || value.success === false) return false;
    return hasMeaningfulValue(value.path) ||
      hasMeaningfulValue(value.report_path) ||
      hasMeaningfulValue(value.output) ||
      hasMeaningfulValue(value.selected_plan) ||
      hasMeaningfulValue(value.selected_tenants) ||
      hasMeaningfulValue(value.staged_plans);
  }
  return true;
}

function predictedGuardResultValue(rawSourceReport = {}) {
  const direct = sourceEvidenceValue(rawSourceReport, "predicted_guard_result");
  if (hasMeaningfulValue(direct)) return direct;

  const batch = sourceEvidenceValue(rawSourceReport, "planned_tenant_batch_file_path");
  if (batch && typeof batch === "object" && !Array.isArray(batch)) {
    return batch.predicted_guard_result ||
      batch.selected_plan?.predicted_guard_result ||
      batch.selected_batch?.predicted_guard_result ||
      batch.summary?.predicted_guard_result ||
      batch.result?.predicted_guard_result;
  }
  return undefined;
}

function predictedGuardPassed(value) {
  if (!hasMeaningfulValue(value)) return false;
  if (value === true) return true;
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return predictedGuardPassed(
      value.predicted_guard_result ||
      value.status ||
      value.result ||
      value.state
    );
  }
  const normalized = String(value).trim().toLowerCase().replace(/[\s-]+/g, "_");
  return new Set(["pass", "passed", "ok", "success", "succeeded", "true"]).has(normalized);
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
  const rawSourceReport = input.sourceReport || null;
  const sourceReportValidation = rawSourceReport ? validateSourceRecoveryReport(rawSourceReport) : null;
  const sourceReport = sourceReportValidation?.report || null;
  const guardReport = input.guardReport || null;
  const testsReport = input.testsReport || null;
  const preflightReport = input.preflightReport || null;
  const meiliCheck = input.meiliCheck || null;
  let netNewEstimate = null;
  let duplicateExistingPublicCandidates = null;
  let candidatePoolProof = false;
  let plannedBatchProof = null;
  let predictedGuardResult = null;
  let rollbackCommand = null;
  let preflightProof = null;
  let meiliParityProof = null;

  if (!before) addFailure(failures, noReleaseAllowed, "missing_before_data_quality", "before data-quality report is required");
  if (!after) addFailure(failures, noReleaseAllowed, "missing_after_data_quality", "after data-quality report is required");
  if (!sourceReport) addFailure(failures, noReleaseAllowed, "missing_source_recovery_report", "source recovery report is required");
  if (!guardReport) addFailure(failures, noReleaseAllowed, "missing_guard_report", "ats:recovery:guard result is required");
  if (!testsReport) addFailure(failures, noReleaseAllowed, "missing_tests_report", "test result report is required");
  if (!preflightReport) addFailure(failures, noReleaseAllowed, "missing_preflight_report", "preflight report is required");
  if (!meiliCheck) addFailure(failures, noReleaseAllowed, "missing_meili_check", "Meili/Postgres parity report is required");

  if (sourceReportValidation && !sourceReportValidation.ok) {
    for (const error of sourceReportValidation.errors) {
      addFailure(
        failures,
        noReleaseAllowed,
        "invalid_source_recovery_report",
        error,
        { source: sourceReport?.source || null }
      );
    }
  }

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

  if (sourceReport) {
    if (!inventoryScanProofPassed(rawSourceReport)) {
      addFailure(
        failures,
        noReleaseAllowed,
        "missing_or_failed_inventory_scan_report",
        "source recovery report must include a passing bounded inventory scan proof"
      );
    }

    netNewEstimate = sourceEvidenceNumber(rawSourceReport, "net_new_clean_public_estimate");
    if (netNewEstimate === null) {
      addFailure(
        failures,
        noReleaseAllowed,
        "missing_net_new_clean_public_estimate",
        "source recovery report must include a dedupe-aware net-new clean public estimate"
      );
    } else {
      const requiredGain = Math.max(sourceReport.rows_newly_accepted, sourceReport.public_row_gain, 0);
      if (netNewEstimate < requiredGain) {
        addFailure(
          failures,
          noReleaseAllowed,
          "net_new_clean_public_estimate_below_gain",
          "net-new clean public estimate is lower than the accepted public row gain",
          { estimate: netNewEstimate, required_gain: requiredGain }
        );
      }
    }

    duplicateExistingPublicCandidates = sourceEvidenceNumber(rawSourceReport, "duplicate_existing_public_candidates");
    if (duplicateExistingPublicCandidates === null) {
      addFailure(
        failures,
        noReleaseAllowed,
        "duplicate_existing_public_candidates_missing",
        "source recovery report must include duplicate existing public candidates excluded from net-new gain"
      );
    }

    if (!hasMeaningfulValue(sourceEvidenceValue(rawSourceReport, "estimate_confidence"))) {
      addFailure(
        failures,
        noReleaseAllowed,
        "estimate_confidence_missing",
        "source recovery report must include inventory/net-new estimate confidence"
      );
    }

    candidatePoolProof = candidatePoolProven(rawSourceReport, sourceReport, netNewEstimate);
    if (!candidatePoolProof) {
      addFailure(
        failures,
        noReleaseAllowed,
        "candidate_pool_unproven",
        "candidate pool must be exhausted or the scanned subset must prove at least 5,000 net-new clean public candidates"
      );
    }

    const boundedStatus = sourceEvidenceValue(rawSourceReport, "bounded_outbox_or_upsert_status");
    if (!hasMeaningfulValue(boundedStatus)) {
      addFailure(
        failures,
        noReleaseAllowed,
        "bounded_outbox_or_upsert_status_missing",
        "source recovery report must include bounded search outbox/upsert status"
      );
    } else if (!boundedOutboxStatusPassed(boundedStatus)) {
      addFailure(
        failures,
        noReleaseAllowed,
        "bounded_outbox_or_upsert_status_not_ok",
        "bounded search outbox/upsert status must be ok before release",
        { status: boundedStatus }
      );
    }

    plannedBatchProof = sourceEvidenceValue(rawSourceReport, "planned_tenant_batch_file_path");
    if (!plannedBatchProofPassed(plannedBatchProof)) {
      addFailure(
        failures,
        noReleaseAllowed,
        "missing_or_failed_planned_tenant_batch_report",
        "source recovery report must include the tenant batch plan used before canary/apply writes"
      );
    }

    predictedGuardResult = predictedGuardResultValue(rawSourceReport);
    if (!hasMeaningfulValue(predictedGuardResult)) {
      addFailure(
        failures,
        noReleaseAllowed,
        "predicted_guard_result_missing",
        "source recovery report must include the tenant batch predicted guard result"
      );
    } else if (!predictedGuardPassed(predictedGuardResult)) {
      addFailure(
        failures,
        noReleaseAllowed,
        "predicted_guard_result_not_pass",
        "tenant batch plan must predict a passing recovery guard before release",
        { predicted_guard_result: predictedGuardResult }
      );
    }

    rollbackCommand = sourceEvidenceValue(rawSourceReport, "rollback_command");
    if (!hasMeaningfulValue(rollbackCommand)) {
      addFailure(
        failures,
        noReleaseAllowed,
        "rollback_command_missing",
        "source recovery report must include the audited rollback command for the source run"
      );
    }
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
  if (meiliCheck) {
    meiliParityProof = meiliParityStatus(meiliCheck);
    for (const reason of meiliParityProof.failures) {
      const message = reason === "meili_remote_facet_delta_nonzero"
        ? "Meili/Postgres remote facet delta must be empty"
        : reason === "meili_parity_check_not_ok"
          ? "Meili/Postgres parity check must report ok=true"
          : "Meili/Postgres parity report is not clean";
      addFailure(failures, noReleaseAllowed, reason, message, {
        count_delta: meiliParityProof.count_delta,
        remote_facet_deltas: meiliParityProof.remote_facet_deltas
      });
    }
  } else if (delta === null) {
    addFailure(failures, noReleaseAllowed, "meili_delta_unavailable", "Meili/Postgres delta is required");
  }

  if (guardReport && !guardPassed(guardReport)) {
    addFailure(failures, noReleaseAllowed, "ats_recovery_guard_failed", "ats:recovery:guard did not pass with success=true");
  }

  if (testsReport && !testsPassed(testsReport)) {
    addFailure(failures, noReleaseAllowed, "tests_not_passed", "required tests did not pass or were not documented");
  }

  if (preflightReport) {
    preflightProof = preflightProofStatus(preflightReport);
    if (!preflightPassed(preflightReport) || !preflightProof.ok) {
      addFailure(
        failures,
        noReleaseAllowed,
        "preflight_unsafe_or_undocumented",
        "source recovery preflight must prove safe worker/autodeploy/heavy-job/search/backup state",
        { reasons: preflightProof.failures }
      );
    }
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
      net_new_clean_public_estimate: netNewEstimate,
      duplicate_existing_public_candidates: duplicateExistingPublicCandidates,
      candidate_pool_proven: candidatePoolProof,
      planned_tenant_batch_proof: plannedBatchProof || null,
      predicted_guard_result: predictedGuardResult || null,
      rollback_command_present: hasMeaningfulValue(rollbackCommand),
      preflight_backup_size_bytes: preflightProof?.backup_size_bytes ?? null,
      preflight_generated_at: preflightProof?.generated_at || null,
      preflight_long_running_postgres_queries: preflightProof?.long_running_postgres_queries ?? null,
      preflight_meili_postgres_delta: preflightProof?.meili_postgres_delta ?? null,
      missing_any_geo_pct_before: beforeMissingAnyGeoPct,
      missing_any_geo_pct_after: afterMissingAnyGeoPct,
      weak_unknown_remote_pct_before: beforeWeakUnknownRemotePct,
      weak_unknown_remote_pct_after: afterWeakUnknownRemotePct,
      missing_all_geo_and_weak_remote_count_before: beforeNoGeoWeak,
      missing_all_geo_and_weak_remote_count_after: afterNoGeoWeak,
      new_no_geo_no_remote_accepted_count: newNoGeoNoRemote,
      meili_postgres_delta: delta,
      meili_remote_facet_delta_count: meiliParityProof?.remote_facet_deltas?.length ?? null,
      meili_sample_mismatch_count: meiliParityProof?.sample_mismatch_count ?? null,
      meili_extra_document_count: meiliParityProof?.extra_document_count ?? null,
      meili_missing_document_count: meiliParityProof?.missing_document_count ?? null
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
    inventory_scan_report: {
      path: "reports/lever-inventory.json",
      candidate_pool_exhausted: true,
      estimate_confidence: "high"
    },
    net_new_clean_public_estimate: 12,
    duplicate_existing_public_candidates: 2,
    candidate_pool_exhausted: true,
    estimate_confidence: "high",
    bounded_outbox_or_upsert_status: "succeeded",
    planned_tenant_batch_file_path: "reports/lever-plan.json",
    predicted_guard_result: "pass",
    rollback_command: "npm run ats:source:rollback -- --run-id=123 --source=lever --confirm-production --json",
    quarantined: 0,
    skipped_ambiguous: 0,
    missing_geo_before: 2,
    missing_geo_after: 1,
    weak_remote_before: 1,
    weak_remote_after: 1,
    no_improvement_reasons: [],
    rows_newly_accepted_no_geo_no_remote: 0
  };
  const meiliCheck = {
    ok: true,
    count_delta: 0,
    remote_facet_delta: {},
    meili_settings_valid: true,
    meili_settings_mismatches: [],
    sample_mismatches: [],
    sample_mismatch_summary: { missing_documents: 0, field_mismatches: 0 },
    extra_meili_document_count: 0,
    missing_meili_document_count: 0
  };
  const guardReport = evaluateRecoveryGuard({
    before,
    after,
    sourceReport,
    meiliCheck,
    ingestionStatus: { ok: true, item: { write_pressure: "idle", heavy_job: { active: false } } },
    serviceStats: [{ name: "openjobslots-app", cpu_percent: "0.10%" }]
  });
  return {
    before,
    after,
    sourceReport,
    meiliCheck,
    guardReport,
    testsReport: { ok: true, commands: { backend: "passed", parsers: "passed", api: "passed" } },
    preflightReport: {
      ok: true,
      unsafe: false,
      generated_at: new Date().toISOString(),
      checks: {
        production_checkout_commit: "abcdef1234567890",
        expected_commit: "abcdef1234567890",
        worker_state: "stopped",
        worker_isolated: false,
        autodeploy_timer_state: "inactive",
        autodeploy_recovery_safe: false,
        heavy_job_active: false,
        long_running_postgres_queries: 0,
        meili_postgres_delta: 0,
        backup_path: "/root/OpenJobSlots/backups/postgres-openjobslots-pre-lever-recovery-PENDING.dump",
        backup_file_exists: true,
        backup_size_bytes: 1024
      },
      failures: []
    }
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
