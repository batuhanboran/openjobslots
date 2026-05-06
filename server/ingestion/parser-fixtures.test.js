const fs = require("fs");
const path = require("path");
const test = require("node:test");
const assert = require("node:assert/strict");
const { adapters } = require("./adapters");
const {
  normalizeCountryFromLocation,
  normalizeCountryName,
  normalizePosting,
  normalizePostingDate,
  normalizeRemoteType,
  validatePosting
} = require("./posting");

const fixtureDir = path.join(__dirname, "fixtures");

const fixtureFileNames = fs.readdirSync(fixtureDir)
  .filter((fileName) => fileName.endsWith("-postings.json"))
  .sort();

for (const fileName of fixtureFileNames) {
  test(`${fileName} normalizes saved ATS postings`, () => {
    const fixture = JSON.parse(fs.readFileSync(path.join(fixtureDir, fileName), "utf8"));
    const atsKey = String(fixture.expected?.[0]?.ats_key || "");
    const adapter = adapters.get(atsKey);
    assert.ok(adapter, `expected adapter ${atsKey}`);

    const normalized = fixture.postings.map((posting) => adapter.normalize(posting, fixture.company));
    assert.equal(normalized.length, fixture.expected.length);

    for (let index = 0; index < fixture.expected.length; index += 1) {
      const item = normalized[index];
      const expected = fixture.expected[index];
      assert.equal(validatePosting(item).ok, true);
      for (const [key, value] of Object.entries(expected)) {
        assert.equal(item[key], value, `${key} should match`);
      }
      if (item.posting_date) {
        assert.equal(Number.isFinite(item.posting_date_epoch), true);
      }
      assert.equal(item.canonical_url, item.job_posting_url);
      assert.equal(item.title, item.position_name);
      assert.equal(item.company, item.company_name);
      assert.ok(item.parser_version);
      assert.ok(item.raw_hash);
    }
  });
}

test("parser rejects postings missing URL, company, or title", () => {
  assert.equal(validatePosting(normalizePosting({ position_name: "Engineer" }, { company_name: "Acme" }, "greenhouse")).ok, false);
  assert.equal(
    validatePosting(
      normalizePosting(
        { company_name: "Acme", job_posting_url: "https://example.com/jobs/1" },
        {},
        "greenhouse"
      )
    ).ok,
    false
  );
  assert.equal(
    validatePosting(
      normalizePosting(
        { position_name: "Engineer", job_posting_url: "https://example.com/jobs/1" },
        {},
        "greenhouse"
      )
    ).ok,
    false
  );
});

test("location, country, date, and remote normalization cover common aliases", () => {
  assert.equal(normalizeCountryFromLocation("Istanbul, T\u00fcrkiye"), "Turkey");
  assert.equal(normalizeCountryFromLocation("Ankara, Turkey"), "Turkey");
  assert.equal(normalizeCountryFromLocation("Gebze, Kocaeli, Turkiye"), "Turkey");
  assert.equal(normalizeCountryName("TR"), "Turkey");
  assert.equal(normalizeCountryName("U.S."), "United States");
  assert.equal(normalizeRemoteType("Hybrid Remote - Ankara"), "hybrid");
  assert.equal(normalizeRemoteType("Remote - EMEA"), "remote");
  assert.equal(normalizeRemoteType("Hybrid - Ankara"), "hybrid");
  assert.equal(normalizeRemoteType("On-site - Berlin"), "onsite");
  assert.equal(normalizePostingDate("2026-05-06T08:00:00+03:00").epoch, 1778043600);
  assert.equal(normalizePostingDate("1778043600").epoch, 1778043600);
  assert.equal(normalizePostingDate("1778043600000").epoch, 1778043600);
});
