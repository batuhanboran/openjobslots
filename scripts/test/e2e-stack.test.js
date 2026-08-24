const assert = require("assert");
const test = require("node:test");

const { buildIsolatedApiEnv } = require("./e2e-stack");

test("E2E API uses the isolated DB for runtime data and bundled reference seeding", () => {
  const isolatedDbPath = "C:\\tmp\\openjobslots-e2e-isolation\\jobs.db";
  const env = buildIsolatedApiEnv(isolatedDbPath);

  assert.equal(env.DB_PATH, isolatedDbPath);
  assert.equal(env.OPENJOBSLOTS_BUNDLED_DB_PATH, isolatedDbPath);
  assert.equal(env.OPENJOBSLOTS_DISABLE_API_SCHEDULER, "1");
});
