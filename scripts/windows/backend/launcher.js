const fs = require("fs");
const http = require("http");
const path = require("path");
const { spawn } = require("child_process");

const installBackendRoot = __dirname;
const localAppDataRoot = process.env.LOCALAPPDATA || process.env.APPDATA || installBackendRoot;
const dataRoot = path.join(localAppDataRoot, "OpenJobSlots", "backend");
const nodePath = path.join(installBackendRoot, "node", "node.exe");
const serverScriptPath = path.join(installBackendRoot, "server", "index.js");
const trayScriptPath = path.join(installBackendRoot, "backend-tray.ps1");
const trayLaunchScriptPath = path.join(installBackendRoot, "launch-tray.vbs");
const installedSeedDatabasePath = path.join(installBackendRoot, "jobs.db");
const databasePath = path.join(dataRoot, "jobs.db");
const pidFilePath = path.join(dataRoot, "backend.pid");
const trayPidFilePath = path.join(dataRoot, "tray.pid");
const mcpScriptPath = path.join(installBackendRoot, "..", "mcp", "mcp-apply-server.js");
const mcpPidFilePath = path.join(dataRoot, "ai-engine.pid");
const logDirectoryPath = path.join(dataRoot, "logs");
const stdoutLogPath = path.join(logDirectoryPath, "backend.out.log");
const stderrLogPath = path.join(logDirectoryPath, "backend.err.log");
const mcpStdoutLogPath = path.join(logDirectoryPath, "ai-engine.out.log");
const mcpStderrLogPath = path.join(logDirectoryPath, "ai-engine.err.log");
const backendNodeModulesPath = path.join(installBackendRoot, "node_modules");
const trayDebugLogPath = path.join(logDirectoryPath, "tray-launcher.log");
const wscriptPath =
  process.env.SystemRoot && process.env.SystemRoot.length > 0
    ? path.join(process.env.SystemRoot, "System32", "wscript.exe")
    : "wscript.exe";
const serverPort = Number(process.env.OPENJOBSLOTS_BACKEND_PORT || process.env.PORT || 8787);
const healthCheckTimeoutMs = 1500;
const skipTrayStart = process.argv.some((argument) => {
  const normalizedArgument = String(argument || "").toLowerCase();
  return normalizedArgument === "--skip-tray" || normalizedArgument === "--no-tray";
});
const disableTrayByDefault = false;

function fileExists(filePath) {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function readExistingPid(targetPidFilePath) {
  try {
    const raw = fs.readFileSync(targetPidFilePath, "utf8").trim();
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

function appendTrayLauncherLog(message) {
  try {
    const timestamp = new Date().toISOString();
    fs.appendFileSync(trayDebugLogPath, `[${timestamp}] ${message}\n`, "utf8");
  } catch {
    // Best effort logging only.
  }
}

function startDetachedNodeProcess(entryScriptPath, outputLogPath, errorLogPath, pidPath, extraEnv = {}) {
  const stdoutFd = fs.openSync(outputLogPath, "a");
  const stderrFd = fs.openSync(errorLogPath, "a");

  try {
    const child = spawn(nodePath, [entryScriptPath], {
      cwd: path.dirname(entryScriptPath),
      detached: true,
      windowsHide: true,
      stdio: ["ignore", stdoutFd, stderrFd],
      env: {
        ...process.env,
        ...extraEnv
      }
    });

    child.unref();
    fs.writeFileSync(pidPath, `${child.pid}\n`, "utf8");
  } finally {
    fs.closeSync(stdoutFd);
    fs.closeSync(stderrFd);
  }
}

function ensureBackendRunning() {
  const existingBackendPid = readExistingPid(pidFilePath);
  if (isPidRunning(existingBackendPid)) {
    return;
  }

  startDetachedNodeProcess(serverScriptPath, stdoutLogPath, stderrLogPath, pidFilePath, {
    PORT: String(serverPort),
    DB_PATH: databasePath
  });
}

function ensureMcpRunning() {
  if (!fileExists(mcpScriptPath)) {
    return;
  }

  const existingMcpPid = readExistingPid(mcpPidFilePath);
  if (isPidRunning(existingMcpPid)) {
    return;
  }

  const mcpEnv = {
    DB_PATH: databasePath
  };
  if (fs.existsSync(backendNodeModulesPath)) {
    mcpEnv.NODE_PATH = backendNodeModulesPath;
  }

  startDetachedNodeProcess(
    mcpScriptPath,
    mcpStdoutLogPath,
    mcpStderrLogPath,
    mcpPidFilePath,
    mcpEnv
  );
}

function ensureTrayRunning() {
  if (!fileExists(trayScriptPath) || !fileExists(trayLaunchScriptPath)) {
    return;
  }

  const existingTrayPid = readExistingPid(trayPidFilePath);
  if (isPidRunning(existingTrayPid)) {
    appendTrayLauncherLog(`Tray already running with PID ${existingTrayPid}; skipping launch.`);
    return;
  }

  if (!fileExists(wscriptPath)) {
    return;
  }

  appendTrayLauncherLog(`Launching tray via ${wscriptPath} args=${JSON.stringify([trayLaunchScriptPath])}`);

  const child = spawn(wscriptPath, [trayLaunchScriptPath], {
    cwd: path.dirname(trayScriptPath),
    detached: true,
    windowsHide: true,
    stdio: "ignore"
  });
  child.unref();
  appendTrayLauncherLog(`Spawned tray launcher PID ${child.pid}.`);
}

async function main() {
  if (!fileExists(nodePath) || !fileExists(serverScriptPath)) {
    return;
  }

  ensureWritableRuntimeFiles();

  if (!(await isBackendHealthy())) {
    ensureBackendRunning();
  }
  if (!disableTrayByDefault && !skipTrayStart) {
    ensureTrayRunning();
  }
  ensureMcpRunning();
}

main().catch(() => {
  // Best-effort launcher: avoid surfacing errors to end users.
});
