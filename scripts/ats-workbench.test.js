const assert = require("assert");
const {
  buildWorkbench,
  easiestImprovementScore,
  parseArgs,
  tierToSourceFamily
} = require("./ats-workbench");

function testArgs() {
  const parsed = parseArgs(["--source=Greenhouse", "--json", "--no-write", "--output-dir=tmp/workbench"]);
  assert.equal(parsed.source, "greenhouse");
  assert.equal(parsed.json, true);
  assert.equal(parsed.write, false);
  assert.equal(parsed.outputDir, "tmp/workbench");
}

function testSourceFamilyMapping() {
  assert.equal(tierToSourceFamily("direct-json-stable", "greenhouse"), "direct_json");
  assert.equal(tierToSourceFamily("embedded-or-semi-structured", "zoho"), "embedded_json");
  assert.equal(tierToSourceFamily("embedded-or-semi-structured", "icims"), "html_detail");
  assert.equal(tierToSourceFamily("public-sector-education", "applitrack"), "public_sector");
  assert.equal(tierToSourceFamily("brittle-high-risk", "taleo"), "brittle");
}

function testBuildSingleSourceWorkbench() {
  const payload = buildWorkbench({
    source: "greenhouse",
    json: true,
    outputDir: "docs/reference/ats-workbench",
    scoreboardPath: "docs/reference/ats-workbench/scoreboard.json",
    write: false
  });
  assert.equal(payload.ok, true);
  assert.equal(payload.sources.length, 1);
  const greenhouse = payload.sources[0];
  assert.equal(greenhouse.ats_key, "greenhouse");
  assert.equal(greenhouse.source_family, "direct_json");
  assert.equal(greenhouse.current_status, "certified");
  assert.equal(greenhouse.public_enabled, true);
  assert.match(greenhouse.official_public_docs_or_observed_endpoint, /greenhouse/i);
  assert.match(greenhouse.canonical_url_rule, /absolute_url|source canonical/i);
  assert.ok(greenhouse.parser_fixtures.files.some((file) => file.includes("greenhouse")));
  assert.equal(greenhouse.runner_interface.writeQuarantine.includes("quarantine"), true);
}

function testBuildFullIndex() {
  const payload = buildWorkbench({
    source: "",
    json: true,
    outputDir: "docs/reference/ats-workbench",
    scoreboardPath: "docs/reference/ats-workbench/scoreboard.json",
    write: false
  });
  assert.equal(payload.ok, true);
  assert.equal(payload.sources.length, 62);
  assert.equal(payload.summary.ats_count, 62);
  assert.ok(payload.summary.public_enabled_sources.includes("greenhouse"));
  assert.ok(payload.summary.quarantine_or_disabled_sources.some((row) => row.ats_key === "dayforcehcm"));
  assert.ok(payload.summary.quarantine_or_disabled_sources.some((row) => row.ats_key === "personio"));
  assert.ok(payload.summary.quarantine_or_disabled_sources.some((row) => row.ats_key === "workable"));
  assert.equal(payload.summary.fixture_gaps.some((row) => row.ats_key === "teamtailor"), false);
  const teamtailor = payload.sources.find((row) => row.ats_key === "teamtailor");
  assert.equal(teamtailor.current_status, "certified");
  assert.equal(teamtailor.source_module.registry_status, "disabled");
  assert.equal(teamtailor.public_enabled_recommendation, true);
  assert.equal(teamtailor.public_enabled, false);
  assert.ok(payload.summary.quarantine_or_disabled_sources.some((row) =>
    row.ats_key === "teamtailor" &&
    row.public_enabled_recommendation === true &&
    row.registry_status === "disabled"
  ));
  assert.ok(payload.summary.top_15_quality_risk.length > 0);
  assert.ok(payload.summary.top_15_easiest_expected_improvement.length > 0);
}

function testImprovementScore() {
  const score = easiestImprovementScore({
    current_status: "certified",
    should_be_public_enabled: true,
    current_production_row_count: 1000,
    missing_any_geo_pct: 50,
    weak_remote_pct: 10
  });
  assert.ok(score > 0);
}

function main() {
  testArgs();
  testSourceFamilyMapping();
  testBuildSingleSourceWorkbench();
  testBuildFullIndex();
  testImprovementScore();
  console.log("ats-workbench tests passed");
}

if (require.main === module) {
  main();
}
