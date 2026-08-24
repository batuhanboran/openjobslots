const assert = require("node:assert/strict");
const test = require("node:test");

const {
  reconcilePostgresAtsSources,
  seedPostgresAtsSources
} = require("./postgres");

function createPool() {
  const calls = [];
  const client = {
    async query(sql, params = []) {
      calls.push({ scope: "client", sql: String(sql), params });
      if (/UPDATE ats_sources[\s\S]+retired_not_in_runtime_registry/i.test(sql)) {
        return { rows: [], rowCount: 4 };
      }
      return { rows: [], rowCount: 0 };
    },
    release() {}
  };
  return {
    calls,
    async query(sql, params = []) {
      calls.push({ scope: "pool", sql: String(sql), params });
      return { rows: [], rowCount: 1 };
    },
    async connect() { return client; }
  };
}

test("source seed retires DB rows absent from the runtime registry", async () => {
  const pool = createPool();
  const result = await seedPostgresAtsSources(pool, [
    { value: "greenhouse", label: "Greenhouse" },
    { value: "adp_myjobs", label: "ADP MyJobs" }
  ]);

  assert.equal(result.count, 2);
  assert.equal(result.reconciliation.retired, 4);
  const retirement = pool.calls.find((call) => /retired_not_in_runtime_registry/i.test(call.sql));
  assert.deepEqual(retirement.params[0], ["adp_myjobs", "greenhouse"]);
  assert.match(retirement.sql, /enabled = false/);
  assert.match(retirement.sql, /protection_status = 'disabled'/);
  assert.equal(pool.calls.some((call) => /DELETE FROM ats_sources/i.test(call.sql)), false);
});

test("ADP legacy identity migration is conflict-safe and preserves history", async () => {
  const pool = createPool();
  await reconcilePostgresAtsSources(pool, ["adp_myjobs"]);
  const sql = pool.calls.map((call) => call.sql).join("\n");

  assert.match(sql, /INSERT INTO companies[\s\S]+ON CONFLICT \(ats_key, url_string\) DO UPDATE/i);
  assert.match(sql, /INSERT INTO company_sync_state[\s\S]+ON CONFLICT \(ats_key, company_url\) DO UPDATE/i);
  assert.match(sql, /UPDATE posting_cache AS target[\s\S]+target\.company_id = legacy\.id/i);
  assert.match(sql, /UPDATE postings AS target[\s\S]+target\.company_id = legacy\.id/i);
  assert.match(sql, /UPDATE ats_source_runs SET ats_key = \$1 WHERE ats_key = \$2/i);
  assert.ok(pool.calls.some((call) => call.params[0] === "adp_myjobs" && call.params[1] === "adpmyjobs"));
});
