const test = require("node:test");
const assert = require("node:assert/strict");
const { hashPayload, stableStringify } = require("./cache");

test("stableStringify produces stable object key ordering", () => {
  assert.equal(stableStringify({ b: 2, a: 1 }), stableStringify({ a: 1, b: 2 }));
});

test("hashPayload changes when normalized posting changes", () => {
  const first = hashPayload({
    company_name: "Acme",
    position_name: "Engineer",
    job_posting_url: "https://example.com/job/1"
  });
  const second = hashPayload({
    company_name: "Acme",
    position_name: "Senior Engineer",
    job_posting_url: "https://example.com/job/1"
  });

  assert.notEqual(first, second);
});
