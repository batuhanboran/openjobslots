const assert = require("node:assert/strict");
const test = require("node:test");

const {
  getPublicSeoCanonicalSearchQuery,
  getPublicSeoCountryFallbackQueries,
  getPublicSeoPopularSearchItems,
  getPublicSeoRouteHintByPath
} = require("./publicSeoRoutes");

test("SEO route hints keep localized labels but expose canonical indexed search", () => {
  const spanishSoftwareEngineer = getPublicSeoRouteHintByPath("/es/empleos-software-engineer");
  assert.equal(spanishSoftwareEngineer.searchQuery, "empleos software engineer");
  assert.equal(getPublicSeoCanonicalSearchQuery(spanishSoftwareEngineer), "software engineer");

  const spanishRemote = getPublicSeoRouteHintByPath("/es/trabajos-remotos");
  assert.equal(spanishRemote.searchQuery, "trabajos remotos");
  assert.equal(getPublicSeoCanonicalSearchQuery(spanishRemote), "remote");
});

test("popular SEO searches order localized landing links by canonical analytics terms", () => {
  const items = getPublicSeoPopularSearchItems("es", [
    { query: "software engineer", count: 9 },
    { query: "remote", count: 4 }
  ], 2);

  assert.deepEqual(items.map((item) => item.path), [
    "/es/empleos-software-engineer",
    "/es/trabajos-remotos"
  ]);
  assert.deepEqual(items.map((item) => item.searchQuery), [
    "software engineer",
    "remote"
  ]);
  assert.match(items[0].label, /Empleos Software Engineer/);
});

test("popular SEO searches include short live queries before static fallbacks", () => {
  const items = getPublicSeoPopularSearchItems("en", [
    { query: "remote", count: 61 },
    { query: "software", count: 26 },
    { query: "remote engineer", count: 13 },
    { query: "drone operator raptor maps inc", count: 12 },
    { query: "technical support engineer", count: 7 }
  ], 5);

  assert.deepEqual(items.map((item) => item.path), [
    "/en/remote-job-openings",
    "/en?q=software",
    "/en?q=remote%20engineer",
    "/en/technical-support-engineer-jobs",
    "/en/job-openings"
  ]);
  assert.deepEqual(items.map((item) => item.searchQuery), [
    "remote",
    "software",
    "remote engineer",
    "technical support engineer",
    "job openings"
  ]);
  assert.equal(items[1].label, "Software");
});

test("SEO landing catalog includes Semrush-seeded role intents", () => {
  assert.equal(getPublicSeoRouteHintByPath("/en/data-analyst-jobs").canonicalSearchQuery, "data analyst");
  assert.equal(getPublicSeoRouteHintByPath("/en/customer-success-manager-jobs").canonicalSearchQuery, "customer success manager");
  assert.equal(getPublicSeoRouteHintByPath("/en/devops-engineer-jobs").canonicalSearchQuery, "devops engineer");

  const items = getPublicSeoPopularSearchItems("en", [
    { query: "customer success manager", count: 18 },
    { query: "data analyst", count: 16 },
    { query: "devops engineer", count: 12 }
  ], 3);

  assert.deepEqual(items.map((item) => item.path), [
    "/en/customer-success-manager-jobs",
    "/en/data-analyst-jobs",
    "/en/devops-engineer-jobs"
  ]);
});

test("SEO landing catalog includes direct employer and hidden-jobs content intents", () => {
  assert.equal(getPublicSeoRouteHintByPath("/en/ats-job-boards").canonicalSearchQuery, "ats jobs");
  assert.equal(getPublicSeoRouteHintByPath("/en/company-career-page-jobs").canonicalSearchQuery, "company career pages jobs");
  assert.equal(getPublicSeoRouteHintByPath("/en/direct-apply-jobs").canonicalSearchQuery, "direct apply jobs");
  assert.equal(getPublicSeoRouteHintByPath("/en/hidden-jobs").canonicalSearchQuery, "hidden jobs");
  assert.equal(getPublicSeoRouteHintByPath("/en/jobs-not-on-linkedin").canonicalSearchQuery, "jobs not on linkedin");

  const items = getPublicSeoPopularSearchItems("en", [
    { query: "hidden jobs", count: 20 },
    { query: "jobs not on linkedin", count: 18 },
    { query: "ats jobs", count: 16 },
    { query: "direct apply jobs", count: 14 }
  ], 4);

  assert.deepEqual(items.map((item) => item.path), [
    "/en/hidden-jobs",
    "/en/jobs-not-on-linkedin",
    "/en/ats-job-boards",
    "/en/direct-apply-jobs"
  ]);
  assert.deepEqual(items.map((item) => item.searchQuery), [
    "hidden jobs",
    "jobs not on linkedin",
    "ats jobs",
    "direct apply jobs"
  ]);
});

test("country research fallbacks preserve scoped queries for supported markets", () => {
  for (const countryCode of ["US", "GB", "TR", "DE", "FR", "ES"]) {
    const queries = getPublicSeoCountryFallbackQueries(countryCode, countryCode === "TR" ? "tr" : "en", 6);
    assert.equal(queries.length, 6);
    assert.ok(queries.every((item) => item.countryCode === countryCode));
    assert.ok(queries.every((item) => item.source === "research_country_fallback"));
    assert.ok(queries.every((item) => item.trustedPopularFallback === true));
    assert.ok(queries.every((item) => Number(item.count) > 0));
  }

  assert.deepEqual(
    getPublicSeoCountryFallbackQueries("TR", "tr", 4).map((item) => item.query),
    ["Turkiye jobs", "remote Turkiye", "Turkey engineer", "Turkey software"]
  );
});

test("popular SEO searches can render trusted country fallback queries", () => {
  const turkishItems = getPublicSeoPopularSearchItems(
    "tr",
    getPublicSeoCountryFallbackQueries("TR", "tr", 3),
    3,
    { trustedQueryCounts: true }
  );

  assert.deepEqual(turkishItems.map((item) => item.path), [
    "/tr?q=Turkiye%20jobs",
    "/tr?q=remote%20Turkiye",
    "/tr?q=Turkey%20engineer"
  ]);
  assert.deepEqual(turkishItems.map((item) => item.searchQuery), [
    "Turkiye jobs",
    "remote Turkiye",
    "Turkey engineer"
  ]);

  const britishItems = getPublicSeoPopularSearchItems(
    "en",
    getPublicSeoCountryFallbackQueries("GB", "en", 2),
    2,
    { trustedQueryCounts: true }
  );
  assert.deepEqual(britishItems.map((item) => item.searchQuery), ["UK jobs", "remote jobs UK"]);
});
