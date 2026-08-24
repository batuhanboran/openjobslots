const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  decorateParityProof,
  parseReindexArgs
} = require("../reindex-meili-from-postgres");
const {
  buildRuntimeOptimizationPlan,
  parseRuntimeOptimizationArgs,
  runRuntimeOptimization
} = require("../optimize-postgres-runtime");
const { runPublicStatsRefresh } = require("../refresh-public-stats");

test("bounded parity evidence can never masquerade as full release proof", () => {
  const parsed = parseReindexArgs(["--check", "--bounded", "--max-runtime-ms=120000"], {});
  assert.equal(parsed.bounded, true);
  assert.equal(parsed.maxRuntimeMs, 120000);
  assert.deepEqual(decorateParityProof({ ok: true, count_delta: 0 }, { bounded: true }), {
    ok: false,
    bounded_ok: true,
    count_delta: 0,
    validation_complete: false,
    proof_scope: "bounded",
    release_proof: false
  });
  assert.deepEqual(decorateParityProof({ ok: true, count_delta: 0 }, { bounded: false }), {
    ok: true,
    count_delta: 0,
    validation_complete: true,
    proof_scope: "full",
    release_proof: true
  });
});

test("runtime database optimization is dry-run by default and production apply is fail-closed", () => {
  const dryRun = parseRuntimeOptimizationArgs([], {});
  assert.equal(dryRun.apply, false);
  assert.equal(dryRun.authorized, false);

  const missingProof = parseRuntimeOptimizationArgs(["--apply", "--confirm-production"], {});
  assert.equal(missingProof.authorized, false);
  assert.ok(missingProof.missing.includes("--worker-isolated"));
  assert.ok(missingProof.missing.includes("--backup-path=<path>"));

  const authorized = parseRuntimeOptimizationArgs([
    "--apply",
    "--confirm-production",
    "--worker-isolated",
    "--backup-path=/backups/predeploy.dump"
  ], {});
  assert.equal(authorized.authorized, true);

  const plan = buildRuntimeOptimizationPlan();
  assert.ok(plan.some((statement) => /CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_postings_visible_posted_seen/i.test(statement)));
  assert.ok(plan.some((statement) => /^ANALYZE companies/i.test(statement)));
  assert.ok(plan.every((statement) => !/DELETE|TRUNCATE|UPDATE postings/i.test(statement)));
});

test("runtime optimization gives long index and analyze operations a client-side timeout", async () => {
  const backupPath = path.join(os.tmpdir(), `openjobslots-runtime-${process.pid}-${Date.now()}.dump`);
  fs.writeFileSync(backupPath, "backup-proof");
  const clientQueries = [];
  const client = {
    query: async (query) => {
      clientQueries.push(query);
      return { rows: [] };
    },
    release() {}
  };
  const pool = {
    query: async (query) => /pg_try_advisory_lock/.test(query)
      ? { rows: [{ acquired: true }] }
      : { rows: [] },
    connect: async () => client
  };
  try {
    await runRuntimeOptimization(pool, {
      authorized: true,
      backupPath,
      missing: []
    });
  } finally {
    fs.unlinkSync(backupPath);
  }
  const longQueries = clientQueries.filter((query) => typeof query === "object");
  assert.equal(longQueries.length, buildRuntimeOptimizationPlan().length);
  assert.ok(longQueries.every((query) => query.query_timeout === 20 * 60 * 1000));
});

test("public stats refresh command exposes a bounded, testable refresh seam", async () => {
  const counts = { public_postings: 42, companies: 7 };
  const result = await runPublicStatsRefresh({ query() {} }, async () => counts);
  assert.equal(result.ok, true);
  assert.deepEqual(result.counts, counts);
  assert.match(result.refreshed_at, /^\d{4}-\d{2}-\d{2}T/);
});
