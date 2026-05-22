const assert = require("node:assert/strict");

const {
  sanitizeAnalyticsSearchTerm,
  trackPublicAnalyticsEvent,
  trackPublicApplyClick,
  trackPublicFilterChange,
  trackPublicSearch
} = require("./publicAnalyticsCore");

function withFakeWindow(callback) {
  const previousWindow = global.window;
  const calls = [];
  global.window = {
    gtag: (...args) => calls.push(args)
  };
  try {
    callback(calls);
  } finally {
    if (previousWindow === undefined) delete global.window;
    else global.window = previousWindow;
  }
}

function testSanitizesSearchTerms() {
  assert.equal(sanitizeAnalyticsSearchTerm("  Software   Engineer  "), "Software Engineer");
  assert.equal(sanitizeAnalyticsSearchTerm("person@example.com"), "");
  assert.equal(sanitizeAnalyticsSearchTerm("https://example.com/jobs"), "");
  assert.equal(sanitizeAnalyticsSearchTerm("555-555-1212"), "");
  assert.equal(sanitizeAnalyticsSearchTerm("a".repeat(100)).length, 80);
}

function testTracksRecommendedSearchEvent() {
  withFakeWindow((calls) => {
    trackPublicSearch("Software Engineer", { source: "search_box" });
    assert.deepEqual(calls, [
      ["event", "search", { search_term: "Software Engineer", search_source: "search_box" }]
    ]);
  });
}

function testDropsUnsafeSearchEvent() {
  withFakeWindow((calls) => {
    trackPublicSearch("person@example.com", { source: "search_box" });
    assert.deepEqual(calls, []);
  });
}

function testTracksSafeCustomEvents() {
  withFakeWindow((calls) => {
    trackPublicFilterChange("industry");
    trackPublicApplyClick({ ats: "greenhouse", job_posting_url: "https://example.com/private?id=123" });
    assert.deepEqual(calls, [
      ["event", "openjobslots_filter_changed", { filter_type: "industry" }],
      ["event", "openjobslots_apply_click", { ats: "greenhouse" }]
    ]);
  });
}

function testGenericEventSanitizesParamsAndNoopsWithoutGtag() {
  const previousWindow = global.window;
  delete global.window;
  assert.equal(trackPublicAnalyticsEvent("bad-name", { value: "x" }), false);
  assert.equal(trackPublicAnalyticsEvent("openjobslots_apply_click", { email: "person@example.com" }), false);
  if (previousWindow !== undefined) global.window = previousWindow;
}

function main() {
  testSanitizesSearchTerms();
  testTracksRecommendedSearchEvent();
  testDropsUnsafeSearchEvent();
  testTracksSafeCustomEvents();
  testGenericEventSanitizesParamsAndNoopsWithoutGtag();
  console.log("publicAnalyticsCore tests passed");
}

if (require.main === module) {
  main();
}
