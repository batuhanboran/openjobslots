const { parseArgs, runDetailRefetch } = require("../server/ingestion/detailRefetch/detailRefetchPlanner");
const { printApplyHuman } = require("./refetch-details");

function envDefaults(env = process.env) {
  const args = [];
  const sources = String(env.OPENJOBSLOTS_DETAIL_BACKFILL_ATS || "icims,applitrack")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  for (const source of sources) args.push(`--source=${source}`);
  if (env.OPENJOBSLOTS_DETAIL_BACKFILL_LIMIT) args.push(`--limit=${env.OPENJOBSLOTS_DETAIL_BACKFILL_LIMIT}`);
  if (env.OPENJOBSLOTS_DETAIL_BACKFILL_DELAY_MS) args.push(`--delay-ms=${env.OPENJOBSLOTS_DETAIL_BACKFILL_DELAY_MS}`);
  return args;
}

async function main() {
  const options = parseArgs([...envDefaults(process.env), ...process.argv.slice(2)]);
  const report = await runDetailRefetch(options, process.env);
  if (options.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else printApplyHuman(report);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error?.stack || error?.message || String(error));
    process.exit(1);
  });
}

module.exports = {
  envDefaults
};
