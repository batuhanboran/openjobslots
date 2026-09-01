const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildPostgresTargetUpsertOptions,
  createSourceQualityProtectionScheduler,
  resolveAutomaticSyncIntervalSeconds,
  resolveWorkerMaintenancePolicy,
  shouldStartAutomaticSync
} = require("./workerRuntime");

test("worker maintenance policy batches derived-index writes and throttles scan-heavy work", () => {
  assert.deepEqual(resolveWorkerMaintenancePolicy({}), {
    searchIndexOutboxBatchSize: 1000,
    retentionIntervalMs: 6 * 60 * 60 * 1000,
    sourceQualityProtectionIntervalMs: 6 * 60 * 60 * 1000,
    publicStatsRefreshIntervalMs: 6 * 60 * 60 * 1000
  });

  assert.deepEqual(resolveWorkerMaintenancePolicy({
    OPENJOBSLOTS_SEARCH_OUTBOX_BATCH_SIZE: "10",
    OPENJOBSLOTS_RETENTION_INTERVAL_MS: "1000",
    OPENJOBSLOTS_SOURCE_QUALITY_PROTECTION_INTERVAL_MS: "999999999",
    OPENJOBSLOTS_PUBLIC_STATS_REFRESH_INTERVAL_MS: "bad"
  }), {
    searchIndexOutboxBatchSize: 250,
    retentionIntervalMs: 60 * 1000,
    sourceQualityProtectionIntervalMs: 24 * 60 * 60 * 1000,
    publicStatsRefreshIntervalMs: 6 * 60 * 60 * 1000
  });
});

test("worker target writes defer Meilisearch until run-level maintenance", () => {
  assert.deepEqual(buildPostgresTargetUpsertOptions({
    nowEpoch: 1770000000,
    parserVersion: "greenhouse-v1"
  }), {
    nowEpoch: 1770000000,
    parserVersion: "greenhouse-v1",
    skipMeili: true
  });
});

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

test("maintenance scheduler can defer its first expensive scan after worker startup", async () => {
  const applied = [];
  const scheduler = createSourceQualityProtectionScheduler({
    intervalMs: 6 * 60 * 60 * 1000,
    initialLastAppliedMs: 1000
  });
  const apply = async (atsKeys) => applied.push([...atsKeys]);

  assert.deepEqual(await scheduler.schedule(["bamboohr"], { nowMs: 2000, apply }), {
    applied: false,
    reason: "interval",
    pendingAtsKeys: ["bamboohr"]
  });
  assert.deepEqual(await scheduler.schedule(["lever"], {
    nowMs: 1000 + 6 * 60 * 60 * 1000,
    apply
  }), {
    applied: true,
    atsKeys: ["bamboohr", "lever"]
  });
  assert.deepEqual(applied, [["bamboohr", "lever"]]);
});
