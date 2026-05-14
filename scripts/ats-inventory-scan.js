const {
  parseInventoryArgs,
  printInventorySummary,
  runInventoryScan,
  writeInventoryOutput
} = require("../server/ingestion/inventoryScanner");

async function main() {
  const options = parseInventoryArgs(process.argv.slice(2));
  const report = await runInventoryScan(options, process.env);
  writeInventoryOutput(report, options.output);
  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }
  printInventorySummary(report);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error?.stack || error?.message || String(error));
    process.exit(1);
  });
}

module.exports = {
  main
};
