const {
  parseEstimatorArgs,
  runNetNewEstimate,
  writeEstimatorOutput
} = require("../server/ingestion/netNewEstimator");

function printSummary(report) {
  process.stdout.write(
    [
      `ATS net-new estimate: ${report.source}`,
      `  configured_targets: ${report.inventory?.configured_targets || 0}`,
      `  targets_scanned: ${report.inventory?.targets_scanned || 0}`,
      `  target_coverage_pct: ${report.inventory?.target_coverage_pct || 0}`,
      `  rows_fetched: ${report.rows_fetched || 0}`,
      `  rows_parsed: ${report.rows_parsed || 0}`,
      `  clean_candidates: ${report.clean_candidates || 0}`,
      `  net_new_clean_public_candidates: ${report.net_new_clean_public_candidates || 0}`,
      `  already_public_duplicates: ${report.duplicate_count || 0}`,
      `  existing_public_update_candidates: ${report.update_count || 0}`,
      `  quarantine_candidates: ${report.quarantine_count || 0}`,
      `  rejected_candidates: ${report.rejected_count || 0}`,
      `  expected_public_row_gain: ${report.expected_public_row_gain || 0}`,
      report.inventory?.cannot_prove_remaining_inventory
        ? "  inventory: unproven remaining targets exist"
        : "  inventory: requested window fully covered"
    ].join("\n") + "\n"
  );
}

async function main() {
  const options = parseEstimatorArgs(process.argv.slice(2));
  const report = await runNetNewEstimate(options, process.env);
  writeEstimatorOutput(report, options.output);
  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }
  printSummary(report);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error?.stack || error?.message || String(error));
    process.exit(1);
  });
}

module.exports = {
  printSummary
};
