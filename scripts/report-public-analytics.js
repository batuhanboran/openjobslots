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

function formatReport(report) {
  const eventCounts = report.event_counts || {};
  return [
    `OpenJobSlots public analytics for ${report.date} (${report.timezone})`,
    `Events: postings=${Number(eventCounts.postings || 0)}, suggest=${Number(eventCounts.suggest || 0)}, filter_options=${Number(eventCounts.filter_options || 0)}`,
    `Top final searches: ${formatTerms(report.top_final_posting_searches)}`,
    `Top suggest inputs: ${formatTerms(report.top_suggest_inputs)}`,
    `Top combined terms: ${formatTerms(report.top_terms)}`
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
