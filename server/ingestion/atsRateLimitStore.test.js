const assert = require("node:assert/strict");
const test = require("node:test");

const {
  createAtsRateLimitStateStore,
  toAtsRateLimitKey
} = require("./atsRateLimitStore");

function createPool(handler) {
  const calls = [];
  return {
    calls,
    async query(sql, params = []) {
      calls.push({ sql, params });
      return handler(sql, params);
    }
  };
}

test("rate limit keys are normalized for shared cooldown state", () => {
  assert.equal(toAtsRateLimitKey(" BambooHR "), "bamboohr");
  assert.equal(toAtsRateLimitKey(""), "default");
  assert.equal(toAtsRateLimitKey(null), "default");
});

test("Postgres cooldown hydration restores future blocked state", async () => {
  const pool = createPool((sql, params) => {
    assert.match(sql, /FROM ats_rate_limits/i);
    assert.deepEqual(params, ["bamboohr"]);
    return { rows: [{ blocked_until_epoch_ms: 5000 }] };
  });
  const store = createAtsRateLimitStateStore({ pool, nowMs: () => 1000 });

  const state = await store.hydrateCooldown(" BambooHR ");

  assert.equal(state.blockedUntilEpochMs, 5000);
  assert.equal(store.getState("bamboohr").blockedUntilEpochMs, 5000);
  assert.equal(pool.calls.length, 1);

  await store.hydrateCooldown("bamboohr");
  assert.equal(pool.calls.length, 1, "cooldown hydration should be cached per key");
});

test("Postgres cooldown hydration ignores expired persisted blocks", async () => {
  const pool = createPool(() => ({ rows: [{ blocked_until_epoch_ms: 900 }] }));
  const store = createAtsRateLimitStateStore({ pool, nowMs: () => 1000 });

  const state = await store.hydrateCooldown("bamboohr");

  assert.equal(state.blockedUntilEpochMs, 0);
});

test("Postgres cooldown persistence failures fall back to memory state", async () => {
  const errors = [];
  const pool = createPool(() => {
    throw new Error("database unavailable");
  });
  const store = createAtsRateLimitStateStore({
    pool,
    nowMs: () => 1000,
    onError: (error, context) => errors.push({ error, context })
  });

  const state = await store.hydrateCooldown("bamboohr");
  assert.equal(state.blockedUntilEpochMs, 0);
  await store.markRateLimited("bamboohr", 2500);

  assert.equal(store.getState("bamboohr").blockedUntilEpochMs, 3500);
  assert.equal(errors.length, 2);
  assert.deepEqual(errors.map((entry) => entry.context.operation), ["hydrate", "persist"]);
});

test("markRateLimited persists the longest cooldown without reducing memory state", async () => {
  const pool = createPool((sql, params) => {
    assert.match(sql, /INSERT INTO ats_rate_limits/i);
    assert.match(sql, /GREATEST/i);
    assert.deepEqual(params, ["bamboohr", 3500]);
    return { rows: [] };
  });
  const store = createAtsRateLimitStateStore({ pool, nowMs: () => 1000 });
  store.getState("bamboohr").blockedUntilEpochMs = 8000;

  await store.markRateLimited("bamboohr", 2500);

  assert.equal(store.getState("bamboohr").blockedUntilEpochMs, 8000);
  assert.equal(pool.calls.length, 1);
});

test("memory-only store still tracks active slots and cooldowns", async () => {
  const store = createAtsRateLimitStateStore({ nowMs: () => 1000 });

  const state = store.getState("applytojob");
  state.active += 1;
  await store.markRateLimited("applytojob", 2000);

  assert.equal(store.getState("applytojob").active, 1);
  assert.equal(store.getState("applytojob").blockedUntilEpochMs, 3000);
});
