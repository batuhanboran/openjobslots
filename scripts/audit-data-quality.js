const path = require("path");
const { createPostgresPool } = require("../server/backends/postgres");
const {
  getPostgresQualityAudit,
  getSqliteQualityAudit,
  openSqliteReadOnly
} = require("../server/ingestion/dataQualityAudit");

function parseArgs(argv) {
  const options = {
    json: false,
    bySource: false,
    byParser: false,
    limit: 25,
    dbPath: ""
  };
  for (const arg of argv) {
    if (arg === "--json") options.json = true;
    else if (arg === "--by-source") options.bySource = true;
    else if (arg === "--by-parser") options.byParser = true;
    else if (arg.startsWith("--limit=")) options.limit = Number(arg.slice("--limit=".length));
    else if (arg === "--limit") options.expectLimit = true;
    else if (options.expectLimit) {
      options.limit = Number(arg);
      options.expectLimit = false;
    } else if (arg.startsWith("--db=")) options.dbPath = arg.slice("--db=".length);
  }
  options.limit = Math.max(1, Math.min(1000, Number(options.limit || 25)));
  return options;
}

function formatPct(value) {
  return `${Number(value || 0).toFixed(2)}%`;
}

function printSummary(report) {
  const summary = report.summary || {};
  console.log("OpenJobSlots data quality audit");
  console.log(`Backend: ${report.db_backend}`);
  console.log(`Total visible postings: ${summary.total_visible_postings || 0}`);
  console.log(`Missing country: ${summary.missing_country_count || 0} / ${formatPct(summary.missing_country_pct)}`);
  console.log(`Missing location_text: ${summary.missing_location_text_count || 0} / ${formatPct(summary.missing_location_text_pct)}`);
  console.log(`Missing region/state: ${summary.missing_region_state_count || 0} / ${formatPct(summary.missing_region_state_pct)}`);
  console.log(`Missing city: ${summary.missing_city_count || 0} / ${formatPct(summary.missing_city_pct)}`);
  console.log(`Missing any normalized geo: ${summary.missing_any_normalized_geo_count || 0} / ${formatPct(summary.missing_any_normalized_geo_pct)}`);
  console.log(`Missing all normalized geo: ${summary.missing_all_normalized_geo_count || 0} / ${formatPct(summary.missing_all_normalized_geo_pct)}`);
  console.log(`Suspicious/unknown geo: ${summary.suspicious_unknown_geo_count || 0} / ${formatPct(summary.suspicious_unknown_geo_pct)}`);
  console.log(`Missing remote_type: ${summary.missing_remote_type_count || 0} / ${formatPct(summary.missing_remote_type_pct)}`);
  console.log(`Weak/unknown remote_type: ${summary.weak_unknown_remote_type_count || 0} / ${formatPct(summary.weak_unknown_remote_type_pct)}`);
  console.log(`Missing all geo and weak/unknown remote: ${summary.missing_all_geo_and_weak_remote_count || 0} / ${formatPct(summary.missing_all_geo_and_weak_remote_pct)}`);
}

function printGroup(title, rows, keyFields) {
  console.log("");
  console.log(title);
  const visibleRows = rows.slice(0, 25).map((row) => ({
    key: keyFields.map((field) => row[field]).filter(Boolean).join(" / "),
    total: row.total_visible_rows,
    missing_any_geo: row.missing_any_normalized_geo_count,
    missing_any_geo_pct: row.missing_any_normalized_geo_pct,
    weak_remote: row.weak_unknown_remote_type_count,
    weak_remote_pct: row.weak_unknown_remote_type_pct,
    parser_errors: row.parser_error_count || 0,
    rejections: row.rejection_count || 0
  }));
  console.table(visibleRows);
}

async function runAudit(options = parseArgs(process.argv.slice(2)), env = process.env) {
  const dbBackend = String(env.OPENJOBSLOTS_DB_BACKEND || "sqlite").trim().toLowerCase();
  if (dbBackend === "postgres") {
    const pool = createPostgresPool({ enabled: true, connectionString: env.DATABASE_URL || env.POSTGRES_URL || "" });
    try {
      const audit = await getPostgresQualityAudit(pool, { limit: options.limit });
      return {
        ok: true,
        db_backend: "postgres",
        summary: audit.summary,
        by_source: audit.by_source,
        by_parser: audit.by_parser
      };
    } finally {
      await pool.end();
    }
  }

  const dbPath = options.dbPath || env.DB_PATH || path.resolve(__dirname, "..", "jobs.db");
  const db = await openSqliteReadOnly(dbPath);
  try {
    const audit = await getSqliteQualityAudit(db, { limit: options.limit });
    return {
      ok: true,
      db_backend: "sqlite",
      db_path: path.resolve(dbPath),
      summary: audit.summary,
      by_source: audit.by_source,
      by_parser: audit.by_parser
    };
  } finally {
    await db.close();
  }
}

if (require.main === module) {
  const options = parseArgs(process.argv.slice(2));
  runAudit(options)
    .then((report) => {
      if (options.json) {
        console.log(JSON.stringify(report, null, 2));
        return;
      }
      printSummary(report);
      if (options.bySource || (!options.bySource && !options.byParser)) {
        printGroup("Worst sources", report.by_source || [], ["source_ats"]);
      }
      if (options.byParser) {
        printGroup("Worst parser versions", report.by_parser || [], ["source_ats", "parser_version"]);
      }
    })
    .catch((error) => {
      console.error(error?.stack || error);
      process.exit(1);
    });
}

module.exports = {
  parseArgs,
  runAudit
};
