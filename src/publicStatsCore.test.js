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

testFormatsExactNumbers();
testBuildsPublicStatsChipsWithoutIndexedCopyOrCompaction();

console.log("public stats core tests passed");
