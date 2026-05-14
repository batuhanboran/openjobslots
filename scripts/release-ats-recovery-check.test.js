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

console.log("release ats recovery check tests passed");
