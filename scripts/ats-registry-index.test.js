const assert = require("assert");

const {
  buildRegistryIndex,
  parseArgs
} = require("./ats-registry-index");

function testArgs() {
  const parsed = parseArgs(["--json", "--no-write", "--output-dir=tmp/ats-registry-targets"]);
  assert.equal(parsed.json, true);
  assert.equal(parsed.write, false);
  assert.equal(parsed.outputDir, "tmp/ats-registry-targets");
}

function testBuildRegistryIndex() {
  const payload = buildRegistryIndex({
    generatedAt: "2026-05-24T00:00:00.000Z"
  });
  assert.equal(payload.ok, true);
  assert.equal(payload.generated_at, "2026-05-24T00:00:00.000Z");
  assert.equal(payload.families.length, 7);
  assert.ok(payload.summary.configured_ats_count >= 60);
  assert.ok(payload.summary.future_candidate_count >= 20);

  const byKey = new Map(payload.targets.map((target) => [target.ats_key, target]));
  assert.equal(byKey.get("greenhouse").family, "direct-json-stable");
  assert.equal(byKey.get("greenhouse").registry_status, "pilot-enabled");
  assert.equal(byKey.get("greenhouse").source_module.path, "server/ingestion/sources/greenhouse/index.js");
  assert.equal(byKey.get("greenhouse").scripts.workbench, "npm.cmd run ats:workbench -- --source=greenhouse --json");
  assert.equal(byKey.get("greenhouse").scripts.dry_run, "npm.cmd run ats:source:dry-run -- --source=greenhouse --limit=10 --json");

  assert.equal(byKey.get("icims").family, "embedded-or-semi-structured");
  assert.equal(byKey.get("icims").registry_status, "pilot-enabled");

  assert.equal(byKey.get("dayforcehcm").family, "enterprise-direct");
  assert.equal(byKey.get("dayforcehcm").registry_status, "unsupported");

  assert.equal(byKey.get("personio").family, "future-candidate");
  assert.equal(byKey.get("paycomonline").family, "future-candidate");
  assert.equal(byKey.get("paycomonline").registry_status, "research-only");
}

function testFamilyTasks() {
  const payload = buildRegistryIndex({
    generatedAt: "2026-05-24T00:00:00.000Z"
  });
  const direct = payload.families.find((family) => family.family === "direct-json-stable");
  assert.ok(direct);
  assert.ok(direct.objective.includes("registry-backed"));
  assert.ok(direct.test_script.includes("directSourceModules.test.js"));

  const future = payload.families.find((family) => family.family === "future-candidate");
  assert.ok(future);
  assert.ok(future.objective.includes("research-only"));
  assert.ok(future.targets.some((target) => target.ats_key === "paycor"));
}

function main() {
  testArgs();
  testBuildRegistryIndex();
  testFamilyTasks();
  console.log("ats-registry-index tests passed");
}

if (require.main === module) {
  main();
}
