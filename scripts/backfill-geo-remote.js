const { parseArgs, runBackfill } = require("../server/ingestion/backfill/geoRemotePlanner");
const { printHuman } = require("./backfill-geo-remote-dry-run");

function printApplyHuman(report) {
  printHuman(report);
  if (report.apply_mode) {
    process.stdout.write(
      [
        "",
        "Apply result:",
        `  run_id: ${report.run_id || ""}`,
        `  applied_rows: ${report.applied_rows || 0}`,
        `  applied_changes: ${report.applied_changes || 0}`,
        `  errors: ${(report.errors || []).length}`
      ].join("\n") + "\n"
    );
  } else {
    process.stdout.write("\nApply disabled: missing one or more required safety flags.\n");
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const report = await runBackfill(options, process.env);
  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    printApplyHuman(report);
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error?.stack || error?.message || String(error));
    process.exit(1);
  });
}

module.exports = {
  printApplyHuman
};
