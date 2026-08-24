const { spawnSync } = require("node:child_process");

const checks = [
  ["node", ["--test", "scripts/test/infra-api-core.test.js"]],
  ["node", ["server/backends/postgresStore-sync-control.test.js"]],
  ["node", ["server/http/registerPublicRoutes.test.js"]],
  ["node", ["server/publicReadCache.test.js"]]
];

for (const [command, args] of checks) {
  const result = spawnSync(command, args, { cwd: process.cwd(), encoding: "utf8", stdio: "pipe" });
  if (result.status !== 0) {
    process.stdout.write(result.stdout || "");
    process.stderr.write(result.stderr || "");
    process.exit(result.status || 1);
  }
}

console.log("infra api release checks passed");
