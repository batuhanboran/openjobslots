const assert = require("node:assert/strict");
const test = require("node:test");

const {
  getPublicSeoCanonicalSearchQuery,
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
