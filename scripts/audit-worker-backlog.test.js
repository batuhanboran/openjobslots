const test = require("node:test");
const assert = require("node:assert/strict");
const {
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
        failing_due_count: 1
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
        failing_due_count: 2
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
        failing_due_count: 7
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
  assert.equal(report.daily_budget_projection.source_budget_limited_due_count, 8);
  assert.equal(report.daily_budget_projection.estimated_auto_runs_to_clear, 3);
  assert.equal(report.daily_budget_projection.estimated_days_to_clear, 2);
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
