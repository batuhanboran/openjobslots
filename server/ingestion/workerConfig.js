const WORKER_BUDGET_DEFAULTS = Object.freeze({
  autoSyncDailyTargetBudget: 6000,
  autoSyncTargetsPerRun: 100,
  sourceDailyTargetBudget: 500
});

function positiveInteger(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return fallback;
  return Math.max(1, Math.floor(number));
}

function nonNegativeInteger(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return fallback;
  return Math.floor(number);
}

function readWorkerBudgetConfig(env = process.env, overrides = {}) {
  const source = env || {};
  return {
    autoSyncDailyTargetBudget: nonNegativeInteger(
      overrides.autoSyncDailyTargetBudget ?? source.INGESTION_AUTO_SYNC_DAILY_TARGET_BUDGET,
      WORKER_BUDGET_DEFAULTS.autoSyncDailyTargetBudget
    ),
    autoSyncTargetsPerRun: positiveInteger(
      overrides.autoSyncTargetsPerRun ?? source.INGESTION_AUTO_SYNC_TARGETS_PER_RUN,
      WORKER_BUDGET_DEFAULTS.autoSyncTargetsPerRun
    ),
    sourceDailyTargetBudget: nonNegativeInteger(
      overrides.sourceDailyTargetBudget ?? source.INGESTION_SOURCE_DAILY_TARGET_BUDGET,
      WORKER_BUDGET_DEFAULTS.sourceDailyTargetBudget
    )
  };
}

module.exports = {
  WORKER_BUDGET_DEFAULTS,
  readWorkerBudgetConfig
};
