const assert = require("assert");

const {
  buildPostingLocationGeoFilterOptions,
  inferLocationGeo,
  parseCountryFilters,
  parseRegionFilters,
  rowMatchesLocationFilters,
  searchTokenMatchesPosting,
  tokenizeSearchText
} = require("./locationFilters");

function testCountryAndRegionInference() {
  assert.deepEqual(parseRegionFilters(["emea", "APAC", "unknown"]), ["EMEA", "APAC"]);

  const [turkeyFilter] = parseCountryFilters(["turkiye"]);
  assert.equal(turkeyFilter.type, "code");
  assert.equal(turkeyFilter.code, "TR");

  const inferred = inferLocationGeo("Istanbul, Turkiye");
  assert.equal(inferred.countryCode, "TR");
  assert.equal(inferred.countryValue, "TR");
  assert.equal(inferred.region, "EMEA");
}

function testLocationFilterMatching() {
  const turkeyFilters = parseCountryFilters(["TR"]);
  const canadaFilters = parseCountryFilters(["Canada"]);

  assert.equal(rowMatchesLocationFilters("Istanbul, Turkey", [], [], turkeyFilters, ["EMEA"]), true);
  assert.equal(rowMatchesLocationFilters("Toronto, Canada", [], [], turkeyFilters, ["EMEA"]), false);
  assert.equal(rowMatchesLocationFilters("Toronto, Canada", [], [], canadaFilters, ["AMER"]), true);
}

function testSearchTokenCountryAliases() {
  const row = {
    ats: "greenhouse",
    company_name: "Example",
    location: "Istanbul, Turkey",
    position_name: "Engineer"
  };

  assert.equal(searchTokenMatchesPosting("turkish", row), true);
  assert.ok(tokenizeSearchText("turkish remote jobs").some((group) => group.includes("turkiye")));
}

function testFilterOptionBuilder() {
  const options = buildPostingLocationGeoFilterOptions([
    "Istanbul, Turkey",
    "Berlin, Germany",
    "Remote - APAC"
  ]);

  assert.ok(options.countries.some((country) => country.value === "TR" && country.region === "EMEA"));
  assert.ok(options.regions.some((region) => region.value === "APAC"));
}

testCountryAndRegionInference();
testLocationFilterMatching();
testSearchTokenCountryAliases();
testFilterOptionBuilder();

console.log("location filter tests passed");
