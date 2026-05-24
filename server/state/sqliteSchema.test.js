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
