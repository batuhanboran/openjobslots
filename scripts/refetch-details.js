const { parseArgs, runDetailRefetch } = require("../server/ingestion/detailRefetch/detailRefetchPlanner");
const { printHuman } = require("./refetch-details-dry-run");

function printApplyHuman(report) {
  printHuman(report);
  process.stdout.write(
    [
      "",
      "Apply gate:",
      `  apply requested: ${report.safety_gate?.apply_requested ? "yes" : "no"}`,
      `  authorized: ${report.safety_gate?.authorized ? "yes" : "no"}`,
      `  applied rows: ${report.applied_rows || 0}`,
      `  applied changes: ${report.applied_changes || 0}`,
      `  run_id: ${report.run_id || ""}`
    ].join("\n") + "\n"
  );
  if (!report.safety_gate?.authorized) {
    process.stdout.write("Apply disabled: missing one or more required safety flags.\n");
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const report = await runDetailRefetch(options, process.env);
  if (options.output) {
    require("fs").writeFileSync(options.output, `${JSON.stringify(report, null, 2)}\n`);
  }
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
