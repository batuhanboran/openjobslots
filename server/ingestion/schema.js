const DEFAULT_TTL_SECONDS = 24 * 60 * 60;
const DEFAULT_RATE_LIMIT_MS = 1000;
const { isAtsEnabledByDefault } = require("./adapter-metadata");

async function ensureColumn(db, tableName, columnName, definition) {
  const columns = await db.all(`PRAGMA table_info('${tableName}');`);
  const existing = new Set(columns.map((column) => String(column?.name || "")));
  if (existing.has(columnName)) return;
  await db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition};`);
}

async function ensureIngestionTables(db) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS ats_sources (
      ats_key TEXT NOT NULL PRIMARY KEY,
      display_name TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      default_ttl_seconds INTEGER NOT NULL DEFAULT ${DEFAULT_TTL_SECONDS},
      rate_limit_ms INTEGER NOT NULL DEFAULT ${DEFAULT_RATE_LIMIT_MS},
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS company_sync_state (
      ats_key TEXT NOT NULL,
      company_url TEXT NOT NULL,
      company_id INTEGER,
      company_name TEXT NOT NULL DEFAULT '',
      last_success_epoch INTEGER,
      last_failure_epoch INTEGER,
      next_sync_epoch INTEGER NOT NULL DEFAULT 0,
      etag TEXT NOT NULL DEFAULT '',
      last_modified TEXT NOT NULL DEFAULT '',
      consecutive_failures INTEGER NOT NULL DEFAULT 0,
      last_http_status INTEGER,
      last_error TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (ats_key, company_url)
    );

    CREATE INDEX IF NOT EXISTS idx_company_sync_state_next_sync
      ON company_sync_state(next_sync_epoch, ats_key);

    CREATE TABLE IF NOT EXISTS posting_cache (
      canonical_url TEXT NOT NULL PRIMARY KEY,
      ats_key TEXT NOT NULL,
      company_name TEXT NOT NULL,
      position_name TEXT NOT NULL,
      location TEXT,
      posting_date TEXT,
      raw_payload_hash TEXT NOT NULL,
      source_company_url TEXT NOT NULL DEFAULT '',
      first_seen_epoch INTEGER NOT NULL,
      last_seen_epoch INTEGER NOT NULL,
      parser_version TEXT NOT NULL,
      validation_status TEXT NOT NULL,
      validation_error TEXT NOT NULL DEFAULT '',
      raw_metadata TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_posting_cache_ats_seen
      ON posting_cache(ats_key, last_seen_epoch);

    CREATE TABLE IF NOT EXISTS ingestion_runs (
      id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      started_at_epoch INTEGER NOT NULL,
      finished_at_epoch INTEGER,
      status TEXT NOT NULL,
      total_targets INTEGER NOT NULL DEFAULT 0,
      success_count INTEGER NOT NULL DEFAULT 0,
      failure_count INTEGER NOT NULL DEFAULT 0,
      cache_hit_count INTEGER NOT NULL DEFAULT 0,
      cache_write_count INTEGER NOT NULL DEFAULT 0,
      posting_upsert_count INTEGER NOT NULL DEFAULT 0,
      rejected_count INTEGER NOT NULL DEFAULT 0,
      duplicate_count INTEGER NOT NULL DEFAULT 0,
      db_busy_count INTEGER NOT NULL DEFAULT 0,
      current_ats TEXT NOT NULL DEFAULT '',
      current_company_url TEXT NOT NULL DEFAULT '',
      current_company_name TEXT NOT NULL DEFAULT '',
      http_status_counts TEXT NOT NULL DEFAULT '{}',
      active_ats TEXT NOT NULL DEFAULT '[]',
      last_error TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS ingestion_run_errors (
      id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      run_id INTEGER NOT NULL,
      ats_key TEXT NOT NULL,
      company_url TEXT NOT NULL DEFAULT '',
      company_name TEXT NOT NULL DEFAULT '',
      error_type TEXT NOT NULL DEFAULT 'unknown',
      error_message TEXT NOT NULL,
      http_status INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (run_id) REFERENCES ingestion_runs(id)
    );

    CREATE INDEX IF NOT EXISTS idx_ingestion_run_errors_run_id
      ON ingestion_run_errors(run_id);
  `);

  await ensureColumn(db, "ingestion_run_errors", "error_type", "TEXT NOT NULL DEFAULT 'unknown'");
  await ensureColumn(db, "ingestion_runs", "rejected_count", "INTEGER NOT NULL DEFAULT 0");
  await ensureColumn(db, "ingestion_runs", "duplicate_count", "INTEGER NOT NULL DEFAULT 0");
  await ensureColumn(db, "ingestion_runs", "db_busy_count", "INTEGER NOT NULL DEFAULT 0");
  await ensureColumn(db, "ingestion_runs", "current_ats", "TEXT NOT NULL DEFAULT ''");
  await ensureColumn(db, "ingestion_runs", "current_company_url", "TEXT NOT NULL DEFAULT ''");
  await ensureColumn(db, "ingestion_runs", "current_company_name", "TEXT NOT NULL DEFAULT ''");
  await ensureColumn(db, "ingestion_runs", "http_status_counts", "TEXT NOT NULL DEFAULT '{}'");
  await db.exec(`
    CREATE INDEX IF NOT EXISTS idx_ingestion_run_errors_type_ats
      ON ingestion_run_errors(error_type, ats_key, created_at);
  `);
}

async function seedAtsSources(db, atsItems, options = {}) {
  const defaultTtlSeconds = Number(options.defaultTtlSeconds || DEFAULT_TTL_SECONDS);
  const defaultRateLimitMs = Number(options.defaultRateLimitMs || DEFAULT_RATE_LIMIT_MS);
  const items = Array.isArray(atsItems) ? atsItems : [];

  for (const item of items) {
    const atsKey = String(item?.value || "").trim();
    if (!atsKey) continue;
    const displayName = String(item?.label || atsKey).trim();
    const enabledByDefault = isAtsEnabledByDefault(atsKey) ? 1 : 0;
    await db.run(
      `
        INSERT INTO ats_sources (
          ats_key,
          display_name,
          enabled,
          default_ttl_seconds,
          rate_limit_ms,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(ats_key) DO UPDATE SET
          display_name = excluded.display_name,
          enabled = CASE WHEN excluded.enabled = 0 THEN 0 ELSE ats_sources.enabled END,
          updated_at = datetime('now');
      `,
      [atsKey, displayName, enabledByDefault, defaultTtlSeconds, defaultRateLimitMs]
    );
  }
}

module.exports = {
  DEFAULT_RATE_LIMIT_MS,
  DEFAULT_TTL_SECONDS,
  ensureIngestionTables,
  seedAtsSources
};
