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
  PARSER_FIXTURE_BACKED,
  getAdapterMetadata,
  isAtsEnabledByDefault
} = require("./adapter-metadata");
const { canonicalizePostingUrl, normalizePosting, validatePosting } = require("./posting");

test("canonicalizePostingUrl removes fragments and tracking query noise", () => {
  assert.equal(
    canonicalizePostingUrl("https://example.com/jobs/123?jobId=abc&utm_source=test&source=openjobslots#apply"),
    "https://example.com/jobs/123?jobId=abc"
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

test("normalizePosting preserves common ATS source id, location, and remote aliases", () => {
  const posting = normalizePosting(
    {
      title: "Support Engineer",
      url: "https://example.com/jobs/42",
      jobId: "job-42",
      jobLocation: { city: "Istanbul", country: "Türkiye" },
      isRemote: true
    },
    { company_name: "Alias Co" },
    "aliasats"
  );

  assert.equal(posting.source_job_id, "job-42");
  assert.equal(posting.location_text, "Istanbul, Türkiye");
  assert.equal(posting.city, "Istanbul");
  assert.equal(posting.country, "Turkey");
  assert.equal(posting.remote_type, "remote");
  assert.equal(posting.parser_confidence, posting.confidence);
});

test("normalizePosting carries the full adapter contract shape", () => {
  const posting = normalizePosting(
    {
      title: "Technical Support Engineer",
      url: "https://example.com/jobs/contract-shape",
      department: "Support",
      employmentType: "Full-time",
      descriptionHtml: "<p>Help customers &amp; resolve issues.</p>",
      location: { city: "Istanbul", country: "TUR" }
    },
    { company_name: "Contract Co" },
    "contractats",
    { nowEpoch: 1778205600, parserVersion: "contract-test-v1", confidence: 0.91 }
  );

  assert.equal(validatePosting(posting).ok, true);
  assert.equal(posting.city, "Istanbul");
  assert.equal(posting.country, "Turkey");
  assert.equal(posting.region, "EMEA");
  assert.equal(posting.department, "Support");
  assert.equal(posting.employment_type, "Full-time");
  assert.equal(posting.description_plain, "Help customers & resolve issues.");
  assert.equal(posting.description_html, "<p>Help customers &amp; resolve issues.</p>");
  assert.equal(posting.first_seen_epoch, 1778205600);
  assert.equal(posting.last_seen_epoch, 1778205600);
  assert.equal(posting.parser_version, "contract-test-v1");
  assert.equal(posting.parser_confidence, 0.91);
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
  const requiredShape = [
    "source_job_id",
    "ats_key",
    "company",
    "title",
    "location_text",
    "country",
    "region",
    "city",
    "remote_type",
    "department",
    "employment_type",
    "description_plain",
    "description_html",
    "canonical_url",
    "apply_url",
    "posted_at",
    "posted_at_epoch",
    "first_seen_epoch",
    "last_seen_epoch",
    "raw_hash",
    "parser_version",
    "parser_confidence"
  ];
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
    for (const fieldName of requiredShape) {
      assert.ok(adapter.metadata.normalizedShape.includes(fieldName), `${key} normalized shape should include ${fieldName}`);
    }
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

test("strict parser-backed metadata is separate from normalized fixture coverage", () => {
  assert.deepEqual(
    Array.from(PARSER_FIXTURE_BACKED).sort(),
    [
      "adp_workforcenow",
      "applicantpro",
      "applitrack",
      "ashby",
      "applytojob",
      "bamboohr",
      "breezy",
      "careerplug",
      "fountain",
      "greenhouse",
      "hrmdirect",
      "icims",
      "lever",
      "manatal",
      "oracle",
      "paylocity",
      "pinpointhq",
      "recruitcrm",
      "recruitee",
      "smartrecruiters",
      "taleo",
      "workday",
      "zoho"
    ].sort()
  );
  for (const atsKey of PARSER_FIXTURE_BACKED) {
    const metadata = getAdapterMetadata(atsKey);
    assert.equal(metadata.parserFixtureStatus, "parser-fixture-backed");
  }
  assert.equal(getAdapterMetadata("teamtailor").parserFixtureStatus, "pending-parser-fixture");
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
