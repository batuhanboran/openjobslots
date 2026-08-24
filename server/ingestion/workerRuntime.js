function resolveAutomaticSyncIntervalSeconds(options = {}) {
  const configured = Math.max(1, Number(options.autoSyncIntervalSeconds || 1));
  if (!options.backlogDrainPending) return configured;
  const drain = Math.max(1, Number(options.backlogDrainIntervalSeconds || 15));
  return Math.min(configured, drain);
}

function shouldStartAutomaticSync(options = {}) {
  const nowEpoch = Number(options.nowEpoch || 0);
  const lastAutomaticSyncEpoch = Number(options.lastAutomaticSyncEpoch || 0);
  const autoSyncIntervalSeconds = resolveAutomaticSyncIntervalSeconds(options);
  const intervalElapsed = nowEpoch - lastAutomaticSyncEpoch >= autoSyncIntervalSeconds;
  return Boolean(
    intervalElapsed &&
    Number(options.dueTargets || 0) > 0 &&
    Number(options.remainingBudget || 0) > 0 &&
    !options.backlogCheckCoolingDown
  );
}

function createSourceQualityProtectionScheduler(options = {}) {
  const intervalMs = Math.max(1000, Number(options.intervalMs || 15 * 60 * 1000));
  const pendingAtsKeys = new Set();
  let lastAppliedMs = 0;
  let inFlight = null;

  async function schedule(atsKeys, runOptions = {}) {
    for (const atsKey of atsKeys || []) {
      const normalized = String(atsKey || "").trim().toLowerCase();
      if (normalized) pendingAtsKeys.add(normalized);
    }
    if (pendingAtsKeys.size === 0) {
      return { applied: false, reason: "empty", pendingAtsKeys: [] };
    }
    if (inFlight) return inFlight;

    const nowMs = Number(runOptions.nowMs ?? Date.now());
    if (lastAppliedMs > 0 && nowMs - lastAppliedMs < intervalMs) {
      return {
        applied: false,
        reason: "interval",
        pendingAtsKeys: Array.from(pendingAtsKeys).sort()
      };
    }

    const apply = runOptions.apply;
    if (typeof apply !== "function") throw new Error("source-quality scheduler requires apply");
    const keysToApply = Array.from(pendingAtsKeys).sort();
    inFlight = (async () => {
      await apply(keysToApply);
      for (const atsKey of keysToApply) pendingAtsKeys.delete(atsKey);
      lastAppliedMs = nowMs;
      return { applied: true, atsKeys: keysToApply };
    })();
    try {
      return await inFlight;
    } finally {
      inFlight = null;
    }
  }

  return { schedule };
}

module.exports = {
  createSourceQualityProtectionScheduler,
  resolveAutomaticSyncIntervalSeconds,
  shouldStartAutomaticSync
};
