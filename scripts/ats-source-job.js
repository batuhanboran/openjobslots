const fs = require("node:fs");
const path = require("node:path");
const { parseArgs, runSourceJob } = require("../server/ingestion/sourceRunner");

function writeOutput(report, options = {}) {
  const safetyGate = report.safety_gate || {};
  const disabledSafetyLabel = safetyGate.production_operation_requested ? "operation" : "apply";
  const safetyLine = safetyGate.authorized
    ? "  apply: authorized"
    : safetyGate.operation_authorized
      ? "  operation: authorized; apply writes disabled"
      : `  ${disabledSafetyLabel}: disabled${safetyGate.missing?.length ? `; missing ${safetyGate.missing.join(", ")}` : ""}`;
  if (options.output) {
    const outputPath = path.resolve(options.output);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  }
  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }
  process.stdout.write(
    [
      `ATS source run: ${report.source}`,
      `  mode: ${report.mode}`,
      `  source_run_id: ${report.source_run_id || "not-recorded"}`,
      `  scanned_targets: ${report.scanned_targets || 0}`,
      `  fetch_count: ${report.fetch_count || 0}`,
      `  parse_count: ${report.parse_count || 0}`,
      `  accepted: ${report.accepted_count || 0}`,
      `  quarantined: ${report.quarantined_count || 0}`,
      `  rejected: ${report.rejected_count || 0}`,
      `  public_writes: ${report.public_write_count || 0}`,
      `  quarantine_writes: ${report.quarantine_write_count || 0}`,
      `  stop_reason: ${report.stop_reason || ""}`,
      `  errors: ${(report.errors || []).length}`,
      safetyLine
    ].join("\n") + "\n"
  );
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  try {
    const report = await runSourceJob(options, process.env);
    writeOutput(report, options);
  } catch (error) {
    if (error?.sourceRunSummary) {
      writeOutput(error.sourceRunSummary, options);
      process.exitCode = 1;
      return;
    }
    throw error;
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error?.stack || error?.message || String(error));
    process.exit(1);
  });
}

module.exports = {
  writeOutput
};
