const fs = require("fs");
const path = require("path");
const { createPostgresPool } = require("../server/backends/postgres");
const { withHeavyJobLock } = require("../server/backends/heavyJobLock");
const {
  getPostgresSourceFreshnessReport,
  getSqliteSourceFreshnessReport,
  openSqliteReadOnly
} = require("../server/ingestion/dataQualityAudit");

function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    json: false,
    days: 30,
    limit: 100,
    output: "",
    dbPath: ""
  };
  for (const arg of argv) {
    if (arg === "--json") options.json = true;
    else if (arg.startsWith("--days=")) options.days = Number(arg.slice("--days=".length));
    else if (arg === "--days") options.expectDays = true;
    else if (arg.startsWith("--limit=")) options.limit = Number(arg.slice("--limit=".length));
    else if (arg === "--limit") options.expectLimit = true;
    else if (options.expectDays) {
      options.days = Number(arg);
      options.expectDays = false;
    } else if (options.expectLimit) {
      options.limit = Number(arg);
      options.expectLimit = false;
    } else if (arg.startsWith("--db=")) options.dbPath = arg.slice("--db=".length);
    else if (arg.startsWith("--output=")) options.output = arg.slice("--output=".length);
  }
  options.days = Math.max(1, Math.min(365, Math.floor(Number(options.days || 30))));
  options.limit = Math.max(1, Math.min(1000, Math.floor(Number(options.limit || 100))));
  return options;
}

function writeOutput(report, outputPath) {
  if (!outputPath) return;
  const resolved = path.resolve(outputPath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, `${JSON.stringify(report, null, 2)}\n`);
}

function formatEpoch(epoch) {
  const value = Number(epoch || 0);
  if (!value) return "";
  return new Date(value * 1000).toISOString();
}

function printReport(report) {
  console.log("OpenJobSlots source freshness audit");
  console.log(`Backend: ${report.db_backend}`);
  console.log(`Due window: ${report.filters?.stale_days || 30} days`);
  console.table((report.items || []).slice(0, 25).map((item) => ({
    ats: item.ats_key,
    enabled: item.enabled,
    state: item.protection_status,
    targets: item.target_count,
    visible: item.visible_rows,
    seen_in_window: item.visible_rows_seen_within_window,
    latest_seen: formatEpoch(item.latest_seen_epoch),
    latest_source_run: formatEpoch(item.latest_source_run_epoch),
    due: item.is_due,
    reason: item.due_reason
  })));
}

async function runAudit(options = parseArgs(), env = process.env) {
  const dbBackend = String(env.OPENJOBSLOTS_DB_BACKEND || "sqlite").trim().toLowerCase();
  if (dbBackend === "postgres") {
    const pool = createPostgresPool({ enabled: true, connectionString: env.DATABASE_URL || env.POSTGRES_URL || "" });
    try {
      const audit = await withHeavyJobLock(
        pool,
        "source-freshness-audit",
        () => getPostgresSourceFreshnessReport(pool, { staleDays: options.days, limit: options.limit })
      );
      return {
        ok: true,
        db_backend: "postgres",
        filters: audit.filters,
        items: audit.items
      };
    } finally {
      await pool.end();
    }
  }

  const dbPath = options.dbPath || env.DB_PATH || path.resolve(__dirname, "..", "jobs.db");
  const db = await openSqliteReadOnly(dbPath);
  try {
    const audit = await getSqliteSourceFreshnessReport(db, { staleDays: options.days, limit: options.limit });
    return {
      ok: true,
      db_backend: "sqlite",
      db_path: path.resolve(dbPath),
      filters: audit.filters,
      items: audit.items
    };
  } finally {
    await db.close();
  }
}

if (require.main === module) {
  const options = parseArgs(process.argv.slice(2));
  runAudit(options)
    .then((report) => {
      writeOutput(report, options.output);
      if (options.json) {
        console.log(JSON.stringify(report, null, 2));
        return;
      }
      printReport(report);
    })
    .catch((error) => {
      console.error(error?.stack || error);
      process.exit(1);
    });
}

module.exports = {
  parseArgs,
  runAudit,
  writeOutput
};
