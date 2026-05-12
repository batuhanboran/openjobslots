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
const AUTO_SYNC_DAILY_TARGET_BUDGET = Math.floor(nonNegativeNumber(
  process.env.INGESTION_AUTO_SYNC_DAILY_TARGET_BUDGET,
  250
));
const AUTO_SYNC_TARGETS_PER_RUN = Math.max(1, Math.floor(positiveNumber(
  process.env.INGESTION_AUTO_SYNC_TARGETS_PER_RUN,
  50
)));
const SOURCE_DAILY_TARGET_BUDGET = Math.floor(nonNegativeNumber(
  process.env.INGESTION_SOURCE_DAILY_TARGET_BUDGET,
  100
));
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
const MAX_CONSECUTIVE_FAILURES_BEFORE_COOLDOWN = Math.max(1, Math.floor(positiveNumber(
  process.env.INGESTION_MAX_CONSECUTIVE_FAILURES,
  8
)));
const FAILURE_COOLDOWN_SECONDS = Math.max(60 * 60, Math.floor(positiveNumber(
  process.env.INGESTION_FAILURE_COOLDOWN_SECONDS,
  7 * 24 * 60 * 60
)));
const WORKER_NAME = "openjobslots ingestion worker";
const DB_BACKEND = String(process.env.OPENJOBSLOTS_DB_BACKEND || "sqlite").trim().toLowerCase();
let writeQueue = Promise.resolve();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

function startOfUtcDayEpoch(epoch = nowEpochSeconds()) {
  return Math.floor(Number(epoch || 0) / 86400) * 86400;
}

function isAutoSyncRequest(control) {
  return String(control?.message || "").startsWith("Auto sync queued;");
}

function classifyIngestionError(error, fallback = "fetch") {
  const explicit = String(error?.ingestionErrorType || error?.errorType || "").trim();
  if (explicit) return explicit;
  const message = String(error?.message || error || "").toLowerCase();
  if (message.includes("no_geo_no_remote") || message.includes("ambiguous_location") || message.includes("weak_remote_evidence")) {
    return "parser_quarantine";
  }
  if (message.includes("placeholder company_name")) return "source_discovery";
  if (message.includes("missing ") || message.includes("placeholder ") || message.includes("invalid job_posting_url")) {
    return "parser_validation";
  }
  if (message.includes("parse") || message.includes("json")) return "parser_parse";
  if (message.includes("timeout") || message.includes("rate limit") || message.includes("request failed")) return "fetch";
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
    lastError: ""
  };
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
    currentCompanyUrl: target?.companyUrl || "",
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
      target?.companyUrl || "",
      String(target?.company?.company_name || ""),
      String(errorType || classifyIngestionError(error)),
      String(error?.message || error),
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

async function markCompanyFailure(db, target, error, nowEpoch) {
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
        computeRetryEpoch(nowEpoch, failures),
        failures,
        String(error?.message || error).slice(0, 1000)
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
        await recordRunError(db, runId, target, error, null, "parser_normalize");
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
        await recordRunError(db, runId, target, new Error(validation.error), null, classifyIngestionError(validation.error, "parser_validation"));
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

    const rateLimitMs = Number(target.settings.rateLimitMs || 0);
    if (rateLimitMs > 0) {
      await sleep(rateLimitMs);
    }
  } catch (error) {
    counters.failureCount += 1;
    counters.lastError = String(error?.message || error);
    const httpStatus = extractHttpStatus(error);
    incrementHttpStatusCount(counters, httpStatus);
    await markCompanyFailure(db, target, error, nowEpoch);
    await recordRunError(db, runId, target, error, httpStatus, classifyIngestionError(error));
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

async function selectPostgresDueTargets(pool, limit = MAX_TARGETS_PER_RUN) {
  const nowEpoch = nowEpochSeconds();
  const dayStartEpoch = startOfUtcDayEpoch(nowEpoch);
  const targetLimit = Math.max(1, Math.min(
    MAX_TARGETS_PER_RUN,
    Math.floor(positiveNumber(limit, MAX_TARGETS_PER_RUN))
  ));
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
          row_number() OVER (
            PARTITION BY c.ats_key
            ORDER BY COALESCE(st.next_sync_epoch, 0) ASC, c.company_name ASC, c.url_string ASC
          ) AS ats_rank
        FROM companies c
        INNER JOIN ats_sources s
          ON s.ats_key = c.ats_key
        LEFT JOIN company_sync_state st
          ON st.ats_key = c.ats_key
          AND st.company_url = c.url_string
        WHERE s.enabled = true
          AND COALESCE(NULLIF(s.protection_status, ''), 'normal') NOT IN ('disabled', 'auto_disabled')
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
        next_sync_epoch
      FROM due_targets
      ORDER BY ats_rank ASC, next_sync_epoch ASC, ats_key ASC, company_name ASC
      LIMIT $2;
    `,
    [nowEpoch, targetLimit]
  );

  const targets = [];
  const selectedByAts = new Map();
  const sourceBudgetUsedToday = new Map();
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
  for (const row of result.rows) {
    const sourcePolicy = getSourceSyncPolicy(row.ats_key, {
      protectionStatus: row.protection_status,
      disabledReason: row.disabled_reason
    });
    if (sourcePolicy.mode === "disabled") continue;
    const selectedCount = Number(selectedByAts.get(row.ats_key) || 0);
    if (Number.isFinite(sourcePolicy.maxTargetsPerRun) && selectedCount >= sourcePolicy.maxTargetsPerRun) continue;
    const startedToday = Number(sourceBudgetUsedToday.get(row.ats_key) || 0);
    if (SOURCE_DAILY_TARGET_BUDGET > 0 && startedToday + selectedCount >= SOURCE_DAILY_TARGET_BUDGET) continue;
    const company = {
      id: Number(row.id || 0),
      company_name: String(row.company_name || ""),
      url_string: String(row.url_string || ""),
      ATS_name: String(row.ats_key || "")
    };
    const adapter = getAdapterForCompany(company);
    if (!adapter) continue;
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
    currentCompanyUrl: target?.companyUrl || "",
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
      target?.companyUrl || "",
      String(target?.company?.company_name || ""),
      String(errorType || classifyIngestionError(error)),
      String(error?.message || error),
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

async function markPostgresCompanyFailure(pool, target, error, nowEpoch) {
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
      computeRetryEpoch(nowEpoch, failures),
      failures,
      String(error?.message || error).slice(0, 1000)
    ]
  );
}

async function processPostgresTarget(pool, runId, target, counters) {
  const nowEpoch = nowEpochSeconds();
  try {
    if (await postgresStopRequested(pool)) return "cancelled";

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
        await recordPostgresRunError(pool, runId, target, error, null, "parser_normalize");
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
        await recordPostgresRunError(pool, runId, target, new Error(validation.error), null, classifyIngestionError(validation.error, "parser_validation"));
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

    const rateLimitMs = Number(target.settings.rateLimitMs || 0);
    if (rateLimitMs > 0) {
      await sleep(rateLimitMs);
    }
    return "ok";
  } catch (error) {
    counters.failureCount += 1;
    counters.lastError = String(error?.message || error);
    const httpStatus = extractHttpStatus(error);
    incrementHttpStatusCount(counters, httpStatus);
    await markPostgresCompanyFailure(pool, target, error, nowEpoch);
    await recordPostgresRunError(pool, runId, target, error, httpStatus, classifyIngestionError(error));
    return "failed";
  }
}

async function runPostgresIngestionOnce(pool, options = {}) {
  const automatic = Boolean(options.automatic);
  const targetLimit = Math.max(1, Math.min(
    MAX_TARGETS_PER_RUN,
    Math.floor(positiveNumber(options.targetLimit, MAX_TARGETS_PER_RUN))
  ));
  const control = await postgresGetSyncControl(pool);
  const controlStatus = String(control?.status || "idle");
  if (controlStatus === "stopping") {
    await postgresClearSyncControl(pool, "idle", "Stop request completed before a run started");
    return { skipped: true, reason: "stopped-before-start" };
  }
  if (!automatic && controlStatus !== "requested" && !RUN_ONCE) {
    return { skipped: true, reason: "not-requested" };
  }
  if (automatic && !["idle", "requested"].includes(controlStatus) && !RUN_ONCE) {
    return { skipped: true, reason: `control-${controlStatus}` };
  }

  const targets = await selectPostgresDueTargets(pool, targetLimit);
  const runId = await createPostgresRun(pool, targets);
  const counters = createRunCounters();
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
          const result = await processPostgresTarget(pool, runId, target, counters);
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
      runId,
      totalTargets: targets.length,
      cancelled,
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
      lastError: String(error?.message || error)
    });
    await postgresClearSyncControl(pool, "idle", String(error?.message || error));
    throw error;
  }
}

async function runIngestionOnce() {
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
      lastError: String(error?.message || error)
    });
    throw error;
  }

  return { runId, totalTargets: targets.length, ...counters };
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
  computeNextSyncEpoch,
  computeRetryEpoch,
  createRunCounters,
  classifyIngestionError,
  dedupeValidPosting,
  extractHttpStatus,
  incrementHttpStatusCount,
  isSqliteBusyError,
  runPostgresIngestionOnce,
  runIngestionOnce,
  selectDueTargets,
  selectPostgresDueTargets,
  startWorker,
  startWorkerWithBackoff,
  withTransientWriteRetry,
  withWriteLock
};
