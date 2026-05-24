const assert = require("assert");
const test = require("node:test");

const { createSqliteSchemaRuntime } = require("./sqliteSchema");

test("sqlite schema runtime can be required without the server index module", () => {
  const runtime = createSqliteSchemaRuntime({
    getDb: () => ({
      all: async () => [],
      exec: async () => {},
      get: async () => null,
      run: async () => ({ changes: 0 })
    }),
    dbPath: "jobs.db",
    bundledDbPath: "jobs.db",
    nowEpochSeconds: () => 123,
    setPostingLocationState: () => {}
  });

  assert.equal(typeof runtime.ensurePostingsTable, "function");
  assert.equal(runtime.isSqliteDuplicateColumnError({ message: "SQLITE_ERROR: duplicate column name: x" }), true);
});

test("hydratePostingLocationMapFromDb updates posting location state through dependency", async () => {
  let capturedMap = null;
  const runtime = createSqliteSchemaRuntime({
    getDb: () => ({
      all: async () => [
        {
          job_posting_url: "https://example.com/jobs/1",
          location: "Istanbul, Turkey"
        }
      ],
      exec: async () => {},
      get: async () => null,
      run: async () => ({ changes: 0 })
    }),
    dbPath: "jobs.db",
    bundledDbPath: "jobs.db",
    nowEpochSeconds: () => 123,
    setPostingLocationState: (nextMap) => {
      capturedMap = nextMap;
    }
  });

  await runtime.hydratePostingLocationMapFromDb();

  assert.ok(capturedMap instanceof Map);
  assert.equal(capturedMap.get("https://example.com/jobs/1"), "Istanbul, Turkey");
});
