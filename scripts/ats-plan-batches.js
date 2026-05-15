#!/usr/bin/env node

const {
  parseBatchPlannerArgs,
  runTenantBatchPlanner,
  writeBatchPlannerOutput
} = require("../server/ingestion/tenantBatchPlanner");

function printSummary(report) {
  const selected = report.selected_plan || {};
  process.stdout.write(
    [
      `ATS tenant batch plan: ${report.source}`,
      `  configured_targets: ${report.configured_targets || 0}`,
      `  scanned_targets: ${report.scanned_targets || 0}`,
      `  net_new_clean_public_candidates: ${report.net_new_clean_public_candidates || 0}`,
      `  guard_safe_tenants: ${(report.guard_safe_tenants || []).length}`,
      `  unsafe_tenants: ${(report.unsafe_tenants || []).length}`,
      `  selected_target_gain: ${selected.target_gain || report.target_gain || 0}`,
      `  selected_gain: ${selected.cumulative_net_new_clean_public_candidates || 0}`,
      `  selected_guard: ${selected.predicted_guard_result || "unknown"}`,
      `  selected_fail_reasons: ${(selected.fail_reasons || []).join(", ") || "none"}`,
      `  has_guard_safe_5k_batch: ${Boolean(report.has_guard_safe_5k_batch)}`,
      `  has_guard_safe_10k_batch: ${Boolean(report.has_guard_safe_10k_batch)}`
    ].join("\n") + "\n"
  );
}

async function main() {
  const options = parseBatchPlannerArgs(process.argv.slice(2));
  const report = await runTenantBatchPlanner(options, process.env);
  writeBatchPlannerOutput(report, options.output);
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
