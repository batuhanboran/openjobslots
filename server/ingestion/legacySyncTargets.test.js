const assert = require("node:assert/strict");
const test = require("node:test");

const {
  DYNAMIC_SYNC_ESTIMATED_COMPANY_COUNTS,
  buildLegacySqliteSyncTargets,
  getDynamicSyncEstimatedCompanyCount
} = require("./legacySyncTargets");

function companies(count) {
  return Array.from({ length: count }, (_, index) => ({
    id: index + 1,
    company_name: `Company ${index + 1}`,
    url_string: `https://example.com/${index + 1}`,
    ATS_name: "greenhouse"
  }));
}

test("dynamic sync estimates add only enabled legacy sources", () => {
  assert.equal(
    getDynamicSyncEstimatedCompanyCount(new Set(["governmentjobs", "smartrecruiters", "usajobs"])),
    DYNAMIC_SYNC_ESTIMATED_COMPANY_COUNTS.governmentjobs +
      DYNAMIC_SYNC_ESTIMATED_COMPANY_COUNTS.smartrecruiters +
      DYNAMIC_SYNC_ESTIMATED_COMPANY_COUNTS.usajobs
  );
  assert.equal(getDynamicSyncEstimatedCompanyCount(new Set(["greenhouse"])), 0);
});

test("legacy sqlite sync targets insert SmartRecruiters after each ten company targets", () => {
  const targets = buildLegacySqliteSyncTargets(companies(20), new Set(["smartrecruiters"]));
  assert.equal(targets.length, 22);
  assert.equal(targets[10].ATS_name, "smartrecruiters");
  assert.equal(targets[21].ATS_name, "smartrecruiters");
});

test("legacy sqlite sync targets include one SmartRecruiters target when no company targets exist", () => {
  assert.deepEqual(
    buildLegacySqliteSyncTargets([], new Set(["smartrecruiters"])).map((target) => target.ATS_name),
    ["smartrecruiters"]
  );
});

test("legacy sqlite sync targets append enabled dynamic source targets after configured companies", () => {
  const targets = buildLegacySqliteSyncTargets(companies(1), new Set(["governmentjobs", "usajobs", "statejobsny"]));
  assert.deepEqual(targets.map((target) => target.ATS_name), [
    "greenhouse",
    "governmentjobs",
    "usajobs",
    "statejobsny"
  ]);
  assert.equal(targets[2].url_string, "https://data.usajobs.gov/api/Search");
});
