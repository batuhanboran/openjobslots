const assert = require("assert");

const {
  buildExternalMethodMap,
  parseArgs,
  validateExternalMethodMap
} = require("./report-ats-external-method-map");

function byKey(rows) {
  return new Map(rows.map((row) => [row.ats_key, row]));
}

function byName(rows) {
  return new Map(rows.map((row) => [row.name, row]));
}

function testArgs() {
  const parsed = parseArgs([
    "--json",
    "--map=docs/reference/ats-external-method-map.json"
  ]);
  assert.equal(parsed.json, true);
  assert.equal(parsed.mapPath, "docs/reference/ats-external-method-map.json");
}

function testBuildExternalMethodMap() {
  const payload = buildExternalMethodMap({
    now: "2026-05-29T12:00:00.000Z"
  });
  assert.equal(payload.ok, true);
  assert.equal(payload.snapshot_date, "2026-05-29");
  assert.equal(payload.phases.length, 4);
  assert.ok(payload.repositories.length >= 7);
  assert.ok(payload.targets.length >= 12);

  const repos = byName(payload.repositories);
  assert.equal(repos.get("firecrawl/firecrawl").integration_role, "evidence-provider");
  assert.match(repos.get("firecrawl/firecrawl").boundary, /evidence only/i);
  assert.equal(repos.get("apify/crawlee").integration_role, "rendered-fetch-sidecar");
  assert.equal(repos.get("kalil0321/ats-scrapers").integration_role, "ats-method-reference");

  const targets = byKey(payload.targets);
  assert.equal(targets.get("teamtailor").target_type, "existing-source-method-repair");
  assert.equal(targets.get("teamtailor").internal_source_module, "server/ingestion/sources/teamtailor");
  assert.match(targets.get("teamtailor").recommended_action, /RSS/i);

  assert.equal(targets.get("icims").target_type, "existing-detail-evidence-repair");
  assert.match(targets.get("icims").recommended_action, /detail/i);
  assert.equal(targets.get("applitrack").target_type, "existing-detail-evidence-repair");

  assert.equal(targets.get("personio").target_type, "expansion-candidate");
  assert.match(targets.get("personio").recommended_action, /XML/i);
  assert.equal(targets.get("recruiterbox").target_type, "expansion-candidate");
  assert.equal(targets.get("workable").target_type, "expansion-candidate");

  assert.ok(payload.phase_targets.phase_1.includes("teamtailor"));
  assert.ok(payload.phase_targets.phase_2.includes("teamtailor"));
  assert.ok(payload.phase_targets.phase_3.includes("personio"));
  assert.ok(payload.phase_targets.phase_4.includes("crawlee-sidecar"));
}

function testValidation() {
  const payload = buildExternalMethodMap({
    now: "2026-05-29T12:00:00.000Z"
  });
  const result = validateExternalMethodMap(payload);
  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
}

function main() {
  testArgs();
  testBuildExternalMethodMap();
  testValidation();
  console.log("ats-external-method-map tests passed");
}

if (require.main === module) {
  main();
}
