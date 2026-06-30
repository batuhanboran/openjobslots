const { URL } = require("node:url");
const fs = require("node:fs");
const path = require("node:path");
const { createPostgresPool, ensurePostgresSchema } = require("../backends/postgres");
const { acquireHeavyJobLock } = require("../backends/heavyJobLock");
const { upsertPostgresPostings, normalizeAtsKey } = require("../backends/postgresStore");
const { getAdapterForCompany } = require("./adapters");
const { hashPayload } = require("./cache");
const { buildStoredQualityFields, parseQualityFlags } = require("./dataQuality");
const { classifyStoredPosting } = require("./dataQualityAudit");
const { buildDetailEvidenceSummary, collectDetailEvidence } = require("./detailEvidence");
const { evaluatePublicPosting, validationFromGate } = require("./publicPostingGate");
const { getAtsFilterAliasValues } = require("./atsFilters");
const {
  FAILURE_REASONS,
  decideDetailEscalation,
  summarizeEvidence
} = require("./parserEvidence");
const { SOURCE_STATUSES, validateSourceRecoveryContract } = require("./sourceContracts");
const { getSourceSyncPolicy, SOURCE_QUALITY_STATES } = require("./sourceQualityPolicy");
const { getRegistrySourceModule } = require("./sourceRegistry");
const { recordSourceRunPostingChanges, snapshotRows } = require("./sourceRollback");

const DEFAULT_SOURCE_RUN_LIMIT = 25;
const DEFAULT_STATEMENT_TIMEOUT_MS = 30_000;
const DEFAULT_HOST_CONCURRENCY = 1;
const DEFAULT_BATCH_SIZE = 100;
const DEFAULT_PREFLIGHT_MAX_AGE_MINUTES = 60;
const MAX_RUN_LIMIT = 1000;
const MAX_RUN_OFFSET = 1_000_000;
const MAX_CONCURRENCY = 4;
const VIRTUAL_SOURCE_TARGETS = Object.freeze({
  governmentjobs: {
    company_name: "GovernmentJobs (virtual)",
    url_string: "https://www.governmentjobs.com/jobs"
  },
  k12jobspot: {
    company_name: "K12JobSpot (virtual)",
    url_string: "https://api.k12jobspot.com/api/Jobs/Search"
  },
  schoolspring: {
    company_name: "SchoolSpring (virtual)",
    url_string:
      "https://api.schoolspring.com/api/Jobs/GetPagedJobsWithSearch?domainName=&keyword=&location=&category=&gradelevel=&jobtype=&organization=&swLat=&swLon=&neLat=&neLon=&page=1&size=25&sortDateAscending=false"
  },
  calcareers: {
    company_name: "CalCareers (virtual)",
    url_string: "https://calcareers.ca.gov/CalHRPublic/Search/JobSearchResults.aspx"
  },
  statejobsny: {
    company_name: "StateJobsNY (virtual)",
    url_string: "https://www.statejobsny.com/public/vacancyTable.cfm"
  },
  usajobs: {
    company_name: "USAJobs (virtual)",
    url_string: "https://data.usajobs.gov/api/Search"
  },
  remoteok: {
    company_name: "RemoteOK (virtual)",
    url_string: "https://remoteok.com/api"
  },
  himalayas: {
    company_name: "Himalayas (virtual)",
    url_string: "https://himalayas.app/jobs/api"
  },
  arbeitnow: {
    company_name: "Arbeitnow (virtual)",
    url_string: "https://www.arbeitnow.com/api/job-board-api"
  }
});

function nowEpochSeconds() {
  return Math.floor(Date.now() / 1000);
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
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function predictedGuardPassed(value) {
  return ["pass", "passed", "ok", "success", "succeeded", "true"].includes(
    clean(value || "", 80).toLowerCase()
  );
}

function readPlannedBatchReport(options = {}, plannedBatchPath = "") {
  if (options.plannedBatchReport && typeof options.plannedBatchReport === "object" && !Array.isArray(options.plannedBatchReport)) {
    return {
      ok: true,
      source_type: "inline",
      report: options.plannedBatchReport
    };
  }
  if (!plannedBatchPath) {
    return {
      ok: false,
      source_type: "",
      status: "missing-path",
      failures: ["planned_batch_path_missing"]
    };
  }
  const resolvedPath = path.resolve(plannedBatchPath);
  try {
    const parsed = JSON.parse(fs.readFileSync(resolvedPath, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {
        ok: false,
        source_type: "file",
        path: resolvedPath,
        status: "invalid-json-shape",
        failures: ["planned_batch_report_must_be_object"]
      };
    }
    return {
      ok: true,
      source_type: "file",
      path: resolvedPath,
      report: parsed
    };
  } catch (error) {
    return {
      ok: false,
      source_type: "file",
      path: resolvedPath,
      status: "unreadable",
      failures: [`planned_batch_report_unreadable: ${clean(error?.message || error, 240)}`]
    };
  }
}

function readPreflightReport(options = {}, preflightReportPath = "") {
  if (options.preflightReportPayload && typeof options.preflightReportPayload === "object" && !Array.isArray(options.preflightReportPayload)) {
    return {
      ok: true,
      source_type: "inline",
      report: options.preflightReportPayload
    };
  }
  if (!preflightReportPath) {
    return {
      ok: false,
      source_type: "",
      status: "missing-path",
      failures: ["preflight_report_path_missing"]
    };
  }
  const resolvedPath = path.resolve(preflightReportPath);
  try {
    const parsed = JSON.parse(fs.readFileSync(resolvedPath, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {
        ok: false,
        source_type: "file",
        path: resolvedPath,
        status: "invalid-json-shape",
        failures: ["preflight_report_must_be_object"]
      };
    }
    return {
      ok: true,
      source_type: "file",
      path: resolvedPath,
      report: parsed
    };
  } catch (error) {
    return {
      ok: false,
      source_type: "file",
      path: resolvedPath,
      status: "unreadable",
      failures: [`preflight_report_unreadable: ${clean(error?.message || error, 240)}`]
    };
  }
}

function firstMeaningful(...values) {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    if (typeof value === "string" && value.trim().length === 0) continue;
    return value;
  }
  return undefined;
}

function preflightWorkerSafe(checks = {}, report = {}) {
  if (checks.worker_isolated === true || report.worker_isolated === true || report.worker?.isolated === true) return true;
  const state = clean(firstMeaningful(checks.worker_state, report.worker_state, report.worker?.state) || "", 80).toLowerCase();
  return ["stopped", "exited", "paused", "not_running", "not running", "disabled", "inactive", "dead"].includes(state);
}

function preflightAutodeploySafe(checks = {}, report = {}) {
  if (checks.autodeploy_recovery_safe === true || report.autodeploy_recovery_safe === true || report.autodeploy?.recovery_safe === true) return true;
  const state = clean(firstMeaningful(checks.autodeploy_timer_state, report.autodeploy_timer_state, report.autodeploy?.timer_state) || "", 80).toLowerCase();
  return ["inactive", "disabled", "stopped", "not_found", "not-found", "failed", "dead"].includes(state);
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

function preflightTimestampStatus(report = {}, options = {}) {
  const generatedAt = clean(firstMeaningful(report?.generated_at, report?.generatedAt, report?.timestamp) || "", 120);
  const maxAgeMinutes = Number.isFinite(Number(options.preflightMaxAgeMinutes)) && Number(options.preflightMaxAgeMinutes) > 0
    ? Number(options.preflightMaxAgeMinutes)
    : DEFAULT_PREFLIGHT_MAX_AGE_MINUTES;
  if (!generatedAt) {
    return {
      ok: false,
      generated_at: "",
      age_minutes: null,
      max_age_minutes: maxAgeMinutes,
      failures: ["preflight_generated_at_missing"]
    };
  }
  const parsed = Date.parse(generatedAt);
  if (!Number.isFinite(parsed)) {
    return {
      ok: false,
      generated_at: generatedAt,
      age_minutes: null,
      max_age_minutes: maxAgeMinutes,
      failures: ["preflight_generated_at_invalid"]
    };
  }
  const ageMinutes = (Date.now() - parsed) / 60_000;
  const failures = [];
  if (ageMinutes < -5) failures.push("preflight_generated_at_in_future");
  if (ageMinutes > maxAgeMinutes) failures.push("preflight_report_stale");
  return {
    ok: failures.length === 0,
    generated_at: generatedAt,
    age_minutes: Number(ageMinutes.toFixed(2)),
    max_age_minutes: maxAgeMinutes,
    failures
  };
}

function normalizeScopeValue(value, max = 2000) {
  return clean(value || "", max).toLowerCase();
}

function normalizeScopeUrl(value) {
  const input = clean(value || "", 2000);
  if (!input) return "";
  try {
    const parsed = new URL(input);
    parsed.hash = "";
    parsed.protocol = parsed.protocol.toLowerCase();
    parsed.hostname = parsed.hostname.toLowerCase();
    return parsed.toString().replace(/\/+$/, "");
  } catch {
    return normalizeScopeValue(input).replace(/\/+$/, "");
  }
}

function normalizeScopeHost(value) {
  const input = clean(value || "", 2000);
  if (!input) return "";
  const urlHost = sourceHost(input);
  if (urlHost) return urlHost;
  return input
    .replace(/^[a-z][a-z0-9+.-]*:\/\//i, "")
    .split(/[/?#]/)[0]
    .trim()
    .toLowerCase();
}

function selectedTenantScope(selectedTenants = []) {
  return selectedTenants.map((tenant) => {
    const targetUrl = normalizeScopeUrl(firstMeaningful(
      tenant?.target_url,
      tenant?.source_url,
      tenant?.url,
      tenant?.company_url
    ));
    const tenantHost = normalizeScopeHost(firstMeaningful(
      tenant?.tenant_host,
      tenant?.source_host,
      tenant?.host,
      targetUrl
    ));
    return {
      tenant_key: normalizeScopeValue(tenant?.tenant_key, 500),
      tenant_host: tenantHost,
      target_url: targetUrl,
      company: normalizeScopeValue(tenant?.company || tenant?.company_name, 500)
    };
  }).filter((tenant) => tenant.tenant_key || tenant.tenant_host || tenant.target_url || tenant.company);
}

function targetScopeIdentities(target = {}) {
  const companyUrl = target.companyUrl || target.company?.url_string || "";
  const normalizedUrl = normalizeScopeUrl(companyUrl);
  const host = normalizeScopeHost(firstMeaningful(target.host, companyUrl));
  const company = normalizeScopeValue(target.company?.company_name || target.company?.name, 500);
  return {
    url: normalizedUrl,
    host,
    company,
    keys: new Set([normalizedUrl, host, company].filter(Boolean))
  };
}

function targetMatchesPlannedTenant(target = {}, tenant = {}) {
  const identities = targetScopeIdentities(target);
  if (tenant.target_url) return identities.url === tenant.target_url;
  if (tenant.tenant_key && identities.keys.has(tenant.tenant_key)) return true;
  if (tenant.tenant_host && identities.host === tenant.tenant_host) return true;
  if (tenant.company && identities.company === tenant.company) return true;
  return false;
}

function scopeTargetsToPlannedBatch(targets = [], safetyGate = {}) {
  const selectedTenants = Array.isArray(safetyGate.planned_batch_selected_tenants)
    ? safetyGate.planned_batch_selected_tenants
    : [];
  const scope = selectedTenantScope(selectedTenants);
  if (!safetyGate.planned_batch_required) {
    return {
      required: false,
      ok: true,
      targets,
      discovered_target_count: targets.length,
      selected_tenant_count: scope.length,
      matched_target_count: targets.length,
      skipped_target_count: 0,
      failures: []
    };
  }
  const matched = [];
  const skipped = [];
  for (const target of targets) {
    if (scope.some((tenant) => targetMatchesPlannedTenant(target, tenant))) matched.push(target);
    else skipped.push(target);
  }
  const failures = [];
  if (scope.length <= 0) failures.push("planned_batch_target_scope_missing");
  if (matched.length <= 0) failures.push("planned_batch_no_matching_discovered_targets");
  return {
    required: true,
    ok: failures.length === 0,
    targets: matched,
    discovered_target_count: targets.length,
    selected_tenant_count: scope.length,
    matched_target_count: matched.length,
    skipped_target_count: skipped.length,
    failures,
    skipped_targets_sample: skipped.slice(0, 10).map((target) => ({
      source_url: clean(target.companyUrl || target.company?.url_string || "", 500),
      source_host: clean(target.host || sourceHost(target.companyUrl), 200)
    }))
  };
}

function sourceProductionOperationRequested(options = {}) {
  const mode = clean(options.mode || "dry-run", 40);
  return Boolean(options.apply || mode === "canary" || mode === "apply");
}

function evaluatePlannedBatchGate(options = {}) {
  const productionOperationRequested = sourceProductionOperationRequested(options);
  const plannedBatch = clean(options.plannedBatch || "", 2000);
  if (!productionOperationRequested) {
    return {
      required: false,
      ok: true,
      status: "not-required",
      path: plannedBatch,
      source_type: "",
      failures: [],
      predicted_guard_result: "",
      predicted_guard_ok: true,
      selected_tenant_count: 0,
      selected_gain: 0
    };
  }

  const loaded = readPlannedBatchReport(options, plannedBatch);
  const failures = [...(loaded.failures || [])];
  const report = loaded.report || null;
  const selectedPlan = report?.selected_plan || report?.selected_batch || report?.summary?.selected_plan || null;
  const selectedTenants = Array.isArray(selectedPlan?.selected_tenants)
    ? selectedPlan.selected_tenants
    : Array.isArray(report?.selected_tenants)
      ? report.selected_tenants
      : [];
  const targetScope = selectedTenantScope(selectedTenants);
  const reportSource = normalizeAtsKey(firstMeaningful(report?.source, selectedPlan?.source));
  const expectedSource = normalizeAtsKey(options.source);
  const predictedGuardResult = clean(firstMeaningful(
    report?.predicted_guard_result,
    selectedPlan?.predicted_guard_result,
    report?.selected_batch?.predicted_guard_result,
    report?.summary?.predicted_guard_result,
    report?.result?.predicted_guard_result
  ) || "", 80).toLowerCase();
  const selectedGain = Number(firstMeaningful(
    selectedPlan?.cumulative_net_new_clean_public_candidates,
    selectedPlan?.net_new_clean_public_candidates,
    report?.selected_gain,
    report?.net_new_clean_public_candidates
  ) || 0);
  const noGeoNoRemote = Number(firstMeaningful(
    selectedPlan?.cumulative_no_geo_no_remote_count,
    selectedPlan?.no_geo_no_remote_count,
    report?.new_no_geo_no_remote_accepted_count
  ) || 0);

  if (!loaded.ok) {
    // readPlannedBatchReport already recorded the failure.
  } else {
    if (report?.ok === false || report?.success === false) failures.push("planned_batch_report_not_ok");
    if (report?.read_only !== true) failures.push("planned_batch_report_must_be_read_only");
    if (clean(report?.mode || "", 80) !== "tenant-batch-plan") failures.push("planned_batch_report_mode_must_be_tenant_batch_plan");
    if (!reportSource) failures.push("planned_batch_report_source_missing");
    else if (reportSource !== expectedSource) failures.push("planned_batch_report_source_mismatch");
    if (!selectedPlan || typeof selectedPlan !== "object" || Array.isArray(selectedPlan)) {
      failures.push("planned_batch_selected_plan_missing");
    }
    if (selectedTenants.length <= 0) failures.push("planned_batch_selected_tenants_missing");
    if (targetScope.length <= 0) failures.push("planned_batch_selected_tenant_scope_missing");
    if (selectedTenants.some((tenant) => !predictedGuardPassed(tenant?.predicted_guard_result))) {
      failures.push("planned_batch_selected_tenant_guard_not_pass");
    }
    if (selectedGain <= 0) failures.push("planned_batch_selected_gain_missing");
    if (noGeoNoRemote > 0) failures.push("planned_batch_selected_no_geo_no_remote_candidates");
    if (!predictedGuardPassed(predictedGuardResult)) failures.push("planned_batch_predicted_guard_not_pass");
  }

  return {
    required: true,
    ok: failures.length === 0,
    status: failures.length === 0 ? "pass" : "blocked",
    path: plannedBatch,
    resolved_path: loaded.path || "",
    source_type: loaded.source_type || "",
    report_source: reportSource || "",
    expected_source: expectedSource || "",
    failures: Array.from(new Set(failures)),
    predicted_guard_result: predictedGuardResult || "",
    predicted_guard_ok: predictedGuardPassed(predictedGuardResult),
    selected_tenant_count: selectedTenants.length,
    selected_gain: selectedGain,
    selected_scope_count: targetScope.length,
    selected_tenants: targetScope.slice(0, 1000)
  };
}

function evaluatePreflightReportGate(options = {}) {
  const productionOperationRequested = sourceProductionOperationRequested(options);
  const preflightReport = clean(options.preflightReport || "", 2000);
  if (!productionOperationRequested) {
    return {
      required: false,
      ok: true,
      status: "not-required",
      path: preflightReport,
      source_type: "",
      failures: []
    };
  }

  const loaded = readPreflightReport(options, preflightReport);
  const failures = [...(loaded.failures || [])];
  const report = loaded.report || null;
  const checks = report?.checks && typeof report.checks === "object" && !Array.isArray(report.checks)
    ? report.checks
    : {};
  const backupPath = clean(firstMeaningful(checks.backup_path, report?.backup_path) || "", 2000);
  const backupFileExists = firstMeaningful(checks.backup_file_exists, report?.backup_file_exists, report?.backup_exists, report?.backup?.exists);
  const backupSizeBytes = preflightNumber(checks.backup_size_bytes, report?.backup_size_bytes, report?.backup_bytes, report?.backup?.size_bytes);
  const productionCommit = clean(firstMeaningful(checks.production_checkout_commit, report?.production_checkout_commit, report?.checkout_commit, report?.git?.commit) || "", 120);
  const expectedCommit = clean(firstMeaningful(checks.expected_commit, report?.expected_commit) || "", 120);
  const longRunningQueries = preflightNumber(checks.long_running_postgres_queries, report?.long_running_postgres_queries, report?.postgres?.long_running_queries);
  const meiliDelta = preflightNumber(checks.meili_postgres_delta, report?.meili_postgres_delta, report?.meili?.postgres_delta);
  const heavyJobActive = firstMeaningful(checks.heavy_job_active, report?.heavy_job_active, report?.heavy_job?.active);
  const failuresPresent = Array.isArray(report?.failures) && report.failures.length > 0;
  const timestamp = loaded.ok ? preflightTimestampStatus(report, options) : {
    ok: false,
    generated_at: "",
    age_minutes: null,
    max_age_minutes: DEFAULT_PREFLIGHT_MAX_AGE_MINUTES,
    failures: []
  };

  if (!loaded.ok) {
    // readPreflightReport already recorded the failure.
  } else {
    failures.push(...timestamp.failures);
    if (report?.ok !== true || report?.unsafe === true) failures.push("preflight_report_not_safe");
    if (failuresPresent) failures.push("preflight_report_failures_present");
    if (!productionCommit) failures.push("preflight_production_commit_missing");
    if (!expectedCommit) failures.push("preflight_expected_commit_missing");
    if (productionCommit && expectedCommit && productionCommit !== expectedCommit) failures.push("preflight_production_commit_mismatch");
    if (longRunningQueries === null) failures.push("preflight_long_running_queries_missing");
    else if (longRunningQueries > 0) failures.push("preflight_long_running_queries_active");
    if (!backupPath) failures.push("preflight_backup_path_missing");
    else if (!/[/\\]backups[/\\]/.test(backupPath)) failures.push("preflight_backup_path_not_under_backups");
    if (backupFileExists !== true) failures.push("preflight_backup_file_missing");
    if (backupSizeBytes === null || backupSizeBytes <= 0) failures.push("preflight_backup_file_empty");
    if (!preflightWorkerSafe(checks, report)) failures.push("preflight_worker_not_isolated");
    if (!preflightAutodeploySafe(checks, report)) failures.push("preflight_autodeploy_timer_unsafe");
    if (heavyJobActive !== false) failures.push("preflight_heavy_job_lock_not_clear");
    if (meiliDelta !== 0) failures.push("preflight_meili_postgres_delta_nonzero");
  }

  return {
    required: true,
    ok: failures.length === 0,
    status: failures.length === 0 ? "pass" : "blocked",
    path: preflightReport,
    resolved_path: loaded.path || "",
    source_type: loaded.source_type || "",
    failures: Array.from(new Set(failures)),
    generated_at: timestamp.generated_at,
    age_minutes: timestamp.age_minutes,
    max_age_minutes: timestamp.max_age_minutes,
    production_checkout_commit: productionCommit,
    expected_commit: expectedCommit,
    backup_path: backupPath,
    backup_file_exists: backupFileExists === true,
    backup_size_bytes: backupSizeBytes,
    long_running_postgres_queries: longRunningQueries,
    worker_safe: report ? preflightWorkerSafe(checks, report) : false,
    heavy_job_active: heavyJobActive === true ? true : heavyJobActive === false ? false : null,
    meili_postgres_delta: meiliDelta
  };
}

function postingSourceFailureReasons(posting = {}) {
  const values = Array.isArray(posting?.source_failure_reasons)
    ? posting.source_failure_reasons
    : [
        posting?.source_failure_reason,
        posting?.parser_failure_reason,
        posting?.icims_failure_reason
      ];
  return Array.from(new Set(values.map((value) => clean(value, 120)).filter(Boolean)));
}

function parseArgs(argv = process.argv.slice(2), env = process.env) {
  const options = {
    mode: String(env.OPENJOBSLOTS_ATS_SOURCE_MODE || "dry-run").trim().toLowerCase(),
    source: String(env.OPENJOBSLOTS_ATS_SOURCE || "").trim().toLowerCase(),
    limit: asInt(env.OPENJOBSLOTS_ATS_SOURCE_LIMIT, DEFAULT_SOURCE_RUN_LIMIT, 1, MAX_RUN_LIMIT),
    batchSize: asInt(env.OPENJOBSLOTS_ATS_SOURCE_BATCH_SIZE, DEFAULT_BATCH_SIZE, 1, 1000),
    offset: asInt(env.OPENJOBSLOTS_ATS_SOURCE_OFFSET, 0, 0, MAX_RUN_OFFSET),
    concurrency: asInt(env.OPENJOBSLOTS_ATS_SOURCE_CONCURRENCY, 1, 1, MAX_CONCURRENCY),
    hostConcurrency: asInt(env.OPENJOBSLOTS_ATS_SOURCE_HOST_CONCURRENCY, DEFAULT_HOST_CONCURRENCY, 1, MAX_CONCURRENCY),
    statementTimeoutMs: asInt(
      env.OPENJOBSLOTS_HEAVY_SOURCE_STATEMENT_TIMEOUT_MS,
      DEFAULT_STATEMENT_TIMEOUT_MS,
      1000,
      120_000
    ),
    apply: asBool(env.OPENJOBSLOTS_ATS_SOURCE_APPLY),
    confirmProduction: asBool(env.OPENJOBSLOTS_ATS_SOURCE_CONFIRM_PRODUCTION),
    backupConfirmed: asBool(env.OPENJOBSLOTS_ATS_SOURCE_BACKUP_CONFIRMED),
    workerIsolated: asBool(env.OPENJOBSLOTS_ATS_SOURCE_WORKER_ISOLATED) || asBool(env.OPENJOBSLOTS_ATS_SOURCE_WORKER_PAUSED),
    maxUpdates: asInt(env.OPENJOBSLOTS_ATS_SOURCE_MAX_UPDATES, 0, 0, 100_000),
    json: asBool(env.OPENJOBSLOTS_ATS_SOURCE_JSON),
    output: String(env.OPENJOBSLOTS_ATS_SOURCE_OUTPUT || "").trim(),
    includeDisabled: asBool(env.OPENJOBSLOTS_ATS_SOURCE_INCLUDE_DISABLED),
    plannedBatch: String(env.OPENJOBSLOTS_ATS_SOURCE_PLANNED_BATCH || "").trim(),
    preflightReport: String(env.OPENJOBSLOTS_ATS_SOURCE_PREFLIGHT_REPORT || "").trim(),
    preflightMaxAgeMinutes: asInt(
      env.OPENJOBSLOTS_ATS_SOURCE_PREFLIGHT_MAX_AGE_MINUTES,
      DEFAULT_PREFLIGHT_MAX_AGE_MINUTES,
      1,
      1440
    ),
    predictedGuardResult: String(env.OPENJOBSLOTS_ATS_SOURCE_PREDICTED_GUARD_RESULT || "").trim(),
    detailEvidence: asBool(env.OPENJOBSLOTS_DETAIL_EVIDENCE),
    detailEvidenceProvider: String(env.OPENJOBSLOTS_DETAIL_EVIDENCE_PROVIDER || "local").trim().toLowerCase(),
    detailEvidenceSample: asInt(env.OPENJOBSLOTS_DETAIL_EVIDENCE_SAMPLE, 0, 0, 1000)
  };

  for (const arg of argv) {
    if (arg === "--apply") options.apply = true;
    else if (arg === "--confirm-production") options.confirmProduction = true;
    else if (arg === "--backup-confirmed") options.backupConfirmed = true;
    else if (arg === "--worker-isolated" || arg === "--worker-paused") options.workerIsolated = true;
    else if (arg === "--json") options.json = true;
    else if (arg === "--include-disabled") options.includeDisabled = true;
    else if (arg.startsWith("--mode=")) options.mode = String(arg.slice("--mode=".length)).trim().toLowerCase();
    else if (arg.startsWith("--source=")) options.source = String(arg.slice("--source=".length)).trim().toLowerCase();
    else if (arg.startsWith("--limit=")) options.limit = asInt(arg.slice("--limit=".length), options.limit, 1, MAX_RUN_LIMIT);
    else if (arg.startsWith("--company-limit=")) options.limit = asInt(arg.slice("--company-limit=".length), options.limit, 1, MAX_RUN_LIMIT);
    else if (arg.startsWith("--offset=")) options.offset = asInt(arg.slice("--offset=".length), options.offset, 0, MAX_RUN_OFFSET);
    else if (arg.startsWith("--batch-size=")) options.batchSize = asInt(arg.slice("--batch-size=".length), options.batchSize, 1, 1000);
    else if (arg.startsWith("--concurrency=")) options.concurrency = asInt(arg.slice("--concurrency=".length), options.concurrency, 1, MAX_CONCURRENCY);
    else if (arg.startsWith("--host-concurrency=")) options.hostConcurrency = asInt(arg.slice("--host-concurrency=".length), options.hostConcurrency, 1, MAX_CONCURRENCY);
    else if (arg.startsWith("--statement-timeout-ms=")) options.statementTimeoutMs = asInt(arg.slice("--statement-timeout-ms=".length), options.statementTimeoutMs, 1000, 120_000);
    else if (arg.startsWith("--max-updates=")) options.maxUpdates = asInt(arg.slice("--max-updates=".length), options.maxUpdates, 0, 100_000);
    else if (arg.startsWith("--output=")) options.output = String(arg.slice("--output=".length)).trim();
    else if (arg.startsWith("--planned-batch=")) options.plannedBatch = String(arg.slice("--planned-batch=".length)).trim();
    else if (arg.startsWith("--preflight-report=")) options.preflightReport = String(arg.slice("--preflight-report=".length)).trim();
    else if (arg.startsWith("--preflight-max-age-minutes=")) options.preflightMaxAgeMinutes = asInt(arg.slice("--preflight-max-age-minutes=".length), options.preflightMaxAgeMinutes, 1, 1440);
    else if (arg.startsWith("--predicted-guard-result=")) options.predictedGuardResult = String(arg.slice("--predicted-guard-result=".length)).trim();
    else if (arg === "--detail-evidence") options.detailEvidence = true;
    else if (arg === "--no-detail-evidence") options.detailEvidence = false;
    else if (arg.startsWith("--detail-evidence-provider=")) options.detailEvidenceProvider = String(arg.slice("--detail-evidence-provider=".length)).trim().toLowerCase();
    else if (arg.startsWith("--detail-evidence-sample=")) options.detailEvidenceSample = asInt(arg.slice("--detail-evidence-sample=".length), options.detailEvidenceSample, 0, 1000);
  }

  if (options.mode === "apply") options.apply = true;
  if (options.mode === "dryrun") options.mode = "dry-run";
  return options;
}

function getSafetyGate(options = {}) {
  const mode = clean(options.mode || "dry-run", 40);
  const applyRequested = Boolean(options.apply);
  const canaryRequested = mode === "canary";
  const productionOperationRequested = sourceProductionOperationRequested(options);
  const readinessGate = getRecoveryReadinessGate(options);
  const plannedBatch = clean(options.plannedBatch || "", 2000);
  const preflightReport = clean(options.preflightReport || "", 2000);
  const predictedGuardResult = clean(options.predictedGuardResult || "", 80).toLowerCase();
  const plannedBatchGate = evaluatePlannedBatchGate(options);
  const preflightReportGate = evaluatePreflightReportGate(options);
  const predictedGuardOk = predictedGuardPassed(predictedGuardResult) && plannedBatchGate.predicted_guard_ok;
  const operationAuthorized =
    productionOperationRequested &&
    Boolean(options.confirmProduction) &&
    Boolean(options.backupConfirmed) &&
    Boolean(options.workerIsolated) &&
    (!applyRequested || Number(options.maxUpdates || 0) > 0) &&
    readinessGate.ok &&
    plannedBatch.length > 0 &&
    plannedBatchGate.ok &&
    preflightReport.length > 0 &&
    preflightReportGate.ok &&
    predictedGuardOk;
  return {
    apply_requested: applyRequested,
    canary_requested: canaryRequested,
    production_operation_requested: productionOperationRequested,
    operation_authorized: operationAuthorized,
    authorized: applyRequested && operationAuthorized,
    planned_batch_required: productionOperationRequested,
    backup_confirmed: Boolean(options.backupConfirmed),
    worker_isolated: Boolean(options.workerIsolated),
    planned_batch_present: !productionOperationRequested || plannedBatch.length > 0,
    planned_batch_report_ok: !productionOperationRequested || plannedBatchGate.ok,
    planned_batch_report_status: plannedBatchGate.status,
    planned_batch_report_source_type: plannedBatchGate.source_type,
    planned_batch_report_source: plannedBatchGate.report_source,
    planned_batch_report_expected_source: plannedBatchGate.expected_source,
    planned_batch_report_selected_tenant_count: plannedBatchGate.selected_tenant_count,
    planned_batch_report_selected_gain: plannedBatchGate.selected_gain,
    planned_batch_report_failures: plannedBatchGate.failures,
    planned_batch_predicted_guard_result: plannedBatchGate.predicted_guard_result,
    planned_batch_selected_tenants: plannedBatchGate.selected_tenants || [],
    preflight_report_required: productionOperationRequested,
    preflight_report_present: !productionOperationRequested || preflightReport.length > 0,
    preflight_report_ok: !productionOperationRequested || preflightReportGate.ok,
    preflight_report_status: preflightReportGate.status,
    preflight_report_source_type: preflightReportGate.source_type,
    preflight_report_failures: preflightReportGate.failures,
    preflight_generated_at: preflightReportGate.generated_at || "",
    preflight_age_minutes: preflightReportGate.age_minutes,
    preflight_max_age_minutes: preflightReportGate.max_age_minutes,
    preflight_production_checkout_commit: preflightReportGate.production_checkout_commit || "",
    preflight_expected_commit: preflightReportGate.expected_commit || "",
    preflight_backup_path: preflightReportGate.backup_path || "",
    preflight_backup_size_bytes: preflightReportGate.backup_size_bytes,
    preflight_long_running_postgres_queries: preflightReportGate.long_running_postgres_queries,
    preflight_meili_postgres_delta: preflightReportGate.meili_postgres_delta,
    predicted_guard_result: predictedGuardResult || "",
    predicted_guard_ok: !productionOperationRequested || predictedGuardOk,
    recovery_readiness_gate: readinessGate,
    missing: [
      productionOperationRequested && !options.confirmProduction ? "--confirm-production" : "",
      productionOperationRequested && !options.backupConfirmed ? "--backup-confirmed" : "",
      productionOperationRequested && !options.workerIsolated ? "--worker-isolated" : "",
      applyRequested && Number(options.maxUpdates || 0) <= 0 ? "--max-updates=N" : "",
      productionOperationRequested && !readinessGate.ok ? "recovery-readiness-ok" : "",
      productionOperationRequested && plannedBatch.length <= 0 ? "--planned-batch=<report>" : "",
      productionOperationRequested && plannedBatch.length > 0 && !plannedBatchGate.ok ? "planned-batch-report-valid" : "",
      productionOperationRequested && preflightReport.length <= 0 ? "--preflight-report=<report>" : "",
      productionOperationRequested && preflightReport.length > 0 && !preflightReportGate.ok ? "preflight-report-valid" : "",
      productionOperationRequested && !predictedGuardOk ? "--predicted-guard-result=pass" : ""
    ].filter(Boolean)
  };
}

function recoveryReadinessRequired(options = {}) {
  const mode = clean(options.mode || "dry-run", 40);
  return Boolean(options.apply || mode === "canary" || mode === "apply");
}

function fixtureEvidence(sourceModule = {}) {
  const result = {
    paths: [],
    present: [],
    missing: [],
    errors: []
  };
  if (typeof sourceModule?.fixtures !== "function") return result;
  try {
    result.paths = sourceModule.fixtures();
  } catch (error) {
    result.errors.push(`fixtures failed: ${clean(error?.message || error, 240)}`);
  }
  if (!Array.isArray(result.paths)) {
    result.errors.push("fixtures did not return an array");
    result.paths = [];
  }
  for (const fixturePath of result.paths) {
    const normalizedPath = String(fixturePath || "").replace(/\\/g, "/");
    if (!normalizedPath) continue;
    if (fs.existsSync(path.resolve(normalizedPath))) result.present.push(normalizedPath);
    else result.missing.push(normalizedPath);
  }
  return result;
}

function evaluateSourceRecoveryReadiness(source) {
  const atsKey = normalizeAtsKey(source);
  const sourceModule = atsKey ? getRegistrySourceModule(atsKey) : null;
  const blockers = [];
  if (!atsKey) blockers.push("missing source");
  if (!sourceModule) blockers.push("source module required before recovery");

  const recoveryContract = sourceModule ? validateSourceRecoveryContract(sourceModule) : { ok: false, failures: [] };
  const fixtures = sourceModule ? fixtureEvidence(sourceModule) : { paths: [], present: [], missing: [], errors: [] };
  blockers.push(...(recoveryContract.failures || []), ...(fixtures.errors || []));
  if (fixtures.missing.length > 0) blockers.push(`missing fixture files: ${fixtures.missing.join(", ")}`);
  if (sourceModule?.status === SOURCE_STATUSES.unsupported) blockers.push("unsupported source");

  return {
    source: atsKey,
    ok: blockers.length === 0,
    status: blockers.length === 0 ? "ready-for-recovery-operation" : "blocked",
    source_contract_ok: Boolean(recoveryContract.ok),
    public_gate: typeof sourceModule?.validatePublic === "function",
    quality_threshold: typeof sourceModule?.qualityThreshold === "function",
    rate_limit: typeof sourceModule?.rateLimit === "function",
    fixtures,
    blockers: Array.from(new Set(blockers))
  };
}

function getRecoveryReadinessGate(options = {}) {
  const required = recoveryReadinessRequired(options);
  if (!required) {
    return {
      required: false,
      ok: true,
      status: "not-required",
      source: normalizeAtsKey(options.source),
      blockers: []
    };
  }
  const readiness = evaluateSourceRecoveryReadiness(options.source);
  return {
    required: true,
    ...readiness
  };
}

function sourceHost(value) {
  try {
    return new URL(String(value || "")).host.toLowerCase();
  } catch {
    return "";
  }
}

function incrementCounter(map, key, amount = 1) {
  const normalized = String(key || "unknown");
  map[normalized] = Number(map[normalized] || 0) + amount;
}

function getVirtualSourceTarget(source) {
  const normalized = normalizeAtsKey(source);
  const target = VIRTUAL_SOURCE_TARGETS[normalized];
  if (!target) return null;
  return {
    ...target,
    ATS_name: normalized
  };
}

function getVirtualSourceTargetCount(source) {
  return getVirtualSourceTarget(source) ? 1 : 0;
}

function rowToSourceTarget(row, company) {
  const source = normalizeAtsKey(company.ATS_name || row.ats_key);
  const sourcePolicy = getSourceSyncPolicy(source, {
    protectionStatus: row.protection_status,
    disabledReason: row.disabled_reason
  });
  const target = {
    company,
    atsKey: source,
    companyUrl: company.url_string,
    host: sourceHost(company.url_string),
    adapter: getAdapterForCompany(company),
    source: {
      enabled: Boolean(row.enabled),
      protection_status: String(row.protection_status || "normal"),
      disabled_reason: String(row.disabled_reason || ""),
      rate_limit_ms: Number(row.rate_limit_ms || 0),
      quality_state: sourcePolicy.source_quality_state,
      policy: sourcePolicy
    },
    sourcePolicy
  };
  return target.adapter ? target : null;
}

async function discoverSourceTargets(pool, options = {}) {
  const source = normalizeAtsKey(options.source);
  if (!source) throw new Error("--source=<ats> is required");
  const sourceAliases = getAtsFilterAliasValues(source);
  const enabledFilter = options.includeDisabled ? "" : "AND s.enabled = true AND COALESCE(NULLIF(s.protection_status, ''), 'normal') NOT IN ('disabled', 'auto_disabled')";
  const result = await pool.query(
    `
      SELECT
        c.id,
        c.company_name,
        c.url_string,
        c.ats_key,
        s.enabled,
        s.protection_status,
        s.disabled_reason,
        s.rate_limit_ms
      FROM companies c
      INNER JOIN ats_sources s ON s.ats_key = $1
      WHERE c.ats_key = ANY($2::text[])
        ${enabledFilter}
      ORDER BY c.updated_at DESC, c.id ASC
      LIMIT $3 OFFSET $4;
    `,
    [
      source,
      sourceAliases,
      Math.max(1, Number(options.limit || DEFAULT_SOURCE_RUN_LIMIT)),
      Math.max(0, Number(options.offset || 0))
    ]
  );
  const targets = result.rows.map((row) => {
    const company = {
      id: Number(row.id || 0),
      company_name: String(row.company_name || ""),
      url_string: String(row.url_string || ""),
      ATS_name: String(row.ats_key || "")
    };
    return rowToSourceTarget(row, company);
  }).filter(Boolean);
  if (targets.length > 0 || Number(options.offset || 0) > 0) return targets;

  const virtualCompany = getVirtualSourceTarget(source);
  if (!virtualCompany) return targets;
  const virtualSourceResult = await pool.query(
    `
      SELECT
        s.ats_key,
        s.enabled,
        s.protection_status,
        s.disabled_reason,
        s.rate_limit_ms
      FROM ats_sources s
      WHERE s.ats_key = $1
        ${enabledFilter}
      LIMIT 1;
    `,
    [source]
  );
  const virtualRow = virtualSourceResult.rows[0];
  if (!virtualRow) return targets;
  const virtualTarget = rowToSourceTarget(virtualRow, {
    id: 0,
    company_name: virtualCompany.company_name,
    url_string: virtualCompany.url_string,
    ATS_name: virtualCompany.ATS_name
  });
  return virtualTarget ? [virtualTarget] : targets;
}

async function createSourceRun(pool, options = {}, targets = []) {
  const source = normalizeAtsKey(options.source);
  const result = await pool.query(
    `
      INSERT INTO ats_source_runs (
        run_key, ats_key, mode, status, requested_limit, max_updates, source_host_count
      ) VALUES ($1,$2,$3,'running',$4,$5,$6)
      RETURNING id;
    `,
    [
      `ats-source-${source}-${Date.now()}`,
      source,
      String(options.mode || "dry-run"),
      Number(options.limit || 0),
      Number(options.maxUpdates || 0),
      new Set(targets.map((target) => target.host).filter(Boolean)).size
    ]
  );
  return Number(result.rows[0]?.id || 0);
}

async function recordSourceRunError(pool, runId, target, error, metadata = {}) {
  if (!runId) return;
  await pool.query(
    `
      INSERT INTO ats_source_run_errors (
        source_run_id, ats_key, source_host, source_url, error_type, error_message, http_status, parser_reason
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8);
    `,
    [
      runId,
      target?.atsKey || "",
      target?.host || sourceHost(target?.companyUrl),
      target?.companyUrl || "",
      clean(metadata.errorType || error?.ingestionErrorType || "unknown", 80),
      clean(error?.message || error, 1200),
      metadata.httpStatus || null,
      clean(metadata.parserReason || "", 300)
    ]
  );
}

async function finishSourceRun(pool, runId, status, summary, stopReason = "") {
  if (!runId) return;
  await pool.query(
    `
      UPDATE ats_source_runs
      SET status = $2,
          fetch_count = $3,
          parse_count = $4,
          accepted_count = $5,
          quarantined_count = $6,
          rejected_count = $7,
          public_write_count = $8,
          quarantine_write_count = $9,
          http_status_counts = $10::jsonb,
          parser_failure_reasons = $11::jsonb,
          average_latency_ms = $12,
          stop_reason = $13,
          error_message = $14,
          finished_at = now(),
          updated_at = now()
      WHERE id = $1;
    `,
    [
      runId,
      status,
      Number(summary.fetch_count || 0),
      Number(summary.parse_count || 0),
      Number(summary.accepted_count || 0),
      Number(summary.quarantined_count || 0),
      Number(summary.rejected_count || 0),
      Number(summary.public_write_count || 0),
      Number(summary.quarantine_write_count || 0),
      JSON.stringify(summary.http_status_counts || {}),
      JSON.stringify(summary.parser_failure_reasons || {}),
      Number(summary.average_latency_ms || 0),
      clean(stopReason || summary.stop_reason || ""),
      clean(summary.error_message || "")
    ]
  );

  const metrics = {
    fetch_count: summary.fetch_count || 0,
    parse_count: summary.parse_count || 0,
    accepted_count: summary.accepted_count || 0,
    quarantined_count: summary.quarantined_count || 0,
    rejected_count: summary.rejected_count || 0,
    average_latency_ms: summary.average_latency_ms || 0
  };
  for (const [metric, value] of Object.entries(metrics)) {
    await pool.query(
      `
        INSERT INTO ats_source_run_metrics (source_run_id, ats_key, metric_name, metric_value, labels)
        VALUES ($1,$2,$3,$4,$5::jsonb);
      `,
      [runId, normalizeAtsKey(summary.source), metric, Number(value || 0), JSON.stringify({ mode: summary.mode || "" })]
    );
  }
}

async function writeSourcePostingCache(pool, posting, validation, options = {}) {
  const nowEpoch = Number(options.nowEpoch || nowEpochSeconds());
  const canonicalUrl = String(posting?.canonical_url || posting?.job_posting_url || "").trim();
  if (!canonicalUrl) return { cached: false };
  const parserVersion = String(options.parserVersion || posting?.parser_version || "unknown");
  const validationStatus = String(validation?.status || (validation?.ok ? "valid" : "invalid"));
  const validationError = String(validation?.error || "");
  const rawPayloadHash = hashPayload(posting || {});
  const quality = buildStoredQualityFields(
    {
      ...posting,
      validation_status: validationStatus,
      validation_error: validationError,
      parser_version: parserVersion,
      raw_payload_hash: rawPayloadHash,
      last_seen_epoch: nowEpoch
    },
    { nowEpoch }
  );
  await pool.query(
    `
      INSERT INTO posting_cache (
        canonical_url, ats_key, company_name, source_job_id, position_name, location_text,
        city, country, region, remote_type, industry, department, employment_type,
        description_plain, description_html, posting_date, posted_at_epoch,
        raw_payload_hash, source_company_url, first_seen_epoch, last_seen_epoch,
        parser_version, confidence, quality_score, quality_flags, rejection_reason,
        validation_status, validation_error, raw_metadata, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25::jsonb,$26,$27,$28,$29::jsonb,now())
      ON CONFLICT(canonical_url) DO UPDATE SET
        ats_key = EXCLUDED.ats_key,
        company_name = EXCLUDED.company_name,
        source_job_id = EXCLUDED.source_job_id,
        position_name = EXCLUDED.position_name,
        location_text = EXCLUDED.location_text,
        city = EXCLUDED.city,
        country = EXCLUDED.country,
        region = EXCLUDED.region,
        remote_type = EXCLUDED.remote_type,
        industry = EXCLUDED.industry,
        department = EXCLUDED.department,
        employment_type = EXCLUDED.employment_type,
        description_plain = EXCLUDED.description_plain,
        description_html = EXCLUDED.description_html,
        posting_date = EXCLUDED.posting_date,
        posted_at_epoch = EXCLUDED.posted_at_epoch,
        raw_payload_hash = EXCLUDED.raw_payload_hash,
        source_company_url = EXCLUDED.source_company_url,
        last_seen_epoch = EXCLUDED.last_seen_epoch,
        parser_version = EXCLUDED.parser_version,
        confidence = EXCLUDED.confidence,
        quality_score = EXCLUDED.quality_score,
        quality_flags = EXCLUDED.quality_flags,
        rejection_reason = EXCLUDED.rejection_reason,
        validation_status = EXCLUDED.validation_status,
        validation_error = EXCLUDED.validation_error,
        raw_metadata = EXCLUDED.raw_metadata,
        updated_at = now();
    `,
    [
      canonicalUrl,
      String(posting?.ats_key || "").trim(),
      String(posting?.company_name || "").trim(),
      String(posting?.source_job_id || "").trim(),
      String(posting?.position_name || "").trim(),
      posting?.location_text || posting?.location || null,
      String(posting?.city || "").trim(),
      String(posting?.country || "").trim(),
      String(posting?.region || "").trim(),
      String(posting?.remote_type || "unknown").trim(),
      String(posting?.industry || "").trim(),
      String(posting?.department || "").trim(),
      String(posting?.employment_type || "").trim(),
      String(posting?.description_plain || "").trim(),
      String(posting?.description_html || "").trim(),
      posting?.posting_date || null,
      posting?.posted_at_epoch || posting?.posting_date_epoch || null,
      rawPayloadHash,
      String(options.sourceCompanyUrl || "").trim(),
      nowEpoch,
      nowEpoch,
      parserVersion,
      Number(posting?.confidence || posting?.parser_confidence || 0.5),
      quality.quality_score,
      quality.quality_flags,
      quality.rejection_reason,
      validationStatus,
      validationError,
      JSON.stringify({
        source_company_url: String(options.sourceCompanyUrl || "").trim(),
        parser_version: parserVersion,
        visibility_status: validationStatus,
        reason_codes: Array.isArray(validation?.reason_codes) ? validation.reason_codes : [],
        retry_detail_refetch_eligible: Boolean(validation?.retry_detail_refetch_eligible),
        evidence: validation?.evidence || options.evidence || null
      })
    ]
  );
  return { cached: true };
}

function buildInitialSummary(options) {
  return {
    ok: true,
    source: normalizeAtsKey(options.source),
    mode: options.mode || "dry-run",
    apply_mode: false,
    source_run_id: 0,
    scanned_targets: 0,
    fetch_count: 0,
    parse_count: 0,
    accepted_count: 0,
    quarantined_count: 0,
    rejected_count: 0,
    public_write_count: 0,
    quarantine_write_count: 0,
    http_status_counts: {},
    parser_failure_reasons: {},
    average_latency_ms: 0,
    stop_reason: "",
    errors: [],
    samples: [],
    candidate_reports: [],
    planned_tenant_batch_file_path: String(options.plannedBatch || ""),
    predicted_guard_result: String(options.predictedGuardResult || ""),
    detail_evidence_enabled: Boolean(options.detailEvidence),
    detail_evidence_provider: String(options.detailEvidenceProvider || "local").trim().toLowerCase(),
    detail_evidence_sample: Number(options.detailEvidenceSample || 0),
    detail_evidence_sampled_count: 0,
    detail_evidence_failure_count: 0,
    detail_evidence_status_counts: {},
    source_family_buckets: {},
    quality_gap_counts: {
      missing_any_geo: 0,
      missing_all_geo: 0,
      weak_unknown_remote: 0,
      no_geo_no_remote: 0,
      detail_evidence_found: 0,
      parser_safe_repair: 0,
      blocked: 0
    },
    rollback_command: ""
  };
}

function extractHttpStatus(error) {
  const explicit = Number(error?.status || error?.statusCode || error?.httpStatus || error?.response?.status || 0);
  if (Number.isFinite(explicit) && explicit >= 100 && explicit <= 599) return explicit;
  const match = String(error?.message || error || "").match(/\b([1-5][0-9]{2})\b/);
  const parsed = match ? Number(match[1]) : 0;
  return Number.isFinite(parsed) && parsed >= 100 && parsed <= 599 ? parsed : null;
}

function publicGateDecision(gate = {}) {
  return {
    status: gate.status || "unknown",
    public: Boolean(gate.public),
    ok: Boolean(gate.ok),
    reason: clean(gate.reason || "", 300),
    reason_codes: Array.isArray(gate.reason_codes) ? gate.reason_codes : [],
    retry_detail_refetch_eligible: Boolean(gate.retry_detail_refetch_eligible),
    confidence: Number(gate.confidence || 0)
  };
}

function nonAcceptedNetNewClassification(status, validation = {}) {
  const reasonCodes = Array.isArray(validation?.reason_codes) ? validation.reason_codes : [];
  const reason = clean(validation?.error || validation?.reason || reasonCodes.join(", "));
  if (reasonCodes.includes("no_geo_no_remote") || reason === "no_geo_no_remote") return "no_geo_no_remote";
  if (reasonCodes.includes("ambiguous_location") || reason === "ambiguous_location") return "ambiguous_location";
  if (status === "rejected") return "rejected_candidate";
  return "quarantine_candidate";
}

function sourceFamilyForCandidate(target = {}, normalized = {}) {
  return clean(
    normalized.source_family ||
      target.adapter?.metadata?.sourceFamily ||
      target.adapter?.sourceFamily ||
      target.source?.family ||
      "unknown",
    80
  ) || "unknown";
}

function getDetailEvidenceSnapshot(normalized = {}) {
  return normalized.detail_evidence ||
    normalized.detailEvidence ||
    normalized.evidence_snapshot ||
    normalized.raw_metadata?.detail_evidence ||
    null;
}

function candidateDetailEvidenceUrl(normalized = {}) {
  return clean(
    normalized.canonical_url ||
      normalized.job_posting_url ||
      normalized.apply_url ||
      normalized.url ||
      "",
    2000
  );
}

function shouldCollectDetailEvidence(options = {}, summary = {}, normalized = {}) {
  if (!options.detailEvidence) return false;
  if (String(options.mode || "dry-run") !== "dry-run") return false;
  if (Number(options.detailEvidenceSample || 0) <= 0) return false;
  if (Number(summary.detail_evidence_sampled_count || 0) >= Number(options.detailEvidenceSample || 0)) return false;
  return Boolean(candidateDetailEvidenceUrl(normalized));
}

async function attachDetailEvidenceSnapshot(normalized = {}, options = {}, summary = {}) {
  if (!shouldCollectDetailEvidence(options, summary, normalized)) return null;
  const sourceUrl = candidateDetailEvidenceUrl(normalized);
  if (!summary.detail_evidence_status_counts) summary.detail_evidence_status_counts = {};
  summary.detail_evidence_sampled_count = Number(summary.detail_evidence_sampled_count || 0) + 1;
  const snapshot = await collectDetailEvidence(sourceUrl, {
    enabled: true,
    provider: options.detailEvidenceProvider || "local",
    env: options.env || process.env,
    fetcher: options.detailEvidenceFetcher,
    lookup: options.detailEvidenceLookup,
    maxResponseBytes: options.detailEvidenceMaxBytes,
    timeoutMs: options.detailEvidenceTimeoutMs,
    maxSpans: options.detailEvidenceMaxSpans
  });
  normalized.detail_evidence = snapshot;
  incrementCounter(summary.detail_evidence_status_counts, snapshot.status || "unknown");
  if (!snapshot.ok) summary.detail_evidence_failure_count = Number(summary.detail_evidence_failure_count || 0) + 1;
  return snapshot;
}

function buildQualityGapFlags(normalized = {}, status = "", reasonCodes = []) {
  const row = {
    ...normalized,
    location_text: normalized.location_text || normalized.location || normalized.location_name || ""
  };
  const classified = classifyStoredPosting(row);
  const normalizedReasons = new Set((Array.isArray(reasonCodes) ? reasonCodes : []).map((reason) => clean(reason, 120)));
  const noGeoNoRemote =
    Boolean(classified.missing_all_normalized_geo && classified.weak_unknown_remote_type) ||
    normalizedReasons.has("no_geo_no_remote") ||
    normalizedReasons.has("no_normalized_geo_or_explicit_remote");
  const blockedReasons = [
    "source_disabled_by_threshold",
    "source_auto_disabled",
    "source_quarantine_only",
    "blocked_fetch",
    "detail_required_but_unavailable"
  ];

  return {
    missing_any_geo: Boolean(classified.missing_any_normalized_geo),
    missing_all_geo: Boolean(classified.missing_all_normalized_geo),
    weak_unknown_remote: Boolean(classified.weak_unknown_remote_type),
    no_geo_no_remote: Boolean(noGeoNoRemote),
    detail_evidence_found: Boolean(buildDetailEvidenceSummary(getDetailEvidenceSnapshot(normalized)).present),
    parser_safe_repair: Boolean(normalized.parser_safe_repair || normalized.parser_safe_repairs),
    blocked: status !== "accepted" && blockedReasons.some((reason) => normalizedReasons.has(reason))
  };
}

function classifySourceCandidateErrorType(reason, fallback = "parser_validation") {
  const normalized = clean(reason, 120).toLowerCase();
  if ([
    "source_disabled_by_threshold",
    "source_auto_disabled",
    "source_quarantine_only"
  ].includes(normalized)) {
    return "source_quality";
  }
  return fallback;
}

function buildCandidateReport(target, normalized, status, gate, validation, detailEscalation) {
  const reasonCodes = Array.from(new Set([
    ...(Array.isArray(validation?.reason_codes) ? validation.reason_codes : []),
    ...(Array.isArray(detailEscalation?.failure_reasons) ? detailEscalation.failure_reasons : [])
  ].map((reason) => clean(reason, 120)).filter(Boolean)));
  const sourceFamily = sourceFamilyForCandidate(target, normalized);
  const detailEvidenceSummary = buildDetailEvidenceSummary(getDetailEvidenceSnapshot(normalized));
  const qualityGapFlags = buildQualityGapFlags(normalized, status, reasonCodes);
  return {
    source_url: target.companyUrl,
    source_host: target.host,
    source_family: sourceFamily,
    canonical_url: normalized.canonical_url || normalized.job_posting_url || "",
    source_job_id: normalized.source_job_id || "",
    title: normalized.position_name || normalized.title || "",
    status,
    reason: validation?.error || gate.reason || "",
    reason_codes: reasonCodes,
    public_gate_decision: publicGateDecision(gate),
    detail_escalation_decision: detailEscalation,
    evidence_summary: summarizeEvidence(normalized.evidence || gate.evidence || {}),
    detail_evidence_summary: detailEvidenceSummary,
    quality_gap_flags: qualityGapFlags,
    net_new_classification: status === "accepted"
      ? "not_evaluated"
      : nonAcceptedNetNewClassification(status, validation)
  };
}

function emptySourceFamilyBucket() {
  return {
    total: 0,
    status_counts: {},
    missing_any_geo: 0,
    missing_all_geo: 0,
    weak_unknown_remote: 0,
    no_geo_no_remote: 0,
    detail_evidence_found: 0,
    parser_safe_repair: 0,
    blocked: 0
  };
}

function recordCandidateReportMetrics(summary, report = {}) {
  if (!summary) return;
  if (!summary.source_family_buckets) summary.source_family_buckets = {};
  if (!summary.quality_gap_counts) {
    summary.quality_gap_counts = {
      missing_any_geo: 0,
      missing_all_geo: 0,
      weak_unknown_remote: 0,
      no_geo_no_remote: 0,
      detail_evidence_found: 0,
      parser_safe_repair: 0,
      blocked: 0
    };
  }
  const family = clean(report.source_family || "unknown", 80) || "unknown";
  const bucket = summary.source_family_buckets[family] || emptySourceFamilyBucket();
  bucket.total += 1;
  incrementCounter(bucket.status_counts, report.status || "unknown");
  const flags = report.quality_gap_flags || {};
  for (const key of Object.keys(summary.quality_gap_counts)) {
    if (flags[key]) {
      bucket[key] += 1;
      summary.quality_gap_counts[key] += 1;
    }
  }
  summary.source_family_buckets[family] = bucket;
}

function appendFailureReason(report, reason) {
  const normalized = clean(reason, 120);
  if (!normalized) return;
  report.failure_reasons = Array.from(new Set([
    ...(Array.isArray(report.failure_reasons) ? report.failure_reasons : []),
    normalized
  ]));
}

async function annotateNetNewCandidateReports(pool, target, reports = []) {
  const acceptedReports = reports.filter((report) => report.status === "accepted");
  if (acceptedReports.length === 0) return;
  const sourceJobIds = Array.from(new Set(acceptedReports.map((report) => clean(report.source_job_id, 500)).filter(Boolean)));
  const urls = Array.from(new Set(acceptedReports.flatMap((report) => [
    clean(report.canonical_url, 2000)
  ]).filter(Boolean)));
  if (sourceJobIds.length === 0 && urls.length === 0) {
    for (const report of acceptedReports) report.net_new_classification = "net_new_clean_public_candidate";
    return;
  }
  const result = await pool.query(
    `
      SELECT canonical_url, apply_url, ats_key, source_job_id, hidden
      FROM postings
      WHERE (ats_key = $1 AND $2::text[] <> '{}'::text[] AND source_job_id = ANY($2::text[]))
         OR ($3::text[] <> '{}'::text[] AND (canonical_url = ANY($3::text[]) OR apply_url = ANY($3::text[])));
    `,
    [target.atsKey, sourceJobIds, urls]
  );
  const bySameSourceJobId = new Map();
  const byUrl = new Map();
  for (const row of result.rows || []) {
    const sourceJobId = clean(row.source_job_id, 500);
    if (clean(row.ats_key).toLowerCase() === clean(target.atsKey).toLowerCase() && sourceJobId) {
      if (!bySameSourceJobId.has(sourceJobId)) bySameSourceJobId.set(sourceJobId, []);
      bySameSourceJobId.get(sourceJobId).push(row);
    }
    for (const url of [row.canonical_url, row.apply_url].map((value) => clean(value, 2000)).filter(Boolean)) {
      if (!byUrl.has(url)) byUrl.set(url, []);
      byUrl.get(url).push(row);
    }
  }
  const seenSourceJobIds = new Set();
  const seenUrls = new Set();
  for (const report of acceptedReports) {
    const sourceJobId = clean(report.source_job_id, 500);
    const url = clean(report.canonical_url, 2000);
    if ((sourceJobId && seenSourceJobIds.has(sourceJobId)) || (url && seenUrls.has(url))) {
      report.net_new_classification = "already_indexable_duplicate";
      appendFailureReason(report, FAILURE_REASONS.CANDIDATE_CLEAN_BUT_EXISTING);
      continue;
    }
    if (sourceJobId) seenSourceJobIds.add(sourceJobId);
    if (url) seenUrls.add(url);
    const sourceMatches = sourceJobId ? bySameSourceJobId.get(sourceJobId) || [] : [];
    const urlMatches = url ? byUrl.get(url) || [] : [];
    const hiddenMatch = [...sourceMatches, ...urlMatches].some((row) => row.hidden === true || row.hidden === "true");
    if (hiddenMatch) {
      report.net_new_classification = "stale_or_hidden_reactivation_candidate";
      appendFailureReason(report, FAILURE_REASONS.CANDIDATE_CLEAN_BUT_EXISTING);
    } else if (sourceMatches.length > 0) {
      report.net_new_classification = "already_public_same_source_job_id";
      appendFailureReason(report, FAILURE_REASONS.DUPLICATE_EXISTING_SOURCE_JOB_ID);
      appendFailureReason(report, FAILURE_REASONS.CANDIDATE_CLEAN_BUT_EXISTING);
    } else if (urlMatches.length > 0) {
      report.net_new_classification = "already_public_same_canonical_url";
      appendFailureReason(report, FAILURE_REASONS.DUPLICATE_EXISTING_PUBLIC);
      appendFailureReason(report, FAILURE_REASONS.CANDIDATE_CLEAN_BUT_EXISTING);
    } else {
      report.net_new_classification = "net_new_clean_public_candidate";
    }
  }
}

function evaluateSourceCandidate(target, item, options = {}) {
  const nowEpoch = Number(options.nowEpoch || nowEpochSeconds());
  let normalized = {
    ...target.adapter.normalize(item, target.company, { nowEpoch }),
    ats_key: target.atsKey
  };
  const adapterValidation = target.adapter.validate(normalized);
  const gate = evaluatePublicPosting(
    {
      ...normalized,
      parser_version: target.adapter.parserVersion,
      parser_confidence: Number(normalized?.confidence || normalized?.parser_confidence || 0.5)
    },
    { parserVersion: target.adapter.parserVersion }
  );
  const quarantineOnly = target.sourcePolicy?.source_quality_state === SOURCE_QUALITY_STATES.QUARANTINE_ONLY;
  let validation = adapterValidation?.ok ? validationFromGate(gate) : adapterValidation;
  let status = adapterValidation?.ok ? gate.status : "rejected";
  if (adapterValidation?.ok && gate.status === "accepted" && quarantineOnly) {
    status = "quarantined";
    validation = {
      ok: false,
      status: "quarantined",
      error: "source_disabled_by_threshold",
      reason_codes: ["source_disabled_by_threshold"],
      evidence: gate.evidence,
      retry_detail_refetch_eligible: false
    };
  }
  const sourceFailureReasons = postingSourceFailureReasons(normalized);
  if (normalized?.source_requires_normalized_geo_or_remote === true) {
    const hasNormalizedGeo = Boolean(clean(normalized.country) || clean(normalized.region) || clean(normalized.city));
    const hasExplicitRemote = ["remote", "hybrid", "onsite"].includes(clean(normalized.remote_type).toLowerCase());
    if (!hasNormalizedGeo && !hasExplicitRemote) sourceFailureReasons.push("no_normalized_geo_or_explicit_remote");
  }
  if (adapterValidation?.ok && status === "accepted" && sourceFailureReasons.length > 0) {
    status = "quarantined";
    validation = {
      ok: false,
      status: "quarantined",
      error: sourceFailureReasons[0],
      reason_codes: Array.from(new Set(sourceFailureReasons)),
      evidence: gate.evidence,
      retry_detail_refetch_eligible: false
    };
  }
  if (adapterValidation?.ok && status === "quarantined" && sourceFailureReasons.length > 0) {
    validation = {
      ...validation,
      error: sourceFailureReasons[0],
      reason_codes: Array.from(new Set([
        ...sourceFailureReasons,
        ...(Array.isArray(validation?.reason_codes) ? validation.reason_codes : [])
      ]))
    };
  }
  const detailEscalation = normalized.detail_escalation_decision || decideDetailEscalation(normalized, {
    sourceFamily: normalized.source_family || target.adapter.metadata?.sourceFamily || "",
    detailSupported: typeof target.adapter.fetchDetail === "function"
  });
  return {
    normalized,
    adapterValidation,
    gate,
    validation,
    status,
    sourceFailureReasons,
    detailEscalation
  };
}

async function processTarget(pool, target, options, summary, runId) {
  const started = Date.now();
  const nowEpoch = nowEpochSeconds();
  let raw;
  try {
    raw = await target.adapter.fetch(target.company);
    summary.fetch_count += 1;
  } catch (error) {
    const httpStatus = extractHttpStatus(error);
    if (httpStatus) incrementCounter(summary.http_status_counts, httpStatus);
    incrementCounter(summary.parser_failure_reasons, error?.ingestionErrorType || "fetch_failed");
    await recordSourceRunError(pool, runId, target, error, { httpStatus, errorType: error?.ingestionErrorType || "fetch" });
    summary.errors.push({ source_url: target.companyUrl, error: clean(error?.message || error, 240) });
    return;
  } finally {
    summary.average_latency_ms = Math.round(
      ((summary.average_latency_ms * Math.max(0, summary.fetch_count - 1)) + (Date.now() - started)) /
      Math.max(1, summary.fetch_count)
    );
  }

  let parsed;
  try {
    parsed = target.adapter.parse(raw, target.company);
    summary.parse_count += Array.isArray(parsed) ? parsed.length : 0;
  } catch (error) {
    incrementCounter(summary.parser_failure_reasons, "parser_parse");
    await recordSourceRunError(pool, runId, target, error, { errorType: "parser_parse" });
    summary.errors.push({ source_url: target.companyUrl, error: clean(error?.message || error, 240) });
    return;
  }

  const accepted = [];
  const targetCandidateReports = [];
  const safetyGate = summary.safety_gate || getSafetyGate(options);
  for (const item of Array.isArray(parsed) ? parsed : []) {
    let evaluated;
    try {
      evaluated = evaluateSourceCandidate(target, item, { nowEpoch });
    } catch (error) {
      summary.rejected_count += 1;
      incrementCounter(summary.parser_failure_reasons, "parser_normalize");
      await recordSourceRunError(pool, runId, target, error, { errorType: "parser_normalize" });
      continue;
    }
    const { normalized, gate, validation, status, detailEscalation } = evaluated;
    await attachDetailEvidenceSnapshot(normalized, options, summary);
    const candidateReport = buildCandidateReport(target, normalized, status, gate, validation, detailEscalation);
    targetCandidateReports.push(candidateReport);
    recordCandidateReportMetrics(summary, candidateReport);
    if (status === "accepted") {
      summary.accepted_count += 1;
      accepted.push(normalized);
    } else if (status === "quarantined") {
      summary.quarantined_count += 1;
      incrementCounter(summary.parser_failure_reasons, validation?.error || "quarantined");
    } else {
      summary.rejected_count += 1;
      incrementCounter(summary.parser_failure_reasons, validation?.error || "rejected");
      await recordSourceRunError(pool, runId, target, new Error(validation?.error || "rejected"), {
        errorType: classifySourceCandidateErrorType(validation?.error),
        parserReason: validation?.error || "rejected"
      });
    }

    if (summary.samples.length < 10) {
      summary.samples.push({
        source_url: target.companyUrl,
        canonical_url: normalized.canonical_url || normalized.job_posting_url || "",
        title: normalized.position_name || normalized.title || "",
        status,
        reason: validation?.error || gate.reason || "",
        public_gate_decision: candidateReport.public_gate_decision,
        detail_escalation_decision: candidateReport.detail_escalation_decision,
        evidence_summary: candidateReport.evidence_summary,
        detail_evidence_summary: candidateReport.detail_evidence_summary,
        source_family: candidateReport.source_family,
        quality_gap_flags: candidateReport.quality_gap_flags,
        net_new_classification: candidateReport.net_new_classification
      });
    }

    if (!safetyGate.authorized) continue;
    const writesUsed = summary.public_write_count + summary.quarantine_write_count;
    if (writesUsed >= Number(options.maxUpdates || 0)) {
      summary.stop_reason = "max_updates_reached";
      continue;
    }
    if (status === "accepted") {
      continue;
    }
    if (status === "quarantined") {
      await writeSourcePostingCache(pool, normalized, validation, {
        nowEpoch,
        parserVersion: target.adapter.parserVersion,
        sourceCompanyUrl: target.companyUrl,
        evidence: gate.evidence
      });
      summary.quarantine_write_count += 1;
    }
  }

  if (!safetyGate.authorized && targetCandidateReports.length > 0) {
    try {
      await annotateNetNewCandidateReports(pool, target, targetCandidateReports);
      const classificationByUrl = new Map(targetCandidateReports.map((report) => [report.canonical_url, report.net_new_classification]));
      for (const sample of summary.samples) {
        if (classificationByUrl.has(sample.canonical_url)) {
          sample.net_new_classification = classificationByUrl.get(sample.canonical_url);
        }
      }
    } catch (error) {
      for (const report of targetCandidateReports) {
        if (report.status === "accepted") report.net_new_classification = "net_new_estimator_unavailable";
      }
      incrementCounter(summary.parser_failure_reasons, "net_new_estimator_unavailable");
      summary.errors.push({ source_url: target.companyUrl, error: clean(error?.message || error, 240) });
    }
  }
  summary.candidate_reports.push(...targetCandidateReports);
  summary.candidate_report_count = summary.candidate_reports.length;

  if (safetyGate.authorized && accepted.length > 0) {
    const remaining = Math.max(0, Number(options.maxUpdates || 0) - summary.public_write_count - summary.quarantine_write_count);
    const toWrite = accepted.slice(0, remaining);
    if (toWrite.length > 0) {
      const canonicalUrls = toWrite.map((posting) => clean(posting.canonical_url || posting.job_posting_url, 2000)).filter(Boolean);
      const beforePostings = runId ? await snapshotRows(pool, "postings", canonicalUrls) : new Map();
      const beforeCache = runId ? await snapshotRows(pool, "posting_cache", canonicalUrls) : new Map();
      await upsertPostgresPostings(pool, toWrite, {
        nowEpoch,
        parserVersion: target.adapter.parserVersion
      });
      for (const posting of toWrite) {
        await writeSourcePostingCache(pool, posting, { ok: true, status: "valid", error: "" }, {
          nowEpoch,
          parserVersion: target.adapter.parserVersion,
          sourceCompanyUrl: target.companyUrl
        });
      }
      if (runId) {
        const afterPostings = await snapshotRows(pool, "postings", canonicalUrls);
        const afterCache = await snapshotRows(pool, "posting_cache", canonicalUrls);
        const recorded = await recordSourceRunPostingChanges(pool, {
          runId,
          source: target.atsKey,
          target,
          postings: toWrite,
          beforePostings,
          beforeCache,
          afterPostings,
          afterCache
        });
        summary.rollback_command = `npm run ats:source:rollback -- --run-id=${runId} --source=${target.atsKey} --confirm-production --json`;
        summary.source_write_audit_count = Number(summary.source_write_audit_count || 0) + Number(recorded.recorded || 0);
      }
      summary.public_write_count += toWrite.length;
    }
    if (toWrite.length < accepted.length) summary.stop_reason = "max_updates_reached";
  }
}

async function runWithLimitedConcurrency(items, worker, options = {}) {
  const concurrency = Math.max(1, Math.min(MAX_CONCURRENCY, Number(options.concurrency || 1)));
  let index = 0;
  const hostChains = new Map();
  async function runForHost(item) {
    const host = item.host || "";
    if (!host) return worker(item);
    const previous = hostChains.get(host) || Promise.resolve();
    let release = () => {};
    const current = previous.then(() => new Promise((resolve) => {
      release = resolve;
    }));
    hostChains.set(host, current);
    await previous;
    try {
      return await worker(item);
    } finally {
      release();
      if (hostChains.get(host) === current) hostChains.delete(host);
    }
  }
  async function runOne() {
    while (index < items.length) {
      const item = items[index++];
      await runForHost(item);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length || 1) }, () => runOne()));
}

async function runSourceJob(options = parseArgs(), env = process.env) {
  const summary = buildInitialSummary(options);
  const safetyGate = summary.safety_gate || getSafetyGate(options);
  summary.safety_gate = safetyGate;
  summary.recovery_readiness_gate = safetyGate.recovery_readiness_gate;
  summary.apply_mode = safetyGate.authorized;
  summary.statement_timeout_ms = Number(options.statementTimeoutMs || DEFAULT_STATEMENT_TIMEOUT_MS);

  if (summary.recovery_readiness_gate?.required && !summary.recovery_readiness_gate.ok) {
    summary.ok = false;
    summary.error_message = `source recovery readiness blocked: ${summary.recovery_readiness_gate.blockers.join(", ")}`;
    const error = new Error(summary.error_message);
    error.recoveryReadinessGate = summary.recovery_readiness_gate;
    error.sourceRunSummary = summary;
    throw error;
  }

  if (safetyGate.production_operation_requested && !safetyGate.operation_authorized) {
    summary.ok = false;
    summary.stop_reason = "source_operation_safety_blocked";
    summary.error_message = `source operation safety blocked: ${safetyGate.missing.join(", ") || "safety gate failed"}`;
    const error = new Error(summary.error_message);
    error.safetyGate = safetyGate;
    error.sourceRunSummary = summary;
    throw error;
  }

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
  let sourceRunId = 0;

  try {
    if (!options.pool) {
      await ensurePostgresSchema(pool);
      lock = await acquireHeavyJobLock(pool, `ats-source-${summary.source}-${options.mode || "dry-run"}`);
    }
    let targets = await discoverSourceTargets(pool, options);
    const plannedBatchTargetScope = scopeTargetsToPlannedBatch(targets, safetyGate);
    summary.planned_batch_target_scope = {
      required: plannedBatchTargetScope.required,
      ok: plannedBatchTargetScope.ok,
      discovered_target_count: plannedBatchTargetScope.discovered_target_count,
      selected_tenant_count: plannedBatchTargetScope.selected_tenant_count,
      matched_target_count: plannedBatchTargetScope.matched_target_count,
      skipped_target_count: plannedBatchTargetScope.skipped_target_count,
      failures: plannedBatchTargetScope.failures,
      skipped_targets_sample: plannedBatchTargetScope.skipped_targets_sample || []
    };
    if (plannedBatchTargetScope.required && !plannedBatchTargetScope.ok) {
      summary.ok = false;
      summary.stop_reason = "planned_batch_target_scope_blocked";
      summary.error_message = `planned batch target scope blocked: ${plannedBatchTargetScope.failures.join(", ")}`;
      const error = new Error(summary.error_message);
      error.plannedBatchTargetScope = summary.planned_batch_target_scope;
      error.sourceRunSummary = summary;
      throw error;
    }
    targets = plannedBatchTargetScope.targets;
    summary.scanned_targets = targets.length;
    summary.source_host_count = new Set(targets.map((target) => target.host).filter(Boolean)).size;
    if (options.mode !== "dry-run" || safetyGate.authorized) {
      sourceRunId = await createSourceRun(pool, options, targets);
      summary.source_run_id = sourceRunId;
    }
    await runWithLimitedConcurrency(
      targets,
      (target) => {
        if (summary.stop_reason === "max_updates_reached") return null;
        return processTarget(pool, target, options, summary, sourceRunId);
      },
      options
    );
    const status = summary.errors.length > 0 ? "completed_with_errors" : "completed";
    if (sourceRunId) await finishSourceRun(pool, sourceRunId, status, summary, summary.stop_reason);
    if (lock) await lock.release("succeeded");
    lock = null;
    return summary;
  } catch (error) {
    summary.ok = false;
    summary.error_message = clean(error?.message || error, 1000);
    if (sourceRunId) await finishSourceRun(pool, sourceRunId, "failed", summary, "error");
    if (lock) await lock.release("failed");
    lock = null;
    throw error;
  } finally {
    if (!options.pool && pool && typeof pool.end === "function") await pool.end();
  }
}

const sourceRunnerInterface = Object.freeze({
  discover: discoverSourceTargets,
  fetchList: (target) => target.adapter.fetch(target.company),
  fetchDetail: async () => null,
  parseList: (target, raw) => target.adapter.parse(raw, target.company),
  parseDetail: async () => [],
  normalize: (target, item, nowEpoch = nowEpochSeconds()) => target.adapter.normalize(item, target.company, { nowEpoch }),
  validate: (target, posting) => target.adapter.validate(posting),
  writeAccepted: upsertPostgresPostings,
  writeQuarantine: writeSourcePostingCache
});

module.exports = {
  DEFAULT_HOST_CONCURRENCY,
  MAX_RUN_LIMIT,
  DEFAULT_SOURCE_RUN_LIMIT,
  attachDetailEvidenceSnapshot,
  buildCandidateReport,
  buildQualityGapFlags,
  candidateDetailEvidenceUrl,
  classifySourceCandidateErrorType,
  evaluatePlannedBatchGate,
  evaluatePreflightReportGate,
  evaluateSourceRecoveryReadiness,
  evaluateSourceCandidate,
  getVirtualSourceTarget,
  getVirtualSourceTargetCount,
  getRecoveryReadinessGate,
  getSafetyGate,
  parseArgs,
  runSourceJob,
  scopeTargetsToPlannedBatch,
  sourceHost,
  sourceRunnerInterface,
  discoverSourceTargets,
  runWithLimitedConcurrency
};
