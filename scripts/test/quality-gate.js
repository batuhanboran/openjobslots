const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const repoRoot = path.resolve(__dirname, "..", "..");
const packagePath = path.join(repoRoot, "package.json");
const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"));
const availableScripts = packageJson.scripts || {};

const requestedOnly = new Set();
let includeE2e = true;

for (const arg of process.argv.slice(2)) {
  if (arg === "--skip-e2e") includeE2e = false;
  if (arg.startsWith("--only=")) {
    for (const item of arg.slice("--only=".length).split(",")) {
      const trimmed = item.trim();
      if (trimmed) requestedOnly.add(trimmed);
    }
  }
}

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const preferredTestRoot = process.env.OPENJOBSLOTS_QUALITY_GATE_ROOT || "C:\\tmp\\openjobslots-quality-gate";
const fallbackTestRoot = path.join(repoRoot, ".tmp", "openjobslots-quality-gate");
let testRoot = preferredTestRoot;
let testDbPath = process.env.OPENJOBSLOTS_QUALITY_GATE_DB_PATH || path.join(testRoot, "jobs.db");

const orderedCandidates = [
  { key: "backend", script: "test:backend" },
  { key: "api", script: "test:api" },
  { key: "parser", script: "test:parsers" },
  { key: "e2e", script: "test:e2e", e2e: true }
];

const productionDbCandidates = [
  path.join(repoRoot, "jobs.db"),
  path.join(repoRoot, "jobs.db-wal"),
  path.join(repoRoot, "jobs.db-shm"),
  path.join(repoRoot, "data", "jobs.db"),
  path.join(repoRoot, "data", "jobs.db-wal"),
  path.join(repoRoot, "data", "jobs.db-shm")
];

function snapshotFiles(paths) {
  const snapshot = new Map();
  for (const filePath of paths) {
    if (!fs.existsSync(filePath)) {
      snapshot.set(filePath, null);
      continue;
    }
    const stat = fs.statSync(filePath);
    snapshot.set(filePath, {
      size: stat.size,
      mtimeMs: stat.mtimeMs
    });
  }
  return snapshot;
}

function changedFiles(before, paths) {
  const changed = [];
  for (const filePath of paths) {
    const previous = before.get(filePath);
    const current = fs.existsSync(filePath)
      ? (() => {
          const stat = fs.statSync(filePath);
          return { size: stat.size, mtimeMs: stat.mtimeMs };
        })()
      : null;
    if (JSON.stringify(previous) !== JSON.stringify(current)) {
      changed.push(path.relative(repoRoot, filePath) || filePath);
    }
  }
  return changed;
}

function selectScripts() {
  return orderedCandidates.filter((candidate) => {
    if (candidate.e2e && !includeE2e) return false;
    if (requestedOnly.size > 0 && !requestedOnly.has(candidate.key) && !requestedOnly.has(candidate.script)) return false;
    return Boolean(availableScripts[candidate.script]);
  });
}

function runNpmScript(scriptName) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const command = process.platform === "win32" ? "cmd.exe" : npmCommand;
    const args = process.platform === "win32" ? ["/d", "/s", "/c", `${npmCommand} run ${scriptName}`] : ["run", scriptName];
    const child = spawn(command, args, {
      cwd: repoRoot,
      stdio: "inherit",
      windowsHide: true,
      env: {
        ...process.env,
        CI: "1",
        BROWSER: "none",
        NODE_ENV: "test",
        DB_PATH: testDbPath,
        OPENJOBSLOTS_TEST_ROOT: testRoot,
        OPENJOBSLOTS_E2E_API_PORT: process.env.OPENJOBSLOTS_E2E_API_PORT || "18877",
        OPENJOBSLOTS_E2E_WEB_PORT: process.env.OPENJOBSLOTS_E2E_WEB_PORT || "19076",
        OPENJOBSLOTS_E2E_BASE_URL:
          process.env.OPENJOBSLOTS_E2E_BASE_URL ||
          `http://127.0.0.1:${process.env.OPENJOBSLOTS_E2E_WEB_PORT || "19076"}`,
        OPENJOBSLOTS_API_BASE_URL:
          process.env.OPENJOBSLOTS_API_BASE_URL ||
          `http://127.0.0.1:${process.env.OPENJOBSLOTS_E2E_API_PORT || "18877"}`,
        OPENJOBSLOTS_DISABLE_API_SCHEDULER: "1",
        OPENJOBSLOTS_AUTO_SYNC: "0",
        OPENJOBSLOTS_DB_BACKEND: "sqlite",
        OPENJOBSLOTS_SEARCH_BACKEND: "sqlite",
        OPENJOBSLOTS_QUEUE_BACKEND: "sqlite-worker",
        OPENJOBSLOTS_ADMIN_TOKEN: "openjobslots-quality-gate-admin-token",
        OPENJOBSLOTS_ALLOW_LOCAL_ADMIN: "0",
        DATABASE_URL: "",
        MEILI_HOST: "",
        MEILI_MASTER_KEY: "",
        MEILI_API_KEY: ""
      }
    });

    child.on("close", (code, signal) => {
      resolve({
        script: scriptName,
        ok: code === 0,
        code,
        signal,
        durationMs: Date.now() - startedAt
      });
    });
  });
}

function formatDuration(ms) {
  return `${(ms / 1000).toFixed(1)}s`;
}

function ensureTestRoot() {
  try {
    fs.mkdirSync(testRoot, { recursive: true });
  } catch (error) {
    if (process.env.OPENJOBSLOTS_QUALITY_GATE_ROOT || process.env.OPENJOBSLOTS_QUALITY_GATE_DB_PATH) {
      throw error;
    }
    testRoot = fallbackTestRoot;
    testDbPath = path.join(testRoot, "jobs.db");
    fs.mkdirSync(testRoot, { recursive: true });
    console.warn(`Unable to use ${preferredTestRoot}; using isolated fallback ${testRoot}`);
  }
}

async function main() {
  const scripts = selectScripts();
  ensureTestRoot();
  console.log("OpenJobSlots quality gate");
  console.log(`Discovered npm scripts: ${Object.keys(availableScripts).sort().join(", ")}`);
  console.log(`Selected safe scripts: ${scripts.map((item) => item.script).join(", ") || "(none)"}`);
  console.log(`Isolated DB_PATH: ${testDbPath}`);
  console.log("Production DB snapshots will be checked after the run.");

  if (scripts.length === 0) {
    console.log("No matching test scripts found. Nothing to run.");
    return;
  }
  const productionSnapshot = snapshotFiles(productionDbCandidates);
  const results = [];

  for (const candidate of scripts) {
    console.log(`\n=== npm run ${candidate.script} ===`);
    const result = await runNpmScript(candidate.script);
    results.push(result);
    if (!result.ok) {
      console.error(`npm run ${candidate.script} failed with ${result.signal || result.code}`);
      break;
    }
  }

  const mutatedProductionFiles = changedFiles(productionSnapshot, productionDbCandidates);
  console.log("\nQuality gate summary:");
  for (const result of results) {
    console.log(
      `- ${result.ok ? "PASS" : "FAIL"} ${result.script} (${formatDuration(result.durationMs)})${
        result.signal ? ` signal=${result.signal}` : ""
      }`
    );
  }
  if (mutatedProductionFiles.length === 0) {
    console.log("- PASS production DB files unchanged");
  } else {
    console.log(`- FAIL production DB files changed: ${mutatedProductionFiles.join(", ")}`);
  }

  const failed = results.some((result) => !result.ok) || mutatedProductionFiles.length > 0;
  if (failed) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
