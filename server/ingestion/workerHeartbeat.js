const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_WORKER_HEARTBEAT_PATH = "/tmp/openjobslots-worker-heartbeat.json";

function resolveWorkerHeartbeatPath(env = process.env) {
  return String(env.OPENJOBSLOTS_WORKER_HEARTBEAT_PATH || DEFAULT_WORKER_HEARTBEAT_PATH).trim();
}

function writeWorkerHeartbeat(options = {}) {
  const heartbeatPath = options.heartbeatPath || resolveWorkerHeartbeatPath();
  const nowMs = Number(options.nowMs ?? Date.now());
  const payload = {
    timestamp_ms: nowMs,
    pid: Number(options.pid ?? process.pid)
  };
  fs.mkdirSync(path.dirname(heartbeatPath), { recursive: true });
  fs.writeFileSync(heartbeatPath, `${JSON.stringify(payload)}\n`, "utf8");
  return payload;
}

function checkWorkerHeartbeat(options = {}) {
  const heartbeatPath = options.heartbeatPath || resolveWorkerHeartbeatPath();
  if (!fs.existsSync(heartbeatPath)) return { ok: false, reason: "missing" };
  try {
    const payload = JSON.parse(fs.readFileSync(heartbeatPath, "utf8"));
    const nowMs = Number(options.nowMs ?? Date.now());
    const maxAgeMs = Math.max(1000, Number(options.maxAgeMs || 180000));
    const ageMs = Math.max(0, nowMs - Number(payload.timestamp_ms || 0));
    const result = { ageMs, pid: Number(payload.pid || 0) };
    return ageMs <= maxAgeMs
      ? { ok: true, ...result }
      : { ok: false, reason: "stale", ...result };
  } catch {
    return { ok: false, reason: "invalid" };
  }
}

function startWorkerHeartbeat(options = {}) {
  const heartbeatPath = options.heartbeatPath || resolveWorkerHeartbeatPath();
  const intervalMs = Math.max(1000, Number(options.intervalMs || 30000));
  const beat = () => writeWorkerHeartbeat({ heartbeatPath });
  beat();
  const timer = setInterval(beat, intervalMs);
  timer.unref();
  return {
    heartbeatPath,
    stop() {
      clearInterval(timer);
    }
  };
}

module.exports = {
  DEFAULT_WORKER_HEARTBEAT_PATH,
  checkWorkerHeartbeat,
  resolveWorkerHeartbeatPath,
  startWorkerHeartbeat,
  writeWorkerHeartbeat
};
