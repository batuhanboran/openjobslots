const assert = require("node:assert/strict");
const test = require("node:test");

const { capOrSubQueries } = require("./registerPublicRoutes");
const { resolvePublicPostingsPage } = require("../backends/postgresStore");

// --- or-fanout: sub-query fan-out cap -------------------------------------
test("capOrSubQueries returns [] for a non-OR search", () => {
  assert.deepEqual(capOrSubQueries("software engineer"), []);
  assert.deepEqual(capOrSubQueries(""), []);
  assert.deepEqual(capOrSubQueries(null), []);
});

test("capOrSubQueries returns [] when only one non-empty term surrounds OR", () => {
  // "OR" with nothing usable on one side collapses to a single term.
  assert.deepEqual(capOrSubQueries("nurse OR "), []);
});

test("capOrSubQueries splits, trims and filters blank terms", () => {
  assert.deepEqual(capOrSubQueries("a OR b OR  c "), ["a", "b", "c"]);
});

test("capOrSubQueries caps the number of sub-queries (default 8)", () => {
  const terms = Array.from({ length: 50 }, (_, i) => `t${i}`).join(" OR ");
  const capped = capOrSubQueries(terms);
  assert.equal(capped.length, 8);
  assert.deepEqual(capped, ["t0", "t1", "t2", "t3", "t4", "t5", "t6", "t7"]);
});

test("capOrSubQueries honours an explicit lower cap", () => {
  assert.equal(capOrSubQueries("a OR b OR c OR d", 2).length, 2);
});

// --- or-fanout: merge page clamp reuses the public ceiling -----------------
test("resolvePublicPostingsPage clamps an oversized OR-merge limit to maxLimit", () => {
  const page = resolvePublicPostingsPage({ limit: 1000000, offset: 0 });
  assert.equal(page.limit, 500); // DEFAULT_PUBLIC_POSTINGS_MAX_LIMIT
  assert.equal(page.limit_capped, true);
});

test("resolvePublicPostingsPage clamps an oversized offset to maxOffset", () => {
  const page = resolvePublicPostingsPage({ limit: 100, offset: 999999 });
  assert.equal(page.offset, 2000); // DEFAULT_PUBLIC_POSTINGS_MAX_OFFSET
  assert.equal(page.offset_capped, true);
});
