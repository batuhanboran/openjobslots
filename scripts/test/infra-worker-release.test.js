const { spawnSync } = require("node:child_process");

const checks = [
  ["node", ["--test", "server/ingestion/workerRuntime.test.js"]],
  ["node", ["--test", "server/ingestion/workerHeartbeat.test.js"]],
  ["node", ["server/ingestion/worker-concurrency.test.js"]],
  ["node", ["scripts/test/worker-watchdog-policy.test.js"]],
  ["node", ["scripts/test/docker-runtime-policy.test.js"]]
];

for (const [command, args] of checks) {
  const result = spawnSync(command, args, { cwd: process.cwd(), encoding: "utf8", stdio: "pipe" });
  if (result.status !== 0) {
    process.stdout.write(result.stdout || "");
    process.stderr.write(result.stderr || "");
    process.exit(result.status || 1);
  }
}

console.log("infra worker release checks passed");
