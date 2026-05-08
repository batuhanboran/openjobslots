const { parseArgs, runDryRun } = require("../server/ingestion/backfill/geoRemotePlanner");

function printHuman(report) {
  const lines = [
    "OpenJobSlots geo/remote backfill dry run",
    `DB backend: ${report.db_backend}`,
    `Source filter: ${report.source_filter || "all"}`,
    `Limit: ${report.limit}`,
    `Total scanned: ${report.total_scanned}`,
    "",
    "Classifications:"
  ];

  for (const [category, count] of Object.entries(report.classification_counts || {})) {
    lines.push(`  ${category}: ${count}`);
  }

  lines.push("", "Proposed updates by field:");
  for (const [field, count] of Object.entries(report.proposed_updates_by_field || {})) {
    lines.push(`  ${field}: ${count}`);
  }

  lines.push("", "Detail refetch:");
  lines.push(`  icims: ${report.rows_requiring_icims_detail_refetch || 0}`);
  lines.push(`  applitrack: ${report.rows_requiring_applitrack_detail_refetch || 0}`);
  lines.push(`  unsafe ambiguous: ${report.unsafe_ambiguous_rows || 0}`);

  if ((report.sample_before_after_rows || []).length > 0) {
    lines.push("", "Samples:");
    for (const sample of report.sample_before_after_rows) {
      const fields = (sample.changes || []).map((change) => `${change.field}:${change.before || "<blank>"}->${Array.isArray(change.after) ? change.after.join("|") : change.after} [${change.rule}]`);
      lines.push(`  ${sample.source_ats} ${sample.canonical_url}: ${fields.join("; ")}`);
    }
  }

  process.stdout.write(`${lines.join("\n")}\n`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const report = await runDryRun(options, process.env);
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
