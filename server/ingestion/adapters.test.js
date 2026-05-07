const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { ATS_FILTER_OPTION_ITEMS, normalizeSyncEnabledAts } = require("../index");
const {
  LEGACY_FETCH_ATS_NAME_OVERRIDES,
  UNSUPPORTED_LEGACY_FETCH_ATS,
  adapters
} = require("./adapters");
const {
  AGGREGATOR_SOURCE_CANDIDATES,
  FIXTURE_BACKED,
  FUTURE_DIRECT_SOURCE_CANDIDATES,
  getAdapterMetadata,
  isAtsEnabledByDefault
} = require("./adapter-metadata");
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

test("fixture-backed adapter metadata points to saved fixtures", () => {
  for (const atsKey of FIXTURE_BACKED) {
    const directFixture = path.join(__dirname, "fixtures", `${atsKey}-direct.json`);
    const postingsFixture = path.join(__dirname, "fixtures", `${atsKey}-postings.json`);
    assert.ok(
      fs.existsSync(directFixture) || fs.existsSync(postingsFixture),
      `${atsKey} should have a saved parser fixture`
    );
    assert.equal(getAdapterMetadata(atsKey).fixtureStatus, "fixture-backed");
  }
});

test("dayforcehcm is configured but disabled until parser certification exists", () => {
  const adapter = adapters.get("dayforcehcm");
  const metadata = getAdapterMetadata("dayforcehcm", "Dayforce");
  assert.ok(adapter, "dayforcehcm remains discoverable for admin diagnostics");
  assert.equal(UNSUPPORTED_LEGACY_FETCH_ATS.has("dayforcehcm"), true);
  assert.equal(isAtsEnabledByDefault("dayforcehcm"), false);
  assert.equal(metadata.enabledByDefault, false);
  assert.equal(metadata.fixtureStatus, "unsupported");
  assert.equal(metadata.confidence, "unsupported");
  assert.equal(normalizeSyncEnabledAts().includes("dayforcehcm"), false);
  assert.deepEqual(normalizeSyncEnabledAts(["dayforcehcm"]), []);
});

test("future ATS and aggregator candidates are research-only until certified", () => {
  assert.deepEqual(
    FUTURE_DIRECT_SOURCE_CANDIDATES.map((item) => item.key),
    ["personio", "recruiterbox", "jobscore", "workable", "bullhorn", "comeet"]
  );
  for (const candidate of FUTURE_DIRECT_SOURCE_CANDIDATES) {
    assert.ok(candidate.docsUrl, `${candidate.key} should have source docs`);
    assert.ok(candidate.endpointPattern, `${candidate.key} should document endpoint pattern`);
    assert.equal(adapters.has(candidate.key), false, `${candidate.key} should not be active before fixtures`);
  }
  assert.deepEqual(
    AGGREGATOR_SOURCE_CANDIDATES.map((item) => item.key),
    ["remotive", "himalayas", "arbeitnow"]
  );
});
