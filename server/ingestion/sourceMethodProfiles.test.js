const assert = require("node:assert/strict");

const {
  getMethodExperimentSources,
  getSourceMethodProfile,
  listSourceMethodProfiles
} = require("./sourceMethodProfiles");

function testProfilesExposePhaseTwoSources() {
  const sources = getMethodExperimentSources();
  assert.ok(sources.includes("teamtailor"));
  assert.ok(sources.includes("icims"));
  assert.ok(sources.includes("applitrack"));
  assert.ok(sources.includes("oracle"));
  assert.ok(sources.includes("workday"));
  assert.ok(sources.includes("greenhouse"));
  assert.ok(sources.includes("lever"));
  assert.ok(sources.includes("applytojob"));
  assert.ok(sources.includes("breezy"));
}

function testTeamtailorProfile() {
  const profile = getSourceMethodProfile("TeamTailor");
  assert.equal(profile.ats_key, "teamtailor");
  assert.equal(profile.truth_boundary, "deterministic-parser-fixture");
  assert.equal(profile.methods.some((method) => method.kind === "direct_or_stable_endpoint_research"), true);
  assert.equal(profile.methods.some((method) => method.kind === "fixture_backed_html"), true);
  assert.equal(profile.phase_targets.includes("phase_2"), true);
}

function testDetailRepairProfiles() {
  const icims = getSourceMethodProfile("icims");
  assert.equal(icims.methods.some((method) => method.kind === "bounded_detail_html"), true);
  assert.equal(icims.detail_evidence_allowed, true);

  const applitrack = getSourceMethodProfile("applitrack");
  assert.equal(applitrack.methods.some((method) => method.kind === "bounded_detail_html"), true);
  assert.equal(applitrack.detail_evidence_allowed, true);
}

function testListReturnsSortedProfiles() {
  const profiles = listSourceMethodProfiles();
  const keys = profiles.map((profile) => profile.ats_key);
  assert.deepEqual(keys, keys.slice().sort());
}

function main() {
  testProfilesExposePhaseTwoSources();
  testTeamtailorProfile();
  testDetailRepairProfiles();
  testListReturnsSortedProfiles();
  console.log("sourceMethodProfiles tests passed");
}

if (require.main === module) {
  main();
}
