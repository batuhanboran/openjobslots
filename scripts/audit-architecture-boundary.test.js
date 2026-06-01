const { execFileSync } = require("child_process");
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");

function runAudit(env = {}) {
  return execFileSync("node", ["scripts/audit-architecture-boundary.js", "--json"], {
    cwd: ROOT,
    env: { ...process.env, ...env },
    encoding: "utf8"
  });
}

test("architecture boundary reports ingestion orchestration line budgets", () => {
  const result = JSON.parse(runAudit());
  assert.equal(result.ok, true);
  assert.ok(Array.isArray(result.ingestion_orchestration_line_counts));
  const byFile = new Map(result.ingestion_orchestration_line_counts.map((entry) => [entry.file, entry]));
  for (const file of [
    "server/ingestion/sourceCollectors.js",
    "server/ingestion/sourceDiscovery.js",
    "server/ingestion/sources/common.js",
    "server/ingestion/sourceRegistry.js"
  ]) {
    const entry = byFile.get(file);
    assert.ok(entry, `expected line budget entry for ${file}`);
    assert.ok(entry.lines > 0, `expected positive line count for ${file}`);
    assert.ok(entry.lines <= entry.cap, `expected ${file} to stay within its cap`);
  }
  assert.equal(result.source_local_module_dir_count, 60);
  assert.equal(result.direct_source_ats_key_count, result.source_local_module_dir_count);
  assert.deepEqual(result.source_local_registration_missing, []);
  assert.deepEqual(result.source_local_registration_extra, []);
});

test("architecture boundary fails when a source orchestration cap is exceeded", () => {
  assert.throws(
    () => runAudit({ OPENJOBSLOTS_SOURCE_COMMON_LINE_CAP: "1" }),
    (error) => {
      const result = JSON.parse(error.stdout);
      assert.equal(result.ok, false);
      assert.match(result.failures.join("\n"), /ingestion orchestration files exceed line caps/);
      return true;
    }
  );
});
