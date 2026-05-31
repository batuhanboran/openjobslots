const assert = require("assert");

const {
  createDefaultPostingsFilters,
  getPostingsFiltersSignature
} = require("./postingsFilters");

const defaults = createDefaultPostingsFilters();

assert.deepStrictEqual(defaults, {
  ats: "all",
  industries: [],
  regions: [],
  countries: [],
  states: [],
  counties: [],
  remote: "all",
  hide_no_date: false,
  freshness_days: "all",
  sort_by: "posted_date"
});

assert.notStrictEqual(createDefaultPostingsFilters(), defaults);
assert.notStrictEqual(createDefaultPostingsFilters().industries, defaults.industries);

assert.strictEqual(
  getPostingsFiltersSignature({
    ...defaults,
    countries: ["Turkey", "United States"],
    industries: ["software", "finance"]
  }),
  getPostingsFiltersSignature({
    ...defaults,
    countries: ["United States", "Turkey"],
    industries: ["finance", "software"]
  })
);

assert.notStrictEqual(
  getPostingsFiltersSignature({ ...defaults, remote: "remote" }),
  getPostingsFiltersSignature(defaults)
);

console.log("postings filter model checks passed");
