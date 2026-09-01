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
const {
  evaluatePublicPosting,
  sourceRequiresNormalizedGeoOrRemoteFails,
  validationFromGate
} = require("./publicPostingGate");
const { DEFAULT_TTL_SECONDS, ensureIngestionTables, seedAtsSources } = require("./schema");
const { createAtsRateLimitStateStore } = require("./atsRateLimitStore");
const { runWithSourceFetchBroker } = require("./safeFetch");
const { createSourceFetchBroker, createSourceFetchRuntime } = require("./sourceFetch");
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
  refreshPostgresPublicStatsSnapshot,
  upsertPostgresPostings
} = require("../backends/postgresStore");
const { ensureMeiliPostingsIndex } = require("../search/meili");
const { readWorkerBudgetConfig } = require("./workerConfig");
const {
  buildPostgresTargetUpsertOptions,
  createSourceQualityProtectionScheduler,
  resolveAutomaticSyncIntervalSeconds,
  resolveWorkerMaintenancePolicy,
  shouldStartAutomaticSync
} = require("./workerRuntime");
const { startWorkerHeartbeat } = require("./workerHeartbeat");

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
const BACKLOG_DRAIN_INTERVAL_MS = positiveNumber(process.env.INGESTION_BACKLOG_DRAIN_INTERVAL_MS, 15 * 1000);
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
const WORKER_MAINTENANCE_POLICY = resolveWorkerMaintenancePolicy(process.env);
const WORKER_STARTED_AT_MS = Date.now();
const retentionScheduler = createSourceQualityProtectionScheduler({
  intervalMs: WORKER_MAINTENANCE_POLICY.retentionIntervalMs,
  initialLastAppliedMs: WORKER_STARTED_AT_MS
});
const sourceQualityProtectionScheduler = createSourceQualityProtectionScheduler({
  intervalMs: WORKER_MAINTENANCE_POLICY.sourceQualityProtectionIntervalMs,
  initialLastAppliedMs: WORKER_STARTED_AT_MS
});
const publicStatsRefreshScheduler = createSourceQualityProtectionScheduler({
  intervalMs: WORKER_MAINTENANCE_POLICY.publicStatsRefreshIntervalMs,
  initialLastAppliedMs: WORKER_STARTED_AT_MS
});

async function runPostgresMaintenance(pool, atsKeys = [], options = {}) {
  const policy = options.policy || WORKER_MAINTENANCE_POLICY;
  const schedulers = options.schedulers || {
    retention: retentionScheduler,
    sourceQuality: sourceQualityProtectionScheduler,
    publicStats: publicStatsRefreshScheduler
  };
  const dependencies = options.dependencies || {};
  const pruneRetention = dependencies.pruneRetention || prunePostgresRetention;
  const processSearchIndexOutbox = dependencies.processSearchIndexOutbox || processPostgresSearchIndexOutbox;
  const applySourceQuality = dependencies.applySourceQuality || applyPostgresSourceQualityProtection;
  const refreshPublicStats = dependencies.refreshPublicStats || refreshPostgresPublicStatsSnapshot;
  const nowMs = options.nowMs;

  const retention = await schedulers.retention.schedule(["retention"], {
    nowMs,
    apply: () => pruneRetention(pool)
  });
  const outbox = await processSearchIndexOutbox(pool, {
    limit: policy.searchIndexOutboxBatchSize
  });
  const sourceQuality = await schedulers.sourceQuality.schedule(atsKeys, {
    nowMs,
    apply: (scheduledAtsKeys) => applySourceQuality(pool, { atsKeys: scheduledAtsKeys })
  });
  const publicStats = await schedulers.publicStats.schedule(["public-stats"], {
    nowMs,
    apply: () => refreshPublicStats(pool)
  });

  return { retention, outbox, sourceQuality, publicStats };
}

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
  // Match sourceRunner.js: sources requiring normalized geo/remote are not
  // published on free-text location alone. Without this the continuous worker
  // daemon would publish rows the CLI path quarantines.
  if (gate.status === "accepted" && sourceRequiresNormalizedGeoOrRemoteFails(posting)) {
    return {
      gate,
      validation: {
        ok: false,
        status: "quarantined",
        error: "no_normalized_geo_or_explicit_remote",
        reason_codes: ["no_normalized_geo_or_explicit_remote"],
        evidence: gate.evidence,
        retry_detail_refetch_eligible: false
      },
      publicPosting: false
    };
  }
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
          const companyName = String(normalized.company_name || normalized.company || "").trim();
          const positionName = String(normalized.position_name || normalized.title || "").trim();
          const canonicalUrl = String(normalized.canonical_url || normalized.job_posting_url || "").trim();
          const sevenDaysAgo = nowEpoch - 7 * 24 * 3600;
          const dbDup = await db.get(
            `
              SELECT job_posting_url FROM Postings
              WHERE LOWER(company_name) = LOWER(?)
                AND LOWER(position_name) = LOWER(?)
                AND (first_seen_epoch >= ? OR last_seen_epoch >= ?)
                AND job_posting_url <> ?
              LIMIT 1;
            `,
            [companyName, positionName, sevenDaysAgo, sevenDaysAgo, canonicalUrl]
          );
          if (dbDup) {
            counters.duplicateCount += 1;
          } else {
            validPostings.push(normalized);
          }
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
      const rateLimit = typeof target.adapter.rateLimit === "function" ? target.adapter.rateLimit() : {};
      const broker = createSourceFetchBroker(options.sourceFetchRuntime, {
        rateLimitKey: target.atsKey,
        rateLimit
      });
      raw = await runWithSourceFetchBroker(broker, () => target.adapter.fetch(target.company));
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
          const companyName = String(normalized.company_name || normalized.company || "").trim();
          const positionName = String(normalized.position_name || normalized.title || "").trim();
          const canonicalUrl = String(normalized.canonical_url || normalized.job_posting_url || "").trim();
          const sevenDaysAgo = nowEpoch - 7 * 24 * 3600;
          const dbDupResult = await pool.query(
            `
              SELECT canonical_url FROM postings
              WHERE LOWER(company_name) = LOWER($1)
                AND LOWER(position_name) = LOWER($2)
                AND (first_seen_epoch >= $3 OR last_seen_epoch >= $3)
                AND canonical_url <> $4
                AND hidden = false
              LIMIT 1;
            `,
            [companyName, positionName, sevenDaysAgo, canonicalUrl]
          );
          if (dbDupResult.rows.length > 0) {
            counters.duplicateCount += 1;
          } else {
            validPostings.push(normalized);
          }
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
      await upsertPostgresPostings(pool, validPostings, buildPostgresTargetUpsertOptions({
        nowEpoch,
        parserVersion: target.adapter.parserVersion
      }));
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
  const sourceFetchRuntime = createSourceFetchRuntime({
    atsRateLimitStore: rateLimitStore,
    fetchTimeoutMs: positiveNumber(process.env.OPENJOBSLOTS_SOURCE_FETCH_TIMEOUT_MS, 12_000),
    getAtsRequestQueueConcurrency: () => 1
  });
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
          const result = await processPostgresTarget(pool, runId, target, counters, {
            rateLimitStore,
            sourceFetchRuntime
          });
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
      await runPostgresMaintenance(
        pool,
        Array.from(new Set(targets.map((target) => target.atsKey)))
      );
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
  startWorkerHeartbeat({
    intervalMs: positiveNumber(process.env.OPENJOBSLOTS_WORKER_HEARTBEAT_INTERVAL_MS, 30000)
  });

  if (DB_BACKEND === "postgres") {
    const pool = createPostgresPool();
    await ensurePostgresSchema(pool);
    await ensurePostgresObservability(pool);
    await seedPostgresAtsSources(pool, ATS_FILTER_OPTION_ITEMS);
    await ensureMeiliPostingsIndex();
    await recoverPostgresStaleRuns(pool);
    console.log(`[${WORKER_NAME}] using Postgres primary store`);

    let lastAutomaticSyncEpoch = 0;
    let lastBacklogCheckEmptyEpoch = 0;
    let backlogDrainPending = false;
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
          backlogDrainPending = Number(summary?.remainingDueTargets || 0) > 0
            && Number(summary?.totalTargets || 0) > 0;
        }
        console.log(`[${WORKER_NAME}] postgres run summary: ${JSON.stringify(summary)}`);
        if (RUN_ONCE) return;
      } else if (status === "stopping") {
        await postgresClearSyncControl(pool, "idle", "Stop request completed while worker was idle");
        lastAutomaticSyncEpoch = nowEpochSeconds();
      } else if (AUTO_SYNC_ENABLED && status === "idle") {
        const nowEpoch = nowEpochSeconds();
        const autoSyncIntervalSeconds = Math.max(60, Math.floor(WORKER_INTERVAL_MS / 1000));
        const backlogDrainIntervalSeconds = Math.max(1, Math.floor(BACKLOG_DRAIN_INTERVAL_MS / 1000));
        const effectiveIntervalSeconds = resolveAutomaticSyncIntervalSeconds({
          autoSyncIntervalSeconds,
          backlogDrainIntervalSeconds,
          backlogDrainPending
        });
        if (nowEpoch - lastAutomaticSyncEpoch >= effectiveIntervalSeconds) {
          const dueTargets = await countPostgresDueTargets(pool);
          const dayStartEpoch = startOfUtcDayEpoch(nowEpoch);
          const targetsStartedToday = await countPostgresRunTargetsSince(pool, dayStartEpoch);
          const remainingBudget = Math.max(0, AUTO_SYNC_DAILY_TARGET_BUDGET - targetsStartedToday);
          const backlogCheckCoolingDown = nowEpoch - lastBacklogCheckEmptyEpoch < 300;
          if (shouldStartAutomaticSync({
          nowEpoch,
          lastAutomaticSyncEpoch,
          autoSyncIntervalSeconds,
          backlogDrainIntervalSeconds,
          backlogDrainPending,
          dueTargets,
          remainingBudget,
          backlogCheckCoolingDown
          })) {
          if (dueTargets > 0 && remainingBudget > 0 && !backlogCheckCoolingDown) {
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
            lastAutomaticSyncEpoch = nowEpochSeconds();
            backlogDrainPending = Number(summary?.remainingDueTargets || 0) > 0
              && Number(summary?.totalTargets || 0) > 0;
            if (Number(summary?.totalTargets || 0) === 0) {
              lastBacklogCheckEmptyEpoch = nowEpoch;
              backlogDrainPending = false;
              console.log(`[${WORKER_NAME}] backlog run processed 0 targets; cooling down backlog checks for 5 minutes.`);
            }
          } else if (dueTargets > 0 && AUTO_SYNC_DAILY_TARGET_BUDGET === 0) {
            lastAutomaticSyncEpoch = nowEpoch;
            backlogDrainPending = false;
          } else if (dueTargets > 0 && remainingBudget <= 0) {
            console.log(`[${WORKER_NAME}] auto sync daily budget exhausted: ${JSON.stringify({
              dailyBudget: AUTO_SYNC_DAILY_TARGET_BUDGET,
              targetsStartedToday,
              dueTargets
            })}`);
            lastAutomaticSyncEpoch = nowEpoch;
            backlogDrainPending = false;
          }
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
  runPostgresMaintenance,
  runPostgresIngestionOnce,
  runIngestionOnce,
  sanitizeLogMessage,
  sanitizeUrlForLog,
  selectDueTargets,
  selectPostgresDueTargets,
  shouldStartAutomaticSync,
  sortDueTargetCandidates,
  startWorker,
  startWorkerWithBackoff,
  withTransientWriteRetry,
  withWriteLock
};
