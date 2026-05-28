const assert = require("node:assert/strict");
const {
  buildSearchRankSql,
  checkAndRecordPostgresPayloadDrift,
  getPostgresCounts,
  getPostgresSuggestions,
  getPostgresSyncStatus,
  getPostgresAtsFieldQualityByAts,
  getPostgresParserAttentionByAts,
  getPostgresPublicSearchReport,
  getRetentionConfig,
  getRetentionCutoffs,
  hydratePostgresPostings,
  listPostgresIngestionErrors,
  listPostgresIngestionSources,
  listPostgresPostings,
  processPostgresSearchIndexOutbox,
  prunePostgresRetention,
  recordPostgresPublicSearchEvent,
  requestSyncStart,
  requestSyncStop,
  upsertPostgresPostings
} = require("./postgresStore");
const { searchMeiliPostings, toMeiliPostingDocument } = require("../search/meili");

function isSourceFacetQuery(sql) {
  return /AS fresh_count/i.test(sql) && /GROUP BY COALESCE\(NULLIF\(btrim\(p\.ats_key\), ''\), 'unknown'\)/i.test(sql);
}

function createSourceFacetRows(value = "greenhouse", count = 1) {
  return {
    rows: [{
      value,
      count,
      avg_confidence: 0.9,
      avg_quality: 90,
      latest_seen_epoch: 1778205600,
      fresh_count: count
    }]
  };
}

function createMockPool(status = "idle") {
  const calls = [];
  return {
    calls,
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (/SELECT \* FROM sync_control/i.test(sql)) {
        return { rows: [{ status }] };
      }
      return { rows: [] };
    }
  };
}

function createStatusMockPool(controlStatus = "requested", options = {}) {
  return {
    async query(sql) {
      if (/SELECT \* FROM sync_control/i.test(sql)) {
        return {
          rows: [{
            status: controlStatus,
            cancel_requested_at_epoch: controlStatus === "stopping" ? 123 : null
          }]
        };
      }
      if (/SELECT\s+\*\s+FROM ingestion_runs/i.test(sql)) {
        return {
          rows: [{
            id: 42,
            started_at_epoch: 100,
            finished_at_epoch: controlStatus === "running" ? null : 200,
            status: controlStatus === "running" ? "running" : "completed",
            total_targets: 10,
            success_count: 8,
            failure_count: 2,
            cache_hit_count: 3,
            cache_write_count: 4,
            posting_upsert_count: 5,
            rejected_count: 6,
            duplicate_count: 1,
            db_busy_count: 0,
            current_ats: controlStatus === "running" ? "greenhouse" : "",
            current_company_url: controlStatus === "running" ? "https://boards.greenhouse.io/acme" : "",
            current_company_name: controlStatus === "running" ? "Acme" : "",
            http_status_counts: { 429: 2 },
            active_ats: ["greenhouse"],
            last_error: ""
          }]
        };
      }
      if (/SUM\(total_targets\).*targets_started_today/is.test(sql)) {
        if (options.failWorkerDiagnosticsQueries) throw new Error("unexpected worker budget query");
        return {
          rows: [{
            targets_started_today: options.targetsStartedToday ?? 1300
          }]
        };
      }
      if (/SUM\(total_targets\).*target_count_24h/is.test(sql)) {
        if (options.failWorkerDiagnosticsQueries) throw new Error("unexpected worker health query");
        return {
          rows: [{
            target_count_24h: options.targetCount24h ?? 100,
            success_count_24h: options.successCount24h ?? 75,
            failure_count_24h: options.failureCount24h ?? 25
          }]
        };
      }
      if (/SELECT\s+error_type[\s\S]+FROM ingestion_run_errors/i.test(sql)) {
        if (options.failWorkerDiagnosticsQueries) throw new Error("unexpected worker failure taxonomy query");
        return {
          rows: options.failureReasonRows || [
            { error_type: "parser_validation", http_status: 0, error_message: "no_geo_no_remote", count: 5 },
            { error_type: "fetch", http_status: 500, error_message: "upstream failed", count: 2 },
            { error_type: "no_jobs", http_status: 0, error_message: "no jobs", count: 3 },
            { error_type: "rate_limit", http_status: 429, error_message: "too many requests", count: 4 }
          ]
        };
      }
      if (/FROM ingestion_run_errors/i.test(sql)) {
        return { rows: [{ count: 0 }] };
      }
      if (/LEFT JOIN company_sync_state/i.test(sql)) {
        return { rows: [{ count: 12 }] };
      }
      if (/SELECT COUNT\(\*\)::int AS count FROM companies;/i.test(sql)) {
        return { rows: [{ count: 20 }] };
      }
      if (/configured_enabled_ats_count/i.test(sql)) {
        return {
          rows: [{
            configured_enabled_ats_count: 57,
            full_enabled_ats_count: 14,
            canary_enabled_ats_count: 35,
            quarantine_only_ats_count: 8,
            disabled_ats_count: 5,
            worker_auto_eligible_ats_count: 49
          }]
        };
      }
      if (/SELECT COUNT\(\*\)::int AS count FROM ats_sources;/i.test(sql)) {
        return { rows: [{ count: 62 }] };
      }
      if (/FROM companies c\s+INNER JOIN ats_sources s/i.test(sql)) {
        return { rows: [{ count: 18 }] };
      }
      if (/COUNT\(DISTINCT NULLIF\(company_name/i.test(sql)) {
        return { rows: [{ count: 8 }] };
      }
      if (/COUNT\(DISTINCT ats_key/i.test(sql)) {
        return { rows: [{ count: 3 }] };
      }
      if (/FROM postings WHERE hidden = false AND last_seen_epoch/i.test(sql)) {
        return { rows: [{ count: 7 }] };
      }
      if (/FROM postings WHERE hidden = false/i.test(sql)) {
        return { rows: [{ count: 30 }] };
      }
      if (/SELECT ats_key, COUNT\(\*\)::int AS count FROM companies/i.test(sql)) {
        return { rows: [{ ats_key: "greenhouse", count: 2 }] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    }
  };
}

async function testRequestSyncStartCastsEpochFields() {
  const pool = createMockPool("requested");

  await requestSyncStart(pool);

  const update = pool.calls.find((call) => /UPDATE sync_control/i.test(call.sql));
  assert.ok(update, "expected sync_control update");
  assert.match(update.sql, /requested_at_epoch[\s\S]*\$1::bigint/);
  assert.match(update.sql, /cancel_requested_at_epoch[\s\S]*NULL::bigint/);
  assert.equal(typeof update.params[0], "number");
}

async function testRequestSyncStopCastsEpochFields() {
  const pool = createMockPool("stopping");

  await requestSyncStop(pool);

  const update = pool.calls.find((call) => /UPDATE sync_control/i.test(call.sql));
  assert.ok(update, "expected sync_control update");
  assert.match(update.sql, /cancel_requested_at_epoch[\s\S]*\$1::bigint[\s\S]*NULL::bigint/);
  assert.equal(typeof update.params[0], "number");
}

async function testSyncStatusReportsQueuedSeparatelyFromRunning() {
  const status = await getPostgresSyncStatus(createStatusMockPool("requested"));
  assert.equal(status.status, "requested");
  assert.equal(status.queued, true);
  assert.equal(status.running, false);
  assert.equal(status.ingestion_worker.latest_status, "queued");
}

async function testSyncStatusReportsRunningForActiveWorkerOnly() {
  const status = await getPostgresSyncStatus(createStatusMockPool("running"));
  assert.equal(status.status, "running");
  assert.equal(status.queued, false);
  assert.equal(status.running, true);
  assert.equal(status.ingestion_worker.latest_status, "running");
  assert.equal(status.ingestion_worker.current_ats, "greenhouse");
  assert.equal(status.ingestion_worker.rejected_count, 6);
  assert.equal(status.ingestion_worker.duplicate_count, 1);
  assert.deepEqual(status.ingestion_worker.http_status_counts, { 429: 2 });
  assert.equal(status.last_sync_summary.cache_writes, 4);
  assert.equal(status.last_sync_summary.cache_skips, 3);
}

async function testSyncStatusDefaultsToPostgresSyncControlQueue() {
  const previousQueueBackend = process.env.OPENJOBSLOTS_QUEUE_BACKEND;
  delete process.env.OPENJOBSLOTS_QUEUE_BACKEND;
  try {
    const status = await getPostgresSyncStatus(createStatusMockPool("requested"));
    assert.equal(status.queue_backend, "postgres-sync-control");
  } finally {
    if (previousQueueBackend === undefined) {
      delete process.env.OPENJOBSLOTS_QUEUE_BACKEND;
    } else {
      process.env.OPENJOBSLOTS_QUEUE_BACKEND = previousQueueBackend;
    }
  }
}

async function testSyncStatusIncludesWorkerBudgetAndFailureTaxonomy() {
  const previousDailyBudget = process.env.INGESTION_AUTO_SYNC_DAILY_TARGET_BUDGET;
  const previousTargetsPerRun = process.env.INGESTION_AUTO_SYNC_TARGETS_PER_RUN;
  process.env.INGESTION_AUTO_SYNC_DAILY_TARGET_BUDGET = "2000";
  process.env.INGESTION_AUTO_SYNC_TARGETS_PER_RUN = "50";
  try {
    const status = await getPostgresSyncStatus(createStatusMockPool("idle"));
    const budgetUsage = status.ingestion_worker.auto_sync_budget_usage;
    const workerHealth = status.ingestion_worker.worker_health_24h;

    assert.equal(budgetUsage.read_only, true);
    assert.equal(budgetUsage.daily_budget, 2000);
    assert.equal(budgetUsage.targets_per_run, 50);
    assert.equal(budgetUsage.targets_started_today, 1300);
    assert.equal(budgetUsage.remaining_daily_budget, 700);
    assert.equal(budgetUsage.daily_budget_exhausted, false);
    assert.equal(budgetUsage.utc_day_reset_epoch - budgetUsage.utc_day_start_epoch, 86400);
    assert.deepEqual(workerHealth, {
      read_only: true,
      window_hours: 24,
      target_count: 100,
      success_count: 75,
      failure_count: 25,
      success_rate_pct: 75,
      failure_reason_counts: {
        parser_bug: 0,
        source_quality: 5,
        rate_limit: 4,
        network: 2,
        empty_no_jobs: 3,
        auth: 0,
        unknown: 0
      }
    });
  } finally {
    if (previousDailyBudget === undefined) {
      delete process.env.INGESTION_AUTO_SYNC_DAILY_TARGET_BUDGET;
    } else {
      process.env.INGESTION_AUTO_SYNC_DAILY_TARGET_BUDGET = previousDailyBudget;
    }
    if (previousTargetsPerRun === undefined) {
      delete process.env.INGESTION_AUTO_SYNC_TARGETS_PER_RUN;
    } else {
      process.env.INGESTION_AUTO_SYNC_TARGETS_PER_RUN = previousTargetsPerRun;
    }
  }
}

async function testSyncStatusCanSkipWorkerDiagnosticsForPublicStatus() {
  const status = await getPostgresSyncStatus(
    createStatusMockPool("idle", { failWorkerDiagnosticsQueries: true }),
    { includeWorkerDiagnostics: false }
  );

  assert.equal(status.ingestion_worker.auto_sync_budget_usage, undefined);
  assert.equal(status.ingestion_worker.worker_health_24h, undefined);
}

async function testParserAttentionGroupsCareerplugRejectionReasons() {
  let captured = null;
  const pool = {
    async query(sql, params = []) {
      captured = { sql, params };
      return {
        rows: [{
          ats_key: "careerplug",
          error_count: 2,
          latest_error_at: "2026-05-08T12:00:00.000Z",
          latest_error: "placeholder position_name",
          reasons: [
            { reason: "placeholder position_name", count: 1 },
            { reason: "missing position_name", count: 1 }
          ]
        }]
      };
    }
  };

  const result = await getPostgresParserAttentionByAts(pool, 100);

  assert.match(captured.sql, /jsonb_agg/);
  assert.match(captured.sql, /GROUP BY e3\.error_message/);
  assert.match(captured.sql, /source_disabled_by_threshold/);
  assert.match(captured.sql, /parser_quarantine/);
  assert.match(captured.sql, /no_geo_no_remote/);
  assert.match(captured.sql, /ambiguous_location/);
  assert.deepEqual(captured.params, [100]);
  assert.deepEqual(result, [{
    ats_key: "careerplug",
    error_count: 2,
    latest_error_at: "2026-05-08T12:00:00.000Z",
    latest_error: "placeholder position_name",
    reasons: [
      { reason: "placeholder position_name", count: 1 },
      { reason: "missing position_name", count: 1 }
    ]
  }]);
}

async function testAtsFieldQualityReportsFieldGapsByAts() {
  let captured = null;
  const pool = {
    async query(sql, params = []) {
      captured = { sql, params };
      return {
        rows: [{
          ats_key: "icims",
          total_postings: 100,
          missing_country_count: 79,
          missing_region_count: 79,
          missing_city_count: 100,
          missing_region_or_city_count: 100,
          missing_remote_type_count: 80,
          missing_posted_at_count: 99,
          missing_department_count: 100,
          missing_employment_type_count: 100,
          missing_description_plain_count: 100,
          parser_attention_count_24h: 2,
          impact_score: 739
        }]
      };
    }
  };

  const result = await getPostgresAtsFieldQualityByAts(pool, ["icims"]);

  assert.match(captured.sql, /COUNT\(\*\) FILTER/);
  assert.match(captured.sql, /missing_description_plain_count/);
  assert.match(captured.sql, /source_disabled_by_threshold/);
  assert.deepEqual(captured.params, [["icims"]]);
  assert.equal(result[0].ats_key, "icims");
  assert.equal(result[0].missing_country_pct, 79);
  assert.equal(result[0].missing_region_or_city_count, 100);
  assert.equal(result[0].parser_attention_count_24h, 2);
}

async function testIngestionErrorsEndpointQueryIsBounded() {
  let captured = null;
  const pool = {
    async query(sql, params = []) {
      captured = { sql, params };
      return {
        rows: [{
          id: 7,
          run_id: 42,
          ats_key: "greenhouse",
          company_url: "https://boards.greenhouse.io/acme",
          company_name: "Acme",
          error_type: "fetch",
          error_message: "request failed (429)",
          http_status: 429,
          created_at: "2026-05-08T12:00:00.000Z"
        }]
      };
    }
  };

  const result = await listPostgresIngestionErrors(pool, 5000);

  assert.match(captured.sql, /ORDER BY id DESC/);
  assert.deepEqual(captured.params, [250]);
  assert.equal(result[0].http_status, 429);
}

async function testIngestionSourcesReportDueAndFailurePressure() {
  let captured = null;
  const pool = {
    async query(sql, params = []) {
      captured = { sql, params };
      return {
        rows: [{
          ats_key: "lever",
          display_name: "Lever",
          enabled: true,
          default_ttl_seconds: 86400,
          rate_limit_ms: 1000,
          company_count: 10,
          due_company_count: 3,
          last_success_epoch: 100,
          last_failure_epoch: 90,
          consecutive_failure_total: 4
        }]
      };
    }
  };

  const result = await listPostgresIngestionSources(pool, 2);

  assert.match(captured.sql, /due_company_count/);
  assert.equal(captured.params[1], 2);
  assert.equal(result[0].ats_key, "lever");
  assert.equal(result[0].due_company_count, 3);
  assert.equal(result[0].consecutive_failure_total, 4);
}

async function testHydratePostgresPostingsKeepsSafetyAndFilterGuards() {
  let captured = null;
  const pool = {
    async query(sql, params) {
      captured = { sql, params };
      return {
        rows: [{
          canonical_url: "https://example.com/visible",
          company_name: "Visible Co",
          position_name: "Engineer",
          location_text: "Istanbul, Turkey",
          country: "Turkey",
          region: "EMEA",
          remote_type: "remote",
          ats_key: "greenhouse",
          last_seen_epoch: 123
        }]
      };
    }
  };

  const items = await hydratePostgresPostings(
    pool,
    ["https://example.com/hidden", "https://example.com/visible"],
    {
      search: "\"engineer\"",
      countries: ["turkiye"],
      include_applied: true,
      include_ignored: true
    }
  );

  assert.match(captured.sql, /p\.hidden = false/);
  assert.match(captured.sql, /lower\(unaccent\(coalesce\(p\.country, ''\)\)\)/);
  assert.match(captured.sql, /p\.location_text/);
  assert.match(captured.sql, /lower\(unaccent\(p\.position_name\)\)/);
  assert.deepEqual(captured.params[0], ["https://example.com/hidden", "https://example.com/visible"]);
  assert.equal(captured.params[1], "Turkey");
  assert.ok(captured.params.some((value) => value === "%turkiye%"));
  assert.ok(captured.params.some((value) => value === "%engineer%"));
  assert.ok(!captured.params.some((value) => String(value).includes("\"")));
  assert.deepEqual(items.map((item) => item.job_posting_url), ["https://example.com/visible"]);
}

async function testMeiliPostgresPathHydratesBeforeCounting() {
  const previousSearchBackend = process.env.OPENJOBSLOTS_SEARCH_BACKEND;
  const previousFetch = global.fetch;
  process.env.OPENJOBSLOTS_SEARCH_BACKEND = "meili";
  let searchBody = null;

  global.fetch = async (_url, options = {}) => {
    searchBody = JSON.parse(String(options.body || "{}"));
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          hits: [
            { canonical_url: "https://example.com/hidden" },
            { canonical_url: "https://example.com/visible" }
          ],
          estimatedTotalHits: 2
        };
      }
    };
  };

  const pool = {
    async query() {
      return {
        rows: [{
          canonical_url: "https://example.com/visible",
          company_name: "Visible Co",
          position_name: "Engineer",
          location_text: "Remote",
          country: "Turkey",
          region: "EMEA",
          remote_type: "remote",
          ats_key: "greenhouse",
          last_seen_epoch: 123
        }]
      };
    }
  };

  try {
    const result = await listPostgresPostings(pool, {
      search: "\"engineer\"",
      countries: ["US"],
      regions: ["AMER"],
      limit: 1,
      offset: 0,
      hide_no_date: true,
      include_applied: true,
      include_ignored: true
    });

    assert.match(searchBody.filter, /hidden = false/);
    assert.doesNotMatch(searchBody.filter, /NOT hidden = true/);
    assert.match(searchBody.filter, /country IN \["United States"\]/);
    assert.match(searchBody.filter, /region IN \["North America"\]/);
    assert.match(searchBody.filter, /posting_date EXISTS/);
    assert.match(searchBody.filter, /posting_date IS NOT EMPTY/);
    assert.equal(searchBody.q, "engineer");
    assert.equal(searchBody.matchingStrategy, "all");
    assert.equal(result.items.length, 1);
    assert.equal(result.count, 1);
    assert.equal(result.items[0].job_posting_url, "https://example.com/visible");
  } finally {
    global.fetch = previousFetch;
    if (previousSearchBackend === undefined) {
      delete process.env.OPENJOBSLOTS_SEARCH_BACKEND;
    } else {
      process.env.OPENJOBSLOTS_SEARCH_BACKEND = previousSearchBackend;
    }
  }
}

async function testUnderfilledMeiliHydrationFallsBackToPostgres() {
  const previousSearchBackend = process.env.OPENJOBSLOTS_SEARCH_BACKEND;
  const previousFetch = global.fetch;
  const previousWarn = console.warn;
  process.env.OPENJOBSLOTS_SEARCH_BACKEND = "meili";
  const warnings = [];

  global.fetch = async () => ({
    ok: true,
    status: 200,
    async json() {
      return {
        hits: [
          { canonical_url: "https://example.com/stale" },
          { canonical_url: "https://example.com/visible" }
        ],
        estimatedTotalHits: 5
      };
    }
  });
  console.warn = (...args) => warnings.push(args);

  let fallbackSelectLimit = null;
  const pool = {
    async query(sql, params = []) {
      if (/p\.canonical_url = ANY\(\$1\)/i.test(sql)) {
        return {
          rows: [{
            canonical_url: "https://example.com/visible",
            company_name: "Visible Co",
            position_name: "Director",
            location_text: "Boston, MA, United States",
            country: "United States",
            region: "North America",
            remote_type: "onsite",
            ats_key: "greenhouse",
            last_seen_epoch: 123
          }]
        };
      }
      if (/SELECT COUNT\(\*\)::int AS count/i.test(sql)) {
        return { rows: [{ count: 3 }] };
      }
      if (isSourceFacetQuery(sql)) {
        return createSourceFacetRows("greenhouse", 2);
      }
      fallbackSelectLimit = params[params.length - 2];
      return {
        rows: [
          {
            canonical_url: "https://example.com/director-1",
            company_name: "Visible Co",
            position_name: "Director",
            location_text: "Boston, MA, United States",
            country: "United States",
            region: "North America",
            remote_type: "onsite",
            ats_key: "greenhouse",
            last_seen_epoch: 200
          },
          {
            canonical_url: "https://example.com/director-2",
            company_name: "Another Co",
            position_name: "Director",
            location_text: "New York, NY, United States",
            country: "United States",
            region: "North America",
            remote_type: "hybrid",
            ats_key: "greenhouse",
            last_seen_epoch: 100
          }
        ]
      };
    }
  };

  try {
    const result = await listPostgresPostings(pool, {
      search: "Director United States",
      limit: 2,
      offset: 0,
      include_applied: true,
      include_ignored: true
    });

    assert.equal(fallbackSelectLimit, 2);
    assert.equal(result.count, 3);
    assert.equal(result.limit, 2);
    assert.equal(result.items.length, 2);
    assert.deepEqual(result.items.map((item) => item.job_posting_url), [
      "https://example.com/director-1",
      "https://example.com/director-2"
    ]);
    assert.ok(warnings.some((entry) => String(entry[0]).includes("search_backend_fallback") && String(entry[1]).includes("hydration_underfill")));
  } finally {
    console.warn = previousWarn;
    global.fetch = previousFetch;
    if (previousSearchBackend === undefined) {
      delete process.env.OPENJOBSLOTS_SEARCH_BACKEND;
    } else {
      process.env.OPENJOBSLOTS_SEARCH_BACKEND = previousSearchBackend;
    }
  }
}

async function testEmptyMeiliSearchReturnsFastZero() {
  const previousSearchBackend = process.env.OPENJOBSLOTS_SEARCH_BACKEND;
  const previousFetch = global.fetch;
  const previousWarn = console.warn;
  process.env.OPENJOBSLOTS_SEARCH_BACKEND = "meili";
  let postgresCalls = 0;

  global.fetch = async () => ({
    ok: true,
    status: 200,
    async json() {
      return { hits: [], estimatedTotalHits: 0 };
    }
  });
  console.warn = () => {};

  const pool = {
    async query(sql) {
      postgresCalls += 1;
      if (/SELECT COUNT\(\*\)::int AS count/i.test(sql)) {
        return { rows: [{ count: 1 }] };
      }
      return {
        rows: [{
          canonical_url: "https://example.com/director-us",
          company_name: "Visible Co",
          position_name: "Director",
          location_text: "Boston, MA, United States",
          country: "United States",
          region: "North America",
          remote_type: "onsite",
          ats_key: "greenhouse",
          last_seen_epoch: 123
        }]
      };
    }
  };

  try {
    const result = await listPostgresPostings(pool, {
      search: "\"Director\" \"United States\"",
      limit: 10,
      offset: 0,
      include_applied: true,
      include_ignored: true
    });

    assert.equal(postgresCalls, 0);
    assert.equal(result.count, 0);
    assert.equal(result.items.length, 0);
  } finally {
    console.warn = previousWarn;
    global.fetch = previousFetch;
    if (previousSearchBackend === undefined) {
      delete process.env.OPENJOBSLOTS_SEARCH_BACKEND;
    } else {
      process.env.OPENJOBSLOTS_SEARCH_BACKEND = previousSearchBackend;
    }
  }
}

async function testPostgresStructuredFiltersUseConservativeLocationFallbacks() {
  const previousSearchBackend = process.env.OPENJOBSLOTS_SEARCH_BACKEND;
  process.env.OPENJOBSLOTS_SEARCH_BACKEND = "sqlite";
  const calls = [];
  const pool = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (/SELECT COUNT\(\*\)::int AS count/i.test(sql)) {
        return { rows: [{ count: 1 }] };
      }
      return {
        rows: [{
          canonical_url: "https://example.com/technical-support-turkey",
          company_name: "Support Co",
          position_name: "Technical Support Engineer",
          location_text: "Remote - Istanbul, T\u00fcrkiye",
          country: "",
          region: "EMEA",
          remote_type: "unknown",
          ats_key: "greenhouse",
          last_seen_epoch: 123
        }]
      };
    }
  };

  try {
    const result = await listPostgresPostings(pool, {
      search: "Technical Support Engineer",
      countries: ["Turkey"],
      remote: "remote",
      limit: 10,
      offset: 0,
      include_applied: true,
      include_ignored: true
    });

    const countCall = calls.find((call) => /SELECT COUNT\(\*\)::int AS count/i.test(call.sql));
    assert.match(countCall.sql, /p\.location_text/);
    assert.match(countCall.sql, /p\.country IS NULL OR btrim\(p\.country\) = ''/);
    assert.match(countCall.sql, /p\.remote_type = /);
    assert.match(countCall.sql, /p\.remote_type = 'unknown'/);
    assert.ok(countCall.params.includes("%istanbul%"));
    assert.ok(countCall.params.includes("%remote%"));
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].country, "Turkey");
    assert.equal(result.items[0].region, "EMEA");
    assert.equal(result.items[0].remote_type, "remote");
  } finally {
    if (previousSearchBackend === undefined) {
      delete process.env.OPENJOBSLOTS_SEARCH_BACKEND;
    } else {
      process.env.OPENJOBSLOTS_SEARCH_BACKEND = previousSearchBackend;
    }
  }
}

async function testPublicPostingReadsDoNotWrite() {
  const previousSearchBackend = process.env.OPENJOBSLOTS_SEARCH_BACKEND;
  process.env.OPENJOBSLOTS_SEARCH_BACKEND = "sqlite";
  const calls = [];
  const pool = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (/SELECT COUNT\(\*\)::int AS count/i.test(sql)) return { rows: [{ count: 1 }] };
      if (isSourceFacetQuery(sql)) return createSourceFacetRows("fixture", 1);
      if (/SELECT\s+row_number\(\) OVER/i.test(sql)) {
        return {
          rows: [{
            id: 1,
            canonical_url: "https://example.com/jobs/1",
            company_name: "Read Co",
            position_name: "Support Engineer",
            location_text: "Remote - Istanbul, Turkey",
            country: "Turkey",
            region: "EMEA",
            remote_type: "remote",
            ats_key: "fixture",
            last_seen_epoch: 1778205600,
            applied: false,
            ignored: false
          }]
        };
      }
      throw new Error(`Unexpected query: ${sql}`);
    }
  };

  try {
    const result = await listPostgresPostings(pool, {
      search: "support",
      countries: ["Turkey"],
      remote: "remote",
      limit: 10,
      offset: 0,
      include_applied: true,
      include_ignored: true
    });
    assert.equal(result.items.length, 1);
    assert.ok(calls.length >= 2);
    for (const call of calls) {
      assert.match(call.sql.trim(), /^SELECT/i, `read endpoint query should be SELECT-only: ${call.sql}`);
    }
  } finally {
    if (previousSearchBackend === undefined) {
      delete process.env.OPENJOBSLOTS_SEARCH_BACKEND;
    } else {
      process.env.OPENJOBSLOTS_SEARCH_BACKEND = previousSearchBackend;
    }
  }
}

async function testPublicPostingsCapsLargeLimitAndOffset() {
  const previousSearchBackend = process.env.OPENJOBSLOTS_SEARCH_BACKEND;
  delete process.env.OPENJOBSLOTS_PUBLIC_POSTINGS_MAX_LIMIT;
  delete process.env.OPENJOBSLOTS_PUBLIC_POSTINGS_MAX_OFFSET;
  process.env.OPENJOBSLOTS_SEARCH_BACKEND = "sqlite";
  let selectLimit = null;
  let selectOffset = null;
  const pool = {
    async query(sql, params = []) {
      if (/SELECT COUNT\(\*\)::int AS count/i.test(sql)) return { rows: [{ count: 6000 }] };
      if (isSourceFacetQuery(sql)) return createSourceFacetRows("fixture", 1);
      if (/SELECT\s+row_number\(\) OVER/i.test(sql)) {
        selectLimit = params[params.length - 2];
        selectOffset = params[params.length - 1];
        return { rows: [] };
      }
      throw new Error(`Unexpected capped postings query: ${sql}`);
    }
  };

  try {
    const result = await listPostgresPostings(pool, {
      search: "director",
      limit: 5000,
      offset: 999999,
      include_applied: true,
      include_ignored: true
    });

    assert.equal(selectLimit, 500);
    assert.equal(selectOffset, 2000);
    assert.equal(result.limit, 500);
    assert.equal(result.offset, 2000);
  } finally {
    if (previousSearchBackend === undefined) {
      delete process.env.OPENJOBSLOTS_SEARCH_BACKEND;
    } else {
      process.env.OPENJOBSLOTS_SEARCH_BACKEND = previousSearchBackend;
    }
  }
}

async function testPostgresUpsertRejectsInvalidPostingsBeforeStorage() {
  const previousSearchBackend = process.env.OPENJOBSLOTS_SEARCH_BACKEND;
  process.env.OPENJOBSLOTS_SEARCH_BACKEND = "sqlite";
  const calls = [];
  const client = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      return { rows: [], rowCount: 0 };
    },
    release() {}
  };
  const pool = {
    async connect() {
      return client;
    }
  };

  try {
    await upsertPostgresPostings(pool, [
      { canonical_url: "", company_name: "Bad Co", position_name: "Engineer" },
      { canonical_url: "ftp://example.com/jobs/1", company_name: "Bad Co", position_name: "Engineer" },
      { canonical_url: "https://example.com/jobs/2", company_name: "Bad Co", position_name: "Untitled Position" },
      { canonical_url: "https://example.com/jobs/3", company_name: "", position_name: "Engineer" }
    ]);

    assert.ok(calls.some((call) => /^BEGIN$/i.test(call.sql)));
    assert.ok(calls.some((call) => /^COMMIT$/i.test(call.sql)));
    assert.equal(calls.some((call) => /INSERT INTO postings/i.test(call.sql)), false);
  } finally {
    if (previousSearchBackend === undefined) {
      delete process.env.OPENJOBSLOTS_SEARCH_BACKEND;
    } else {
      process.env.OPENJOBSLOTS_SEARCH_BACKEND = previousSearchBackend;
    }
  }
}

function testMeiliDocumentsCarryHiddenFlagSafely() {
  assert.equal(toMeiliPostingDocument({ canonical_url: "a", hidden: "false" }).hidden, false);
  assert.equal(toMeiliPostingDocument({ canonical_url: "b", hidden: "1" }).hidden, true);
  assert.equal(toMeiliPostingDocument({ canonical_url: "c", posting_date: "2026-05-07" }).posting_date, "2026-05-07");
}

function testMeiliDocumentsInferMissingSearchFacetsFromLocation() {
  const document = toMeiliPostingDocument({
    canonical_url: "https://example.com/technical-support-turkey",
    position_name: "Technical Support Engineer",
    company_name: "Support Co",
    location_text: "Remote - Istanbul, T\u00fcrkiye",
    remote_type: "unknown",
    city: "Istanbul",
    department: "Support",
    employment_type: "Full-time",
    description_plain: "Support customers in Turkey."
  });
  assert.equal(document.city, "Istanbul");
  assert.equal(document.country, "Turkey");
  assert.equal(document.region, "EMEA");
  assert.equal(document.remote_type, "remote");
  assert.equal(document.department, "Support");
  assert.equal(document.employment_type, "Full-time");
  assert.equal(document.description_plain, "Support customers in Turkey.");
}

async function testMeiliHideNoDateUsesPostingDatePresence() {
  const previousFetch = global.fetch;
  let body = null;
  global.fetch = async (_url, options = {}) => {
    body = JSON.parse(String(options.body || "{}"));
    return {
      ok: true,
      status: 200,
      async json() {
        return { hits: [], estimatedTotalHits: 0 };
      }
    };
  };

  try {
    await searchMeiliPostings(
      { search: "Technical Support Engineer", hide_no_date: true, limit: 10, offset: 0 },
      { enabled: true, host: "http://meili.test", apiKey: "", indexName: "postings" }
    );
    assert.match(body.filter, /posting_date EXISTS/);
    assert.match(body.filter, /posting_date IS NOT EMPTY/);
    assert.match(body.filter, /posting_date IS NOT NULL/);
    assert.doesNotMatch(body.filter, /posted_at_epoch > 0/);
  } finally {
    global.fetch = previousFetch;
  }
}

async function testMeiliSearchRequiresExplicitVisibleFlag() {
  const previousFetch = global.fetch;
  let body = null;
  global.fetch = async (_url, options = {}) => {
    body = JSON.parse(String(options.body || "{}"));
    return {
      ok: true,
      status: 200,
      async json() {
        return { hits: [], estimatedTotalHits: 0 };
      }
    };
  };

  try {
    await searchMeiliPostings(
      { search: "Director", limit: 10, offset: 0 },
      { enabled: true, host: "http://meili.test", apiKey: "", indexName: "postings" }
    );
    assert.match(body.filter, /hidden = false/);
    assert.doesNotMatch(body.filter, /NOT hidden = true/);
    assert.equal(body.matchingStrategy, "all");
  } finally {
    global.fetch = previousFetch;
  }
}

async function testMeiliSearchNormalizesGenericWordsAndTypos() {
  const previousFetch = global.fetch;
  const bodies = [];
  global.fetch = async (_url, options = {}) => {
    bodies.push(JSON.parse(String(options.body || "{}")));
    return {
      ok: true,
      status: 200,
      async json() {
        return { hits: [], estimatedTotalHits: 0 };
      }
    };
  };

  try {
    await searchMeiliPostings(
      { search: "turksih jobs", limit: 10, offset: 0 },
      { enabled: true, host: "http://meili.test", apiKey: "", indexName: "postings" }
    );
    await searchMeiliPostings(
      { search: "turkyie openings", limit: 10, offset: 0 },
      { enabled: true, host: "http://meili.test", apiKey: "", indexName: "postings" }
    );
    await searchMeiliPostings(
      { search: "remote jobs", limit: 10, offset: 0 },
      { enabled: true, host: "http://meili.test", apiKey: "", indexName: "postings" }
    );

    assert.equal(bodies[0].q, "turkish");
    assert.equal(bodies[1].q, "turkey");
    assert.equal(bodies[2].q, "remote");
  } finally {
    global.fetch = previousFetch;
  }
}

async function testMeiliSearchQuotesLikelyRolePhrases() {
  const previousFetch = global.fetch;
  let body = null;
  global.fetch = async (_url, options = {}) => {
    body = JSON.parse(String(options.body || "{}"));
    return {
      ok: true,
      status: 200,
      async json() {
        return { hits: [], estimatedTotalHits: 12 };
      }
    };
  };

  try {
    await searchMeiliPostings(
      { search: "Customer Success Engineer", sort_by: "posted_date", limit: 10, offset: 0 },
      { enabled: true, host: "http://meili.test", apiKey: "", indexName: "postings" }
    );

    assert.equal(body.q, "\"customer success engineer\"");
    assert.deepEqual(body.sort, ["posted_at_epoch:desc", "last_seen_epoch:desc"]);
  } finally {
    global.fetch = previousFetch;
  }
}

async function testMeiliSearchLeavesLocationQueriesBroad() {
  const previousFetch = global.fetch;
  let body = null;
  global.fetch = async (_url, options = {}) => {
    body = JSON.parse(String(options.body || "{}"));
    return {
      ok: true,
      status: 200,
      async json() {
        return { hits: [], estimatedTotalHits: 12 };
      }
    };
  };

  try {
    await searchMeiliPostings(
      { search: "Product Manager in Berlin", sort_by: "posted_date", limit: 10, offset: 0 },
      { enabled: true, host: "http://meili.test", apiKey: "", indexName: "postings" }
    );

    assert.equal(body.q, "product manager in berlin");
  } finally {
    global.fetch = previousFetch;
  }
}

async function testMeiliSearchFallsBackWhenExactRolePhraseHasNoHits() {
  const previousFetch = global.fetch;
  const bodies = [];
  global.fetch = async (_url, options = {}) => {
    bodies.push(JSON.parse(String(options.body || "{}")));
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          hits: [],
          estimatedTotalHits: bodies.length === 1 ? 0 : 3
        };
      }
    };
  };

  try {
    await searchMeiliPostings(
      { search: "Customer Success Engineer", sort_by: "posted_date", limit: 10, offset: 0 },
      { enabled: true, host: "http://meili.test", apiKey: "", indexName: "postings" }
    );

    assert.equal(bodies.length, 2);
    assert.equal(bodies[0].q, "\"customer success engineer\"");
    assert.equal(bodies[1].q, "customer success engineer");
  } finally {
    global.fetch = previousFetch;
  }
}

function testPostgresSearchRankPrioritizesTitleCompanyBeforeDescription() {
  const rank = buildSearchRankSql("software engineer jobs", 7);
  assert.match(rank.sql, /p\.position_name[\s\S]*THEN 40/);
  assert.match(rank.sql, /p\.company_name[\s\S]*THEN 30/);
  assert.match(rank.sql, /p\.description_plain[\s\S]*THEN 5/);
  assert.deepEqual(rank.values, ["%software engineer%"]);
  assert.equal(rank.nextIndex, 8);
}

function testRetentionDefaultsUseLastSeenPolicy() {
  const config = getRetentionConfig({});
  assert.equal(config.hotDays, 30);
  assert.equal(config.hiddenRetentionDays, 180);
  assert.equal(config.cacheMetadataDays, 365);
  assert.equal(config.runSummaryDays, 365);
  assert.equal(config.detailedErrorDays, 90);

  const cutoffs = getRetentionCutoffs(200 * 24 * 60 * 60, config);
  assert.equal(cutoffs.staleVisibleEpoch, 170 * 24 * 60 * 60);
  assert.equal(cutoffs.hiddenArchiveEpoch, 20 * 24 * 60 * 60);
}

async function testPrunePostgresRetentionUsesLastSeenAndOutboxDeletes() {
  const calls = [];
  const client = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (/SELECT canonical_url\s+FROM postings/i.test(sql)) {
        return { rows: [{ canonical_url: "https://example.com/old" }] };
      }
      if (/UPDATE postings\s+SET hidden = true/i.test(sql)) return { rowCount: 1, rows: [] };
      if (/INSERT INTO search_index_outbox/i.test(sql)) return { rowCount: 1, rows: [] };
      if (/DELETE FROM postings/i.test(sql)) return { rowCount: 2, rows: [] };
      if (/DELETE FROM posting_cache/i.test(sql)) return { rowCount: 3, rows: [] };
      if (/DELETE FROM ingestion_run_errors/i.test(sql)) return { rowCount: 4, rows: [] };
      if (/DELETE FROM ingestion_runs/i.test(sql)) return { rowCount: 5, rows: [] };
      if (/DELETE FROM search_index_outbox/i.test(sql)) return { rowCount: 6, rows: [] };
      return { rowCount: 0, rows: [] };
    },
    release() {}
  };
  const pool = {
    async connect() {
      return client;
    }
  };

  const result = await prunePostgresRetention(pool, {
    referenceEpoch: 200 * 24 * 60 * 60,
    batchSize: 1
  });

  const pruneSelect = calls.find((call) => /SELECT canonical_url\s+FROM postings/i.test(call.sql));
  assert.match(pruneSelect.sql, /last_seen_epoch < \$1/);
  assert.doesNotMatch(pruneSelect.sql, /first_seen_epoch/);
  assert.equal(result.stats.hidden_postings, 1);
  assert.equal(result.stats.outbox_delete_rows, 1);
  assert.ok(calls.some((call) => /INSERT INTO search_index_outbox/i.test(call.sql)));
}

async function testProcessSearchOutboxDeletesWithoutMeiliWhenDisabled() {
  const previousBackend = process.env.OPENJOBSLOTS_SEARCH_BACKEND;
  process.env.OPENJOBSLOTS_SEARCH_BACKEND = "sqlite";
  const calls = [];
  const pool = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (/FROM search_index_outbox/i.test(sql)) {
        return {
          rows: [
            { id: 1, canonical_url: "https://example.com/old", operation: "delete", payload: {} }
          ]
        };
      }
      if (/UPDATE search_index_outbox/i.test(sql)) return { rowCount: 1, rows: [] };
      throw new Error(`Unexpected query: ${sql}`);
    }
  };

  try {
    const result = await processPostgresSearchIndexOutbox(pool);
    assert.equal(result.processed, 1);
    assert.equal(result.deleted, 1);
    assert.ok(calls.some((call) => /UPDATE search_index_outbox/i.test(call.sql)));
  } finally {
    if (previousBackend === undefined) {
      delete process.env.OPENJOBSLOTS_SEARCH_BACKEND;
    } else {
      process.env.OPENJOBSLOTS_SEARCH_BACKEND = previousBackend;
    }
  }
}

async function testPostgresSuggestionsUseMeiliWhenConfigured() {
  const previousBackend = process.env.OPENJOBSLOTS_SEARCH_BACKEND;
  const previousHost = process.env.MEILI_HOST;
  const previousIndex = process.env.MEILI_POSTINGS_INDEX;
  const previousFetch = global.fetch;
  const fetchCalls = [];
  process.env.OPENJOBSLOTS_SEARCH_BACKEND = "meili";
  process.env.MEILI_HOST = "http://meili.test";
  process.env.MEILI_POSTINGS_INDEX = "postings";
  global.fetch = async (url, options = {}) => {
    fetchCalls.push({ url: String(url), body: JSON.parse(String(options.body || "{}")) });
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          hits: [
            {
              title: "Software Engineer",
              company: "Engineering Labs",
              location: "Istanbul, Turkey",
              ats_key: "greenhouse"
            },
            {
              title: "Software Engineer",
              company: "Globex",
              location: "Engineering City",
              ats_key: "lever"
            }
          ],
          estimatedTotalHits: 2
        };
      }
    };
  };
  const pool = {
    async query(sql) {
      throw new Error(`Postgres suggestion fallback should not run when Meili has candidates: ${sql}`);
    }
  };

  try {
    const suggestions = await getPostgresSuggestions(pool, "engineer", 3, []);
    assert.equal(fetchCalls.length, 1);
    assert.match(fetchCalls[0].url, /\/indexes\/postings\/search$/);
    assert.equal(fetchCalls[0].body.q, "engineer");
    assert.equal(fetchCalls[0].body.matchingStrategy, "all");
    assert.ok(suggestions.some((item) => item.type === "title" && item.value === "Software Engineer"));
    assert.ok(suggestions.some((item) => item.type === "company" && item.value === "Engineering Labs"));
    assert.ok(suggestions.some((item) => item.type === "location" && item.value === "Engineering City"));
  } finally {
    if (previousBackend === undefined) delete process.env.OPENJOBSLOTS_SEARCH_BACKEND;
    else process.env.OPENJOBSLOTS_SEARCH_BACKEND = previousBackend;
    if (previousHost === undefined) delete process.env.MEILI_HOST;
    else process.env.MEILI_HOST = previousHost;
    if (previousIndex === undefined) delete process.env.MEILI_POSTINGS_INDEX;
    else process.env.MEILI_POSTINGS_INDEX = previousIndex;
    global.fetch = previousFetch;
  }
}

async function testPostgresSuggestionsSkipUnmatchedMeiliHitFields() {
  const previousBackend = process.env.OPENJOBSLOTS_SEARCH_BACKEND;
  const previousHost = process.env.MEILI_HOST;
  const previousIndex = process.env.MEILI_POSTINGS_INDEX;
  const previousFetch = global.fetch;
  const fetchCalls = [];
  process.env.OPENJOBSLOTS_SEARCH_BACKEND = "meili";
  process.env.MEILI_HOST = "http://meili.test";
  process.env.MEILI_POSTINGS_INDEX = "postings";
  global.fetch = async (url, options = {}) => {
    fetchCalls.push({ url: String(url), body: JSON.parse(String(options.body || "{}")) });
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          hits: [
            {
              title: "Product Manager",
              company: "ortnec",
              location: "Montreal, QC",
              ats_key: "ashby"
            },
            {
              title: "Senior Product Manager",
              company: "emedlabsllc",
              location: "Miami, FL",
              ats_key: "greenhouse"
            }
          ],
          estimatedTotalHits: 2
        };
      }
    };
  };
  const pool = {
    async query(sql) {
      throw new Error(`Postgres suggestion fallback should not run when Meili has matching candidates: ${sql}`);
    }
  };

  try {
    const suggestions = await getPostgresSuggestions(pool, "Product Manager", 2, []);
    assert.equal(fetchCalls.length, 1);
    assert.ok(suggestions.some((item) => item.type === "title" && item.value === "Product Manager"));
    assert.ok(suggestions.some((item) => item.type === "title" && item.value === "Senior Product Manager"));
    assert.equal(suggestions.some((item) => item.value === "ortnec"), false);
    assert.equal(suggestions.some((item) => item.value === "Montreal, QC"), false);
    assert.equal(suggestions.some((item) => item.value === "emedlabsllc"), false);
    assert.equal(suggestions.some((item) => item.value === "Miami, FL"), false);
  } finally {
    if (previousBackend === undefined) delete process.env.OPENJOBSLOTS_SEARCH_BACKEND;
    else process.env.OPENJOBSLOTS_SEARCH_BACKEND = previousBackend;
    if (previousHost === undefined) delete process.env.MEILI_HOST;
    else process.env.MEILI_HOST = previousHost;
    if (previousIndex === undefined) delete process.env.MEILI_POSTINGS_INDEX;
    else process.env.MEILI_POSTINGS_INDEX = previousIndex;
    global.fetch = previousFetch;
  }
}

async function testPostgresSuggestionsFallbackAvoidsUnaccentSeqScanPath() {
  const previousBackend = process.env.OPENJOBSLOTS_SEARCH_BACKEND;
  process.env.OPENJOBSLOTS_SEARCH_BACKEND = "postgres";
  const calls = [];
  const pool = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      return {
        rows: [
          { type: "title", value: "Support Engineer", count: 4 },
          { type: "company", value: "Engineering Labs", count: 2 }
        ]
      };
    }
  };

  try {
    const suggestions = await getPostgresSuggestions(pool, "engineer", 5, []);
    assert.equal(calls.length, 1);
    assert.doesNotMatch(calls[0].sql, /unaccent/i);
    assert.match(calls[0].sql, /lower\(position_name\) LIKE lower\(\$1\)/i);
    assert.match(calls[0].sql, /ESCAPE '\\'/);
    assert.deepEqual(calls[0].params, ["%engineer%", 20]);
    assert.equal(suggestions[0].value, "Support Engineer");
  } finally {
    if (previousBackend === undefined) delete process.env.OPENJOBSLOTS_SEARCH_BACKEND;
    else process.env.OPENJOBSLOTS_SEARCH_BACKEND = previousBackend;
  }
}

async function testPostgresCountsCacheReusesShortTtlSnapshot() {
  const calls = [];
  const pool = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (/SELECT COUNT\(\*\)::int AS count FROM companies;/i.test(sql)) return { rows: [{ count: 20 }] };
      if (/FROM companies c\s+INNER JOIN ats_sources s/i.test(sql)) return { rows: [{ count: 12 }] };
      if (/configured_enabled_ats_count/i.test(sql)) {
        return {
          rows: [{
            configured_enabled_ats_count: 18,
            full_enabled_ats_count: 12,
            canary_enabled_ats_count: 4,
            quarantine_only_ats_count: 2,
            disabled_ats_count: 44,
            worker_auto_eligible_ats_count: 16
          }]
        };
      }
      if (/SELECT COUNT\(\*\)::int AS count FROM ats_sources;/i.test(sql)) return { rows: [{ count: 62 }] };
      if (/COUNT\(DISTINCT NULLIF\(company_name/i.test(sql)) return { rows: [{ count: 8 }] };
      if (/COUNT\(DISTINCT ats_key/i.test(sql)) return { rows: [{ count: 3 }] };
      if (/FROM postings WHERE hidden = false AND last_seen_epoch/i.test(sql)) return { rows: [{ count: 7 }] };
      if (/FROM postings WHERE hidden = false/i.test(sql)) return { rows: [{ count: 30 }] };
      if (/SELECT ats_key, COUNT\(\*\)::int AS count FROM companies/i.test(sql)) return { rows: [{ ats_key: "greenhouse", count: 2 }] };
      throw new Error(`Unexpected count query: ${sql}`);
    }
  };

  const first = await getPostgresCounts(pool, { nowMs: 1000, cacheTtlMs: 30000 });
  const second = await getPostgresCounts(pool, { nowMs: 2000, cacheTtlMs: 30000 });
  assert.equal(calls.length, 9);
  assert.deepEqual(second, first);

  second.company_count_by_ats.greenhouse = 99;
  const third = await getPostgresCounts(pool, { nowMs: 3000, cacheTtlMs: 30000 });
  assert.equal(third.company_count_by_ats.greenhouse, 2);

  await getPostgresCounts(pool, { nowMs: 32000, cacheTtlMs: 30000 });
  assert.equal(calls.length, 18);
}

async function testPayloadDriftDoesNotBootstrapEmptyShapes() {
  const calls = [];
  const pool = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (/FROM source_payload_shapes/i.test(sql)) return { rows: [] };
      throw new Error(`Empty payload shape should not be written: ${sql}`);
    }
  };

  const result = await checkAndRecordPostgresPayloadDrift(
    pool,
    { atsKey: "applitrack", companyUrl: "https://example.com", company: { company_name: "Example" } },
    [],
    "source-applitrack-v1"
  );

  assert.equal(result.drift, false);
  assert.equal(result.skipped_empty_shape, true);
  assert.equal(calls.length, 0);
}

async function testPayloadDriftReplacesEmptyBaselineWithFirstInformativeShape() {
  const calls = [];
  const pool = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (/FROM source_payload_shapes/i.test(sql)) {
        return { rows: [{ shape_hash: "e3b0c44298fc1c149afbf4c8", shape_paths: [], observed_count: 12 }] };
      }
      if (/UPDATE source_payload_shapes/i.test(sql)) return { rowCount: 1, rows: [] };
      throw new Error(`Unexpected payload drift query: ${sql}`);
    }
  };

  const result = await checkAndRecordPostgresPayloadDrift(
    pool,
    { atsKey: "applytojob", companyUrl: "https://example.applytojob.com/apply", company: { company_name: "Example" } },
    { jobs: [{ id: "1", title: "Engineer", location: "Remote" }] },
    "source-applytojob-v1"
  );

  assert.equal(result.drift, false);
  assert.equal(result.baseline_replaced, true);
  assert.ok(calls.some((call) => /UPDATE source_payload_shapes/i.test(call.sql)));
  assert.ok(calls.every((call) => !/INSERT INTO parser_drift_events/i.test(call.sql)));
}

async function testPostgresCountsExposePublicStatsCounters() {
  const pool = {
    async query(sql, params = []) {
      if (/SELECT COUNT\(\*\)::int AS count FROM companies;/i.test(sql)) return { rows: [{ count: 40860 }] };
      if (/FROM companies c\s+INNER JOIN ats_sources s/i.test(sql)) return { rows: [{ count: 27511 }] };
      if (/configured_enabled_ats_count/i.test(sql)) {
        return {
          rows: [{
            configured_enabled_ats_count: 55,
            full_enabled_ats_count: 14,
            canary_enabled_ats_count: 34,
            quarantine_only_ats_count: 7,
            disabled_ats_count: 7,
            worker_auto_eligible_ats_count: 48
          }]
        };
      }
      if (/SELECT COUNT\(\*\)::int AS count FROM ats_sources;/i.test(sql)) return { rows: [{ count: 62 }] };
      if (/COUNT\(DISTINCT NULLIF\(company_name/i.test(sql)) return { rows: [{ count: 8076 }] };
      if (/COUNT\(DISTINCT ats_key/i.test(sql)) return { rows: [{ count: 18 }] };
      if (/FROM postings WHERE hidden = false AND last_seen_epoch/i.test(sql)) return { rows: [{ count: 48451 }] };
      if (/FROM postings WHERE hidden = false/i.test(sql)) return { rows: [{ count: 157355 }] };
      if (/SELECT ats_key, COUNT\(\*\)::int AS count FROM companies/i.test(sql)) return { rows: [{ ats_key: "greenhouse", count: 44 }] };
      throw new Error(`Unexpected public stats count query: ${sql}`);
    }
  };

  const counts = await getPostgresCounts(pool, { force: true, nowMs: 1000, cacheTtlMs: 30000 });
  assert.equal(counts.posting_count, 157355);
  assert.equal(counts.job_slot_count, 157355);
  assert.equal(counts.company_count, 40860);
  assert.equal(counts.visible_company_count, 8076);
  assert.equal(counts.configured_enabled_ats_count, 55);
  assert.equal(counts.full_enabled_ats_count, 14);
  assert.equal(counts.canary_enabled_ats_count, 34);
  assert.equal(counts.quarantine_only_ats_count, 7);
  assert.equal(counts.disabled_ats_count, 7);
  assert.equal(counts.worker_auto_eligible_ats_count, 48);
  assert.equal(counts.configured_ats_count, 62);
  assert.equal(counts.visible_ats_count, 18);
}

async function testPayloadDriftReplacesEmptyArrayBaselineWithPopulatedShape() {
  const calls = [];
  const pool = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (/FROM source_payload_shapes/i.test(sql)) {
        return {
          rows: [{
            shape_hash: "empty-jobs",
            shape_paths: [
              "__sourceConfig.account:string",
              "__sourceConfig.apiUrl:string",
              "__sourceConfig.publicJobsUrl:string",
              "__sourceConfig:object",
              "data.jobs:array",
              "data.jobs[]:empty",
              "data:object"
            ],
            observed_count: 13
          }]
        };
      }
      if (/UPDATE source_payload_shapes/i.test(sql)) return { rowCount: 1, rows: [] };
      throw new Error(`Unexpected payload drift query: ${sql}`);
    }
  };

  const result = await checkAndRecordPostgresPayloadDrift(
    pool,
    { atsKey: "recruitcrm", companyUrl: "https://recruitcrm.io/jobs/acme", company: { company_name: "Acme" } },
    {
      data: {
        jobs: [
          {
            srno: "1",
            slug: "remote-engineer",
            name: "Remote Engineer",
            remote: "1",
            city: "Berlin"
          }
        ]
      },
      __sourceConfig: {
        account: "acme",
        apiUrl: "https://albatross.recruitcrm.io/v1/external-pages/jobs-by-account/get?account=acme&batch=true",
        publicJobsUrl: "https://recruitcrm.io/jobs/acme"
      }
    },
    "source-recruitcrm-v1"
  );

  assert.equal(result.drift, false);
  assert.equal(result.baseline_replaced, true);
  assert.ok(calls.some((call) => /UPDATE source_payload_shapes/i.test(call.sql)));
  assert.ok(calls.every((call) => !/INSERT INTO parser_drift_events/i.test(call.sql)));
}

async function testPayloadDriftTreatsExplicitEmptyJobListAsNoJobs() {
  const calls = [];
  const pool = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (/FROM source_payload_shapes/i.test(sql)) {
        return {
          rows: [{
            shape_hash: "populated-bamboo",
            shape_paths: [
              "__sourceConfig.baseOrigin:string",
              "__sourceConfig.boardUrl:string",
              "__sourceConfig:object",
              "meta.totalCount:number",
              "meta:object",
              "result:array",
              "result[].id:string",
              "result[].jobOpeningName:string"
            ],
            observed_count: 42
          }]
        };
      }
      throw new Error(`Empty job list should not write drift or replace baseline: ${sql}`);
    }
  };

  const result = await checkAndRecordPostgresPayloadDrift(
    pool,
    { atsKey: "bamboohr", companyUrl: "https://empty.bamboohr.com/careers", company: { company_name: "Empty Bamboo" } },
    {
      meta: { totalCount: 0 },
      result: [],
      __sourceConfig: {
        baseOrigin: "https://empty.bamboohr.com",
        boardUrl: "https://empty.bamboohr.com/careers"
      }
    },
    "source-bamboohr-v1"
  );

  assert.equal(result.drift, false);
  assert.equal(result.empty_no_jobs, true);
  assert.ok(calls.every((call) => !/INSERT INTO parser_drift_events/i.test(call.sql)));
  assert.ok(calls.every((call) => !/UPDATE source_payload_shapes/i.test(call.sql)));
}

async function testPublicSearchEventInsertIsPrivacyBounded() {
  const calls = [];
  const pool = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      return { rowCount: 1, rows: [] };
    }
  };

  const result = await recordPostgresPublicSearchEvent(pool, {
    eventType: "postings",
    search: "  Technical   Support Engineer  ",
    resultCount: 42,
    resultItems: 5,
    limit: 80,
    offset: 0,
    sortBy: "relevance",
    remote: "all",
    ats: ["lever", "ashby"],
    countries: ["Turkey", "United States"],
    regions: ["North America"],
    referrer: "https://www.google.com/search?q=openjobslots",
    userAgent: "Mozilla/5.0 Firefox/151.0",
    cacheStatus: "MISS",
    anonymousSessionKey: "a".repeat(64),
    ip: "203.0.113.10"
  });

  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /INSERT INTO public_search_events/i);
  assert.doesNotMatch(calls[0].sql, /ip/i);
  assert.doesNotMatch(calls[0].sql, /user_agent_raw/i);
  assert.doesNotMatch(calls[0].sql, /referrer_url/i);
  assert.deepEqual(calls[0].params.slice(0, 4), [
    "postings",
    "Technical Support Engineer",
    "technical support engineer",
    42
  ]);
  assert.equal(calls[0].params[11], "www.google.com");
  assert.equal(calls[0].params[12], "Firefox");
  assert.equal(calls[0].params[15], "a".repeat(64));
  assert.equal(calls[0].params[16], "Turkey,United States");
  assert.equal(calls[0].params[17], "North America");
}

async function testPublicSearchReportAggregatesTopTermsReadOnly() {
  const calls = [];
  const pool = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (/GROUP BY event_type/i.test(sql)) {
        return { rows: [{ event_type: "postings", count: "3" }, { event_type: "suggest", count: "5" }] };
      }
      if (/information_schema\.columns/i.test(sql)) {
        return { rows: [{ has_country_filters: true }] };
      }
      if (/COUNT\(\*\)::int AS total_events/i.test(sql)) {
        return { rows: [{ total_events: "8", anonymous_session_count: "2" }] };
      }
      if (/regexp_split_to_table\(country_filters/i.test(sql)) {
        return { rows: [{ country_filter: "Turkey", count: "4" }, { country_filter: "United States", count: "2" }] };
      }
      if (/AS remote_filter/i.test(sql) && /GROUP BY/i.test(sql)) {
        return { rows: [{ remote_filter: "remote", count: "4" }, { remote_filter: "all", count: "3" }] };
      }
      if (/GROUP BY query_normalized/i.test(sql) && /result_count\s*=\s*0/i.test(sql)) {
        return {
          rows: [
            { query_normalized: "wordpress", count: "2", first_seen_at: "2026-05-22T10:00:00Z", last_seen_at: "2026-05-22T10:05:00Z" }
          ]
        };
      }
      if (/GROUP BY query_normalized/i.test(sql) && /result_count BETWEEN 1 AND 9/i.test(sql)) {
        return {
          rows: [
            { query_normalized: "teacher", count: "3", first_seen_at: "2026-05-22T11:00:00Z", last_seen_at: "2026-05-22T11:05:00Z" }
          ]
        };
      }
      if (/GROUP BY query_normalized/i.test(sql)) {
        return {
          rows: [
            { query_normalized: "technical support", count: "4", first_seen_at: "2026-05-22T09:00:00Z", last_seen_at: "2026-05-22T09:10:00Z" },
            { query_normalized: "wordpress", count: "2", first_seen_at: "2026-05-22T10:00:00Z", last_seen_at: "2026-05-22T10:05:00Z" }
          ]
        };
      }
      if (/GROUP BY referrer_host/i.test(sql)) {
        return { rows: [{ referrer_host: "www.google.com", count: "2" }] };
      }
      if (/GROUP BY user_agent_family/i.test(sql)) {
        return { rows: [{ user_agent_family: "Firefox", count: "3" }] };
      }
      if (/AS result_bucket/i.test(sql)) {
        return {
          rows: [
            { result_bucket: "zero_result", count: "1" },
            { result_bucket: "low_result", count: "2" },
            { result_bucket: "normal_result", count: "5" }
          ]
        };
      }
      if (/GROUP BY cache_status/i.test(sql)) {
        return { rows: [{ cache_status: "HIT", count: "6" }, { cache_status: "MISS", count: "2" }] };
      }
      throw new Error(`Unexpected public search report query: ${sql}`);
    }
  };

  const report = await getPostgresPublicSearchReport(pool, {
    date: "2026-05-22",
    timezone: "Europe/Istanbul",
    limit: 10
  });

  assert.equal(report.ok, true);
  assert.equal(report.read_only, true);
  assert.equal(report.date, "2026-05-22");
  assert.equal(report.total_events, 8);
  assert.equal(report.anonymous_session_count, 2);
  assert.equal(report.event_counts.postings, 3);
  assert.equal(report.event_counts.suggest, 5);
  assert.deepEqual(report.top_endpoint, { endpoint: "/search/suggest", event_type: "suggest", count: 5 });
  assert.equal(report.result_count_distribution.zero_result, 1);
  assert.equal(report.result_count_distribution.low_result, 2);
  assert.equal(report.result_count_distribution.normal_result, 5);
  assert.equal(report.cache_status_counts.HIT, 6);
  assert.equal(report.cache_status_counts.MISS, 2);
  assert.equal(report.cache_hit_rate, 0.75);
  assert.equal(report.top_terms[0].query, "technical support");
  assert.deepEqual(report.top_zero_result_queries, [{ query: "wordpress", count: 2, first_seen_at: "2026-05-22T10:00:00Z", last_seen_at: "2026-05-22T10:05:00Z" }]);
  assert.deepEqual(report.top_low_result_queries, [{ query: "teacher", count: 3, first_seen_at: "2026-05-22T11:00:00Z", last_seen_at: "2026-05-22T11:05:00Z" }]);
  assert.deepEqual(report.top_country_filters, [
    { value: "Turkey", count: 4 },
    { value: "United States", count: 2 }
  ]);
  assert.equal(report.remote_filter_counts.remote, 4);
  assert.equal(report.remote_filter_counts.all, 3);
  assert.equal(report.remote_filter_counts.hybrid, 0);
  assert.ok(calls.every((call) => /^\s*SELECT/i.test(call.sql)));
}

async function testPublicSearchReportResolvesTodayInRequestedTimezone() {
  const calls = [];
  const pool = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (/COUNT\(\*\)::int AS total_events/i.test(sql)) {
        return { rows: [{ total_events: "0", anonymous_session_count: "0" }] };
      }
      if (/information_schema\.columns/i.test(sql)) {
        return { rows: [{ has_country_filters: false }] };
      }
      return { rows: [] };
    }
  };

  const report = await getPostgresPublicSearchReport(pool, {
    date: "today",
    timezone: "Europe/Istanbul",
    now: new Date("2026-05-21T22:30:00.000Z")
  });

  assert.equal(report.date, "2026-05-22");
  assert.ok(calls.filter((call) => call.params.length > 0).every((call) => call.params[0] === "2026-05-22"));
}

async function main() {
  await testRequestSyncStartCastsEpochFields();
  await testRequestSyncStopCastsEpochFields();
  await testSyncStatusReportsQueuedSeparatelyFromRunning();
  await testSyncStatusReportsRunningForActiveWorkerOnly();
  await testSyncStatusDefaultsToPostgresSyncControlQueue();
  await testSyncStatusIncludesWorkerBudgetAndFailureTaxonomy();
  await testSyncStatusCanSkipWorkerDiagnosticsForPublicStatus();
  await testParserAttentionGroupsCareerplugRejectionReasons();
  await testAtsFieldQualityReportsFieldGapsByAts();
  await testIngestionErrorsEndpointQueryIsBounded();
  await testIngestionSourcesReportDueAndFailurePressure();
  await testHydratePostgresPostingsKeepsSafetyAndFilterGuards();
  await testMeiliPostgresPathHydratesBeforeCounting();
  await testUnderfilledMeiliHydrationFallsBackToPostgres();
  await testEmptyMeiliSearchReturnsFastZero();
  await testPostgresStructuredFiltersUseConservativeLocationFallbacks();
  await testPublicPostingReadsDoNotWrite();
  await testPublicPostingsCapsLargeLimitAndOffset();
  await testPostgresUpsertRejectsInvalidPostingsBeforeStorage();
  testMeiliDocumentsCarryHiddenFlagSafely();
  testMeiliDocumentsInferMissingSearchFacetsFromLocation();
  await testMeiliHideNoDateUsesPostingDatePresence();
  await testMeiliSearchRequiresExplicitVisibleFlag();
  await testMeiliSearchNormalizesGenericWordsAndTypos();
  await testMeiliSearchQuotesLikelyRolePhrases();
  await testMeiliSearchLeavesLocationQueriesBroad();
  await testMeiliSearchFallsBackWhenExactRolePhraseHasNoHits();
  testPostgresSearchRankPrioritizesTitleCompanyBeforeDescription();
  testRetentionDefaultsUseLastSeenPolicy();
  await testPrunePostgresRetentionUsesLastSeenAndOutboxDeletes();
  await testProcessSearchOutboxDeletesWithoutMeiliWhenDisabled();
  await testPostgresSuggestionsUseMeiliWhenConfigured();
  await testPostgresSuggestionsSkipUnmatchedMeiliHitFields();
  await testPostgresSuggestionsFallbackAvoidsUnaccentSeqScanPath();
  await testPostgresCountsCacheReusesShortTtlSnapshot();
  await testPostgresCountsExposePublicStatsCounters();
  await testPayloadDriftDoesNotBootstrapEmptyShapes();
  await testPayloadDriftReplacesEmptyBaselineWithFirstInformativeShape();
  await testPayloadDriftReplacesEmptyArrayBaselineWithPopulatedShape();
  await testPayloadDriftTreatsExplicitEmptyJobListAsNoJobs();
  await testPublicSearchEventInsertIsPrivacyBounded();
  await testPublicSearchReportAggregatesTopTermsReadOnly();
  await testPublicSearchReportResolvesTodayInRequestedTimezone();
  console.log("postgres sync-control bigint cast tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
