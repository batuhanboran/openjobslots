const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..", "..");
const deploy = fs.readFileSync(path.join(repoRoot, "scripts", "deploy.sh"), "utf8");
const service = fs.readFileSync(path.join(repoRoot, "deploy", "systemd", "openjobslots-deploy.service"), "utf8");
const deploymentDoc = fs.readFileSync(path.join(repoRoot, "docs", "reference", "deployment.md"), "utf8");
const watchdogIndexMode = execFileSync("git", ["ls-files", "--stage", "scripts/worker-watchdog.sh"], {
  cwd: repoRoot,
  encoding: "utf8"
}).trim().split(/\s+/)[0];

assert.equal(watchdogIndexMode, "100755", "worker watchdog must be executable for the production cron entry");

assert.match(deploy, /git status --porcelain/);
assert.match(deploy, /refusing deploy.*dirty/i);
assert.match(deploy, /pg_dump/);
assert.match(deploy, /test -s/);
assert.match(deploy, /-e backups/);
assert.match(deploy, /--connect-timeout/);
assert.match(deploy, /--max-time/);
assert.match(deploy, /\/health\/ready/);
assert.match(deploy, /openjobslots-web/);
assert.doesNotMatch(deploy, /curl -fsS "\$HEALTH_URL"/);
assert.match(deploy, /validate_postings_response/);
assert.match(deploy, /Array\.isArray\(payload\.items\)/);
assert.match(deploy, /Number\.isFinite\(Number\(payload\.count\)\)/);
assert.doesNotMatch(
  deploy,
  /\/postings\?[^\n]*\|\s*grep\s+-q\s+'"ok":true'/,
  "the postings API has no ok field; deploy smoke tests must validate its actual payload"
);

assert.match(service, /APP_DIR=\/root\/OpenJobSlots/);
assert.match(service, /ExecStart=\/bin\/bash \/root\/OpenJobSlots\/scripts\/deploy\.sh/);
assert.match(service, /HEALTH_URL=http:\/\/127\.0\.0\.1:8081\/health\/ready/);

assert.match(deploymentDoc, /public GitHub repository/i);
assert.match(deploymentDoc, /OPENJOBSLOTS_MEILI_MEM_LIMIT=6144m/);
assert.match(deploymentDoc, /OPENJOBSLOTS_MEILI_MEMSWAP_LIMIT=8192m/);
assert.match(deploymentDoc, /worker heartbeat/i);
assert.match(deploymentDoc, /fresh Postgres backup/i);
assert.match(deploymentDoc, /web frontend.*same Compose deploy/i);

console.log("infra deploy core tests passed");
