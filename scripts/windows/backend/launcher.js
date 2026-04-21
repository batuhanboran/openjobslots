const fs = require("fs");
const http = require("http");
const path = require("path");
const { spawn } = require("child_process");

const installBackendRoot = __dirname;
const localAppDataRoot = process.env.LOCALAPPDATA || process.env.APPDATA || installBackendRoot;
const dataRoot = path.join(localAppDataRoot, "OpenJobSlots", "backend");
const nodePath = path.join(installBackendRoot, "node", "node.exe");
const serverScriptPath = path.join(installBackendRoot, "server", "index.js");
const installedSeedDatabasePath = path.join(installBackendRoot, "jobs.db");
const databasePath = path.join(dataRoot, "jobs.db");
const pidFilePath = path.join(dataRoot, "backend.pid");
const logDirectoryPath = path.join(dataRoot, "logs");
const stdoutLogPath = path.join(logDirectoryPath, "backend.out.log");
const stderrLogPath = path.join(logDirectoryPath, "backend.err.log");
const serverPort = Number(process.env.OPENJOBSLOTS_BACKEND_PORT || process.env.PORT || 8787);
const healthCheckTimeoutMs = 1500;

function fileExists(filePath) {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function readExistingPid() {
  try {
    const raw = fs.readFileSync(pidFilePath, "utf8").trim();
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  } catch {
    return 0;
  }
}

function isPidRunning(pid) {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function isBackendHealthy() {
  return new Promise((resolve) => {
    const request = http.get(
      {
        hostname: "127.0.0.1",
        port: serverPort,
        path: "/health",
        timeout: healthCheckTimeoutMs
      },
      (response) => {
        response.resume();
        resolve(response.statusCode === 200);
      }
    );

    request.on("timeout", () => {
      request.destroy();
      resolve(false);
    });

    request.on("error", () => {
      resolve(false);
    });
  });
}

function ensureWritableRuntimeFiles() {
  fs.mkdirSync(dataRoot, { recursive: true });
  fs.mkdirSync(logDirectoryPath, { recursive: true });

  if (!fileExists(databasePath) && fileExists(installedSeedDatabasePath)) {
    fs.copyFileSync(installedSeedDatabasePath, databasePath);
  }
}

async function main() {
  if (!fileExists(nodePath) || !fileExists(serverScriptPath)) {
    return;
  }

  ensureWritableRuntimeFiles();

  if (await isBackendHealthy()) {
    return;
  }

  const existingPid = readExistingPid();
  if (isPidRunning(existingPid)) {
    return;
  }

  const stdoutFd = fs.openSync(stdoutLogPath, "a");
  const stderrFd = fs.openSync(stderrLogPath, "a");

  try {
    const child = spawn(nodePath, [serverScriptPath], {
      cwd: path.dirname(serverScriptPath),
      detached: true,
      windowsHide: true,
      stdio: ["ignore", stdoutFd, stderrFd],
      env: {
        ...process.env,
        PORT: String(serverPort),
        DB_PATH: databasePath
      }
    });

    child.unref();
    fs.writeFileSync(pidFilePath, `${child.pid}\n`, "utf8");
  } finally {
    fs.closeSync(stdoutFd);
    fs.closeSync(stderrFd);
  }
}

main().catch(() => {
  // Best-effort launcher: avoid surfacing errors to end users.
});
