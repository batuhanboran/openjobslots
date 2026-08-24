const fs = require("node:fs");
const path = require("node:path");
const { createPostgresPool } = require("../server/backends/postgres");

function parseBoolean(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

function parseRuntimeOptimizationArgs(argv = process.argv.slice(2), env = process.env) {
  const options = {
    apply: parseBoolean(env.OPENJOBSLOTS_RUNTIME_OPTIMIZE_APPLY),
    confirmProduction: parseBoolean(env.OPENJOBSLOTS_RUNTIME_OPTIMIZE_CONFIRM_PRODUCTION),
    workerIsolated: parseBoolean(env.OPENJOBSLOTS_RUNTIME_OPTIMIZE_WORKER_ISOLATED),
    backupPath: String(env.OPENJOBSLOTS_RUNTIME_OPTIMIZE_BACKUP_PATH || "").trim()
  };
  for (const arg of argv) {
    if (arg === "--apply") options.apply = true;
    else if (arg === "--confirm-production") options.confirmProduction = true;
    else if (arg === "--worker-isolated") options.workerIsolated = true;
    else if (arg.startsWith("--backup-path=")) options.backupPath = String(arg.slice("--backup-path=".length)).trim();
    else throw new Error(`Unknown runtime optimization argument: ${arg}`);
  }
  const missing = [];
  if (!options.apply) missing.push("--apply");
  if (!options.confirmProduction) missing.push("--confirm-production");
  if (!options.workerIsolated) missing.push("--worker-isolated");
  if (!options.backupPath) missing.push("--backup-path=<path>");
  return { ...options, missing, authorized: missing.length === 0 };
}

function buildRuntimeOptimizationPlan() {
  return [
    `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_postings_visible_posted_seen
      ON postings (COALESCE(posted_at_epoch, 0) DESC, last_seen_epoch DESC, canonical_url ASC)
      WHERE hidden = false;`,
    "ANALYZE companies;",
    "ANALYZE postings;"
  ];
}

function verifyBackup(backupPath) {
  const resolved = path.resolve(backupPath);
  const stat = fs.statSync(resolved);
  if (!stat.isFile() || stat.size <= 0) throw new Error("backup proof must be a non-empty file");
  return { path: resolved, size_bytes: stat.size };
}

async function runRuntimeOptimization(pool, options) {
  const plan = buildRuntimeOptimizationPlan();
  if (!options.authorized) {
    return { ok: true, dry_run: true, authorized: false, missing: options.missing, plan };
  }
  const backup = verifyBackup(options.backupPath);
  const lock = await pool.query("SELECT pg_try_advisory_lock(hashtext('openjobslots_runtime_optimization')) AS acquired;");
  if (lock.rows?.[0]?.acquired !== true) throw new Error("runtime optimization lock is already active");
  try {
    const client = await pool.connect();
    try {
      await client.query("SET statement_timeout = '20min';");
      for (const statement of plan) {
        await client.query({ text: statement, query_timeout: 20 * 60 * 1000 });
      }
    } finally {
      client.release();
    }
  } finally {
    await pool.query("SELECT pg_advisory_unlock(hashtext('openjobslots_runtime_optimization'));");
  }
  return { ok: true, dry_run: false, authorized: true, backup, applied: plan };
}

async function main() {
  const options = parseRuntimeOptimizationArgs();
  const pool = createPostgresPool();
  if (!pool) throw new Error("OPENJOBSLOTS_DB_BACKEND=postgres is required");
  try {
    const result = await runRuntimeOptimization(pool, options);
    console.log(JSON.stringify(result));
    if (options.apply && !options.authorized) process.exitCode = 2;
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = {
  buildRuntimeOptimizationPlan,
  parseRuntimeOptimizationArgs,
  runRuntimeOptimization
};
