const { parseArgs, runDetailRefetch } = require("../server/ingestion/detailRefetch/detailRefetchPlanner");

function printHuman(report) {
  process.stdout.write(
    [
      "Detail refetch dry-run",
      `  sources: ${(report.sources || []).join(", ")}`,
      `  candidates: ${report.total_candidates || 0}`,
      `  fetched: ${report.fetched || 0}`,
      `  planned rows: ${report.planned_rows || 0}`,
      `  planned changes: ${report.planned_changes || 0}`,
      `  parser failures: ${report.parser_failure_count || 0}`,
      `  iCIMS candidates: ${report.candidate_summary?.rows_requiring_icims_detail_refetch || 0}`,
      `  Applitrack candidates: ${report.candidate_summary?.rows_requiring_applitrack_detail_refetch || 0}`
    ].join("\n") + "\n"
  );
  if (Object.keys(report.http_status_counts || {}).length > 0) {
    process.stdout.write(`  HTTP statuses: ${JSON.stringify(report.http_status_counts)}\n`);
  }
  if (Array.isArray(report.samples) && report.samples.length > 0) {
    process.stdout.write("\nSamples:\n");
    for (const sample of report.samples) {
      process.stdout.write(`  - ${sample.source_ats} ${sample.canonical_url}\n`);
      for (const item of sample.proposed_changes || []) {
        process.stdout.write(`      ${item.field}: ${JSON.stringify(item.before)} -> ${JSON.stringify(item.after)} (${item.rule})\n`);
      }
    }
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  options.apply = false;
  const report = await runDetailRefetch(options, process.env);
  if (options.output) {
    require("fs").writeFileSync(options.output, `${JSON.stringify(report, null, 2)}\n`);
  }
  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    printHuman(report);
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error?.stack || error?.message || String(error));
    process.exit(1);
  });
}

module.exports = {
  printHuman
};
