const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { ATS_FILTER_OPTION_ITEMS } = require("../index");
const {
  LEGACY_FETCH_ATS_NAME_OVERRIDES,
  UNSUPPORTED_LEGACY_FETCH_ATS,
  adapters
} = require("./adapters");
const { canonicalizePostingUrl, normalizePosting, validatePosting } = require("./posting");

test("canonicalizePostingUrl removes fragments but preserves query strings", () => {
  assert.equal(
    canonicalizePostingUrl("https://example.com/jobs/123?lang=en#apply"),
    "https://example.com/jobs/123?lang=en"
  );
});

test("normalizePosting fills company fallback and required fields", () => {
  const posting = normalizePosting(
    {
      position_name: "  Software Engineer  ",
      job_posting_url: " https://example.com/job/1#apply ",
      location: " Remote "
    },
    { company_name: " Example Co " },
    "exampleats"
  );

  assert.equal(posting.company_name, "Example Co");
  assert.equal(posting.position_name, "Software Engineer");
  assert.equal(posting.job_posting_url, "https://example.com/job/1");
  assert.equal(posting.location, "Remote");
  assert.equal(posting.ats_key, "exampleats");
});

test("validatePosting rejects incomplete postings", () => {
  assert.equal(validatePosting({ company_name: "Acme", position_name: "Engineer" }).ok, false);
  assert.equal(
    validatePosting({
      company_name: "Acme",
      position_name: "Engineer",
      job_posting_url: "https://example.com/job/1"
    }).ok,
    true
  );
});

test("every configured ATS has a certified adapter contract", () => {
  assert.equal(adapters.size, ATS_FILTER_OPTION_ITEMS.length);
  for (const item of ATS_FILTER_OPTION_ITEMS) {
    const key = String(item.value || "");
    const adapter = adapters.get(key);
    assert.ok(adapter, `missing adapter ${key}`);
    for (const methodName of [
      "detect",
      "buildRequests",
      "fetch",
      "parse",
      "normalize",
      "validate",
      "cacheKey",
      "rateLimit",
      "fixtures"
    ]) {
      assert.equal(typeof adapter[methodName], "function", `${key}.${methodName}`);
    }
    assert.equal(adapter.metadata.key, key);
    assert.ok(adapter.metadata.tier, `${key} should have a tier`);
    assert.ok(adapter.metadata.parseStrategy, `${key} should document parse strategy`);
    assert.ok(Array.isArray(adapter.metadata.normalizedShape));
    assert.ok(adapter.metadata.normalizedShape.includes("canonical_url"));
  }
});

test("legacy fetch dispatcher is explicit for every configured ATS", () => {
  const indexSource = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");
  const body = indexSource.slice(
    indexSource.indexOf("async function collectPostingsForCompany"),
    indexSource.indexOf("async function ensureCompaniesTableSchema")
  );
  const missing = [];
  for (const item of ATS_FILTER_OPTION_ITEMS) {
    const key = String(item.value || "");
    const directPattern = new RegExp(`atsName\\s*===\\s*["']${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`);
    const override = LEGACY_FETCH_ATS_NAME_OVERRIDES[key];
    const overridePattern = override
      ? new RegExp(`atsName\\s*===\\s*["']${String(override).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`)
      : null;
    if (directPattern.test(body) || (overridePattern && overridePattern.test(body)) || UNSUPPORTED_LEGACY_FETCH_ATS.has(key)) {
      continue;
    }
    missing.push(key);
  }
  assert.deepEqual(missing, []);
});
