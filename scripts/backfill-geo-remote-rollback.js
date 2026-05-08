const { parseArgs, runRollback } = require("../server/ingestion/backfill/geoRemotePlanner");

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const report = await runRollback(options, process.env);
  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(
      [
        "OpenJobSlots geo/remote backfill rollback",
        `DB backend: ${report.db_backend}`,
        `rolled_back_run_id: ${report.rolled_back_run_id}`,
        `rollback_run_id: ${report.rollback_run_id}`,
        `restored_changes: ${report.restored_changes}`,
        `errors: ${(report.errors || []).length}`
      ].join("\n") + "\n"
    );
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error?.stack || error?.message || String(error));
    process.exit(1);
  });
}
