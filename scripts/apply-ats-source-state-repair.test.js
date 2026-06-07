const assert = require("node:assert");
const test = require("node:test");

const {
  evaluateExecutionGate,
  parseArgs,
  preflightReportStatus,
  runRepair,
  selectActions
} = require("./apply-ats-source-state-repair");

function samplePlan() {
  return {
    ok: true,
    read_only: true,
    plan_hash: "abc123",
    targets: [
      {
        ats_key: "personio",
        actions: [
          {
            type: "seed_source_row",
            ats_key: "personio",
            display_name: "Personio",
            status: "approval_gated",
            desired_state: {
              enabled: false,
              protection_status: "canary_only",
              disabled_reason: "pending bounded canary proof"
            },
            sql_preview: ["INSERT INTO ats_sources ..."]
          }
        ]
      },
      {
        ats_key: "workday",
        actions: [
          {
            type: "reset_source_protection_to_canary",
            ats_key: "workday",
            status: "approval_gated",
            desired_state: {
              enabled: false,
              protection_status: "canary_only",
              disabled_reason: "pending bounded canary proof"
            },
            sql_preview: ["UPDATE ats_sources ..."]
          }
        ]
      },
      {
        ats_key: "adp_workforcenow",
        actions: [
          {
            type: "canonicalize_legacy_alias",
            ats_key: "adp_workforcenow",
            status: "manual_conflict_review_required",
            legacy_alias_rows: ["adpworkforcenow"],
            tables_to_review: ["companies", "postings"],
            sql_preview: ["UPDATE companies ..."]
          }
        ]
      }
    ]
  };
}

function safePreflight() {
  return {
    ok: true,
    unsafe: false,
    generated_at: new Date().toISOString(),
    checks: {
      production_checkout_commit: "abcdef123456",
      expected_commit: "abcdef123456",
      worker_state: "stopped",
      worker_isolated: false,
      autodeploy_timer_state: "inactive",
      autodeploy_recovery_safe: false,
      heavy_job_active: false,
      long_running_postgres_queries: 0,
      meili_postgres_delta: 0,
      backup_path: "/app/backups/postgres-openjobslots-pre-source-state-repair.dump",
      backup_file_exists: true,
      backup_size_bytes: 1024
    },
    failures: []
  };
}

function makePool() {
  const queries = [];
  return {
    queries,
    async query(sql, params = []) {
      queries.push({ sql: String(sql), params });
      return { rowCount: /RETURNING ats_key/i.test(String(sql)) ? 1 : 0, rows: [] };
    }
  };
}

function safeAliasConflictReport() {
  return {
    ok: true,
    read_only: true,
    generated_at: new Date().toISOString(),
    plan_hash: "abc123",
    conflict_count: 0,
    safe_to_canonicalize_without_merge: true,
    reports: [
      {
        ats_key: "adp_workforcenow",
        legacy_alias_rows: ["adpworkforcenow"],
        conflict_count: 0
      }
    ]
  };
}

function mergeAliasConflictReport() {
  return {
    ...safeAliasConflictReport(),
    ok: false,
    conflict_count: 1,
    safe_to_canonicalize_without_merge: false,
    reports: [
      {
        ats_key: "adp_workforcenow",
        legacy_alias_rows: ["adpworkforcenow"],
        conflict_count: 1,
        tables: [
          { table: "company_sync_state", conflict_count: 1 }
        ]
      }
    ]
  };
}

test("parseArgs keeps source-state repair dry-run by default", () => {
  const options = parseArgs(["--source=personio,workable", "--action=seed_source_row", "--json"]);
  assert.equal(options.execute, false);
  assert.deepEqual(options.sourceFilters, ["personio", "workable"]);
  assert.deepEqual(options.actionTypes, ["seed_source_row"]);
  assert.equal(options.json, true);
});

test("preflightReportStatus requires backup, worker isolation, and Meili parity proof", () => {
  const status = preflightReportStatus(safePreflight(), { preflightMaxAgeMinutes: 60 });
  assert.equal(status.ok, true);

  const unsafe = safePreflight();
  unsafe.checks.meili_postgres_delta = 6;
  unsafe.checks.backup_file_exists = false;
  const unsafeStatus = preflightReportStatus(unsafe, { preflightMaxAgeMinutes: 60 });
  assert.equal(unsafeStatus.ok, false);
  assert.ok(unsafeStatus.failures.includes("preflight_meili_postgres_delta_nonzero"));
  assert.ok(unsafeStatus.failures.includes("preflight_backup_file_missing"));
});

test("evaluateExecutionGate blocks production execution without explicit proof", () => {
  const plan = samplePlan();
  const actions = selectActions(plan, parseArgs(["--source=personio"]));
  const safety = evaluateExecutionGate(plan, actions, parseArgs(["--execute", "--source=personio"]), null);
  assert.equal(safety.operation_authorized, false);
  assert.ok(safety.failures.includes("--confirm-production"));
  assert.ok(safety.failures.includes("--expected-plan-hash=<hash>"));
  assert.ok(safety.failures.includes("--preflight-report=<report>"));
});

test("runRepair dry-run exposes selected SQL preview without touching pool", async () => {
  const pool = makePool();
  const report = await runRepair({
    plan: samplePlan(),
    options: parseArgs(["--source=personio", "--json"]),
    pool,
    ensureSchema: async () => {}
  });
  assert.equal(report.ok, true);
  assert.equal(report.dry_run, true);
  assert.equal(report.selected_action_count, 1);
  assert.equal(pool.queries.length, 0);
});

test("runRepair executes mechanical seed and reset actions inside one transaction", async () => {
  const pool = makePool();
  const report = await runRepair({
    plan: samplePlan(),
    options: parseArgs([
      "--execute",
      "--confirm-production",
      "--expected-plan-hash=abc123",
      "--source=personio,workday"
    ]),
    preflightReport: safePreflight(),
    pool,
    ensureSchema: async () => {}
  });
  assert.equal(report.ok, true);
  assert.equal(report.dry_run, false);
  assert.equal(report.applied_action_count, 2);
  assert.match(pool.queries[0].sql, /BEGIN/);
  assert.match(pool.queries.at(-1).sql, /COMMIT/);
  assert.ok(pool.queries.some((query) => /INSERT INTO ats_sources/i.test(query.sql)));
  assert.ok(pool.queries.some((query) => /UPDATE ats_sources/i.test(query.sql)));
});

test("runRepair blocks ADP alias canonicalization unless conflict review is explicit", async () => {
  const pool = makePool();
  const report = await runRepair({
    plan: samplePlan(),
    options: parseArgs([
      "--execute",
      "--confirm-production",
      "--expected-plan-hash=abc123",
      "--source=adp_workforcenow"
    ]),
    preflightReport: safePreflight(),
    pool,
    ensureSchema: async () => {}
  });
  assert.equal(report.ok, false);
  assert.equal(report.dry_run, true);
  assert.ok(report.safety.failures.includes("--allow-alias-canonicalization"));
  assert.ok(report.safety.failures.includes("--alias-conflict-reviewed"));
  assert.ok(report.safety.failures.includes("--alias-conflict-report=<report>"));
  assert.ok(report.safety.failures.includes("alias_conflict_report_missing"));
  assert.equal(pool.queries.length, 0);
});

test("runRepair executes alias canonicalization only with conflict report proof", async () => {
  const pool = makePool();
  const report = await runRepair({
    plan: samplePlan(),
    options: parseArgs([
      "--execute",
      "--confirm-production",
      "--expected-plan-hash=abc123",
      "--source=adp_workforcenow",
      "--allow-alias-canonicalization",
      "--alias-conflict-reviewed",
      "--alias-conflict-report=alias.json"
    ]),
    preflightReport: safePreflight(),
    aliasConflictReport: safeAliasConflictReport(),
    pool,
    ensureSchema: async () => {}
  });
  assert.equal(report.ok, true);
  assert.equal(report.dry_run, false);
  assert.equal(report.applied_action_count, 1);
  assert.ok(pool.queries.some((query) => /UPDATE companies SET ats_key/i.test(query.sql)));
});

test("runRepair allows supported company_sync_state alias conflict merge with explicit proof", async () => {
  const pool = makePool();
  const report = await runRepair({
    plan: samplePlan(),
    options: parseArgs([
      "--execute",
      "--confirm-production",
      "--expected-plan-hash=abc123",
      "--source=adp_workforcenow",
      "--allow-alias-canonicalization",
      "--alias-conflict-reviewed",
      "--allow-alias-conflict-merge",
      "--alias-conflict-report=alias.json"
    ]),
    preflightReport: safePreflight(),
    aliasConflictReport: mergeAliasConflictReport(),
    pool,
    ensureSchema: async () => {}
  });
  assert.equal(report.ok, true);
  assert.equal(report.safety.alias_conflict_status.conflict_merge_allowed, true);
  assert.ok(pool.queries.some((query) => /UPDATE company_sync_state canonical/i.test(query.sql)));
  assert.ok(pool.queries.some((query) => /DELETE FROM company_sync_state legacy/i.test(query.sql)));
});
