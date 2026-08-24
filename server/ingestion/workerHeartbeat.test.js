const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  checkWorkerHeartbeat,
  writeWorkerHeartbeat
} = require("./workerHeartbeat");

test("worker heartbeat health distinguishes fresh, stale, and missing state", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ojs-worker-heartbeat-"));
  const heartbeatPath = path.join(directory, "heartbeat.json");
  try {
    assert.deepEqual(checkWorkerHeartbeat({ heartbeatPath, nowMs: 1000, maxAgeMs: 1000 }), {
      ok: false,
      reason: "missing"
    });
    writeWorkerHeartbeat({ heartbeatPath, nowMs: 1000, pid: 42 });
    assert.deepEqual(checkWorkerHeartbeat({ heartbeatPath, nowMs: 1200, maxAgeMs: 1000 }), {
      ok: true,
      ageMs: 200,
      pid: 42
    });
    assert.deepEqual(checkWorkerHeartbeat({ heartbeatPath, nowMs: 2200, maxAgeMs: 1000 }), {
      ok: false,
      reason: "stale",
      ageMs: 1200,
      pid: 42
    });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
