const fs = require("fs");
const path = require("path");

const BLANK_TEXT_VALUES = new Set([
  "",
  "unknown",
  "n/a",
  "na",
  "none",
  "null",
  "undefined",
  "not available",
  "not applicable",
  "not specified",
  "unspecified"
]);

const SUSPICIOUS_GEO_VALUES = new Set([
  ...Array.from(BLANK_TEXT_VALUES).filter(Boolean),
  "remote",
  "remote only",
  "work from home",
  "wfh",
  "multiple",
  "multiple locations",
  "various",
  "various locations",
  "global",
  "worldwide"
]);

const WEAK_REMOTE_VALUES = new Set([
  "",
  "unknown",
  "n/a",
  "na",
  "none",
  "null",
  "undefined",
  "not available",
  "not applicable",
  "not specified",
  "unspecified"
]);

const AUDIT_COUNT_FIELDS = [
  "missing_country",
  "missing_location_text",
  "missing_region_state",
  "missing_city",
  "missing_any_normalized_geo",
  "missing_all_normalized_geo",
  "missing_location_and_all_geo",
  "suspicious_unknown_geo",
  "missing_remote_type",
  "weak_unknown_remote_type",
  "missing_all_geo_and_weak_remote"
];

function cleanText(value) {
  return String(value ?? "").trim();
}

function normalizedText(value) {
  return cleanText(value).toLowerCase();
}

function isBlankLike(value) {
  return BLANK_TEXT_VALUES.has(normalizedText(value));
}

function isSuspiciousGeoValue(value) {
  return SUSPICIOUS_GEO_VALUES.has(normalizedText(value));
}

function isMissingRemoteType(value) {
  const normalized = normalizedText(value);
  return normalized === "" || normalized === "n/a" || normalized === "na" || normalized === "not available";
}

function isWeakRemoteType(value) {
  return WEAK_REMOTE_VALUES.has(normalizedText(value));
}

function normalizeGroupValue(value) {
  return cleanText(value) || "unknown";
}

function classifyStoredPosting(row = {}) {
  const missingCountry = isBlankLike(row.country);
  const missingLocationText = isBlankLike(row.location_text || row.location);
  const missingRegionState = isBlankLike(row.region || row.state);
  const missingCity = isBlankLike(row.city);
  const missingAnyNormalizedGeo = missingCountry || missingRegionState || missingCity;
  const missingAllNormalizedGeo = missingCountry && missingRegionState && missingCity;
  const suspiciousUnknownGeo =
    isSuspiciousGeoValue(row.location_text || row.location) ||
    isSuspiciousGeoValue(row.country) ||
    isSuspiciousGeoValue(row.region || row.state) ||
    isSuspiciousGeoValue(row.city);
  const missingRemoteType = isMissingRemoteType(row.remote_type);
  const weakUnknownRemoteType = isWeakRemoteType(row.remote_type);

  return {
    missing_country: missingCountry,
    missing_location_text: missingLocationText,
    missing_region_state: missingRegionState,
    missing_city: missingCity,
    missing_any_normalized_geo: missingAnyNormalizedGeo,
    missing_all_normalized_geo: missingAllNormalizedGeo,
    missing_location_and_all_geo: missingLocationText && missingAllNormalizedGeo,
    suspicious_unknown_geo: suspiciousUnknownGeo,
    missing_remote_type: missingRemoteType,
    weak_unknown_remote_type: weakUnknownRemoteType,
    missing_all_geo_and_weak_remote: missingAllNormalizedGeo && weakUnknownRemoteType
  };
}

function pct(count, total) {
  const denominator = Number(total || 0);
  if (!denominator) return 0;
  return Number(((Number(count || 0) * 100) / denominator).toFixed(2));
}

function emptyCounter() {
  return Object.fromEntries(AUDIT_COUNT_FIELDS.map((field) => [`${field}_count`, 0]));
}

function rowToCounters(row = {}) {
  const counters = {};
  for (const field of AUDIT_COUNT_FIELDS) {
    counters[`${field}_count`] = Number(row[`${field}_count`] || 0);
  }
  return counters;
}

function addPercentages(record) {
  const total = Number(record.total_visible_postings || record.total_visible_rows || 0);
  const percentages = {};
  for (const field of AUDIT_COUNT_FIELDS) {
    const key = `${field}_count`;
    percentages[field] = pct(record[key], total);
    record[`${field}_pct`] = percentages[field];
  }
  record.field_gap_percentages = percentages;
  return record;
}

function createSummaryRecord(row = {}) {
  return addPercentages({
    total_visible_postings: Number(row.total_visible_postings || row.total_visible_rows || 0),
    ...rowToCounters(row)
  });
}

function createGroupRecord(row = {}) {
  const totalVisibleRows = Number(row.total_visible_rows || row.total_visible_postings || 0);
  const qualityFlagCounts = row.quality_flag_counts || {};
  return addPercentages({
    source_ats: normalizeGroupValue(row.source_ats || row.ats_key),
    ats_key: normalizeGroupValue(row.source_ats || row.ats_key),
    parser_key: normalizeGroupValue(row.parser_key || row.parser_version),
    parser_version: normalizeGroupValue(row.parser_version || row.parser_key),
    total_visible_rows: totalVisibleRows,
    total_postings: totalVisibleRows,
    avg_quality_score: Number(row.avg_quality_score || 0),
    low_quality_count: Number(row.low_quality_count || 0),
    quality_flag_counts: qualityFlagCounts,
    flag_counts: qualityFlagCounts,
    rejection_count: Number(row.rejection_count || 0),
    parser_error_count: Number(row.parser_error_count || 0),
    latest_parser_error: cleanText(row.latest_parser_error),
    ...rowToCounters(row)
  });
}

function makeQualitySummary(bySource, summary = null) {
  const items = Array.isArray(bySource) ? bySource : [];
  const total = summary || createSummaryFromRows(items);
  return {
    summary: total,
    by_source: items,
    items,
    count: items.length
  };
}

function createSummaryFromRows(rows = []) {
  const summary = {
    total_visible_postings: 0,
    ...emptyCounter()
  };
  for (const row of rows) {
    summary.total_visible_postings += Number(row.total_visible_rows || row.total_visible_postings || 0);
    for (const field of AUDIT_COUNT_FIELDS) {
      summary[`${field}_count`] += Number(row[`${field}_count`] || 0);
    }
  }
  return addPercentages(summary);
}

function formatQualityFlagRows(rows = [], keyFields = ["source_ats"]) {
  const map = new Map();
  for (const row of rows) {
    const key = keyFields.map((field) => normalizeGroupValue(row[field])).join("\u0000");
    const flag = cleanText(row.flag);
    if (!flag) continue;
    const existing = map.get(key) || {};
    existing[flag] = Number(row.count || 0);
    map.set(key, existing);
  }
  return map;
}

function attachCounts(records, countMap, keyFields, targetField) {
  return records.map((record) => {
    const key = keyFields.map((field) => normalizeGroupValue(record[field])).join("\u0000");
    return {
      ...record,
      [targetField]: countMap.get(key) || (targetField === "quality_flag_counts" ? {} : 0)
    };
  });
}

const PG_TEXT_BLANK_VALUES = Array.from(BLANK_TEXT_VALUES).map((value) => value.replace(/'/g, "''"));
const PG_SUSPICIOUS_VALUES = Array.from(SUSPICIOUS_GEO_VALUES).map((value) => value.replace(/'/g, "''"));
const PG_WEAK_REMOTE_VALUES = Array.from(WEAK_REMOTE_VALUES).map((value) => value.replace(/'/g, "''"));

function pgIn(values) {
  return values.map((value) => `'${value}'`).join(", ");
}

function pgBlankLike(column) {
  return `(lower(btrim(coalesce(${column}, ''))) IN (${pgIn(PG_TEXT_BLANK_VALUES)}))`;
}

function pgSuspicious(column) {
  return `(lower(btrim(coalesce(${column}, ''))) IN (${pgIn(PG_SUSPICIOUS_VALUES)}))`;
}

function pgMissingRemote(column) {
  return `(lower(btrim(coalesce(${column}, ''))) IN ('', 'n/a', 'na', 'not available'))`;
}

function pgWeakRemote(column) {
  return `(lower(btrim(coalesce(${column}, ''))) IN (${pgIn(PG_WEAK_REMOTE_VALUES)}))`;
}

const POSTGRES_VISIBLE_CTE = `
  WITH visible AS (
    SELECT
      COALESCE(NULLIF(btrim(ats_key), ''), 'unknown') AS source_ats,
      COALESCE(NULLIF(btrim(parser_version), ''), 'unknown') AS parser_version,
      quality_score,
      CASE WHEN jsonb_typeof(quality_flags) = 'array' THEN quality_flags ELSE '[]'::jsonb END AS quality_flags,
      (${pgBlankLike("country")}) AS missing_country,
      (${pgBlankLike("location_text")}) AS missing_location_text,
      (${pgBlankLike("region")}) AS missing_region_state,
      (${pgBlankLike("city")}) AS missing_city,
      ((${pgBlankLike("country")}) OR (${pgBlankLike("region")}) OR (${pgBlankLike("city")})) AS missing_any_normalized_geo,
      ((${pgBlankLike("country")}) AND (${pgBlankLike("region")}) AND (${pgBlankLike("city")})) AS missing_all_normalized_geo,
      ((${pgBlankLike("location_text")}) AND (${pgBlankLike("country")}) AND (${pgBlankLike("region")}) AND (${pgBlankLike("city")})) AS missing_location_and_all_geo,
      ((${pgSuspicious("location_text")}) OR (${pgSuspicious("country")}) OR (${pgSuspicious("region")}) OR (${pgSuspicious("city")})) AS suspicious_unknown_geo,
      (${pgMissingRemote("remote_type")}) AS missing_remote_type,
      (${pgWeakRemote("remote_type")}) AS weak_unknown_remote_type,
      ((${pgBlankLike("country")}) AND (${pgBlankLike("region")}) AND (${pgBlankLike("city")}) AND (${pgWeakRemote("remote_type")})) AS missing_all_geo_and_weak_remote
    FROM postings
    WHERE hidden = false
  )
`;

const COUNT_SELECT_SQL = AUDIT_COUNT_FIELDS
  .map((field) => `COUNT(*) FILTER (WHERE ${field})::bigint AS ${field}_count`)
  .join(",\n      ");

function mapPgGroupRow(row) {
  return createGroupRecord({
    source_ats: row.source_ats,
    parser_version: row.parser_version,
    parser_key: row.parser_version,
    total_visible_rows: row.total_visible_rows,
    avg_quality_score: row.avg_quality_score,
    low_quality_count: row.low_quality_count,
    ...rowToCounters(row)
  });
}

async function getPostgresQualityAudit(pool, options = {}) {
  const limit = Math.max(1, Math.min(1000, Number(options.limit || 100)));
  const [summaryResult, sourceResult, parserResult, sourceFlagResult, parserFlagResult, rejectionResult, errorResult] = await Promise.all([
    pool.query(`
      ${POSTGRES_VISIBLE_CTE}
      SELECT
        COUNT(*)::bigint AS total_visible_postings,
        ${COUNT_SELECT_SQL}
      FROM visible;
    `),
    pool.query(
      `
        ${POSTGRES_VISIBLE_CTE}
        SELECT
          source_ats,
          COUNT(*)::bigint AS total_visible_rows,
          ROUND(AVG(quality_score))::int AS avg_quality_score,
          COUNT(*) FILTER (WHERE quality_score < 60)::bigint AS low_quality_count,
          ${COUNT_SELECT_SQL}
        FROM visible
        GROUP BY source_ats
        ORDER BY missing_any_normalized_geo_count DESC, weak_unknown_remote_type_count DESC, total_visible_rows DESC, source_ats ASC
        LIMIT $1;
      `,
      [limit]
    ),
    pool.query(
      `
        ${POSTGRES_VISIBLE_CTE}
        SELECT
          source_ats,
          parser_version,
          COUNT(*)::bigint AS total_visible_rows,
          ROUND(AVG(quality_score))::int AS avg_quality_score,
          COUNT(*) FILTER (WHERE quality_score < 60)::bigint AS low_quality_count,
          ${COUNT_SELECT_SQL}
        FROM visible
        GROUP BY source_ats, parser_version
        ORDER BY missing_any_normalized_geo_count DESC, weak_unknown_remote_type_count DESC, total_visible_rows DESC, source_ats ASC, parser_version ASC
        LIMIT $1;
      `,
      [limit]
    ),
    pool.query(`
      ${POSTGRES_VISIBLE_CTE}
      SELECT source_ats, flag, COUNT(*)::bigint AS count
      FROM visible
      CROSS JOIN LATERAL jsonb_array_elements_text(quality_flags) AS flag
      GROUP BY source_ats, flag;
    `),
    pool.query(`
      ${POSTGRES_VISIBLE_CTE}
      SELECT source_ats, parser_version, flag, COUNT(*)::bigint AS count
      FROM visible
      CROSS JOIN LATERAL jsonb_array_elements_text(quality_flags) AS flag
      GROUP BY source_ats, parser_version, flag;
    `),
    pool.query(`
      SELECT
        COALESCE(NULLIF(btrim(ats_key), ''), 'unknown') AS source_ats,
        COALESCE(NULLIF(btrim(parser_version), ''), 'unknown') AS parser_version,
        COUNT(*)::bigint AS count
      FROM posting_cache
      WHERE validation_status <> 'valid'
         OR btrim(coalesce(rejection_reason, '')) <> ''
         OR btrim(coalesce(validation_error, '')) <> ''
      GROUP BY source_ats, parser_version;
    `),
    pool.query(`
      SELECT
        COALESCE(NULLIF(btrim(ats_key), ''), 'unknown') AS source_ats,
        COUNT(*)::bigint AS count,
        MAX(error_message) AS latest_parser_error
      FROM ingestion_run_errors
      WHERE error_type LIKE 'parser_%'
         OR error_type LIKE '%validation%'
      GROUP BY source_ats;
    `)
  ]);

  const sourceFlagCounts = formatQualityFlagRows(sourceFlagResult.rows, ["source_ats"]);
  const parserFlagCounts = formatQualityFlagRows(parserFlagResult.rows, ["source_ats", "parser_version"]);
  const sourceRejections = new Map();
  const parserRejections = new Map();
  for (const row of rejectionResult.rows) {
    const sourceKey = normalizeGroupValue(row.source_ats);
    sourceRejections.set(sourceKey, Number(sourceRejections.get(sourceKey) || 0) + Number(row.count || 0));
    parserRejections.set(
      `${sourceKey}\u0000${normalizeGroupValue(row.parser_version)}`,
      Number(row.count || 0)
    );
  }
  const sourceErrors = new Map();
  const sourceLatestError = new Map();
  for (const row of errorResult.rows) {
    const sourceKey = normalizeGroupValue(row.source_ats);
    sourceErrors.set(sourceKey, Number(row.count || 0));
    sourceLatestError.set(sourceKey, cleanText(row.latest_parser_error));
  }

  let bySource = sourceResult.rows.map(mapPgGroupRow);
  bySource = attachCounts(bySource, sourceFlagCounts, ["source_ats"], "quality_flag_counts").map((record) => ({
    ...record,
    flag_counts: record.quality_flag_counts || {},
    rejection_count: Number(sourceRejections.get(record.source_ats) || 0),
    parser_error_count: Number(sourceErrors.get(record.source_ats) || 0),
    latest_parser_error: cleanText(sourceLatestError.get(record.source_ats))
  }));

  let byParser = parserResult.rows.map(mapPgGroupRow);
  byParser = attachCounts(byParser, parserFlagCounts, ["source_ats", "parser_version"], "quality_flag_counts").map((record) => ({
    ...record,
    flag_counts: record.quality_flag_counts || {},
    rejection_count: Number(parserRejections.get(`${record.source_ats}\u0000${record.parser_version}`) || 0),
    parser_error_count: Number(sourceErrors.get(record.source_ats) || 0),
    latest_parser_error: cleanText(sourceLatestError.get(record.source_ats))
  }));

  return {
    summary: createSummaryRecord(summaryResult.rows[0] || {}),
    by_source: bySource,
    by_parser: byParser
  };
}

async function getSqliteColumns(db, tableName) {
  const rows = await db.all(`PRAGMA table_info('${tableName}');`);
  return new Set((rows || []).map((row) => String(row.name || "")));
}

function sqliteColumn(columns, columnName, fallbackSql) {
  return columns.has(columnName) ? columnName : `${fallbackSql} AS ${columnName}`;
}

async function getSqliteVisibleRows(db) {
  const columns = await getSqliteColumns(db, "Postings");
  const titleColumn = columns.has("position_name") ? "position_name" : "'' AS position_name";
  const companyColumn = columns.has("company_name") ? "company_name" : "'' AS company_name";
  const urlColumn = columns.has("job_posting_url") ? "job_posting_url AS canonical_url" : "'' AS canonical_url";
  const hiddenWhere = columns.has("hidden") ? "COALESCE(hidden, 0) = 0" : "1 = 1";
  const rows = await db.all(`
    SELECT
      ${titleColumn},
      ${companyColumn},
      ${urlColumn},
      ${sqliteColumn(columns, "ats_key", "''")},
      ${sqliteColumn(columns, "parser_version", "'legacy-adapter-v1'")},
      ${columns.has("location_text") ? "location_text" : columns.has("location") ? "location AS location_text" : "'' AS location_text"},
      ${sqliteColumn(columns, "country", "''")},
      ${sqliteColumn(columns, "region", "''")},
      ${sqliteColumn(columns, "city", "''")},
      ${sqliteColumn(columns, "remote_type", "'unknown'")},
      ${sqliteColumn(columns, "quality_score", "0")},
      ${sqliteColumn(columns, "quality_flags", "'[]'")}
    FROM Postings
    WHERE ${hiddenWhere};
  `);
  return rows || [];
}

function inferAtsFromUrl(url) {
  const lower = cleanText(url).toLowerCase();
  if (!lower) return "unknown";
  if (lower.includes("greenhouse")) return "greenhouse";
  if (lower.includes("lever.co")) return "lever";
  if (lower.includes("ashbyhq")) return "ashby";
  if (lower.includes("careerplug")) return "careerplug";
  return "unknown";
}

function normalizeSqliteRow(row = {}) {
  return {
    ...row,
    source_ats: normalizeGroupValue(row.ats_key || inferAtsFromUrl(row.canonical_url)),
    parser_version: normalizeGroupValue(row.parser_version || "legacy-adapter-v1"),
    quality_score: Number(row.quality_score || 0),
    quality_flags: parseQualityFlags(row.quality_flags)
  };
}

function parseQualityFlags(value) {
  if (Array.isArray(value)) return value.map(cleanText).filter(Boolean);
  const raw = cleanText(value);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(cleanText).filter(Boolean) : [];
  } catch {
    return raw.split(",").map(cleanText).filter(Boolean);
  }
}

function aggregateRows(rows = [], options = {}) {
  const limit = Math.max(1, Math.min(1000, Number(options.limit || 100)));
  const sourceBuckets = new Map();
  const parserBuckets = new Map();
  const summary = {
    total_visible_postings: 0,
    ...emptyCounter()
  };

  for (const rawRow of rows) {
    const row = normalizeSqliteRow(rawRow);
    const classification = classifyStoredPosting(row);
    const sourceKey = row.source_ats;
    const parserKey = `${row.source_ats}\u0000${row.parser_version}`;
    const buckets = [
      [sourceBuckets, sourceKey, { source_ats: row.source_ats, parser_version: "all" }],
      [parserBuckets, parserKey, { source_ats: row.source_ats, parser_version: row.parser_version }]
    ];
    summary.total_visible_postings += 1;
    for (const field of AUDIT_COUNT_FIELDS) {
      if (classification[field]) summary[`${field}_count`] += 1;
    }
    for (const [map, key, defaults] of buckets) {
      const bucket = map.get(key) || {
        ...defaults,
        total_visible_rows: 0,
        quality_score_sum: 0,
        low_quality_count: 0,
        quality_flag_counts: {},
        ...emptyCounter()
      };
      bucket.total_visible_rows += 1;
      bucket.quality_score_sum += Number(row.quality_score || 0);
      if (Number(row.quality_score || 0) < 60) bucket.low_quality_count += 1;
      for (const field of AUDIT_COUNT_FIELDS) {
        if (classification[field]) bucket[`${field}_count`] += 1;
      }
      for (const flag of row.quality_flags) {
        bucket.quality_flag_counts[flag] = Number(bucket.quality_flag_counts[flag] || 0) + 1;
      }
      map.set(key, bucket);
    }
  }

  function finalize(bucket) {
    return createGroupRecord({
      ...bucket,
      avg_quality_score: bucket.total_visible_rows > 0 ? Math.round(bucket.quality_score_sum / bucket.total_visible_rows) : 0
    });
  }

  return {
    summary: addPercentages(summary),
    by_source: Array.from(sourceBuckets.values())
      .map(finalize)
      .sort((a, b) => b.missing_any_normalized_geo_count - a.missing_any_normalized_geo_count || b.total_visible_rows - a.total_visible_rows)
      .slice(0, limit),
    by_parser: Array.from(parserBuckets.values())
      .map(finalize)
      .sort((a, b) => b.missing_any_normalized_geo_count - a.missing_any_normalized_geo_count || b.total_visible_rows - a.total_visible_rows)
      .slice(0, limit)
  };
}

async function getSqliteQualityAudit(db, options = {}) {
  const rows = await getSqliteVisibleRows(db);
  return aggregateRows(rows, options);
}

function openSqliteReadOnly(dbPath) {
  const sqlite3 = require("sqlite3");
  const resolved = path.resolve(dbPath || "jobs.db");
  if (!fs.existsSync(resolved)) {
    throw new Error(`SQLite DB not found at ${resolved}`);
  }
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(resolved, sqlite3.OPEN_READONLY, (error) => {
      if (error) reject(error);
      else {
        resolve({
          all(sql, params = []) {
            return new Promise((innerResolve, innerReject) => {
              db.all(sql, params, (queryError, rows) => {
                if (queryError) innerReject(queryError);
                else innerResolve(rows || []);
              });
            });
          },
          close() {
            return new Promise((innerResolve, innerReject) => {
              db.close((closeError) => {
                if (closeError) innerReject(closeError);
                else innerResolve();
              });
            });
          }
        });
      }
    });
  });
}

module.exports = {
  AUDIT_COUNT_FIELDS,
  aggregateRows,
  classifyStoredPosting,
  createGroupRecord,
  createSummaryRecord,
  getPostgresQualityAudit,
  getSqliteQualityAudit,
  isBlankLike,
  isMissingRemoteType,
  isSuspiciousGeoValue,
  isWeakRemoteType,
  makeQualitySummary,
  openSqliteReadOnly,
  pct
};
