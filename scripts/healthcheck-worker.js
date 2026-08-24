const { checkWorkerHeartbeat } = require("../server/ingestion/workerHeartbeat");

const maxAgeMs = Math.max(1000, Number(process.env.OPENJOBSLOTS_WORKER_HEARTBEAT_MAX_AGE_MS || 180000));
const result = checkWorkerHeartbeat({ maxAgeMs });
if (!result.ok) {
  console.error(JSON.stringify(result));
  process.exit(1);
}
console.log(JSON.stringify(result));
