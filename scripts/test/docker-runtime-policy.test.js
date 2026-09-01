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
  "openjobslots-worker",
  "openjobslots-web"
]) {
  const block = serviceBlock(serviceName);
  assertContains(block, "mem_limit:", `${serviceName} must have a memory limit`);
  assertContains(block, "memswap_limit:", `${serviceName} must have swap capped at the container boundary`);
}

const appBlock = serviceBlock("openjobslots-app");
assertContains(appBlock, "NODE_OPTIONS=--max-old-space-size=${OPENJOBSLOTS_APP_NODE_OLD_SPACE_MB:-384}");
assertContains(appBlock, "OPENJOBSLOTS_PUBLIC_READ_CACHE_TTL_MS=${OPENJOBSLOTS_PUBLIC_READ_CACHE_TTL_MS:-120000}");
assertContains(appBlock, "healthcheck:");
assertContains(appBlock, "scripts/healthcheck-app.js");

const workerBlock = serviceBlock("openjobslots-worker");
assertContains(workerBlock, "INGESTION_WORKER_CONCURRENCY=${INGESTION_WORKER_CONCURRENCY:-2}");
assertContains(workerBlock, "INGESTION_WORKER_INTERVAL_MS=${INGESTION_WORKER_INTERVAL_MS:-1800000}");
assertContains(workerBlock, "INGESTION_MAX_TARGETS_PER_RUN=${INGESTION_MAX_TARGETS_PER_RUN:-125}");
assertContains(workerBlock, "INGESTION_AUTO_SYNC_DAILY_TARGET_BUDGET=${INGESTION_AUTO_SYNC_DAILY_TARGET_BUDGET:-3000}");
assertContains(workerBlock, "INGESTION_AUTO_SYNC_TARGETS_PER_RUN=${INGESTION_AUTO_SYNC_TARGETS_PER_RUN:-50}");
assertContains(workerBlock, "INGESTION_SOURCE_DAILY_TARGET_BUDGET=${INGESTION_SOURCE_DAILY_TARGET_BUDGET:-250}");
assertContains(workerBlock, "OPENJOBSLOTS_SEARCH_OUTBOX_BATCH_SIZE=${OPENJOBSLOTS_SEARCH_OUTBOX_BATCH_SIZE:-1000}");
assertContains(workerBlock, "OPENJOBSLOTS_RETENTION_INTERVAL_MS=${OPENJOBSLOTS_RETENTION_INTERVAL_MS:-3600000}");
assertContains(workerBlock, "OPENJOBSLOTS_SOURCE_QUALITY_PROTECTION_INTERVAL_MS=${OPENJOBSLOTS_SOURCE_QUALITY_PROTECTION_INTERVAL_MS:-1800000}");
assertContains(workerBlock, "OPENJOBSLOTS_PUBLIC_STATS_REFRESH_INTERVAL_MS=${OPENJOBSLOTS_PUBLIC_STATS_REFRESH_INTERVAL_MS:-1800000}");
assertContains(workerBlock, "NODE_OPTIONS=--max-old-space-size=${OPENJOBSLOTS_WORKER_NODE_OLD_SPACE_MB:-512}");
assertContains(workerBlock, "healthcheck:");
assertContains(workerBlock, "scripts/healthcheck-worker.js");

const meiliBlock = serviceBlock("openjobslots-meilisearch");
assertContains(meiliBlock, "OPENJOBSLOTS_MEILI_MEM_LIMIT:-6144m");
assertContains(meiliBlock, "OPENJOBSLOTS_MEILI_MEMSWAP_LIMIT:-8192m");

const postgresBlock = serviceBlock("openjobslots-postgres");
assertContains(postgresBlock, "OPENJOBSLOTS_POSTGRES_MEM_LIMIT:-2560m");
assertContains(postgresBlock, "OPENJOBSLOTS_POSTGRES_MEMSWAP_LIMIT:-2560m");
assertContains(postgresBlock, "OPENJOBSLOTS_POSTGRES_SHARED_BUFFERS:-512MB");
assertContains(postgresBlock, "OPENJOBSLOTS_POSTGRES_EFFECTIVE_CACHE_SIZE:-6GB");

const webBlock = serviceBlock("openjobslots-web");
assertContains(webBlock, "context: ./web");
assertContains(webBlock, "image: openjobslots-web:${OPENJOBSLOTS_WEB_IMAGE_TAG:-3.0.2}");
assertContains(webBlock, '"${OPENJOBSLOTS_WEB_ORIGIN_PORT:-8090}:3000"');
assertContains(webBlock, "OJS_API_BASE=http://openjobslots-app:8787");
assertContains(webBlock, "condition: service_healthy");
assertContains(webBlock, "healthcheck:");

console.log("docker runtime policy tests passed");
