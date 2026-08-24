const { spawnSync } = require("node:child_process");
const path = require("node:path");

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const root = process.cwd();
const checks = [
  ["node", ["scripts/test/infra-worker-release.test.js"], root],
  ["node", ["scripts/test/infra-api-release.test.js"], root],
  ["node", ["scripts/test/infra-deploy-release.test.js"], root],
  ["node", ["scripts/test/infra-search-release.test.js"], root],
  ["node", ["scripts/test/infra-version-release.test.js"], root],
  [npmCommand, ["run", "test:mobile-store-readiness"], root],
  // quality:gate already runs public stats, rate limits, HTTP, Docker, backend,
  // API, parser, and end-to-end suites in an isolated database.
  [npmCommand, ["run", "quality:gate"], root],
  [npmCommand, ["run", "build:web"], root],
  [npmCommand, ["run", "check"], path.join(root, "web")]
];

for (const [command, args, cwd] of checks) {
  console.log(`release check: ${command} ${args.join(" ")} (cwd=${cwd})`);
  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
    timeout: 30 * 60 * 1000,
    shell: process.platform === "win32" && command === npmCommand
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}

console.log("infra regression release checks passed");
