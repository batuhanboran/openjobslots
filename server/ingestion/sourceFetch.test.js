const assert = require("assert");

const { createSourceFetchRuntime, getAtsRateLimitWaitMs } = require("./sourceFetch");

function createHeaders(values = {}) {
  const normalized = new Map(
    Object.entries(values).map(([key, value]) => [String(key).toLowerCase(), String(value)])
  );
  return {
    get(name) {
      return normalized.get(String(name || "").toLowerCase()) || "";
    }
  };
}

async function testRateLimitedFetchRetriesAndPersistsCooldown() {
  const stateByKey = new Map();
  const marked = [];
  const safeFetchCalls = [];
  const responses = [
    { ok: false, status: 429, headers: createHeaders({ "retry-after": "2" }) },
    { ok: true, status: 200, headers: createHeaders() }
  ];
  const runtime = createSourceFetchRuntime({
    atsRateLimitStore: {
      getState(key) {
        if (!stateByKey.has(key)) stateByKey.set(key, { active: 0, blockedUntilEpochMs: 0, queue: [] });
        return stateByKey.get(key);
      },
      async hydrateCooldown() {},
      async markRateLimited(key, waitMs) {
        marked.push({ key, waitMs });
      }
    },
    fetchTimeoutMs: 1000,
    getAtsRequestQueueConcurrency: () => 1,
    safeFetch: async (url, init) => {
      safeFetchCalls.push({ url, init });
      return responses.shift();
    }
  });

  const res = await runtime.fetchWithAtsRateLimit("workday", 1000, "https://example.com/jobs", {
    headers: { Accept: "application/json" }
  });

  assert.equal(res.status, 200);
  assert.equal(safeFetchCalls.length, 2);
  assert.equal(marked.length, 1);
  assert.equal(marked[0].key, "workday");
  assert.ok(marked[0].waitMs >= 2000);
  assert.ok(safeFetchCalls.every((call) => call.init.signal instanceof AbortSignal));
}

function testRetryAfterFallsBackToMinimumWait() {
  const waitMs = getAtsRateLimitWaitMs(
    { headers: createHeaders({ "retry-after": "0" }) },
    1500
  );

  assert.equal(waitMs, 1500);
}

async function main() {
  await testRateLimitedFetchRetriesAndPersistsCooldown();
  testRetryAfterFallsBackToMinimumWait();
  console.log("source fetch tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
