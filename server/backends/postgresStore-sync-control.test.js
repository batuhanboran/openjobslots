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
const { toMeiliPostingDocument } = require("../search/meili");

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
      search: "engineer",
      countries: ["Turkey"],
      include_applied: true,
      include_ignored: true
    }
  );

  assert.match(captured.sql, /p\.hidden = false/);
  assert.match(captured.sql, /p\.country IN \(\$2\)/);
  assert.match(captured.sql, /lower\(unaccent\(p\.position_name\)\)/);
  assert.deepEqual(captured.params[0], ["https://example.com/hidden", "https://example.com/visible"]);
  assert.equal(captured.params[1], "Turkey");
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
      search: "engineer",
      limit: 10,
      offset: 0,
      include_applied: true,
      include_ignored: true
    });

    assert.match(searchBody.filter, /NOT hidden = true/);
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

function testMeiliDocumentsCarryHiddenFlagSafely() {
  assert.equal(toMeiliPostingDocument({ canonical_url: "a", hidden: "false" }).hidden, false);
  assert.equal(toMeiliPostingDocument({ canonical_url: "b", hidden: "1" }).hidden, true);
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
  testMeiliDocumentsCarryHiddenFlagSafely();
  testRetentionDefaultsUseLastSeenPolicy();
  await testPrunePostgresRetentionUsesLastSeenAndOutboxDeletes();
  await testProcessSearchOutboxDeletesWithoutMeiliWhenDisabled();
  console.log("postgres sync-control bigint cast tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
