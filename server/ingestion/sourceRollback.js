const { createPostgresPool, ensurePostgresSchema } = require("../backends/postgres");
const { acquireHeavyJobLock } = require("../backends/heavyJobLock");
const { normalizeAtsKey } = require("../backends/postgresStore");

function clean(value, max = 1000) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function asBool(value) {
  return ["1", "true", "yes", "y", "on"].includes(String(value || "").trim().toLowerCase());
}

function asInt(value, fallback, min, max) {
  const parsed = Number(value);
  const number = Number.isFinite(parsed) ? Math.floor(parsed) : fallback;
  return Math.max(min, Math.min(max, number));
}

function parseRollbackArgs(argv = process.argv.slice(2), env = process.env) {
  const options = {
    runId: asInt(env.OPENJOBSLOTS_ATS_ROLLBACK_RUN_ID, 0, 0, Number.MAX_SAFE_INTEGER),
    source: clean(env.OPENJOBSLOTS_ATS_ROLLBACK_SOURCE).toLowerCase(),
    confirmProduction: asBool(env.OPENJOBSLOTS_ATS_ROLLBACK_CONFIRM_PRODUCTION),
    json: asBool(env.OPENJOBSLOTS_ATS_ROLLBACK_JSON),
    dryRun: asBool(env.OPENJOBSLOTS_ATS_ROLLBACK_DRY_RUN),
    statementTimeoutMs: asInt(env.OPENJOBSLOTS_HEAVY_SOURCE_STATEMENT_TIMEOUT_MS, 30_000, 1000, 120_000)
  };
  for (const arg of argv) {
    if (arg === "--json") options.json = true;
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--confirm-production") options.confirmProduction = true;
    else if (arg.startsWith("--run-id=")) options.runId = asInt(arg.slice("--run-id=".length), 0, 0, Number.MAX_SAFE_INTEGER);
    else if (arg.startsWith("--source=")) options.source = clean(arg.slice("--source=".length)).toLowerCase();
  }
  return options;
}

function canonicalFromChange(change = {}) {
  return clean(
    change.canonical_url ||
    change.after_posting?.canonical_url ||
    change.before_posting?.canonical_url ||
    change.after_cache?.canonical_url ||
    change.before_cache?.canonical_url,
    2000
  );
}

function sourceFromSnapshot(snapshot = {}) {
  return normalizeAtsKey(snapshot.ats_key || snapshot.source_ats || snapshot.source);
}

function validateChangeSource(change = {}, source = "") {
  const expected = normalizeAtsKey(source);
  const values = [
    change.ats_key,
    sourceFromSnapshot(change.before_posting || {}),
    sourceFromSnapshot(change.after_posting || {}),
    sourceFromSnapshot(change.before_cache || {}),
    sourceFromSnapshot(change.after_cache || {})
  ].map(normalizeAtsKey).filter(Boolean);
  return values.every((value) => value === expected);
}

function planRollbackFromChanges(changes = [], source = "") {
  const expected = normalizeAtsKey(source);
  const report = {
    ok: true,
    source: expected,
    changes_considered: Array.isArray(changes) ? changes.length : 0,
    created_rows_to_delete: 0,
    updated_rows_to_restore: 0,
    cache_rows_to_delete: 0,
    cache_rows_to_restore: 0,
    outbox_deletes: 0,
    outbox_upserts: 0,
    operations: [],
    errors: []
  };
  for (const change of Array.isArray(changes) ? changes : []) {
    const canonicalUrl = canonicalFromChange(change);
    if (!canonicalUrl) {
      report.errors.push({ code: "missing_canonical_url", change_id: change.id || null });
      continue;
    }
    if (!validateChangeSource(change, expected)) {
      report.errors.push({ code: "non_target_source_change", canonical_url: canonicalUrl, change_id: change.id || null });
      continue;
    }
    const beforePosting = change.before_posting || null;
    const afterPosting = change.after_posting || null;
    const beforeCache = change.before_cache || null;
    const afterCache = change.after_cache || null;
    if (!beforePosting && afterPosting) {
      report.created_rows_to_delete += 1;
      report.outbox_deletes += 1;
      report.operations.push({ type: "delete_created_public_row", canonical_url: canonicalUrl, change_id: change.id || null });
    } else if (beforePosting && afterPosting) {
      report.updated_rows_to_restore += 1;
      report.outbox_upserts += 1;
      report.operations.push({ type: "restore_updated_public_row", canonical_url: canonicalUrl, change_id: change.id || null });
    }
    if (!beforeCache && afterCache) {
      report.cache_rows_to_delete += 1;
      report.operations.push({ type: "delete_created_cache_row", canonical_url: canonicalUrl, change_id: change.id || null });
    } else if (beforeCache && afterCache) {
      report.cache_rows_to_restore += 1;
      report.operations.push({ type: "restore_updated_cache_row", canonical_url: canonicalUrl, change_id: change.id || null });
    }
  }
  if (report.errors.length > 0) report.ok = false;
  return report;
}

async function snapshotRows(pool, table, canonicalUrls = []) {
  const urls = Array.from(new Set((canonicalUrls || []).map((url) => clean(url, 2000)).filter(Boolean)));
  if (urls.length === 0) return new Map();
  const result = await pool.query(
    `SELECT canonical_url, to_jsonb(${table}.*) AS payload FROM ${table} WHERE canonical_url = ANY($1::text[]);`,
    [urls]
  );
  return new Map((result.rows || []).map((row) => [clean(row.canonical_url, 2000), row.payload]));
}

async function recordSourceRunPostingChanges(pool, options = {}) {
  const runId = Number(options.runId || 0);
  const source = normalizeAtsKey(options.source);
  const target = options.target || {};
  const postings = Array.isArray(options.postings) ? options.postings : [];
  if (!runId || !source || postings.length === 0) return { recorded: 0 };
  const canonicalUrls = postings
    .map((posting) => clean(posting.canonical_url || posting.job_posting_url, 2000))
    .filter(Boolean);
  const beforePostings = options.beforePostings || new Map();
  const beforeCache = options.beforeCache || new Map();
  const afterPostings = options.afterPostings || await snapshotRows(pool, "postings", canonicalUrls);
  const afterCache = options.afterCache || await snapshotRows(pool, "posting_cache", canonicalUrls);
  let recorded = 0;
  for (const canonicalUrl of canonicalUrls) {
    const beforePosting = beforePostings.get(canonicalUrl) || null;
    const afterPosting = afterPostings.get(canonicalUrl) || null;
    const beforeCacheRow = beforeCache.get(canonicalUrl) || null;
    const afterCacheRow = afterCache.get(canonicalUrl) || null;
    if (!afterPosting && !afterCacheRow) continue;
    const changeType = beforePosting ? "updated_public" : "created_public";
    await pool.query(
      `
        INSERT INTO ats_source_run_posting_changes (
          source_run_id, ats_key, source_host, source_url, canonical_url, source_job_id,
          change_type, before_posting, after_posting, before_cache, after_cache
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb,$11::jsonb);
      `,
      [
        runId,
        source,
        clean(target.host || ""),
        clean(target.companyUrl || ""),
        canonicalUrl,
        clean(afterPosting?.source_job_id || beforePosting?.source_job_id || ""),
        changeType,
        JSON.stringify(beforePosting),
        JSON.stringify(afterPosting),
        JSON.stringify(beforeCacheRow),
        JSON.stringify(afterCacheRow)
      ]
    );
    recorded += 1;
  }
  return { recorded };
}

async function restorePostingSnapshot(client, snapshot = {}) {
  await client.query(
    `
      INSERT INTO postings
      SELECT * FROM jsonb_populate_record(NULL::postings, $1::jsonb)
      ON CONFLICT (canonical_url) DO UPDATE SET
        company_id = EXCLUDED.company_id,
        company_name = EXCLUDED.company_name,
        position_name = EXCLUDED.position_name,
        apply_url = EXCLUDED.apply_url,
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
        ats_key = EXCLUDED.ats_key,
        source_job_id = EXCLUDED.source_job_id,
        posting_date = EXCLUDED.posting_date,
        posted_at_epoch = EXCLUDED.posted_at_epoch,
        first_seen_epoch = EXCLUDED.first_seen_epoch,
        last_seen_epoch = EXCLUDED.last_seen_epoch,
        hidden = EXCLUDED.hidden,
        parser_version = EXCLUDED.parser_version,
        confidence = EXCLUDED.confidence,
        quality_score = EXCLUDED.quality_score,
        quality_flags = EXCLUDED.quality_flags,
        rejection_reason = EXCLUDED.rejection_reason,
        updated_at = now();
    `,
    [JSON.stringify(snapshot)]
  );
}

async function restoreCacheSnapshot(client, snapshot = {}) {
  await client.query(
    `
      INSERT INTO posting_cache
      SELECT * FROM jsonb_populate_record(NULL::posting_cache, $1::jsonb)
      ON CONFLICT (canonical_url) DO UPDATE SET
        ats_key = EXCLUDED.ats_key,
        company_id = EXCLUDED.company_id,
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
        first_seen_epoch = EXCLUDED.first_seen_epoch,
        last_seen_epoch = EXCLUDED.last_seen_epoch,
        raw_payload_hash = EXCLUDED.raw_payload_hash,
        source_company_url = EXCLUDED.source_company_url,
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
    [JSON.stringify(snapshot)]
  );
}

async function applyRollbackWithClient(client, changes = [], source = "", options = {}) {
  const plan = planRollbackFromChanges(changes, source);
  if (!plan.ok) return plan;
  if (options.dryRun) return { ...plan, dry_run: true };
  for (const change of changes) {
    const canonicalUrl = canonicalFromChange(change);
    if (!canonicalUrl) continue;
    const beforePosting = change.before_posting || null;
    const afterPosting = change.after_posting || null;
    const beforeCache = change.before_cache || null;
    const afterCache = change.after_cache || null;
    if (!beforePosting && afterPosting) {
      await client.query("DELETE FROM postings WHERE canonical_url = $1 AND ats_key = $2;", [canonicalUrl, normalizeAtsKey(source)]);
      await client.query(
        "INSERT INTO search_index_outbox (canonical_url, operation, payload, available_at) VALUES ($1, 'delete', $2::jsonb, now());",
        [canonicalUrl, JSON.stringify({ reason: "ats_source_rollback", canonical_url: canonicalUrl, source: normalizeAtsKey(source) })]
      );
    } else if (beforePosting && afterPosting) {
      await restorePostingSnapshot(client, beforePosting);
      await client.query(
        "INSERT INTO search_index_outbox (canonical_url, operation, payload, available_at) VALUES ($1, 'upsert', $2::jsonb, now());",
        [canonicalUrl, JSON.stringify(beforePosting)]
      );
    }
    if (!beforeCache && afterCache) {
      await client.query("DELETE FROM posting_cache WHERE canonical_url = $1 AND ats_key = $2;", [canonicalUrl, normalizeAtsKey(source)]);
    } else if (beforeCache && afterCache) {
      await restoreCacheSnapshot(client, beforeCache);
    }
  }
  return plan;
}

async function runSourceRollback(options = parseRollbackArgs(), env = process.env) {
  const source = normalizeAtsKey(options.source);
  if (!source) throw new Error("--source=<ats> is required");
  if (!Number(options.runId || 0)) throw new Error("--run-id=<run_id> is required");
  if (!options.confirmProduction && !options.allowWithoutConfirm) {
    throw new Error("ats:source:rollback refuses to run without --confirm-production");
  }
  const poolEnv = {
    ...env,
    POSTGRES_STATEMENT_TIMEOUT_MS: String(options.statementTimeoutMs || 30_000),
    OPENJOBSLOTS_POSTGRES_STATEMENT_TIMEOUT_MS: String(options.statementTimeoutMs || 30_000)
  };
  const pool = options.pool || createPostgresPool({
    enabled: true,
    connectionString: env.DATABASE_URL || env.POSTGRES_URL || "",
    env: poolEnv
  });
  let lock = null;
  const report = {
    ok: true,
    source,
    source_run_id: Number(options.runId),
    dry_run: Boolean(options.dryRun),
    changes_considered: 0,
    rollback_id: 0
  };
  try {
    if (!options.pool) {
      await ensurePostgresSchema(pool);
      lock = await acquireHeavyJobLock(pool, `ats-source-rollback-${source}-${options.runId}`);
    }
    const run = await pool.query("SELECT id, ats_key FROM ats_source_runs WHERE id = $1;", [Number(options.runId)]);
    if (!run.rows[0]) throw new Error(`source run ${options.runId} not found`);
    if (normalizeAtsKey(run.rows[0].ats_key) !== source) {
      throw new Error(`source run ${options.runId} is ${run.rows[0].ats_key}, not ${source}`);
    }
    const changesResult = await pool.query(
      `
        SELECT id, source_run_id, ats_key, source_host, source_url, canonical_url, source_job_id,
               change_type, before_posting, after_posting, before_cache, after_cache
        FROM ats_source_run_posting_changes
        WHERE source_run_id = $1
          AND ats_key = $2
          AND rolled_back_at IS NULL
        ORDER BY id DESC;
      `,
      [Number(options.runId), source]
    );
    const changes = changesResult.rows || [];
    report.changes_considered = changes.length;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const rollback = await client.query(
        `
          INSERT INTO ats_source_run_rollbacks (
            source_run_id, ats_key, status, dry_run, changes_considered
          ) VALUES ($1,$2,'running',$3,$4)
          RETURNING id;
        `,
        [Number(options.runId), source, Boolean(options.dryRun), changes.length]
      );
      report.rollback_id = Number(rollback.rows[0]?.id || 0);
      const plan = await applyRollbackWithClient(client, changes, source, { dryRun: options.dryRun });
      Object.assign(report, plan);
      if (!plan.ok) throw new Error(`rollback refused: ${plan.errors.map((error) => error.code).join(", ")}`);
      if (!options.dryRun && changes.length > 0) {
        await client.query(
          "UPDATE ats_source_run_posting_changes SET rolled_back_at = now(), rollback_id = $2 WHERE id = ANY($1::bigint[]);",
          [changes.map((change) => Number(change.id)), report.rollback_id]
        );
      }
      await client.query(
        `
          UPDATE ats_source_run_rollbacks
          SET status = 'completed',
              created_rows_deleted = $2,
              updated_rows_restored = $3,
              cache_rows_deleted = $4,
              cache_rows_restored = $5,
              outbox_deletes = $6,
              outbox_upserts = $7,
              errors = $8::jsonb,
              finished_at = now()
          WHERE id = $1;
        `,
        [
          report.rollback_id,
          report.created_rows_to_delete,
          report.updated_rows_to_restore,
          report.cache_rows_to_delete,
          report.cache_rows_to_restore,
          report.outbox_deletes,
          report.outbox_upserts,
          JSON.stringify(report.errors || [])
        ]
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    if (lock) await lock.release("succeeded");
    lock = null;
    return report;
  } catch (error) {
    report.ok = false;
    report.error_message = clean(error?.message || error, 1000);
    if (lock) await lock.release("failed");
    lock = null;
    throw error;
  } finally {
    if (!options.pool && pool && typeof pool.end === "function") await pool.end();
  }
}

module.exports = {
  applyRollbackWithClient,
  parseRollbackArgs,
  planRollbackFromChanges,
  recordSourceRunPostingChanges,
  runSourceRollback,
  snapshotRows,
  validateChangeSource
};
