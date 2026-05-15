#!/usr/bin/env node

const {
  parseRollbackArgs,
  runSourceRollback
} = require("../server/ingestion/sourceRollback");

function printSummary(report = {}) {
  process.stdout.write(
    [
      `ATS source rollback: ${report.source}`,
      `  source_run_id: ${report.source_run_id || 0}`,
      `  rollback_id: ${report.rollback_id || 0}`,
      `  dry_run: ${Boolean(report.dry_run)}`,
      `  changes_considered: ${report.changes_considered || 0}`,
      `  created_rows_to_delete: ${report.created_rows_to_delete || 0}`,
      `  updated_rows_to_restore: ${report.updated_rows_to_restore || 0}`,
      `  cache_rows_to_delete: ${report.cache_rows_to_delete || 0}`,
      `  cache_rows_to_restore: ${report.cache_rows_to_restore || 0}`,
      `  outbox_deletes: ${report.outbox_deletes || 0}`,
      `  outbox_upserts: ${report.outbox_upserts || 0}`,
      `  errors: ${(report.errors || []).length}`
    ].join("\n") + "\n"
  );
}

async function main() {
  const options = parseRollbackArgs(process.argv.slice(2));
  const report = await runSourceRollback(options, process.env);
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
