const fs = require("fs");
const path = require("path");
const test = require("node:test");
const assert = require("node:assert/strict");
const { adapters } = require("./adapters");
const { validatePosting } = require("./posting");
const {
  parseAdpWorkforcenowPostingsFromApi,
  parseApplitrackPostings,
  parseApplyToJobPostingsFromHtml,
  parseBambooHrPostingsFromApi,
  parseBreezyPostingsFromHtml,
  parseFountainPostingsFromApi,
  parseIcimsPostingsFromHtml,
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

function normalizeParsed(atsKey, parsed, companyName = "Fixture Company") {
  const adapter = adapters.get(atsKey);
  assert.ok(adapter, `expected adapter ${atsKey}`);
  const normalized = adapter.normalize(parsed, { company_name: companyName });
  assert.equal(validatePosting(normalized).ok, true);
  return normalized;
}

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

test("high-volume ATS parsers preserve country, date, remote, and source ids when source exposes them", () => {
  const bambooParsed = parseBambooHrPostingsFromApi(
    "Fixture BambooHR",
    { boardUrl: "https://fixtureco.bamboohr.com/careers", baseOrigin: "https://fixtureco.bamboohr.com" },
    {
      result: [
        {
          id: "1001",
          jobOpeningName: "Technical Support Engineer",
          applicationUrl: "https://fixtureco.bamboohr.com/careers/1001",
          location: { city: "Indianapolis", state: "IN" },
          atsLocation: { country: "United States" },
          isRemote: true,
          postingDate: "2026-05-08"
        }
      ]
    }
  );
  const bamboo = normalizeParsed("bamboohr", bambooParsed[0], "Fixture BambooHR");
  assert.equal(bamboo.country, "United States");
  assert.equal(bamboo.region, "North America");
  assert.equal(bamboo.remote_type, "remote");
  assert.equal(bamboo.source_job_id, "1001");
  assert.equal(bamboo.posting_date, "2026-05-08");

  const applyParsed = parseApplyToJobPostingsFromHtml(
    "Fixture ApplyToJob",
    { baseOrigin: "https://fixtureco.applytojob.com" },
    `
      <li class="list-group-item">
        <h3 class="list-group-item-heading"><a href="/apply/abc123/Customer-Support">Customer Support</a></h3>
        <i class="fa fa-map-marker"></i> Istanbul, Turkiye
        <i class="fa fa-calendar"></i> 2026-05-08
      </li>
    `
  );
  const applyToJob = normalizeParsed("applytojob", applyParsed[0], "Fixture ApplyToJob");
  assert.equal(applyToJob.country, "Turkey");
  assert.equal(applyToJob.region, "EMEA");
  assert.equal(applyToJob.source_job_id, "abc123");
  assert.equal(applyToJob.posting_date, "2026-05-08");

  const breezyParsed = parseBreezyPostingsFromHtml(
    "Fixture Breezy",
    { origin: "https://fixtureco.breezy.hr" },
    `
      <a href="/p/5c9455cee9a7-2d-game-artist">
        <h2>2D Game Artist</h2>
        <li class="location"><span>Istanbul, TR</span></li>
        <li class="posted"><span>2026-05-08</span></li>
      </a>
    `
  );
  const breezy = normalizeParsed("breezy", breezyParsed[0], "Fixture Breezy");
  assert.equal(breezy.country, "Turkey");
  assert.equal(breezy.source_job_id, "5c9455cee9a7-2d-game-artist");
  assert.equal(breezy.posting_date, "2026-05-08");

  const icimsParsed = parseIcimsPostingsFromHtml(
    "Fixture iCIMS",
    { origin: "https://fixtureco.icims.com" },
    `
      <li class="iCIMS_JobCardItem">
        <a href="/jobs/1001/technical-support/job"><h3>Technical Support Engineer</h3></a>
        <dt><span class="field-label">Location</span></dt><dd class="iCIMS_JobHeaderData"><span>Remote - United States</span></dd>
        <span class="field-label">Date Posted</span><span title="2026-05-08">May 8, 2026</span>
      </li>
    `
  );
  const icims = normalizeParsed("icims", icimsParsed[0], "Fixture iCIMS");
  assert.equal(icims.country, "United States");
  assert.equal(icims.remote_type, "remote");
  assert.equal(icims.source_job_id, "1001");
  assert.equal(icims.posting_date, "2026-05-08");

  const applitrackParsed = parseApplitrackPostings(
    `
      <tr>
        <td>Teacher - Math</td>
        <td>Chicago, IL</td>
        <td>05/08/2026</td>
        <td><script>applyFor('5503511','Teacher','Math')</script></td>
      </tr>
    `,
    "https://fixture.applitrack.com/district/",
    "Fixture Applitrack"
  );
  const applitrack = normalizeParsed("applitrack", applitrackParsed[0], "Fixture Applitrack");
  assert.equal(applitrack.country, "United States");
  assert.equal(applitrack.region, "North America");
  assert.equal(applitrack.source_job_id, "5503511");
  assert.equal(applitrack.posting_date, "05/08/2026");
});
