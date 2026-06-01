const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  attachDetailEvidenceSnapshot,
  buildCandidateReport,
  buildQualityGapFlags,
  candidateDetailEvidenceUrl,
  classifySourceCandidateErrorType,
  evaluatePlannedBatchGate,
  evaluateSourceRecoveryReadiness,
  getRecoveryReadinessGate,
  getSafetyGate,
  parseArgs,
  discoverSourceTargets,
  runSourceJob,
  scopeTargetsToPlannedBatch,
  runWithLimitedConcurrency,
  sourceHost
} = require("./sourceRunner");

function plannedBatchReport(overrides = {}) {
  const selectedPlan = {
    target_gain: 25,
    selected_tenant_count: 1,
    selected_tenants: [{
      source: "greenhouse",
      tenant_key: "tenant-a",
      tenant_host: "tenant-a.greenhouse.io",
      target_url: "https://tenant-a.greenhouse.io/jobs",
      net_new_clean_public_candidates: 25,
      predicted_guard_result: "pass"
    }],
    cumulative_net_new_clean_public_candidates: 25,
    cumulative_missing_any_geo_count: 0,
    cumulative_weak_unknown_remote_count: 0,
    cumulative_no_geo_no_remote_count: 0,
    predicted_guard_result: "pass",
    fail_reasons: []
  };
  return {
    ok: true,
    mode: "tenant-batch-plan",
    read_only: true,
    source: "greenhouse",
    target_gain: 25,
    net_new_clean_public_candidates: 25,
    selected_plan: selectedPlan,
    ...overrides
  };
}

function writePlannedBatchReport(report = plannedBatchReport()) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openjobslots-plan-"));
  const filePath = path.join(dir, "plan.json");
  fs.writeFileSync(filePath, `${JSON.stringify(report, null, 2)}\n`);
  return filePath;
}

test("source runner apply requires explicit production safety flags", () => {
  const dryRun = parseArgs(["--source=greenhouse", "--limit=5"]);
  assert.equal(dryRun.source, "greenhouse");
  assert.equal(dryRun.limit, 5);
  assert.equal(getSafetyGate(dryRun).authorized, false);

  const companyLimitAlias = parseArgs(["--source=icims", "--company-limit=7"]);
  assert.equal(companyLimitAlias.limit, 7);

  const workerPausedAlias = parseArgs(["--source=greenhouse", "--apply", "--backup-confirmed", "--worker-paused"]);
  assert.equal(workerPausedAlias.backupConfirmed, true);
  assert.equal(workerPausedAlias.workerIsolated, true);

  const detailEvidence = parseArgs([
    "--source=icims",
    "--detail-evidence",
    "--detail-evidence-provider=local",
    "--detail-evidence-sample=20"
  ]);
  assert.equal(detailEvidence.detailEvidence, true);
  assert.equal(detailEvidence.detailEvidenceProvider, "local");
  assert.equal(detailEvidence.detailEvidenceSample, 20);

  const offsetRun = parseArgs(["--source=hrmdirect", "--limit=1500", "--offset=1000"]);
  assert.equal(offsetRun.limit, 1000);
  assert.equal(offsetRun.offset, 1000);

  const missingMax = parseArgs(["--source=greenhouse", "--apply", "--confirm-production"]);
  const missingMaxGate = getSafetyGate(missingMax);
  assert.equal(missingMaxGate.authorized, false);
  assert.deepEqual(missingMaxGate.missing, [
    "--backup-confirmed",
    "--worker-isolated",
    "--max-updates=N",
    "--planned-batch=<report>",
    "--predicted-guard-result=pass"
  ]);

  const missingPlan = parseArgs([
    "--mode=apply",
    "--source=greenhouse",
    "--confirm-production",
    "--backup-confirmed",
    "--worker-isolated",
    "--max-updates=25"
  ]);
  const missingPlanGate = getSafetyGate(missingPlan);
  assert.equal(missingPlanGate.authorized, false);
  assert.equal(missingPlanGate.planned_batch_required, true);
  assert.equal(missingPlanGate.planned_batch_present, false);
  assert.equal(missingPlanGate.predicted_guard_ok, false);
  assert.ok(missingPlanGate.missing.includes("--planned-batch=<report>"));
  assert.ok(missingPlanGate.missing.includes("--predicted-guard-result=pass"));

  const failedPrediction = parseArgs([
    "--mode=apply",
    "--source=greenhouse",
    "--confirm-production",
    "--backup-confirmed",
    "--worker-isolated",
    "--max-updates=25",
    `--planned-batch=${writePlannedBatchReport()}`,
    "--predicted-guard-result=fail"
  ]);
  const failedPredictionGate = getSafetyGate(failedPrediction);
  assert.equal(failedPredictionGate.authorized, false);
  assert.equal(failedPredictionGate.planned_batch_present, true);
  assert.equal(failedPredictionGate.planned_batch_report_ok, true);
  assert.equal(failedPredictionGate.predicted_guard_ok, false);
  assert.deepEqual(failedPredictionGate.missing, ["--predicted-guard-result=pass"]);

  const missingReportFile = parseArgs([
    "--mode=apply",
    "--source=greenhouse",
    "--confirm-production",
    "--backup-confirmed",
    "--worker-isolated",
    "--max-updates=25",
    "--planned-batch=reports/greenhouse-plan.json",
    "--predicted-guard-result=pass"
  ]);
  const missingReportFileGate = getSafetyGate(missingReportFile);
  assert.equal(missingReportFileGate.authorized, false);
  assert.equal(missingReportFileGate.planned_batch_report_ok, false);
  assert.ok(missingReportFileGate.missing.includes("planned-batch-report-valid"));

  const sourceMismatch = parseArgs([
    "--mode=apply",
    "--source=greenhouse",
    "--confirm-production",
    "--backup-confirmed",
    "--worker-isolated",
    "--max-updates=25",
    `--planned-batch=${writePlannedBatchReport(plannedBatchReport({ source: "lever" }))}`,
    "--predicted-guard-result=pass"
  ]);
  const sourceMismatchGate = getSafetyGate(sourceMismatch);
  assert.equal(sourceMismatchGate.authorized, false);
  assert.ok(sourceMismatchGate.planned_batch_report_failures.includes("planned_batch_report_source_mismatch"));

  const failedReportPrediction = parseArgs([
    "--mode=apply",
    "--source=greenhouse",
    "--confirm-production",
    "--backup-confirmed",
    "--worker-isolated",
    "--max-updates=25",
    `--planned-batch=${writePlannedBatchReport(plannedBatchReport({
      selected_plan: {
        ...plannedBatchReport().selected_plan,
        predicted_guard_result: "fail",
        fail_reasons: ["insufficient_guard_safe_tenant_rows"]
      }
    }))}`,
    "--predicted-guard-result=pass"
  ]);
  const failedReportPredictionGate = getSafetyGate(failedReportPrediction);
  assert.equal(failedReportPredictionGate.authorized, false);
  assert.equal(failedReportPredictionGate.predicted_guard_ok, false);
  assert.ok(failedReportPredictionGate.planned_batch_report_failures.includes("planned_batch_predicted_guard_not_pass"));

  const authorized = parseArgs([
    "--mode=apply",
    "--source=greenhouse",
    "--apply",
    "--confirm-production",
    "--backup-confirmed",
    "--worker-isolated",
    "--max-updates=25",
    `--planned-batch=${writePlannedBatchReport()}`,
    "--predicted-guard-result=pass"
  ]);
  const gate = getSafetyGate(authorized);
  assert.equal(gate.apply_requested, true);
  assert.equal(gate.authorized, true);
  assert.deepEqual(gate.missing, []);
  assert.equal(gate.recovery_readiness_gate.ok, true);
  assert.equal(gate.backup_confirmed, true);
  assert.equal(gate.worker_isolated, true);
  assert.equal(gate.planned_batch_present, true);
  assert.equal(gate.planned_batch_report_ok, true);
  assert.equal(gate.planned_batch_report_source, "greenhouse");
  assert.equal(gate.planned_batch_report_selected_tenant_count, 1);
  assert.equal(gate.planned_batch_report_selected_gain, 25);
  assert.equal(gate.predicted_guard_ok, true);
});

test("source runner validates inline planned batch reports for unit callers", () => {
  const gate = evaluatePlannedBatchGate({
    apply: true,
    source: "greenhouse",
    plannedBatch: "inline-plan",
    plannedBatchReport: plannedBatchReport()
  });
  assert.equal(gate.ok, true);
  assert.equal(gate.status, "pass");
  assert.equal(gate.source_type, "inline");
  assert.equal(gate.predicted_guard_result, "pass");
});

test("source runner scopes authorized writes to selected planned-batch targets", () => {
  const gate = getSafetyGate({
    ...parseArgs([
      "--mode=apply",
      "--source=greenhouse",
      "--apply",
      "--confirm-production",
      "--backup-confirmed",
      "--worker-isolated",
      "--max-updates=25",
      "--planned-batch=inline",
      "--predicted-guard-result=pass"
    ]),
    plannedBatchReport: plannedBatchReport()
  });
  const scoped = scopeTargetsToPlannedBatch([
    {
      companyUrl: "https://tenant-a.greenhouse.io/jobs",
      host: "tenant-a.greenhouse.io",
      company: { company_name: "Tenant A", url_string: "https://tenant-a.greenhouse.io/jobs" }
    },
    {
      companyUrl: "https://tenant-b.greenhouse.io/jobs",
      host: "tenant-b.greenhouse.io",
      company: { company_name: "Tenant B", url_string: "https://tenant-b.greenhouse.io/jobs" }
    }
  ], gate);
  assert.equal(scoped.ok, true);
  assert.equal(scoped.matched_target_count, 1);
  assert.equal(scoped.skipped_target_count, 1);
  assert.equal(scoped.targets[0].company.company_name, "Tenant A");
});

test("source runner uses exact target URL before shared-host fallback", () => {
  const report = plannedBatchReport({
    selected_plan: {
      ...plannedBatchReport().selected_plan,
      selected_tenants: [{
        source: "greenhouse",
        tenant_key: "shared.example.com",
        tenant_host: "shared.example.com",
        target_url: "https://shared.example.com/company-a/jobs",
        net_new_clean_public_candidates: 25,
        predicted_guard_result: "pass"
      }]
    }
  });
  const gate = getSafetyGate({
    ...parseArgs([
      "--mode=apply",
      "--source=greenhouse",
      "--apply",
      "--confirm-production",
      "--backup-confirmed",
      "--worker-isolated",
      "--max-updates=25",
      "--planned-batch=inline",
      "--predicted-guard-result=pass"
    ]),
    plannedBatchReport: report
  });
  const scoped = scopeTargetsToPlannedBatch([
    {
      companyUrl: "https://shared.example.com/company-a/jobs",
      host: "shared.example.com",
      company: { company_name: "Company A", url_string: "https://shared.example.com/company-a/jobs" }
    },
    {
      companyUrl: "https://shared.example.com/company-b/jobs",
      host: "shared.example.com",
      company: { company_name: "Company B", url_string: "https://shared.example.com/company-b/jobs" }
    }
  ], gate);
  assert.equal(scoped.ok, true);
  assert.equal(scoped.matched_target_count, 1);
  assert.equal(scoped.targets[0].company.company_name, "Company A");
});

test("source runner blocks authorized writes when planned batch matches no discovered target", async () => {
  const options = {
    ...parseArgs([
      "--mode=apply",
      "--source=greenhouse",
      "--apply",
      "--confirm-production",
      "--backup-confirmed",
      "--worker-isolated",
      "--max-updates=25",
      "--planned-batch=inline",
      "--predicted-guard-result=pass"
    ]),
    plannedBatchReport: plannedBatchReport(),
    pool: {
      async query(sql) {
        if (/FROM companies c/i.test(sql)) {
          return {
            rows: [{
              id: 1,
              company_name: "Other Tenant",
              url_string: "https://other.greenhouse.io/jobs",
              ats_key: "greenhouse",
              enabled: true,
              protection_status: "normal",
              disabled_reason: "",
              rate_limit_ms: 0
            }]
          };
        }
        throw new Error(`unexpected query: ${sql}`);
      }
    }
  };
  await assert.rejects(
    () => runSourceJob(options),
    /planned batch target scope blocked: planned_batch_no_matching_discovered_targets/
  );
});

test("source runner requires recovery readiness for canary and apply operations", async () => {
  const dryRun = parseArgs(["--mode=dry-run", "--source=dayforcehcm"]);
  assert.equal(getRecoveryReadinessGate(dryRun).required, false);

  const dayforceCanary = parseArgs(["--mode=canary", "--source=dayforcehcm"]);
  const dayforceGate = getRecoveryReadinessGate(dayforceCanary);
  assert.equal(dayforceGate.required, true);
  assert.equal(dayforceGate.ok, true);
  assert.deepEqual(dayforceGate.blockers, []);

  const blockedCanary = parseArgs(["--mode=canary", "--source=not_configured_ats"]);
  const canaryGate = getRecoveryReadinessGate(blockedCanary);
  assert.equal(canaryGate.required, true);
  assert.equal(canaryGate.ok, false);
  assert.ok(canaryGate.blockers.includes("unsupported source"));

  const blockedApply = parseArgs([
    "--mode=apply",
    "--source=not_configured_ats",
    "--confirm-production",
    "--backup-confirmed",
    "--worker-isolated",
    "--max-updates=1",
    "--planned-batch=reports/not-configured-plan.json",
    "--predicted-guard-result=pass"
  ]);
  const safetyGate = getSafetyGate(blockedApply);
  assert.equal(safetyGate.authorized, false);
  assert.ok(safetyGate.missing.includes("recovery-readiness-ok"));

  const ready = evaluateSourceRecoveryReadiness("greenhouse");
  assert.equal(ready.ok, true);
  assert.equal(ready.status, "ready-for-recovery-operation");

  await assert.rejects(
    () => runSourceJob({
      ...blockedCanary,
      pool: {
        async query() {
          throw new Error("blocked readiness should not query");
        }
      }
    }),
    /source recovery readiness blocked/
  );
});

test("source runner normalizes hosts for per-host concurrency", () => {
  assert.equal(sourceHost("https://jobs.example.com/path?a=1"), "jobs.example.com");
  assert.equal(sourceHost("not a url"), "");
});

test("source runner host concurrency serializes same host while allowing different hosts", async () => {
  const runningByHost = new Map();
  const peakByHost = new Map();
  const items = [
    { host: "a.example" },
    { host: "a.example" },
    { host: "b.example" }
  ];
  await runWithLimitedConcurrency(
    items,
    async (item) => {
      const running = Number(runningByHost.get(item.host) || 0) + 1;
      runningByHost.set(item.host, running);
      peakByHost.set(item.host, Math.max(Number(peakByHost.get(item.host) || 0), running));
      await new Promise((resolve) => setTimeout(resolve, 10));
      runningByHost.set(item.host, Number(runningByHost.get(item.host) || 0) - 1);
    },
    { concurrency: 3, hostConcurrency: 1 }
  );
  assert.equal(peakByHost.get("a.example"), 1);
  assert.equal(peakByHost.get("b.example"), 1);
});

test("source runner exposes virtual targets for public aggregate boards in include-disabled estimates", async () => {
  const queries = [];
  const pool = {
    async query(sql, params) {
      queries.push({ sql, params });
      if (/FROM companies c/i.test(sql)) return { rows: [] };
      if (/FROM ats_sources s/i.test(sql)) {
        return {
          rows: [{
            ats_key: "governmentjobs",
            enabled: false,
            protection_status: "normal",
            disabled_reason: "",
            rate_limit_ms: 0
          }]
        };
      }
      throw new Error(`unexpected query: ${sql}`);
    }
  };

  const targets = await discoverSourceTargets(pool, {
    source: "governmentjobs",
    includeDisabled: true,
    limit: 25,
    offset: 0
  });

  assert.equal(targets.length, 1);
  assert.equal(targets[0].company.company_name, "GovernmentJobs (virtual)");
  assert.equal(targets[0].company.url_string, "https://www.governmentjobs.com/jobs");
  assert.equal(targets[0].atsKey, "governmentjobs");
  assert.equal(targets[0].source.enabled, false);
  assert.ok(targets[0].adapter, "virtual targets should still use the normal source adapter");
  assert.equal(queries.length, 2);
});

test("source runner does not expose disabled virtual targets without include-disabled", async () => {
  const pool = {
    async query(sql) {
      if (/FROM companies c/i.test(sql)) return { rows: [] };
      if (/FROM ats_sources s/i.test(sql)) return { rows: [] };
      throw new Error(`unexpected query: ${sql}`);
    }
  };

  const targets = await discoverSourceTargets(pool, {
    source: "governmentjobs",
    includeDisabled: false,
    limit: 25,
    offset: 0
  });

  assert.deepEqual(targets, []);
});

test("source runner report classifies geo/remote gaps without assigning missing fields", () => {
  const flags = buildQualityGapFlags({
    country: "",
    region: "",
    city: "",
    location_text: "",
    remote_type: "unknown"
  }, "quarantined", ["no_geo_no_remote"]);

  assert.equal(flags.missing_any_geo, true);
  assert.equal(flags.missing_all_geo, true);
  assert.equal(flags.weak_unknown_remote, true);
  assert.equal(flags.no_geo_no_remote, true);
  assert.equal(flags.detail_evidence_found, false);
});

test("source runner keeps source-quality blocks out of parser validation errors", () => {
  assert.equal(classifySourceCandidateErrorType("source_disabled_by_threshold"), "source_quality");
  assert.equal(classifySourceCandidateErrorType("missing source_job_id"), "parser_validation");
});

test("source runner detail evidence sampling is dry-run only and bounded", async () => {
  const normalized = {
    canonical_url: "https://jobs.example.com/1",
    position_name: "Engineer",
    country: "",
    region: "",
    city: "",
    remote_type: "unknown"
  };
  const summary = {
    detail_evidence_sampled_count: 0,
    detail_evidence_failure_count: 0,
    detail_evidence_status_counts: {}
  };

  assert.equal(candidateDetailEvidenceUrl(normalized), "https://jobs.example.com/1");
  await attachDetailEvidenceSnapshot(normalized, {
    mode: "dry-run",
    detailEvidence: true,
    detailEvidenceSample: 1,
    detailEvidenceProvider: "local",
    detailEvidenceFetcher: async () => ({
      ok: true,
      status: 200,
      url: "https://jobs.example.com/1",
      headers: { get: () => "" },
      async text() {
        return "<p>Location: Austin</p><p>Hybrid role</p>";
      }
    }),
    detailEvidenceLookup: async () => [{ address: "93.184.216.34", family: 4 }]
  }, summary);

  assert.equal(summary.detail_evidence_sampled_count, 1);
  assert.equal(summary.detail_evidence_status_counts.fetched, 1);
  assert.equal(normalized.detail_evidence.status, "fetched");
  assert.equal(normalized.detail_evidence.country, undefined);

  const second = { ...normalized, canonical_url: "https://jobs.example.com/2", detail_evidence: null };
  await attachDetailEvidenceSnapshot(second, {
    mode: "dry-run",
    detailEvidence: true,
    detailEvidenceSample: 1,
    detailEvidenceProvider: "local"
  }, summary);
  assert.equal(second.detail_evidence, null);

  const applyMode = { canonical_url: "https://jobs.example.com/3" };
  await attachDetailEvidenceSnapshot(applyMode, {
    mode: "apply",
    detailEvidence: true,
    detailEvidenceSample: 10
  }, { detail_evidence_sampled_count: 0 });
  assert.equal(applyMode.detail_evidence, undefined);
});

test("source runner candidate reports include source family and detail evidence summary", () => {
  const report = buildCandidateReport(
    {
      companyUrl: "https://jobs.example.com",
      host: "jobs.example.com",
      adapter: { metadata: { sourceFamily: "html_detail" } }
    },
    {
      canonical_url: "https://jobs.example.com/1",
      source_job_id: "job-1",
      position_name: "Engineer",
      country: "",
      region: "",
      city: "",
      remote_type: "unknown",
      detail_evidence: {
        status: "fetched",
        extractor: "local",
        final_url: "https://jobs.example.com/1",
        content_hash: "abc",
        markdown_length: 42,
        evidence_spans: [{ kind: "location", excerpt: "Location: Austin" }]
      }
    },
    "quarantined",
    { status: "quarantined", public: false, ok: false, reason: "no_geo_no_remote" },
    { error: "no_geo_no_remote", reason_codes: ["no_geo_no_remote"] },
    { failure_reasons: [] }
  );

  assert.equal(report.source_family, "html_detail");
  assert.equal(report.detail_evidence_summary.present, true);
  assert.equal(report.detail_evidence_summary.extractor, "local");
  assert.equal(report.quality_gap_flags.detail_evidence_found, true);
  assert.equal(report.quality_gap_flags.no_geo_no_remote, true);
  assert.equal(report.country, undefined);
  assert.equal(report.remote_type, undefined);
});

console.log("source runner tests passed");
