const assert = require("assert");
const test = require("node:test");

const {
  createSourceCollectorRuntime
} = require("./sourceCollectors");

test("source collector runtime can be required without the server index module", async () => {
  const runtime = createSourceCollectorRuntime({
    fetchWithAtsRateLimit: async () => {
      throw new Error("network should not be used for unknown ATS dispatch");
    },
    getPostingLocationByJobUrl: () => new Map()
  });

  assert.equal(typeof runtime.collectPostingsForCompany, "function");
  assert.equal(typeof runtime.inferPostingLocationFromJobUrl, "function");
  assert.equal(typeof runtime.shouldStorePostingByDate, "function");
  assert.deepEqual(await runtime.collectPostingsForCompany({ ATS_name: "unknown" }), []);
});

test("source collector date policy keeps fresh postings and drops stale postings", () => {
  const runtime = createSourceCollectorRuntime({
    fetchWithAtsRateLimit: async () => {
      throw new Error("network should not be used for date policy");
    },
    getPostingLocationByJobUrl: () => new Map(),
    postingTtlSeconds: 3 * 24 * 60 * 60
  });
  const referenceEpoch = Math.floor(Date.parse("2026-05-24T12:00:00Z") / 1000);

  assert.equal(runtime.shouldStorePostingByDate("posted today", referenceEpoch), true);
  assert.equal(runtime.shouldStorePostingByDate("2 days ago", referenceEpoch), true);
  assert.equal(runtime.shouldStorePostingByDate("4 days ago", referenceEpoch), false);
});
