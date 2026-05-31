const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..", "..");
const composePath = path.join(repoRoot, "docker-compose.yml");
const compose = fs.readFileSync(composePath, "utf8");

function serviceBlock(name) {
  const lines = compose.split(/\r?\n/);
  const start = lines.findIndex((line) => line === `  ${name}:`);
  assert.notEqual(start, -1, `expected ${name} service in docker-compose.yml`);
  const block = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^  \S/.test(line) || /^volumes:/.test(line)) break;
    block.push(line);
  }
  return block.join("\n");
}

function assertContains(block, expected, message) {
  assert.ok(block.includes(expected), message || `expected service block to include ${expected}`);
}

for (const serviceName of [
  "openjobslots-postgres",
  "openjobslots-meilisearch",
  "openjobslots-app",
  "openjobslots-worker"
]) {
  const block = serviceBlock(serviceName);
  assertContains(block, "mem_limit:", `${serviceName} must have a memory limit`);
  assertContains(block, "memswap_limit:", `${serviceName} must have swap capped at the container boundary`);
}

const appBlock = serviceBlock("openjobslots-app");
assertContains(appBlock, "NODE_OPTIONS=--max-old-space-size=${OPENJOBSLOTS_APP_NODE_OLD_SPACE_MB:-384}");
assertContains(appBlock, "OPENJOBSLOTS_PUBLIC_READ_CACHE_TTL_MS=${OPENJOBSLOTS_PUBLIC_READ_CACHE_TTL_MS:-120000}");

const workerBlock = serviceBlock("openjobslots-worker");
assertContains(workerBlock, "INGESTION_WORKER_CONCURRENCY=${INGESTION_WORKER_CONCURRENCY:-2}");
assertContains(workerBlock, "INGESTION_WORKER_INTERVAL_MS=${INGESTION_WORKER_INTERVAL_MS:-1800000}");
assertContains(workerBlock, "INGESTION_MAX_TARGETS_PER_RUN=${INGESTION_MAX_TARGETS_PER_RUN:-125}");
assertContains(workerBlock, "INGESTION_AUTO_SYNC_DAILY_TARGET_BUDGET=${INGESTION_AUTO_SYNC_DAILY_TARGET_BUDGET:-3000}");
assertContains(workerBlock, "INGESTION_AUTO_SYNC_TARGETS_PER_RUN=${INGESTION_AUTO_SYNC_TARGETS_PER_RUN:-50}");
assertContains(workerBlock, "INGESTION_SOURCE_DAILY_TARGET_BUDGET=${INGESTION_SOURCE_DAILY_TARGET_BUDGET:-250}");
assertContains(workerBlock, "NODE_OPTIONS=--max-old-space-size=${OPENJOBSLOTS_WORKER_NODE_OLD_SPACE_MB:-512}");

console.log("docker runtime policy tests passed");
