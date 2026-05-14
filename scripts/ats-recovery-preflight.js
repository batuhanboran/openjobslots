const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

let stdinCache = null;

function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    systemReport: "",
    expectedCommit: "",
    backupPath: "",
    output: "",
    json: false,
    selfTest: false,
    allowRunningWorker: false,
    allowActiveAutodeploy: false,
    workerIsolated: false,
    maxLongRunningQueries: 0
  };
  for (const arg of argv) {
    if (arg === "--json") options.json = true;
    else if (arg === "--self-test") options.selfTest = true;
    else if (arg === "--allow-running-worker") options.allowRunningWorker = true;
    else if (arg === "--allow-active-autodeploy") options.allowActiveAutodeploy = true;
    else if (arg === "--worker-isolated") options.workerIsolated = true;
    else if (arg.startsWith("--system-report=")) options.systemReport = arg.slice("--system-report=".length);
    else if (arg.startsWith("--expected-commit=")) options.expectedCommit = arg.slice("--expected-commit=".length);
    else if (arg.startsWith("--backup-path=")) options.backupPath = arg.slice("--backup-path=".length);
    else if (arg.startsWith("--output=")) options.output = arg.slice("--output=".length);
    else if (arg.startsWith("--max-long-running-queries=")) {
      options.maxLongRunningQueries = Number(arg.slice("--max-long-running-queries=".length));
    }
  }
  if (!Number.isFinite(options.maxLongRunningQueries)) options.maxLongRunningQueries = 0;
  return options;
}

function readStdinJson() {
  if (stdinCache === null) stdinCache = fs.readFileSync(0, "utf8");
  return JSON.parse(stdinCache);
}

function readJson(filePath) {
  if (!filePath) return null;
  if (filePath === "-") return readStdinJson();
  return JSON.parse(fs.readFileSync(path.resolve(filePath), "utf8"));
}

function writeJson(filePath, payload) {
  if (!filePath) return;
  const resolved = path.resolve(filePath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, `${JSON.stringify(payload, null, 2)}\n`);
}

function runOptional(command, args = []) {
  try {
    return {
      ok: true,
      stdout: execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim()
    };
  } catch (error) {
    return {
      ok: false,
      stdout: String(error.stdout || "").trim(),
      stderr: String(error.stderr || error.message || "").trim()
    };
  }
}

function currentCommit() {
  const result = runOptional("git", ["rev-parse", "HEAD"]);
  return result.ok ? result.stdout : "";
}

function collectLocalSystemReport(options = {}) {
  const timer = runOptional("systemctl", ["is-active", "openjobslots-deploy.timer"]);
  const dockerPs = runOptional("docker", ["compose", "ps", "--format", "json"]);
  let workerState = "unknown";
  if (dockerPs.ok && dockerPs.stdout) {
    const rows = dockerPs.stdout
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch (_) {
          return null;
        }
      })
      .filter(Boolean);
    const worker = rows.find((row) => String(row.Name || row.Service || "").includes("openjobslots-worker"));
    workerState = String(worker?.State || worker?.Status || "unknown").toLowerCase();
  }
  return {
    production_checkout_commit: currentCommit(),
    worker_state: workerState,
    worker_isolated: options.workerIsolated,
    autodeploy_timer_state: timer.ok ? timer.stdout : "unknown",
    autodeploy_recovery_safe: false,
    heavy_job_active: null,
    long_running_postgres_queries: null,
    meili_postgres_delta: null,
    backup_path: options.backupPath,
    backup_parent_exists: options.backupPath ? fs.existsSync(path.dirname(options.backupPath)) : false,
    collection_warnings: [
      ...(timer.ok ? [] : [{ code: "systemctl_unavailable", message: timer.stderr }]),
      ...(dockerPs.ok ? [] : [{ code: "docker_compose_unavailable", message: dockerPs.stderr }])
    ]
  };
}

function normalizeState(value) {
  return String(value || "").trim().toLowerCase();
}

function commitMatches(actual, expected) {
  if (!actual || !expected) return false;
  return actual.startsWith(expected) || expected.startsWith(actual);
}

function isWorkerSafe(report = {}, options = {}) {
  const state = normalizeState(report.worker_state || report.worker?.state);
  const isolated = report.worker_isolated === true || options.workerIsolated === true || report.worker?.isolated === true;
  if (isolated) return true;
  if (options.allowRunningWorker) return true;
  return ["stopped", "exited", "paused", "not_running", "not running", "disabled", "inactive", "dead"].includes(state);
}

function isAutodeploySafe(report = {}, options = {}) {
  const state = normalizeState(report.autodeploy_timer_state || report.autodeploy?.timer_state);
  if (report.autodeploy_recovery_safe === true || report.autodeploy?.recovery_safe === true) return true;
  if (options.allowActiveAutodeploy) return true;
  return ["inactive", "disabled", "stopped", "not_found", "not-found", "failed", "dead"].includes(state);
}

function heavyJobActive(report = {}) {
  if (typeof report.heavy_job_active === "boolean") return report.heavy_job_active;
  if (typeof report.heavy_job?.active === "boolean") return report.heavy_job.active;
  return null;
}

function longRunningQueryCount(report = {}) {
  const value = report.long_running_postgres_queries ?? report.postgres?.long_running_queries ?? report.long_running_queries_count;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function meiliDelta(report = {}) {
  const value = report.meili_postgres_delta ?? report.meili?.postgres_delta ?? report.search?.meili_postgres_delta;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function backupParentExists(report = {}, options = {}) {
  if (typeof report.backup_parent_exists === "boolean") return report.backup_parent_exists;
  const backupPath = report.backup_path || options.backupPath;
  if (!backupPath) return false;
  return fs.existsSync(path.dirname(backupPath));
}

function backupPathValue(report = {}, options = {}) {
  return report.backup_path || options.backupPath || "";
}

function evaluatePreflight(input = {}, options = {}) {
  const failures = [];
  const warnings = [];
  const checks = {};
  const report = input || {};
  const expectedCommit = options.expectedCommit || report.expected_commit || "";
  const actualCommit = report.production_checkout_commit || report.checkout_commit || report.git?.commit || "";

  checks.production_checkout_commit = actualCommit || null;
  checks.expected_commit = expectedCommit || null;
  if (!expectedCommit) {
    failures.push({ code: "expected_commit_missing", message: "expected production checkout commit is required" });
  } else if (!commitMatches(actualCommit, expectedCommit)) {
    failures.push({
      code: "production_commit_mismatch",
      message: "production checkout commit does not match expected commit",
      expected: expectedCommit,
      actual: actualCommit || null
    });
  }

  checks.worker_state = report.worker_state || report.worker?.state || "unknown";
  checks.worker_isolated = report.worker_isolated === true || options.workerIsolated === true || report.worker?.isolated === true;
  if (!isWorkerSafe(report, options)) {
    failures.push({
      code: "worker_not_isolated",
      message: "worker must be stopped, paused, or explicitly isolated before source recovery writes",
      state: checks.worker_state
    });
  }

  checks.autodeploy_timer_state = report.autodeploy_timer_state || report.autodeploy?.timer_state || "unknown";
  checks.autodeploy_recovery_safe = report.autodeploy_recovery_safe === true || report.autodeploy?.recovery_safe === true;
  if (!isAutodeploySafe(report, options)) {
    failures.push({
      code: "autodeploy_timer_unsafe",
      message: "openjobslots-deploy.timer must be inactive or recovery-safe",
      state: checks.autodeploy_timer_state
    });
  }

  const activeHeavyJob = heavyJobActive(report);
  checks.heavy_job_active = activeHeavyJob;
  if (activeHeavyJob === null) {
    failures.push({ code: "heavy_job_lock_undocumented", message: "heavy-job advisory lock state is required" });
  } else if (activeHeavyJob) {
    failures.push({ code: "heavy_job_lock_active", message: "heavy-job advisory lock is active" });
  }

  const longQueries = longRunningQueryCount(report);
  checks.long_running_postgres_queries = longQueries;
  if (longQueries === null) {
    failures.push({ code: "long_running_postgres_queries_undocumented", message: "long-running Postgres query count is required" });
  } else if (longQueries > options.maxLongRunningQueries) {
    failures.push({
      code: "long_running_postgres_queries_active",
      message: "long-running Postgres query count exceeds the configured maximum",
      count: longQueries,
      max: options.maxLongRunningQueries
    });
  }

  const delta = meiliDelta(report);
  checks.meili_postgres_delta = delta;
  if (delta === null) {
    failures.push({ code: "meili_postgres_delta_undocumented", message: "Meili/Postgres delta is required" });
  } else if (delta !== 0) {
    failures.push({ code: "meili_postgres_delta_nonzero", message: "Meili/Postgres delta must be 0 before recovery writes", delta });
  }

  const backupPath = backupPathValue(report, options);
  checks.backup_path = backupPath || null;
  checks.backup_parent_exists = backupParentExists(report, options);
  if (!backupPath) {
    failures.push({ code: "backup_path_missing", message: "backup path for the future write must be documented" });
  } else if (!/[/\\]backups[/\\]/.test(backupPath)) {
    failures.push({ code: "backup_path_not_under_backups", message: "backup path must be under a backups directory", path: backupPath });
  } else if (!checks.backup_parent_exists) {
    failures.push({ code: "backup_parent_missing", message: "backup parent directory does not exist", path: path.dirname(backupPath) });
  }

  for (const warning of report.collection_warnings || []) warnings.push(warning);

  return {
    ok: failures.length === 0,
    unsafe: failures.length > 0,
    generated_at: new Date().toISOString(),
    checks,
    failures,
    warnings
  };
}

function selfTestReport() {
  return {
    production_checkout_commit: "abcdef1234567890",
    expected_commit: "abcdef1234567890",
    worker_state: "stopped",
    worker_isolated: false,
    autodeploy_timer_state: "inactive",
    autodeploy_recovery_safe: false,
    heavy_job_active: false,
    long_running_postgres_queries: 0,
    meili_postgres_delta: 0,
    backup_path: "/root/OpenJobSlots/backups/postgres-openjobslots-pre-lever-recovery-PENDING.dump",
    backup_parent_exists: true
  };
}

async function main() {
  const options = parseArgs();
  const report = options.selfTest
    ? selfTestReport()
    : (readJson(options.systemReport) || collectLocalSystemReport(options));
  const result = evaluatePreflight(report, options);
  writeJson(options.output, result);
  if (options.json || !result.ok) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    process.stdout.write("ATS recovery preflight passed\n");
  }
  if (!result.ok) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error?.stack || error);
    process.exit(1);
  });
}

module.exports = {
  collectLocalSystemReport,
  evaluatePreflight,
  parseArgs,
  selfTestReport
};
