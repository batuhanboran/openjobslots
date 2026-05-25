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

test("target direct ATS modules return no postings for empty raw payloads", () => {
  for (const atsKey of ["recruitcrm", "recruitee"]) {
    const source = getSourceModule(atsKey);
    const company = readJson(path.join(__dirname, atsKey, "fixtures", "company.json"));
    assert.deepEqual(source.parse({}, company), [], atsKey);
  }
});

test("lever source module filters employment categories that are misfiled as locations", () => {
  const source = getSourceModule("lever");
  const company = {
    company_name: "Peak Games",
    company_url: "https://jobs.lever.co/peakgames",
    ATS_name: "Lever"
  };
  const rawList = readJson(path.join(__dirname, "lever", "fixtures", "employment-location.json"));
  const expectedRows = readJson(path.join(__dirname, "lever", "fixtures", "employment-location-expected.json"));

  const parsed = source.parse(rawList, company);
  assert.equal(parsed.length, expectedRows.length);
  assert.equal(parsed[0].location, null);
  assert.equal(parsed[0].workplaceType, null);
  assert.equal(parsed[0].employment_type, "Full-time");

  const normalized = source.normalize(parsed[0], company);
  const expected = expectedRows[0];
  assert.equal(normalized.source_job_id, expected.source_job_id);
  assert.equal(normalized.company_name, expected.company_name);
  assert.equal(normalized.position_name, expected.position_name);
  assert.equal(normalized.canonical_url, expected.job_posting_url);
  assert.equal(normalized.location_text || "", expected.location_text);
  assert.equal(normalized.country || "", expected.country);
  assert.equal(normalized.region || "", expected.region);
  assert.equal(normalized.city || "", expected.city);
  assert.equal(normalized.remote_type, expected.remote_type);
  assert.equal(normalized.employment_type, expected.employment_type);

  const gate = source.validatePublic(normalized);
  assert.equal(gate.status, "quarantined");
  assert.ok(gate.reason_codes.includes("no_geo_no_remote"));
});

test("ashby source module normalizes source-provided location shorthand without shared ATS logic", () => {
  const source = getSourceModule("ashby");
  const company = readJson(path.join(__dirname, "ashby", "fixtures", "company.json"));
  const parsed = source.parse({
    jobs: [
      {
        id: "ash-nyc",
        title: "NYC Platform Engineer",
        location: "NYC",
        isRemote: false,
        publishedAt: "2026-05-14T08:00:00+03:00",
        jobUrl: "https://jobs.ashbyhq.com/fixtureco/ash-nyc"
      },
      {
        id: "ash-remote-us",
        title: "Remote US Support Lead",
        location: "Remote / US",
        isRemote: true,
        publishedAt: "2026-05-14T09:00:00+03:00",
        jobUrl: "https://jobs.ashbyhq.com/fixtureco/ash-remote-us"
      },
      {
        id: "ash-sf",
        title: "SF Data Engineer",
        location: "SF",
        isRemote: false,
        publishedAt: "2026-05-14T10:00:00+03:00",
        jobUrl: "https://jobs.ashbyhq.com/fixtureco/ash-sf"
      }
    ]
  }, company);
  const normalized = parsed.map((posting) => source.normalize(posting, company));
  const byId = new Map(normalized.map((posting) => [posting.source_job_id, posting]));

  const nyc = byId.get("ash-nyc");
  assert.equal(nyc.location_text, "New York, NY, United States");
  assert.equal(nyc.country, "United States");
  assert.equal(nyc.region, "North America");
  assert.equal(nyc.city, "New York");
  assert.equal(nyc.remote_type, "onsite");
  assert.equal(nyc.source_evidence.location_source, "list_api");
  assert.equal(nyc.source_evidence.location_path, "jobs[].location");
  assert.equal(nyc.source_evidence.location_rule_name, "ashby_city_shorthand");
  assert.equal(source.validatePublic(nyc).status, "accepted");

  const remoteUs = byId.get("ash-remote-us");
  assert.equal(remoteUs.location_text, "Remote / US");
  assert.equal(remoteUs.country, "United States");
  assert.equal(remoteUs.region, "North America");
  assert.equal(remoteUs.city || "", "");
  assert.equal(remoteUs.remote_type, "remote");
  assert.equal(remoteUs.source_evidence.location_source, "list_api");
  assert.equal(remoteUs.source_evidence.location_path, "jobs[].location");
  assert.equal(remoteUs.source_evidence.location_rule_name, "ashby_remote_country_hint");
  assert.equal(source.validatePublic(remoteUs).status, "accepted");

  const sf = byId.get("ash-sf");
  assert.equal(sf.location_text, "San Francisco, CA, United States");
  assert.equal(sf.country, "United States");
  assert.equal(sf.region, "North America");
  assert.equal(sf.city, "San Francisco");
  assert.equal(sf.remote_type, "onsite");
  assert.equal(sf.source_evidence.location_source, "list_api");
  assert.equal(sf.source_evidence.location_path, "jobs[].location");
  assert.equal(sf.source_evidence.location_rule_name, "ashby_city_shorthand");
  assert.equal(source.validatePublic(sf).status, "accepted");
});

test("bamboohr source module completes sparse structured EU locations without accepting ambiguous bases", () => {
  const source = getSourceModule("bamboohr");
  const company = readJson(path.join(__dirname, "bamboohr", "fixtures", "company.json"));
  const parsed = source.parse({
    result: [
      {
        id: "bhr-brussels",
        jobOpeningName: "Brussels Support Specialist",
        applicationUrl: "https://fixtureco.bamboohr.com/careers/bhr-brussels",
        location: {
          city: "Bruxelles",
          state: "Brussels"
        },
        isRemote: false
      },
      {
        id: "bhr-valletta",
        jobOpeningName: "Valletta Operations Analyst",
        applicationUrl: "https://fixtureco.bamboohr.com/careers/bhr-valletta",
        location: {},
        atsLocation: {
          city: "Valletta",
          province: "Malta",
          country: "Malta"
        },
        isRemote: false
      },
      {
        id: "bhr-multibase",
        jobOpeningName: "Clinical Specialist",
        applicationUrl: "https://fixtureco.bamboohr.com/careers/bhr-multibase",
        location: {
          city: "Multiple Bases (Phoenix, Denver, or Grand Junction)",
          state: "Arizona"
        },
        isRemote: false
      }
    ]
  }, company);
  const normalized = parsed.map((posting) => source.normalize(posting, company));
  const byId = new Map(normalized.map((posting) => [posting.source_job_id, posting]));

  const brussels = byId.get("bhr-brussels");
  assert.equal(brussels.location_text, "Bruxelles, Brussels, Belgium");
  assert.equal(brussels.country, "Belgium");
  assert.equal(brussels.region, "EMEA");
  assert.equal(brussels.city, "Bruxelles");
  assert.equal(brussels.remote_type, "onsite");
  assert.equal(brussels.source_evidence.location_source, "list_api");
  assert.equal(brussels.source_evidence.location_path, "result[].location");
  assert.equal(brussels.source_evidence.location_rule_name, "bamboohr_sparse_structured_location");
  assert.equal(source.validatePublic(brussels).status, "accepted");

  const valletta = byId.get("bhr-valletta");
  assert.equal(valletta.location_text, "Valletta, Malta");
  assert.equal(valletta.country, "Malta");
  assert.equal(valletta.region, "EMEA");
  assert.equal(valletta.city, "Valletta");
  assert.equal(valletta.remote_type, "onsite");
  assert.equal(valletta.source_evidence.location_source, "list_api");
  assert.equal(valletta.source_evidence.location_path, "result[].atsLocation");
  assert.equal(valletta.source_evidence.location_rule_name, "bamboohr_sparse_structured_location");
  assert.equal(source.validatePublic(valletta).status, "accepted");

  const multibase = byId.get("bhr-multibase");
  const gate = source.validatePublic(multibase);
  assert.equal(multibase.location_text, "Multiple Bases (Phoenix, Denver, or Grand Junction), Arizona, United States");
  assert.equal(multibase.country, "United States");
  assert.equal(multibase.city || "", "");
  assert.equal(gate.status, "quarantined");
  assert.ok(gate.reason_codes.includes("ambiguous_location"));
});

test("bamboohr source module maps locationType and country-token structured locations", () => {
  const source = getSourceModule("bamboohr");
  const company = readJson(path.join(__dirname, "bamboohr", "fixtures", "company.json"));
  const parsed = source.parse({
    result: [
      {
        id: "bhr-reykjavik",
        jobOpeningName: "Iceland General Application",
        applicationUrl: "https://fixtureco.bamboohr.com/careers/bhr-reykjavik",
        location: {
          city: "Reykjavik",
          state: "Iceland"
        },
        atsLocation: {
          country: null,
          province: null,
          city: null
        },
        isRemote: null,
        locationType: "0"
      },
      {
        id: "bhr-remote-milano",
        jobOpeningName: "Remote Sales Manager - Europe",
        applicationUrl: "https://fixtureco.bamboohr.com/careers/bhr-remote-milano",
        location: {
          city: null,
          state: null
        },
        atsLocation: {
          country: "Italy",
          province: "Lombardy",
          city: "Milano"
        },
        isRemote: null,
        locationType: "1"
      },
      {
        id: "bhr-hybrid-sansalvador",
        jobOpeningName: "Hybrid BI Analyst",
        applicationUrl: "https://fixtureco.bamboohr.com/careers/bhr-hybrid-sansalvador",
        location: {
          city: "El salvador",
          state: "San Salvador"
        },
        isRemote: null,
        locationType: "2"
      },
      {
        id: "bhr-netherlands",
        jobOpeningName: "Warehouse Coordinator",
        applicationUrl: "https://fixtureco.bamboohr.com/careers/bhr-netherlands",
        location: {
          city: "Netherlands",
          state: "Raamsdonksveer"
        },
        isRemote: null,
        locationType: "0"
      }
    ]
  }, company);
  const normalized = parsed.map((posting) => source.normalize(posting, company));
  const byId = new Map(normalized.map((posting) => [posting.source_job_id, posting]));

  const reykjavik = byId.get("bhr-reykjavik");
  assert.equal(reykjavik.location_text, "Reykjavik, Iceland");
  assert.equal(reykjavik.country, "Iceland");
  assert.equal(reykjavik.region, "EMEA");
  assert.equal(reykjavik.city, "Reykjavik");
  assert.equal(reykjavik.remote_type, "onsite");
  assert.equal(reykjavik.posting_date, null);
  assert.equal(reykjavik.source_evidence.location_source, "list_api");
  assert.equal(reykjavik.source_evidence.location_path, "result[].location");
  assert.equal(reykjavik.source_evidence.location_rule_name, "bamboohr_country_token_location");
  assert.equal(reykjavik.source_evidence.remote_source, "list_api");
  assert.equal(reykjavik.source_evidence.remote_path, "result[].locationType");
  assert.equal(reykjavik.source_evidence.remote_rule_name, "bamboohr_location_type");
  assert.equal(source.validatePublic(reykjavik).status, "accepted");

  const milano = byId.get("bhr-remote-milano");
  assert.equal(milano.location_text, "Milano, Lombardy, Italy");
  assert.equal(milano.country, "Italy");
  assert.equal(milano.city, "Milano");
  assert.equal(milano.remote_type, "remote");
  assert.equal(milano.source_evidence.location_path, "result[].atsLocation");
  assert.equal(milano.source_evidence.remote_path, "result[].locationType");
  assert.equal(source.validatePublic(milano).status, "accepted");

  const sanSalvador = byId.get("bhr-hybrid-sansalvador");
  assert.equal(sanSalvador.location_text, "San Salvador, El Salvador");
  assert.equal(sanSalvador.country, "El Salvador");
  assert.equal(sanSalvador.region, "LATAM");
  assert.equal(sanSalvador.city, "San Salvador");
  assert.equal(sanSalvador.remote_type, "hybrid");
  assert.equal(sanSalvador.source_evidence.location_rule_name, "bamboohr_country_token_location");
  assert.equal(source.validatePublic(sanSalvador).status, "accepted");

  const netherlands = byId.get("bhr-netherlands");
  assert.equal(netherlands.location_text, "Raamsdonksveer, Netherlands");
  assert.equal(netherlands.country, "Netherlands");
  assert.equal(netherlands.city, "Raamsdonksveer");
  assert.equal(netherlands.remote_type, "onsite");
  assert.equal(netherlands.source_evidence.location_rule_name, "bamboohr_country_token_location");
  assert.equal(source.validatePublic(netherlands).status, "accepted");
});

function zohoFixtureContext() {
  return {
    source: getSourceModule("zoho"),
    company: readJson(path.join(__dirname, "zoho", "fixtures", "company.json"))
  };
}

test("zoho source module parses hidden JSON variants for localized geo and remote evidence", () => {
  const { source, company } = zohoFixtureContext();
  const rawList = readJson(path.join(__dirname, "zoho", "fixtures", "list.json"));
  const parsed = source.parse(rawList, company);
  const normalized = parsed.map((posting) => source.normalize(posting, company));
  const byId = new Map(normalized.map((posting) => [posting.source_job_id, posting]));

  assert.equal(normalized.length, 5);

  const remote = byId.get("476000000001002");
  assert.equal(remote.position_name, "Remote Customer Advocate");
  assert.equal(remote.location_text, "Remote");
  assert.equal(remote.country, "");
  assert.equal(remote.city, "");
  assert.equal(remote.remote_type, "remote");
  assert.equal(source.validatePublic(remote).status, "accepted");

  const hybrid = byId.get("476000000001003");
  assert.equal(hybrid.position_name, "Hybrid Implementation Lead");
  assert.equal(hybrid.location_text, "Hybrid");
  assert.equal(hybrid.remote_type, "hybrid");
  assert.equal(source.validatePublic(hybrid).status, "accepted");

  const localized = byId.get("476000000001004");
  assert.equal(localized.position_name, "Localized Country Analyst");
  assert.equal(localized.country, "Turkey");
  assert.equal(localized.city, "Istanbul");
  assert.equal(localized.remote_type, "onsite");
  assert.equal(localized.posting_date, "2026-05-09");
  assert.equal(source.validatePublic(localized).status, "accepted");

  const sparseDate = byId.get("476000000001005");
  assert.equal(sparseDate.position_name, "Sparse Date Operations");
  assert.equal(sparseDate.country, "Portugal");
  assert.equal(sparseDate.posting_date, null);
  assert.equal(source.validatePublic(sparseDate).status, "accepted");
});

test("zoho source module ignores malformed hidden JSON and rows without source ids", () => {
  const { source, company } = zohoFixtureContext();

  assert.deepEqual(
    source.parse("<input id=\"jobs\" value='not-json'>", company),
    []
  );
  assert.deepEqual(
    source.parse("<input id=\"jobs\" value='[{\"Posting_Title\":\"Missing ID\",\"City\":\"Dublin\",\"Country\":\"Ireland\"}]'>", company),
    []
  );
});

function recruitCrmFixtureContext() {
  return {
    source: getSourceModule("recruitcrm"),
    company: readJson(path.join(__dirname, "recruitcrm", "fixtures", "company.json"))
  };
}

test("recruitcrm source module discovers the public jobs API route", () => {
  const { source, company } = recruitCrmFixtureContext();
  const discovered = source.discover(company);

  assert.equal(
    discovered.list_url,
    "https://albatross.recruitcrm.io/v1/external-pages/jobs-by-account/get?account=fixtureco&batch=true"
  );
  assert.equal(discovered.config.publicJobsUrl, "https://recruitcrm.io/jobs/fixtureco");
});

test("recruitcrm source module keeps remote evidence source-specific", () => {
  const { source, company } = recruitCrmFixtureContext();
  const rawList = readJson(path.join(__dirname, "recruitcrm", "fixtures", "list.json"));
  const parsed = source.parse(rawList, company);
  const normalized = parsed.map((posting) => source.normalize(posting, company));
  const byId = new Map(normalized.map((posting) => [posting.source_job_id, posting]));

  const remote = byId.get("remote-talent-partner");
  assert.equal(remote.location_text, "Remote");
  assert.equal(remote.remote_type, "remote");
  assert.equal(source.validatePublic(remote).status, "accepted");

  const onsite = byId.get("rc-2002");
  assert.equal(onsite.city, "Toronto");
  assert.equal(onsite.country, "Canada");
  assert.equal(onsite.remote_type, "onsite");
  assert.equal(source.validatePublic(onsite).status, "accepted");
});

test("recruitcrm source module preserves nested and string location evidence", () => {
  const { source, company } = recruitCrmFixtureContext();
  const parsed = source.parse({
    data: {
      jobs: [
        {
          id: "rc-geo-object",
          name: "Berlin Delivery Lead",
          slug: "berlin-delivery-lead",
          posted_at: "2026-05-09",
          remote: "0",
          location: {
            city: "Berlin",
            state: "Berlin",
            country: "Germany"
          }
        },
        {
          id: "rc-geo-string",
          name: "Lisbon Success Manager",
          slug: "lisbon-success-manager",
          posted_at: "2026-05-09",
          remote: "0",
          job_location: "Lisbon, Portugal"
        }
      ]
    }
  }, company);
  const normalized = parsed.map((posting) => source.normalize(posting, company));
  const byId = new Map(normalized.map((posting) => [posting.source_job_id, posting]));

  const objectLocation = byId.get("rc-geo-object");
  assert.equal(objectLocation.location_text, "Berlin, Berlin, Germany");
  assert.equal(objectLocation.city, "Berlin");
  assert.equal(objectLocation.country, "Germany");
  assert.equal(objectLocation.remote_type, "onsite");
  assert.equal(source.validatePublic(objectLocation).status, "accepted");

  const stringLocation = byId.get("rc-geo-string");
  assert.equal(stringLocation.location_text, "Lisbon, Portugal");
  assert.equal(stringLocation.country, "Portugal");
  assert.equal(stringLocation.remote_type, "onsite");
  assert.equal(source.validatePublic(stringLocation).status, "accepted");
});

test("recruitcrm source module quarantines malformed or unsupported raw list shapes", () => {
  const { source, company } = recruitCrmFixtureContext();
  const malformed = readJson(path.join(__dirname, "recruitcrm", "fixtures", "malformed-list-shapes.json"));

  for (const item of malformed.cases) {
    const parsed = source.parse(item.payload, company);
    assert.equal(parsed.length, item.expected_count, item.name);
    if (item.expected_count === 0) continue;

    const normalized = source.normalize(parsed[0], company);
    const basic = source.validate(normalized);
    if (item.expected_status === "rejected") {
      assert.equal(basic.ok, false, `${item.name} should fail source validation`);
      assert.match(basic.error, new RegExp(item.expected_reason), item.name);
      continue;
    }
    const gate = source.validatePublic(normalized);
    if (item.expected_reason === "no_structured_location") {
      assert.ok(
        normalized.source_failure_reasons.includes(item.expected_reason),
        `${item.name} should include source failure ${item.expected_reason}`
      );
      continue;
    }
    assert.equal(gate.status, item.expected_status, item.name);
    assert.ok(gate.reason_codes.includes(item.expected_reason), `${item.name} should include ${item.expected_reason}`);
  }
});

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

  assert.equal(normalized.length, 4);

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

  const localized = byId.get("rec-1004");
  assert.equal(localized.position_name, "Localized Customer Success Lead");
  assert.equal(localized.location_text, "Berlin, Germany");
  assert.equal(localized.city, "Berlin");
  assert.equal(localized.country, "Germany");
  assert.equal(localized.remote_type, "hybrid");
  assert.equal(localized.department, "Customer Success");
  assert.equal(localized.posting_date, "2026-05-09T11:15:00+03:00");
  assert.equal(source.validatePublic(localized).status, "accepted");
});

test("recruitee source module parses embedded PublicApp data-props without fabricating missing fields", () => {
  const { source, company } = recruiteeFixtureContext();
  const props = {
    appConfig: {
      primaryLangCode: "en",
      locations: [{ id: 40, city: "Paris", country: "France" }],
      departments: [{ id: 9, name: "Sales" }],
      offers: [
        {
          id: 1005,
          slug: "sales-engineer",
          translations: { en: { title: "Sales Engineer" } },
          locationIds: [40],
          departmentId: 9,
          workplace_type: "On-site",
          published_at: "2026-05-10T12:00:00+03:00"
        }
      ]
    }
  };
  const html = `<div data-component="PublicApp" data-props="${JSON.stringify(props).replace(/"/g, "&quot;")}"></div>`;
  const parsed = source.parse({ html }, company);
  assert.equal(parsed.length, 1);
  const normalized = source.normalize(parsed[0], company);
  assert.equal(normalized.source_job_id, "1005");
  assert.equal(normalized.position_name, "Sales Engineer");
  assert.equal(normalized.country, "France");
  assert.equal(normalized.city, "Paris");
  assert.equal(normalized.remote_type, "onsite");
  assert.equal(source.validatePublic(normalized).status, "accepted");
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
