const assert = require("node:assert/strict");
const test = require("node:test");

const {
  ATS_FILTER_OPTION_ITEMS,
  ATS_FILTER_OPTIONS,
  SYNC_DEFAULT_ENABLED_ATS,
  buildPostgresAtsFilterCanonicalExpression,
  getAtsFilterAliasValues,
  normalizeAtsFilterValue,
  normalizeAtsFilters,
  normalizeSyncEnabledAts
} = require("./atsFilters");

test("configured ATS filter options stay in the exported lookup set", () => {
  assert.equal(ATS_FILTER_OPTIONS.size, ATS_FILTER_OPTION_ITEMS.length);
  for (const item of ATS_FILTER_OPTION_ITEMS) {
    assert.equal(ATS_FILTER_OPTIONS.has(item.value), true);
  }
});

test("normalizeAtsFilterValue maps legacy host aliases to canonical ATS keys", () => {
  assert.equal(normalizeAtsFilterValue("greenhouse.io"), "greenhouse");
  assert.equal(normalizeAtsFilterValue("api.k12jobspot.com"), "k12jobspot");
  assert.equal(normalizeAtsFilterValue("ats.rippling.com"), "rippling");
  assert.equal(normalizeAtsFilterValue("workforcenow.adp.com"), "adp_workforcenow");
  assert.equal(normalizeAtsFilterValue("jobappnetwork.com"), "talentreef");
});

test("ATS alias helpers expose canonical source target lookups", () => {
  assert.deepEqual(
    getAtsFilterAliasValues("adp_myjobs").filter((value) => value === "adp_myjobs" || value === "adpmyjobs"),
    ["adp_myjobs", "adpmyjobs"]
  );

  const expression = buildPostgresAtsFilterCanonicalExpression("c.ats_key");
  assert.match(expression, /LOWER\(BTRIM\(c\.ats_key\)\)/);
  assert.match(expression, /WHEN 'adpmyjobs' THEN 'adp_myjobs'/);
  assert.match(expression, /WHEN 'adpworkforcenow' THEN 'adp_workforcenow'/);
});

test("normalizeAtsFilters dedupes configured canonical keys and ignores unsupported values", () => {
  assert.deepEqual(
    normalizeAtsFilters(["greenhouse.io", "greenhouse", "api.k12jobspot.com", "unknown"]),
    ["greenhouse", "k12jobspot"]
  );
});

test("default sync ATS excludes sources that are not enabled by default", () => {
  assert.equal(SYNC_DEFAULT_ENABLED_ATS.includes("dayforcehcm"), false);
  assert.equal(SYNC_DEFAULT_ENABLED_ATS.includes("greenhouse"), true);
  assert.equal(normalizeSyncEnabledAts(["dayforcehcm"]).length, 0);
  assert.deepEqual(normalizeSyncEnabledAts("[\"greenhouse.io\",\"lever.co\"]"), ["greenhouse", "lever"]);
});
