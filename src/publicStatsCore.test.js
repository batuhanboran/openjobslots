const assert = require("assert");

const {
  buildPublicStatsChips,
  formatExactNumberLabel
} = require("./publicStatsCore");

function testFormatsExactNumbers() {
  assert.equal(formatExactNumberLabel(157355), "157,355");
  assert.equal(formatExactNumberLabel("8076"), "8,076");
  assert.equal(formatExactNumberLabel(null), "0");
}

function testBuildsPublicStatsChipsWithoutIndexedCopyOrCompaction() {
  const chips = buildPublicStatsChips({
    job_slot_count: 157355,
    posting_count: 157000,
    configured_ats_count: 62,
    visible_ats_count: 18,
    visible_company_count: 8076,
    company_count: 40860
  });

  assert.deepEqual(chips, [
    { key: "job-slots", value: "157,355", label: "job slots" },
    { key: "ats", value: "62", label: "ATS" },
    { key: "companies", value: "8,076", label: "companies" }
  ]);
  assert.ok(!chips.some((chip) => /indexed/i.test(chip.label)));
  assert.ok(!chips.some((chip) => /K|M/.test(chip.value)));
}

function testBuildsPublicStatsChipsBeforeStatusLoads() {
  assert.deepEqual(buildPublicStatsChips(null), [
    { key: "job-slots", value: "0", label: "job slots" },
    { key: "ats", value: "0", label: "ATS" },
    { key: "companies", value: "0", label: "companies" }
  ]);
}

function testBuildsApproximateSearchStatsWithoutIncompleteFacets() {
  assert.deepEqual(buildPublicStatsChips({
    job_slot_count: 1000,
    job_slot_count_label: "1,000+",
    omit_ats_count: true,
    omit_company_count: true
  }), [
    { key: "job-slots", value: "1,000+", label: "job slots" }
  ]);
}

testFormatsExactNumbers();
testBuildsPublicStatsChipsWithoutIndexedCopyOrCompaction();
testBuildsPublicStatsChipsBeforeStatusLoads();
testBuildsApproximateSearchStatsWithoutIncompleteFacets();

console.log("public stats core tests passed");
