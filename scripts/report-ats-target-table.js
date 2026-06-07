const fs = require("fs");
const path = require("path");
const { createPostgresPool } = require("../server/backends/postgres");
const { getAdapterMetadata, isAtsEnabledByDefault } = require("../server/ingestion/adapter-metadata");
const {
  ATS_FILTER_LABEL_BY_VALUE,
  buildPostgresAtsFilterCanonicalExpression,
  normalizeAtsFilterValue
} = require("../server/ingestion/atsFilters");

const DEFAULT_JSON_OUTPUT = path.join("docs", "reference", "ats-workbench", "target-table.json");
const DEFAULT_MARKDOWN_OUTPUT = path.join("docs", "reference", "ats-workbench", "target-table.md");

const HIGH_VOLUME_ROWS = 5000;
const MEDIUM_VOLUME_ROWS = 1000;

function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    json: false,
    markdown: false,
    output: "",
    markdownOutput: "",
    limit: 1000
  };
  for (const arg of argv) {
    if (arg === "--json") options.json = true;
    else if (arg === "--markdown") options.markdown = true;
    else if (arg.startsWith("--output=")) options.output = arg.slice("--output=".length);
    else if (arg.startsWith("--markdown-output=")) options.markdownOutput = arg.slice("--markdown-output=".length);
    else if (arg.startsWith("--limit=")) options.limit = Number(arg.slice("--limit=".length)) || options.limit;
  }
  options.limit = Math.max(1, Math.min(1000, Math.floor(Number(options.limit || 1000))));
  return options;
}

function toNumber(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

function pct(numerator, denominator) {
  const bottom = toNumber(denominator);
  if (!bottom) return 0;
  return Number(((toNumber(numerator) * 100) / bottom).toFixed(2));
}

function clean(value) {
  return String(value ?? "").trim();
}

function escapeCell(value) {
  return clean(value).replace(/\|/g, "/");
}

function thresholdProfileFor(row = {}) {
  const visibleRows = toNumber(row.visible_rows);
  const parserFixtureStatus = clean(row.parser_fixture_status || "missing");
  const tier = clean(row.adapter_tier);
  const protectionStatus = clean(row.protection_status || "normal").toLowerCase();

  if (parserFixtureStatus === "unsupported" || row.source_enabled === false || protectionStatus === "disabled") {
    return {
      profile: "disabled",
      minimum_confidence: 1,
      location_text_pct_goal: 0,
      any_geo_pct_goal: 0,
      remote_known_pct_goal: 0,
      posting_date_pct_goal: 0,
      public_write_rule: "no public writes until adapter, fixtures, and source policy are safe"
    };
  }

  if (parserFixtureStatus !== "parser-fixture-backed") {
    return {
      profile: "fixture_first",
      minimum_confidence: tier === "brittle-high-risk" ? 0.9 : 0.85,
      location_text_pct_goal: 90,
      any_geo_pct_goal: 85,
      remote_known_pct_goal: 90,
      posting_date_pct_goal: 50,
      public_write_rule: "raw parser fixture, expected normalized fixture, and invalid-shape test required before public scaling"
    };
  }

  if (protectionStatus.includes("quarantine")) {
    return {
      profile: "quarantine_quality_gate",
      minimum_confidence: 0.8,
      location_text_pct_goal: 95,
      any_geo_pct_goal: 90,
      remote_known_pct_goal: 95,
      posting_date_pct_goal: 60,
      public_write_rule: "canary/detail-refetch only until live bad-row rates clear quarantine policy"
    };
  }

  if (visibleRows >= HIGH_VOLUME_ROWS) {
    return {
      profile: "high_volume_quality_gate",
      minimum_confidence: 0.7,
      location_text_pct_goal: 95,
      any_geo_pct_goal: 90,
      remote_known_pct_goal: 95,
      posting_date_pct_goal: 70,
      public_write_rule: "zero no_geo_no_remote rows; source_id >= 99%; do not regress global/source geo or remote percentages"
    };
  }

  if (visibleRows >= MEDIUM_VOLUME_ROWS) {
    return {
      profile: "medium_volume_quality_gate",
      minimum_confidence: 0.75,
      location_text_pct_goal: 90,
      any_geo_pct_goal: 85,
      remote_known_pct_goal: 90,
      posting_date_pct_goal: 50,
      public_write_rule: "bounded canary/apply only when guard-safe and source-specific parser fixtures cover missing fields"
    };
  }

  if (visibleRows > 0) {
    return {
      profile: "low_volume_monitor",
      minimum_confidence: 0.8,
      location_text_pct_goal: 85,
      any_geo_pct_goal: 80,
      remote_known_pct_goal: 85,
      posting_date_pct_goal: 40,
      public_write_rule: "keep monitored; fixture gaps are fixed before throughput expansion"
    };
  }

  return {
    profile: "no_live_rows_fixture_target",
    minimum_confidence: 0.85,
    location_text_pct_goal: 0,
    any_geo_pct_goal: 0,
    remote_known_pct_goal: 0,
    posting_date_pct_goal: 0,
    public_write_rule: "no live-row threshold yet; certify parser and source discovery before enabling"
  };
}

function fieldGapLabels(row, profile) {
  const gaps = [];
  if (row.location_text_pct < profile.location_text_pct_goal) gaps.push("location_text");
  if (row.any_geo_pct < profile.any_geo_pct_goal) gaps.push("geo");
  if (row.remote_known_pct < profile.remote_known_pct_goal) gaps.push("remote_type");
  if (row.posting_date_pct < profile.posting_date_pct_goal) gaps.push("posting_date");
  if (row.visible_rows > 0 && row.source_job_id_pct < 99) gaps.push("source_job_id");
  return gaps;
}

function nextActionFor(row, profile) {
  if (profile.profile === "disabled") return "keep disabled until source-backed parser and safety policy exist";
  if (profile.profile === "fixture_first" || profile.profile === "no_live_rows_fixture_target") {
    return "review ATS individually; add raw response fixture, expected normalized fixture, invalid-shape test, and source module threshold";
  }
  const gaps = fieldGapLabels(row, profile);
  const hasWorkerAttention = row.target_failures_24h > 0 || row.parser_attention_24h > 0;
  if (!gaps.length && !hasWorkerAttention) return "monitor; current parser threshold is inside target range";
  const actions = [];
  if (gaps.length) actions.push(`improve ${gaps.join(", ")} evidence in source parser and fixtures`);
  if (hasWorkerAttention) actions.push("inspect worker errors and parser attention events");
  return `review ATS individually; ${actions.join("; ")}`;
}

function priorityScore(row, profile) {
  const volumeWeight = Math.log10(toNumber(row.visible_rows) + 1) * 8;
  const locationGap = Math.max(0, profile.location_text_pct_goal - row.location_text_pct) * 0.45;
  const geoGap = Math.max(0, profile.any_geo_pct_goal - row.any_geo_pct) * 0.7;
  const remoteGap = Math.max(0, profile.remote_known_pct_goal - row.remote_known_pct) * 0.45;
  const dateGap = Math.max(0, profile.posting_date_pct_goal - row.posting_date_pct) * 0.25;
  const sourceIdGap = Math.max(0, 99 - row.source_job_id_pct) * 0.35;
  const workerGap = Math.min(25, toNumber(row.target_failures_24h) + toNumber(row.parser_attention_24h));
  const fixturePenalty = profile.profile === "fixture_first" ? 30 : 0;
  const disabledPenalty = profile.profile === "disabled" ? -100 : 0;
  return Number((volumeWeight + locationGap + geoGap + remoteGap + dateGap + sourceIdGap + workerGap + fixturePenalty + disabledPenalty).toFixed(2));
}

function normalizeRawRow(raw = {}) {
  const rawAtsKey = clean(raw.ats_key || "unknown").toLowerCase() || "unknown";
  const atsKey = normalizeAtsFilterValue(rawAtsKey) || rawAtsKey;
  const metadata = getAdapterMetadata(atsKey);
  const rawDisplayName = clean(raw.display_name || "");
  const canonicalDisplayName = ATS_FILTER_LABEL_BY_VALUE.get(atsKey) || metadata.displayName || atsKey;
  const displayName = rawDisplayName && normalizeAtsFilterValue(rawDisplayName) !== atsKey
    ? rawDisplayName
    : canonicalDisplayName;
  const visibleRows = toNumber(raw.visible_rows);
  const sourceEnabled = raw.source_enabled === false ? false : true;
  const row = {
    ats_key: atsKey,
    display_name: displayName,
    adapter_tier: metadata.tier,
    parser_fixture_status: metadata.parserFixtureStatus,
    fixture_status: metadata.fixtureStatus,
    parser_confidence: metadata.confidence,
    enabled_by_default: isAtsEnabledByDefault(atsKey),
    source_enabled: sourceEnabled,
    protection_status: clean(raw.protection_status || "normal") || "normal",
    visible_rows: visibleRows,
    configured_companies: toNumber(raw.configured_companies),
    sync_targets: toNumber(raw.sync_targets),
    posting_companies: toNumber(raw.posting_companies),
    location_text_rows: toNumber(raw.location_text_rows),
    any_geo_rows: toNumber(raw.any_geo_rows),
    complete_geo_rows: toNumber(raw.complete_geo_rows),
    country_rows: toNumber(raw.country_rows),
    region_rows: toNumber(raw.region_rows),
    city_rows: toNumber(raw.city_rows),
    remote_known_rows: toNumber(raw.remote_known_rows),
    posting_date_rows: toNumber(raw.posting_date_rows),
    source_job_id_rows: toNumber(raw.source_job_id_rows),
    seen_24h_rows: toNumber(raw.seen_24h_rows),
    latest_seen_epoch: toNumber(raw.latest_seen_epoch),
    targets_due: toNumber(raw.targets_due),
    targets_success_24h: toNumber(raw.targets_success_24h),
    source_runs_24h: toNumber(raw.source_runs_24h),
    latest_source_run_epoch: toNumber(raw.latest_source_run_epoch),
    source_fetch_count_24h: toNumber(raw.source_fetch_count_24h),
    source_parse_count_24h: toNumber(raw.source_parse_count_24h),
    source_accepted_count_24h: toNumber(raw.source_accepted_count_24h),
    source_rejected_count_24h: toNumber(raw.source_rejected_count_24h),
    target_failures_24h: toNumber(raw.target_failures_24h),
    parser_attention_24h: toNumber(raw.parser_attention_24h)
  };
  row.location_text_pct = pct(row.location_text_rows, visibleRows);
  row.any_geo_pct = pct(row.any_geo_rows, visibleRows);
  row.complete_geo_pct = pct(row.complete_geo_rows, visibleRows);
  row.country_pct = pct(row.country_rows, visibleRows);
  row.region_pct = pct(row.region_rows, visibleRows);
  row.city_pct = pct(row.city_rows, visibleRows);
  row.remote_known_pct = pct(row.remote_known_rows, visibleRows);
  row.posting_date_pct = pct(row.posting_date_rows, visibleRows);
  row.source_job_id_pct = pct(row.source_job_id_rows, visibleRows);
  return row;
}

function buildTargetRows(rawRows = []) {
  return rawRows
    .map((raw) => {
      const row = normalizeRawRow(raw);
      const profile = thresholdProfileFor(row);
      row.threshold_profile = profile.profile;
      row.minimum_confidence = profile.minimum_confidence;
      row.threshold_goals = {
        location_text_pct: profile.location_text_pct_goal,
        any_geo_pct: profile.any_geo_pct_goal,
        remote_known_pct: profile.remote_known_pct_goal,
        posting_date_pct: profile.posting_date_pct_goal
      };
      row.public_write_rule = profile.public_write_rule;
      row.target_priority_score = priorityScore(row, profile);
      row.next_action = nextActionFor(row, profile);
      return row;
    })
    .sort((left, right) => (
      right.visible_rows - left.visible_rows ||
      right.target_priority_score - left.target_priority_score ||
      left.ats_key.localeCompare(right.ats_key)
    ));
}

function buildSummary(rows = [], generatedAt = new Date().toISOString()) {
  const items = Array.isArray(rows) ? rows : [];
  const totals = items.reduce((acc, row) => {
    acc.visible_rows += row.visible_rows;
    acc.configured_companies += row.configured_companies;
    acc.seen_24h_rows += row.seen_24h_rows;
    acc.targets_due += row.targets_due;
    acc.targets_success_24h += row.targets_success_24h;
    acc.target_failures_24h += row.target_failures_24h;
    acc.parser_attention_24h += row.parser_attention_24h;
    acc.source_runs_24h += row.source_runs_24h;
    return acc;
  }, {
    visible_rows: 0,
    configured_companies: 0,
    seen_24h_rows: 0,
    targets_due: 0,
    targets_success_24h: 0,
    target_failures_24h: 0,
    parser_attention_24h: 0,
    source_runs_24h: 0
  });
  const thresholdProfiles = {};
  for (const row of items) thresholdProfiles[row.threshold_profile] = toNumber(thresholdProfiles[row.threshold_profile]) + 1;
  return {
    generated_at: generatedAt,
    ats_count: items.length,
    totals,
    threshold_profiles: thresholdProfiles,
    top_by_visible_rows: items.slice(0, 15).map((row) => ({
      ats_key: row.ats_key,
      visible_rows: row.visible_rows,
      location_text_pct: row.location_text_pct,
      any_geo_pct: row.any_geo_pct,
      remote_known_pct: row.remote_known_pct,
      posting_date_pct: row.posting_date_pct,
      threshold_profile: row.threshold_profile,
      next_action: row.next_action
    })),
    top_by_target_priority: [...items]
      .sort((left, right) => right.target_priority_score - left.target_priority_score || right.visible_rows - left.visible_rows)
      .slice(0, 15)
      .map((row) => ({
        ats_key: row.ats_key,
        target_priority_score: row.target_priority_score,
        visible_rows: row.visible_rows,
        threshold_profile: row.threshold_profile,
        next_action: row.next_action
      }))
  };
}

function buildMarkdown(rows = [], options = {}) {
  const generatedAt = options.generatedAt || new Date().toISOString();
  const summary = buildSummary(rows, generatedAt);
  const lines = [
    "# ATS Target Table",
    "",
    `Generated: ${generatedAt}`,
    "",
    "This report is read-only. It ranks current ATS families by visible live postings and records the parser threshold target for each source.",
    "",
    "## Target Conditions",
    "",
    "- All ATS keys must be reviewed individually before a parser/source-quality success claim.",
    "- Parser work stays inside `server/ingestion/sources/<ats>/parse.js` plus raw, expected, and invalid-shape fixtures.",
    "- Public growth must keep `no_geo_no_remote` at zero and must not regress global or source geo/remote percentages.",
    "- High-volume ATS (`>= 5,000` visible rows) target at least 95% `location_text`, 90% any normalized geo, 95% known `remote_type`, and 70% posting-date evidence unless saved raw fixtures prove the source omits dates.",
    "- Medium-volume ATS (`>= 1,000` visible rows) target at least 90% `location_text`, 85% any normalized geo, 90% known `remote_type`, and 50% posting-date evidence unless source omission is fixture-backed.",
    "- Uncertified ATS are fixture-first: raw response fixture, expected normalized fixture, invalid-shape test, source id rule, canonical URL rule, and minimum parser confidence before broad public writes.",
    "",
    "## Summary",
    "",
    `- ATS count: ${summary.ats_count}`,
    `- Visible rows: ${summary.totals.visible_rows}`,
    `- Configured companies: ${summary.totals.configured_companies}`,
    `- Rows seen in 24h: ${summary.totals.seen_24h_rows}`,
    `- Worker targets due now: ${summary.totals.targets_due}`,
    `- Worker successes in 24h: ${summary.totals.targets_success_24h}`,
    `- Worker failures in 24h: ${summary.totals.target_failures_24h}`,
    `- Parser attention events in 24h: ${summary.totals.parser_attention_24h}`,
    `- Source runs in 24h: ${summary.totals.source_runs_24h}`,
    "",
    "## ATS Table",
    "",
    "| ats | rows | companies | seen 24h | due | worker ok 24h | worker fail 24h | parser attn 24h | location % | any geo % | complete geo % | remote known % | posting date % | source id % | parse threshold | priority | next action |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: | --- |"
  ];

  for (const row of rows) {
    lines.push([
      `| \`${escapeCell(row.ats_key)}\``,
      row.visible_rows,
      row.configured_companies,
      row.seen_24h_rows,
      row.targets_due,
      row.targets_success_24h,
      row.target_failures_24h,
      row.parser_attention_24h,
      row.location_text_pct,
      row.any_geo_pct,
      row.complete_geo_pct,
      row.remote_known_pct,
      row.posting_date_pct,
      row.source_job_id_pct,
      escapeCell(row.threshold_profile),
      row.target_priority_score,
      `${escapeCell(row.next_action)} |`
    ].join(" | "));
  }
  return `${lines.join("\n")}\n`;
}

async function loadRawRowsFromPostgres(pool, options = {}) {
  const limit = Math.max(1, Math.min(1000, Math.floor(Number(options.limit || 1000))));
  const sourceAtsSql = buildPostgresAtsFilterCanonicalExpression("s.ats_key");
  const sourceRawAtsSql = "LOWER(BTRIM(s.ats_key))";
  const postingAtsSql = buildPostgresAtsFilterCanonicalExpression("ats_key");
  const companyAtsSql = buildPostgresAtsFilterCanonicalExpression("ats_key");
  const syncAtsSql = buildPostgresAtsFilterCanonicalExpression("ats_key");
  const sourceRunAtsSql = buildPostgresAtsFilterCanonicalExpression("ats_key");
  const targetFailureAtsSql = buildPostgresAtsFilterCanonicalExpression("ats_key");
  const parserErrorAtsSql = buildPostgresAtsFilterCanonicalExpression("ats_key");
  const result = await pool.query(`
    WITH now_value AS (
      SELECT EXTRACT(EPOCH FROM now())::bigint AS now_epoch
    ),
    source_metrics AS (
      SELECT
        canonical_ats_key AS ats_key,
        COALESCE(
          (ARRAY_AGG(NULLIF(display_name, '') ORDER BY is_canonical_row DESC, raw_ats_key ASC))[1],
          canonical_ats_key
        ) AS display_name,
        COALESCE((ARRAY_AGG(enabled ORDER BY is_canonical_row DESC, raw_ats_key ASC))[1], false) AS source_enabled,
        COALESCE(
          (ARRAY_AGG(NULLIF(protection_status, '') ORDER BY is_canonical_row DESC, raw_ats_key ASC))[1],
          'missing'
        ) AS protection_status
      FROM (
        SELECT
          COALESCE(NULLIF(${sourceAtsSql}, ''), 'unknown') AS canonical_ats_key,
          ${sourceRawAtsSql} AS raw_ats_key,
          ${sourceRawAtsSql} = COALESCE(NULLIF(${sourceAtsSql}, ''), 'unknown') AS is_canonical_row,
          display_name,
          COALESCE(enabled, false) AS enabled,
          COALESCE(protection_status, 'missing') AS protection_status
        FROM ats_sources s
      ) source_rows
      GROUP BY canonical_ats_key
    ),
    visible AS (
      SELECT
        COALESCE(NULLIF(${postingAtsSql}, ''), 'unknown') AS ats_key,
        company_name,
        location_text,
        country,
        region,
        city,
        remote_type,
        posting_date,
        posted_at_epoch,
        source_job_id,
        last_seen_epoch
      FROM postings
      WHERE hidden IS NOT TRUE
    ),
    posting_metrics AS (
      SELECT
        ats_key,
        COUNT(*)::bigint AS visible_rows,
        COUNT(DISTINCT NULLIF(btrim(company_name), ''))::bigint AS posting_companies,
        COUNT(*) FILTER (WHERE NULLIF(btrim(COALESCE(location_text, '')), '') IS NOT NULL)::bigint AS location_text_rows,
        COUNT(*) FILTER (
          WHERE NULLIF(btrim(COALESCE(country, '')), '') IS NOT NULL
             OR NULLIF(btrim(COALESCE(region, '')), '') IS NOT NULL
             OR NULLIF(btrim(COALESCE(city, '')), '') IS NOT NULL
        )::bigint AS any_geo_rows,
        COUNT(*) FILTER (
          WHERE NULLIF(btrim(COALESCE(country, '')), '') IS NOT NULL
            AND NULLIF(btrim(COALESCE(region, '')), '') IS NOT NULL
            AND NULLIF(btrim(COALESCE(city, '')), '') IS NOT NULL
        )::bigint AS complete_geo_rows,
        COUNT(*) FILTER (WHERE NULLIF(btrim(COALESCE(country, '')), '') IS NOT NULL)::bigint AS country_rows,
        COUNT(*) FILTER (WHERE NULLIF(btrim(COALESCE(region, '')), '') IS NOT NULL)::bigint AS region_rows,
        COUNT(*) FILTER (WHERE NULLIF(btrim(COALESCE(city, '')), '') IS NOT NULL)::bigint AS city_rows,
        COUNT(*) FILTER (
          WHERE lower(btrim(COALESCE(remote_type, ''))) NOT IN ('', 'unknown', 'none', 'null', 'n/a', 'na', 'unspecified', 'not specified')
        )::bigint AS remote_known_rows,
        COUNT(*) FILTER (
          WHERE NULLIF(btrim(COALESCE(posting_date, '')), '') IS NOT NULL OR COALESCE(posted_at_epoch, 0) > 0
        )::bigint AS posting_date_rows,
        COUNT(*) FILTER (WHERE NULLIF(btrim(COALESCE(source_job_id, '')), '') IS NOT NULL)::bigint AS source_job_id_rows,
        COUNT(*) FILTER (WHERE last_seen_epoch >= (SELECT now_epoch FROM now_value) - 86400)::bigint AS seen_24h_rows,
        MAX(last_seen_epoch)::bigint AS latest_seen_epoch
      FROM visible
      GROUP BY ats_key
    ),
    company_metrics AS (
      SELECT
        COALESCE(NULLIF(${companyAtsSql}, ''), 'unknown') AS ats_key,
        COUNT(*)::bigint AS configured_companies
      FROM companies
      GROUP BY ${companyAtsSql}
    ),
    sync_metrics AS (
      SELECT
        COALESCE(NULLIF(${syncAtsSql}, ''), 'unknown') AS ats_key,
        COUNT(*)::bigint AS sync_targets,
        COUNT(*) FILTER (WHERE next_sync_epoch <= (SELECT now_epoch FROM now_value))::bigint AS targets_due,
        COUNT(*) FILTER (WHERE COALESCE(last_success_epoch, 0) >= (SELECT now_epoch FROM now_value) - 86400)::bigint AS targets_success_24h
      FROM company_sync_state
      GROUP BY ${syncAtsSql}
    ),
    source_run_metrics AS (
      SELECT
        COALESCE(NULLIF(${sourceRunAtsSql}, ''), 'unknown') AS ats_key,
        COUNT(*) FILTER (WHERE COALESCE(finished_at, started_at, created_at) >= now() - interval '24 hours')::bigint AS source_runs_24h,
        MAX(EXTRACT(EPOCH FROM COALESCE(finished_at, started_at, created_at)))::bigint AS latest_source_run_epoch,
        COALESCE(SUM(fetch_count) FILTER (WHERE COALESCE(finished_at, started_at, created_at) >= now() - interval '24 hours'), 0)::bigint AS source_fetch_count_24h,
        COALESCE(SUM(parse_count) FILTER (WHERE COALESCE(finished_at, started_at, created_at) >= now() - interval '24 hours'), 0)::bigint AS source_parse_count_24h,
        COALESCE(SUM(accepted_count) FILTER (WHERE COALESCE(finished_at, started_at, created_at) >= now() - interval '24 hours'), 0)::bigint AS source_accepted_count_24h,
        COALESCE(SUM(rejected_count) FILTER (WHERE COALESCE(finished_at, started_at, created_at) >= now() - interval '24 hours'), 0)::bigint AS source_rejected_count_24h
      FROM ats_source_runs
      GROUP BY ${sourceRunAtsSql}
    ),
    target_failures AS (
      SELECT
        COALESCE(NULLIF(${targetFailureAtsSql}, ''), 'unknown') AS ats_key,
        COUNT(*)::bigint AS target_failures_24h
      FROM ingestion_run_errors
      WHERE created_at >= now() - interval '24 hours'
      GROUP BY ${targetFailureAtsSql}
    ),
    parser_attention AS (
      SELECT ats_key, COUNT(*)::bigint AS parser_attention_24h
      FROM (
        SELECT COALESCE(NULLIF(${parserErrorAtsSql}, ''), 'unknown') AS ats_key
        FROM ingestion_run_errors
        WHERE created_at >= now() - interval '24 hours'
          AND lower(COALESCE(error_type, '')) IN (
            'parser_drift',
            'parser_validation',
            'invalid_shape',
            'parser_adapter_not_implemented',
            'parser_parse',
            'parser_quarantine',
            'parser_normalize'
          )
        UNION ALL
        SELECT COALESCE(NULLIF(${parserErrorAtsSql}, ''), 'unknown') AS ats_key
        FROM parser_drift_events
        WHERE created_at >= now() - interval '24 hours'
      ) events
      GROUP BY ats_key
    ),
    all_ats AS (
      SELECT ats_key FROM source_metrics
      UNION SELECT ats_key FROM posting_metrics
      UNION SELECT ats_key FROM company_metrics
      UNION SELECT ats_key FROM sync_metrics
      UNION SELECT ats_key FROM source_run_metrics
    )
    SELECT
      a.ats_key,
      COALESCE(s.display_name, a.ats_key) AS display_name,
      COALESCE(s.source_enabled, false) AS source_enabled,
      COALESCE(s.protection_status, 'missing') AS protection_status,
      COALESCE(pm.visible_rows, 0)::bigint AS visible_rows,
      COALESCE(cm.configured_companies, 0)::bigint AS configured_companies,
      COALESCE(sm.sync_targets, 0)::bigint AS sync_targets,
      COALESCE(pm.posting_companies, 0)::bigint AS posting_companies,
      COALESCE(pm.location_text_rows, 0)::bigint AS location_text_rows,
      COALESCE(pm.any_geo_rows, 0)::bigint AS any_geo_rows,
      COALESCE(pm.complete_geo_rows, 0)::bigint AS complete_geo_rows,
      COALESCE(pm.country_rows, 0)::bigint AS country_rows,
      COALESCE(pm.region_rows, 0)::bigint AS region_rows,
      COALESCE(pm.city_rows, 0)::bigint AS city_rows,
      COALESCE(pm.remote_known_rows, 0)::bigint AS remote_known_rows,
      COALESCE(pm.posting_date_rows, 0)::bigint AS posting_date_rows,
      COALESCE(pm.source_job_id_rows, 0)::bigint AS source_job_id_rows,
      COALESCE(pm.seen_24h_rows, 0)::bigint AS seen_24h_rows,
      COALESCE(pm.latest_seen_epoch, 0)::bigint AS latest_seen_epoch,
      COALESCE(sm.targets_due, 0)::bigint AS targets_due,
      COALESCE(sm.targets_success_24h, 0)::bigint AS targets_success_24h,
      COALESCE(srm.source_runs_24h, 0)::bigint AS source_runs_24h,
      COALESCE(srm.latest_source_run_epoch, 0)::bigint AS latest_source_run_epoch,
      COALESCE(srm.source_fetch_count_24h, 0)::bigint AS source_fetch_count_24h,
      COALESCE(srm.source_parse_count_24h, 0)::bigint AS source_parse_count_24h,
      COALESCE(srm.source_accepted_count_24h, 0)::bigint AS source_accepted_count_24h,
      COALESCE(srm.source_rejected_count_24h, 0)::bigint AS source_rejected_count_24h,
      COALESCE(tf.target_failures_24h, 0)::bigint AS target_failures_24h,
      COALESCE(pa.parser_attention_24h, 0)::bigint AS parser_attention_24h
    FROM all_ats a
    LEFT JOIN source_metrics s ON s.ats_key = a.ats_key
    LEFT JOIN posting_metrics pm ON pm.ats_key = a.ats_key
    LEFT JOIN company_metrics cm ON cm.ats_key = a.ats_key
    LEFT JOIN sync_metrics sm ON sm.ats_key = a.ats_key
    LEFT JOIN source_run_metrics srm ON srm.ats_key = a.ats_key
    LEFT JOIN target_failures tf ON tf.ats_key = a.ats_key
    LEFT JOIN parser_attention pa ON pa.ats_key = a.ats_key
    ORDER BY COALESCE(pm.visible_rows, 0) DESC, a.ats_key ASC
    LIMIT $1
  `, [limit]);
  return result.rows;
}

function writeFile(filePath, content) {
  if (!filePath) return;
  const resolved = path.resolve(filePath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, content);
}

async function main() {
  const options = parseArgs();
  const pool = createPostgresPool();
  if (!pool) throw new Error("ats target table requires OPENJOBSLOTS_DB_BACKEND=postgres and DATABASE_URL");
  try {
    const rawRows = await loadRawRowsFromPostgres(pool, { limit: options.limit });
    const rows = buildTargetRows(rawRows);
    const generatedAt = new Date().toISOString();
    const payload = {
      ok: true,
      summary: buildSummary(rows, generatedAt),
      items: rows,
      count: rows.length
    };
    const jsonOutput = options.output || DEFAULT_JSON_OUTPUT;
    const markdownOutput = options.markdownOutput || DEFAULT_MARKDOWN_OUTPUT;
    writeFile(jsonOutput, `${JSON.stringify(payload, null, 2)}\n`);
    writeFile(markdownOutput, buildMarkdown(rows, { generatedAt }));

    if (options.markdown) process.stdout.write(buildMarkdown(rows, { generatedAt }));
    else process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = {
  buildMarkdown,
  buildSummary,
  buildTargetRows,
  loadRawRowsFromPostgres,
  parseArgs,
  thresholdProfileFor
};
