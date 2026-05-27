const {
  ATS_FILTER_OPTION_ITEMS,
  getCompaniesForSync,
  getDb,
  initDb,
  normalizeAtsFilterValue,
  nowEpochSeconds,
  upsertPostings
} = require("../index");
const { getAdapterForCompany } = require("./adapters");
const { hashPayload, writePostingCache } = require("./cache");
const { buildStoredQualityFields, parseQualityFlags } = require("./dataQuality");
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
const { getSourceSyncPolicy, SOURCE_QUALITY_STATES } = require("./sourceQualityPolicy");
const { readWorkerBudgetConfig } = require("./workerConfig");
const {
  decideAdaptiveSourceSelection,
  sortAdaptiveDueTargetCandidates,
  summarizeAdaptiveSourceSignals
} = require("./adaptiveSourceSelection");

function positiveNumber(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return fallback;
  return number;
}

function nonNegativeNumber(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return fallback;
  return number;
}

const WORKER_INTERVAL_MS = positiveNumber(process.env.INGESTION_WORKER_INTERVAL_MS, 10 * 60 * 1000);
const WORKER_POLL_MS = positiveNumber(process.env.INGESTION_WORKER_POLL_MS, 5000);
const WORKER_CONCURRENCY = Math.max(1, Math.floor(positiveNumber(process.env.INGESTION_WORKER_CONCURRENCY, 4)));
const MAX_TARGETS_PER_RUN = Math.max(1, Math.floor(positiveNumber(process.env.INGESTION_MAX_TARGETS_PER_RUN, 2000)));
const RUN_ONCE = String(process.env.INGESTION_RUN_ONCE || "").trim() === "1";
const AUTO_SYNC_ENABLED = !["0", "false", "no", "off"].includes(
  String(process.env.OPENJOBSLOTS_AUTO_SYNC ?? "1").trim().toLowerCase()
);
const WORKER_BUDGET_CONFIG = readWorkerBudgetConfig(process.env);
const AUTO_SYNC_DAILY_TARGET_BUDGET = WORKER_BUDGET_CONFIG.autoSyncDailyTargetBudget;
const AUTO_SYNC_TARGETS_PER_RUN = WORKER_BUDGET_CONFIG.autoSyncTargetsPerRun;
const SOURCE_DAILY_TARGET_BUDGET = WORKER_BUDGET_CONFIG.sourceDailyTargetBudget;
const DUE_TARGET_CANDIDATE_MULTIPLIER = Math.max(1, Math.floor(positiveNumber(
  process.env.INGESTION_DUE_TARGET_CANDIDATE_MULTIPLIER,
  8
)));
const DUE_TARGET_CANDIDATE_MAX = Math.max(1, Math.floor(positiveNumber(
  process.env.INGESTION_DUE_TARGET_CANDIDATE_MAX,
  5000
)));
const PER_HOST_CONCURRENCY = Math.max(1, Math.floor(positiveNumber(
  process.env.INGESTION_PER_HOST_CONCURRENCY,
  1
)));
const PG_STAT_STATEMENTS_ENABLED = !["0", "false", "no", "off"].includes(
  String(process.env.OPENJOBSLOTS_ENABLE_PG_STAT_STATEMENTS ?? "1").trim().toLowerCase()
);
const SQLITE_WRITE_RETRY_LIMIT = Math.max(0, Math.floor(nonNegativeNumber(
  process.env.INGESTION_SQLITE_WRITE_RETRY_LIMIT,
  3
)));
const SQLITE_WRITE_RETRY_BASE_MS = Math.max(25, Math.floor(positiveNumber(
  process.env.INGESTION_SQLITE_WRITE_RETRY_BASE_MS,
  75
)));
const HTTP_429_COOLDOWN_MS = Math.max(1000, Math.floor(positiveNumber(
  process.env.INGESTION_HTTP_429_COOLDOWN_MS,
  60_000
)));
const MAX_CONSECUTIVE_FAILURES_BEFORE_COOLDOWN = Math.max(1, Math.floor(positiveNumber(
  process.env.INGESTION_MAX_CONSECUTIVE_FAILURES,
  8
)));
const FAILURE_COOLDOWN_SECONDS = Math.max(60 * 60, Math.floor(positiveNumber(
  process.env.INGESTION_FAILURE_COOLDOWN_SECONDS,
  7 * 24 * 60 * 60
)));
const NO_JOBS_COOLDOWN_SECONDS = Math.max(60 * 60, Math.floor(positiveNumber(
  process.env.INGESTION_NO_JOBS_COOLDOWN_SECONDS,
  24 * 60 * 60
)));
const WORKER_NAME = "openjobslots ingestion worker";
const DB_BACKEND = String(process.env.OPENJOBSLOTS_DB_BACKEND || "sqlite").trim().toLowerCase();
const WORKER_FAILURE_REASON_TAXONOMY = Object.freeze([
  "parser_validation",
  "source_quality",
  "source_disabled_by_threshold",
  "rate_limit",
  "cooldown",
  "timeout",
  "network",
  "auth",
  "empty_payload",
  "invalid_shape",
  "no_jobs"
]);
let writeQueue = Promise.resolve();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForPersistedAtsCooldown(rateLimitStore, rateLimitKey, options = {}) {
  if (!rateLimitStore || typeof rateLimitStore.hydrateCooldown !== "function") return;
  const sleepFn = typeof options.sleep === "function" ? options.sleep : sleep;
  const state = await rateLimitStore.hydrateCooldown(rateLimitKey);
  while (true) {
    const waitMs = Number(state?.blockedUntilEpochMs || 0) - Date.now();
    if (waitMs <= 0) return;
    await sleepFn(waitMs);
  }
}

async function markFetchRateLimitCooldown(rateLimitStore, target, error, options = {}) {
  if (!rateLimitStore || typeof rateLimitStore.markRateLimited !== "function") return false;
  if (extractHttpStatus(error) !== 429) return false;
  const fallbackMs = Math.max(
    Number(options.fallbackMs || HTTP_429_COOLDOWN_MS),
    Number(target?.settings?.rateLimitMs || 0)
  );
  await rateLimitStore.markRateLimited(target?.atsKey || "default", fallbackMs);
  return true;
}

function isSqliteBusyError(error) {
  const message = String(error?.message || error || "").toLowerCase();
  const code = String(error?.code || "").toUpperCase();
  return code === "SQLITE_BUSY" ||
    code === "SQLITE_LOCKED" ||
    message.includes("sqlite_busy") ||
    message.includes("database is locked") ||
    message.includes("database is busy");
}

async function withTransientWriteRetry(task, options = {}) {
  let attempt = 0;
  while (true) {
    try {
      return await task();
    } catch (error) {
      if (!isSqliteBusyError(error) || attempt >= SQLITE_WRITE_RETRY_LIMIT) {
        throw error;
      }
      attempt += 1;
      if (typeof options.onBusyRetry === "function") {
        options.onBusyRetry(error, attempt);
      }
      await sleep(SQLITE_WRITE_RETRY_BASE_MS * 2 ** (attempt - 1));
    }
  }
}

function withWriteLock(task, options = {}) {
  const run = writeQueue.then(
    () => withTransientWriteRetry(task, options),
    () => withTransientWriteRetry(task, options)
  );
  writeQueue = run.catch(() => {});
  return run;
}

function stableHashNumber(value) {
  const source = String(value || "");
  let hash = 0;
  for (let index = 0; index < source.length; index += 1) {
    hash = (hash * 31 + source.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function computeNextSyncEpoch(baseEpoch, ttlSeconds, targetKey) {
  const ttl = Math.max(60, Number(ttlSeconds || DEFAULT_TTL_SECONDS));
  const jitter = stableHashNumber(targetKey) % Math.max(60, Math.floor(ttl * 0.1));
  return Number(baseEpoch || nowEpochSeconds()) + ttl + jitter;
}

function computeRetryEpoch(baseEpoch, consecutiveFailures) {
  const failures = Math.max(1, Number(consecutiveFailures || 1));
  if (failures >= MAX_CONSECUTIVE_FAILURES_BEFORE_COOLDOWN) {
    return Number(baseEpoch || nowEpochSeconds()) + FAILURE_COOLDOWN_SECONDS;
  }
  const backoffSeconds = Math.min(24 * 60 * 60, 60 * 60 * 2 ** Math.min(6, failures - 1));
  return Number(baseEpoch || nowEpochSeconds()) + backoffSeconds;
}

function computeFailureRetryEpoch(baseEpoch, consecutiveFailures, failureReason = "") {
  const normalizedReason = normalizeFailureReason(failureReason, "");
  if (normalizedReason === "no_jobs") {
    const failures = Math.max(1, Number(consecutiveFailures || 1));
    if (failures >= MAX_CONSECUTIVE_FAILURES_BEFORE_COOLDOWN) {
      return computeRetryEpoch(baseEpoch, consecutiveFailures);
    }
    return Number(baseEpoch || nowEpochSeconds()) + Math.min(
      FAILURE_COOLDOWN_SECONDS,
      NO_JOBS_COOLDOWN_SECONDS * failures
    );
  }
  return computeRetryEpoch(baseEpoch, consecutiveFailures);
}

function startOfUtcDayEpoch(epoch = nowEpochSeconds()) {
  return Math.floor(Number(epoch || 0) / 86400) * 86400;
}

function isAutoSyncRequest(control) {
  return String(control?.message || "").startsWith("Auto sync queued;");
}

function sanitizeUrlForLog(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw);
    return `${url.origin}${url.pathname}`;
  } catch {
    return raw.split(/[?#]/)[0].slice(0, 500);
  }
}

function sanitizeLogMessage(value, maxLength = 500) {
  const limit = Math.max(1, Math.floor(Number(maxLength || 500)));
  const text = String(value || "");
  const withoutUrlQueries = text.replace(/https?:\/\/[^\s"'<>]+/gi, (match) => sanitizeUrlForLog(match));
  const withoutTokenPairs = withoutUrlQueries.replace(
    /\b(token|access_token|refresh_token|api_key|apikey|secret|password|email)=([^\s&]+)/gi,
    "$1=[redacted]"
  );
  const withoutMarkupBodies = withoutTokenPairs.replace(/<[^>\n]{1,200}>/g, "[redacted_body]");
  return withoutMarkupBodies.slice(0, limit);
}

function incrementCounterMap(target, key, amount = 1) {
  if (!target) return;
  const normalizedKey = String(key || "unknown").trim().toLowerCase() || "unknown";
  target[normalizedKey] = Number(target[normalizedKey] || 0) + Number(amount || 0);
}

function incrementNestedCounterMap(target, firstKey, secondKey, amount = 1) {
  if (!target) return;
  const normalizedFirst = String(firstKey || "unknown").trim().toLowerCase() || "unknown";
  const normalizedSecond = String(secondKey || "unknown").trim().toLowerCase() || "unknown";
  if (!target[normalizedFirst]) target[normalizedFirst] = {};
  incrementCounterMap(target[normalizedFirst], normalizedSecond, amount);
}

function sourceKeyForObservability(value) {
  return normalizeAtsKey(String(value || "unknown").trim() || "unknown");
}

function normalizeFailureReason(value, fallback = "network") {
  const reason = String(value || "").trim().toLowerCase();
  if (!reason) return fallback;
  if (WORKER_FAILURE_REASON_TAXONOMY.includes(reason)) return reason;
  return reason.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || fallback;
}

function classifyIngestionError(error, fallback = "network") {
  const explicit = String(error?.ingestionErrorType || error?.errorType || "").trim();
  const message = String(error?.message || error || "").toLowerCase();
  const code = String(error?.code || "").toUpperCase();
  const httpStatus = extractHttpStatus(error);
  if (explicit) {
    const normalizedExplicit = normalizeFailureReason(explicit, fallback);
    if (WORKER_FAILURE_REASON_TAXONOMY.includes(normalizedExplicit)) return normalizedExplicit;
    if (normalizedExplicit === "parser_drift" || normalizedExplicit === "parser_quarantine" || normalizedExplicit === "parser_normalize") {
      return "parser_validation";
    }
    if (normalizedExplicit === "parser_parse") return "invalid_shape";
    if (normalizedExplicit === "blocked_or_rate_limited") return "rate_limit";
    if (normalizedExplicit === "portal_search_empty") return "no_jobs";
    if (normalizedExplicit === "output_empty") return "empty_payload";
    if (normalizedExplicit === "fetch") {
      if (httpStatus === 429) return "rate_limit";
      if (httpStatus === 401 || httpStatus === 403) return "auth";
      if (httpStatus === 404 || httpStatus === 410) return "source_quality";
      if (httpStatus === 408) return "timeout";
      if (httpStatus >= 500) return "network";
    }
    return explicit;
  }
  if (message.includes("source_disabled_by_threshold")) return "source_disabled_by_threshold";
  if (message.includes("source_auto_disabled") || message.includes("source_quarantine_only")) {
    return "source_quality";
  }
  if (message.includes("cooldown")) return "cooldown";
  if (httpStatus === 429 || message.includes("rate limit") || message.includes("too many request")) return "rate_limit";
  if (httpStatus === 401 || httpStatus === 403 || message.includes("unauthorized") || message.includes("forbidden")) return "auth";
  if (httpStatus === 404 || httpStatus === 410) return "source_quality";
  if (httpStatus === 408 || code === "ETIMEDOUT" || message.includes("timeout") || message.includes("timed out")) return "timeout";
  if (["ECONNRESET", "ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN"].includes(code) ||
    message.includes("request failed") ||
    message.includes("fetch failed") ||
    message.includes("network") ||
    message.includes("connection") ||
    httpStatus >= 500) {
    return "network";
  }
  if (message.includes("empty payload") || message.includes("blank payload") || message.includes("output_empty")) return "empty_payload";
  if (message.includes("no parseable postings") || message.includes("no jobs") || message.includes("portal_search_empty")) return "no_jobs";
  if (message.includes("unexpected token") || message.includes("invalid shape") || message.includes("malformed") || message.includes("json")) {
    return "invalid_shape";
  }
  if (message.includes("no_geo_no_remote") || message.includes("ambiguous_location") || message.includes("weak_remote_evidence")) {
    return "parser_validation";
  }
  if (message.includes("missing ") || message.includes("placeholder ") || message.includes("invalid job_posting_url")) {
    return "parser_validation";
  }
  return fallback;
}

function forceSourceQuarantineIfNeeded(target, visibility) {
  const state = target?.settings?.sourcePolicy?.source_quality_state;
  if (state !== SOURCE_QUALITY_STATES.QUARANTINE_ONLY) return visibility;
  if (!visibility?.publicPosting) return visibility;
  return {
    gate: visibility.gate,
    publicPosting: false,
    validation: {
      ok: false,
      status: "quarantined",
      error: "source_disabled_by_threshold",
      reason_codes: ["source_disabled_by_threshold"],
      evidence: visibility.gate?.evidence || {},
      retry_detail_refetch_eligible: false
    }
  };
}

function extractHttpStatus(error) {
  const explicit = Number(error?.status || error?.statusCode || error?.httpStatus || error?.response?.status || 0);
  if (Number.isFinite(explicit) && explicit >= 100 && explicit <= 599) return explicit;
  const match = String(error?.message || error || "").match(/\b([1-5][0-9]{2})\b/);
  const parsed = match ? Number(match[1]) : 0;
  return Number.isFinite(parsed) && parsed >= 100 && parsed <= 599 ? parsed : null;
}

function incrementHttpStatusCount(counters, httpStatus) {
  const status = Number(httpStatus || 0);
  if (!Number.isFinite(status) || status < 100 || status > 599) return;
  const key = String(status);
  counters.httpStatusCounts = counters.httpStatusCounts || {};
  counters.httpStatusCounts[key] = Number(counters.httpStatusCounts[key] || 0) + 1;
  const family = `${Math.floor(status / 100)}xx`;
  counters.httpStatusFamilyCounts = counters.httpStatusFamilyCounts || {};
  counters.httpStatusFamilyCounts[family] = Number(counters.httpStatusFamilyCounts[family] || 0) + 1;
}

function incrementDbBusyCount(counters) {
  if (!counters) return;
  counters.dbBusyCount = Number(counters.dbBusyCount || 0) + 1;
}

function createRunCounters() {
  return {
    successCount: 0,
    failureCount: 0,
    cacheHitCount: 0,
    cacheWriteCount: 0,
    postingUpsertCount: 0,
    rejectedCount: 0,
    quarantinedCount: 0,
    duplicateCount: 0,
    dbBusyCount: 0,
    httpStatusCounts: {},
    httpStatusFamilyCounts: {},
    dueByAts: {},
    selectedByAts: {},
    adaptiveSourceSelectionByAts: {},
    skippedByReason: {},
    skippedByAtsAndReason: {},
    successByReason: {},
    successByAts: {},
    failureByReason: {},
    failureByAts: {},
    failureByAtsAndReason: {},
    failureReasonTaxonomy: [...WORKER_FAILURE_REASON_TAXONOMY],
    lastError: ""
  };
}

function recordDueTargetsByAts(counters, rows = []) {
  if (!counters) return;
  counters.dueByAts = counters.dueByAts || {};
  for (const row of Array.isArray(rows) ? rows : []) {
    const atsKey = sourceKeyForObservability(row?.ats_key || row?.atsKey);
    const count = Number(row?.due_count ?? row?.count ?? row?.due ?? 0);
    if (count > 0) incrementCounterMap(counters.dueByAts, atsKey, count);
  }
}

function recordSelectedTarget(counters, target) {
  if (!counters) return;
  counters.selectedByAts = counters.selectedByAts || {};
  incrementCounterMap(counters.selectedByAts, sourceKeyForObservability(target?.atsKey || target?.ats_key));
}

function recordAdaptiveSourceDecision(counters, atsKey, decision) {
  if (!counters || !decision) return;
  const key = sourceKeyForObservability(atsKey || decision.ats_key);
  counters.adaptiveSourceSelectionByAts = counters.adaptiveSourceSelectionByAts || {};
  counters.adaptiveSourceSelectionByAts[key] = {
    lane: String(decision.lane || "healthy"),
    maxTargetsPerRun: Number(decision.maxTargetsPerRun || 0),
    dueCount: Number(decision.due_count || 0),
    recentAttemptCount: Number(decision.recent_attempt_count || 0),
    successRatePct: decision.success_rate_pct == null ? null : Number(decision.success_rate_pct),
    reasons: Array.isArray(decision.reasons) ? decision.reasons.slice(0, 6) : []
  };
}

function recordSkippedTarget(counters, targetOrAtsKey, reason = "unknown") {
  if (!counters) return;
  const atsKey = sourceKeyForObservability(
    typeof targetOrAtsKey === "string" ? targetOrAtsKey : targetOrAtsKey?.atsKey || targetOrAtsKey?.ats_key
  );
  const normalizedReason = normalizeFailureReason(reason, "unknown");
  counters.skippedByReason = counters.skippedByReason || {};
  counters.skippedByAtsAndReason = counters.skippedByAtsAndReason || {};
  incrementCounterMap(counters.skippedByReason, normalizedReason);
  incrementNestedCounterMap(counters.skippedByAtsAndReason, atsKey, normalizedReason);
}

function recordFailureReason(counters, target, reason) {
  if (!counters) return;
  const atsKey = sourceKeyForObservability(target?.atsKey || target?.ats_key);
  const normalizedReason = reason instanceof Error || typeof reason === "object"
    ? classifyIngestionError(reason)
    : normalizeFailureReason(reason, "network");
  counters.failureByReason = counters.failureByReason || {};
  counters.failureByAts = counters.failureByAts || {};
  counters.failureByAtsAndReason = counters.failureByAtsAndReason || {};
  incrementCounterMap(counters.failureByReason, normalizedReason);
  incrementCounterMap(counters.failureByAts, atsKey);
  incrementNestedCounterMap(counters.failureByAtsAndReason, atsKey, normalizedReason);
}

function recordTargetOutcome(counters, target, outcome, reason = "ok") {
  if (!counters) return;
  const atsKey = sourceKeyForObservability(target?.atsKey || target?.ats_key);
  const outcomeKey = String(outcome || "").trim().toLowerCase();
  if (outcomeKey === "success") {
    const normalizedReason = normalizeFailureReason(reason, "ok");
    counters.successByReason = counters.successByReason || {};
    counters.successByAts = counters.successByAts || {};
    incrementCounterMap(counters.successByReason, normalizedReason);
    incrementCounterMap(counters.successByAts, atsKey);
    return;
  }
  recordFailureReason(counters, target, reason);
}

function dedupeValidPosting(posting, seenCanonicalUrls, counters) {
  const canonicalUrl = String(posting?.canonical_url || posting?.job_posting_url || "").trim();
  if (!canonicalUrl) return true;
  if (seenCanonicalUrls.has(canonicalUrl)) {
    counters.duplicateCount += 1;
    return false;
  }
  seenCanonicalUrls.add(canonicalUrl);
  return true;
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
  return {
    gate,
    validation: validationFromGate(gate),
    publicPosting: gate.status === "accepted"
  };
}

async function loadAtsSourceSettings(db) {
  const rows = await db.all(
    `
      SELECT ats_key, enabled, default_ttl_seconds, rate_limit_ms
      FROM ats_sources;
    `
  );
  const settings = new Map();
  for (const row of rows) {
    const atsKey = String(row?.ats_key || "").trim();
    if (!atsKey) continue;
    settings.set(atsKey, {
      enabled: Number(row?.enabled || 0) === 1,
      defaultTtlSeconds: Number(row?.default_ttl_seconds || DEFAULT_TTL_SECONDS),
      rateLimitMs: Number(row?.rate_limit_ms || 0)
    });
  }
  return settings;
}

async function loadFutureSyncState(db, nowEpoch) {
  const rows = await db.all(
    `
      SELECT ats_key, company_url, next_sync_epoch
      FROM company_sync_state
      WHERE next_sync_epoch > ?;
    `,
    [nowEpoch]
  );
  const future = new Set();
  for (const row of rows) {
    future.add(`${row.ats_key}|${row.company_url}`);
  }
  return future;
}

async function selectDueTargets(db) {
  const nowEpoch = nowEpochSeconds();
  const [companies, atsSettings, futureState] = await Promise.all([
    getCompaniesForSync(),
    loadAtsSourceSettings(db),
    loadFutureSyncState(db, nowEpoch)
  ]);

  const targets = [];
  for (const company of companies) {
    const atsKey = normalizeAtsFilterValue(company?.ATS_name);
    const companyUrl = String(company?.url_string || "").trim();
    if (!atsKey || !companyUrl) continue;

    const settings = atsSettings.get(atsKey);
    if (settings && !settings.enabled) continue;
    if (futureState.has(`${atsKey}|${companyUrl}`)) continue;

    const adapter = getAdapterForCompany(company);
    if (!adapter) continue;
    targets.push({
      company,
      adapter,
      atsKey,
      companyUrl,
      settings: settings || {
        enabled: true,
        defaultTtlSeconds: DEFAULT_TTL_SECONDS,
        rateLimitMs: 0
      }
    });
    if (targets.length >= MAX_TARGETS_PER_RUN) break;
  }
  return targets;
}

async function createRun(db, targets) {
  const activeAts = Array.from(new Set(targets.map((target) => target.atsKey))).sort();
  const result = await withWriteLock(() => db.run(
    `
      INSERT INTO ingestion_runs (
        started_at_epoch,
        status,
        total_targets,
        active_ats
      ) VALUES (?, 'running', ?, ?);
    `,
    [nowEpochSeconds(), targets.length, JSON.stringify(activeAts)]
  ));
  return Number(result?.lastID || 0);
}

async function updateRun(db, runId, patch) {
  await withWriteLock(() => db.run(
    `
      UPDATE ingestion_runs
      SET
        finished_at_epoch = COALESCE(?, finished_at_epoch),
        status = COALESCE(?, status),
        success_count = ?,
        failure_count = ?,
        cache_hit_count = ?,
        cache_write_count = ?,
        posting_upsert_count = ?,
        rejected_count = ?,
        duplicate_count = ?,
        db_busy_count = ?,
        current_ats = COALESCE(?, current_ats),
        current_company_url = COALESCE(?, current_company_url),
        current_company_name = COALESCE(?, current_company_name),
        http_status_counts = ?,
        last_error = ?,
        updated_at = datetime('now')
      WHERE id = ?;
    `,
    [
      patch.finishedAtEpoch || null,
      patch.status || null,
      Number(patch.successCount || 0),
      Number(patch.failureCount || 0),
      Number(patch.cacheHitCount || 0),
      Number(patch.cacheWriteCount || 0),
      Number(patch.postingUpsertCount || 0),
      Number(patch.rejectedCount || 0),
      Number(patch.duplicateCount || 0),
      Number(patch.dbBusyCount || 0),
      patch.currentAts == null ? null : String(patch.currentAts),
      patch.currentCompanyUrl == null ? null : String(patch.currentCompanyUrl),
      patch.currentCompanyName == null ? null : String(patch.currentCompanyName),
      JSON.stringify(patch.httpStatusCounts || {}),
      String(patch.lastError || ""),
      runId
    ]
  ));
}

async function updateRunCurrentTarget(db, runId, target, counters) {
  await updateRun(db, runId, {
    ...counters,
    status: "running",
    currentAts: target?.atsKey || "",
    currentCompanyUrl: sanitizeUrlForLog(target?.companyUrl || ""),
    currentCompanyName: String(target?.company?.company_name || "")
  });
}

async function recoverStaleRuns(db) {
  await withWriteLock(() => db.run(
    `
      UPDATE ingestion_runs
      SET
        status = 'interrupted',
        finished_at_epoch = ?,
        last_error = CASE
          WHEN TRIM(last_error) = '' THEN 'Worker restarted before run completed'
          ELSE last_error
        END,
        updated_at = datetime('now')
      WHERE status IN ('running', 'stopping');
    `,
    [nowEpochSeconds()]
  ));
}

async function recordRunError(db, runId, target, error, httpStatus = null, errorType = null) {
  await withWriteLock(() => db.run(
    `
      INSERT INTO ingestion_run_errors (
        run_id,
        ats_key,
        company_url,
        company_name,
        error_type,
        error_message,
        http_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?);
    `,
    [
      runId,
      target?.atsKey || "",
      sanitizeUrlForLog(target?.companyUrl || ""),
      String(target?.company?.company_name || ""),
      String(errorType || classifyIngestionError(error)),
      sanitizeLogMessage(error?.message || error, 1000),
      httpStatus
    ]
  ));
}

async function markCompanySuccess(db, target, nowEpoch) {
  await withWriteLock(() => db.run(
    `
      INSERT INTO company_sync_state (
        ats_key,
        company_url,
        company_id,
        company_name,
        last_success_epoch,
        next_sync_epoch,
        consecutive_failures,
        last_error,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 0, '', datetime('now'))
      ON CONFLICT(ats_key, company_url) DO UPDATE SET
        company_id = excluded.company_id,
        company_name = excluded.company_name,
        last_success_epoch = excluded.last_success_epoch,
        next_sync_epoch = excluded.next_sync_epoch,
        consecutive_failures = 0,
        last_error = '',
        updated_at = datetime('now');
    `,
    [
      target.atsKey,
      target.companyUrl,
      Number(target.company?.id || 0) || null,
      String(target.company?.company_name || ""),
      nowEpoch,
      computeNextSyncEpoch(nowEpoch, target.settings.defaultTtlSeconds, `${target.atsKey}|${target.companyUrl}`)
    ]
  ));
}

async function markCompanyFailure(db, target, error, nowEpoch, failureReason = "") {
  await withWriteLock(async () => {
    const existing = await db.get(
      `
        SELECT consecutive_failures
        FROM company_sync_state
        WHERE ats_key = ?
          AND company_url = ?;
      `,
      [target.atsKey, target.companyUrl]
    );
    const failures = Number(existing?.consecutive_failures || 0) + 1;
    await db.run(
      `
        INSERT INTO company_sync_state (
          ats_key,
          company_url,
          company_id,
          company_name,
          last_failure_epoch,
          next_sync_epoch,
          consecutive_failures,
          last_error,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(ats_key, company_url) DO UPDATE SET
          company_id = excluded.company_id,
          company_name = excluded.company_name,
          last_failure_epoch = excluded.last_failure_epoch,
          next_sync_epoch = excluded.next_sync_epoch,
          consecutive_failures = excluded.consecutive_failures,
          last_error = excluded.last_error,
          updated_at = datetime('now');
      `,
      [
        target.atsKey,
        target.companyUrl,
        Number(target.company?.id || 0) || null,
        String(target.company?.company_name || ""),
        nowEpoch,
        computeFailureRetryEpoch(nowEpoch, failures, failureReason || classifyIngestionError(error)),
        failures,
        sanitizeLogMessage(error?.message || error, 1000)
      ]
    );
  });
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

async function postgresGetSyncControl(pool) {
  const result = await pool.query("SELECT * FROM sync_control WHERE id = 1;");
  return result.rows[0] || { status: "idle" };
}

async function postgresSetSyncControl(pool, patch = {}) {
  const status = patch.status == null ? null : String(patch.status);
  const message = patch.message == null ? null : String(patch.message);
  await pool.query(
    `
      UPDATE sync_control
      SET
        status = COALESCE($1, status),
        active_run_id = COALESCE($2, active_run_id),
        message = COALESCE($3, message),
        updated_at = now()
      WHERE id = 1;
    `,
    [status, patch.activeRunId == null ? null : Number(patch.activeRunId), message]
  );
}

async function postgresClearSyncControl(pool, status, message = "") {
  await pool.query(
    `
      UPDATE sync_control
      SET
        status = $1,
        active_run_id = NULL,
        cancel_requested_at_epoch = NULL,
        message = $2,
        updated_at = now()
      WHERE id = 1;
    `,
    [String(status || "idle"), String(message || "")]
  );
}

async function postgresStopRequested(pool) {
  const control = await postgresGetSyncControl(pool);
  return String(control?.status || "") === "stopping" || Boolean(control?.cancel_requested_at_epoch);
}

async function countPostgresDueTargets(pool) {
  const result = await pool.query(
    `
      SELECT COUNT(*)::int AS count
      FROM companies c
      INNER JOIN ats_sources s
        ON s.ats_key = c.ats_key
      LEFT JOIN company_sync_state st
        ON st.ats_key = c.ats_key
        AND st.company_url = c.url_string
      WHERE s.enabled = true
        AND COALESCE(st.next_sync_epoch, 0) <= $1;
    `,
    [nowEpochSeconds()]
  );
  return Number(result.rows[0]?.count || 0);
}

async function countPostgresRunTargetsSince(pool, startedAtEpoch) {
  const result = await pool.query(
    `
      SELECT COALESCE(SUM(total_targets), 0)::int AS count
      FROM ingestion_runs
      WHERE started_at_epoch >= $1;
    `,
    [Number(startedAtEpoch || 0)]
  );
  return Number(result.rows[0]?.count || 0);
}

async function recoverPostgresStaleRuns(pool) {
  await pool.query(
    `
      UPDATE ingestion_runs
      SET
        status = 'interrupted',
        finished_at_epoch = $1,
        last_error = CASE
          WHEN btrim(last_error) = '' THEN 'Worker restarted before run completed'
          ELSE last_error
        END,
        updated_at = now()
      WHERE status IN ('running', 'stopping');
    `,
    [nowEpochSeconds()]
  );
  await pool.query(
    `
      UPDATE sync_control
      SET status = 'idle',
          active_run_id = NULL,
          cancel_requested_at_epoch = NULL,
          message = 'Recovered interrupted worker state',
          updated_at = now()
      WHERE id = 1
        AND status IN ('running', 'stopping');
    `
  );
}

async function ensurePostgresObservability(pool) {
  if (!PG_STAT_STATEMENTS_ENABLED) return { skipped: true, reason: "disabled" };
  try {
    await pool.query("CREATE EXTENSION IF NOT EXISTS pg_stat_statements;");
    return { ok: true };
  } catch (error) {
    console.warn(`[ingestion] pg_stat_statements extension not enabled: ${error.message}`);
    return { ok: false, error: String(error?.message || error) };
  }
}

function dueTargetProtectionPriority(status) {
  const normalized = String(status || "normal").trim().toLowerCase() || "normal";
  if (normalized === "normal" || normalized === "public_enabled") return 0;
  if (normalized === "canary_only") return 1;
  if (normalized === "quarantine_only") return 2;
  return 3;
}

function computeDueTargetCandidateLimit(targetLimit) {
  const expanded = Math.ceil(Number(targetLimit || 0) * DUE_TARGET_CANDIDATE_MULTIPLIER);
  return Math.max(targetLimit, Math.min(DUE_TARGET_CANDIDATE_MAX, expanded));
}

function sortDueTargetCandidates(rows = []) {
  return [...rows].sort((left, right) => {
    const protectionDelta = dueTargetProtectionPriority(left.protection_status) - dueTargetProtectionPriority(right.protection_status);
    if (protectionDelta) return protectionDelta;
    const failurePressureDelta = Number(left.consecutive_failures || 0) > 0
      ? Number(right.consecutive_failures || 0) > 0 ? 0 : 1
      : Number(right.consecutive_failures || 0) > 0 ? -1 : 0;
    if (failurePressureDelta) return failurePressureDelta;
    const leftRank = Number(left.ats_rank || 0);
    const rightRank = Number(right.ats_rank || 0);
    if (leftRank !== rightRank) return leftRank - rightRank;
    const nextDelta = Number(left.next_sync_epoch || 0) - Number(right.next_sync_epoch || 0);
    if (nextDelta) return nextDelta;
    return String(left.ats_key || "").localeCompare(String(right.ats_key || "")) ||
      String(left.company_name || "").localeCompare(String(right.company_name || ""));
  });
}

async function countPostgresDueTargetsByAts(pool) {
  const nowEpoch = nowEpochSeconds();
  const result = await pool.query(
    `
      SELECT
        c.ats_key,
        COUNT(*)::int AS due_count
      FROM companies c
      INNER JOIN ats_sources s
        ON s.ats_key = c.ats_key
      LEFT JOIN company_sync_state st
        ON st.ats_key = c.ats_key
        AND st.company_url = c.url_string
      WHERE s.enabled = true
        AND COALESCE(NULLIF(s.protection_status, ''), 'normal') NOT IN ('disabled', 'auto_disabled', 'quarantine_only')
        AND COALESCE(st.next_sync_epoch, 0) <= $1
      GROUP BY c.ats_key
      ORDER BY due_count DESC, c.ats_key ASC;
    `,
    [nowEpoch]
  );
  return result.rows || [];
}

async function loadPostgresAdaptiveSourceSignals(pool, options = {}) {
  const nowEpoch = Math.max(0, Math.floor(Number(options.nowEpoch || nowEpochSeconds())));
  const lookbackHours = Math.max(1, Math.min(168, Math.floor(positiveNumber(
    process.env.INGESTION_ADAPTIVE_SELECTION_LOOKBACK_HOURS,
    24
  ))));
  const lookbackEpoch = nowEpoch - lookbackHours * 60 * 60;
  const dueRows = Array.isArray(options.dueRows) ? options.dueRows : [];
  try {
    const [syncRows, errorRows] = await Promise.all([
      pool.query(
        `
          SELECT
            ats_key,
            COUNT(*) FILTER (WHERE COALESCE(last_success_epoch, 0) >= $1)::int AS recent_success_count,
            COUNT(*) FILTER (WHERE COALESCE(last_failure_epoch, 0) >= $1)::int AS recent_failure_count,
            COUNT(*) FILTER (
              WHERE COALESCE(last_success_epoch, 0) >= $1
                 OR COALESCE(last_failure_epoch, 0) >= $1
            )::int AS recent_attempt_count
          FROM company_sync_state
          WHERE COALESCE(last_success_epoch, 0) >= $1
             OR COALESCE(last_failure_epoch, 0) >= $1
          GROUP BY ats_key;
        `,
        [lookbackEpoch]
      ),
      pool.query(
        `
          SELECT
            ats_key,
            error_type,
            COALESCE(http_status, 0)::int AS http_status,
            COALESCE(error_message, '') AS error_message,
            COUNT(*)::int AS count
          FROM ingestion_run_errors
          WHERE created_at >= now() - ($1::int * interval '1 hour')
          GROUP BY ats_key, error_type, COALESCE(http_status, 0), COALESCE(error_message, '')
          ORDER BY count DESC, ats_key ASC, error_type ASC;
        `,
        [lookbackHours]
      )
    ]);
    return summarizeAdaptiveSourceSignals({
      dueRows,
      syncRows: syncRows.rows || [],
      errorRows: errorRows.rows || []
    });
  } catch (error) {
    console.warn(`[ingestion] adaptive source signal load failed; using due-count only selection: ${error.message}`);
    return summarizeAdaptiveSourceSignals({ dueRows });
  }
}

async function selectPostgresDueTargets(pool, limit = MAX_TARGETS_PER_RUN, options = {}) {
  const nowEpoch = nowEpochSeconds();
  const dayStartEpoch = startOfUtcDayEpoch(nowEpoch);
  const counters = options.counters || null;
  const targetLimit = Math.max(1, Math.min(
    MAX_TARGETS_PER_RUN,
    Math.floor(positiveNumber(limit, MAX_TARGETS_PER_RUN))
  ));
  const candidateLimit = computeDueTargetCandidateLimit(targetLimit);
  const result = await pool.query(
    `
      WITH due_targets AS (
        SELECT
          c.id,
          c.company_name,
          c.url_string,
          c.ats_key,
          s.protection_status,
          s.disabled_reason,
          s.default_ttl_seconds,
          s.rate_limit_ms,
          COALESCE(st.next_sync_epoch, 0) AS next_sync_epoch,
          COALESCE(st.consecutive_failures, 0) AS consecutive_failures,
          CASE COALESCE(NULLIF(s.protection_status, ''), 'normal')
            WHEN 'normal' THEN 0
            WHEN 'public_enabled' THEN 0
            WHEN 'canary_only' THEN 1
            WHEN 'quarantine_only' THEN 2
            ELSE 3
          END AS protection_priority,
          row_number() OVER (
            PARTITION BY c.ats_key
            ORDER BY
              CASE WHEN COALESCE(st.consecutive_failures, 0) > 0 THEN 1 ELSE 0 END ASC,
              COALESCE(st.next_sync_epoch, 0) ASC,
              c.company_name ASC,
              c.url_string ASC
          ) AS ats_rank
        FROM companies c
        INNER JOIN ats_sources s
          ON s.ats_key = c.ats_key
        LEFT JOIN company_sync_state st
          ON st.ats_key = c.ats_key
          AND st.company_url = c.url_string
        WHERE s.enabled = true
          AND COALESCE(NULLIF(s.protection_status, ''), 'normal') NOT IN ('disabled', 'auto_disabled', 'quarantine_only')
          AND COALESCE(st.next_sync_epoch, 0) <= $1
      )
      SELECT
        id,
        company_name,
        url_string,
        ats_key,
        protection_status,
        disabled_reason,
        default_ttl_seconds,
        rate_limit_ms,
        next_sync_epoch,
        consecutive_failures,
        ats_rank,
        protection_priority
      FROM due_targets
      WHERE ats_rank <= $2
      ORDER BY protection_priority ASC, ats_rank ASC, next_sync_epoch ASC, ats_key ASC, company_name ASC
      LIMIT $3;
    `,
    [nowEpoch, targetLimit, candidateLimit]
  );

  const targets = [];
  const selectedByAts = new Map();
  const sourceBudgetUsedToday = new Map();
  const dueRows = Array.isArray(options.dueByAtsRows)
    ? options.dueByAtsRows
    : await countPostgresDueTargetsByAts(pool);
  const adaptiveSignals = options.adaptiveSignals || await loadPostgresAdaptiveSourceSignals(pool, {
    nowEpoch,
    dueRows
  });
  const adaptiveDecisions = {};
  for (const row of result.rows || []) {
    const atsKey = normalizeAtsKey(row.ats_key);
    if (!atsKey || adaptiveDecisions[atsKey]) continue;
    const sourcePolicy = getSourceSyncPolicy(row.ats_key, {
      protectionStatus: row.protection_status,
      disabledReason: row.disabled_reason
    });
    const decision = decideAdaptiveSourceSelection(atsKey, {
      targetLimit,
      sourcePolicy,
      signal: adaptiveSignals[atsKey] || { due_count: 0 }
    });
    adaptiveDecisions[atsKey] = decision;
    recordAdaptiveSourceDecision(counters, atsKey, decision);
  }
  if (SOURCE_DAILY_TARGET_BUDGET > 0) {
    const budgetRows = await pool.query(
      `
        SELECT ats_key, COUNT(*)::int AS count
        FROM company_sync_state
        WHERE last_success_epoch >= $1
        GROUP BY ats_key;
      `,
      [dayStartEpoch]
    );
    for (const row of budgetRows.rows || []) {
      sourceBudgetUsedToday.set(String(row.ats_key || ""), Number(row.count || 0));
    }
  }
  for (const row of sortAdaptiveDueTargetCandidates(result.rows || [], adaptiveDecisions)) {
    if (targets.length >= targetLimit) break;
    const sourcePolicy = getSourceSyncPolicy(row.ats_key, {
      protectionStatus: row.protection_status,
      disabledReason: row.disabled_reason
    });
    if (sourcePolicy.mode === "disabled") {
      recordSkippedTarget(counters, row.ats_key, "source_policy_disabled");
      continue;
    }
    const selectedCount = Number(selectedByAts.get(row.ats_key) || 0);
    if (Number.isFinite(sourcePolicy.maxTargetsPerRun) && selectedCount >= sourcePolicy.maxTargetsPerRun) {
      recordSkippedTarget(counters, row.ats_key, "max_targets_per_run");
      continue;
    }
    const adaptiveDecision = adaptiveDecisions[normalizeAtsKey(row.ats_key)] || decideAdaptiveSourceSelection(row.ats_key, {
      targetLimit,
      sourcePolicy,
      signal: adaptiveSignals[normalizeAtsKey(row.ats_key)] || { due_count: 0 }
    });
    if (selectedCount >= Number(adaptiveDecision.maxTargetsPerRun || 0)) {
      recordSkippedTarget(counters, row.ats_key, "adaptive_source_cap");
      continue;
    }
    const startedToday = Number(sourceBudgetUsedToday.get(row.ats_key) || 0);
    if (SOURCE_DAILY_TARGET_BUDGET > 0 && startedToday + selectedCount >= SOURCE_DAILY_TARGET_BUDGET) {
      recordSkippedTarget(counters, row.ats_key, "source_daily_budget");
      continue;
    }
    const company = {
      id: Number(row.id || 0),
      company_name: String(row.company_name || ""),
      url_string: String(row.url_string || ""),
      ATS_name: String(row.ats_key || "")
    };
    const adapter = getAdapterForCompany(company);
    if (!adapter) {
      recordSkippedTarget(counters, row.ats_key, "missing_adapter");
      continue;
    }
    targets.push({
      company,
      adapter,
      atsKey: normalizeAtsKey(row.ats_key),
      companyUrl: company.url_string,
      settings: {
        enabled: true,
        defaultTtlSeconds: Number(row.default_ttl_seconds || DEFAULT_TTL_SECONDS),
        rateLimitMs: Number(row.rate_limit_ms || 0),
        sourcePolicy
      }
    });
    selectedByAts.set(row.ats_key, selectedCount + 1);
    recordSelectedTarget(counters, { atsKey: row.ats_key });
  }
  return targets;
}

async function createPostgresRun(pool, targets) {
  const activeAts = Array.from(new Set(targets.map((target) => target.atsKey))).sort();
  const result = await pool.query(
    `
      INSERT INTO ingestion_runs (
        started_at_epoch,
        status,
        total_targets,
        active_ats
      ) VALUES ($1, 'running', $2, $3::jsonb)
      RETURNING id;
    `,
    [nowEpochSeconds(), targets.length, JSON.stringify(activeAts)]
  );
  const runId = Number(result.rows[0]?.id || 0);
  await postgresSetSyncControl(pool, {
    status: "running",
    activeRunId: runId,
    message: `Worker running ${targets.length} targets`
  });
  return runId;
}

async function updatePostgresRun(pool, runId, patch) {
  await pool.query(
    `
      UPDATE ingestion_runs
      SET
        finished_at_epoch = COALESCE($1, finished_at_epoch),
        status = COALESCE($2, status),
        success_count = $3,
        failure_count = $4,
        cache_hit_count = $5,
        cache_write_count = $6,
        posting_upsert_count = $7,
        rejected_count = $8,
        duplicate_count = $9,
        db_busy_count = $10,
        current_ats = COALESCE($11, current_ats),
        current_company_url = COALESCE($12, current_company_url),
        current_company_name = COALESCE($13, current_company_name),
        http_status_counts = $14::jsonb,
        last_error = $15,
        updated_at = now()
      WHERE id = $16;
    `,
    [
      patch.finishedAtEpoch || null,
      patch.status || null,
      Number(patch.successCount || 0),
      Number(patch.failureCount || 0),
      Number(patch.cacheHitCount || 0),
      Number(patch.cacheWriteCount || 0),
      Number(patch.postingUpsertCount || 0),
      Number(patch.rejectedCount || 0),
      Number(patch.duplicateCount || 0),
      Number(patch.dbBusyCount || 0),
      patch.currentAts == null ? null : String(patch.currentAts),
      patch.currentCompanyUrl == null ? null : String(patch.currentCompanyUrl),
      patch.currentCompanyName == null ? null : String(patch.currentCompanyName),
      JSON.stringify(patch.httpStatusCounts || {}),
      String(patch.lastError || ""),
      runId
    ]
  );
}

async function updatePostgresRunCurrentTarget(pool, runId, target, counters) {
  await updatePostgresRun(pool, runId, {
    ...counters,
    status: "running",
    currentAts: target?.atsKey || "",
    currentCompanyUrl: sanitizeUrlForLog(target?.companyUrl || ""),
    currentCompanyName: String(target?.company?.company_name || "")
  });
}

async function recordPostgresRunError(pool, runId, target, error, httpStatus = null, errorType = null) {
  await pool.query(
    `
      INSERT INTO ingestion_run_errors (
        run_id,
        ats_key,
        company_url,
        company_name,
        error_type,
        error_message,
        http_status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7);
    `,
    [
      runId,
      target?.atsKey || "",
      sanitizeUrlForLog(target?.companyUrl || ""),
      String(target?.company?.company_name || ""),
      String(errorType || classifyIngestionError(error)),
      sanitizeLogMessage(error?.message || error, 1000),
      httpStatus
    ]
  );
}

async function writePostgresPostingCache(pool, posting, options = {}) {
  const nowEpoch = Number(options.nowEpoch || nowEpochSeconds());
  const parserVersion = String(options.parserVersion || "unknown");
  const sourceCompanyUrl = String(options.sourceCompanyUrl || "").trim();
  const validation = options.validation || { ok: true, error: "" };
  const canonicalUrl = String(posting?.canonical_url || posting?.job_posting_url || "").trim();
  const rawPayloadHash = hashPayload(posting || {});
  if (!canonicalUrl) return { cached: false, changed: false, hash: rawPayloadHash };
  const validationStatus = String(validation.status || (validation.ok ? "valid" : "invalid"));
  const validationError = String(validation.error || "");
  const quality = buildStoredQualityFields(
    {
      ...posting,
      validation_status: validationStatus,
      validation_error: validationError,
      parser_version: parserVersion,
      raw_payload_hash: rawPayloadHash,
      last_seen_epoch: nowEpoch
    },
    { nowEpoch }
  );

  const existing = await pool.query(
    `
      SELECT raw_payload_hash, parser_version, quality_score, quality_flags, rejection_reason, validation_status, validation_error
      FROM posting_cache
      WHERE canonical_url = $1;
    `,
    [
    canonicalUrl
    ]
  );
  const existingRow = existing.rows[0] || null;
  const changed = !existingRow ||
    String(existingRow?.raw_payload_hash || "") !== rawPayloadHash ||
    String(existingRow?.parser_version || "") !== parserVersion ||
    Number(existingRow?.quality_score || 0) !== Number(quality.quality_score || 0) ||
    JSON.stringify(parseQualityFlags(existingRow?.quality_flags)) !== String(quality.quality_flags || "[]") ||
    String(existingRow?.rejection_reason || "") !== String(quality.rejection_reason || "") ||
    String(existingRow?.validation_status || "") !== validationStatus ||
    String(existingRow?.validation_error || "") !== validationError;

  if (existingRow && !changed) {
    await pool.query(
      `
        UPDATE posting_cache
        SET
          last_seen_epoch = $1,
          updated_at = now()
        WHERE canonical_url = $2;
      `,
      [nowEpoch, canonicalUrl]
    );
    return { cached: true, changed: false, hash: rawPayloadHash };
  }

  await pool.query(
    `
      INSERT INTO posting_cache (
        canonical_url,
        ats_key,
        company_name,
        source_job_id,
        position_name,
        location_text,
        city,
        country,
        region,
        remote_type,
        industry,
        department,
        employment_type,
        description_plain,
        description_html,
        posting_date,
        posted_at_epoch,
        raw_payload_hash,
        source_company_url,
        first_seen_epoch,
        last_seen_epoch,
        parser_version,
        confidence,
        quality_score,
        quality_flags,
        rejection_reason,
        validation_status,
        validation_error,
        raw_metadata,
        updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25::jsonb,$26,$27,$28,$29::jsonb,now())
      ON CONFLICT(canonical_url) DO UPDATE SET
        ats_key = EXCLUDED.ats_key,
        company_name = EXCLUDED.company_name,
        source_job_id = EXCLUDED.source_job_id,
        position_name = EXCLUDED.position_name,
        location_text = EXCLUDED.location_text,
        city = EXCLUDED.city,
        country = EXCLUDED.country,
        region = EXCLUDED.region,
        remote_type = EXCLUDED.remote_type,
        industry = EXCLUDED.industry,
        department = EXCLUDED.department,
        employment_type = EXCLUDED.employment_type,
        description_plain = EXCLUDED.description_plain,
        description_html = EXCLUDED.description_html,
        posting_date = EXCLUDED.posting_date,
        posted_at_epoch = EXCLUDED.posted_at_epoch,
        raw_payload_hash = EXCLUDED.raw_payload_hash,
        source_company_url = EXCLUDED.source_company_url,
        last_seen_epoch = EXCLUDED.last_seen_epoch,
        parser_version = EXCLUDED.parser_version,
        confidence = EXCLUDED.confidence,
        quality_score = EXCLUDED.quality_score,
        quality_flags = EXCLUDED.quality_flags,
        rejection_reason = EXCLUDED.rejection_reason,
        validation_status = EXCLUDED.validation_status,
        validation_error = EXCLUDED.validation_error,
        raw_metadata = EXCLUDED.raw_metadata,
        updated_at = now();
    `,
    [
      canonicalUrl,
      String(posting?.ats_key || "").trim(),
      String(posting?.company_name || "").trim(),
      String(posting?.source_job_id || "").trim(),
      String(posting?.position_name || "").trim(),
      posting?.location_text || posting?.location || null,
      String(posting?.city || "").trim(),
      String(posting?.country || "").trim(),
      String(posting?.region || "").trim(),
      String(posting?.remote_type || "unknown").trim(),
      String(posting?.industry || "").trim(),
      String(posting?.department || "").trim(),
      String(posting?.employment_type || "").trim(),
      String(posting?.description_plain || "").trim(),
      String(posting?.description_html || "").trim(),
      posting?.posting_date || null,
      posting?.posted_at_epoch || posting?.posting_date_epoch || null,
      rawPayloadHash,
      sourceCompanyUrl,
      nowEpoch,
      nowEpoch,
      parserVersion,
      Number(posting?.confidence || 0.5),
      quality.quality_score,
      quality.quality_flags,
      quality.rejection_reason,
      validationStatus,
      validationError,
      JSON.stringify({
        source_company_url: sourceCompanyUrl,
        parser_version: parserVersion,
        visibility_status: validationStatus,
        reason_codes: Array.isArray(validation.reason_codes) ? validation.reason_codes : [],
        retry_detail_refetch_eligible: Boolean(validation.retry_detail_refetch_eligible),
        evidence: validation.evidence || options.evidence || null
      })
    ]
  );

  return { cached: true, changed, hash: rawPayloadHash };
}

async function markPostgresCompanySuccess(pool, target, nowEpoch) {
  await pool.query(
    `
      INSERT INTO company_sync_state (
        ats_key,
        company_url,
        company_id,
        company_name,
        last_success_epoch,
        next_sync_epoch,
        consecutive_failures,
        last_error,
        updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, 0, '', now())
      ON CONFLICT(ats_key, company_url) DO UPDATE SET
        company_id = EXCLUDED.company_id,
        company_name = EXCLUDED.company_name,
        last_success_epoch = EXCLUDED.last_success_epoch,
        next_sync_epoch = EXCLUDED.next_sync_epoch,
        consecutive_failures = 0,
        last_error = '',
        updated_at = now();
    `,
    [
      target.atsKey,
      target.companyUrl,
      Number(target.company?.id || 0) || null,
      String(target.company?.company_name || ""),
      nowEpoch,
      computeNextSyncEpoch(nowEpoch, target.settings.defaultTtlSeconds, `${target.atsKey}|${target.companyUrl}`)
    ]
  );
}

async function markPostgresCompanyFailure(pool, target, error, nowEpoch, failureReason = "") {
  const existing = await pool.query(
    `
      SELECT consecutive_failures
      FROM company_sync_state
      WHERE ats_key = $1
        AND company_url = $2;
    `,
    [target.atsKey, target.companyUrl]
  );
  const failures = Number(existing.rows[0]?.consecutive_failures || 0) + 1;
  await pool.query(
    `
      INSERT INTO company_sync_state (
        ats_key,
        company_url,
        company_id,
        company_name,
        last_failure_epoch,
        next_sync_epoch,
        consecutive_failures,
        last_error,
        updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
      ON CONFLICT(ats_key, company_url) DO UPDATE SET
        company_id = EXCLUDED.company_id,
        company_name = EXCLUDED.company_name,
        last_failure_epoch = EXCLUDED.last_failure_epoch,
        next_sync_epoch = EXCLUDED.next_sync_epoch,
        consecutive_failures = EXCLUDED.consecutive_failures,
        last_error = EXCLUDED.last_error,
        updated_at = now();
    `,
    [
      target.atsKey,
      target.companyUrl,
      Number(target.company?.id || 0) || null,
      String(target.company?.company_name || ""),
      nowEpoch,
      computeFailureRetryEpoch(nowEpoch, failures, failureReason || classifyIngestionError(error)),
      failures,
      sanitizeLogMessage(error?.message || error, 1000)
    ]
  );
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
        if (nowEpoch - lastAutomaticSyncEpoch >= autoSyncIntervalSeconds) {
          const dueTargets = await countPostgresDueTargets(pool);
          const dayStartEpoch = startOfUtcDayEpoch(nowEpoch);
          const targetsStartedToday = await countPostgresRunTargetsSince(pool, dayStartEpoch);
          const remainingBudget = Math.max(0, AUTO_SYNC_DAILY_TARGET_BUDGET - targetsStartedToday);
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

function isRetryableStartupError(error) {
  const code = String(error?.code || "").toUpperCase();
  const message = String(error?.message || error || "").toLowerCase();
  return (
    ["EAI_AGAIN", "ECONNREFUSED", "ENOTFOUND", "ETIMEDOUT", "ECONNRESET"].includes(code) ||
    /getaddrinfo|connect econnrefused|connection terminated|timeout|database system is starting up/.test(message)
  );
}

async function startWorkerWithBackoff() {
  let attempt = 0;
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
