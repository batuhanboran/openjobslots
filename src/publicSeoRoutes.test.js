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
