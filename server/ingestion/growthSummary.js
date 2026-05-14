const {
  classifyStoredPosting,
  isWeakRemoteType,
  pct
} = require("./dataQualityAudit");

const DEFAULT_HOURS = 24;
const MAX_HOURS = 24 * 90;
const GENERIC_TITLE_RE = /^(untitled|unknown|n\/?a|not available|job opening|new job|open position|position)$/i;

function clean(value) {
  return String(value ?? "").trim();
}

function normalizeHours(value) {
  const parsed = Number(value || DEFAULT_HOURS);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_HOURS;
  return Math.max(1, Math.min(MAX_HOURS, Math.floor(parsed)));
}

function cutoffEpochForHours(hours, nowEpoch = Math.floor(Date.now() / 1000)) {
  return Math.max(0, Number(nowEpoch || 0) - normalizeHours(hours) * 60 * 60);
}

function isHttpUrl(value) {
  return /^https?:\/\//i.test(clean(value));
}

function isGenericTitle(value) {
  return GENERIC_TITLE_RE.test(clean(value));
}

function hasExplicitRemoteEvidence(row = {}) {
  const remoteType = clean(row.remote_type).toLowerCase();
  return remoteType === "remote" || remoteType === "hybrid";
}

function hasStableSourceId(row = {}) {
  return Boolean(clean(row.source_job_id) || isHttpUrl(row.canonical_url || row.job_posting_url));
}

function isIndexablePublicRow(row = {}) {
  const title = clean(row.position_name || row.title);
  const company = clean(row.company_name || row.company);
  return (
    row.hidden !== true &&
    row.hidden !== 1 &&
    String(row.hidden || "false").toLowerCase() !== "true" &&
    isHttpUrl(row.canonical_url || row.job_posting_url) &&
    Boolean(title) &&
    Boolean(company) &&
    !isGenericTitle(title)
  );
}

function hasUsefulNormalizedGeo(row = {}) {
  const classification = classifyStoredPosting(row);
  return !classification.missing_all_normalized_geo && !classification.suspicious_unknown_geo;
}

function classifyGrowthPosting(row = {}) {
  const classification = classifyStoredPosting(row);
  const indexable = isIndexablePublicRow(row);
  const explicitRemote = hasExplicitRemoteEvidence(row);
  const usefulGeo = hasUsefulNormalizedGeo(row);
  const noGeoNoRemote = !usefulGeo && !explicitRemote;
  const cleanPublicRow =
    indexable &&
    hasStableSourceId(row) &&
    (usefulGeo || explicitRemote) &&
    !noGeoNoRemote;
  return {
    ...classification,
    explicit_remote_or_hybrid: explicitRemote,
    useful_normalized_geo: usefulGeo,
    indexable_public_row: indexable,
    stable_source_id: hasStableSourceId(row),
    no_geo_no_remote: noGeoNoRemote,
    clean_public_row: cleanPublicRow
  };
}

function emptyAtsBucket(atsKey) {
  return {
    ats_key: clean(atsKey) || "unknown",
    new_visible_rows: 0,
    new_indexable_rows: 0,
    new_clean_rows: 0,
    dirty_public_rows: 0,
    new_rows_missing_any_geo: 0,
    new_rows_weak_unknown_remote: 0,
    new_no_geo_no_remote: 0,
    new_quarantine_rows: 0,
    new_rejected_rows: 0,
    clean_acceptance_rate_pct: 0
  };
}

function getBucket(map, atsKey) {
  const key = clean(atsKey) || "unknown";
  if (!map.has(key)) map.set(key, emptyAtsBucket(key));
  return map.get(key);
}

function isRejectedCacheStatus(status) {
  const normalized = clean(status).toLowerCase();
  return Boolean(normalized && normalized !== "valid" && normalized !== "quarantined");
}

function isFailedSourceRun(run = {}) {
  const status = clean(run.status).toLowerCase();
  return (
    status === "failed" ||
    status === "completed_with_errors" ||
    status === "error" ||
    Boolean(clean(run.error_message))
  );
}

function finalizeBucket(bucket) {
  const denominator =
    Number(bucket.new_visible_rows || 0) +
    Number(bucket.new_quarantine_rows || 0) +
    Number(bucket.new_rejected_rows || 0);
  return {
    ...bucket,
    clean_acceptance_rate_pct: pct(bucket.new_clean_rows, denominator)
  };
}

function attachWindowAliases(report) {
  const suffix = Number(report.hours || 0) === 24 ? "24h" : `${Number(report.hours || 0)}h`;
  const metrics = report.metrics || {};
  const aliases = {
    [`new_visible_rows_${suffix}`]: metrics.new_visible_rows,
    [`new_indexable_rows_${suffix}`]: metrics.new_indexable_rows,
    [`new_clean_rows_${suffix}`]: metrics.new_clean_rows,
    [`new_rows_missing_any_geo_${suffix}`]: metrics.new_rows_missing_any_geo,
    [`new_rows_weak_unknown_remote_${suffix}`]: metrics.new_rows_weak_unknown_remote,
    [`new_no_geo_no_remote_${suffix}`]: metrics.new_no_geo_no_remote,
    [`new_quarantine_rows_${suffix}`]: metrics.new_quarantine_rows,
    [`new_rejected_rows_${suffix}`]: metrics.new_rejected_rows,
    [`new_rows_by_ats_${suffix}`]: report.new_rows_by_ats,
    [`clean_acceptance_rate_by_ats_${suffix}`]: report.clean_acceptance_rate_by_ats,
    [`meili_indexed_rows_added_${suffix}`]: metrics.meili_indexed_rows_added,
    [`worker_source_runs_${suffix}`]: metrics.worker_source_runs,
    [`failed_source_runs_${suffix}`]: metrics.failed_source_runs
  };
  return { ...report, ...aliases };
}

function summarizeGrowthRows(input = {}, options = {}) {
  const hours = normalizeHours(options.hours);
  const nowEpoch = Number(options.nowEpoch || Math.floor(Date.now() / 1000));
  const cutoffEpoch = Number(options.cutoffEpoch || cutoffEpochForHours(hours, nowEpoch));
  const publicRows = Array.isArray(input.publicRows) ? input.publicRows : [];
  const cacheRows = Array.isArray(input.cacheRows) ? input.cacheRows : [];
  const sourceRuns = Array.isArray(input.sourceRuns) ? input.sourceRuns : [];
  const meiliOutboxRows = Array.isArray(input.meiliOutboxRows) ? input.meiliOutboxRows : [];
  const buckets = new Map();

  const metrics = {
    new_visible_rows: 0,
    new_indexable_rows: 0,
    new_clean_rows: 0,
    dirty_public_rows: 0,
    new_rows_missing_any_geo: 0,
    new_rows_weak_unknown_remote: 0,
    new_no_geo_no_remote: 0,
    new_quarantine_rows: 0,
    new_rejected_rows: 0,
    meili_indexed_rows_added: 0,
    meili_outbox_upserts_processed: 0,
    worker_source_runs: 0,
    failed_source_runs: 0
  };

  for (const row of publicRows) {
    const atsKey = clean(row.ats_key || row.source_ats) || "unknown";
    const bucket = getBucket(buckets, atsKey);
    const classification = classifyGrowthPosting(row);
    metrics.new_visible_rows += 1;
    bucket.new_visible_rows += 1;
    if (classification.indexable_public_row) {
      metrics.new_indexable_rows += 1;
      bucket.new_indexable_rows += 1;
    }
    if (classification.clean_public_row) {
      metrics.new_clean_rows += 1;
      bucket.new_clean_rows += 1;
    } else {
      metrics.dirty_public_rows += 1;
      bucket.dirty_public_rows += 1;
    }
    if (classification.missing_any_normalized_geo) {
      metrics.new_rows_missing_any_geo += 1;
      bucket.new_rows_missing_any_geo += 1;
    }
    if (classification.weak_unknown_remote_type || isWeakRemoteType(row.remote_type)) {
      metrics.new_rows_weak_unknown_remote += 1;
      bucket.new_rows_weak_unknown_remote += 1;
    }
    if (classification.no_geo_no_remote) {
      metrics.new_no_geo_no_remote += 1;
      bucket.new_no_geo_no_remote += 1;
    }
  }

  for (const row of cacheRows) {
    const atsKey = clean(row.ats_key || row.source_ats) || "unknown";
    const bucket = getBucket(buckets, atsKey);
    const status = clean(row.validation_status).toLowerCase();
    if (status === "quarantined") {
      metrics.new_quarantine_rows += 1;
      bucket.new_quarantine_rows += 1;
    } else if (isRejectedCacheStatus(status)) {
      metrics.new_rejected_rows += 1;
      bucket.new_rejected_rows += 1;
    }
  }

  metrics.worker_source_runs = sourceRuns.length;
  metrics.failed_source_runs = sourceRuns.filter(isFailedSourceRun).length;
  metrics.meili_outbox_upserts_processed = meiliOutboxRows.filter((row) => (
    clean(row.operation).toLowerCase() === "upsert" && row.processed_at
  )).length;
  metrics.meili_indexed_rows_added = metrics.new_indexable_rows;

  const newRowsByAts = Array.from(buckets.values())
    .map(finalizeBucket)
    .sort((a, b) => b.new_clean_rows - a.new_clean_rows || b.new_visible_rows - a.new_visible_rows || a.ats_key.localeCompare(b.ats_key));

  const report = {
    ok: true,
    hours,
    window_started_epoch: cutoffEpoch,
    window_started_at: new Date(cutoffEpoch * 1000).toISOString(),
    generated_at: new Date(nowEpoch * 1000).toISOString(),
    current_visible_rows: Number(input.currentVisibleRows || 0),
    current_indexable_rows: Number(input.currentIndexableRows || 0),
    metrics,
    new_rows_by_ats: newRowsByAts,
    clean_acceptance_rate_by_ats: newRowsByAts.map((row) => ({
      ats_key: row.ats_key,
      clean_acceptance_rate_pct: row.clean_acceptance_rate_pct,
      new_clean_rows: row.new_clean_rows,
      new_visible_rows: row.new_visible_rows,
      new_quarantine_rows: row.new_quarantine_rows,
      new_rejected_rows: row.new_rejected_rows
    })),
    meili_indexed_rows_added_basis: "postgres_new_indexable_rows_first_seen_in_window",
    clean_row_definition: {
      required_fields: ["title", "company", "canonical_url"],
      stable_id_rule: "source_job_id or stable canonical_url",
      quality_rule: "accepted public indexable row with useful normalized geo or explicit remote/hybrid and no no_geo_no_remote"
    }
  };
  return attachWindowAliases(report);
}

function postgresIndexableWhereClause(alias = "p") {
  const prefix = alias ? `${alias}.` : "";
  return `
    ${prefix}hidden = false
    AND ${prefix}canonical_url > ''
    AND (${prefix}canonical_url LIKE 'http://%' OR ${prefix}canonical_url LIKE 'https://%')
    AND ${prefix}position_name IS NOT NULL
    AND btrim(${prefix}position_name) <> ''
    AND ${prefix}company_name IS NOT NULL
    AND btrim(${prefix}company_name) <> ''
    AND ${prefix}position_name !~* '^(untitled|unknown|n/?a|not available|job opening|new job|open position|position)$'
  `;
}

async function getPostgresGrowthSummary(pool, options = {}) {
  const hours = normalizeHours(options.hours);
  const nowEpoch = Number(options.nowEpoch || Math.floor(Date.now() / 1000));
  const cutoffEpoch = cutoffEpochForHours(hours, nowEpoch);
  const [
    currentCounts,
    publicRows,
    cacheRows,
    sourceRuns,
    meiliOutboxRows
  ] = await Promise.all([
    pool.query(
      `
        SELECT
          COUNT(*) FILTER (WHERE hidden = false)::bigint AS current_visible_rows,
          COUNT(*) FILTER (WHERE ${postgresIndexableWhereClause("p")})::bigint AS current_indexable_rows
        FROM postings p;
      `
    ),
    pool.query(
      `
        SELECT
          canonical_url,
          company_name,
          position_name,
          ats_key,
          source_job_id,
          location_text,
          city,
          country,
          region,
          remote_type,
          hidden,
          first_seen_epoch,
          last_seen_epoch
        FROM postings
        WHERE hidden = false
          AND first_seen_epoch >= $1
        ORDER BY first_seen_epoch DESC, ats_key ASC, canonical_url ASC;
      `,
      [cutoffEpoch]
    ),
    pool.query(
      `
        SELECT
          canonical_url,
          ats_key,
          validation_status,
          validation_error,
          rejection_reason,
          first_seen_epoch,
          last_seen_epoch,
          updated_at
        FROM posting_cache
        WHERE first_seen_epoch >= $1
          AND validation_status <> 'valid'
        ORDER BY first_seen_epoch DESC, ats_key ASC, canonical_url ASC;
      `,
      [cutoffEpoch]
    ),
    pool.query(
      `
        SELECT ats_key, mode, status, stop_reason, error_message, started_at, finished_at
        FROM ats_source_runs
        WHERE started_at >= to_timestamp($1)
        ORDER BY started_at DESC, ats_key ASC;
      `,
      [cutoffEpoch]
    ),
    pool.query(
      `
        SELECT operation, processed_at, created_at
        FROM search_index_outbox
        WHERE COALESCE(processed_at, created_at) >= to_timestamp($1)
        ORDER BY COALESCE(processed_at, created_at) DESC;
      `,
      [cutoffEpoch]
    )
  ]);

  return summarizeGrowthRows(
    {
      publicRows: publicRows.rows,
      cacheRows: cacheRows.rows,
      sourceRuns: sourceRuns.rows,
      meiliOutboxRows: meiliOutboxRows.rows,
      currentVisibleRows: currentCounts.rows[0]?.current_visible_rows,
      currentIndexableRows: currentCounts.rows[0]?.current_indexable_rows
    },
    { hours, nowEpoch, cutoffEpoch }
  );
}

function createEmptyGrowthSummary(options = {}) {
  return summarizeGrowthRows({}, options);
}

module.exports = {
  attachWindowAliases,
  classifyGrowthPosting,
  createEmptyGrowthSummary,
  cutoffEpochForHours,
  getPostgresGrowthSummary,
  hasExplicitRemoteEvidence,
  hasStableSourceId,
  hasUsefulNormalizedGeo,
  isFailedSourceRun,
  isIndexablePublicRow,
  normalizeHours,
  postgresIndexableWhereClause,
  summarizeGrowthRows
};
