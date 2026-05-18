const {
  parseEstimatorArgs,
  runAllSourceNetNewEstimate,
  runNetNewEstimate,
  writeEstimatorOutput
} = require("../server/ingestion/netNewEstimator");
const {
  buildMarkdownEvidenceSnapshot
} = require("../server/ingestion/markdownEvidence");

const fs = require("node:fs");
const path = require("node:path");

function printSummary(report) {
  if (report.mode === "estimate-net-new-all-sources") {
    const summary = report.summary || {};
    process.stdout.write(
      [
        "ATS all-source net-new estimate",
        `  sources_total: ${summary.sources_total || 0}`,
        `  configured_targets: ${summary.configured_targets || 0}`,
        `  targets_scanned: ${summary.targets_scanned || 0}`,
        `  rows_fetched: ${summary.rows_fetched || 0}`,
        `  rows_parsed: ${summary.rows_parsed || 0}`,
        `  clean_candidates: ${summary.clean_candidates || 0}`,
        `  net_new_clean_public_candidates: ${summary.net_new_clean_public_candidates || 0}`,
        `  quarantine_candidates: ${summary.quarantine_candidates || 0}`,
        `  rejected_candidates: ${summary.rejected_candidates || 0}`,
        `  decision_buckets: ${JSON.stringify(summary.by_decision_bucket || {})}`
      ].join("\n") + "\n"
    );
    return;
  }
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

function writeMarkdownOutput(report, outputPath) {
  if (!outputPath) return;
  const resolved = path.resolve(outputPath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, buildMarkdownEvidenceSnapshot(report));
}

async function main() {
  const options = parseEstimatorArgs(process.argv.slice(2));
  const report = options.all
    ? await runAllSourceNetNewEstimate(options, process.env)
    : await runNetNewEstimate(options, process.env);
  writeEstimatorOutput(report, options.output);
  writeMarkdownOutput(report, options.markdownOutput);
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
  printSummary,
  writeMarkdownOutput
};
