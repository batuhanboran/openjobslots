const assert = require("node:assert/strict");
const test = require("node:test");
const { evaluateRecoveryGuard } = require("./ats-recovery-guard");

function qualityReport(visible, source, accepted) {
  return {
    summary: { total_visible_postings: visible },
    items: [{
      ats_key: source,
      accepted_rows: accepted
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
  assert.deepEqual(result.failures, []);
  assert.equal(result.source_recovery_report.public_row_gain, 2);
});

test("guard records no-improvement reasons", () => {
  const result = evaluateRecoveryGuard({
    before: qualityReport(100, "recruitee", 10),
    after: qualityReport(100, "recruitee", 10),
    sourceReport: sourceReport({
      source: "recruitee",
      accepted_public_rows_before: 10,
      accepted_public_rows_after: 10,
      public_row_gain: 0,
      rows_newly_accepted: 0,
      missing_geo_before: 5,
      missing_geo_after: 5,
      weak_remote_before: 4,
      weak_remote_after: 4,
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
  assert.ok(result.warnings.some((warning) => warning.code === "no_improvement_reasons_recorded"));
  assert.equal(result.source_recovery_report.no_improvement_reasons.by_tenant["tenant-a"], 1);
  assert.equal(result.source_recovery_report.no_improvement_reasons.by_error.http_403, 1);
});

console.log("ats recovery guard tests passed");
