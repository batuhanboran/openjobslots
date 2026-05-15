#!/usr/bin/env node

const {
  parseMethodExperimentArgs,
  runMethodExperiment,
  writeMethodExperimentOutput
} = require("../server/ingestion/methodExperiment");

async function main() {
  const options = parseMethodExperimentArgs();
  const report = await runMethodExperiment(options);
  writeMethodExperimentOutput(report, options.output);
  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }
  process.stdout.write([
    `ATS method experiment: ${report.source}`,
    `Targets scanned: ${report.scanned_targets}/${report.configured_targets}`,
    `Rows parsed: ${report.rows_parsed}`,
    `Net-new clean candidates: ${report.net_new_clean_candidates}`,
    `Duplicates: ${report.duplicates}`,
    `No geo/no remote candidates: ${report.no_geo_no_remote_candidates}`,
    `Missing geo candidates: ${report.missing_geo_candidates}`,
    `Weak/unknown remote candidates: ${report.weak_unknown_remote_candidates}`
  ].join("\n"));
  process.stdout.write("\n");
}

main().catch((error) => {
  console.error(error?.stack || error?.message || error);
  process.exitCode = 1;
});
