const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const {
  attachBacklogDiagnostics,
  buildWorkerBacklogQuery,
  parseBacklogArgs,
  runPostgresBacklogAudit,
  summarizeBacklogRows
} = require("./audit-worker-backlog");

test("parseBacklogArgs accepts read-only backlog controls", () => {
  const options = parseBacklogArgs(["--json", "--limit", "5", "--now-epoch=1800000000", "--output=C:\\tmp\\backlog.json"]);
  assert.equal(options.json, true);
  assert.equal(options.limit, 5);
  assert.equal(options.nowEpoch, 1_800_000_000);
  assert.equal(options.output, "C:\\tmp\\backlog.json");
});

test("parseBacklogArgs accepts diagnostics, target ATS list, and error window", () => {
  const options = parseBacklogArgs([
    "--json",
    "--diagnostics",
    "--targets=applytojob,breezy,icims",
    "--error-window-hours=48"
  ]);

  assert.equal(options.json, true);
  assert.equal(options.diagnostics, true);
  assert.deepEqual(options.targetAtsKeys, ["applytojob", "breezy", "icims"]);
  assert.equal(options.errorWindowHours, 48);
});

test("buildWorkerBacklogQuery is read-only and reports due source fields", () => {
  const query = buildWorkerBacklogQuery({ nowEpoch: 1_800_000_000, limit: 10 });
  assert.deepEqual(query.values, [1_800_000_000, 10]);
  assert.match(query.sql, /WITH target_state AS/i);
  assert.match(query.sql, /due_count/i);
  assert.match(query.sql, /runnable_due_count/i);
  assert.doesNotMatch(query.sql, /\b(INSERT|UPDATE|DELETE|TRUNCATE|DROP|ALTER|CREATE)\b/i);
});

test("summarizeBacklogRows explains protection-state impact and budget projection", () => {
  const report = summarizeBacklogRows(
    [
      {
        ats_key: "bamboohr",
        display_name: "BambooHR",
        enabled: true,
        protection_status: "normal",
        target_count: 12,
        due_count: 8,
        runnable_due_count: 8,
        oldest_due_epoch: 100,
        failure_pressure: 2,
        failing_due_count: 1,
        last_success_epoch: 200,
        last_failure_epoch: 300
      },
      {
        ats_key: "applitrack",
        enabled: true,
        protection_status: "quarantine_only",
        target_count: 9,
        due_count: 6,
        runnable_due_count: 6,
        oldest_due_epoch: 50,
        failure_pressure: 4,
        failing_due_count: 2,
        last_success_epoch: 150,
        last_failure_epoch: 250
      },
      {
        ats_key: "icims",
        enabled: false,
        protection_status: "auto_disabled",
        target_count: 7,
        due_count: 7,
        runnable_due_count: 0,
        oldest_due_epoch: 25,
        failure_pressure: 10,
        failing_due_count: 7,
        last_success_epoch: 0,
        last_failure_epoch: 125
      }
    ],
    {
      autoSyncDailyTargetBudget: 10,
      autoSyncTargetsPerRun: 5,
      sourceDailyTargetBudget: 4
    }
  );

  assert.equal(report.totals.due_count, 21);
  assert.equal(report.totals.runnable_due_count, 14);
  assert.equal(report.totals.quarantine_only_due_count, 6);
  assert.equal(report.totals.auto_disabled_due_count, 7);
  assert.equal(report.totals.disabled_due_count, 7);
  assert.equal(report.totals.oldest_due_epoch, 25);
  assert.equal(report.totals.by_protection_status.normal, 8);
  assert.deepEqual(report.due_by_source, { bamboohr: 8, applitrack: 6, icims: 7 });
  assert.deepEqual(report.oldest_due_by_source, { bamboohr: 100, applitrack: 50, icims: 25 });
  assert.deepEqual(report.failure_pressure_by_source, { bamboohr: 2, applitrack: 4, icims: 10 });
  assert.equal(report.quarantine_only_impact.source_count, 1);
  assert.equal(report.quarantine_only_impact.due_count, 6);
  assert.equal(report.auto_disabled_impact.source_count, 1);
  assert.equal(report.auto_disabled_impact.due_count, 7);
  assert.equal(report.daily_budget_projection.source_budget_limited_due_count, 8);
  assert.equal(report.daily_budget_projection.estimated_auto_runs_to_clear, 3);
  assert.equal(report.daily_budget_projection.estimated_days_to_clear, 2);
  assert.equal(report.estimated_days_by_budget["10"], 2);
  assert.equal(report.items[0].last_success_at, "1970-01-01T00:03:20.000Z");
  assert.equal(report.items[0].last_failure_at, "1970-01-01T00:05:00.000Z");
});

test("runPostgresBacklogAudit performs one read-only query", async () => {
  const calls = [];
  const pool = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      assert.doesNotMatch(sql, /\b(INSERT|UPDATE|DELETE|TRUNCATE|DROP|ALTER|CREATE)\b/i);
      return {
        rows: [
          {
            ats_key: "applytojob",
            display_name: "ApplyToJob",
            enabled: true,
            protection_status: "normal",
            target_count: 5,
            due_count: 3,
            runnable_due_count: 3,
            oldest_due_epoch: 123,
            failure_pressure: 1,
            failing_due_count: 1
          }
        ]
      };
    }
  };

  const report = await runPostgresBacklogAudit(pool, {
    nowEpoch: 1_800_000_000,
    limit: 25,
    autoSyncDailyTargetBudget: 250,
    autoSyncTargetsPerRun: 50,
    sourceDailyTargetBudget: 100
  });
  assert.equal(calls.length, 1);
  assert.equal(report.ok, true);
  assert.equal(report.read_only, true);
  assert.equal(report.totals.due_count, 3);
  assert.equal(report.items[0].ats_key, "applytojob");
});

test("attachBacklogDiagnostics joins recent errors and fixture coverage without mutating totals", () => {
  const base = summarizeBacklogRows([
    {
      ats_key: "applytojob",
      display_name: "ApplyToJob",
      enabled: true,
      protection_status: "normal",
      target_count: 10,
      due_count: 8,
      runnable_due_count: 8,
      failure_pressure: 3,
      failing_due_count: 2
    },
    {
      ats_key: "applicantpro",
      display_name: "ApplicantPro",
      enabled: true,
      protection_status: "normal",
      target_count: 4,
      due_count: 4,
      runnable_due_count: 4,
      failure_pressure: 1,
      failing_due_count: 1
    }
  ]);
  const report = {
    ok: true,
    totals: base.totals,
    items: base.items
  };

  const withDiagnostics = attachBacklogDiagnostics(report, {
    repoRoot: path.resolve(__dirname, ".."),
    errorWindowHours: 24,
    recentErrorRows: [
      { ats_key: "applytojob", error_type: "parser_drift", count: 7 },
      { ats_key: "applytojob", error_type: "portal_search_empty", count: 2 },
      { ats_key: "applicantpro", error_type: "parser_drift", count: 1 }
    ],
    targetAtsKeys: ["applytojob", "applicantpro", "workday"]
  });

  assert.equal(withDiagnostics.totals.due_count, report.totals.due_count);
  assert.deepEqual(withDiagnostics.diagnostics.target_ats_keys, ["applytojob", "applicantpro", "workday"]);
  assert.equal(withDiagnostics.diagnostics.error_window_hours, 24);

  const applytojob = withDiagnostics.items.find((item) => item.ats_key === "applytojob");
  assert.equal(applytojob.recent_errors.total_count, 9);
  assert.equal(applytojob.recent_errors.parser_attention_count, 7);
  assert.equal(applytojob.recent_errors.source_policy_block_count, 0);
  assert.equal(applytojob.recent_errors.by_type.parser_drift, 7);
  assert.equal(applytojob.recent_errors.by_type.portal_search_empty, 2);
  assert.equal(applytojob.fixture_coverage.source_fixtures.list, true);
  assert.equal(applytojob.fixture_coverage.source_fixtures.expected_normalized, true);
  assert.equal(applytojob.fixture_coverage.source_fixtures.invalid_shapes, true);

  const applicantpro = withDiagnostics.items.find((item) => item.ats_key === "applicantpro");
  assert.equal(applicantpro.recent_errors.total_count, 1);
  assert.equal(applicantpro.fixture_coverage.source_fixture_dir, false);
  assert.equal(applicantpro.fixture_coverage.legacy_fixtures.direct, true);
});

test("attachBacklogDiagnostics keeps source policy blocks out of parser attention count", () => {
  const base = summarizeBacklogRows([
    {
      ats_key: "applitrack",
      enabled: true,
      protection_status: "quarantine_only",
      target_count: 4,
      due_count: 4,
      runnable_due_count: 4,
      failure_pressure: 2,
      failing_due_count: 2
    }
  ]);

  const withDiagnostics = attachBacklogDiagnostics(
    {
      ok: true,
      totals: base.totals,
      items: base.items
    },
    {
      errorWindowHours: 24,
      recentErrorRows: [
        { ats_key: "applitrack", error_type: "source_disabled_by_threshold", count: 11 },
        { ats_key: "applitrack", error_type: "source_quality", count: 5 },
        { ats_key: "applitrack", error_type: "parser_validation", count: 3 },
        { ats_key: "applitrack", error_type: "invalid_shape", count: 2 }
      ]
    }
  );

  const applitrack = withDiagnostics.items[0];
  assert.equal(applitrack.recent_errors.total_count, 21);
  assert.equal(applitrack.recent_errors.parser_attention_count, 5);
  assert.equal(applitrack.recent_errors.source_policy_block_count, 16);
  assert.deepEqual(withDiagnostics.diagnostics.error_taxonomy.parser_attention_types, [
    "parser_drift",
    "parser_validation",
    "invalid_shape"
  ]);
});
