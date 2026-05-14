const assert = require("node:assert/strict");
const test = require("node:test");
const { evaluatePreflight, selfTestReport } = require("./ats-recovery-preflight");

function report(overrides = {}) {
  return { ...selfTestReport(), ...overrides };
}

test("preflight passes for safe stopped-worker state", () => {
  const result = evaluatePreflight(report(), { expectedCommit: "abcdef1234567890" });
  assert.equal(result.ok, true);
  assert.deepEqual(result.failures, []);
});

test("preflight fails when expected commit is missing", () => {
  const input = report();
  delete input.expected_commit;
  const result = evaluatePreflight(input, {});
  assert.equal(result.ok, false);
  assert.ok(result.failures.some((failure) => failure.code === "expected_commit_missing"));
});

test("preflight fails when production commit mismatches expected commit", () => {
  const result = evaluatePreflight(report({ production_checkout_commit: "111111111111" }), {
    expectedCommit: "abcdef1234567890"
  });
  assert.equal(result.ok, false);
  assert.ok(result.failures.some((failure) => failure.code === "production_commit_mismatch"));
});

test("preflight fails when worker is running and not isolated", () => {
  const result = evaluatePreflight(report({ worker_state: "running" }), { expectedCommit: "abcdef1234567890" });
  assert.equal(result.ok, false);
  assert.ok(result.failures.some((failure) => failure.code === "worker_not_isolated"));
});

test("preflight passes when worker is running but explicitly isolated", () => {
  const result = evaluatePreflight(report({ worker_state: "running", worker_isolated: true }), {
    expectedCommit: "abcdef1234567890"
  });
  assert.equal(result.ok, true);
});

test("preflight fails when autodeploy timer is active", () => {
  const result = evaluatePreflight(report({ autodeploy_timer_state: "active" }), {
    expectedCommit: "abcdef1234567890"
  });
  assert.equal(result.ok, false);
  assert.ok(result.failures.some((failure) => failure.code === "autodeploy_timer_unsafe"));
});

test("preflight fails when heavy-job lock is active", () => {
  const result = evaluatePreflight(report({ heavy_job_active: true }), {
    expectedCommit: "abcdef1234567890"
  });
  assert.equal(result.ok, false);
  assert.ok(result.failures.some((failure) => failure.code === "heavy_job_lock_active"));
});

test("preflight fails when long-running Postgres queries are active", () => {
  const result = evaluatePreflight(report({ long_running_postgres_queries: 1 }), {
    expectedCommit: "abcdef1234567890",
    maxLongRunningQueries: 0
  });
  assert.equal(result.ok, false);
  assert.ok(result.failures.some((failure) => failure.code === "long_running_postgres_queries_active"));
});

test("preflight fails when Meili/Postgres delta is nonzero", () => {
  const result = evaluatePreflight(report({ meili_postgres_delta: -1 }), {
    expectedCommit: "abcdef1234567890"
  });
  assert.equal(result.ok, false);
  assert.ok(result.failures.some((failure) => failure.code === "meili_postgres_delta_nonzero"));
});

test("preflight fails when backup path is missing", () => {
  const result = evaluatePreflight(report({ backup_path: "", backup_parent_exists: false }), {
    expectedCommit: "abcdef1234567890"
  });
  assert.equal(result.ok, false);
  assert.ok(result.failures.some((failure) => failure.code === "backup_path_missing"));
});

console.log("ats recovery preflight tests passed");
