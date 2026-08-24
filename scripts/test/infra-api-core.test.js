const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { registerPublicRoutes } = require("../../server/http/registerPublicRoutes");
const {
  getPostgresCounts,
  listPostgresPostings
} = require("../../server/backends/postgresStore");

function createCountPool() {
  const calls = [];
  return {
    calls,
    async query(sql) {
      calls.push(String(sql));
      if (/COUNT\(\*\)::int AS count FROM companies;/i.test(sql)) return { rows: [{ count: 10 }] };
      if (/FROM companies c\s+INNER JOIN ats_sources s/i.test(sql)) return { rows: [{ count: 8 }] };
      if (/configured_enabled_ats_count/i.test(sql)) return { rows: [{ configured_enabled_ats_count: 3 }] };
      if (/COUNT\(\*\)::int AS count FROM ats_sources WHERE/i.test(sql)) return { rows: [{ count: 4 }] };
      if (/COUNT\(DISTINCT NULLIF\(company_name/i.test(sql)) return { rows: [{ count: 7 }] };
      if (/COUNT\(DISTINCT/i.test(sql) && /COALESCE\(ats_key/i.test(sql)) return { rows: [{ count: 3 }] };
      if (/last_seen_epoch >=/i.test(sql)) return { rows: [{ count: 20 }] };
      if (/FROM postings WHERE hidden = false/i.test(sql)) return { rows: [{ count: 30 }] };
      if (/FROM companies c\s+GROUP BY/i.test(sql)) return { rows: [{ ats_key: "greenhouse", count: 5 }] };
      throw new Error(`unexpected count query: ${sql}`);
    }
  };
}

test("concurrent public count requests share one in-flight aggregate", async () => {
  const pool = createCountPool();
  const [first, second] = await Promise.all([
    getPostgresCounts(pool, { nowMs: 1000, cacheTtlMs: 30000 }),
    getPostgresCounts(pool, { nowMs: 1000, cacheTtlMs: 30000 })
  ]);
  assert.deepEqual(second, first);
  assert.equal(pool.calls.length, 9);
});
test("public counts use the durable worker-refreshed snapshot when present", async () => {
  const calls = [];
  const pool = {
    async query(sql) {
      calls.push(String(sql));
      if (/FROM public_stats_snapshot/i.test(sql)) {
        return {
          rows: [{
            counts: {
              company_count: 41469,
              posting_count: 833965,
              job_slot_count: 833965,
              visible_company_count: 8100,
              visible_ats_count: 56,
              company_count_by_ats: { greenhouse: 100 }
            },
            refreshed_at_epoch: 1000
          }]
        };
      }
      throw new Error(`snapshot read must not fan out: ${sql}`);
    }
  };
  const counts = await getPostgresCounts(pool, { useSnapshot: true, nowMs: 2000, cacheTtlMs: 0 });
  assert.equal(counts.posting_count, 833965);
  assert.equal(counts.counts_snapshot_epoch, 1000);
  assert.equal(calls.length, 1);
});

test("default unfiltered public postings use Meili and never exact Postgres aggregates", async () => {
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
          hits: [{ canonical_url: "https://example.com/default" }],
          estimatedTotalHits: 833965,
          facetDistribution: { ats_key: { greenhouse: 100 } }
        };
      }
    };
  };
  const pool = {
    async query(sql) {
      assert.doesNotMatch(String(sql), /COUNT\(|GROUP BY/i);
      return {
        rows: [{
          canonical_url: "https://example.com/default",
          company_name: "Default Co",
          position_name: "Engineer",
          ats_key: "greenhouse",
          hidden: false,
          last_seen_epoch: 100
        }]
      };
    }
  };
  try {
    const result = await listPostgresPostings(pool, { limit: 1, offset: 0 });
    assert.equal(searchBody.q, "");
    assert.equal(result.count, 833965);
    assert.equal(result.count_exact, false);
    assert.equal(result.items.length, 1);
  } finally {
    global.fetch = previousFetch;
    if (previousSearchBackend === undefined) delete process.env.OPENJOBSLOTS_SEARCH_BACKEND;
    else process.env.OPENJOBSLOTS_SEARCH_BACKEND = previousSearchBackend;
  }
});

test("public readiness is cheap and sync status reuses counts returned by status", async () => {
  const routes = new Map();
  const app = {
    get(route, ...handlers) { routes.set(route, handlers.at(-1)); },
    post() {},
    use() {}
  };
  let directCountCalls = 0;
  let readinessQueries = 0;
  const postgresPool = {
    async query(sql) {
      assert.match(String(sql), /^SELECT 1/i);
      readinessQueries += 1;
      return { rows: [{ ok: 1 }] };
    }
  };
  registerPublicRoutes(app, {
    DB_BACKEND: "postgres",
    SEARCH_BACKEND: "meili",
    QUEUE_BACKEND: "postgres-sync-control",
    postgresPool,
    express: { static() { return () => {}; } },
    fs: { ...fs, existsSync: () => false },
    path,
    publicReadCache: {},
    hasAdminAccess: () => false,
    getPostgresCounts: async () => { directCountCalls += 1; return {}; },
    getPostgresParserAttentionByAts: async () => [],
    getPostgresSyncStatus: async () => ({
      status: "idle",
      posting_count: 833965,
      job_slot_count: 833965,
      company_count: 41469,
      visible_company_count: 8100,
      configured_ats_count: 632,
      visible_ats_count: 56,
      ingestion_worker: {}
    }),
    readMeiliReindexStatus: () => ({}),
    buildPublicIngestionStatusItem: (item) => item,
    sanitizeFrontendValue: (value) => value,
    sendCachedPublicJson: async (_req, res, _cache, load) => res.json(await load())
  });

  assert.equal(typeof routes.get("/health/ready"), "function");
  const responses = [];
  const req = { query: {}, headers: {}, get: () => "" };
  const res = { json(value) { responses.push(value); return value; } };
  await routes.get("/health/ready")(req, res);
  await routes.get("/sync/status")(req, res);
  assert.equal(readinessQueries, 1);
  assert.equal(directCountCalls, 0);
  assert.equal(responses[1].posting_count, 833965);
});
