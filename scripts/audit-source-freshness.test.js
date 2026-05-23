const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildPostgresDailySourceHealthQueries,
  createDailySourceHealthSummary,
  parseArgs
} = require("./audit-source-freshness");
const {
  createSourceFreshnessReportFromRows,
  cutoffEpochForDays
} = require("../server/ingestion/dataQualityAudit");

test("parseArgs accepts source freshness window and output controls", () => {
  const options = parseArgs(["--json", "--days=30", "--limit", "5", "--output=C:\\tmp\\fresh.json"]);
  assert.equal(options.json, true);
  assert.equal(options.days, 30);
  assert.equal(options.limit, 5);
  assert.equal(options.output, "C:\\tmp\\fresh.json");
});

test("createDailySourceHealthSummary reports read-only worker budget, freshness, and failure taxonomy", () => {
  const summary = createDailySourceHealthSummary({
    dueRows: [{ targets_due: 42 }],
    runRows: [{
      targets_processed: 10,
      success_count: 8,
      failure_count: 2,
      posting_upsert_count: 77,
      rejected_count: 4
    }],
    postingRows: [{
      rows_seen: 55,
      rows_new: 12,
      new_missing_any_normalized_geo_rows: 4,
      new_weak_unknown_remote_rows: 3,
      new_no_geo_no_remote_rows: 2
    }],
    qualityGateRows: [
      {
        ats_key: "applytojob",
        new_missing_any_normalized_geo_rows: 4,
        new_weak_unknown_remote_rows: 1,
        new_no_geo_no_remote_rows: 2
      },
      {
        ats_key: "breezy",
        new_missing_any_normalized_geo_rows: 1,
        new_weak_unknown_remote_rows: 1,
        new_no_geo_no_remote_rows: 1
      }
    ],
    failureRows: [
      {
        ats_key: "bamboohr",
        error_type: "parser_drift",
        http_status: 0,
        error_message: "parser drift detected: payload shape similarity 0.2609 below 0.55",
        count: 4
      },
      {
        ats_key: "breezy",
        error_type: "portal_search_empty",
        http_status: 200,
        error_message: "Breezy public portal returned no parseable postings",
        count: 5
      },
      {
        ats_key: "greenhouse",
        error_type: "fetch_error",
        http_status: 429,
        error_message: "rate limited",
        count: 3
      }
    ],
    failureScopeRows: [
      {
        error_scope: "target_failure",
        error_type: "parser_drift",
        http_status: 0,
        error_message: "parser drift detected: payload shape similarity 0.2609 below 0.55",
        count: 4
      },
      {
        error_scope: "posting_rejection",
        error_type: "parser_validation",
        http_status: 0,
        error_message: "no_geo_no_remote",
        count: 2
      }
    ],
    parserDriftRecheckRows: [
      {
        ats_key: "bamboohr",
        observed_shape_paths: ["meta.totalCount:number", "meta:object", "result:array", "result[]:empty"],
        baseline_shape_paths: ["meta.totalCount:number", "meta:object", "result:array", "result[].id:string", "result[]:object"]
      },
      {
        ats_key: "applytojob",
        observed_shape_paths: ["jobs:array", "jobs[].id:string", "jobs[]:object"],
        baseline_shape_paths: ["jobs:array", "jobs[].id:string", "jobs[]:object"]
      }
    ]
  }, {
    nowEpoch: 1_800_000_000,
    healthWindowHours: 24,
    env: {
      INGESTION_AUTO_SYNC_DAILY_TARGET_BUDGET: "1000",
      INGESTION_AUTO_SYNC_TARGETS_PER_RUN: "25"
    }
  });

  assert.equal(summary.read_only, true);
  assert.equal(summary.window_hours, 24);
  assert.equal(summary.daily_target_budget, 1000);
  assert.equal(summary.targets_per_run, 25);
  assert.equal(summary.targets_due, 42);
  assert.equal(summary.targets_processed_24h, 10);
  assert.equal(summary.target_success_pct_24h, 80);
  assert.equal(summary.rows_seen_24h, 55);
  assert.equal(summary.rows_new_24h, 12);
  assert.equal(summary.new_missing_any_normalized_geo_rows_24h, 4);
  assert.equal(summary.new_weak_unknown_remote_rows_24h, 3);
  assert.equal(summary.new_no_geo_no_remote_public_rows_24h, 2);
  assert.deepEqual(summary.quality_gate_sources_24h[0], {
    ats_key: "applytojob",
    new_missing_any_normalized_geo_rows_24h: 4,
    new_weak_unknown_remote_rows_24h: 1,
    new_no_geo_no_remote_public_rows_24h: 2
  });
  assert.equal(summary.rejected_candidates_24h, 4);
  assert.deepEqual(summary.failure_reason_counts_24h, {
    parser_bug: 4,
    empty_no_jobs: 5,
    rate_limit: 3
  });
  assert.deepEqual(summary.current_policy_adjusted_failure_reason_counts_24h, {
    parser_bug: 2,
    empty_no_jobs: 6,
    rate_limit: 3
  });
  assert.deepEqual(summary.current_policy_failure_adjustments_24h, {
    parser_bug_to_current_policy_pass: 1,
    parser_bug_to_empty_no_jobs: 1,
    parser_bug_resolved_total: 2
  });
  assert.equal(summary.parser_drift_recheck_24h.current_policy_resolved_count, 2);
  assert.equal(summary.current_policy_adjusted_failure_reason_counts_by_scope_24h.target_failure.parser_bug, 2);
  assert.equal(summary.current_policy_adjusted_failure_reason_counts_by_scope_24h.target_failure.empty_no_jobs, 1);
  assert.equal(summary.current_policy_adjusted_failure_reason_counts_by_scope_24h.posting_rejection.source_quality, 2);
  assert.deepEqual(summary.throughput_readiness, {
    read_only: true,
    allowed: false,
    decision: "hold",
    minimum_success_rate_pct: 80,
    target_success_pct_24h: 80,
    new_no_geo_no_remote_public_rows_24h: 2,
    current_policy_adjusted_failure_reason_counts_24h: {
      parser_bug: 2,
      empty_no_jobs: 6,
      rate_limit: 3
    },
    blockers: [
      {
        code: "new_no_geo_no_remote_public_rows_present",
        message: "24h public freshness introduced 2 no_geo_no_remote rows.",
        count: 2
      },
      {
        code: "parser_bug_failures_present",
        message: "current-policy parser_bug failures are present in the 24h worker window.",
        count: 2
      },
      {
        code: "rate_limit_failures_present",
        message: "rate_limit failures are present in the 24h worker window.",
        count: 3
      }
    ],
    required_checks_before_increase: [
      "/health",
      "search:reindex:check",
      "search:parity",
      "worker trend",
      "parser_attention_count",
      "due-by-ATS"
    ],
    next_action: "Hold throughput and improve worker/source quality before increasing budget or targets-per-run."
  });
  assert.equal(summary.top_failure_sources[0].ats_key, "breezy");
  assert.equal(summary.top_failure_sources[0].dominant_failure_reason, "empty_no_jobs");
  assert.equal(summary.top_failure_sources[1].ats_key, "bamboohr");
  assert.equal(summary.top_failure_sources[1].dominant_failure_reason, "parser_bug");
  assert.deepEqual(summary.top_failure_sources[1].current_policy_adjusted_by_reason, {
    parser_bug: 3,
    empty_no_jobs: 1
  });
  assert.deepEqual(summary.top_failure_sources[1].current_policy_failure_adjustments, {
    parser_bug_to_current_policy_pass: 0,
    parser_bug_to_empty_no_jobs: 1,
    parser_bug_resolved_total: 1
  });
  assert.equal(summary.top_failure_sources[2].dominant_failure_reason, "rate_limit");
});

test("buildPostgresDailySourceHealthQueries counts new unsafe public rows from first seen only", () => {
  const queries = buildPostgresDailySourceHealthQueries({
    nowEpoch: 1_800_000_000,
    healthWindowHours: 24
  });

  assert.deepEqual(queries.postings.values, [1_799_913_600]);
  assert.deepEqual(queries.qualityGateSources.values, [1_799_913_600, 25]);
  assert.deepEqual(queries.failureScopes.values, [24, []]);
  assert.deepEqual(queries.parserDriftRecheck.values, [24, [], 100]);
  assert.match(queries.postings.sql, /first_seen_epoch/i);
  assert.match(queries.postings.sql, /new_no_geo_no_remote_rows/i);
  assert.match(queries.qualityGateSources.sql, /GROUP BY ats_key/i);
  assert.match(queries.qualityGateSources.sql, /new_no_geo_no_remote_rows/i);
  assert.match(queries.failureScopes.sql, /posting_rejection/i);
  assert.match(queries.parserDriftRecheck.sql, /FROM parser_drift_events/i);
  assert.match(queries.postings.sql, /NULLIF\(btrim\(country\), ''\) IS NULL/i);
  assert.match(queries.postings.sql, /remote_type.*unknown/i);
});

test("source freshness report marks stale sources due without mutating data", () => {
  const nowEpoch = 1_800_000_000;
  const cutoff = cutoffEpochForDays(30, nowEpoch);
  const report = createSourceFreshnessReportFromRows(
    [
      {
        ats_key: "greenhouse",
        canonical_url: "https://boards.greenhouse.io/acme/jobs/1",
        parser_version: "greenhouse-v1",
        location_text: "New York, NY",
        country: "United States",
        region: "North America",
        city: "New York",
        remote_type: "onsite",
        quality_score: 100,
        last_seen_epoch: cutoff + 100
      },
      {
        ats_key: "applytojob",
        canonical_url: "https://acme.applytojob.com/apply/1",
        parser_version: "applytojob-v1",
        location_text: "",
        country: "",
        region: "",
        city: "",
        remote_type: "unknown",
        quality_score: 50,
        last_seen_epoch: cutoff - 100
      }
    ],
    { staleDays: 30, nowEpoch }
  );

  assert.equal(report.filters.stale_days, 30);
  assert.equal(report.items[0].ats_key, "applytojob");
  assert.equal(report.items[0].is_due, true);
  assert.equal(report.items[0].due_reason, "posting_stale");
  assert.equal(report.items.find((item) => item.ats_key === "greenhouse").is_due, false);
});
