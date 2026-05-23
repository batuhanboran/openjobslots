const fs = require("fs");
const path = require("path");
const test = require("node:test");
const assert = require("node:assert/strict");
const { adapters } = require("./adapters");
const { normalizeCountryFromAtsCodeLocation, validatePosting } = require("./posting");
const { evaluatePublicPosting } = require("./publicPostingGate");
const {
  buildApplitrackDetailUrl,
  extractApplitrackDetailFields,
  extractApplicantProDomainId,
  parseAdpWorkforcenowPostingsFromApi,
  parseApplicantProPostingsFromApi,
  parseApplitrackPostings,
  parseApplyToJobPostingsFromHtml,
  parseAshbyPostingsFromApi,
  parseBambooHrPostingsFromApi,
  parseBreezyPostingsFromHtml,
  parseCareerplugPostingsFromHtml,
  parseRecruiteePostingsFromPublicApp,
  extractSourceIdFromPostingUrl,
  extractTaleoPostingsFromAjax,
  extractTaleoPostingsFromRest,
  extractWorkdayLocationLabel,
  extractWorkdaySourceJobId,
  extractIcimsLocationFromHtml,
  extractIcimsPostingDateFromHtml,
  extractIcimsRemoteTypeFromHtml,
  parseFountainPostingsFromApi,
  parseGreenhousePostingsFromApi,
  parseHrmDirectPostingsFromHtml,
  parseIcimsPostingsFromHtml,
  parseJobvitePostingsFromHtml,
  parseLeverPostingsFromApi,
  parseManatalPostingsFromApi,
  parseManatalPostingsFromHtml,
  parseOraclePostingsFromApi,
  parsePaylocityPostingsFromPageData,
  parsePinpointHqPostingsFromApi,
  parseRecruitCrmPostingsFromApi,
  parseSmartRecruitersPostingsFromApi,
  parseTeamtailorPostingsFromHtml,
  parseUsajobsPostingsFromPayload,
  parseWorkdayPostingsFromApi,
  parseZohoPostingsFromHtml,
  resolveAdpWorkforcenowCompanyName
} = require("../index");

const fixtureDir = path.join(__dirname, "fixtures");

const PARSERS = {
  adp_workforcenow: parseAdpWorkforcenowPostingsFromApi,
  applicantpro: parseApplicantProPostingsFromApi,
  ashby: parseAshbyPostingsFromApi,
  applytojob: parseApplyToJobPostingsFromHtml,
  bamboohr: parseBambooHrPostingsFromApi,
  breezy: parseBreezyPostingsFromHtml,
  fountain: parseFountainPostingsFromApi,
  greenhouse: parseGreenhousePostingsFromApi,
  hrmdirect: parseHrmDirectPostingsFromHtml,
  lever: parseLeverPostingsFromApi,
  manatal: parseManatalPostingsFromApi,
  oracle: parseOraclePostingsFromApi,
  paylocity: parsePaylocityPostingsFromPageData,
  pinpointhq: parsePinpointHqPostingsFromApi,
  recruitcrm: parseRecruitCrmPostingsFromApi,
  recruitee: parseRecruiteePostingsFromPublicApp,
  smartrecruiters: parseSmartRecruitersPostingsFromApi,
  taleo: extractTaleoPostingsFromRest,
  workday: parseWorkdayPostingsFromApi,
  zoho: parseZohoPostingsFromHtml
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
      assert.equal(typeof item.parser_confidence, "number");
      assert.ok(item.raw_hash);
    }
  });
}

test("applicantpro domain id extraction supports current jobs page variants", () => {
  const fixture = JSON.parse(fs.readFileSync(path.join(fixtureDir, "applicantpro-direct.json"), "utf8"));
  for (const html of fixture.jobs_page_html_variants || []) {
    assert.equal(extractApplicantProDomainId(html), fixture.expected_domain_id);
  }
});

test("applicantpro parser returns no postings for empty raw payloads", () => {
  assert.deepEqual(
    parseApplicantProPostingsFromApi("Fixture ApplicantPro", { origin: "https://fixtureco.applicantpro.com" }, {}),
    []
  );
});

const newlyCertifiedFailureFixtures = [
  "applicantpro-failures.json",
  "ashby-failures.json",
  "applytojob-failures.json",
  "bamboohr-failures.json",
  "breezy-failures.json",
  "greenhouse-failures.json",
  "hrmdirect-failures.json",
  "lever-failures.json",
  "recruitee-failures.json",
  "smartrecruiters-failures.json",
  "taleo-failures.json",
  "workday-failures.json",
  "zoho-failures.json"
];

for (const fileName of newlyCertifiedFailureFixtures) {
  test(`${fileName} rejects invalid source shapes before storage`, () => {
    const fixture = JSON.parse(fs.readFileSync(path.join(fixtureDir, fileName), "utf8"));
    const atsKey = String(fixture.ats_key || "");
    const parse = PARSERS[atsKey];
    const adapter = adapters.get(atsKey);
    assert.equal(typeof parse, "function", `missing parser export for ${atsKey}`);
    assert.ok(adapter, `expected adapter ${atsKey}`);

    const parsed = parse(fixture.company_name_for_postings, fixture.config || {}, fixture.raw_response || {});
    const normalizedRows = parsed.map((posting) => {
      const normalized = adapter.normalize(posting, fixture.company || {});
      return {
        normalized,
        validation: validatePosting(normalized)
      };
    });

    for (const expected of fixture.expected_rejections || []) {
      const row = normalizedRows.find((item) => item.normalized.source_job_id === expected.source_job_id);
      assert.ok(row, `expected rejected ${atsKey} row ${expected.source_job_id}`);
      assert.equal(row.validation.ok, false);
      assert.equal(row.validation.error, expected.reason);
    }

    assert.equal(
      normalizedRows.filter((row) => row.validation.ok).length,
      0,
      `${atsKey} invalid title fixture should not produce a valid posting`
    );

    const missingCompanyParsed = parse("", fixture.config || {}, fixture.missing_company_raw_response || {});
    assert.ok(missingCompanyParsed.length > 0, `${atsKey} missing-company probe should parse a row`);
    const missingCompany = adapter.normalize(missingCompanyParsed[0], {});
    const missingCompanyValidation = validatePosting(missingCompany);
    assert.equal(missingCompanyValidation.ok, false);
    assert.equal(missingCompanyValidation.error, "missing company_name");

    const missingUrlParsed = parse(fixture.company_name_for_postings, fixture.config || {}, fixture.missing_url_raw_response || {});
    const validMissingUrlRows = missingUrlParsed
      .map((posting) => adapter.normalize(posting, fixture.company || {}))
      .filter((posting) => validatePosting(posting).ok);
    assert.equal(validMissingUrlRows.length, 0, `${atsKey} missing-url fixture should not produce a valid posting`);
  });
}

test("manatal failure fixture rejects missing titles and skips rows without job URLs", () => {
  const fixture = JSON.parse(fs.readFileSync(path.join(fixtureDir, "manatal-failures.json"), "utf8"));
  const parsed = parseManatalPostingsFromApi(
    fixture.company_name_for_postings,
    fixture.config,
    fixture.raw_response
  );
  const adapter = adapters.get("manatal");
  assert.ok(adapter, "expected manatal adapter");
  const normalizedRows = parsed.map((posting) => {
    const normalized = adapter.normalize(posting, { company_name: fixture.company_name_for_postings });
    return {
      normalized,
      validation: validatePosting(normalized)
    };
  });

  for (const expected of fixture.expected_rejections) {
    const row = normalizedRows.find((item) => item.normalized.source_job_id === expected.source_job_id);
    assert.ok(row, `expected rejected Manatal row ${expected.source_job_id}`);
    assert.equal(row.validation.ok, false);
    assert.equal(row.validation.error, expected.reason);
  }
  for (const title of fixture.expected_skipped_titles) {
    assert.equal(parsed.some((posting) => posting.position_name === title), false, `${title} should be skipped without a usable URL`);
  }
});

test("placeholder and missing-title postings fail validation before storage", () => {
  const adapter = adapters.get("manatal");
  assert.ok(adapter, "expected manatal adapter");
  for (const positionName of ["", "Untitled Position", "Unknown Job"]) {
    const normalized = adapter.normalize(
      {
        company_name: "Fixture Manatal",
        position_name: positionName,
        job_posting_url: "https://www.careers-page.com/fixture-manatal/job/bad-title"
      },
      { company_name: "Fixture Manatal" }
    );
    assert.equal(validatePosting(normalized).ok, false);
  }
});

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
        <span>Employment Type: Full-time</span>
      </li>
    `
  );
  const applyToJob = normalizeParsed("applytojob", applyParsed[0], "Fixture ApplyToJob");
  assert.equal(applyToJob.country, "Turkey");
  assert.equal(applyToJob.region, "EMEA");
  assert.equal(applyToJob.source_job_id, "abc123");
  assert.equal(applyToJob.posting_date, "2026-05-08");
  assert.equal(applyToJob.employment_type, "Full-time");

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
  assert.equal(applitrack.department, "Teacher");
});

test("USAJobs official search payload preserves official API evidence", () => {
  const parsed = parseUsajobsPostingsFromPayload({
    SearchResult: {
      SearchResultItems: [
        {
          MatchedObjectDescriptor: {
            PositionID: "806553000",
            PositionTitle: "IT Specialist",
            PositionURI: "https://www.usajobs.gov/job/806553000",
            OrganizationName: "Department of Example",
            PublicationStartDate: "2026-05-17T00:00:00.0000",
            PositionLocationDisplay: "Washington, District of Columbia",
            PositionLocation: [
              {
                CityName: "Washington",
                CountrySubDivisionCode: "DC",
                CountryCode: "US"
              }
            ],
            UserArea: {
              Details: {
                RemoteIndicator: true,
                JobSummary: "Public API summary"
              }
            }
          }
        }
      ]
    }
  });
  assert.equal(parsed.length, 1);
  const normalized = normalizeParsed("usajobs", parsed[0], "USAJobs");
  assert.equal(normalized.position_name, "IT Specialist");
  assert.equal(normalized.company_name, "Department of Example");
  assert.equal(normalized.source_job_id, "806553000");
  assert.equal(normalized.country, "United States");
  assert.equal(normalized.city, "Washington");
  assert.equal(normalized.remote_type, "remote");
  assert.equal(normalized.posting_date, "2026-05-17T00:00:00.0000");
});

test("iCIMS raw detail fixtures certify ATS code locations and remote header evidence", () => {
  const fixture = JSON.parse(fs.readFileSync(path.join(fixtureDir, "icims-detail-certification.json"), "utf8"));
  const parsed = parseIcimsPostingsFromHtml(
    fixture.company_name_for_postings,
    fixture.config,
    fixture.list_html
  );
  assert.equal(parsed.length, fixture.expected.length);

  for (let index = 0; index < fixture.expected.length; index += 1) {
    const normalized = normalizeParsed("icims", parsed[index], fixture.company_name_for_postings);
    for (const [key, value] of Object.entries(fixture.expected[index])) {
      assert.equal(normalized[key], value, `iCIMS ${key} should match`);
    }
  }

  assert.equal(normalizeCountryFromAtsCodeLocation("US-PA-Philadelphia"), "United States");
  assert.equal(normalizeCountryFromAtsCodeLocation("US-"), "United States");
  assert.equal(normalizeCountryFromAtsCodeLocation("CA-ON-Toronto"), "Canada");
  assert.equal(extractIcimsLocationFromHtml(fixture.detail_html_no_date), "US-PA-Philadelphia");
  assert.equal(extractIcimsRemoteTypeFromHtml(fixture.detail_html_no_date), "onsite");
  assert.equal(extractIcimsPostingDateFromHtml(fixture.detail_html_no_date), null);

  assert.equal(extractIcimsLocationFromHtml(fixture.detail_html_jsonld), fixture.expected_jsonld.location);
  assert.equal(extractIcimsPostingDateFromHtml(fixture.detail_html_jsonld), fixture.expected_jsonld.posting_date);
  const jsonLdNormalized = normalizeParsed("icims", {
    company_name: fixture.company_name_for_postings,
    source_job_id: "3918",
    position_name: "Business Development Manager - Sustainability Business",
    job_posting_url: "https://fixtureco.icims.com/jobs/3918/business-development-manager/job",
    posting_date: extractIcimsPostingDateFromHtml(fixture.detail_html_jsonld),
    location: extractIcimsLocationFromHtml(fixture.detail_html_jsonld)
  }, fixture.company_name_for_postings);
  assert.equal(jsonLdNormalized.country, fixture.expected_jsonld.country);
  assert.equal(jsonLdNormalized.region, fixture.expected_jsonld.region);
  assert.equal(jsonLdNormalized.city, fixture.expected_jsonld.city);

  assert.equal(extractIcimsLocationFromHtml(fixture.detail_html_jsonld_missing_location), fixture.expected_jsonld_missing_location.location);
  assert.equal(extractIcimsPostingDateFromHtml(fixture.detail_html_jsonld_missing_location), fixture.expected_jsonld_missing_location.posting_date);
  assert.equal(extractIcimsRemoteTypeFromHtml(fixture.detail_html_jsonld_missing_location), fixture.expected_jsonld_missing_location.remote_type);
  const jsonLdMissingLocationNormalized = normalizeParsed("icims", {
    company_name: fixture.company_name_for_postings,
    source_job_id: "4101",
    position_name: "Operations Manager",
    job_posting_url: "https://fixtureco.icims.com/jobs/4101/operations-manager/job",
    posting_date: extractIcimsPostingDateFromHtml(fixture.detail_html_jsonld_missing_location),
    remote_type: extractIcimsRemoteTypeFromHtml(fixture.detail_html_jsonld_missing_location),
    location: extractIcimsLocationFromHtml(fixture.detail_html_jsonld_missing_location)
  }, fixture.company_name_for_postings);
  assert.equal(jsonLdMissingLocationNormalized.country, fixture.expected_jsonld_missing_location.country);
  assert.equal(jsonLdMissingLocationNormalized.region, fixture.expected_jsonld_missing_location.region);
  assert.equal(jsonLdMissingLocationNormalized.city, fixture.expected_jsonld_missing_location.city);
  assert.equal(jsonLdMissingLocationNormalized.remote_type, fixture.expected_jsonld_missing_location.remote_type);

  assert.equal(extractIcimsLocationFromHtml(fixture.detail_html_data_label_remote), fixture.expected_data_label_remote.location);
  assert.equal(extractIcimsPostingDateFromHtml(fixture.detail_html_data_label_remote), fixture.expected_data_label_remote.posting_date);
  assert.equal(extractIcimsRemoteTypeFromHtml(fixture.detail_html_data_label_remote), fixture.expected_data_label_remote.remote_type);
  const dataLabelRemoteNormalized = normalizeParsed("icims", {
    company_name: fixture.company_name_for_postings,
    source_job_id: "4201",
    position_name: "Hybrid Support Lead",
    job_posting_url: "https://fixtureco.icims.com/jobs/4201/hybrid-support-lead/job",
    posting_date: extractIcimsPostingDateFromHtml(fixture.detail_html_data_label_remote),
    remote_type: extractIcimsRemoteTypeFromHtml(fixture.detail_html_data_label_remote),
    location: extractIcimsLocationFromHtml(fixture.detail_html_data_label_remote)
  }, fixture.company_name_for_postings);
  assert.equal(dataLabelRemoteNormalized.country, fixture.expected_data_label_remote.country);
  assert.equal(dataLabelRemoteNormalized.region, fixture.expected_data_label_remote.region);
  assert.equal(dataLabelRemoteNormalized.remote_type, fixture.expected_data_label_remote.remote_type);
});

test("Applitrack detail fixtures recover location, date, remote evidence, and detail URL", () => {
  const fixture = JSON.parse(fs.readFileSync(path.join(fixtureDir, "applitrack-detail-certification.json"), "utf8"));
  const parsed = parseApplitrackPostings(
    fixture.output_html,
    fixture.site_root,
    fixture.company_name_for_postings
  );
  assert.equal(parsed.length, 1);
  const detailUrl = buildApplitrackDetailUrl(fixture.site_root, parsed[0].source_job_id, parsed[0].job_posting_url);
  assert.equal(detailUrl, fixture.expected_detail_url);

  const doubleQuoteParsed = parseApplitrackPostings(
    fixture.output_html_double_quote,
    fixture.site_root,
    fixture.company_name_for_postings
  );
  assert.equal(doubleQuoteParsed.length, 1);
  assert.equal(doubleQuoteParsed[0].source_job_id, fixture.expected_double_quote.source_job_id);
  assert.equal(doubleQuoteParsed[0].position_name, fixture.expected_double_quote.title);

  const detail = extractApplitrackDetailFields(fixture.detail_html);
  const normalized = normalizeParsed("applitrack", {
    ...parsed[0],
    location: parsed[0].location || detail.location,
    posting_date: parsed[0].posting_date || detail.posting_date,
    remote_type: parsed[0].remote_type || detail.remote_type,
    department: parsed[0].department || detail.department
  }, fixture.company_name_for_postings);

  for (const [key, value] of Object.entries(fixture.expected)) {
    assert.equal(normalized[key], value, `Applitrack ${key} should match`);
  }

  const locationOnlyDetail = extractApplitrackDetailFields(fixture.detail_html_location_only);
  const locationOnlyNormalized = normalizeParsed("applitrack", {
    company_name: fixture.company_name_for_postings,
    source_job_id: "5503513",
    position_name: "Teacher - Campus Support",
    job_posting_url: "https://www.applitrack.com/fixtureco/onlineapp/default.aspx?JobID=5503513",
    location: locationOnlyDetail.location,
    posting_date: locationOnlyDetail.posting_date,
    remote_type: locationOnlyDetail.remote_type
  }, fixture.company_name_for_postings);
  for (const [key, value] of Object.entries(fixture.expected_location_only)) {
    assert.equal(locationOnlyNormalized[key], value, `Applitrack location-only ${key} should match`);
  }

  const districtDetail = extractApplitrackDetailFields(fixture.detail_html_district_wide);
  const districtNormalized = normalizeParsed("applitrack", {
    company_name: fixture.company_name_for_postings,
    source_job_id: "4174",
    position_name: "Substitute Educational Support Professionals",
    job_posting_url: "https://www.applitrack.com/fixtureco/onlineapp/default.aspx?JobID=4174",
    location: districtDetail.location,
    posting_date: districtDetail.posting_date,
    remote_type: districtDetail.remote_type
  }, fixture.company_name_for_postings);
  for (const [key, value] of Object.entries(fixture.expected_district_wide)) {
    assert.equal(districtNormalized[key], value, `Applitrack district-wide ${key} should match`);
  }
});

test("Manatal HTML fallback preserves source id, geo, department, and remote evidence", () => {
  const parsed = parseManatalPostingsFromHtml(
    "Fixture Manatal",
    { boardUrl: "https://www.careers-page.com/fixture-manatal/" },
    `
      <article class="job-card">
        <a class="job-title-link" href="/fixture-manatal/job/HTMLHASH">
          <h3 class="job-title">Hybrid Customer Support</h3>
        </a>
        <ul><li><span>Hybrid - London, United Kingdom</span></li></ul>
      </article>
    `
  );
  assert.equal(parsed.length, 1);
  const normalized = normalizeParsed("manatal", {
    ...parsed[0],
    remote_type: "hybrid"
  }, "Fixture Manatal");
  assert.equal(normalized.source_job_id, "HTMLHASH");
  assert.equal(normalized.country, "United Kingdom");
  assert.equal(normalized.region, "EMEA");
  assert.equal(normalized.city, "London");
  assert.equal(normalized.remote_type, "hybrid");
});

test("Workday parser helpers recover source id, location, and remote evidence from CXS fields and URLs", () => {
  const posting = {
    title: "Bodily Injury Claim Specialist - Meemic",
    externalPath: "/job/MI-HMMI-Empl-Work-From-Home/Bodily-Injury-Claim-Specialist---Meemic_JR15792",
    postedOn: "Posted Today"
  };
  const jobUrl = "https://acg.wd1.myworkdayjobs.com/Careers/job/MI-HMMI-Empl-Work-From-Home/Bodily-Injury-Claim-Specialist---Meemic_JR15792";
  assert.equal(extractWorkdaySourceJobId(posting, jobUrl), "JR15792");
  assert.match(extractWorkdayLocationLabel(posting, jobUrl), /Work From Home/);
  const normalized = normalizeParsed("workday", {
    company_name: "Fixture Workday",
    source_job_id: extractWorkdaySourceJobId(posting, jobUrl),
    position_name: posting.title,
    job_posting_url: jobUrl,
    posting_date: posting.postedOn,
    location: extractWorkdayLocationLabel(posting, jobUrl),
    workplaceType: "Work From Home"
  }, "Fixture Workday");
  assert.equal(normalized.source_job_id, "JR15792");
  assert.equal(normalized.country, "United States");
  assert.equal(normalized.remote_type, "remote");
  assert.equal(Number.isFinite(normalized.posted_at_epoch), true);
});

test("Taleo REST parser scans unstable columns and rejects boolean dates", () => {
  const parsed = extractTaleoPostingsFromRest(
    "Fixture Taleo",
    { baseSectionUrl: "https://fixture.taleo.net/careersection/001", lang: "en" },
    [
      {
        jobId: "146407",
        contestNo: "146407",
        column: ["Kearney Finance Supervisor", "false", "Dubai, United Arab Emirates", "Full-time", "May 8, 2026"]
      }
    ]
  );
  const normalized = normalizeParsed("taleo", parsed[0], "Fixture Taleo");
  assert.equal(normalized.source_job_id, "146407");
  assert.equal(normalized.country, "United Arab Emirates");
  assert.equal(normalized.region, "EMEA");
  assert.equal(normalized.posting_date, "May 8, 2026");
});

test("Taleo AJAX parser recovers id, title, location, and date from token streams", () => {
  const parsed = extractTaleoPostingsFromAjax(
    "Fixture Taleo",
    { baseSectionUrl: "https://fixture.taleo.net/careersection/001", lang: "en" },
    "200003!|!Customer Success Manager!|!!|!!|!!|!REQ-200003!|!Toronto, ON, Canada!|!!|!!|!!|!!|!!|!05/08/2026!|!!|!Apply for this position (Customer Success Manager)"
  );
  assert.equal(parsed.length, 1);
  const normalized = normalizeParsed("taleo", parsed[0], "Fixture Taleo");
  assert.equal(normalized.source_job_id, "REQ-200003");
  assert.equal(normalized.title, "Customer Success Manager");
  assert.equal(normalized.country, "Canada");
  assert.equal(normalized.city, "Toronto");
  assert.equal(normalized.posting_date, "05/08/2026");
});

test("Recruitee PublicApp parser preserves localized countries, departments, source id, and remote hints", () => {
  const parsed = parseRecruiteePostingsFromPublicApp(
    "Fixture Recruitee",
    { baseUrl: "https://fixture.recruitee.com" },
    {
      appConfig: {
        primaryLangCode: "nl",
        locations: [
          { id: 10, city: "Rijswijk", country: "Nederland", translations: { nl: { name: "Rijswijk", country: "Nederland" } } }
        ],
        departments: [{ id: 5, translations: { nl: { name: "Engineering" } } }],
        offers: [
          {
            id: 1001,
            slug: "support-engineer",
            locationIds: [10],
            departmentId: 5,
            remote: true,
            publishedAt: "2026-05-08",
            translations: { nl: { title: "Support Engineer" } }
          }
        ]
      }
    }
  );
  const normalized = normalizeParsed("recruitee", parsed[0], "Fixture Recruitee");
  assert.equal(normalized.source_job_id, "1001");
  assert.equal(normalized.country, "Netherlands");
  assert.equal(normalized.region, "EMEA");
  assert.equal(normalized.remote_type, "remote");
  assert.equal(normalized.industry, "Engineering");
  assert.equal(normalized.posting_date, "2026-05-08");
});

test("source id extraction covers high-volume ATS URL shapes", () => {
  assert.equal(extractSourceIdFromPostingUrl("https://boards.greenhouse.io/acme/jobs/123456?gh_jid=123456", "greenhouse"), "123456");
  assert.equal(extractSourceIdFromPostingUrl("https://jobs.lever.co/acme/abc-def-123", "lever"), "abc-def-123");
  assert.equal(extractSourceIdFromPostingUrl("https://jobs.ashbyhq.com/acme/5b00c9d0-abc", "ashby"), "5b00c9d0-abc");
  assert.equal(extractSourceIdFromPostingUrl("https://jobs.smartrecruiters.com/acme/743999999999-title", "smartrecruiters"), "743999999999");
  assert.equal(extractSourceIdFromPostingUrl("https://acme.careers-page.com/job/QW12V3", "manatal"), "QW12V3");
  assert.equal(extractSourceIdFromPostingUrl("https://acme.pinpointhq.com/en/postings/7ca2c3f3-123", "pinpointhq"), "7ca2c3f3-123");
  assert.equal(extractSourceIdFromPostingUrl("https://jobs.recruitcrm.io/acme/vacancy/slug-123", "recruitcrm"), "slug-123");
  assert.equal(extractSourceIdFromPostingUrl("https://acme.bamboohr.com/careers/1002", "bamboohr"), "1002");
  assert.equal(extractSourceIdFromPostingUrl("https://acme.hrmdirect.com/employment/job-opening.php?req=3020632", "hrmdirect"), "3020632");
  assert.equal(extractSourceIdFromPostingUrl("https://careers.zohorecruit.com/jobs/Careers/123456789", "zoho"), "123456789");
  assert.equal(extractSourceIdFromPostingUrl("https://jobs.jobvite.com/acme/job/o0W5zfw8", "jobvite"), "o0W5zfw8");
  assert.equal(extractSourceIdFromPostingUrl("https://acme.careerplug.com/jobs/2922288", "careerplug"), "2922288");
  assert.equal(extractSourceIdFromPostingUrl("https://acme.teamtailor.com/jobs/5842331-support-engineer", "teamtailor"), "5842331-support-engineer");
});

test("careerplug raw fixture parses valid jobs and rejects placeholder or missing required fields", () => {
  const fixture = JSON.parse(fs.readFileSync(path.join(fixtureDir, "careerplug-postings.json"), "utf8"));
  const adapter = adapters.get("careerplug");
  assert.ok(adapter, "expected careerplug adapter");

  const parsed = parseCareerplugPostingsFromHtml(
    fixture.company.company_name,
    fixture.config,
    fixture.raw_html
  );
  const normalizedRows = parsed.map((posting) => {
    const normalized = adapter.normalize(posting, fixture.company);
    return {
      normalized,
      validation: validatePosting(normalized)
    };
  });

  const validRows = normalizedRows
    .filter((row) => row.validation.ok)
    .map((row) => ({
      source_job_id: row.normalized.source_job_id,
      ats_key: row.normalized.ats_key,
      company: row.normalized.company,
      title: row.normalized.title,
      location_text: row.normalized.location_text,
      country: row.normalized.country,
      region: row.normalized.region,
      city: row.normalized.city,
      remote_type: row.normalized.remote_type,
      employment_type: row.normalized.employment_type,
      canonical_url: row.normalized.canonical_url,
      apply_url: row.normalized.apply_url,
      posted_at: row.normalized.posted_at,
      posted_at_epoch: row.normalized.posted_at_epoch,
      parser_version: row.normalized.parser_version
    }));

  assert.deepEqual(validRows, fixture.expected);

  for (const expected of fixture.expected_rejections) {
    const row = normalizedRows.find((item) => item.normalized.source_job_id === expected.source_job_id);
    assert.ok(row, `expected rejected CareerPlug row ${expected.source_job_id}`);
    assert.equal(row.validation.ok, false);
    assert.equal(row.validation.error, expected.reason);
  }

  for (const title of fixture.expected_skipped_titles) {
    assert.equal(parsed.some((posting) => posting.position_name === title), false, `${title} should be skipped without a usable URL`);
  }

  const missingCompanyParsed = parseCareerplugPostingsFromHtml(
    "",
    fixture.config,
    fixture.raw_html
  )[0];
  const missingCompany = adapter.normalize(missingCompanyParsed, { company_name: "" });
  assert.equal(validatePosting(missingCompany).ok, false);
  assert.equal(validatePosting(missingCompany).error, "missing company_name");
});

test("careerplug parser reads sibling location cells from public jobs rows", () => {
  const adapter = adapters.get("careerplug");
  const parsed = parseCareerplugPostingsFromHtml(
    "Fixture CareerPlug",
    { baseOrigin: "https://fixture.careerplug.com" },
    `
      <div id="job_table">
        <div class="row header-row column-titles">
          <div class="job-title col-md-7">Job Title</div>
          <div class="job-location col-md-3">Location</div>
          <div class="job-type col-md-2">Full / Part Time</div>
        </div>
        <div>
          <div class="row">
            <div class="job-title col-md-7">
              <a aria-label="Full Time Home Infusion RN in Brooklyn, NY" href="/jobs/746847">
                <span class="name">Full Time Home Infusion RN</span>
              </a>
            </div>
            <div class="job-location col-md-3">NY-Brooklyn-11226</div>
            <div class="job-type col-md-2">Full Time</div>
          </div>
        </div>
      </div>
    `
  );

  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].position_name, "Full Time Home Infusion RN");
  assert.equal(parsed[0].location, "NY-Brooklyn-11226");
  assert.equal(parsed[0].employment_type, "Full Time");

  const normalized = adapter.normalize(parsed[0], {
    company_name: "Fixture CareerPlug",
    ATS_name: "careerplug",
    url_string: "https://fixture.careerplug.com/jobs"
  });
  assert.equal(normalized.country, "United States");
  assert.equal(normalized.region, "North America");
  assert.equal(normalized.location_text, "NY-Brooklyn-11226");
  assert.equal(evaluatePublicPosting(normalized, { parserVersion: adapter.parserVersion }).status, "accepted");
});

test("implemented HTML/API parsers preserve source ids from source payloads and URLs", () => {
  const jobvite = normalizeParsed(
    "jobvite",
    parseJobvitePostingsFromHtml(
      "Fixture Jobvite",
      { baseOrigin: "https://jobs.jobvite.com" },
      `
        <h3>Engineering</h3>
        <table class="jv-job-list">
          <tr>
            <td class="jv-job-list-name"><a href="/fixture/job/o0W5zfw8">Network Support Specialist</a></td>
            <td class="jv-job-list-location">Istanbul, TR</td>
          </tr>
        </table>
      `
    )[0],
    "Fixture Jobvite"
  );
  assert.equal(jobvite.source_job_id, "o0W5zfw8");
  assert.equal(jobvite.country, "Turkey");
  assert.equal(jobvite.industry, "Engineering");

  const careerplug = normalizeParsed(
    "careerplug",
    parseCareerplugPostingsFromHtml(
      "Fixture CareerPlug",
      { baseOrigin: "https://fixture.careerplug.com" },
      `
        <a aria-label="View job" href="/jobs/2922288">
          <div class="job-title">Store Manager</div>
          <div class="job-location">OK-Sand Springs-74063</div>
        </a>
      `
    )[0],
    "Fixture CareerPlug"
  );
  assert.equal(careerplug.source_job_id, "2922288");
  assert.equal(careerplug.country, "United States");

  const teamtailor = normalizeParsed(
    "teamtailor",
    parseTeamtailorPostingsFromHtml(
      "Fixture Teamtailor",
      { baseOrigin: "https://fixture.teamtailor.com" },
      `
        <li class="block-grid-item">
          <a href="/jobs/5842331-support-engineer">
            <span class="text-block-base-link" title="Support Engineer">Support Engineer</span>
            <div class="mt-1 text-md"><span>Engineering</span><span>Heidelberg</span></div>
          </a>
        </li>
      `
    )[0],
    "Fixture Teamtailor"
  );
  assert.equal(teamtailor.source_job_id, "5842331-support-engineer");
  assert.equal(teamtailor.country, "Germany");
  assert.equal(teamtailor.industry, "Engineering");

  const manatal = normalizeParsed(
    "manatal",
    parseManatalPostingsFromApi(
      "Fixture Manatal",
      { domainSlug: "fixtureco", publicBaseUrl: "https://www.careers-page.com" },
      {
        results: [
          {
            id: "7788",
            hash: "QW12V3",
            title: "Operations Analyst",
            city: "Poipet",
            country: "Cambodia",
            organization_name: "Operations",
            employment_type: "Full-time"
          }
        ]
      }
    )[0],
    "Fixture Manatal"
  );
  assert.equal(manatal.source_job_id, "QW12V3");
  assert.equal(manatal.country, "Cambodia");
  assert.equal(manatal.region, "APAC");
  assert.equal(manatal.department, "Operations");
  assert.equal(manatal.employment_type, "Full-time");

  const hrmdirect = normalizeParsed(
    "hrmdirect",
    parseHrmDirectPostingsFromHtml(
      "Fixture HRMDirect",
      { baseOrigin: "https://fixture.hrmdirect.com" },
      `
        <tr class="reqitem">
          <td class="posTitle"><a href="job-opening.php?req=3020632">Customer Support</a></td>
          <td class="cities">Nairobi Area</td>
          <td class="state">Kenya</td>
          <td class="departments">Support</td>
          <td class="jobtype">Full-time</td>
          <td class="date">2026-05-08</td>
        </tr>
      `
    )[0],
    "Fixture HRMDirect"
  );
  assert.equal(hrmdirect.source_job_id, "3020632");
  assert.equal(hrmdirect.country, "Kenya");
  assert.equal(hrmdirect.city, "Nairobi Area");
  assert.equal(hrmdirect.industry, "Support");
  assert.equal(hrmdirect.department, "Support");
  assert.equal(hrmdirect.employment_type, "Full-time");

  const zoho = normalizeParsed(
    "zoho",
    parseZohoPostingsFromHtml(
      "Fixture Zoho",
      { careersUrl: "https://fixture.zohorecruit.com/jobs/Careers" },
      `
        <input id="meta" value='{"list_url":"https://fixture.zohorecruit.com/jobs/Careers"}'>
        <input id="jobs" value='[{"id":"123456789","Posting_Title":"Data Scientist","City":"Skopje","State":"Centar","Country":"Macedonia","Date_Opened":"2026-05-08","Industry":"Data"}]'>
      `
    )[0],
    "Fixture Zoho"
  );
  assert.equal(zoho.source_job_id, "123456789");
  assert.equal(zoho.country, "North Macedonia");
  assert.equal(zoho.posting_date, "2026-05-08");
});
