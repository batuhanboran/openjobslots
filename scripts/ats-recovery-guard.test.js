const assert = require("node:assert/strict");
const test = require("node:test");
const { evaluateRecoveryGuard } = require("./ats-recovery-guard");

function qualityReport(visible, source, accepted, options = {}) {
  const missingAnyPct = options.globalMissingAnyGeoPct ?? 10;
  const weakRemotePct = options.globalWeakRemotePct ?? 5;
  const sourceMissingAnyPct = options.sourceMissingAnyGeoPct ?? missingAnyPct;
  const sourceWeakRemotePct = options.sourceWeakRemotePct ?? weakRemotePct;
  return {
    summary: {
      total_visible_postings: visible,
      missing_any_normalized_geo_pct: missingAnyPct,
      weak_unknown_remote_type_pct: weakRemotePct
    },
    items: [{
      ats_key: source,
      accepted_rows: accepted,
      total_visible_rows: accepted,
      missing_any_normalized_geo_pct: sourceMissingAnyPct,
      weak_unknown_remote_type_pct: sourceWeakRemotePct
    }]
  };
}

function safeStatus() {
  return {
    ok: true,
    item: {
      write_pressure: "idle",
      heavy_job: {
        active: false,
        locks: []
      }
    }
  };
}

function sourceReport(overrides = {}) {
  const acceptedBefore = overrides.accepted_public_rows_before ?? 10;
  const acceptedAfter = overrides.accepted_public_rows_after ?? 12;
  return {
    source: "greenhouse",
    tenants_considered: 2,
    tenants_fetched: 2,
    rows_parsed: 5,
    accepted_public_rows_before: acceptedBefore,
    accepted_public_rows_after: acceptedAfter,
    public_row_gain: acceptedAfter - acceptedBefore,
    rows_updated_existing: 1,
    rows_newly_accepted: Math.max(0, acceptedAfter - acceptedBefore),
    quarantined: 0,
    skipped_ambiguous: 1,
    missing_geo_before: 4,
    missing_geo_after: 4,
    weak_remote_before: 3,
    weak_remote_after: 3,
    no_improvement_reasons: [],
    ...overrides
  };
}

test("guard fails on visible count decrease", () => {
  const result = evaluateRecoveryGuard({
    before: qualityReport(100, "greenhouse", 10),
    after: qualityReport(99, "greenhouse", 11),
    sourceReport: sourceReport(),
    meiliCheck: { count_delta: 0 },
    ingestionStatus: safeStatus(),
    serviceStats: [{ name: "openjobslots-app", cpu_percent: "0.10%" }]
  });

  assert.equal(result.ok, false);
  assert.ok(result.failures.some((failure) => failure.code === "visible_count_decreased"));
});

test("guard fails on no_geo_no_remote accepted row", () => {
  const result = evaluateRecoveryGuard({
    before: qualityReport(100, "greenhouse", 10),
    after: qualityReport(102, "greenhouse", 12),
    sourceReport: sourceReport({ rows_newly_accepted_no_geo_no_remote: 1 }),
    meiliCheck: { count_delta: 0 },
    ingestionStatus: safeStatus(),
    serviceStats: [{ name: "openjobslots-app", cpu_percent: "0.10%" }]
  });

  assert.equal(result.ok, false);
  assert.ok(result.failures.some((failure) => failure.code === "new_accepted_no_geo_no_remote"));
});

test("guard passes on accepted public row increase with no bad rows", () => {
  const result = evaluateRecoveryGuard({
    before: qualityReport(100, "greenhouse", 10),
    after: qualityReport(102, "greenhouse", 12),
    sourceReport: sourceReport(),
    meiliCheck: { count_delta: 0 },
    ingestionStatus: safeStatus(),
    serviceStats: [{ name: "openjobslots-app", cpu_percent: "0.10%" }]
  });

  assert.equal(result.ok, true);
  assert.equal(result.success, true);
  assert.equal(result.release_allowed, true);
  assert.deepEqual(result.failures, []);
  assert.equal(result.source_recovery_report.public_row_gain, 2);
});

test("guard fails when visible rows increase and global missing-any-geo percentage increases", () => {
  const result = evaluateRecoveryGuard({
    before: qualityReport(100, "greenhouse", 10, { globalMissingAnyGeoPct: 10 }),
    after: qualityReport(102, "greenhouse", 12, { globalMissingAnyGeoPct: 11 }),
    sourceReport: sourceReport(),
    meiliCheck: { count_delta: 0 },
    ingestionStatus: safeStatus(),
    serviceStats: [{ name: "openjobslots-app", cpu_percent: "0.10%" }]
  });

  assert.equal(result.ok, false);
  assert.ok(result.failures.some((failure) => failure.code === "global_missing_any_geo_pct_increased"));
  assert.ok(result.no_release_allowed.some((reason) => reason.code === "quality_regressed_with_visible_gain"));
  assert.ok(result.no_release_allowed.some((reason) => reason.code === "clean_source_writes_global_quality_regressed"));
});

test("guard fails when visible rows increase and global weak-remote percentage increases", () => {
  const result = evaluateRecoveryGuard({
    before: qualityReport(100, "greenhouse", 10, { globalWeakRemotePct: 5 }),
    after: qualityReport(102, "greenhouse", 12, { globalWeakRemotePct: 6 }),
    sourceReport: sourceReport(),
    meiliCheck: { count_delta: 0 },
    ingestionStatus: safeStatus(),
    serviceStats: [{ name: "openjobslots-app", cpu_percent: "0.10%" }]
  });

  assert.equal(result.ok, false);
  assert.ok(result.failures.some((failure) => failure.code === "global_weak_unknown_remote_pct_increased"));
  assert.ok(result.no_release_allowed.some((reason) => reason.code === "quality_regressed_with_visible_gain"));
});

test("guard fails when source accepted rows increase but source geo percentage worsens", () => {
  const result = evaluateRecoveryGuard({
    before: qualityReport(100, "greenhouse", 10, { sourceMissingAnyGeoPct: 10 }),
    after: qualityReport(102, "greenhouse", 12, { sourceMissingAnyGeoPct: 20 }),
    sourceReport: sourceReport(),
    meiliCheck: { count_delta: 0 },
    ingestionStatus: safeStatus(),
    serviceStats: [{ name: "openjobslots-app", cpu_percent: "0.10%" }]
  });

  assert.equal(result.ok, false);
  assert.ok(result.failures.some((failure) => failure.code === "source_missing_any_geo_pct_increased"));
});

test("guard passes source geo percentage exception with row-by-row explicit remote evidence", () => {
  const result = evaluateRecoveryGuard({
    before: qualityReport(100, "greenhouse", 10, { sourceMissingAnyGeoPct: 10 }),
    after: qualityReport(102, "greenhouse", 12, { sourceMissingAnyGeoPct: 20 }),
    sourceReport: sourceReport({
      newly_accepted_row_evidence: [
        {
          source_job_id: "job-1",
          remote_type: "remote",
          explicit_remote_evidence: true,
          remote_evidence: { field: "workplace_type", value: "remote" }
        },
        {
          source_job_id: "job-2",
          remote_type: "hybrid",
          explicit_remote_evidence: true,
          remote_evidence: { field: "workplace_type", value: "hybrid" }
        }
      ]
    }),
    meiliCheck: { count_delta: 0 },
    ingestionStatus: safeStatus(),
    serviceStats: [{ name: "openjobslots-app", cpu_percent: "0.10%" }]
  });

  assert.equal(result.ok, true);
  assert.equal(result.release_allowed, true);
});

test("guard fails when Meili/Postgres delta is nonzero", () => {
  const result = evaluateRecoveryGuard({
    before: qualityReport(100, "greenhouse", 10),
    after: qualityReport(102, "greenhouse", 12),
    sourceReport: sourceReport(),
    meiliCheck: { count_delta: -1 },
    ingestionStatus: safeStatus(),
    serviceStats: [{ name: "openjobslots-app", cpu_percent: "0.10%" }]
  });

  assert.equal(result.ok, false);
  assert.ok(result.failures.some((failure) => failure.code === "meili_postgres_delta_nonzero"));
  assert.ok(result.no_release_allowed.some((reason) => reason.code === "meili_delta_nonzero_only_failure"));
});

test("guard passes blocker-only no-improvement report with no writes but success is false", () => {
  const result = evaluateRecoveryGuard({
    before: qualityReport(100, "recruitee", 10),
    after: qualityReport(100, "recruitee", 10),
    sourceReport: sourceReport({
      source: "recruitee",
      accepted_public_rows_before: 10,
      accepted_public_rows_after: 10,
      public_row_gain: 0,
      rows_newly_accepted: 0,
      rows_updated_existing: 0,
      missing_geo_before: 5,
      missing_geo_after: 5,
      weak_remote_before: 4,
      weak_remote_after: 4,
      no_improvement_blocker_only: true,
      no_improvement_reasons: [{
        tenant: "tenant-a",
        source: "https://tenant-a.example/jobs",
        error: "http_403",
        reason: "careers API returned 403"
      }]
    }),
    meiliCheck: { count_delta: 0 },
    ingestionStatus: safeStatus(),
    serviceStats: [{ name: "openjobslots-app", cpu_percent: "0.10%" }]
  });

  assert.equal(result.ok, true);
  assert.equal(result.success, false);
  assert.equal(result.release_allowed, false);
  assert.ok(result.warnings.some((warning) => warning.code === "no_improvement_reasons_recorded"));
  assert.ok(result.no_release_allowed.some((reason) => reason.code === "no_improvement_blocker_only"));
  assert.equal(result.source_recovery_report.no_improvement_reasons.by_tenant["tenant-a"], 1);
  assert.equal(result.source_recovery_report.no_improvement_reasons.by_error.http_403, 1);
});

console.log("ats recovery guard tests passed");
