const assert = require("node:assert/strict");
const test = require("node:test");
const {
  normalizeTenantForPlan,
  selectGuardSafeBatch
} = require("../server/ingestion/tenantBatchPlanner");

function baseline(overrides = {}) {
  return {
    global_visible_count: 1000,
    global_missing_any_geo_count: 100,
    global_missing_any_geo_pct: 10,
    global_weak_unknown_remote_count: 50,
    global_weak_unknown_remote_pct: 5,
    source_visible_count: 100,
    source_missing_any_geo_count: 10,
    source_missing_any_geo_pct: 10,
    source_weak_unknown_remote_count: 5,
    source_weak_unknown_remote_pct: 5,
    ...overrides
  };
}

function tenant(overrides = {}) {
  return {
    source: "applytojob",
    tenant_key: overrides.tenant_key || "tenant-a",
    tenant_host: overrides.tenant_host || "tenant-a.applytojob.com",
    company: overrides.company || "Tenant A",
    target_url: overrides.target_url || "https://tenant-a.applytojob.com/jobs",
    rows_fetched: 1,
    rows_parsed: 100,
    net_new_clean_public_candidates: 100,
    duplicate_existing_public_rows: 0,
    quarantine_candidates: 0,
    no_geo_no_remote_count: 0,
    missing_any_geo_count: 0,
    weak_unknown_remote_count: 0,
    ...overrides
  };
}

test("tenant batch planner excludes tenant that increases missing-any-geo", () => {
  const plan = normalizeTenantForPlan(tenant({
    net_new_clean_public_candidates: 100,
    missing_any_geo_count: 100
  }), baseline());
  assert.equal(plan.predicted_guard_result, "fail");
  assert.ok(plan.fail_reasons.includes("global_missing_any_geo_pct_would_increase"));
  assert.ok(plan.fail_reasons.includes("source_missing_any_geo_pct_would_increase"));
});

test("tenant batch planner excludes tenant with no_geo_no_remote", () => {
  const plan = normalizeTenantForPlan(tenant({
    no_geo_no_remote_count: 1
  }), baseline());
  assert.equal(plan.predicted_guard_result, "fail");
  assert.ok(plan.fail_reasons.includes("new_no_geo_no_remote_candidates"));
});

test("tenant batch planner chooses guard-safe tenants", () => {
  const base = baseline();
  const plans = [
    normalizeTenantForPlan(tenant({ tenant_key: "unsafe", missing_any_geo_count: 100 }), base),
    normalizeTenantForPlan(tenant({ tenant_key: "safe-1", net_new_clean_public_candidates: 80 }), base),
    normalizeTenantForPlan(tenant({ tenant_key: "safe-2", net_new_clean_public_candidates: 40 }), base)
  ];
  const selected = selectGuardSafeBatch(base, plans, 100);
  assert.equal(selected.predicted_guard_result, "pass");
  assert.equal(selected.cumulative_net_new_clean_public_candidates, 120);
  assert.deepEqual(selected.selected_tenants.map((item) => item.tenant_key), ["safe-1", "safe-2"]);
});

test("tenant batch planner proves no-qualified-batch when none pass", () => {
  const base = baseline();
  const plans = [
    normalizeTenantForPlan(tenant({ tenant_key: "bad-geo", missing_any_geo_count: 100 }), base),
    normalizeTenantForPlan(tenant({ tenant_key: "bad-remote", weak_unknown_remote_count: 100 }), base)
  ];
  const selected = selectGuardSafeBatch(base, plans, 100);
  assert.equal(selected.predicted_guard_result, "fail");
  assert.equal(selected.selected_tenant_count, 0);
  assert.ok(selected.fail_reasons.includes("insufficient_guard_safe_tenant_rows"));
});

console.log("ats plan batches tests passed");
