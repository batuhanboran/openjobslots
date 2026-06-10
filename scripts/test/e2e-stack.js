const { spawn } = require("child_process");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..", "..");
const apiPort = process.env.OPENJOBSLOTS_E2E_API_PORT || "8877";
const webPort = process.env.OPENJOBSLOTS_E2E_WEB_PORT || "19006";
const testDbPath = process.env.DB_PATH || path.join(repoRoot, ".tmp", "openjobslots-test", "jobs.db");
const usePublicApiProxy = process.env.OPENJOBSLOTS_E2E_PUBLIC_API_PROXY === "1";

const children = [];

function spawnChild(command, args, env) {
  const child = spawn(command, args, {
    cwd: repoRoot,
    env: {
      ...process.env,
      ...env
    },
    stdio: "inherit",
    windowsHide: true
  });
  children.push(child);
  child.on("exit", (code, signal) => {
    if (signal) return;
    if (code && !shuttingDown) {
      console.error(`${command} ${args.join(" ")} exited with code ${code}`);
      shutdown(code);
    }
  });
  return child;
}

let shuttingDown = false;

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) {
      child.kill();
    }
  }
  setTimeout(() => process.exit(code), 500).unref();
}

async function main() {
  if (usePublicApiProxy) {
    spawnChild(process.execPath, ["scripts/test/public-api-proxy.js"], {
      PORT: apiPort
    });
  } else {
    await new Promise((resolve, reject) => {
      const setup = spawnChild(process.execPath, ["scripts/test/setup-e2e-db.js"], { DB_PATH: testDbPath });
      setup.once("exit", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`test:e2e:db exited with code ${code}`));
      });
    });

    spawnChild(process.execPath, ["server/index.js"], {
      DB_PATH: testDbPath,
      PORT: apiPort,
      OPENJOBSLOTS_DISABLE_API_SCHEDULER: "1",
      OPENJOBSLOTS_ADMIN_TOKEN: process.env.OPENJOBSLOTS_E2E_ADMIN_TOKEN || "openjobslots-e2e-admin-token",
      OPENJOBSLOTS_ALLOW_LOCAL_ADMIN: "0"
    });
  }

  spawnChild(process.execPath, ["node_modules/expo/bin/cli", "start", "--web", "--port", webPort], {
    EXPO_PUBLIC_API_BASE_URL: `http://127.0.0.1:${apiPort}`,
    EXPO_PUBLIC_E2E: "1",
    BROWSER: "none",
    CI: "1"
  });
}

process.on("SIGINT", () => shutdown(130));
process.on("SIGTERM", () => shutdown(143));

main().catch((error) => {
  console.error(error);
  shutdown(1);
});
