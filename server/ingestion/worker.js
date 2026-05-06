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
const { DEFAULT_TTL_SECONDS, ensureIngestionTables, seedAtsSources } = require("./schema");
const {
  createPostgresPool,
  ensurePostgresSchema,
  seedPostgresAtsSources
} = require("../backends/postgres");
const {
  normalizeAtsKey,
  upsertPostgresPostings
} = require("../backends/postgresStore");
const { ensureMeiliPostingsIndex } = require("../search/meili");

const WORKER_INTERVAL_MS = Number(process.env.INGESTION_WORKER_INTERVAL_MS || 10 * 60 * 1000);
const WORKER_POLL_MS = Number(process.env.INGESTION_WORKER_POLL_MS || 5000);
const WORKER_CONCURRENCY = Math.max(1, Number(process.env.INGESTION_WORKER_CONCURRENCY || 4));
const MAX_TARGETS_PER_RUN = Math.max(1, Number(process.env.INGESTION_MAX_TARGETS_PER_RUN || 2000));
const RUN_ONCE = String(process.env.INGESTION_RUN_ONCE || "").trim() === "1";
const WORKER_NAME = "openjobslots ingestion worker";
const DB_BACKEND = String(process.env.OPENJOBSLOTS_DB_BACKEND || "sqlite").trim().toLowerCase();
let writeQueue = Promise.resolve();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withWriteLock(task) {
  const run = writeQueue.then(task, task);
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
  const backoffSeconds = Math.min(24 * 60 * 60, 60 * 60 * 2 ** Math.min(6, failures - 1));
  return Number(baseEpoch || nowEpochSeconds()) + backoffSeconds;
}

function classifyIngestionError(error, fallback = "fetch") {
  const explicit = String(error?.ingestionErrorType || error?.errorType || "").trim();
  if (explicit) return explicit;
  const message = String(error?.message || error || "").toLowerCase();
  if (message.includes("placeholder company_name")) return "source_discovery";
  if (message.includes("missing ") || message.includes("placeholder ") || message.includes("invalid job_posting_url")) {
    return "parser_validation";
  }
  if (message.includes("parse") || message.includes("json")) return "parser_parse";
  if (message.includes("timeout") || message.includes("rate limit") || message.includes("request failed")) return "fetch";
  return fallback;
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
      String(patch.lastError || ""),
      runId
    ]
  ));
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
      WHERE status = 'running';
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

    for (const item of parsed) {
      let normalized;
      try {
        normalized = target.adapter.normalize(item, target.company, { nowEpoch });
      } catch (error) {
        await recordRunError(db, runId, target, error, null, "parser_normalize");
        continue;
      }
      const validation = target.adapter.validate(normalized);
      const cacheResult = await withWriteLock(() => writePostingCache(db, normalized, {
        nowEpoch,
        parserVersion: target.adapter.parserVersion,
        sourceCompanyUrl: target.companyUrl,
        validation
      }));
      if (cacheResult.cached && cacheResult.changed) counters.cacheWriteCount += 1;
      if (cacheResult.cached && !cacheResult.changed) counters.cacheHitCount += 1;
      if (validation.ok) {
        validPostings.push(normalized);
      } else {
        await recordRunError(db, runId, target, new Error(validation.error), null, classifyIngestionError(validation.error, "parser_validation"));
      }
    }

    if (validPostings.length > 0) {
      await withWriteLock(() => upsertPostings(validPostings, nowEpoch));
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
    await markCompanyFailure(db, target, error, nowEpoch);
    await recordRunError(db, runId, target, error, null, classifyIngestionError(error));
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
      WHERE status = 'running';
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

async function selectPostgresDueTargets(pool) {
  const nowEpoch = nowEpochSeconds();
  const result = await pool.query(
    `
      SELECT
        c.id,
        c.company_name,
        c.url_string,
        c.ats_key,
        s.default_ttl_seconds,
        s.rate_limit_ms,
        COALESCE(st.next_sync_epoch, 0) AS next_sync_epoch
      FROM companies c
      INNER JOIN ats_sources s
        ON s.ats_key = c.ats_key
      LEFT JOIN company_sync_state st
        ON st.ats_key = c.ats_key
        AND st.company_url = c.url_string
      WHERE s.enabled = true
        AND COALESCE(st.next_sync_epoch, 0) <= $1
      ORDER BY COALESCE(st.next_sync_epoch, 0) ASC, c.ats_key ASC, c.company_name ASC
      LIMIT $2;
    `,
    [nowEpoch, MAX_TARGETS_PER_RUN]
  );

  const targets = [];
  for (const row of result.rows) {
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
        rateLimitMs: Number(row.rate_limit_ms || 0)
      }
    });
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
        last_error = $8,
        updated_at = now()
      WHERE id = $9;
    `,
    [
      patch.finishedAtEpoch || null,
      patch.status || null,
      Number(patch.successCount || 0),
      Number(patch.failureCount || 0),
      Number(patch.cacheHitCount || 0),
      Number(patch.cacheWriteCount || 0),
      Number(patch.postingUpsertCount || 0),
      String(patch.lastError || ""),
      runId
    ]
  );
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

  const existing = await pool.query("SELECT raw_payload_hash FROM posting_cache WHERE canonical_url = $1;", [
    canonicalUrl
  ]);
  const changed = String(existing.rows[0]?.raw_payload_hash || "") !== rawPayloadHash;

  await pool.query(
    `
      INSERT INTO posting_cache (
        canonical_url,
        ats_key,
        company_name,
        source_job_id,
        position_name,
        location_text,
        country,
        region,
        remote_type,
        industry,
        posting_date,
        posted_at_epoch,
        raw_payload_hash,
        source_company_url,
        first_seen_epoch,
        last_seen_epoch,
        parser_version,
        confidence,
        validation_status,
        validation_error,
        raw_metadata,
        updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21::jsonb,now())
      ON CONFLICT(canonical_url) DO UPDATE SET
        ats_key = EXCLUDED.ats_key,
        company_name = EXCLUDED.company_name,
        source_job_id = EXCLUDED.source_job_id,
        position_name = EXCLUDED.position_name,
        location_text = EXCLUDED.location_text,
        country = EXCLUDED.country,
        region = EXCLUDED.region,
        remote_type = EXCLUDED.remote_type,
        industry = EXCLUDED.industry,
        posting_date = EXCLUDED.posting_date,
        posted_at_epoch = EXCLUDED.posted_at_epoch,
        raw_payload_hash = EXCLUDED.raw_payload_hash,
        source_company_url = EXCLUDED.source_company_url,
        last_seen_epoch = EXCLUDED.last_seen_epoch,
        parser_version = EXCLUDED.parser_version,
        confidence = EXCLUDED.confidence,
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
      String(posting?.country || "").trim(),
      String(posting?.region || "").trim(),
      String(posting?.remote_type || "unknown").trim(),
      String(posting?.industry || "").trim(),
      posting?.posting_date || null,
      posting?.posted_at_epoch || posting?.posting_date_epoch || null,
      rawPayloadHash,
      sourceCompanyUrl,
      nowEpoch,
      nowEpoch,
      parserVersion,
      Number(posting?.confidence || 0.5),
      validation.ok ? "valid" : "invalid",
      String(validation.error || ""),
      JSON.stringify({
        source_company_url: sourceCompanyUrl,
        parser_version: parserVersion
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

    let parsed;
    try {
      parsed = target.adapter.parse(raw, target.company);
    } catch (error) {
      error.ingestionErrorType = "parser_parse";
      throw error;
    }
    const validPostings = [];

    for (const item of parsed) {
      let normalized;
      try {
        normalized = {
          ...target.adapter.normalize(item, target.company, { nowEpoch }),
          ats_key: target.atsKey
        };
      } catch (error) {
        await recordPostgresRunError(pool, runId, target, error, null, "parser_normalize");
        continue;
      }
      const validation = target.adapter.validate(normalized);
      const cacheResult = await writePostgresPostingCache(pool, normalized, {
        nowEpoch,
        parserVersion: target.adapter.parserVersion,
        sourceCompanyUrl: target.companyUrl,
        validation
      });
      if (cacheResult.cached && cacheResult.changed) counters.cacheWriteCount += 1;
      if (cacheResult.cached && !cacheResult.changed) counters.cacheHitCount += 1;
      if (validation.ok) {
        validPostings.push(normalized);
      } else {
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
    await markPostgresCompanyFailure(pool, target, error, nowEpoch);
    await recordPostgresRunError(pool, runId, target, error, null, classifyIngestionError(error));
    return "failed";
  }
}

async function runPostgresIngestionOnce(pool) {
  const control = await postgresGetSyncControl(pool);
  const controlStatus = String(control?.status || "idle");
  if (controlStatus === "stopping") {
    await postgresClearSyncControl(pool, "idle", "Stop request completed before a run started");
    return { skipped: true, reason: "stopped-before-start" };
  }
  if (controlStatus !== "requested" && !RUN_ONCE) {
    return { skipped: true, reason: "not-requested" };
  }

  const targets = await selectPostgresDueTargets(pool);
  const runId = await createPostgresRun(pool, targets);
  const counters = {
    successCount: 0,
    failureCount: 0,
    cacheHitCount: 0,
    cacheWriteCount: 0,
    postingUpsertCount: 0,
    lastError: ""
  };
  let cancelled = false;

  try {
    let nextIndex = 0;
    const workerCount = Math.min(WORKER_CONCURRENCY, Math.max(1, targets.length));
    const runWorker = async () => {
      while (nextIndex < targets.length) {
        if (await postgresStopRequested(pool)) {
          cancelled = true;
          return;
        }
        const target = targets[nextIndex];
        nextIndex += 1;
        const result = await processPostgresTarget(pool, runId, target, counters);
        if (result === "cancelled") {
          cancelled = true;
          return;
        }
        await updatePostgresRun(pool, runId, {
          ...counters,
          status: "running"
        });
      }
    };
    await Promise.all(Array.from({ length: workerCount }, () => runWorker()));

    const finalStatus = cancelled
      ? "cancelled"
      : counters.failureCount > 0
        ? "completed_with_errors"
        : "completed";
    await updatePostgresRun(pool, runId, {
      ...counters,
      status: finalStatus,
      finishedAtEpoch: nowEpochSeconds()
    });
    if (cancelled) {
      await postgresClearSyncControl(pool, "idle", "Run cancelled by user");
    } else {
      const remainingDueTargets = RUN_ONCE ? 0 : await countPostgresDueTargets(pool);
      if (remainingDueTargets > 0) {
        await postgresSetSyncControl(pool, {
          status: "requested",
          activeRunId: null,
          message: `Continuing sync; ${remainingDueTargets} companies still due`
        });
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
  const counters = {
    successCount: 0,
    failureCount: 0,
    cacheHitCount: 0,
    cacheWriteCount: 0,
    postingUpsertCount: 0,
    lastError: ""
  };

  try {
    let nextIndex = 0;
    const workerCount = Math.min(WORKER_CONCURRENCY, Math.max(1, targets.length));
    const runWorker = async () => {
      while (nextIndex < targets.length) {
        const target = targets[nextIndex];
        nextIndex += 1;
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
      finishedAtEpoch: nowEpochSeconds()
    });
  } catch (error) {
    await updateRun(db, runId, {
      ...counters,
      status: "failed",
      finishedAtEpoch: nowEpochSeconds(),
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
    await seedPostgresAtsSources(pool, ATS_FILTER_OPTION_ITEMS);
    await ensureMeiliPostingsIndex();
    await recoverPostgresStaleRuns(pool);
    console.log(`[${WORKER_NAME}] using Postgres primary store`);

    while (true) {
      const control = await postgresGetSyncControl(pool);
      const status = String(control?.status || "idle");
      if (status === "requested" || (RUN_ONCE && status !== "running")) {
        const summary = await runPostgresIngestionOnce(pool);
        console.log(`[${WORKER_NAME}] postgres run summary: ${JSON.stringify(summary)}`);
        if (RUN_ONCE) return;
      } else if (status === "stopping") {
        await postgresClearSyncControl(pool, "idle", "Stop request completed while worker was idle");
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

if (require.main === module) {
  startWorker().catch((error) => {
    console.error(`[${WORKER_NAME}] failed:`, error);
    process.exit(1);
  });
}

module.exports = {
  classifyIngestionError,
  runPostgresIngestionOnce,
  runIngestionOnce,
  selectDueTargets,
  selectPostgresDueTargets,
  startWorker,
  withWriteLock
};
