const assert = require("node:assert/strict");
const {
  getPostgresSyncStatus,
  getRetentionConfig,
  getRetentionCutoffs,
  hydratePostgresPostings,
  listPostgresPostings,
  processPostgresSearchIndexOutbox,
  prunePostgresRetention,
  requestSyncStart,
  requestSyncStop
} = require("./postgresStore");
const { searchMeiliPostings, toMeiliPostingDocument } = require("../search/meili");

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

function createStatusMockPool(controlStatus = "requested") {
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
      if (/SELECT \* FROM ingestion_runs/i.test(sql)) {
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
            active_ats: ["greenhouse"],
            last_error: ""
          }]
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
      if (/SELECT COUNT\(\*\)::int AS count FROM ats_sources WHERE enabled = true/i.test(sql)) {
        return { rows: [{ count: 57 }] };
      }
      if (/FROM companies c\s+INNER JOIN ats_sources s/i.test(sql)) {
        return { rows: [{ count: 18 }] };
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

async function testHydratePostgresPostingsKeepsHiddenAndFilterGuards() {
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

async function testEmptyMeiliSearchFallsBackToPostgres() {
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

    assert.equal(postgresCalls, 2);
    assert.equal(result.count, 1);
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].position_name, "Director");
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
    remote_type: "unknown"
  });
  assert.equal(document.country, "Turkey");
  assert.equal(document.region, "EMEA");
  assert.equal(document.remote_type, "remote");
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
  } finally {
    global.fetch = previousFetch;
  }
}

function testRetentionDefaultsUseLastSeenPolicy() {
  const config = getRetentionConfig({});
  assert.equal(config.hotDays, 90);
  assert.equal(config.hiddenRetentionDays, 180);
  assert.equal(config.cacheMetadataDays, 365);
  assert.equal(config.runSummaryDays, 365);
  assert.equal(config.detailedErrorDays, 90);

  const cutoffs = getRetentionCutoffs(200 * 24 * 60 * 60, config);
  assert.equal(cutoffs.staleVisibleEpoch, 110 * 24 * 60 * 60);
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

async function main() {
  await testRequestSyncStartCastsEpochFields();
  await testRequestSyncStopCastsEpochFields();
  await testSyncStatusReportsQueuedSeparatelyFromRunning();
  await testSyncStatusReportsRunningForActiveWorkerOnly();
  await testSyncStatusDefaultsToPostgresSyncControlQueue();
  await testHydratePostgresPostingsKeepsHiddenAndFilterGuards();
  await testMeiliPostgresPathHydratesBeforeCounting();
  await testUnderfilledMeiliHydrationFallsBackToPostgres();
  await testEmptyMeiliSearchFallsBackToPostgres();
  await testPostgresStructuredFiltersUseConservativeLocationFallbacks();
  testMeiliDocumentsCarryHiddenFlagSafely();
  testMeiliDocumentsInferMissingSearchFacetsFromLocation();
  await testMeiliHideNoDateUsesPostingDatePresence();
  await testMeiliSearchRequiresExplicitVisibleFlag();
  testRetentionDefaultsUseLastSeenPolicy();
  await testPrunePostgresRetentionUsesLastSeenAndOutboxDeletes();
  await testProcessSearchOutboxDeletesWithoutMeiliWhenDisabled();
  console.log("postgres sync-control bigint cast tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
