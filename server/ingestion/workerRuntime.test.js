const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createSourceQualityProtectionScheduler,
  resolveAutomaticSyncIntervalSeconds,
  shouldStartAutomaticSync
} = require("./workerRuntime");

test("automatic sync treats the configured interval as a minimum delay", () => {
  const base = {
    dueTargets: 200,
    remainingBudget: 50,
    backlogCheckCoolingDown: false,
    autoSyncIntervalSeconds: 1800
  };

  assert.equal(shouldStartAutomaticSync({ ...base, nowEpoch: 1799, lastAutomaticSyncEpoch: 1 }), false);
  assert.equal(shouldStartAutomaticSync({ ...base, nowEpoch: 1801, lastAutomaticSyncEpoch: 1 }), true);
  assert.equal(shouldStartAutomaticSync({ ...base, nowEpoch: 1801, lastAutomaticSyncEpoch: 1, dueTargets: 0 }), false);
  assert.equal(shouldStartAutomaticSync({ ...base, nowEpoch: 1801, lastAutomaticSyncEpoch: 1, remainingBudget: 0 }), false);
  assert.equal(shouldStartAutomaticSync({ ...base, nowEpoch: 1801, lastAutomaticSyncEpoch: 1, backlogCheckCoolingDown: true }), false);
});
test("automatic sync drains a known backlog on a short bounded interval", () => {
  const options = {
    autoSyncIntervalSeconds: 1800,
    backlogDrainIntervalSeconds: 15,
    backlogDrainPending: true,
    dueTargets: 200,
    remainingBudget: 50,
    backlogCheckCoolingDown: false
  };
  assert.equal(resolveAutomaticSyncIntervalSeconds(options), 15);
  assert.equal(shouldStartAutomaticSync({ ...options, nowEpoch: 14, lastAutomaticSyncEpoch: 0 }), false);
  assert.equal(shouldStartAutomaticSync({ ...options, nowEpoch: 15, lastAutomaticSyncEpoch: 0 }), true);
});
test("source-quality protection aggregates ATS keys and runs at most once per interval", async () => {
  const applied = [];
  const scheduler = createSourceQualityProtectionScheduler({ intervalMs: 15 * 60 * 1000 });
  const apply = async (atsKeys) => applied.push([...atsKeys].sort());

  assert.deepEqual(await scheduler.schedule(["bamboohr"], { nowMs: 1000, apply }), {
    applied: true,
    atsKeys: ["bamboohr"]
  });
  assert.deepEqual(await scheduler.schedule(["lever"], { nowMs: 5 * 60 * 1000, apply }), {
    applied: false,
    reason: "interval",
    pendingAtsKeys: ["lever"]
  });
  assert.deepEqual(await scheduler.schedule(["greenhouse"], { nowMs: 16 * 60 * 1000, apply }), {
    applied: true,
    atsKeys: ["greenhouse", "lever"]
  });
  assert.deepEqual(applied, [["bamboohr"], ["greenhouse", "lever"]]);
});
