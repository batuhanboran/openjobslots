const fs = require("fs");
const path = require("path");
const { ATS_FILTER_OPTION_ITEMS } = require("../server");
const { createPostgresPool } = require("../server/backends/postgres");
const { getPostgresQualityAudit } = require("../server/ingestion/dataQualityAudit");
const {
  getAdapterMetadata,
  isAtsEnabledByDefault
} = require("../server/ingestion/adapter-metadata");

const SOURCE_TYPE_BY_TIER = Object.freeze({
  "direct-json-stable": "public JSON API",
  "enterprise-direct": "enterprise API",
  "embedded-or-semi-structured": "embedded JSON / HTML detail",
  "vendor-specific": "vendor public endpoint / unknown",
  "public-sector-education": "public sector / education feed",
  "brittle-high-risk": "HTML scrape / brittle enterprise board",
  uncategorized: "unknown"
});

const PUBLIC_ENABLE_RISK_SCORE_THRESHOLD = 190;
const DETAIL_REFETCH_GEO_THRESHOLD = 35;
const DETAIL_REFETCH_REMOTE_THRESHOLD = 50;

function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    json: false,
    markdown: false,
    bySource: false,
    byParser: false,
    output: "",
    markdownOutput: "",
    qualitySummaryPath: "",
    parserStatsPath: "",
    limit: 1000
  };

  for (const arg of argv) {
    if (arg === "--json") options.json = true;
    else if (arg === "--markdown") options.markdown = true;
    else if (arg === "--by-source") options.bySource = true;
    else if (arg === "--by-parser") options.byParser = true;
    else if (arg.startsWith("--output=")) options.output = arg.slice("--output=".length);
    else if (arg.startsWith("--markdown-output=")) options.markdownOutput = arg.slice("--markdown-output=".length);
    else if (arg.startsWith("--quality-summary=")) options.qualitySummaryPath = arg.slice("--quality-summary=".length);
    else if (arg.startsWith("--parser-stats=")) options.parserStatsPath = arg.slice("--parser-stats=".length);
    else if (arg.startsWith("--limit=")) options.limit = Number(arg.slice("--limit=".length)) || options.limit;
  }
  return options;
}

function readJsonFile(filePath) {
  if (!filePath) return null;
  const resolved = path.resolve(filePath);
  return JSON.parse(fs.readFileSync(resolved, "utf8"));
}

function pct(count, total) {
  const denominator = Number(total || 0);
  if (!denominator) return 0;
  return Number(((Number(count || 0) * 100) / denominator).toFixed(2));
}

function clean(value) {
  return String(value ?? "").trim();
}

function normalizeKey(value) {
  return clean(value).toLowerCase();
}

function qualityBySourceFromSummary(summaryPayload) {
  const map = new Map();
  for (const row of summaryPayload?.by_source || summaryPayload?.items || []) {
    const key = normalizeKey(row.source_ats || row.ats_key);
    if (!key) continue;
    map.set(key, row);
  }
  return map;
}

function parserStatsBySource(parserStatsPayload) {
  const map = new Map();
  for (const row of parserStatsPayload?.items || parserStatsPayload?.by_parser || []) {
    const key = normalizeKey(row.source_ats || row.ats_key);
    if (!key) continue;
    const existing = map.get(key) || {
      parser_versions: new Set(),
      parser_attention_count_24h: 0,
      rejected_count: 0,
      quarantined_count: 0,
      latest_parser_error: ""
    };
    if (clean(row.parser_version)) existing.parser_versions.add(clean(row.parser_version));
    existing.parser_attention_count_24h += Number(row.parser_attention_count_24h || row.parser_error_count || 0);
    existing.rejected_count += Number(row.rejected_count || 0);
    existing.quarantined_count += Number(row.quarantined_count || 0);
    if (!existing.latest_parser_error && clean(row.latest_parser_error)) {
      existing.latest_parser_error = clean(row.latest_parser_error);
    }
    map.set(key, existing);
  }
  return map;
}

function sourceIdReliability(metadata, quality) {
  if (metadata.parserFixtureStatus === "unsupported") return "unsupported";
  const total = Number(quality?.total_visible_rows || quality?.total_postings || 0);
  const missing = Number(quality?.missing_source_id_count || 0);
  if (total > 0 && missing / total > 0.2) return "weak-live";
  if (metadata.parserFixtureStatus === "parser-fixture-backed") return "fixture-backed";
  if (metadata.fixtureStatus === "fixture-backed") return "partial";
  return "unproven";
}

function canonicalUrlReliability(metadata) {
  if (metadata.parserFixtureStatus === "unsupported") return "unsupported";
  if (metadata.parserFixtureStatus === "parser-fixture-backed") return "fixture-backed";
  if (metadata.fixtureStatus === "fixture-backed") return "partial";
  return "unproven";
}

function currentStatus(metadata) {
  if (metadata.parserFixtureStatus === "unsupported") return "unsupported";
  if (!metadata.enabledByDefault) return "disabled";
  if (metadata.parserFixtureStatus === "parser-fixture-backed") return "certified";
  if (metadata.fixtureStatus === "fixture-backed") return "partial";
  if (metadata.tier === "brittle-high-risk") return "fallback";
  return "fallback";
}

function detailRefetchNeeded(row) {
  const status = clean(row.current_status);
  if (status === "disabled" || status === "unsupported") return false;
  const count = Number(row.current_production_row_count || 0);
  if (!count) return false;
  if (row.source_type.includes("HTML") || row.source_type.includes("embedded") || row.source_type.includes("public sector")) {
    return row.missing_any_geo_pct >= DETAIL_REFETCH_GEO_THRESHOLD || row.weak_remote_pct >= DETAIL_REFETCH_REMOTE_THRESHOLD;
  }
  return row.missing_any_geo_pct >= 85 && row.weak_remote_pct >= 85;
}

function riskScore(row) {
  const countWeight = Math.log10(Number(row.current_production_row_count || 0) + 1) * 10;
  const uncertifiedPenalty = row.current_status === "certified" ? 0 : row.current_status === "partial" ? 18 : 35;
  const disabledPenalty = row.current_status === "disabled" || row.current_status === "unsupported" ? -100 : 0;
  const errorPenalty = Math.min(25, Number(row.parser_attention_count_24h || 0));
  return Number((
    row.missing_country_pct * 0.45 +
    row.missing_city_pct * 0.25 +
    row.missing_any_geo_pct * 0.55 +
    row.weak_remote_pct * 0.35 +
    countWeight +
    uncertifiedPenalty +
    errorPenalty +
    disabledPenalty
  ).toFixed(2));
}

function wavePriority(row) {
  if (row.current_status === "unsupported" || row.current_status === "disabled") return "disabled";
  if (!row.current_production_row_count) return row.current_status === "certified" ? "monitor" : "wave-4-fixture";
  if (row.risk_score >= 180) return "wave-1-live-gap";
  if (row.risk_score >= 130) return "wave-2-live-gap";
  if (row.current_status !== "certified") return "wave-3-certification";
  return "monitor";
}

function blockerFor(row) {
  if (row.current_status === "unsupported") return "unsupported source; no implemented adapter";
  if (row.current_status === "disabled") return "disabled until fixtures and parser exist";
  const blockers = [];
  if (row.current_status !== "certified") blockers.push("missing strict raw parser fixture");
  if (row.missing_any_geo_pct >= 50) blockers.push("high missing normalized geo");
  if (row.weak_remote_pct >= 50) blockers.push("high weak remote classification");
  if (row.source_id_reliability === "unproven" || row.source_id_reliability === "weak-live") blockers.push("source id reliability unproven/weak");
  if (row.canonical_url_reliability === "unproven") blockers.push("canonical URL reliability unproven");
  return blockers.length ? blockers.join("; ") : "none";
}

function nextActionFor(row) {
  if (row.current_status === "unsupported") return "keep disabled; implement source-backed adapter only with raw fixtures";
  if (row.current_status === "disabled") return "keep disabled until direct parser, fixtures, and rate-limit policy exist";
  if (row.detail_refetch_needed) return "add or run bounded detail-refetch certification for missing geo/remote evidence";
  if (row.current_status !== "certified") return "add saved raw response fixture, expected normalized fixture, invalid-shape rejection test";
  if (row.missing_any_geo_pct >= 20 || row.weak_remote_pct >= 20) return "audit raw payloads and add field-specific parser/backfill fixture";
  return "monitor with parser stats and live field-quality audit";
}

function publicEnabledRecommendation(row) {
  if (row.current_status === "unsupported" || row.current_status === "disabled") return false;
  if (row.current_production_row_count === 0) return row.current_status === "certified";
  if (row.risk_score >= PUBLIC_ENABLE_RISK_SCORE_THRESHOLD && row.current_status !== "certified") return false;
  if (row.missing_any_geo_pct >= 95 && row.weak_remote_pct >= 95) return false;
  return true;
}

function reasonFor(row) {
  if (!row.should_be_public_enabled) {
    if (row.current_status === "unsupported" || row.current_status === "disabled") return row.certification_blockers;
    return `hold/quarantine recommendation: ${row.certification_blockers}`;
  }
  if (row.wave_priority.startsWith("wave-")) return `enabled with quality debt: ${row.certification_blockers}`;
  return row.certification_blockers === "none" ? "source has acceptable current evidence" : row.certification_blockers;
}

function buildAtsScoreboard({ atsItems = ATS_FILTER_OPTION_ITEMS, qualitySummary = null, parserStats = null } = {}) {
  const qualityMap = qualityBySourceFromSummary(qualitySummary);
  const parserStatsMap = parserStatsBySource(parserStats);
  const rows = [];

  for (const item of atsItems) {
    const atsKey = normalizeKey(item.value);
    const metadata = getAdapterMetadata(atsKey, item.label);
    const quality = qualityMap.get(atsKey) || {};
    const parser = parserStatsMap.get(atsKey) || {};
    const total = Number(quality.total_visible_rows || quality.total_postings || 0);
    const row = {
      ats_key: atsKey,
      display_name: clean(item.label || atsKey),
      current_status: currentStatus(metadata),
      source_type: SOURCE_TYPE_BY_TIER[metadata.tier] || "unknown",
      public_api_or_html_detail_strategy: metadata.parseStrategy,
      current_production_row_count: total,
      missing_country_pct: Number(quality.missing_country_pct ?? pct(quality.missing_country_count, total)),
      missing_city_pct: Number(quality.missing_city_pct ?? pct(quality.missing_city_count, total)),
      missing_any_geo_pct: Number(quality.missing_any_normalized_geo_pct ?? pct(quality.missing_any_normalized_geo_count, total)),
      weak_remote_pct: Number(quality.weak_unknown_remote_type_pct ?? quality.missing_remote_type_pct ?? pct(quality.weak_unknown_remote_type_count, total)),
      source_id_reliability: sourceIdReliability(metadata, quality),
      canonical_url_reliability: canonicalUrlReliability(metadata),
      detail_refetch_needed: false,
      should_be_public_enabled: false,
      reason: "",
      parser_versions: Array.from(parser.parser_versions || []),
      parser_attention_count_24h: Number(parser.parser_attention_count_24h || quality.parser_error_count || quality.parser_attention_count_24h || 0),
      rejected_count: Number(parser.rejected_count || quality.rejection_count || 0),
      quarantined_count: Number(parser.quarantined_count || 0),
      latest_parser_error: clean(parser.latest_parser_error || quality.latest_parser_error),
      fixture_status: metadata.fixtureStatus,
      parser_fixture_status: metadata.parserFixtureStatus,
      parser_confidence: metadata.confidence,
      adapter_tier: metadata.tier,
      enabled_by_default: item.enabledByDefault !== false && isAtsEnabledByDefault(atsKey)
    };
    row.detail_refetch_needed = detailRefetchNeeded(row);
    row.risk_score = riskScore(row);
    row.wave_priority = wavePriority(row);
    row.certification_blockers = blockerFor(row);
    row.exact_next_parser_action = nextActionFor(row);
    row.should_be_public_enabled = publicEnabledRecommendation(row);
    row.reason = reasonFor(row);
    rows.push(row);
  }

  rows.sort((a, b) => b.risk_score - a.risk_score || b.current_production_row_count - a.current_production_row_count || a.ats_key.localeCompare(b.ats_key));
  return rows;
}

function buildMarkdown(scoreboard) {
  const generatedAt = new Date().toISOString();
  const rows = Array.isArray(scoreboard) ? scoreboard : [];
  const header = [
    "# ATS Certification Workbench Scoreboard",
    "",
    `Generated: ${generatedAt}`,
    "",
    "This report is read-only. It merges configured ATS metadata with live/test field-quality stats when provided. Percentages are based on visible/searchable rows in the supplied quality summary or configured database.",
    "",
    "| ats_key | status | source type | rows | missing country % | missing city % | missing any geo % | weak remote % | source id | canonical URL | detail refetch | public enabled | wave | blocker | next action |",
    "| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- | --- | --- | --- | --- | --- |"
  ];
  for (const row of rows) {
    header.push(`| \`${row.ats_key}\` | ${row.current_status} | ${row.source_type} | ${row.current_production_row_count} | ${row.missing_country_pct} | ${row.missing_city_pct} | ${row.missing_any_geo_pct} | ${row.weak_remote_pct} | ${row.source_id_reliability} | ${row.canonical_url_reliability} | ${row.detail_refetch_needed ? "yes" : "no"} | ${row.should_be_public_enabled ? "yes" : "no"} | ${row.wave_priority} | ${row.certification_blockers.replace(/\|/g, "/")} | ${row.exact_next_parser_action.replace(/\|/g, "/")} |`);
  }
  return `${header.join("\n")}\n`;
}

function buildSummary(scoreboard) {
  const rows = Array.isArray(scoreboard) ? scoreboard : [];
  const byStatus = {};
  for (const row of rows) {
    byStatus[row.current_status] = Number(byStatus[row.current_status] || 0) + 1;
  }
  return {
    generated_at: new Date().toISOString(),
    configured_ats_count: rows.length,
    status_counts: byStatus,
    top_15_quality_risk: rows.slice(0, 15).map((row) => ({
      ats_key: row.ats_key,
      risk_score: row.risk_score,
      current_status: row.current_status,
      current_production_row_count: row.current_production_row_count,
      missing_any_geo_pct: row.missing_any_geo_pct,
      weak_remote_pct: row.weak_remote_pct,
      wave_priority: row.wave_priority,
      reason: row.reason
    })),
    disabled_or_quarantine_recommendations: rows
      .filter((row) => !row.should_be_public_enabled)
      .map((row) => ({
        ats_key: row.ats_key,
        status: row.current_status,
        reason: row.reason,
        next_action: row.exact_next_parser_action
      }))
  };
}

async function loadQualityData(options) {
  if (options.qualitySummaryPath || options.parserStatsPath) {
    return {
      qualitySummary: readJsonFile(options.qualitySummaryPath),
      parserStats: readJsonFile(options.parserStatsPath)
    };
  }

  const pool = createPostgresPool();
  if (!pool) {
    return {
      qualitySummary: {
        ok: false,
        warning: "Postgres is not configured; ATS quality audit is using configured adapter metadata without live row counts.",
        by_source: [],
        by_parser: [],
        summary: {},
        count: 0
      },
      parserStats: {
        ok: false,
        warning: "Postgres is not configured; parser stats are unavailable.",
        items: [],
        count: 0
      }
    };
  }
  try {
    const audit = await getPostgresQualityAudit(pool, { limit: options.limit });
    return {
      qualitySummary: {
        ok: true,
        by_source: audit.by_source,
        by_parser: audit.by_parser,
        summary: audit.summary,
        count: audit.by_source.length
      },
      parserStats: {
        ok: true,
        items: audit.by_parser,
        count: audit.by_parser.length
      }
    };
  } finally {
    await pool.end();
  }
}

async function main() {
  const options = parseArgs();
  const { qualitySummary, parserStats } = await loadQualityData(options);
  const scoreboard = buildAtsScoreboard({ qualitySummary, parserStats });
  const payload = {
    ok: true,
    summary: buildSummary(scoreboard),
    items: scoreboard,
    count: scoreboard.length
  };

  if (options.output) {
    fs.mkdirSync(path.dirname(path.resolve(options.output)), { recursive: true });
    fs.writeFileSync(path.resolve(options.output), `${JSON.stringify(payload, null, 2)}\n`);
  }
  if (options.markdownOutput) {
    fs.mkdirSync(path.dirname(path.resolve(options.markdownOutput)), { recursive: true });
    fs.writeFileSync(path.resolve(options.markdownOutput), buildMarkdown(scoreboard));
  }

  if (options.markdown) {
    process.stdout.write(buildMarkdown(scoreboard));
  } else {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = {
  buildAtsScoreboard,
  buildMarkdown,
  buildSummary,
  blockerFor,
  canonicalUrlReliability,
  currentStatus,
  detailRefetchNeeded,
  nextActionFor,
  parseArgs,
  publicEnabledRecommendation,
  reasonFor,
  riskScore,
  sourceIdReliability,
  wavePriority
};
