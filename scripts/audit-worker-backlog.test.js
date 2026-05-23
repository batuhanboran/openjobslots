const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const {
  attachBacklogDiagnostics,
  buildAutoSyncBudgetUsageQuery,
  buildLatestRunFailureReasonsQuery,
  buildLatestRunBySourceQuery,
  buildParserDriftRecheckQuery,
  buildRecentErrorsQuery,
  buildSourceBudgetUsageQuery,
  buildTargetFailurePressureQuery,
  buildThroughputScalingGate,
  buildWorkerBacklogQuery,
  parseBacklogArgs,
  runPostgresBacklogAudit,
  summarizeAutoSyncBudgetUsage,
  summarizeLatestRunBySourceRows,
  summarizeSourceBudgetUsageRows,
  summarizeTargetFailurePressureRows,
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
  assert.deepEqual(query.values, [1_800_000_000, 10, []]);
  assert.match(query.sql, /WITH target_state AS/i);
  assert.match(query.sql, /due_count/i);
  assert.match(query.sql, /runnable_due_count/i);
  assert.doesNotMatch(query.sql, /\b(INSERT|UPDATE|DELETE|TRUNCATE|DROP|ALTER|CREATE)\b/i);
});

test("buildWorkerBacklogQuery applies target ATS filter to top-level backlog", () => {
  const query = buildWorkerBacklogQuery({
    nowEpoch: 1_800_000_000,
    limit: 10,
    targetAtsKeys: ["recruitcrm"]
  });

  assert.deepEqual(query.values, [1_800_000_000, 10, ["recruitcrm"]]);
  assert.match(query.sql, /cardinality\(\$3::text\[\]\) = 0/i);
  assert.match(query.sql, /s\.ats_key = ANY\(\$3::text\[\]\)/i);
  assert.doesNotMatch(query.sql, /\b(INSERT|UPDATE|DELETE|TRUNCATE|DROP|ALTER|CREATE)\b/i);
});

test("buildRecentErrorsQuery groups http status for failure taxonomy", () => {
  const query = buildRecentErrorsQuery({
    errorWindowHours: 48,
    targetAtsKeys: ["applytojob", "breezy"]
  });

  assert.deepEqual(query.values, [48, ["applytojob", "breezy"]]);
  assert.match(query.sql, /http_status/i);
  assert.match(query.sql, /error_message/i);
  assert.match(query.sql, /GROUP BY ats_key, error_type, http_status, error_message/i);
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

test("buildLatestRunBySourceQuery compares latest-run successes and failures by ATS", () => {
  const query = buildLatestRunBySourceQuery({
    targetAtsKeys: ["applytojob", "breezy"]
  });

  assert.deepEqual(query.values, [["applytojob", "breezy"]]);
  assert.match(query.sql, /WITH latest AS/i);
  assert.match(query.sql, /FROM company_sync_state/i);
  assert.match(query.sql, /FROM ingestion_run_errors/i);
  assert.match(query.sql, /COUNT\(DISTINCT COALESCE\(NULLIF\(e\.company_url, ''\), e\.id::text\)\)::int AS failure_count/i);
  assert.match(query.sql, /last_success_epoch >= l\.started_at_epoch/i);
  assert.match(query.sql, /e\.run_id = l\.id/i);
  assert.doesNotMatch(query.sql, /\b(INSERT|UPDATE|DELETE|TRUNCATE|DROP|ALTER|CREATE)\b/i);
});

test("buildLatestRunFailureReasonsQuery groups only the latest run by source", () => {
  const query = buildLatestRunFailureReasonsQuery({
    targetAtsKeys: ["applytojob", "breezy"]
  });

  assert.deepEqual(query.values, [["applytojob", "breezy"]]);
  assert.match(query.sql, /WITH latest AS/i);
  assert.match(query.sql, /FROM ingestion_run_errors/i);
  assert.match(query.sql, /e\.run_id = l\.id/i);
  assert.match(query.sql, /error_message/i);
  assert.match(query.sql, /GROUP BY e\.ats_key, e\.error_type, COALESCE\(e\.http_status, 0\), e\.error_message/i);
  assert.doesNotMatch(query.sql, /\b(INSERT|UPDATE|DELETE|TRUNCATE|DROP|ALTER|CREATE)\b/i);
});

test("buildSourceBudgetUsageQuery mirrors worker source budget accounting", () => {
  const query = buildSourceBudgetUsageQuery({ nowEpoch: 1_800_086_400 });

  assert.deepEqual(query.values, [1_800_057_600]);
  assert.match(query.sql, /FROM company_sync_state/i);
  assert.match(query.sql, /last_success_epoch >= \$1/i);
  assert.match(query.sql, /GROUP BY ats_key/i);
  assert.doesNotMatch(query.sql, /\b(INSERT|UPDATE|DELETE|TRUNCATE|DROP|ALTER|CREATE)\b/i);
});

test("buildTargetFailurePressureQuery is read-only and bounded by due targets", () => {
  const query = buildTargetFailurePressureQuery({
    nowEpoch: 1_800_086_400,
    errorWindowHours: 48,
    targetAtsKeys: ["applytojob", "breezy"],
    limit: 15
  });

  assert.deepEqual(query.values, [1_800_086_400, 48, ["applytojob", "breezy"], 15]);
  assert.match(query.sql, /WITH due_targets AS/i);
  assert.match(query.sql, /JOIN company_sync_state/i);
  assert.match(query.sql, /FROM ingestion_run_errors/i);
  assert.match(query.sql, /COALESCE\(st\.consecutive_failures, 0\)/i);
  assert.match(query.sql, /LIMIT \$4/i);
  assert.doesNotMatch(query.sql, /\b(INSERT|UPDATE|DELETE|TRUNCATE|DROP|ALTER|CREATE)\b/i);
});

test("summarizeTargetFailurePressureRows ranks target-level worker blockers", () => {
  const summary = summarizeTargetFailurePressureRows([
    {
      ats_key: "breezy",
      company_url: "https://example.breezy.hr",
      company_name: "Example Breezy",
      protection_status: "normal",
      next_sync_epoch: 1_800_000_000,
      last_success_epoch: 1_799_000_000,
      last_failure_epoch: 1_800_000_100,
      consecutive_failures: 5,
      last_http_status: 0,
      last_error: "No jobs found",
      recent_error_groups: JSON.stringify([
        { error_type: "portal_search_empty", http_status: 0, error_message: "no jobs", count: 4 },
        { error_type: "parser_validation", http_status: 0, error_message: "ambiguous_location", count: 1 }
      ])
    },
    {
      ats_key: "applytojob",
      company_url: "https://jobs.example.com",
      company_name: "Example Apply",
      protection_status: "normal",
      next_sync_epoch: 1_800_000_010,
      last_success_epoch: 1_799_500_000,
      last_failure_epoch: 1_800_000_090,
      consecutive_failures: 2,
      last_http_status: 0,
      last_error: "shape drift",
      recent_error_groups: [
        { error_type: "parser_drift", http_status: 0, error_message: "shape drift", count: 2 }
      ]
    }
  ], { errorWindowHours: 48, limit: 15 });

  assert.equal(summary.read_only, true);
  assert.equal(summary.error_window_hours, 48);
  assert.equal(summary.sample_limit, 15);
  assert.equal(summary.target_count, 2);
  assert.equal(summary.by_source.breezy.target_count, 1);
  assert.equal(summary.by_source.breezy.failure_pressure, 5);
  assert.equal(summary.by_source.breezy.by_reason.empty_no_jobs, 4);
  assert.equal(summary.by_source.breezy.by_reason.source_quality, 1);
  assert.equal(summary.by_source.applytojob.by_reason.parser_bug, 2);
  assert.equal(summary.top_targets[0].ats_key, "breezy");
  assert.equal(summary.top_targets[0].recent_errors.empty_no_jobs_count, 4);
  assert.equal(summary.top_targets[0].dominant_failure_reason, "empty_no_jobs");
  assert.equal(summary.top_targets[1].dominant_failure_reason, "parser_bug");
});

test("summarizeTargetFailurePressureRows falls back to last error when recent groups expired", () => {
  const summary = summarizeTargetFailurePressureRows([
    {
      ats_key: "recruitcrm",
      company_url: "https://recruitcrm.io/jobs/acme",
      company_name: "Acme",
      protection_status: "quarantine_only",
      next_sync_epoch: 1_800_000_000,
      last_success_epoch: 1_799_000_000,
      last_failure_epoch: 1_799_900_000,
      consecutive_failures: 7,
      last_http_status: 0,
      last_error: "parser drift detected: payload shape similarity 0.2609 below 0.55",
      recent_error_count: 0,
      recent_error_groups: []
    }
  ]);

  assert.equal(summary.by_source.recruitcrm.dominant_failure_reason, "parser_bug");
  assert.equal(summary.by_source.recruitcrm.by_reason.parser_bug, 1);
  assert.equal(summary.top_targets[0].dominant_failure_reason, "parser_bug");
  assert.equal(summary.top_targets[0].next_action, "add fixture and fix parser before counting this source as scalable");
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
    targetAtsKeys: ["applytojob"],
    autoSyncDailyTargetBudget: 250,
    autoSyncTargetsPerRun: 50,
    sourceDailyTargetBudget: 100
  });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].params, [1_800_000_000, 25, ["applytojob"]]);
  assert.equal(report.ok, true);
  assert.equal(report.read_only, true);
  assert.deepEqual(report.filters.target_ats_keys, ["applytojob"]);
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
      if (/WITH due_targets AS/i.test(sql)) {
        return {
          rows: [
            {
              ats_key: "applytojob",
              company_url: "https://jobs.example.com",
              company_name: "Example Apply",
              protection_status: "normal",
              next_sync_epoch: 1_800_000_010,
              last_success_epoch: 1_799_500_000,
              last_failure_epoch: 1_800_000_090,
              consecutive_failures: 2,
              last_http_status: 0,
              last_error: "shape drift",
              recent_error_groups: [
                { error_type: "parser_drift", http_status: 0, error_message: "shape drift", count: 2 }
              ]
            }
          ]
        };
      }
      if (/FROM ingestion_run_errors/i.test(sql)) {
        if (/e\.run_id = l\.id/i.test(sql)) {
          if (/GROUP BY e\.ats_key, e\.error_type/i.test(sql)) {
            return {
              rows: [
                { ats_key: "applytojob", error_type: "parser_validation", http_status: 0, count: 3 },
                { ats_key: "breezy", error_type: "blocked_or_rate_limited", http_status: 403, count: 1 },
                { ats_key: "breezy", error_type: "portal_search_empty", http_status: 0, count: 2 }
              ]
            };
          }
          return {
            rows: [
              { latest_run_id: 211, ats_key: "applytojob", success_count: 1, failure_count: 3 },
              { latest_run_id: 211, ats_key: "breezy", success_count: 1, failure_count: 2 }
            ]
          };
        }
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
      if (/FROM company_sync_state/i.test(sql)) {
        return {
          rows: [
            { ats_key: "applytojob", successful_targets_today: 200 },
            { ats_key: "breezy", successful_targets_today: 175 }
          ]
        };
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

  assert.equal(calls.length, 9);
  assert.equal(report.diagnostics.latest_run.latest_run_id, 211);
  assert.equal(report.diagnostics.latest_run.success_rate_pct, 80);
  assert.equal(report.diagnostics.latest_run.failure_rate_pct, 20);
  assert.equal(report.diagnostics.throughput_scaling_gate.allowed, false);
  assert.equal(report.diagnostics.throughput_scaling_gate.decision, "hold");
  assert.ok(report.diagnostics.throughput_scaling_gate.blockers.some((item) => item.code === "rate_limit_failures_present"));
  assert.equal(report.diagnostics.latest_run_by_source.applytojob.success_rate_pct, 25);
  assert.equal(report.diagnostics.latest_run_by_source.applytojob.failure_rate_pct, 75);
  assert.equal(report.diagnostics.latest_run_by_source.applytojob.failure_reasons.parser_bug_count, 3);
  assert.equal(report.diagnostics.latest_run_by_source.applytojob.failure_reasons.by_type.parser_validation, 3);
  assert.equal(report.diagnostics.latest_run_by_source.breezy.success_rate_pct, 33.33);
  assert.equal(report.diagnostics.latest_run_by_source.breezy.failure_reasons.rate_limit_count, 1);
  assert.equal(report.diagnostics.latest_run_by_source.breezy.failure_reasons.empty_no_jobs_count, 2);
  assert.equal(report.items[0].latest_run.success_count, 1);
  assert.equal(report.items[0].latest_run.failure_count, 3);
  assert.equal(report.items[0].latest_run.failure_reasons.parser_bug_count, 3);
  assert.equal(report.diagnostics.failure_reason_counts.rate_limit, 3);
  assert.equal(report.diagnostics.parser_drift_recheck.sample_count, 0);
  assert.equal(report.diagnostics.target_failure_pressure.target_count, 1);
  assert.equal(report.diagnostics.target_failure_pressure.top_targets[0].ats_key, "applytojob");
  assert.equal(report.diagnostics.target_failure_pressure.top_targets[0].dominant_failure_reason, "parser_bug");
  assert.equal(report.diagnostics.auto_sync_budget_usage.targets_started_today, 2000);
  assert.equal(report.diagnostics.auto_sync_budget_usage.remaining_daily_budget, 0);
  assert.equal(report.diagnostics.auto_sync_budget_usage.daily_budget_exhausted, true);

  const applytojob = report.items.find((item) => item.ats_key === "applytojob");
  assert.equal(applytojob.source_daily_budget_usage.successful_targets_today, 200);
  assert.equal(applytojob.source_daily_budget_usage.remaining_daily_budget, 0);
  assert.equal(applytojob.source_daily_budget_usage.daily_budget_exhausted, true);
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

test("summarizeLatestRunBySourceRows exposes per-source run success rates", () => {
  const summary = summarizeLatestRunBySourceRows([
    { latest_run_id: 211, ats_key: "applytojob", success_count: 1, failure_count: 3 },
    { latest_run_id: 211, ats_key: "breezy", success_count: 1, failure_count: 2 }
  ]);

  assert.deepEqual(summary.applytojob, {
    latest_run_id: 211,
    total_targets: 4,
    success_count: 1,
    failure_count: 3,
    success_rate_pct: 25,
    failure_rate_pct: 75
  });
  assert.equal(summary.breezy.total_targets, 3);
  assert.equal(summary.breezy.success_rate_pct, 33.33);
});

test("summarizeSourceBudgetUsageRows exposes remaining budget by ATS", () => {
  const bySource = summarizeSourceBudgetUsageRows(
    [
      { ats_key: "applytojob", successful_targets_today: 200 },
      { ats_key: "breezy", successful_targets_today: 175 }
    ],
    { sourceDailyTargetBudget: 200 }
  );

  assert.deepEqual(bySource.get("applytojob"), {
    read_only: true,
    daily_budget: 200,
    successful_targets_today: 200,
    remaining_daily_budget: 0,
    daily_budget_exhausted: true
  });
  assert.equal(bySource.get("breezy").remaining_daily_budget, 25);
  assert.equal(bySource.get("missing"), undefined);
});

test("buildThroughputScalingGate holds scaling when latest run success is below threshold", () => {
  const gate = buildThroughputScalingGate({
    latestRun: {
      latest_run_id: 245,
      latest_status: "completed_with_errors",
      total_targets: 50,
      success_count: 37,
      failure_count: 13,
      success_rate_pct: 74
    },
    parserAttentionCount: 0,
    failureReasonCounts: {
      parser_bug: 0,
      source_quality: 0,
      rate_limit: 0,
      network: 0,
      empty_no_jobs: 13,
      auth: 0,
      unknown: 0
    },
    totals: {
      runnable_due_count: 18000,
      failure_pressure: 1300
    }
  });

  assert.equal(gate.allowed, false);
  assert.equal(gate.decision, "hold");
  assert.equal(gate.latest_run_success_rate_pct, 74);
  assert.equal(gate.minimum_success_rate_pct, 80);
  assert.ok(gate.blockers.some((item) => item.code === "latest_run_success_rate_below_threshold"));
  assert.ok(gate.required_checks_before_increase.includes("search:reindex:check"));
});

test("buildThroughputScalingGate allows only small increase after clean worker evidence", () => {
  const gate = buildThroughputScalingGate({
    latestRun: {
      latest_run_id: 246,
      latest_status: "completed",
      total_targets: 50,
      success_count: 46,
      failure_count: 4,
      success_rate_pct: 92
    },
    parserAttentionCount: 0,
    failureReasonCounts: {
      parser_bug: 0,
      source_quality: 0,
      rate_limit: 0,
      network: 0,
      empty_no_jobs: 4,
      auth: 0,
      unknown: 0
    },
    totals: {
      runnable_due_count: 12000,
      failure_pressure: 0
    }
  });

  assert.equal(gate.allowed, true);
  assert.equal(gate.decision, "eligible_for_small_increase");
  assert.deepEqual(gate.blockers, []);
  assert.equal(gate.max_recommended_step, "small");
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
        { ats_key: "applytojob", error_type: "parser_validation", error_message: "ambiguous_location", count: 5 },
        { ats_key: "applytojob", error_type: "parser_validation", error_message: "no_geo_no_remote", count: 3 },
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
  assert.equal(applytojob.recent_errors.source_quality_count, 8);
  assert.equal(applytojob.recent_errors.rate_limit_count, 3);
  assert.equal(applytojob.recent_errors.network_count, 4);
  assert.equal(applytojob.recent_errors.empty_no_jobs_count, 2);
  assert.deepEqual(applytojob.recent_errors.by_reason, {
    parser_bug: 7,
    source_quality: 8,
    empty_no_jobs: 2,
    rate_limit: 3,
    network: 4
  });

  const breezy = withDiagnostics.items.find((item) => item.ats_key === "breezy");
  assert.equal(breezy.recent_errors.rate_limit_count, 1);
  assert.equal(breezy.recent_errors.empty_no_jobs_count, 5);

  assert.equal(withDiagnostics.diagnostics.failure_reason_counts.parser_bug, 7);
  assert.equal(withDiagnostics.diagnostics.failure_reason_counts.source_quality, 16);
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

test("attachBacklogDiagnostics treats legacy quality quarantines as source quality", () => {
  const base = summarizeBacklogRows([
    {
      ats_key: "hrmdirect",
      enabled: true,
      protection_status: "normal",
      target_count: 10,
      due_count: 10,
      runnable_due_count: 10
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
        { ats_key: "hrmdirect", error_type: "parser_quarantine", error_message: "no_geo_no_remote", count: 5 },
        { ats_key: "hrmdirect", error_type: "parser_quarantine", error_message: "ambiguous_location", count: 3 },
        { ats_key: "hrmdirect", error_type: "parser_quarantine", error_message: "unexpected parser shape", count: 2 }
      ]
    }
  );

  const hrmdirect = withDiagnostics.items[0];
  assert.equal(hrmdirect.recent_errors.source_quality_count, 8);
  assert.equal(hrmdirect.recent_errors.parser_bug_count, 2);
  assert.equal(hrmdirect.recent_errors.parser_attention_count, 2);
  assert.deepEqual(hrmdirect.recent_errors.by_reason, {
    source_quality: 8,
    parser_bug: 2
  });
  assert.equal(withDiagnostics.diagnostics.failure_reason_counts.source_quality, 8);
  assert.equal(withDiagnostics.diagnostics.failure_reason_counts.parser_bug, 2);
});
