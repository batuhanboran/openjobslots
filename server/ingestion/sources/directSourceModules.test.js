const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const { evaluatePublicPosting } = require("../publicPostingGate");
const { DIRECT_SOURCE_ATS_KEYS, getSourceModule } = require("./index");

const PRIMARY_DIRECT_SOURCES = Object.freeze([
  "greenhouse",
  "lever",
  "ashby",
  "smartrecruiters",
  "recruitee",
  "bamboohr",
  "manatal",
  "recruitcrm",
  "pinpointhq",
  "fountain",
  "zoho"
]);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

for (const atsKey of PRIMARY_DIRECT_SOURCES) {
  test(`${atsKey} source module parses list fixture and emits strict normalized evidence`, () => {
    assert.ok(DIRECT_SOURCE_ATS_KEYS.includes(atsKey), `${atsKey} should be registered`);
    const source = getSourceModule(atsKey);
    assert.ok(source, `expected source module ${atsKey}`);
    const sourceDir = path.join(__dirname, atsKey);
    const company = readJson(path.join(sourceDir, "fixtures", "company.json"));
    const rawList = readJson(path.join(sourceDir, "fixtures", "list.json"));
    const expectedRows = readJson(path.join(sourceDir, "fixtures", "expected-normalized.json"));

    const discovered = source.discover(company);
    assert.equal(discovered.ats_key, atsKey);
    assert.ok(source.parserVersion.startsWith(`source-${atsKey}-v`));
    assert.deepEqual(source.qualityThreshold().public_requires_geo_or_explicit_remote, true);

    const parsed = source.parse(rawList, company);
    assert.equal(parsed.length, expectedRows.length);
    const normalized = parsed.map((posting) => source.normalize(posting, company));

    for (let index = 0; index < expectedRows.length; index += 1) {
      const expected = expectedRows[index];
      const row = normalized[index];
      assert.equal(source.validate(row).ok, true);
      assert.equal(row.ats_key, atsKey);
      assert.equal(row.parser_key, atsKey);
      assert.equal(row.parser_version, source.parserVersion);
      assert.equal(typeof row.parser_confidence, "number");
      assert.equal(typeof row.confidence_score, "number");
      assert.ok(row.evidence?.title?.present);
      assert.ok(row.evidence?.company?.present);
      assert.ok(row.evidence?.canonical_url?.present);
      assert.equal(row.source_job_id, expected.source_job_id);
      assert.equal(row.company_name, expected.company_name);
      assert.equal(row.position_name, expected.position_name);
      assert.equal(row.country, expected.country || "");
      assert.equal(row.remote_type, expected.remote_type || "unknown");
      assert.equal(row.canonical_url, expected.job_posting_url);
      const gate = evaluatePublicPosting(row, { parserVersion: source.parserVersion });
      assert.equal(gate.status, "accepted", `${atsKey} valid fixture should pass public gate`);
    }
  });

  test(`${atsKey} source module rejects or quarantines invalid-shape fixtures`, () => {
    const source = getSourceModule(atsKey);
    const sourceDir = path.join(__dirname, atsKey);
    const company = readJson(path.join(sourceDir, "fixtures", "company.json"));
    const invalid = readJson(path.join(sourceDir, "fixtures", "invalid-shapes.json"));

    for (const item of invalid.cases) {
      const normalized = source.normalize(item.posting, company);
      const basic = source.validate(normalized);
      const gate = evaluatePublicPosting(normalized, { parserVersion: source.parserVersion });
      if (item.expected === "rejected") {
        assert.equal(basic.ok, false, `${atsKey} ${item.name} should fail source validation`);
        assert.match(basic.error, new RegExp(item.reason));
      } else {
        assert.equal(basic.ok, true, `${atsKey} ${item.name} should pass basic validation`);
        assert.equal(gate.status, "quarantined", `${atsKey} ${item.name} should be quarantined`);
        assert.ok(gate.reason_codes.includes(item.reason), `${atsKey} ${item.name} should include ${item.reason}`);
      }
    }
  });
}

function readRecruiteeFixture(fileName) {
  return readJson(path.join(__dirname, "recruitee", "fixtures", fileName));
}

function recruiteeFixtureContext() {
  return {
    source: getSourceModule("recruitee"),
    company: readRecruiteeFixture("company.json")
  };
}

test("recruitee source module parses raw list variants for remote, hybrid, and onsite jobs", () => {
  const { source, company } = recruiteeFixtureContext();
  const rawList = readRecruiteeFixture("list.json");
  const parsed = source.parse(rawList, company);
  const normalized = parsed.map((posting) => source.normalize(posting, company));
  const byId = new Map(normalized.map((posting) => [posting.source_job_id, posting]));

  assert.equal(normalized.length, 3);

  const hybrid = byId.get("1001");
  assert.equal(hybrid.position_name, "Hybrid Product Manager");
  assert.equal(hybrid.location_text, "Amsterdam, Netherlands");
  assert.equal(hybrid.city, "Amsterdam");
  assert.equal(hybrid.country, "Netherlands");
  assert.equal(hybrid.region, "EMEA");
  assert.equal(hybrid.remote_type, "hybrid");
  assert.equal(hybrid.department, "Product");
  assert.equal(hybrid.posting_date, "2026-05-06T08:00:00+03:00");
  assert.equal(source.validatePublic(hybrid).status, "accepted");

  const remote = byId.get("1002");
  assert.equal(remote.position_name, "Remote Platform Engineer");
  assert.equal(remote.location_text, null);
  assert.equal(remote.country, "");
  assert.equal(remote.region, "");
  assert.equal(remote.remote_type, "remote");
  assert.equal(remote.department, "Engineering");
  assert.equal(remote.posting_date, "2026-05-07T09:30:00+03:00");
  assert.equal(source.validatePublic(remote).status, "accepted");

  const onsite = byId.get("1003");
  assert.equal(onsite.position_name, "Onsite Operations Coordinator");
  assert.equal(onsite.location_text, "Austin, TX, United States");
  assert.equal(onsite.city, "Austin");
  assert.equal(onsite.country, "United States");
  assert.equal(onsite.region, "North America");
  assert.equal(onsite.remote_type, "onsite");
  assert.equal(onsite.department, "Operations");
  assert.equal(onsite.posting_date, "2026-05-08T10:45:00+03:00");
  assert.equal(source.validatePublic(onsite).status, "accepted");
});

test("recruitee source module quarantines raw list rows with missing geo and no remote evidence", () => {
  const { source, company } = recruiteeFixtureContext();
  const rawList = readRecruiteeFixture("missing-geo-list.json");
  const parsed = source.parse(rawList, company);
  assert.equal(parsed.length, 1);

  const normalized = source.normalize(parsed[0], company);
  assert.equal(source.validate(normalized).ok, true);
  assert.equal(normalized.source_job_id, "2001");
  assert.equal(normalized.position_name, "Unlocated Generalist");
  assert.equal(normalized.location_text, null);
  assert.equal(normalized.country, "");
  assert.equal(normalized.remote_type, "unknown");

  const gate = source.validatePublic(normalized);
  assert.equal(gate.status, "quarantined");
  assert.ok(gate.reason_codes.includes("no_geo_no_remote"));
});

test("recruitee source module ignores malformed or unsupported raw list shapes", () => {
  const { source, company } = recruiteeFixtureContext();
  const malformed = readRecruiteeFixture("malformed-list-shapes.json");

  for (const item of malformed.cases) {
    const parsed = source.parse(item.payload, company);
    assert.equal(parsed.length, item.expected_count, item.name);
  }
});

test("recruitee source module does not require a detail response fixture", async () => {
  const { source, company } = recruiteeFixtureContext();
  const detail = await source.fetchDetail(company, { source_job_id: "1001" });
  assert.equal(detail, null);
});
