const fs = require("fs");
const path = require("path");
const test = require("node:test");
const assert = require("node:assert/strict");
const { adapters } = require("./adapters");
const { validatePosting } = require("./posting");
const {
  parseAdpWorkforcenowPostingsFromApi,
  parseFountainPostingsFromApi,
  parseOraclePostingsFromApi,
  parsePaylocityPostingsFromPageData,
  parsePinpointHqPostingsFromApi,
  parseRecruitCrmPostingsFromApi,
  resolveAdpWorkforcenowCompanyName
} = require("../index");

const fixtureDir = path.join(__dirname, "fixtures");

const PARSERS = {
  adp_workforcenow: parseAdpWorkforcenowPostingsFromApi,
  fountain: parseFountainPostingsFromApi,
  oracle: parseOraclePostingsFromApi,
  paylocity: parsePaylocityPostingsFromPageData,
  pinpointhq: parsePinpointHqPostingsFromApi,
  recruitcrm: parseRecruitCrmPostingsFromApi
};

const fixtureFileNames = fs.readdirSync(fixtureDir)
  .filter((fileName) => fileName.endsWith("-direct.json"))
  .sort();

for (const fileName of fixtureFileNames) {
  test(`${fileName} parses direct source response and normalizes postings`, () => {
    const fixture = JSON.parse(fs.readFileSync(path.join(fixtureDir, fileName), "utf8"));
    const atsKey = String(fixture.ats_key || "");
    const parse = PARSERS[atsKey];
    const adapter = adapters.get(atsKey);
    assert.equal(typeof parse, "function", `missing parser export for ${atsKey}`);
    assert.ok(adapter, `expected adapter ${atsKey}`);

    const companyNameForPostings =
      fixture.resolve_company_name === true
        ? resolveAdpWorkforcenowCompanyName(
            { company_name: fixture.source_company_name },
            fixture.config || {},
            fixture.content_links_response || {}
          )
        : fixture.company_name_for_postings;
    const parsed = parse(companyNameForPostings, fixture.config || {}, fixture.raw_response || {});
    assert.equal(parsed.length, fixture.expected.length);

    for (let index = 0; index < fixture.expected.length; index += 1) {
      const item = adapter.normalize(parsed[index], fixture.company || {});
      const expected = fixture.expected[index];
      assert.equal(validatePosting(item).ok, true);
      for (const [key, value] of Object.entries(expected)) {
        assert.equal(item[key], value, `${fileName} ${key} should match`);
      }
      assert.equal(item.canonical_url, item.job_posting_url);
      assert.ok(item.parser_version);
      assert.ok(item.raw_hash);
    }
  });
}
