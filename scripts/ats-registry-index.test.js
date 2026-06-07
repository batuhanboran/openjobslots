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
  assert.equal(byKey.get("greenhouse").registry_status, "registry-backed-enabled");
  assert.equal(byKey.get("greenhouse").source_module.path, "server/ingestion/sources/greenhouse/index.js");
  assert.equal(byKey.get("greenhouse").recovery_readiness.status, "ready-for-read-only-recovery");
  assert.equal(byKey.get("greenhouse").scripts.workbench, "npm.cmd run ats:workbench -- --source=greenhouse --json");
  assert.equal(byKey.get("greenhouse").scripts.dry_run, "npm.cmd run ats:source:dry-run -- --source=greenhouse --limit=10 --json");
  assert.ok(byKey.get("greenhouse").scripts.inventory_scan.includes("ats:inventory:scan"));
  assert.ok(byKey.get("greenhouse").scripts.source_canary.includes("ats:source:canary"));
  assert.ok(byKey.get("greenhouse").scripts.source_canary.includes("--planned-batch=<planned_batch_report>"));
  assert.ok(byKey.get("greenhouse").scripts.source_canary.includes("--preflight-max-age-minutes=60"));
  assert.ok(byKey.get("greenhouse").scripts.source_apply.includes("--max-updates=<safe_max_updates>"));
  assert.ok(byKey.get("greenhouse").scripts.recovery_guard.includes("ats:recovery:guard"));
  assert.ok(byKey.get("greenhouse").scripts.recovery_guard.includes("--output=<guard_report>"));
  assert.ok(byKey.get("greenhouse").scripts.release_check.includes("--before=<before_data_quality>"));
  assert.ok(byKey.get("greenhouse").scripts.release_check.includes("--tests-report=<tests_report>"));
  assert.ok(byKey.get("greenhouse").scripts.release_check.includes("--preflight-report=<fresh_preflight_report>"));
  assert.ok(byKey.get("greenhouse").scripts.parity_check.includes("search:reindex:check"));

  assert.equal(byKey.get("icims").family, "embedded-or-semi-structured");
  assert.equal(byKey.get("icims").registry_status, "registry-backed-enabled");

  assert.equal(byKey.get("dayforcehcm").family, "enterprise-direct");
  assert.equal(byKey.get("dayforcehcm").registry_status, "registry-backed-canary");
  assert.equal(byKey.get("dayforcehcm").recovery_readiness.status, "ready-for-read-only-recovery");
  assert.deepEqual(byKey.get("dayforcehcm").recovery_readiness.blockers, []);

  assert.equal(byKey.get("zoho").registry_status, "registry-backed-canary");
  assert.equal(byKey.get("peopleforce").registry_status, "registry-backed-disabled");
  assert.equal(byKey.get("peopleforce").recovery_readiness.status, "ready-for-read-only-recovery");
  assert.equal(byKey.get("policeapp").recovery_readiness.status, "ready-for-read-only-recovery");
  assert.equal(byKey.get("sagehr").recovery_readiness.status, "ready-for-read-only-recovery");
  assert.equal(byKey.get("saphrcloud").recovery_readiness.status, "ready-for-read-only-recovery");
  assert.equal(byKey.get("talexio").recovery_readiness.status, "ready-for-read-only-recovery");

  assert.equal(byKey.get("personio").family, "direct-json-stable");
  assert.equal(byKey.get("personio").registry_status, "registry-backed-canary");
  assert.equal(byKey.get("personio").recovery_readiness.status, "ready-for-read-only-recovery");
  assert.equal(byKey.get("workable").family, "direct-json-stable");
  assert.equal(byKey.get("workable").registry_status, "registry-backed-canary");
  assert.equal(byKey.get("workable").recovery_readiness.status, "ready-for-read-only-recovery");
  assert.equal(byKey.get("paycomonline").family, "future-candidate");
  assert.equal(byKey.get("paycomonline").registry_status, "research-only");
  assert.equal(byKey.get("paycomonline").recovery_readiness.status, "research-only");
  assert.ok(byKey.get("paycomonline").scripts.source_canary.includes("not available"));
  assert.ok(payload.summary.read_only_recovery_ready_count >= 60);
  assert.deepEqual(
    payload.summary.recovery_readiness_blockers
      .filter((item) => item.status === "blocked")
      .map((item) => item.ats_key),
    []
  );
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
