const { spawnSync } = require("node:child_process");

const checks = [
  ["node", ["--test", "scripts/test/infra-search-core.test.js"]],
  ["node", ["scripts/reindex-meili-from-postgres.test.js"]]
];

for (const [command, args] of checks) {
  const result = spawnSync(command, args, { cwd: process.cwd(), encoding: "utf8", stdio: "pipe", timeout: 120000 });
  if (result.status !== 0) {
    process.stdout.write(result.stdout || "");
    process.stderr.write(result.stderr || "");
    process.exit(result.status || 1);
  }
}

console.log("infra search release checks passed");
