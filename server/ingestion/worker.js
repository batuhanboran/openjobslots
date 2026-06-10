const {
  getCompaniesForSync,
  getDb,
  initDb,
  nowEpochSeconds,
  upsertPostings
} = require("../index");
const {
  ATS_FILTER_OPTION_ITEMS,
  normalizeAtsFilterValue
} = require("./atsFilters");
const { getAdapterForCompany } = require("./adapters");
const { hashPayload, writePostingCache } = require("./cache");
const { evaluatePublicPosting, validationFromGate } = require("./publicPostingGate");
const { DEFAULT_TTL_SECONDS, ensureIngestionTables, seedAtsSources } = require("./schema");
const { createAtsRateLimitStateStore } = require("./atsRateLimitStore");
const {
  createPostgresPool,
  ensurePostgresSchema,
  seedPostgresAtsSources
} = require("../backends/postgres");
const {
  applyPostgresSourceQualityProtection,
  checkAndRecordPostgresPayloadDrift,
  normalizeAtsKey,
  processPostgresSearchIndexOutbox,
  prunePostgresRetention,
  upsertPostgresPostings
} = require("../backends/postgresStore");
const { ensureMeiliPostingsIndex } = require("../search/meili");
const { readWorkerBudgetConfig } = require("./workerConfig");

// Import Store Operations
const {
  sleep,
  waitForPersistedAtsCooldown,
  markFetchRateLimitCooldown,
  isSqliteBusyError,
  withTransientWriteRetry,
  withWriteLock,
  computeNextSyncEpoch,
  computeRetryEpoch,
  computeFailureRetryEpoch,
  startOfUtcDayEpoch,
  isAutoSyncRequest,
  forceSourceQuarantineIfNeeded,
  loadAtsSourceSettings,
  loadFutureSyncState,
  selectDueTargets,
  createRun,
  updateRun,
  updateRunCurrentTarget,
  recoverStaleRuns,
  recordRunError,
  markCompanySuccess,
  markCompanyFailure,
  postgresGetSyncControl,
  postgresSetSyncControl,
  postgresClearSyncControl,
  postgresStopRequested,
  countPostgresDueTargets,
  countPostgresRunTargetsSince,
  recoverPostgresStaleRuns,
  ensurePostgresObservability,
  dueTargetProtectionPriority,
  computeDueTargetCandidateLimit,
  sortDueTargetCandidates,
  countPostgresDueTargetsByAts,
  loadPostgresAdaptiveSourceSignals,
  selectPostgresDueTargets,
  createPostgresRun,
  updatePostgresRun,
  updatePostgresRunCurrentTarget,
  recordPostgresRunError,
  writePostgresPostingCache,
  markPostgresCompanySuccess,
  markPostgresCompanyFailure
} = require("./workerStore");

// Import Observability Operations
const {
  WORKER_FAILURE_REASON_TAXONOMY,
  sanitizeUrlForLog,
  sanitizeLogMessage,
  sourceKeyForObservability,
  normalizeFailureReason,
  extractHttpStatus,
  classifyIngestionError,
  incrementHttpStatusCount,
  incrementDbBusyCount,
  createRunCounters,
  recordDueTargetsByAts,
  recordSelectedTarget,
  recordAdaptiveSourceDecision,
  recordSkippedTarget,
  recordFailureReason,
  recordTargetOutcome,
  dedupeValidPosting
} = require("./workerObservability");

function positiveNumber(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return fallback;
  return number;
}

const WORKER_INTERVAL_MS = positiveNumber(process.env.INGESTION_WORKER_INTERVAL_MS, 30 * 60 * 1000);
const WORKER_POLL_MS = positiveNumber(process.env.INGESTION_WORKER_POLL_MS, 5000);
const WORKER_CONCURRENCY = Math.max(1, Math.floor(positiveNumber(process.env.INGESTION_WORKER_CONCURRENCY, 2)));
const MAX_TARGETS_PER_RUN = Math.max(1, Math.floor(positiveNumber(process.env.INGESTION_MAX_TARGETS_PER_RUN, 125)));
const RUN_ONCE = String(process.env.INGESTION_RUN_ONCE || "").trim() === "1";
const AUTO_SYNC_ENABLED = !["0", "false", "no", "off"].includes(
  String(process.env.OPENJOBSLOTS_AUTO_SYNC ?? "1").trim().toLowerCase()
);
const WORKER_BUDGET_CONFIG = readWorkerBudgetConfig(process.env);
const AUTO_SYNC_DAILY_TARGET_BUDGET = WORKER_BUDGET_CONFIG.autoSyncDailyTargetBudget;
const AUTO_SYNC_TARGETS_PER_RUN = WORKER_BUDGET_CONFIG.autoSyncTargetsPerRun;
const PER_HOST_CONCURRENCY = Math.max(1, Math.floor(positiveNumber(
  process.env.INGESTION_PER_HOST_CONCURRENCY,
  1
)));
const WORKER_NAME = "openjobslots ingestion worker";
const DB_BACKEND = String(process.env.OPENJOBSLOTS_DB_BACKEND || "sqlite").trim().toLowerCase();

function sourceHost(value) {
  try {
    return new URL(String(value || "")).host.toLowerCase();
  } catch {
    return "";
  }
}

function evaluateIngestionVisibility(posting, validation, parserVersion) {
  if (!validation?.ok) {
    return {
      gate: null,
      validation,
      publicPosting: false
    };
  }
  const gate = evaluatePublicPosting(
    {
      ...posting,
      parser_version: posting?.parser_version || parserVersion
    },
    { parserVersion }
  );
  return {
    gate,
    validation: validationFromGate(gate),
    publicPosting: gate.status === "accepted"
  };
}

async function processTarget(db, runId, target, counters) {
  const nowEpoch = nowEpochSeconds();
  try {
    let raw;
    try {
      raw = await target.adapter.fetch(target.company);
    } catch (error) {
      error.ingestionErrorType = classifyIngestionError(error, "fetch");
      throw error;
    }

    let parsed;
    try {
      parsed = target.adapter.parse(raw, target.company);
    } catch (error) {
      error.ingestionErrorType = "parser_parse";
      throw error;
    }
    const validPostings = [];
    const seenCanonicalUrls = new Set();

    for (const item of parsed) {
      let normalized;
      try {
        normalized = target.adapter.normalize(item, target.company, { nowEpoch });
      } catch (error) {
        counters.rejectedCount += 1;
        recordFailureReason(counters, target, "parser_validation");
        await recordRunError(db, runId, target, error, null, "parser_validation");
        continue;
      }
      const adapterValidation = target.adapter.validate(normalized);
      const visibility = forceSourceQuarantineIfNeeded(
        target,
        evaluateIngestionVisibility(normalized, adapterValidation, target.adapter.parserVersion)
      );
      const validation = visibility.validation;
      const cacheResult = await withWriteLock(() => writePostingCache(db, normalized, {
        nowEpoch,
        parserVersion: target.adapter.parserVersion,
        sourceCompanyUrl: target.companyUrl,
        validation,
        evidence: visibility.gate?.evidence || null
      }), {
        onBusyRetry: () => incrementDbBusyCount(counters)
      });
      if (cacheResult.cached && cacheResult.changed) counters.cacheWriteCount += 1;
      if (cacheResult.cached && !cacheResult.changed) counters.cacheHitCount += 1;
      if (visibility.publicPosting) {
        if (dedupeValidPosting(normalized, seenCanonicalUrls, counters)) {
          validPostings.push(normalized);
        }
      } else {
        if (validation.status === "quarantined") counters.quarantinedCount += 1;
        counters.rejectedCount += 1;
        const reason = classifyIngestionError(validation.error, "parser_validation");
        recordFailureReason(counters, target, reason);
        await recordRunError(db, runId, target, new Error(validation.error), null, reason);
      }
    }

    if (validPostings.length > 0) {
      await withWriteLock(() => upsertPostings(validPostings, nowEpoch), {
        onBusyRetry: () => incrementDbBusyCount(counters)
      });
      counters.postingUpsertCount += validPostings.length;
    }

    await markCompanySuccess(db, target, nowEpoch);
    counters.successCount += 1;
    recordTargetOutcome(counters, target, "success", "ok");

    const rateLimitMs = Number(target.settings.rateLimitMs || 0);
    if (rateLimitMs > 0) {
      await sleep(rateLimitMs);
    }
  } catch (error) {
    counters.failureCount += 1;
    counters.lastError = sanitizeLogMessage(error?.message || error, 500);
    const httpStatus = extractHttpStatus(error);
    const reason = classifyIngestionError(error);
    incrementHttpStatusCount(counters, httpStatus);
    await markCompanyFailure(db, target, error, nowEpoch, reason);
    recordTargetOutcome(counters, target, "failure", reason);
    await recordRunError(db, runId, target, error, httpStatus, reason);
  }
}

async function processPostgresTarget(pool, runId, target, counters, options = {}) {
  const nowEpoch = nowEpochSeconds();
  try {
    if (await postgresStopRequested(pool)) return "cancelled";
    await waitForPersistedAtsCooldown(options.rateLimitStore, target.atsKey);

    let raw;
    try {
      raw = await target.adapter.fetch(target.company);
    } catch (error) {
      error.ingestionErrorType = classifyIngestionError(error, "fetch");
      throw error;
    }

    const drift = await checkAndRecordPostgresPayloadDrift(
      pool,
      target,
      raw,
      target.adapter.parserVersion
    );
    if (drift?.empty_no_jobs) {
      const error = new Error(`${target.atsKey} public list returned no jobs`);
      error.ingestionErrorType = "no_jobs";
      throw error;
    }
    if (drift?.drift) {
      const error = new Error(`parser drift detected: ${drift.reason}`);
      error.ingestionErrorType = "parser_drift";
      throw error;
    }

    let parsed;
    try {
      parsed = target.adapter.parse(raw, target.company);
    } catch (error) {
      error.ingestionErrorType = "parser_parse";
      throw error;
    }
    const validPostings = [];
    const seenCanonicalUrls = new Set();

    for (const item of parsed) {
      let normalized;
      try {
        normalized = {
          ...target.adapter.normalize(item, target.company, { nowEpoch }),
          ats_key: target.atsKey
        };
      } catch (error) {
        counters.rejectedCount += 1;
        recordFailureReason(counters, target, "parser_validation");
        await recordPostgresRunError(pool, runId, target, error, null, "parser_validation");
        continue;
      }
      const adapterValidation = target.adapter.validate(normalized);
      const visibility = forceSourceQuarantineIfNeeded(
        target,
        evaluateIngestionVisibility(normalized, adapterValidation, target.adapter.parserVersion)
      );
      const validation = visibility.validation;
      const cacheResult = await writePostgresPostingCache(pool, normalized, {
        nowEpoch,
        parserVersion: target.adapter.parserVersion,
        sourceCompanyUrl: target.companyUrl,
        validation,
        evidence: visibility.gate?.evidence || null
      });
      if (cacheResult.cached && cacheResult.changed) counters.cacheWriteCount += 1;
      if (cacheResult.cached && !cacheResult.changed) counters.cacheHitCount += 1;
      if (visibility.publicPosting) {
        if (dedupeValidPosting(normalized, seenCanonicalUrls, counters)) {
          validPostings.push(normalized);
        }
      } else {
        if (validation.status === "quarantined") counters.quarantinedCount += 1;
        counters.rejectedCount += 1;
        const reason = classifyIngestionError(validation.error, "parser_validation");
        recordFailureReason(counters, target, reason);
        await recordPostgresRunError(pool, runId, target, new Error(validation.error), null, reason);
      }
    }

    if (validPostings.length > 0) {
      await upsertPostgresPostings(pool, validPostings, {
        nowEpoch,
        parserVersion: target.adapter.parserVersion
      });
      counters.postingUpsertCount += validPostings.length;
    }

    await markPostgresCompanySuccess(pool, target, nowEpoch);
    counters.successCount += 1;
    recordTargetOutcome(counters, target, "success", "ok");

    const rateLimitMs = Number(target.settings.rateLimitMs || 0);
    if (rateLimitMs > 0) {
      await sleep(rateLimitMs);
    }
    return "ok";
  } catch (error) {
    counters.failureCount += 1;
    counters.lastError = sanitizeLogMessage(error?.message || error, 500);
    const httpStatus = extractHttpStatus(error);
    const reason = classifyIngestionError(error);
    incrementHttpStatusCount(counters, httpStatus);
    await markFetchRateLimitCooldown(options.rateLimitStore, target, error);
    await markPostgresCompanyFailure(pool, target, error, nowEpoch, reason);
    recordTargetOutcome(counters, target, "failure", reason);
    await recordPostgresRunError(pool, runId, target, error, httpStatus, reason);
    return "failed";
  }
}

async function runPostgresIngestionOnce(pool, options = {}) {
  const runStartedMs = Date.now();
  const automatic = Boolean(options.automatic);
  const targetLimit = Math.max(1, Math.min(
    MAX_TARGETS_PER_RUN,
    Math.floor(positiveNumber(options.targetLimit, MAX_TARGETS_PER_RUN))
  ));
  const control = await postgresGetSyncControl(pool);
  const controlStatus = String(control?.status || "idle");
  if (controlStatus === "stopping") {
    await postgresClearSyncControl(pool, "idle", "Stop request completed before a run started");
    return {
      skipped: true,
      reason: "stopped-before-start",
      skippedByReason: { "stopped-before-start": 1 },
      failureReasonTaxonomy: [...WORKER_FAILURE_REASON_TAXONOMY]
    };
  }
  if (!automatic && controlStatus !== "requested" && !RUN_ONCE) {
    return {
      skipped: true,
      reason: "not-requested",
      skippedByReason: { "not-requested": 1 },
      failureReasonTaxonomy: [...WORKER_FAILURE_REASON_TAXONOMY]
    };
  }
  if (automatic && !["idle", "requested"].includes(controlStatus) && !RUN_ONCE) {
    const reason = `control-${controlStatus}`;
    return {
      skipped: true,
      reason,
      skippedByReason: { [reason]: 1 },
      failureReasonTaxonomy: [...WORKER_FAILURE_REASON_TAXONOMY]
    };
  }

  const counters = createRunCounters();
  const dueByAtsRows = await countPostgresDueTargetsByAts(pool);
  recordDueTargetsByAts(counters, dueByAtsRows);
  const targets = await selectPostgresDueTargets(pool, targetLimit, { counters, dueByAtsRows });
  const runId = await createPostgresRun(pool, targets);
  const rateLimitStore = createAtsRateLimitStateStore({ pool });
  let cancelled = false;

  try {
    let nextIndex = 0;
    const workerCount = Math.min(WORKER_CONCURRENCY, Math.max(1, targets.length));
    const activeHosts = new Map();
    const waitForHostSlot = async (target) => {
      const host = sourceHost(target?.companyUrl);
      if (!host) return "";
      while (Number(activeHosts.get(host) || 0) >= PER_HOST_CONCURRENCY) {
        if (await postgresStopRequested(pool)) {
          cancelled = true;
          return host;
        }
        await sleep(100);
      }
      activeHosts.set(host, Number(activeHosts.get(host) || 0) + 1);
      return host;
    };
    const releaseHostSlot = (host) => {
      if (!host) return;
      activeHosts.set(host, Math.max(0, Number(activeHosts.get(host) || 0) - 1));
    };
    const runWorker = async () => {
      while (nextIndex < targets.length) {
        if (await postgresStopRequested(pool)) {
          cancelled = true;
          return;
        }
        const target = targets[nextIndex];
        nextIndex += 1;
        const host = await waitForHostSlot(target);
        try {
          if (cancelled) return;
          await updatePostgresRunCurrentTarget(pool, runId, target, counters);
          const result = await processPostgresTarget(pool, runId, target, counters, { rateLimitStore });
          if (result === "cancelled") {
            cancelled = true;
            return;
          }
          await updatePostgresRun(pool, runId, {
            ...counters,
            status: "running"
          });
        } finally {
          releaseHostSlot(host);
        }
      }
    };
    await Promise.all(Array.from({ length: workerCount }, () => runWorker()));

    try {
      await prunePostgresRetention(pool);
      await processPostgresSearchIndexOutbox(pool);
      await applyPostgresSourceQualityProtection(pool, {
        atsKeys: Array.from(new Set(targets.map((target) => target.atsKey)))
      });
    } catch (maintenanceError) {
      console.warn(`[ingestion] retention/search-index maintenance failed: ${maintenanceError.message}`);
    }

    const finalStatus = cancelled
      ? "cancelled"
      : counters.failureCount > 0
        ? "completed_with_errors"
        : "completed";
    await updatePostgresRun(pool, runId, {
      ...counters,
      status: finalStatus,
      finishedAtEpoch: nowEpochSeconds(),
      currentAts: "",
      currentCompanyUrl: "",
      currentCompanyName: ""
    });
    if (cancelled) {
      await postgresClearSyncControl(pool, "idle", "Run cancelled by user");
    } else {
      const remainingDueTargets = RUN_ONCE ? 0 : await countPostgresDueTargets(pool);
      if (remainingDueTargets > 0) {
        if (automatic) {
          await postgresClearSyncControl(pool, "idle", `Auto run completed; ${remainingDueTargets} companies still due`);
        } else {
          await postgresSetSyncControl(pool, {
            status: "requested",
            activeRunId: null,
            message: `Continuing sync; ${remainingDueTargets} companies still due`
          });
        }
      } else {
        await postgresClearSyncControl(pool, "idle", "Run completed");
      }
    }
    return {
      requestId: runId,
      runId,
      totalTargets: targets.length,
      cancelled,
      durationMs: Date.now() - runStartedMs,
      remainingDueTargets: cancelled ? 0 : RUN_ONCE ? 0 : await countPostgresDueTargets(pool),
      ...counters
    };
  } catch (error) {
    await updatePostgresRun(pool, runId, {
      ...counters,
      status: "failed",
      finishedAtEpoch: nowEpochSeconds(),
      currentAts: "",
      currentCompanyUrl: "",
      currentCompanyName: "",
      lastError: sanitizeLogMessage(error?.message || error, 500)
    });
    await postgresClearSyncControl(pool, "idle", sanitizeLogMessage(error?.message || error, 500));
    throw error;
  }
}

async function runIngestionOnce() {
  const runStartedMs = Date.now();
  const db = getDb();
  await ensureIngestionTables(db);
  await seedAtsSources(db, ATS_FILTER_OPTION_ITEMS);

  const targets = await selectDueTargets(db);
  const runId = await createRun(db, targets);
  const counters = createRunCounters();

  try {
    let nextIndex = 0;
    const workerCount = Math.min(WORKER_CONCURRENCY, Math.max(1, targets.length));
    const runWorker = async () => {
      while (nextIndex < targets.length) {
        const target = targets[nextIndex];
        nextIndex += 1;
        await updateRunCurrentTarget(db, runId, target, counters);
        await processTarget(db, runId, target, counters);
        await updateRun(db, runId, {
          ...counters,
          status: "running"
        });
      }
    };
    await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
    await updateRun(db, runId, {
      ...counters,
      status: counters.failureCount > 0 ? "completed_with_errors" : "completed",
      finishedAtEpoch: nowEpochSeconds(),
      currentAts: "",
      currentCompanyUrl: "",
      currentCompanyName: ""
    });
  } catch (error) {
    await updateRun(db, runId, {
      ...counters,
      status: "failed",
      finishedAtEpoch: nowEpochSeconds(),
      currentAts: "",
      currentCompanyUrl: "",
      currentCompanyName: "",
      lastError: sanitizeLogMessage(error?.message || error, 500)
    });
    throw error;
  }

  return { requestId: runId, runId, totalTargets: targets.length, durationMs: Date.now() - runStartedMs, ...counters };
}

async function startWorker() {
  await initDb();

  if (DB_BACKEND === "postgres") {
    const pool = createPostgresPool();
    await ensurePostgresSchema(pool);
    await ensurePostgresObservability(pool);
    await seedPostgresAtsSources(pool, ATS_FILTER_OPTION_ITEMS);
    await ensureMeiliPostingsIndex();
    await recoverPostgresStaleRuns(pool);
    console.log(`[${WORKER_NAME}] using Postgres primary store`);

    let lastAutomaticSyncEpoch = 0;
    while (true) {
      const control = await postgresGetSyncControl(pool);
      const status = String(control?.status || "idle");
      if (status === "requested" || (RUN_ONCE && status !== "running")) {
        let summary;
        if (!RUN_ONCE && isAutoSyncRequest(control)) {
          if (!AUTO_SYNC_ENABLED) {
            await postgresClearSyncControl(pool, "idle", "Auto sync disabled");
            summary = {
              skipped: true,
              reason: "auto-disabled"
            };
          } else {
            const nowEpoch = nowEpochSeconds();
            const dayStartEpoch = startOfUtcDayEpoch(nowEpoch);
            const targetsStartedToday = await countPostgresRunTargetsSince(pool, dayStartEpoch);
            const remainingBudget = Math.max(0, AUTO_SYNC_DAILY_TARGET_BUDGET - targetsStartedToday);
            if (remainingBudget <= 0) {
              await postgresClearSyncControl(pool, "idle", "Auto sync daily budget exhausted");
              summary = {
                skipped: true,
                reason: "auto-budget-exhausted",
                dailyBudget: AUTO_SYNC_DAILY_TARGET_BUDGET,
                targetsStartedToday
              };
            } else {
              summary = await runPostgresIngestionOnce(pool, {
                automatic: true,
                targetLimit: Math.min(AUTO_SYNC_TARGETS_PER_RUN, remainingBudget)
              });
            }
          }
        } else {
          summary = await runPostgresIngestionOnce(pool);
        }
        if (!summary?.skipped) {
          lastAutomaticSyncEpoch = nowEpochSeconds();
        }
        console.log(`[${WORKER_NAME}] postgres run summary: ${JSON.stringify(summary)}`);
        if (RUN_ONCE) return;
      } else if (status === "stopping") {
        await postgresClearSyncControl(pool, "idle", "Stop request completed while worker was idle");
        lastAutomaticSyncEpoch = nowEpochSeconds();
      } else if (AUTO_SYNC_ENABLED && status === "idle") {
        const nowEpoch = nowEpochSeconds();
        const autoSyncIntervalSeconds = Math.max(60, Math.floor(WORKER_INTERVAL_MS / 1000));
        const dueTargets = await countPostgresDueTargets(pool);
        const dayStartEpoch = startOfUtcDayEpoch(nowEpoch);
        const targetsStartedToday = await countPostgresRunTargetsSince(pool, dayStartEpoch);
        const remainingBudget = Math.max(0, AUTO_SYNC_DAILY_TARGET_BUDGET - targetsStartedToday);
        const hasBudgetAndBacklog = dueTargets > 0 && remainingBudget > 0;
        const timeForIntervalCheck = nowEpoch - lastAutomaticSyncEpoch >= autoSyncIntervalSeconds;

        if (hasBudgetAndBacklog || timeForIntervalCheck) {
          if (dueTargets > 0 && remainingBudget > 0) {
            const targetLimit = Math.min(AUTO_SYNC_TARGETS_PER_RUN, remainingBudget);
            const summary = await runPostgresIngestionOnce(pool, {
              automatic: true,
              targetLimit
            });
            console.log(`[${WORKER_NAME}] postgres auto run summary: ${JSON.stringify({
              ...summary,
              dailyBudget: AUTO_SYNC_DAILY_TARGET_BUDGET,
              remainingBudgetBeforeRun: remainingBudget
            })}`);
            lastAutomaticSyncEpoch = nowEpoch;
          } else if (dueTargets > 0 && AUTO_SYNC_DAILY_TARGET_BUDGET === 0) {
            lastAutomaticSyncEpoch = nowEpoch;
          } else if (dueTargets > 0 && remainingBudget <= 0) {
            console.log(`[${WORKER_NAME}] auto sync daily budget exhausted: ${JSON.stringify({
              dailyBudget: AUTO_SYNC_DAILY_TARGET_BUDGET,
              targetsStartedToday,
              dueTargets
            })}`);
            lastAutomaticSyncEpoch = nowEpoch;
          }
        }
      }
      await sleep(WORKER_POLL_MS);
    }
  }

  await recoverStaleRuns(getDb());
  console.log(`[${WORKER_NAME}] using database ${process.env.DB_PATH || "default"}`);
  while (true) {
    const summary = await runIngestionOnce();
    console.log(`[${WORKER_NAME}] run ${summary.runId} complete: ${JSON.stringify(summary)}`);
    if (RUN_ONCE) return;
    await sleep(WORKER_INTERVAL_MS);
  }
}

async function startWorkerWithBackoff() {
  let attempt = 0;
  const isRetryableStartupError = (error) => {
    const code = String(error?.code || "").toUpperCase();
    const message = String(error?.message || error || "").toLowerCase();
    return (
      ["EAI_AGAIN", "ECONNREFUSED", "ENOTFOUND", "ETIMEDOUT", "ECONNRESET"].includes(code) ||
      /getaddrinfo|connect econnrefused|connection terminated|timeout|database system is starting up/.test(message)
    );
  };

  while (true) {
    try {
      await startWorker();
      return;
    } catch (error) {
      if (!isRetryableStartupError(error)) throw error;
      attempt += 1;
      const delayMs = Math.min(60000, 2000 * Math.pow(2, Math.min(attempt - 1, 5)));
      console.error(`[${WORKER_NAME}] startup dependency unavailable; retrying in ${delayMs}ms: ${error?.message || error}`);
      await sleep(delayMs);
    }
  }
}

if (require.main === module) {
  startWorkerWithBackoff().catch((error) => {
    console.error(`[${WORKER_NAME}] failed:`, error);
    process.exit(1);
  });
}

module.exports = {
  computeDueTargetCandidateLimit,
  computeFailureRetryEpoch,
  computeNextSyncEpoch,
  computeRetryEpoch,
  createRunCounters,
  classifyIngestionError,
  dedupeValidPosting,
  dueTargetProtectionPriority,
  extractHttpStatus,
  incrementHttpStatusCount,
  isSqliteBusyError,
  markFetchRateLimitCooldown,
  recordDueTargetsByAts,
  recordSelectedTarget,
  recordSkippedTarget,
  recordTargetOutcome,
  runPostgresIngestionOnce,
  runIngestionOnce,
  sanitizeLogMessage,
  sanitizeUrlForLog,
  selectDueTargets,
  selectPostgresDueTargets,
  sortDueTargetCandidates,
  startWorker,
  startWorkerWithBackoff,
  withTransientWriteRetry,
  withWriteLock
};
