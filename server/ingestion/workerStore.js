const {
  getCompaniesForSync,
  getDb,
  nowEpochSeconds,
  upsertPostings
} = require("../index");
const {
  normalizeAtsFilterValue
} = require("./atsFilters");
const { getAdapterForCompany } = require("./adapters");
const { hashPayload, writePostingCache } = require("./cache");
const { buildStoredQualityFields, parseQualityFlags } = require("./dataQuality");
const { evaluatePublicPosting, validationFromGate } = require("./publicPostingGate");
const { DEFAULT_TTL_SECONDS } = require("./schema");
const { normalizeAtsKey } = require("../backends/postgresStore");
const { getSourceSyncPolicy, SOURCE_QUALITY_STATES } = require("./sourceQualityPolicy");
const { readWorkerBudgetConfig } = require("./workerConfig");
const {
  decideAdaptiveSourceSelection,
  sortAdaptiveDueTargetCandidates,
  summarizeAdaptiveSourceSignals
} = require("./adaptiveSourceSelection");

const {
  classifyIngestionError,
  sanitizeUrlForLog,
  sanitizeLogMessage,
  recordSelectedTarget,
  recordSkippedTarget,
  recordAdaptiveSourceDecision,
  extractHttpStatus
} = require("./workerObservability");

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

const MAX_TARGETS_PER_RUN = Math.max(1, Math.floor(positiveNumber(process.env.INGESTION_MAX_TARGETS_PER_RUN, 125)));
const WORKER_BUDGET_CONFIG = readWorkerBudgetConfig(process.env);
const SOURCE_DAILY_TARGET_BUDGET = WORKER_BUDGET_CONFIG.sourceDailyTargetBudget;
const DUE_TARGET_CANDIDATE_MULTIPLIER = Math.max(1, Math.floor(positiveNumber(
  process.env.INGESTION_DUE_TARGET_CANDIDATE_MULTIPLIER,
  8
)));
const DUE_TARGET_CANDIDATE_MAX = Math.max(1, Math.floor(positiveNumber(
  process.env.INGESTION_DUE_TARGET_CANDIDATE_MAX,
  5000
)));

// Direct column references — ats_key values are already canonicalized in the database.
// The old buildPostgresAtsFilterCanonicalExpression generated 200+ branch CASE WHEN
// expressions that blocked index usage and added ~180ms per query.
const POSTGRES_COMPANY_ATS_KEY_SQL = "c.ats_key";
const POSTGRES_SYNC_STATE_ATS_KEY_SQL = "ats_key";
const POSTGRES_ERROR_ATS_KEY_SQL = "ats_key";
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

function normalizeFailureReason(value, fallback = "network") {
  const reason = String(value || "").trim().toLowerCase();
  if (!reason) return fallback;
  const { WORKER_FAILURE_REASON_TAXONOMY } = require("./workerObservability");
  if (WORKER_FAILURE_REASON_TAXONOMY.includes(reason)) return reason;
  return reason.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || fallback;
}

function startOfUtcDayEpoch(epoch = nowEpochSeconds()) {
  return Math.floor(Number(epoch || 0) / 86400) * 86400;
}

function isAutoSyncRequest(control) {
  return String(control?.message || "").startsWith("Auto sync queued;");
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
      WITH sync_state AS (
        SELECT
          ${POSTGRES_SYNC_STATE_ATS_KEY_SQL} AS ats_key,
          company_url,
          COALESCE(next_sync_epoch, 0) AS next_sync_epoch
        FROM company_sync_state
      )
      SELECT COUNT(*)::int AS count
      FROM companies c
      INNER JOIN ats_sources s
        ON s.ats_key = ${POSTGRES_COMPANY_ATS_KEY_SQL}
      LEFT JOIN sync_state st
        ON st.ats_key = ${POSTGRES_COMPANY_ATS_KEY_SQL}
        AND st.company_url = c.url_string
      WHERE s.enabled = true
        AND COALESCE(NULLIF(s.protection_status, ''), 'normal') NOT IN ('disabled', 'auto_disabled', 'quarantine_only')
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
      WITH sync_state AS (
        SELECT
          ${POSTGRES_SYNC_STATE_ATS_KEY_SQL} AS ats_key,
          company_url,
          COALESCE(next_sync_epoch, 0) AS next_sync_epoch
        FROM company_sync_state
      )
      SELECT
        ${POSTGRES_COMPANY_ATS_KEY_SQL} AS ats_key,
        COUNT(*)::int AS due_count
      FROM companies c
      INNER JOIN ats_sources s
        ON s.ats_key = ${POSTGRES_COMPANY_ATS_KEY_SQL}
      LEFT JOIN sync_state st
        ON st.ats_key = ${POSTGRES_COMPANY_ATS_KEY_SQL}
        AND st.company_url = c.url_string
      WHERE s.enabled = true
        AND COALESCE(NULLIF(s.protection_status, ''), 'normal') NOT IN ('disabled', 'auto_disabled', 'quarantine_only')
        AND COALESCE(st.next_sync_epoch, 0) <= $1
      GROUP BY ${POSTGRES_COMPANY_ATS_KEY_SQL}
      ORDER BY due_count DESC, ats_key ASC;
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
            ${POSTGRES_SYNC_STATE_ATS_KEY_SQL} AS ats_key,
            COUNT(*) FILTER (WHERE COALESCE(last_success_epoch, 0) >= $1)::int AS recent_success_count,
            COUNT(*) FILTER (WHERE COALESCE(last_failure_epoch, 0) >= $1)::int AS recent_failure_count,
            COUNT(*) FILTER (
              WHERE COALESCE(last_success_epoch, 0) >= $1
                 OR COALESCE(last_failure_epoch, 0) >= $1
            )::int AS recent_attempt_count
          FROM company_sync_state
          WHERE COALESCE(last_success_epoch, 0) >= $1
             OR COALESCE(last_failure_epoch, 0) >= $1
          GROUP BY ${POSTGRES_SYNC_STATE_ATS_KEY_SQL};
        `,
        [lookbackEpoch]
      ),
      pool.query(
        `
          SELECT
            ${POSTGRES_ERROR_ATS_KEY_SQL} AS ats_key,
            error_type,
            COALESCE(http_status, 0)::int AS http_status,
            COALESCE(error_message, '') AS error_message,
            COUNT(*)::int AS count
          FROM ingestion_run_errors
          WHERE created_at >= now() - ($1::int * interval '1 hour')
          GROUP BY ${POSTGRES_ERROR_ATS_KEY_SQL}, error_type, COALESCE(http_status, 0), COALESCE(error_message, '')
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
      WITH sync_state AS (
        SELECT
          ${POSTGRES_SYNC_STATE_ATS_KEY_SQL} AS ats_key,
          company_url,
          COALESCE(next_sync_epoch, 0) AS next_sync_epoch,
          COALESCE(consecutive_failures, 0) AS consecutive_failures
        FROM company_sync_state
      ),
      due_targets AS (
        SELECT
          c.id,
          c.company_name,
          c.url_string,
          ${POSTGRES_COMPANY_ATS_KEY_SQL} AS ats_key,
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
            PARTITION BY ${POSTGRES_COMPANY_ATS_KEY_SQL}
            ORDER BY
              CASE WHEN COALESCE(st.consecutive_failures, 0) > 0 THEN 1 ELSE 0 END ASC,
              COALESCE(st.next_sync_epoch, 0) ASC,
              c.company_name ASC,
              c.url_string ASC
          ) AS ats_rank
        FROM companies c
        INNER JOIN ats_sources s
          ON s.ats_key = ${POSTGRES_COMPANY_ATS_KEY_SQL}
        LEFT JOIN sync_state st
          ON st.ats_key = ${POSTGRES_COMPANY_ATS_KEY_SQL}
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
        SELECT ${POSTGRES_SYNC_STATE_ATS_KEY_SQL} AS ats_key, COUNT(*)::int AS count
        FROM company_sync_state
        WHERE last_success_epoch >= $1
        GROUP BY ${POSTGRES_SYNC_STATE_ATS_KEY_SQL};
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

async function writePostgresPostingCache(pool, postingInput, options = {}) {
  const nowEpoch = Number(options.nowEpoch || nowEpochSeconds());
  const parserVersion = String(options.parserVersion || "unknown");
  const sourceCompanyUrl = String(options.sourceCompanyUrl || "").trim();
  const validation = options.validation || { ok: true, error: "" };
  const canonicalUrl = String(postingInput?.canonical_url || postingInput?.job_posting_url || "").trim();

  const fallbackDate = new Date(nowEpoch * 1000).toISOString().split('T')[0];
  const posting = {
    ...postingInput,
    posted_at_epoch: postingInput?.posted_at_epoch || postingInput?.posting_date_epoch || nowEpoch,
    posting_date: postingInput?.posting_date || fallbackDate
  };

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

module.exports = {
  sleep,
  waitForPersistedAtsCooldown,
  markFetchRateLimitCooldown,
  isSqliteBusyError,
  withTransientWriteRetry,
  withWriteLock,
  stableHashNumber,
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
};
