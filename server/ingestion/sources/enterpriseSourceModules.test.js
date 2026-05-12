const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const { evaluatePublicPosting } = require("../publicPostingGate");
const { getSourceModule } = require("./index");

const ENTERPRISE_SOURCES = Object.freeze([
  "workday",
  "icims",
  "taleo",
  "oracle",
  "paylocity",
  "adp_workforcenow",
  "adp_myjobs",
  "ultipro",
  "pageup",
  "saphrcloud",
  "brassring"
]);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

for (const atsKey of ENTERPRISE_SOURCES) {
  test(`${atsKey} enterprise source module parses fixture with strict evidence`, () => {
    const source = getSourceModule(atsKey);
    assert.ok(source, `expected source module ${atsKey}`);
    const sourceDir = path.join(__dirname, atsKey);
    const company = readJson(path.join(sourceDir, "fixtures", "company.json"));
    const rawList = readJson(path.join(sourceDir, "fixtures", "list.json"));
    const expectedRows = readJson(path.join(sourceDir, "fixtures", "expected-normalized.json"));

    const discovered = source.discover(company);
    assert.equal(discovered.ats_key, atsKey);
    assert.ok(source.parserVersion.startsWith(`source-${atsKey}-v`));
    assert.ok(["enterprise_api", "html_detail", "brittle"].includes(discovered.source_family));

    const parsed = source.parse(rawList, company);
    assert.equal(parsed.length, expectedRows.length, `${atsKey} parsed fixture count should match`);
    const normalized = parsed.map((posting) => source.normalize(posting, company));

    for (let index = 0; index < expectedRows.length; index += 1) {
      const row = normalized[index];
      const expected = expectedRows[index];
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
      if (expected.city) assert.equal(row.city, expected.city);
      assert.equal(row.remote_type, expected.remote_type || "unknown");
      if (expected.posting_date) assert.equal(row.posting_date, expected.posting_date);
      assert.equal(row.parser_confidence, expected.parser_confidence);
      const gate = evaluatePublicPosting(row, { parserVersion: source.parserVersion });
      assert.equal(gate.status, "accepted", `${atsKey} valid fixture should pass public gate`);
    }
  });

  test(`${atsKey} enterprise source module rejects or quarantines invalid source shapes`, () => {
    const source = getSourceModule(atsKey);
    const sourceDir = path.join(__dirname, atsKey);
    const company = readJson(path.join(sourceDir, "fixtures", "company.json"));
    const invalid = readJson(path.join(sourceDir, "fixtures", "invalid-shapes.json"));

    for (const item of invalid.cases) {
      const normalized = source.normalize(item.posting, company);
      const basic = source.validate(normalized);
      const gate = evaluatePublicPosting(normalized, { parserVersion: source.parserVersion });
      if (item.expected === "rejected") {
        assert.equal(basic.ok, false, `${atsKey} ${item.name} should fail validation`);
        assert.match(basic.error, new RegExp(item.reason));
      } else {
        assert.equal(basic.ok, true, `${atsKey} ${item.name} should pass basic validation`);
        assert.equal(gate.status, "quarantined", `${atsKey} ${item.name} should be quarantined`);
        assert.ok(gate.reason_codes.includes(item.reason), `${atsKey} ${item.name} should include ${item.reason}`);
      }
    }
  });
}

test("icims source module ignores malformed or unsupported raw list shapes", () => {
  const source = getSourceModule("icims");
  const sourceDir = path.join(__dirname, "icims");
  const company = readJson(path.join(sourceDir, "fixtures", "company.json"));
  const malformed = readJson(path.join(sourceDir, "fixtures", "malformed-list-shapes.json"));

  for (const item of malformed.cases) {
    const parsed = source.parse(item.payload, company);
    assert.equal(parsed.length, 0, `icims ${item.name} should not produce postings`);
  }
});

test("icims source module follows wrapper iframe and enriches from public detail", async () => {
  const source = getSourceModule("icims");
  const sourceDir = path.join(__dirname, "icims");
  const company = readJson(path.join(sourceDir, "fixtures", "company.json"));
  const fixture = readJson(path.join(sourceDir, "fixtures", "route-detection.json"));
  const responses = new Map([
    [fixture.wrapper_url, fixture.wrapper_html],
    [fixture.iframe_url, fixture.list_html],
    [fixture.detail_url, fixture.detail_html]
  ]);

  const raw = await source.fetchList(company, {
    fetcher: async (url) => {
      assert.ok(responses.has(url), `unexpected iCIMS fixture fetch ${url}`);
      return responses.get(url);
    }
  });
  const parsed = source.parse(raw, company);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].source_evidence?.route_kind, "icims_public_iframe_list");
  assert.equal(parsed[0].source_evidence?.location_source, "json_ld_joblocation");

  const normalized = source.normalize(parsed[0], company);
  assert.equal(normalized.source_job_id, fixture.expected.source_job_id);
  assert.equal(normalized.position_name, fixture.expected.position_name);
  assert.equal(normalized.country, fixture.expected.country);
  assert.equal(normalized.city, fixture.expected.city);
  assert.equal(normalized.remote_type, fixture.expected.remote_type);
  assert.equal(normalized.posting_date, fixture.expected.posting_date);
  const gate = evaluatePublicPosting(normalized, { parserVersion: source.parserVersion });
  assert.equal(gate.status, "accepted");
});
