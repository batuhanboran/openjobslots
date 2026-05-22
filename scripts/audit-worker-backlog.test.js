const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const {
  attachBacklogDiagnostics,
  buildAutoSyncBudgetUsageQuery,
  buildParserDriftRecheckQuery,
  buildRecentErrorsQuery,
  buildWorkerBacklogQuery,
  parseBacklogArgs,
  runPostgresBacklogAudit,
  summarizeAutoSyncBudgetUsage,
  summarizeParserDriftRecheck,
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

test("buildRecentErrorsQuery groups http status for failure taxonomy", () => {
  const query = buildRecentErrorsQuery({
    errorWindowHours: 48,
    targetAtsKeys: ["applytojob", "breezy"]
  });

  assert.deepEqual(query.values, [48, ["applytojob", "breezy"]]);
  assert.match(query.sql, /http_status/i);
  assert.match(query.sql, /GROUP BY ats_key, error_type, http_status/i);
  assert.doesNotMatch(query.sql, /\b(INSERT|UPDATE|DELETE|TRUNCATE|DROP|ALTER|CREATE)\b/i);
});

test("buildParserDriftRecheckQuery is read-only and bounded", () => {
  const query = buildParserDriftRecheckQuery({
    errorWindowHours: 48,
    targetAtsKeys: ["applytojob", "breezy"],
    parserDriftRecheckLimit: 25
  });

  assert.deepEqual(query.values, [48, ["applytojob", "breezy"], 25]);
  assert.match(query.sql, /FROM parser_drift_events/i);
  assert.match(query.sql, /LEFT JOIN source_payload_shapes/i);
  assert.match(query.sql, /LIMIT \$3/i);
  assert.doesNotMatch(query.sql, /\b(INSERT|UPDATE|DELETE|TRUNCATE|DROP|ALTER|CREATE)\b/i);
});

test("buildAutoSyncBudgetUsageQuery is read-only and uses UTC day start", () => {
  const query = buildAutoSyncBudgetUsageQuery({ nowEpoch: 1_800_086_400 });

  assert.deepEqual(query.values, [1_800_057_600]);
  assert.match(query.sql, /SUM\(total_targets\)/i);
  assert.match(query.sql, /FROM ingestion_runs/i);
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

test("summarizeBacklogRows uses live worker stage-1 defaults when audit env omits worker budget", () => {
  const report = summarizeBacklogRows(
    [
      {
        ats_key: "bamboohr",
        display_name: "BambooHR",
        enabled: true,
        protection_status: "normal",
        target_count: 5144,
        due_count: 4985,
        runnable_due_count: 4985
      }
    ],
    { env: {} }
  );

  assert.equal(report.daily_budget_projection.auto_sync_daily_target_budget, 2000);
  assert.equal(report.daily_budget_projection.auto_sync_targets_per_run, 50);
  assert.equal(report.daily_budget_projection.source_daily_target_budget, 200);
  assert.equal(report.daily_budget_projection.source_budget_limited_due_count, 200);
  assert.equal(report.daily_budget_projection.effective_daily_target_budget, 200);
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

test("runPostgresBacklogAudit diagnostics reports latest run success rate", async () => {
  const calls = [];
  const pool = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      assert.doesNotMatch(sql, /\b(INSERT|UPDATE|DELETE|TRUNCATE|DROP|ALTER|CREATE)\b/i);
      if (/FROM ats_sources/i.test(sql)) {
        return {
          rows: [
            {
              ats_key: "applytojob",
              display_name: "ApplyToJob",
              enabled: true,
              protection_status: "normal",
              target_count: 10,
              due_count: 8,
              runnable_due_count: 8
            }
          ]
        };
      }
      if (/FROM ingestion_run_errors/i.test(sql)) {
        return { rows: [{ ats_key: "applytojob", error_type: "fetch", http_status: 429, count: 3 }] };
      }
      if (/FROM ingestion_runs/i.test(sql)) {
        if (/SUM\(total_targets\)/i.test(sql)) {
          return { rows: [{ targets_started_today: 2000 }] };
        }
        return {
          rows: [
            {
              id: 211,
              status: "completed_with_errors",
              started_at_epoch: 1_800_000_000,
              finished_at_epoch: 1_800_000_060,
              total_targets: 25,
              success_count: 20,
              failure_count: 5
            }
          ]
        };
      }
      if (/FROM parser_drift_events/i.test(sql)) {
        return { rows: [] };
      }
      throw new Error(`unexpected query: ${sql}`);
    }
  };

  const report = await runPostgresBacklogAudit(pool, {
    diagnostics: true,
    nowEpoch: 1_800_000_100,
    limit: 10,
    errorWindowHours: 24
  });

  assert.equal(calls.length, 5);
  assert.equal(report.diagnostics.latest_run.latest_run_id, 211);
  assert.equal(report.diagnostics.latest_run.success_rate_pct, 80);
  assert.equal(report.diagnostics.latest_run.failure_rate_pct, 20);
  assert.equal(report.diagnostics.failure_reason_counts.rate_limit, 3);
  assert.equal(report.diagnostics.parser_drift_recheck.sample_count, 0);
  assert.equal(report.diagnostics.auto_sync_budget_usage.targets_started_today, 2000);
  assert.equal(report.diagnostics.auto_sync_budget_usage.remaining_daily_budget, 0);
  assert.equal(report.diagnostics.auto_sync_budget_usage.daily_budget_exhausted, true);
});

test("summarizeAutoSyncBudgetUsage explains consumed and remaining daily budget", () => {
  const summary = summarizeAutoSyncBudgetUsage(
    [{ targets_started_today: 1300 }],
    { nowEpoch: 1_800_086_400, autoSyncDailyTargetBudget: 2000 }
  );

  assert.equal(summary.utc_day_start_epoch, 1_800_057_600);
  assert.equal(summary.daily_budget, 2000);
  assert.equal(summary.targets_started_today, 1300);
  assert.equal(summary.remaining_daily_budget, 700);
  assert.equal(summary.daily_budget_exhausted, false);
});

test("summarizeParserDriftRecheck separates current-policy pass from real drift", () => {
  const report = summarizeParserDriftRecheck([
    {
      ats_key: "applytojob",
      stored_similarity: 0.3913,
      baseline_shape_paths: [
        "html:string",
        "__detailHtmlByUrl.first:string",
        "__detailStatusByUrl.first:number"
      ],
      observed_shape_paths: [
        "html:string",
        "__detailHtmlByUrl.second:string",
        "__detailStatusByUrl.second:number"
      ]
    },
    {
      ats_key: "breezy",
      stored_similarity: 0.25,
      baseline_shape_paths: ["html:string", "jobs[]:object", "jobs[].title:string"],
      observed_shape_paths: ["html:string", "paging:object"]
    },
    {
      ats_key: "breezy",
      stored_similarity: 0.1,
      baseline_shape_paths: [],
      observed_shape_paths: ["html:string"]
    }
  ], { parserDriftRecheckLimit: 50 });

  assert.equal(report.sample_limit, 50);
  assert.equal(report.sample_count, 3);
  assert.equal(report.current_policy_pass_count, 1);
  assert.equal(report.still_drift_count, 1);
  assert.equal(report.skipped_no_baseline_count, 1);
  assert.equal(report.by_source.applytojob.current_policy_pass_count, 1);
  assert.equal(report.by_source.breezy.still_drift_count, 1);
  assert.equal(report.by_source.breezy.skipped_no_baseline_count, 1);
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

test("attachBacklogDiagnostics maps raw worker errors into operator failure buckets", () => {
  const base = summarizeBacklogRows([
    {
      ats_key: "applytojob",
      enabled: true,
      protection_status: "normal",
      target_count: 10,
      due_count: 8,
      runnable_due_count: 8
    },
    {
      ats_key: "breezy",
      enabled: true,
      protection_status: "normal",
      target_count: 8,
      due_count: 6,
      runnable_due_count: 6
    },
    {
      ats_key: "applitrack",
      enabled: true,
      protection_status: "quarantine_only",
      target_count: 4,
      due_count: 4,
      runnable_due_count: 4
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
        { ats_key: "applytojob", error_type: "parser_drift", count: 7 },
        { ats_key: "applytojob", error_type: "portal_search_empty", count: 2 },
        { ats_key: "applytojob", error_type: "fetch", http_status: 429, count: 3 },
        { ats_key: "applytojob", error_type: "fetch", http_status: 0, count: 4 },
        { ats_key: "breezy", error_type: "blocked_or_rate_limited", http_status: 403, count: 1 },
        { ats_key: "breezy", error_type: "output_empty", count: 5 },
        { ats_key: "applitrack", error_type: "source_quality", count: 8 }
      ]
    }
  );

  const applytojob = withDiagnostics.items.find((item) => item.ats_key === "applytojob");
  assert.equal(applytojob.recent_errors.parser_bug_count, 7);
  assert.equal(applytojob.recent_errors.rate_limit_count, 3);
  assert.equal(applytojob.recent_errors.network_count, 4);
  assert.equal(applytojob.recent_errors.empty_no_jobs_count, 2);
  assert.deepEqual(applytojob.recent_errors.by_reason, {
    parser_bug: 7,
    empty_no_jobs: 2,
    rate_limit: 3,
    network: 4
  });

  const breezy = withDiagnostics.items.find((item) => item.ats_key === "breezy");
  assert.equal(breezy.recent_errors.rate_limit_count, 1);
  assert.equal(breezy.recent_errors.empty_no_jobs_count, 5);

  assert.equal(withDiagnostics.diagnostics.failure_reason_counts.parser_bug, 7);
  assert.equal(withDiagnostics.diagnostics.failure_reason_counts.source_quality, 8);
  assert.equal(withDiagnostics.diagnostics.failure_reason_counts.rate_limit, 4);
  assert.equal(withDiagnostics.diagnostics.failure_reason_counts.network, 4);
  assert.equal(withDiagnostics.diagnostics.failure_reason_counts.empty_no_jobs, 7);
  assert.deepEqual(withDiagnostics.diagnostics.error_taxonomy.failure_reason_buckets, [
    "parser_bug",
    "source_quality",
    "rate_limit",
    "network",
    "empty_no_jobs",
    "auth",
    "unknown"
  ]);
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
