const fs = require("fs");
const path = require("path");
const { createPostgresPool } = require("../server/backends/postgres");
const { withHeavyJobLock } = require("../server/backends/heavyJobLock");
const {
  createEmptyGrowthSummary,
  getPostgresGrowthSummary,
  normalizeHours
} = require("../server/ingestion/growthSummary");

function parseArgs(argv) {
  const options = {
    hours: 24,
    bySource: false,
    json: false,
    output: ""
  };
  for (const arg of argv) {
    if (arg === "--json") options.json = true;
    else if (arg === "--by-source") options.bySource = true;
    else if (arg.startsWith("--hours=")) options.hours = normalizeHours(arg.slice("--hours=".length));
    else if (arg === "--hours") options.expectHours = true;
    else if (options.expectHours) {
      options.hours = normalizeHours(arg);
      options.expectHours = false;
    } else if (arg.startsWith("--output=")) options.output = arg.slice("--output=".length);
  }
  options.hours = normalizeHours(options.hours);
  return options;
}

function writeOutput(report, outputPath) {
  if (!outputPath) return;
  const resolved = path.resolve(outputPath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, `${JSON.stringify(report, null, 2)}\n`);
}

function printSummary(report) {
  const metrics = report.metrics || {};
  console.log(`OpenJobSlots growth audit (${report.hours}h)`);
  console.log(`Current visible rows: ${report.current_visible_rows || 0}`);
  console.log(`Current indexable rows: ${report.current_indexable_rows || 0}`);
  console.log(`New visible rows: ${metrics.new_visible_rows || 0}`);
  console.log(`New indexable rows: ${metrics.new_indexable_rows || 0}`);
  console.log(`New clean rows: ${metrics.new_clean_rows || 0}`);
  console.log(`Dirty public rows: ${metrics.dirty_public_rows || 0}`);
  console.log(`New quarantine rows: ${metrics.new_quarantine_rows || 0}`);
  console.log(`New rejected rows: ${metrics.new_rejected_rows || 0}`);
  console.log(`Meili indexed rows added: ${metrics.meili_indexed_rows_added || 0}`);
  console.log(`Worker source runs: ${metrics.worker_source_runs || 0}`);
  console.log(`Failed source runs: ${metrics.failed_source_runs || 0}`);
}

function printBySource(report) {
  const rows = (report.new_rows_by_ats || []).slice(0, 25).map((row) => ({
    ats: row.ats_key,
    visible: row.new_visible_rows,
    indexable: row.new_indexable_rows,
    clean: row.new_clean_rows,
    dirty_public: row.dirty_public_rows,
    quarantine: row.new_quarantine_rows,
    rejected: row.new_rejected_rows,
    clean_rate_pct: row.clean_acceptance_rate_pct
  }));
  console.table(rows);
}

async function runAudit(options = parseArgs(process.argv.slice(2)), env = process.env) {
  const dbBackend = String(env.OPENJOBSLOTS_DB_BACKEND || "sqlite").trim().toLowerCase();
  if (dbBackend !== "postgres") {
    return {
      ...createEmptyGrowthSummary({ hours: options.hours }),
      db_backend: dbBackend,
      skipped: true,
      reason: "growth audit requires the Postgres production source of truth"
    };
  }

  const pool = createPostgresPool({ enabled: true, connectionString: env.DATABASE_URL || env.POSTGRES_URL || "" });
  try {
    const report = await withHeavyJobLock(
      pool,
      `growth-audit-${options.hours}h`,
      () => getPostgresGrowthSummary(pool, { hours: options.hours })
    );
    return {
      ...report,
      db_backend: "postgres"
    };
  } finally {
    await pool.end();
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
      printSummary(report);
      if (options.bySource) printBySource(report);
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
