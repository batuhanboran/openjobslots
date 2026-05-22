const POSTGRES_SCHEMA_VERSION = "openjobslots-postgres-v1";
const { isAtsEnabledByDefault } = require("../ingestion/adapter-metadata");

function getPostgresConfig(env = process.env) {
  return {
    enabled: String(env.OPENJOBSLOTS_DB_BACKEND || "sqlite").trim().toLowerCase() === "postgres",
    connectionString: String(env.DATABASE_URL || env.POSTGRES_URL || "").trim(),
    schemaVersion: POSTGRES_SCHEMA_VERSION
  };
}

function parsePositiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
}

function createPostgresPool(config = getPostgresConfig()) {
  if (!config.enabled) return null;
  if (!config.connectionString) {
    throw new Error("OPENJOBSLOTS_DB_BACKEND=postgres requires DATABASE_URL");
  }
  const { Pool } = require("pg");
  const env = config.env || process.env;
  const statementTimeoutMs = parsePositiveInteger(
    env.POSTGRES_STATEMENT_TIMEOUT_MS || env.OPENJOBSLOTS_POSTGRES_STATEMENT_TIMEOUT_MS,
    120_000
  );
  const queryTimeoutMs = parsePositiveInteger(
    env.POSTGRES_QUERY_TIMEOUT_MS || env.OPENJOBSLOTS_POSTGRES_QUERY_TIMEOUT_MS,
    statementTimeoutMs + 10_000
  );
  return new Pool({
    connectionString: config.connectionString,
    max: parsePositiveInteger(env.POSTGRES_POOL_SIZE, 10),
    idleTimeoutMillis: parsePositiveInteger(env.POSTGRES_IDLE_TIMEOUT_MS, 30_000),
    connectionTimeoutMillis: parsePositiveInteger(env.POSTGRES_CONNECTION_TIMEOUT_MS, 10_000),
    statement_timeout: statementTimeoutMs,
    query_timeout: queryTimeoutMs,
    application_name: String(env.POSTGRES_APPLICATION_NAME || env.OPENJOBSLOTS_SERVICE_NAME || "openjobslots").slice(0, 60)
  });
}

async function ensurePostgresSchema(pool) {
  if (!pool) return { ok: true, skipped: true };
  await pool.query("SELECT pg_advisory_lock(hashtext('openjobslots_schema_migration'));");
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

    CREATE TABLE IF NOT EXISTS ats_sources (
      ats_key TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      enabled BOOLEAN NOT NULL DEFAULT true,
      protection_status TEXT NOT NULL DEFAULT 'normal',
      disabled_reason TEXT NOT NULL DEFAULT '',
      disabled_at TIMESTAMPTZ,
      quality_policy JSONB NOT NULL DEFAULT '{}'::jsonb,
      default_ttl_seconds INTEGER NOT NULL DEFAULT 86400,
      rate_limit_ms INTEGER NOT NULL DEFAULT 1000,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    ALTER TABLE IF EXISTS ats_sources
      ADD COLUMN IF NOT EXISTS protection_status TEXT NOT NULL DEFAULT 'normal',
      ADD COLUMN IF NOT EXISTS disabled_reason TEXT NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS disabled_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS quality_policy JSONB NOT NULL DEFAULT '{}'::jsonb;

    CREATE TABLE IF NOT EXISTS companies (
      id BIGSERIAL PRIMARY KEY,
      company_name TEXT NOT NULL,
      normalized_company_name TEXT NOT NULL,
      url_string TEXT NOT NULL,
      ats_key TEXT NOT NULL REFERENCES ats_sources(ats_key),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE(ats_key, url_string)
    );

    CREATE INDEX IF NOT EXISTS idx_companies_ats_key
      ON companies(ats_key);

    CREATE TABLE IF NOT EXISTS company_sync_state (
      ats_key TEXT NOT NULL REFERENCES ats_sources(ats_key),
      company_url TEXT NOT NULL,
      company_id BIGINT REFERENCES companies(id),
      company_name TEXT NOT NULL DEFAULT '',
      last_success_epoch BIGINT,
      last_failure_epoch BIGINT,
      next_sync_epoch BIGINT NOT NULL DEFAULT 0,
      etag TEXT NOT NULL DEFAULT '',
      last_modified TEXT NOT NULL DEFAULT '',
      consecutive_failures INTEGER NOT NULL DEFAULT 0,
      last_http_status INTEGER,
      last_error TEXT NOT NULL DEFAULT '',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (ats_key, company_url)
    );

    CREATE INDEX IF NOT EXISTS idx_company_sync_state_next_sync
      ON company_sync_state(next_sync_epoch, ats_key);

    CREATE TABLE IF NOT EXISTS posting_cache (
      canonical_url TEXT PRIMARY KEY,
      ats_key TEXT NOT NULL REFERENCES ats_sources(ats_key),
      company_id BIGINT REFERENCES companies(id),
      company_name TEXT NOT NULL,
      source_job_id TEXT NOT NULL DEFAULT '',
      position_name TEXT NOT NULL,
      location_text TEXT,
      city TEXT NOT NULL DEFAULT '',
      country TEXT NOT NULL DEFAULT '',
      region TEXT NOT NULL DEFAULT '',
      remote_type TEXT NOT NULL DEFAULT 'unknown',
      industry TEXT NOT NULL DEFAULT '',
      department TEXT NOT NULL DEFAULT '',
      employment_type TEXT NOT NULL DEFAULT '',
      description_plain TEXT NOT NULL DEFAULT '',
      description_html TEXT NOT NULL DEFAULT '',
      posting_date TEXT,
      posted_at_epoch BIGINT,
      first_seen_epoch BIGINT NOT NULL,
      last_seen_epoch BIGINT NOT NULL,
      raw_payload_hash TEXT NOT NULL,
      source_company_url TEXT NOT NULL DEFAULT '',
      parser_version TEXT NOT NULL,
      confidence REAL NOT NULL DEFAULT 0,
      quality_score INTEGER NOT NULL DEFAULT 0,
      quality_flags JSONB NOT NULL DEFAULT '[]'::jsonb,
      rejection_reason TEXT NOT NULL DEFAULT '',
      validation_status TEXT NOT NULL,
      validation_error TEXT NOT NULL DEFAULT '',
      raw_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS idx_posting_cache_ats_seen
      ON posting_cache(ats_key, last_seen_epoch DESC);
    CREATE INDEX IF NOT EXISTS idx_posting_cache_last_seen
      ON posting_cache(last_seen_epoch DESC);

    ALTER TABLE IF EXISTS posting_cache
      ADD COLUMN IF NOT EXISTS city TEXT NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS department TEXT NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS employment_type TEXT NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS description_plain TEXT NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS description_html TEXT NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS quality_score INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS quality_flags JSONB NOT NULL DEFAULT '[]'::jsonb,
      ADD COLUMN IF NOT EXISTS rejection_reason TEXT NOT NULL DEFAULT '';

    CREATE TABLE IF NOT EXISTS postings (
      canonical_url TEXT PRIMARY KEY,
      company_id BIGINT REFERENCES companies(id),
      company_name TEXT NOT NULL,
      position_name TEXT NOT NULL,
      apply_url TEXT NOT NULL DEFAULT '',
      location_text TEXT,
      city TEXT NOT NULL DEFAULT '',
      country TEXT NOT NULL DEFAULT '',
      region TEXT NOT NULL DEFAULT '',
      remote_type TEXT NOT NULL DEFAULT 'unknown',
      industry TEXT NOT NULL DEFAULT '',
      department TEXT NOT NULL DEFAULT '',
      employment_type TEXT NOT NULL DEFAULT '',
      description_plain TEXT NOT NULL DEFAULT '',
      description_html TEXT NOT NULL DEFAULT '',
      ats_key TEXT NOT NULL REFERENCES ats_sources(ats_key),
      source_job_id TEXT NOT NULL DEFAULT '',
      posting_date TEXT,
      posted_at_epoch BIGINT,
      first_seen_epoch BIGINT NOT NULL,
      last_seen_epoch BIGINT NOT NULL,
      hidden BOOLEAN NOT NULL DEFAULT false,
      parser_version TEXT NOT NULL,
      confidence REAL NOT NULL DEFAULT 0,
      quality_score INTEGER NOT NULL DEFAULT 0,
      quality_flags JSONB NOT NULL DEFAULT '[]'::jsonb,
      rejection_reason TEXT NOT NULL DEFAULT '',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS idx_postings_last_seen
      ON postings(hidden, last_seen_epoch DESC);
    CREATE INDEX IF NOT EXISTS idx_postings_ats_key
      ON postings(ats_key);
    CREATE INDEX IF NOT EXISTS idx_postings_country_region
      ON postings(country, region);
    CREATE INDEX IF NOT EXISTS idx_postings_active_ats_seen
      ON postings(ats_key, last_seen_epoch DESC)
      WHERE hidden = false;
    CREATE INDEX IF NOT EXISTS idx_postings_active_country_region_seen
      ON postings(country, region, last_seen_epoch DESC)
      WHERE hidden = false;
    CREATE INDEX IF NOT EXISTS idx_postings_active_industry_seen
      ON postings(industry, last_seen_epoch DESC)
      WHERE hidden = false;
    CREATE INDEX IF NOT EXISTS idx_postings_active_remote_seen
      ON postings(remote_type, last_seen_epoch DESC)
      WHERE hidden = false;

    ALTER TABLE IF EXISTS postings
      ADD COLUMN IF NOT EXISTS city TEXT NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS department TEXT NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS employment_type TEXT NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS description_plain TEXT NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS description_html TEXT NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS quality_score INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS quality_flags JSONB NOT NULL DEFAULT '[]'::jsonb,
      ADD COLUMN IF NOT EXISTS rejection_reason TEXT NOT NULL DEFAULT '';

    CREATE EXTENSION IF NOT EXISTS pg_trgm;
    CREATE EXTENSION IF NOT EXISTS unaccent;

    CREATE INDEX IF NOT EXISTS idx_postings_title_trgm
      ON postings USING gin (lower(position_name) gin_trgm_ops);
    CREATE INDEX IF NOT EXISTS idx_postings_company_trgm
      ON postings USING gin (lower(company_name) gin_trgm_ops);
    CREATE INDEX IF NOT EXISTS idx_postings_location_trgm
      ON postings USING gin (lower(coalesce(location_text, '')) gin_trgm_ops);

    CREATE TABLE IF NOT EXISTS posting_application_state (
      canonical_url TEXT PRIMARY KEY,
      applied BOOLEAN NOT NULL DEFAULT false,
      applied_by_type TEXT NOT NULL DEFAULT '',
      applied_by_label TEXT NOT NULL DEFAULT '',
      applied_at_epoch BIGINT,
      last_application_id BIGINT,
      ignored BOOLEAN NOT NULL DEFAULT false,
      ignored_at_epoch BIGINT,
      ignored_by_label TEXT NOT NULL DEFAULT '',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS ingestion_runs (
      id BIGSERIAL PRIMARY KEY,
      started_at_epoch BIGINT NOT NULL,
      finished_at_epoch BIGINT,
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
      http_status_counts JSONB NOT NULL DEFAULT '{}'::jsonb,
      active_ats JSONB NOT NULL DEFAULT '[]'::jsonb,
      last_error TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    ALTER TABLE IF EXISTS ingestion_runs
      ADD COLUMN IF NOT EXISTS rejected_count INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS duplicate_count INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS db_busy_count INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS current_ats TEXT NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS current_company_url TEXT NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS current_company_name TEXT NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS http_status_counts JSONB NOT NULL DEFAULT '{}'::jsonb;

    CREATE TABLE IF NOT EXISTS ingestion_run_errors (
      id BIGSERIAL PRIMARY KEY,
      run_id BIGINT REFERENCES ingestion_runs(id),
      ats_key TEXT NOT NULL,
      company_url TEXT NOT NULL DEFAULT '',
      company_name TEXT NOT NULL DEFAULT '',
      error_type TEXT NOT NULL DEFAULT 'unknown',
      error_message TEXT NOT NULL,
      http_status INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    ALTER TABLE IF EXISTS ingestion_run_errors
      ADD COLUMN IF NOT EXISTS error_type TEXT NOT NULL DEFAULT 'unknown';

    CREATE INDEX IF NOT EXISTS idx_ingestion_run_errors_ats
      ON ingestion_run_errors(ats_key, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_ingestion_run_errors_type_ats
      ON ingestion_run_errors(error_type, ats_key, created_at DESC);

    CREATE TABLE IF NOT EXISTS source_quality_events (
      id BIGSERIAL PRIMARY KEY,
      ats_key TEXT NOT NULL REFERENCES ats_sources(ats_key),
      event_type TEXT NOT NULL,
      severity TEXT NOT NULL DEFAULT 'warning',
      reason TEXT NOT NULL DEFAULT '',
      action TEXT NOT NULL DEFAULT '',
      metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS idx_source_quality_events_ats
      ON source_quality_events(ats_key, created_at DESC);

    CREATE TABLE IF NOT EXISTS source_payload_shapes (
      ats_key TEXT NOT NULL REFERENCES ats_sources(ats_key),
      parser_version TEXT NOT NULL,
      shape_hash TEXT NOT NULL,
      shape_paths JSONB NOT NULL DEFAULT '[]'::jsonb,
      observed_count INTEGER NOT NULL DEFAULT 1,
      first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (ats_key, parser_version)
    );

    CREATE TABLE IF NOT EXISTS parser_drift_events (
      id BIGSERIAL PRIMARY KEY,
      ats_key TEXT NOT NULL REFERENCES ats_sources(ats_key),
      parser_version TEXT NOT NULL,
      company_url TEXT NOT NULL DEFAULT '',
      company_name TEXT NOT NULL DEFAULT '',
      shape_hash TEXT NOT NULL DEFAULT '',
      baseline_hash TEXT NOT NULL DEFAULT '',
      similarity REAL NOT NULL DEFAULT 0,
      reason TEXT NOT NULL DEFAULT '',
      shape_paths JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS idx_parser_drift_events_ats
      ON parser_drift_events(ats_key, created_at DESC);

    CREATE TABLE IF NOT EXISTS ats_source_runs (
      id BIGSERIAL PRIMARY KEY,
      run_key TEXT NOT NULL DEFAULT '',
      ats_key TEXT NOT NULL REFERENCES ats_sources(ats_key),
      mode TEXT NOT NULL DEFAULT 'dry-run',
      status TEXT NOT NULL DEFAULT 'running',
      requested_limit INTEGER NOT NULL DEFAULT 0,
      max_updates INTEGER NOT NULL DEFAULT 0,
      source_host_count INTEGER NOT NULL DEFAULT 0,
      fetch_count INTEGER NOT NULL DEFAULT 0,
      parse_count INTEGER NOT NULL DEFAULT 0,
      accepted_count INTEGER NOT NULL DEFAULT 0,
      quarantined_count INTEGER NOT NULL DEFAULT 0,
      rejected_count INTEGER NOT NULL DEFAULT 0,
      public_write_count INTEGER NOT NULL DEFAULT 0,
      quarantine_write_count INTEGER NOT NULL DEFAULT 0,
      http_status_counts JSONB NOT NULL DEFAULT '{}'::jsonb,
      parser_failure_reasons JSONB NOT NULL DEFAULT '{}'::jsonb,
      average_latency_ms INTEGER NOT NULL DEFAULT 0,
      stop_reason TEXT NOT NULL DEFAULT '',
      error_message TEXT NOT NULL DEFAULT '',
      started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      finished_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS idx_ats_source_runs_status
      ON ats_source_runs(status, started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_ats_source_runs_ats
      ON ats_source_runs(ats_key, started_at DESC);

    CREATE TABLE IF NOT EXISTS ats_source_run_errors (
      id BIGSERIAL PRIMARY KEY,
      source_run_id BIGINT REFERENCES ats_source_runs(id),
      ats_key TEXT NOT NULL REFERENCES ats_sources(ats_key),
      source_host TEXT NOT NULL DEFAULT '',
      source_url TEXT NOT NULL DEFAULT '',
      error_type TEXT NOT NULL DEFAULT 'unknown',
      error_message TEXT NOT NULL DEFAULT '',
      http_status INTEGER,
      parser_reason TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS idx_ats_source_run_errors_run
      ON ats_source_run_errors(source_run_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_ats_source_run_errors_ats
      ON ats_source_run_errors(ats_key, created_at DESC);

    CREATE TABLE IF NOT EXISTS ats_source_run_metrics (
      id BIGSERIAL PRIMARY KEY,
      source_run_id BIGINT REFERENCES ats_source_runs(id),
      ats_key TEXT NOT NULL REFERENCES ats_sources(ats_key),
      metric_name TEXT NOT NULL,
      metric_value DOUBLE PRECISION NOT NULL DEFAULT 0,
      labels JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS idx_ats_source_run_metrics_run
      ON ats_source_run_metrics(source_run_id, metric_name);

    CREATE TABLE IF NOT EXISTS ats_source_run_rollbacks (
      id BIGSERIAL PRIMARY KEY,
      source_run_id BIGINT REFERENCES ats_source_runs(id),
      ats_key TEXT NOT NULL REFERENCES ats_sources(ats_key),
      status TEXT NOT NULL DEFAULT 'running',
      dry_run BOOLEAN NOT NULL DEFAULT false,
      changes_considered INTEGER NOT NULL DEFAULT 0,
      created_rows_deleted INTEGER NOT NULL DEFAULT 0,
      updated_rows_restored INTEGER NOT NULL DEFAULT 0,
      cache_rows_deleted INTEGER NOT NULL DEFAULT 0,
      cache_rows_restored INTEGER NOT NULL DEFAULT 0,
      outbox_deletes INTEGER NOT NULL DEFAULT 0,
      outbox_upserts INTEGER NOT NULL DEFAULT 0,
      errors JSONB NOT NULL DEFAULT '[]'::jsonb,
      started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      finished_at TIMESTAMPTZ
    );

    CREATE INDEX IF NOT EXISTS idx_ats_source_run_rollbacks_run
      ON ats_source_run_rollbacks(source_run_id, started_at DESC);

    CREATE TABLE IF NOT EXISTS ats_source_run_posting_changes (
      id BIGSERIAL PRIMARY KEY,
      source_run_id BIGINT REFERENCES ats_source_runs(id),
      ats_key TEXT NOT NULL REFERENCES ats_sources(ats_key),
      source_host TEXT NOT NULL DEFAULT '',
      source_url TEXT NOT NULL DEFAULT '',
      canonical_url TEXT NOT NULL,
      source_job_id TEXT NOT NULL DEFAULT '',
      change_type TEXT NOT NULL,
      before_posting JSONB,
      after_posting JSONB,
      before_cache JSONB,
      after_cache JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      rolled_back_at TIMESTAMPTZ,
      rollback_id BIGINT REFERENCES ats_source_run_rollbacks(id)
    );

    CREATE INDEX IF NOT EXISTS idx_ats_source_run_posting_changes_run
      ON ats_source_run_posting_changes(source_run_id, id DESC);
    CREATE INDEX IF NOT EXISTS idx_ats_source_run_posting_changes_source
      ON ats_source_run_posting_changes(ats_key, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_ats_source_run_posting_changes_canonical
      ON ats_source_run_posting_changes(canonical_url);

    CREATE TABLE IF NOT EXISTS search_index_outbox (
      id BIGSERIAL PRIMARY KEY,
      canonical_url TEXT NOT NULL,
      operation TEXT NOT NULL CHECK (operation IN ('upsert', 'delete')),
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      attempts INTEGER NOT NULL DEFAULT 0,
      available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      processed_at TIMESTAMPTZ,
      last_error TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS idx_search_index_outbox_due
      ON search_index_outbox(processed_at, available_at);

    CREATE TABLE IF NOT EXISTS public_search_events (
      id BIGSERIAL PRIMARY KEY,
      event_type TEXT NOT NULL CHECK (event_type IN ('postings', 'suggest', 'filter_options')),
      query TEXT NOT NULL DEFAULT '',
      query_normalized TEXT NOT NULL DEFAULT '',
      result_count INTEGER,
      result_items INTEGER,
      limit_value INTEGER,
      offset_value INTEGER,
      sort_by TEXT NOT NULL DEFAULT '',
      remote_filter TEXT NOT NULL DEFAULT '',
      ats_filter_count INTEGER NOT NULL DEFAULT 0,
      country_filter_count INTEGER NOT NULL DEFAULT 0,
      region_filter_count INTEGER NOT NULL DEFAULT 0,
      referrer_host TEXT NOT NULL DEFAULT '',
      user_agent_family TEXT NOT NULL DEFAULT '',
      cache_status TEXT NOT NULL DEFAULT '',
      anonymous_session_key TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    ALTER TABLE IF EXISTS public_search_events
      ADD COLUMN IF NOT EXISTS anonymous_session_key TEXT NOT NULL DEFAULT '';

    CREATE INDEX IF NOT EXISTS idx_public_search_events_created
      ON public_search_events(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_public_search_events_type_created
      ON public_search_events(event_type, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_public_search_events_query_created
      ON public_search_events(query_normalized, created_at DESC)
      WHERE query_normalized <> '';
    CREATE INDEX IF NOT EXISTS idx_public_search_events_session_created
      ON public_search_events(anonymous_session_key, created_at DESC)
      WHERE anonymous_session_key <> '';

    CREATE TABLE IF NOT EXISTS ats_rate_limits (
      rate_limit_key TEXT PRIMARY KEY,
      blocked_until_epoch_ms BIGINT NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS idx_ats_rate_limits_blocked_until
      ON ats_rate_limits(blocked_until_epoch_ms);

    CREATE TABLE IF NOT EXISTS sync_control (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      status TEXT NOT NULL DEFAULT 'idle',
      requested_at_epoch BIGINT,
      cancel_requested_at_epoch BIGINT,
      active_run_id BIGINT,
      message TEXT NOT NULL DEFAULT '',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    INSERT INTO sync_control (id, status)
    VALUES (1, 'idle')
    ON CONFLICT(id) DO NOTHING;

      INSERT INTO schema_migrations (version)
      VALUES ('${POSTGRES_SCHEMA_VERSION}')
      ON CONFLICT(version) DO NOTHING;
    `);
  } finally {
    await pool.query("SELECT pg_advisory_unlock(hashtext('openjobslots_schema_migration'));");
  }

  return { ok: true, schemaVersion: POSTGRES_SCHEMA_VERSION };
}

async function seedPostgresAtsSources(pool, atsItems) {
  if (!pool) return { ok: true, skipped: true, count: 0 };
  const items = Array.isArray(atsItems) ? atsItems : [];
  let count = 0;
  for (const item of items) {
    const atsKey = String(item?.value || "").trim();
    if (!atsKey) continue;
    await pool.query(
      `
        INSERT INTO ats_sources (ats_key, display_name, enabled, updated_at)
        VALUES ($1, $2, $3, now())
        ON CONFLICT(ats_key) DO UPDATE SET
          display_name = EXCLUDED.display_name,
          enabled = CASE WHEN EXCLUDED.enabled = false THEN false ELSE ats_sources.enabled END,
          updated_at = now();
      `,
      [atsKey, String(item?.label || atsKey).trim(), isAtsEnabledByDefault(atsKey)]
    );
    count += 1;
  }
  return { ok: true, count };
}

module.exports = {
  POSTGRES_SCHEMA_VERSION,
  createPostgresPool,
  ensurePostgresSchema,
  getPostgresConfig,
  seedPostgresAtsSources
};
