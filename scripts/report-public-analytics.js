const { createPostgresPool } = require("../server/backends/postgres");
const { getPostgresPublicSearchReport } = require("../server/backends/postgresStore");

function parseArgs(argv = process.argv.slice(2), env = process.env) {
  const options = {
    date: String(env.OPENJOBSLOTS_ANALYTICS_DATE || "today").trim() || "today",
    timezone: String(env.OPENJOBSLOTS_ANALYTICS_TIMEZONE || "Europe/Istanbul").trim() || "Europe/Istanbul",
    json: false,
    limit: 15
  };
  for (const arg of argv) {
    if (arg === "--json") options.json = true;
    else if (arg.startsWith("--date=")) options.date = String(arg.slice("--date=".length) || "").trim();
    else if (arg === "--date") options.expectDate = true;
    else if (arg.startsWith("--timezone=")) options.timezone = String(arg.slice("--timezone=".length) || "").trim();
    else if (arg === "--timezone") options.expectTimezone = true;
    else if (arg.startsWith("--limit=")) options.limit = Number(arg.slice("--limit=".length));
    else if (arg === "--limit") options.expectLimit = true;
    else if (options.expectDate) {
      options.date = String(arg || "").trim();
      options.expectDate = false;
    } else if (options.expectTimezone) {
      options.timezone = String(arg || "").trim();
      options.expectTimezone = false;
    } else if (options.expectLimit) {
      options.limit = Number(arg);
      options.expectLimit = false;
    }
  }
  options.limit = Math.max(1, Math.min(50, Math.floor(Number(options.limit || 15))));
  return options;
}

function formatTerms(items = []) {
  if (!Array.isArray(items) || items.length === 0) return "none";
  return items.map((item) => `${item.query} (${item.count})`).join(", ");
}

function formatTopTerm(items = []) {
  if (!Array.isArray(items) || items.length === 0) return "none";
  return `${items[0].query} (${items[0].count})`;
}

function formatPercent(value) {
  if (!Number.isFinite(Number(value))) return "n/a";
  return `${(Number(value) * 100).toFixed(2)}%`;
}

function formatReport(report) {
  const eventCounts = report.event_counts || {};
  const resultCounts = report.result_count_distribution || {};
  const cacheCounts = report.cache_status_counts || {};
  const topEndpoint = report.top_endpoint;
  return [
    `OpenJobSlots public analytics for ${report.date} (${report.timezone})`,
    "Source: backend public_search_events only; edge traffic belongs in a separate report section.",
    `Backend public search events: total=${Number(report.total_events || 0)}, anonymous_sessions=${Number(report.anonymous_session_count || 0)}`,
    `Events by endpoint: /postings=${Number(eventCounts.postings || 0)}, /search/suggest=${Number(eventCounts.suggest || 0)}, /postings/filter-options=${Number(eventCounts.filter_options || 0)}`,
    `Top endpoint: ${topEndpoint ? `${topEndpoint.endpoint} (${topEndpoint.count})` : "none"}`,
    `Top normalized query: ${formatTopTerm(report.top_normalized_queries || report.top_terms)}`,
    `Top job title/keyword: ${formatTopTerm(report.top_job_title_keywords || report.top_final_posting_searches)}`,
    `Top final searches: ${formatTerms(report.top_final_posting_searches)}`,
    `Top suggest inputs: ${formatTerms(report.top_suggest_inputs)}`,
    `Top combined terms: ${formatTerms(report.top_terms)}`,
    `Result counts: zero=${Number(resultCounts.zero_result || 0)}, low=${Number(resultCounts.low_result || 0)}, normal=${Number(resultCounts.normal_result || 0)}, unknown=${Number(resultCounts.unknown_result || 0)}`,
    `Cache: HIT=${Number(cacheCounts.HIT || 0)}, MISS=${Number(cacheCounts.MISS || 0)}, hit_rate=${formatPercent(report.cache_hit_rate)}`,
    `Top referrers: ${(report.top_referrers || []).map((item) => `${item.host} (${item.count})`).join(", ") || "none"}`,
    `Top user-agent families: ${(report.top_user_agent_families || []).map((item) => `${item.family} (${item.count})`).join(", ") || "none"}`
  ].join("\n");
}

async function main() {
  const options = parseArgs();
  const pool = createPostgresPool({
    enabled: true,
    connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL || ""
  });
  try {
    const report = await getPostgresPublicSearchReport(pool, options);
    if (options.json) console.log(JSON.stringify(report));
    else console.log(formatReport(report));
  } finally {
    if (pool && typeof pool.end === "function") await pool.end();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = {
  formatReport,
  parseArgs
};
