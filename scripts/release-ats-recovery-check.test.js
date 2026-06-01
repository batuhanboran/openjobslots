const assert = require("node:assert/strict");
const test = require("node:test");
const { evaluateReleaseCheck, selfTestPayload } = require("./release-ats-recovery-check");

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function basePayload(overrides = {}) {
  const payload = selfTestPayload();
  return {
    ...payload,
    ...overrides,
    before: { ...payload.before, ...(overrides.before || {}) },
    after: { ...payload.after, ...(overrides.after || {}) },
    sourceReport: { ...payload.sourceReport, ...(overrides.sourceReport || {}) },
    meiliCheck: { ...payload.meiliCheck, ...(overrides.meiliCheck || {}) },
    guardReport: { ...payload.guardReport, ...(overrides.guardReport || {}) },
    testsReport: hasOwn(overrides, "testsReport")
      ? overrides.testsReport
      : { ...payload.testsReport },
    preflightReport: hasOwn(overrides, "preflightReport")
      ? overrides.preflightReport
      : { ...payload.preflightReport }
  };
}

test("release check passes for clean recovery reports", () => {
  const result = evaluateReleaseCheck(basePayload());
  assert.equal(result.ok, true);
  assert.equal(result.release_allowed, true);
  assert.equal(result.metrics.preflight_backup_size_bytes, 1024);
  assert.equal(typeof result.metrics.preflight_generated_at, "string");
  assert.equal(result.metrics.preflight_long_running_postgres_queries, 0);
  assert.equal(result.metrics.preflight_meili_postgres_delta, 0);
  assert.equal(result.metrics.meili_remote_facet_delta_count, 0);
  assert.equal(result.metrics.meili_sample_mismatch_count, 0);
  assert.equal(result.metrics.meili_extra_document_count, 0);
  assert.equal(result.metrics.meili_missing_document_count, 0);
});

test("release check fails without inventory scan proof", () => {
  const result = evaluateReleaseCheck(basePayload({
    sourceReport: { inventory_scan_report: undefined }
  }));
  assert.equal(result.ok, false);
  assert.ok(result.failures.some((failure) => failure.code === "missing_or_failed_inventory_scan_report"));
});

test("release check fails when net-new estimate is below accepted gain", () => {
  const result = evaluateReleaseCheck(basePayload({
    sourceReport: { net_new_clean_public_estimate: 9 }
  }));
  assert.equal(result.ok, false);
  assert.ok(result.failures.some((failure) => failure.code === "net_new_clean_public_estimate_below_gain"));
});

test("release check fails without duplicate candidate accounting", () => {
  const result = evaluateReleaseCheck(basePayload({
    sourceReport: { duplicate_existing_public_candidates: undefined }
  }));
  assert.equal(result.ok, false);
  assert.ok(result.failures.some((failure) => failure.code === "duplicate_existing_public_candidates_missing"));
});

test("release check accepts explicit empty duplicate candidate list", () => {
  const result = evaluateReleaseCheck(basePayload({
    sourceReport: { duplicate_existing_public_candidates: [] }
  }));
  assert.equal(result.ok, true);
  assert.equal(result.metrics.duplicate_existing_public_candidates, 0);
});

test("release check fails when candidate pool is unproven", () => {
  const result = evaluateReleaseCheck(basePayload({
    sourceReport: {
      inventory_scan_report: {
        path: "reports/lever-inventory.json",
        candidate_pool_exhausted: false,
        estimate_confidence: "low"
      },
      candidate_pool_exhausted: false,
      estimate_confidence: "low"
    }
  }));
  assert.equal(result.ok, false);
  assert.ok(result.failures.some((failure) => failure.code === "candidate_pool_unproven"));
});

test("release check accepts bounded subset proof above the 5k recovery threshold", () => {
  const result = evaluateReleaseCheck(basePayload({
    sourceReport: {
      inventory_scan_report: {
        path: "reports/lever-inventory.json",
        candidate_pool_exhausted: false,
        estimate_confidence: "medium"
      },
      net_new_clean_public_estimate: 5000,
      candidate_pool_exhausted: false,
      estimate_confidence: "medium"
    }
  }));
  assert.equal(result.ok, true);
});

test("release check fails without bounded outbox/upsert status", () => {
  const result = evaluateReleaseCheck(basePayload({
    sourceReport: { bounded_outbox_or_upsert_status: undefined }
  }));
  assert.equal(result.ok, false);
  assert.ok(result.failures.some((failure) => failure.code === "bounded_outbox_or_upsert_status_missing"));
});

test("release check fails when bounded outbox/upsert status is not ok", () => {
  const result = evaluateReleaseCheck(basePayload({
    sourceReport: { bounded_outbox_or_upsert_status: "failed" }
  }));
  assert.equal(result.ok, false);
  assert.ok(result.failures.some((failure) => failure.code === "bounded_outbox_or_upsert_status_not_ok"));
});

test("release check fails without planned tenant batch proof", () => {
  const result = evaluateReleaseCheck(basePayload({
    sourceReport: { planned_tenant_batch_file_path: undefined }
  }));
  assert.equal(result.ok, false);
  assert.ok(result.failures.some((failure) => failure.code === "missing_or_failed_planned_tenant_batch_report"));
});

test("release check accepts planned batch report alias with predicted guard result", () => {
  const result = evaluateReleaseCheck(basePayload({
    sourceReport: {
      planned_tenant_batch_file_path: undefined,
      predicted_guard_result: undefined,
      planned_batch_report: {
        path: "reports/lever-plan.json",
        selected_plan: { predicted_guard_result: "pass" }
      }
    }
  }));
  assert.equal(result.ok, true);
  assert.equal(result.metrics.predicted_guard_result, "pass");
});

test("release check fails when planned batch predicted guard does not pass", () => {
  const result = evaluateReleaseCheck(basePayload({
    sourceReport: { predicted_guard_result: "fail" }
  }));
  assert.equal(result.ok, false);
  assert.ok(result.failures.some((failure) => failure.code === "predicted_guard_result_not_pass"));
});

test("release check fails without audited rollback command", () => {
  const result = evaluateReleaseCheck(basePayload({
    sourceReport: { rollback_command: undefined }
  }));
  assert.equal(result.ok, false);
  assert.ok(result.failures.some((failure) => failure.code === "rollback_command_missing"));
});

test("release check fails when visible count decreases", () => {
  const result = evaluateReleaseCheck(basePayload({
    after: { summary: { total_visible_postings: 99 } }
  }));
  assert.equal(result.ok, false);
  assert.ok(result.failures.some((failure) => failure.code === "visible_count_decreased"));
});

test("release check fails when accepted public rows do not increase", () => {
  const result = evaluateReleaseCheck(basePayload({
    sourceReport: {
      accepted_public_rows_before: 30,
      accepted_public_rows_after: 30,
      public_row_gain: 0,
      rows_newly_accepted: 0
    }
  }));
  assert.equal(result.ok, false);
  assert.ok(result.failures.some((failure) => failure.code === "accepted_public_rows_not_increased"));
});

test("release check fails on missing-any-geo percentage regression", () => {
  const result = evaluateReleaseCheck(basePayload({
    after: { summary: { missing_any_normalized_geo_pct: 13 } }
  }));
  assert.equal(result.ok, false);
  assert.ok(result.failures.some((failure) => failure.code === "global_missing_any_geo_pct_increased"));
});

test("release check fails on weak/unknown remote percentage regression", () => {
  const result = evaluateReleaseCheck(basePayload({
    after: { summary: { weak_unknown_remote_type_pct: 9 } }
  }));
  assert.equal(result.ok, false);
  assert.ok(result.failures.some((failure) => failure.code === "global_weak_unknown_remote_pct_increased"));
});

test("release check fails on missing all geo plus weak remote count increase", () => {
  const result = evaluateReleaseCheck(basePayload({
    after: { summary: { missing_all_geo_and_weak_remote_count: 3 } }
  }));
  assert.equal(result.ok, false);
  assert.ok(result.failures.some((failure) => failure.code === "missing_all_geo_and_weak_remote_count_increased"));
});

test("release check fails on new no_geo_no_remote accepted rows", () => {
  const result = evaluateReleaseCheck(basePayload({
    sourceReport: { rows_newly_accepted_no_geo_no_remote: 1 }
  }));
  assert.equal(result.ok, false);
  assert.ok(result.failures.some((failure) => failure.code === "new_no_geo_no_remote_accepted"));
});

test("release check fails on Meili/Postgres delta", () => {
  const result = evaluateReleaseCheck(basePayload({
    meiliCheck: { count_delta: 2 }
  }));
  assert.equal(result.ok, false);
  assert.ok(result.failures.some((failure) => failure.code === "meili_postgres_delta_nonzero"));
});

test("release check fails on Meili remote facet drift even when counts match", () => {
  const result = evaluateReleaseCheck(basePayload({
    meiliCheck: {
      count_delta: 0,
      remote_facet_delta: {
        onsite: { expected: 6, actual: 0, delta: 6 },
        unknown: { expected: 0, actual: 6, delta: -6 }
      }
    }
  }));
  assert.equal(result.ok, false);
  assert.ok(result.failures.some((failure) => failure.code === "meili_remote_facet_delta_nonzero"));
});

test("release check fails on sampled Meili document field drift", () => {
  const result = evaluateReleaseCheck(basePayload({
    meiliCheck: {
      count_delta: 0,
      sample_mismatches: [
        {
          canonical_url: "https://example.com/jobs/1",
          mismatches: [{ field: "remote_type", expected: "remote", actual: "unknown" }]
        }
      ],
      sample_mismatch_summary: { missing_documents: 0, field_mismatches: 1 }
    }
  }));
  assert.equal(result.ok, false);
  assert.ok(result.failures.some((failure) => failure.code === "meili_sample_mismatches_present"));
});

test("release check fails on Meili extra or missing document drift", () => {
  const result = evaluateReleaseCheck(basePayload({
    meiliCheck: {
      count_delta: 0,
      extra_meili_document_count: 1,
      missing_meili_document_count: 1
    }
  }));
  assert.equal(result.ok, false);
  assert.ok(result.failures.some((failure) => failure.code === "meili_extra_documents_present"));
  assert.ok(result.failures.some((failure) => failure.code === "meili_missing_documents_present"));
});

test("release check fails when guard fails", () => {
  const result = evaluateReleaseCheck(basePayload({
    guardReport: { ok: false, success: false, release_allowed: false }
  }));
  assert.equal(result.ok, false);
  assert.ok(result.failures.some((failure) => failure.code === "ats_recovery_guard_failed"));
});

test("release check fails when tests are undocumented", () => {
  const result = evaluateReleaseCheck(basePayload({ testsReport: {} }));
  assert.equal(result.ok, false);
  assert.ok(result.failures.some((failure) => failure.code === "tests_not_passed"));
});

test("release check fails when preflight is unsafe", () => {
  const result = evaluateReleaseCheck(basePayload({
    preflightReport: { ok: false, unsafe: true }
  }));
  assert.equal(result.ok, false);
  assert.ok(result.failures.some((failure) => failure.code === "preflight_unsafe_or_undocumented"));
});

test("release check fails when preflight lacks backup file proof", () => {
  const payload = selfTestPayload();
  const result = evaluateReleaseCheck(basePayload({
    preflightReport: {
      ...payload.preflightReport,
      checks: {
        ...payload.preflightReport.checks,
        backup_file_exists: false,
        backup_size_bytes: null
      }
    }
  }));
  assert.equal(result.ok, false);
  const failure = result.failures.find((item) => item.code === "preflight_unsafe_or_undocumented");
  assert.ok(failure);
  assert.ok(failure.reasons.includes("preflight_backup_file_missing"));
  assert.ok(failure.reasons.includes("preflight_backup_file_empty"));
});

test("release check fails when preflight lacks generated timestamp", () => {
  const payload = selfTestPayload();
  const result = evaluateReleaseCheck(basePayload({
    preflightReport: {
      ...payload.preflightReport,
      generated_at: ""
    }
  }));
  assert.equal(result.ok, false);
  const failure = result.failures.find((item) => item.code === "preflight_unsafe_or_undocumented");
  assert.ok(failure.reasons.includes("preflight_generated_at_missing"));
});

test("release check fails when preflight search state is undocumented", () => {
  const payload = selfTestPayload();
  const result = evaluateReleaseCheck(basePayload({
    preflightReport: {
      ...payload.preflightReport,
      checks: {
        ...payload.preflightReport.checks,
        long_running_postgres_queries: null,
        meili_postgres_delta: null
      }
    }
  }));
  assert.equal(result.ok, false);
  const failure = result.failures.find((item) => item.code === "preflight_unsafe_or_undocumented");
  assert.ok(failure.reasons.includes("preflight_long_running_queries_missing"));
  assert.ok(failure.reasons.includes("preflight_meili_postgres_delta_nonzero"));
});

test("release check fails when preflight production commit mismatches expected commit", () => {
  const payload = selfTestPayload();
  const result = evaluateReleaseCheck(basePayload({
    preflightReport: {
      ...payload.preflightReport,
      checks: {
        ...payload.preflightReport.checks,
        production_checkout_commit: "different-prod-sha"
      }
    }
  }));
  assert.equal(result.ok, false);
  const failure = result.failures.find((item) => item.code === "preflight_unsafe_or_undocumented");
  assert.ok(failure.reasons.includes("preflight_production_commit_mismatch"));
});

console.log("release ats recovery check tests passed");
