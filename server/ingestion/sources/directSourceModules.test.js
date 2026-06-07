const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const { evaluatePublicPosting } = require("../publicPostingGate");
const { DIRECT_SOURCE_ATS_KEYS, getSourceModule, sourceModules } = require("./index");

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
  "personio",
  "workable",
  "isolvisolvedhire",
  "talexio",
  "zoho"
]);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function listSourceLocalModuleDirs() {
  return fs.readdirSync(__dirname, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((atsKey) => fs.existsSync(path.join(__dirname, atsKey, "index.js")))
    .sort();
}

function hasSourceModuleContract(source = {}) {
  return ["discover", "fetchList", "parse", "normalize", "validate"].every(
    (name) => typeof source?.[name] === "function"
  );
}

test("source index registers every source-local module directory", () => {
  const sourceLocalDirs = listSourceLocalModuleDirs();
  const missingFromDirectKeys = sourceLocalDirs.filter((atsKey) => !DIRECT_SOURCE_ATS_KEYS.includes(atsKey));
  assert.deepEqual(missingFromDirectKeys, []);

  for (const atsKey of sourceLocalDirs) {
    const source = getSourceModule(atsKey);
    assert.ok(source, `${atsKey} should load from the source index`);
    assert.equal(hasSourceModuleContract(source), true, `${atsKey} should expose the source module contract`);
  }
});

test("source modules publish only source-local fixture paths", () => {
  assert.equal(sourceModules.size, DIRECT_SOURCE_ATS_KEYS.length);
  for (const [atsKey, source] of sourceModules) {
    assert.equal(typeof source.fixtures, "function", `${atsKey} should expose fixtures()`);
    const fixtures = source.fixtures();
    assert.ok(Array.isArray(fixtures), `${atsKey} fixtures() should return an array`);
    assert.ok(fixtures.length > 0, `${atsKey} should publish fixture paths`);
    for (const fixturePath of fixtures) {
      const normalizedPath = String(fixturePath || "").replace(/\\/g, "/");
      assert.ok(
        normalizedPath.startsWith(`server/ingestion/sources/${atsKey}/fixtures/`),
        `${atsKey} fixture should be source-local: ${normalizedPath}`
      );
      assert.ok(fs.existsSync(path.resolve(normalizedPath)), `${atsKey} fixture should exist: ${normalizedPath}`);
    }
  }
});

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

test("greenhouse source module merges office geo and work-mode evidence", () => {
  const source = getSourceModule("greenhouse");
  const sourceDir = path.join(__dirname, "greenhouse");
  const company = readJson(path.join(sourceDir, "fixtures", "company.json"));
  const rawList = readJson(path.join(sourceDir, "fixtures", "list.json"));
  const rows = source.parse(rawList, company).map((posting) => source.normalize(posting, company));

  const remotePakistan = rows.find((row) => row.source_job_id === "2002");
  assert.equal(remotePakistan.location_text, "Remote, Pakistan");
  assert.equal(remotePakistan.country, "Pakistan");
  assert.equal(remotePakistan.region, "APAC");
  assert.equal(remotePakistan.city, "");
  assert.equal(remotePakistan.remote_type, "remote");
  assert.equal(remotePakistan.evidence.country.evidence_path, "jobs[].offices[].name");
  assert.equal(remotePakistan.evidence.remote_type.evidence_path, "jobs[].location.name");

  const hybridPakistan = rows.find((row) => row.source_job_id === "2003");
  assert.equal(hybridPakistan.country, "Pakistan");
  assert.equal(hybridPakistan.city, "Lahore");
  assert.equal(hybridPakistan.remote_type, "hybrid");

  const stateOffice = rows.find((row) => row.source_job_id === "2004");
  assert.equal(stateOffice.country, "United States");
  assert.equal(stateOffice.city, "South Jersey");
  assert.equal(stateOffice.remote_type, "unknown");
  assert.equal(stateOffice.evidence.remote_type.present, false);

  const remoteOffice = rows.find((row) => row.source_job_id === "2005");
  assert.equal(remoteOffice.country, "United States");
  assert.equal(remoteOffice.remote_type, "remote");
  assert.equal(remoteOffice.evidence.remote_type.evidence_path, "jobs[].offices[].name");

  const cityWithRemoteOffice = rows.find((row) => row.source_job_id === "2006");
  assert.equal(cityWithRemoteOffice.country, "United States");
  assert.equal(cityWithRemoteOffice.city, "Washington D.C");
  assert.equal(cityWithRemoteOffice.remote_type, "onsite");
  assert.notEqual(cityWithRemoteOffice.evidence.remote_type.evidence_path, "jobs[].offices[].name");

  const countryCity = rows.find((row) => row.source_job_id === "2007");
  assert.equal(countryCity.location_text, "Islamabad, Pakistan");
  assert.equal(countryCity.country, "Pakistan");
  assert.equal(countryCity.city, "Islamabad");
  assert.equal(countryCity.remote_type, "onsite");
});

test("gem source module parses list fixture and emits strict normalized evidence", () => {
  const source = getSourceModule("gem");
  assert.ok(source, "expected gem source module");
  const sourceDir = path.join(__dirname, "gem");
  const company = readJson(path.join(sourceDir, "fixtures", "company.json"));
  const rawList = readJson(path.join(sourceDir, "fixtures", "list.json"));
  const expectedRows = readJson(path.join(sourceDir, "fixtures", "expected-normalized.json"));

  const discovered = source.discover(company);
  assert.equal(discovered.ats_key, "gem");
  assert.ok(source.parserVersion.startsWith("source-gem-v"));
  assert.deepEqual(source.qualityThreshold().public_requires_geo_or_explicit_remote, true);

  const parsed = source.parse(rawList, company);
  assert.equal(parsed.length, expectedRows.length);
  const normalized = parsed.map((posting) => source.normalize(posting, company));

  for (let index = 0; index < expectedRows.length; index += 1) {
    const expected = expectedRows[index];
    const row = normalized[index];
    assert.equal(source.validate(row).ok, true);
    assert.equal(row.ats_key, "gem");
    assert.equal(row.parser_key, "gem");
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
    assert.equal(gate.status, "accepted", "gem valid fixture should pass public gate");
  }

  const byId = new Map(normalized.map((row) => [row.source_job_id, row]));
  const remoteUs = byId.get("6002");
  assert.equal(remoteUs.country, "United States");
  assert.equal(remoteUs.city, "");
  assert.equal(remoteUs.remote_type, "remote");
  assert.equal(remoteUs.evidence.country.evidence_path, "jobPostings[].locations[].isoCountry");
  assert.equal(remoteUs.evidence.remote_type.evidence_path, "jobPostings[].job.locationType");

  const hybridItaly = byId.get("6003");
  assert.equal(hybridItaly.country, "Italy");
  assert.equal(hybridItaly.city, "Bari");
  assert.equal(hybridItaly.remote_type, "hybrid");
  assert.equal(hybridItaly.evidence.city.evidence_path, "jobPostings[].locations[].city");

  const globalRemote = byId.get("6004");
  assert.equal(globalRemote.location_text, "Remote");
  assert.equal(globalRemote.city, "");
  assert.equal(globalRemote.country, "");
  assert.equal(globalRemote.remote_type, "remote");
});

test("gem source module rejects or quarantines invalid-shape fixtures", () => {
  const source = getSourceModule("gem");
  const sourceDir = path.join(__dirname, "gem");
  const company = readJson(path.join(sourceDir, "fixtures", "company.json"));
  const invalid = readJson(path.join(sourceDir, "fixtures", "invalid-shapes.json"));

  for (const item of invalid.cases) {
    const normalized = source.normalize(item.posting, company);
    const basic = source.validate(normalized);
    const gate = evaluatePublicPosting(normalized, { parserVersion: source.parserVersion });
    if (item.expected === "rejected") {
      assert.equal(basic.ok, false, `gem ${item.name} should fail source validation`);
      assert.match(basic.error, new RegExp(item.reason));
    } else {
      assert.equal(basic.ok, true, `gem ${item.name} should pass basic validation`);
      assert.equal(gate.status, "quarantined", `gem ${item.name} should be quarantined`);
      assert.ok(gate.reason_codes.includes(item.reason), `gem ${item.name} should include ${item.reason}`);
    }
  }
});

test("gem source module fetches API payload through source-local discovery and preserves array parse shape", async () => {
  const source = getSourceModule("gem");
  const company = readJson(path.join(__dirname, "gem", "fixtures", "company.json"));
  const calls = [];
  const listPayload = [
    {
      data: {
        oatsExternalJobPostings: {
          jobPostings: [
            {
              id: "6002",
              title: "Runtime Gem Role",
              locations: [{ id: "runtime", name: "Remote", city: "Austin", isoCountry: "US", isRemote: true }]
            }
          ]
        }
      }
    }
  ];

  const payload = await source.fetchList(company, {
    fetcher: async (url, target) => {
      calls.push({ url, method: target.method, hasBody: typeof target.body === "string" });
      assert.equal(target.body.includes("JobBoardList"), true);
      return listPayload;
    }
  });

  assert.deepEqual(calls, [{
    url: "https://jobs.gem.com/api/public/graphql/batch",
    method: "POST",
    hasBody: true
  }]);
  assert.ok(Array.isArray(payload), "gem fetchList payload should stay an array");
  assert.deepEqual(payload.__sourceConfig.boardId, "fixtureco");
  const parsed = source.parse(payload, company);
  assert.equal(parsed.length, 1);
});

test("gem source module rejects empty or invalid JSON API payloads", async () => {
  const source = getSourceModule("gem");
  const company = readJson(path.join(__dirname, "gem", "fixtures", "company.json"));

  await assert.rejects(
    () => source.fetchList(company, {
      fetcher: async () => ({
        status: 200,
        url: "https://jobs.gem.com/api/public/graphql/batch",
        body: ""
      })
    }),
    /Gem API response body is empty/
  );

  await assert.rejects(
    () => source.fetchList(company, {
      fetcher: async () => ({
        status: 200,
        url: "https://jobs.gem.com/api/public/graphql/batch",
        body: "not json"
      })
    }),
    /Gem API response is not valid JSON/
  );
});

test("smartrecruiters source module fetches search API with source-local discovery and host guard", async () => {
  const source = getSourceModule("smartrecruiters");
  const company = readJson(path.join(__dirname, "smartrecruiters", "fixtures", "company.json"));
  const calls = [];

  const payload = await source.fetchList(company, {
    fetcher: async (url, target) => {
      calls.push({ url, method: target.method, headers: target.headers });
      return {
        content: [
          {
            id: "743999999995",
            name: "Runtime SmartRecruiters Role",
            applyUrl: "https://jobs.smartrecruiters.com/FixtureCo/743999999995-runtime-role",
            company: { name: "Fixture SmartRecruiters" },
            location: { city: "Austin", region: "TX", country: "United States" },
            releasedDate: "2026-05-08T08:00:00-05:00"
          }
        ],
        __sourceFetchFinalUrl: "https://jobs.smartrecruiters.com/sr-jobs/search?company=fixtureco&limit=100"
      };
    }
  });

  assert.deepEqual(calls, [{
    url: "https://jobs.smartrecruiters.com/sr-jobs/search?company=fixtureco&limit=100",
    method: "GET",
    headers: { Accept: "application/json, text/plain, */*" }
  }]);
  assert.equal(payload.__sourceConfig.companySlugLower, "fixtureco");
  const parsed = source.parse(payload, company);
  assert.equal(parsed.length, 1);

  await assert.rejects(
    () => source.fetchList(company, {
      fetcher: async () => ({
        content: [],
        __sourceFetchFinalUrl: "https://unexpected.example/sr-jobs/search?company=fixtureco"
      })
    }),
    /SmartRecruiters API URL redirected to unexpected host/
  );
});

test("target direct ATS modules return no postings for empty raw payloads", () => {
  for (const atsKey of ["recruitcrm", "recruitee"]) {
    const source = getSourceModule(atsKey);
    const company = readJson(path.join(__dirname, atsKey, "fixtures", "company.json"));
    assert.deepEqual(source.parse({}, company), [], atsKey);
  }
});

test("fountain source module fetches the board JSON endpoint with source-local discovery", async () => {
  const source = getSourceModule("fountain");
  const company = readJson(path.join(__dirname, "fountain", "fixtures", "company.json"));
  const calls = [];

  const payload = await source.fetchList(company, {
    fetcher: async (url, target) => {
      calls.push({ url, method: target.method, headers: target.headers });
      return {
        openings: [
          {
            id: 1001,
            title: "Fixture Fountain Role",
            to_param: "fixture-fountain-role",
            location_name: "Austin, TX"
          }
        ]
      };
    }
  });

  assert.deepEqual(calls, [{
    url: "https://web.fountain.com/c/fixtureco/jobs/board.json",
    method: "GET",
    headers: { Accept: "application/json, text/plain, */*" }
  }]);
  assert.equal(payload.__sourceConfig.boardUrl, "https://web.fountain.com/c/fixtureco/jobs/board");
  assert.equal(payload.__sourceConfig.companySlugLower, "fixtureco");
  assert.equal(payload.openings.length, 1);
});

test("fountain source module follows bounded JSON pagination", async () => {
  const source = getSourceModule("fountain");
  const company = readJson(path.join(__dirname, "fountain", "fixtures", "company.json"));
  const calls = [];

  const payload = await source.fetchList(company, {
    maxFountainPages: 2,
    fetcher: async (url, target) => {
      calls.push({ url, method: target.method });
      if (url.endsWith("board.json")) {
        return {
          openings: [{ id: "page-1", title: "Page One", to_param: "page-one", location_name: "Madrid, Spain" }],
          pagination: { current_page: 1, next_page: 2, total_pages: 3 }
        };
      }
      return {
        openings: [{ id: "page-2", title: "Page Two", to_param: "page-two", location_name: "Lisbon, Portugal" }],
        pagination: { current_page: 2, next_page: 3, total_pages: 3 }
      };
    }
  });

  assert.deepEqual(calls, [
    { url: "https://web.fountain.com/c/fixtureco/jobs/board.json", method: "GET" },
    { url: "https://web.fountain.com/c/fixtureco/jobs/board.json?page=2", method: "GET" }
  ]);
  assert.equal(payload.openings.length, 2);
  assert.equal(payload.__sourceFetchPageCount, 2);
  assert.equal(payload.__sourceFetchTruncated, true);
});

test("fountain source module prefers structured location_address geo evidence", () => {
  const source = getSourceModule("fountain");
  const company = readJson(path.join(__dirname, "fountain", "fixtures", "company.json"));
  const rawList = readJson(path.join(__dirname, "fountain", "fixtures", "list.json"));
  const parsed = source.parse(rawList, company);
  const normalized = parsed.map((posting) => source.normalize(posting, company));
  const structured = normalized.find((row) => row.source_job_id === "18ad4902-cef9-46fb-ba10-2a599b5fc4ce");

  assert.equal(structured.location_text, "Tampa, FL, United States");
  assert.equal(structured.country, "United States");
  assert.equal(structured.region, "North America");
  assert.equal(structured.city, "Tampa");
  assert.equal(structured.remote_type, "onsite");
  assert.equal(structured.evidence.country.evidence_path, "openings[].location_address");
  assert.equal(source.validatePublic(structured).status, "accepted");
});

test("fountain source module parses structured address variants without state-code metadata", () => {
  const { extractFountainAddressEvidence } = require("./fountain/parse");

  assert.deepEqual(extractFountainAddressEvidence({ location_address: "Toronto, ON, Canada" }), {
    city: "Toronto",
    state: "ON",
    country: "Canada",
    location: "Toronto, ON, Canada"
  });
  assert.deepEqual(extractFountainAddressEvidence({ location_address: "123 Main St, Tampa, FL, 33612, US" }), {
    city: "Tampa",
    state: "FL",
    country: "United States",
    location: "Tampa, FL, United States"
  });
});

test("pinpointhq source module fetches postings JSON with source-local cache-busting metadata", async () => {
  const source = getSourceModule("pinpointhq");
  const company = readJson(path.join(__dirname, "pinpointhq", "fixtures", "company.json"));
  const calls = [];

  const payload = await source.fetchList(company, {
    now: () => 1779726000000,
    fetcher: async (url, target) => {
      calls.push({ url, method: target.method, headers: target.headers });
      return {
        data: [{
          id: "pin-9001",
          title: "Remote Pinpoint Fixture",
          path: "/postings/remote-pinpoint-fixture",
          posted_at: "2026-05-25T10:00:00Z",
          location: {
            city: "Remote",
            name: "United States"
          },
          workplace_type_text: "Remote"
        }]
      };
    }
  });

  assert.deepEqual(calls, [{
    url: "https://fixtureco.pinpointhq.com/postings.json?_=1779726000000",
    method: "GET",
    headers: { Accept: "application/json, text/plain, */*" }
  }]);
  assert.equal(payload.__sourceConfig.apiUrl, "https://fixtureco.pinpointhq.com/postings.json");
  const parsed = source.parse(payload, company);
  assert.equal(parsed.length, 1);
  const normalized = source.normalize(parsed[0], company);
  assert.equal(normalized.source_job_id, "pin-9001");
  assert.equal(normalized.country, "United States");
  assert.equal(normalized.remote_type, "remote");
  assert.equal(source.validatePublic(normalized).status, "accepted");

  await assert.rejects(
    () => source.fetchList(company, {
      now: () => 1779726000000,
      fetcher: async () => ({
        __sourceFetchFinalUrl: "https://example.com/postings.json",
        data: []
      })
    }),
    /unexpected host/
  );
});

test("rippling source module fetches paginated board API with source-local discovery", async () => {
  const source = getSourceModule("rippling");
  assert.ok(source, "expected rippling source module");
  const company = readJson(path.join(__dirname, "rippling", "fixtures", "company.json"));
  const listFixture = readJson(path.join(__dirname, "rippling", "fixtures", "list.json"));
  const calls = [];
  const firstPageUrl = "https://ats.rippling.com/api/v2/board/fixtureco/jobs";
  const secondPageUrl = "https://ats.rippling.com/api/v2/board/fixtureco/jobs?page=1&pageSize=100";
  const payloadsByUrl = new Map([
    [firstPageUrl, { items: [listFixture.items[0]], totalPages: 2 }],
    [secondPageUrl, { items: [listFixture.items[1]], totalPages: 2 }]
  ]);

  const payload = await source.fetchList(company, {
    fetcher: async (url, target) => {
      calls.push({ url, method: target.method, headers: target.headers });
      return {
        status: 200,
        url,
        ...(payloadsByUrl.get(url) || { items: [], totalPages: 2 })
      };
    }
  });

  assert.deepEqual(calls, [
    {
      url: firstPageUrl,
      method: "GET",
      headers: { Accept: "application/json, text/plain, */*" }
    },
    {
      url: secondPageUrl,
      method: "GET",
      headers: { Accept: "application/json, text/plain, */*" }
    }
  ]);
  assert.equal(payload.__sourceConfig.apiUrl, firstPageUrl);
  assert.equal(payload.items.length, 2);

  const parsed = source.parse(payload, company);
  assert.equal(parsed.length, 2);
  const normalized = parsed.map((posting) => source.normalize(posting, company));
  const byId = new Map(normalized.map((posting) => [posting.source_job_id, posting]));

  const remote = byId.get("rip-remote-1");
  assert.equal(remote.country, "United States");
  assert.equal(remote.remote_type, "remote");
  assert.equal(source.validatePublic(remote).status, "accepted");

  const hybrid = byId.get("rip-hybrid-2");
  assert.equal(hybrid.country, "United Kingdom");
  assert.equal(hybrid.remote_type, "hybrid");
  assert.equal(source.validatePublic(hybrid).status, "accepted");

  const fixtureRows = source.parse(listFixture, company).map((posting) => source.normalize(posting, company));
  const structured = fixtureRows.find((posting) => posting.source_job_id === "rip-structured-3");
  assert.ok(structured, "expected structured Rippling location fixture row");
  assert.equal(structured.location_text, "San Antonio, Texas, United States");
  assert.equal(structured.city, "San Antonio");
  assert.equal(structured.country, "United States");
  assert.equal(structured.remote_type, "remote");
  assert.equal(source.validatePublic(structured).status, "accepted");

  const remoteState = fixtureRows.find((posting) => posting.source_job_id === "rip-remote-state-4");
  assert.ok(remoteState, "expected structured Rippling remote-state fixture row");
  assert.equal(remoteState.location_text, "TX, United States");
  assert.equal(remoteState.city, "");
  assert.equal(remoteState.country, "United States");
  assert.equal(remoteState.remote_type, "remote");
  assert.equal(source.validatePublic(remoteState).status, "accepted");

  const stateNameCity = fixtureRows.find((posting) => posting.source_job_id === "rip-structured-state-city-5");
  assert.ok(stateNameCity, "expected structured Rippling city/state fixture row");
  assert.equal(stateNameCity.location_text, "New York, New York, United States");
  assert.equal(stateNameCity.city, "New York");
  assert.equal(stateNameCity.country, "United States");
  assert.equal(stateNameCity.remote_type, "onsite");
  assert.equal(stateNameCity.source_evidence.city_path, "items[].locations[].city");
  assert.equal(stateNameCity.source_evidence.city_rule_name, "rippling_structured_location_city");
  assert.equal(stateNameCity.source_evidence.country_path, "items[].locations[].country|countryCode");
  assert.equal(stateNameCity.source_evidence.remote_rule_name, "rippling_structured_workplace_type");
  assert.equal(source.validatePublic(stateNameCity).status, "accepted");

  await assert.rejects(
    () => source.fetchList(company, {
      fetcher: async () => ({
        status: 200,
        __sourceFetchFinalUrl: "https://example.com/api/v2/board/fixtureco/jobs",
        items: []
      })
    }),
    /unexpected host/
  );
});

test("manatal source module fetches landing runtime config and paginated jobs API", async () => {
  const source = getSourceModule("manatal");
  assert.ok(source, "expected manatal source module");
  const company = readJson(path.join(__dirname, "manatal", "fixtures", "company.json"));
  const listFixture = readJson(path.join(__dirname, "manatal", "fixtures", "list.json"));
  const calls = [];
  const landingUrl = "https://www.careers-page.com/fixture-manatal/";
  const pageQuery = (page) => new URLSearchParams({
    page: String(page),
    page_size: "50",
    ordering: "-is_pinned_in_career_page,-last_published_at"
  }).toString();
  const firstPageUrl = `https://www.careers-page.com/api/v1.0/c/fixture-manatal/jobs/?${pageQuery(1)}`;
  const secondPageUrl = `https://www.careers-page.com/api/v1.0/c/fixture-manatal/jobs/?${pageQuery(2)}`;
  const landingHtml = `
    <html>
      <script>
        const baseUrl = "https://www.careers-page.com";
        const clientSlug = "fixture-manatal";
      </script>
    </html>`;

  const payload = await source.fetchList(company, {
    fetcher: async (url, target) => {
      calls.push({
        url,
        method: target.method,
        accept: target.headers?.Accept || "",
        referer: target.headers?.Referer || ""
      });
      if (url === landingUrl) {
        return {
          status: 200,
          url,
          body: landingHtml
        };
      }
      if (url === firstPageUrl) {
        return {
          status: 200,
          url,
          count: 2,
          next: secondPageUrl,
          results: [listFixture.results[0]]
        };
      }
      if (url === secondPageUrl) {
        return {
          status: 200,
          url,
          count: 2,
          next: null,
          results: [listFixture.results[1]]
        };
      }
      throw new Error(`unexpected Manatal fetch URL ${url}`);
    }
  });

  assert.deepEqual(calls, [
    {
      url: landingUrl,
      method: "GET",
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      referer: ""
    },
    {
      url: firstPageUrl,
      method: "GET",
      accept: "application/json, text/plain, */*",
      referer: landingUrl
    },
    {
      url: secondPageUrl,
      method: "GET",
      accept: "application/json, text/plain, */*",
      referer: landingUrl
    }
  ]);
  assert.equal(payload.__sourceConfig.jobsApiUrl, "https://www.careers-page.com/api/v1.0/c/fixture-manatal/jobs/");
  assert.equal(payload.results.length, 2);

  const parsed = source.parse(payload, company);
  assert.equal(parsed.length, 2);
  const normalized = parsed.map((posting) => source.normalize(posting, company));
  const byId = new Map(normalized.map((posting) => [posting.source_job_id, posting]));

  const remote = byId.get("4R846955");
  assert.equal(remote.country, "Canada");
  assert.equal(remote.remote_type, "remote");
  assert.equal(source.validatePublic(remote).status, "accepted");

  const hybrid = byId.get("DATEHASH");
  assert.equal(hybrid.country, "Cambodia");
  assert.equal(hybrid.remote_type, "hybrid");
  assert.equal(source.validatePublic(hybrid).status, "accepted");

  await assert.rejects(
    () => source.fetchList(company, {
      fetcher: async () => ({
        status: 200,
        __sourceFetchFinalUrl: "https://example.com/fixture-manatal",
        body: landingHtml
      })
    }),
    /unexpected host/
  );
});

test("manatal source module treats closed careers pages as source-unavailable empty boards", async () => {
  const source = getSourceModule("manatal");
  const company = {
    company_name: "Closed Manatal",
    url_string: "https://www.careers-page.com/closed-fixture"
  };

  const raw = await source.fetchList(company, {
    fetcher: async (url) => ({
      status: 404,
      url,
      body: "<html>not found</html>"
    })
  });

  assert.equal(raw.__sourceUnavailable, true);
  assert.equal(raw.__sourceUnavailableReason, "manatal_careers_page_not_found");
  assert.deepEqual(raw.results, []);
  assert.deepEqual(source.parse(raw, company), []);
});

test("gem source module marks empty jobPostings GraphQL boards as empty-list payloads", () => {
  const source = getSourceModule("gem");
  assert.deepEqual(source.payloadShapePolicy.empty_job_list_stems, ["[].data.oatsExternalJobPostings.jobPostings"]);
  const company = readJson(path.join(__dirname, "gem", "fixtures", "company.json"));
  const raw = [
    {
      data: {
        oatsExternalJobPostings: {
          jobPostings: []
        }
      }
    }
  ];
  raw.__sourceConfig = source.discover(company).config;
  assert.deepEqual(source.parse(raw, company), []);
});

test("workable source module discovers the public accounts endpoint without token handling", () => {
  const source = getSourceModule("workable");
  const discovered = source.discover({
    company_name: "Fixture Workable",
    url_string: "https://www.workable.com/api/accounts/fixtureco?details=true"
  });
  assert.equal(discovered.ats_key, "workable");
  assert.equal(discovered.config.subdomain, "fixtureco");
  assert.equal(discovered.list_url, "https://www.workable.com/api/accounts/fixtureco?details=true");
});

test("personio and workable source modules do not accept title-only remote evidence", () => {
  const cases = [
    {
      atsKey: "personio",
      company: {
        company_name: "Fixture Personio",
        url_string: "https://fixtureco.jobs.personio.de/"
      },
      raw: {
        xml: "<?xml version=\"1.0\" encoding=\"UTF-8\"?><workzag-jobs><position><id>title-remote</id><name>Remote Integration Engineer</name><jobUrl>https://fixtureco.jobs.personio.de/job/title-remote</jobUrl></position></workzag-jobs>"
      }
    },
    {
      atsKey: "workable",
      company: {
        company_name: "Fixture Workable",
        url_string: "https://fixtureco.workable.com/"
      },
      raw: {
        jobs: [
          {
            id: "title-remote",
            title: "Remote Integration Engineer",
            shortcode: "TITLE_REMOTE",
            state: "published",
            url: "https://fixtureco.workable.com/jobs/title-remote"
          }
        ]
      }
    }
  ];

  for (const item of cases) {
    const source = getSourceModule(item.atsKey);
    const parsed = source.parse(item.raw, item.company);
    assert.equal(parsed.length, 1);
    const normalized = source.normalize(parsed[0], item.company);
    const gate = evaluatePublicPosting(normalized, { parserVersion: source.parserVersion });
    assert.equal(normalized.remote_type, "unknown", `${item.atsKey} title-only remote should stay unknown`);
    assert.equal(normalized.evidence.remote_type.present, false, `${item.atsKey} should not emit remote evidence`);
    assert.equal(gate.status, "quarantined", `${item.atsKey} title-only remote should not pass public gate`);
    assert.ok(gate.reason_codes.includes("no_geo_no_remote"), `${item.atsKey} should require source geo or remote evidence`);
  }

  const personio = getSourceModule("personio");
  const personioCompany = readJson(path.join(__dirname, "personio", "fixtures", "company.json"));
  const personioRows = personio.parse(readJson(path.join(__dirname, "personio", "fixtures", "list.json")), personioCompany)
    .map((posting) => personio.normalize(posting, personioCompany));
  assert.equal(personioRows.find((row) => row.source_job_id === "992").evidence.remote_type.evidence_path, "workzag-jobs.position.office");

  const workable = getSourceModule("workable");
  const workableCompany = readJson(path.join(__dirname, "workable", "fixtures", "company.json"));
  const workableRows = workable.parse(readJson(path.join(__dirname, "workable", "fixtures", "list.json")), workableCompany)
    .map((posting) => workable.normalize(posting, workableCompany));
  assert.equal(workableRows.find((row) => row.source_job_id === "FLOW456").evidence.remote_type.evidence_path, "jobs[].location.workplace_type");
});

test("isolvisolvedhire source module fetches board HTML before jobs API", async () => {
  const source = getSourceModule("isolvisolvedhire");
  assert.ok(source, "expected isolvisolvedhire source module");
  const company = readJson(path.join(__dirname, "isolvisolvedhire", "fixtures", "company.json"));
  const listFixture = readJson(path.join(__dirname, "isolvisolvedhire", "fixtures", "list.json"));
  const calls = [];
  const boardUrl = "https://fixture.isolvedhire.com/jobs";
  const apiUrl = "https://fixture.isolvedhire.com/core/jobs/12345?getParams=%7B%7D";
  const boardHtml = `<html><script>window.courierCurrentRouteData = {"domain_id":"12345"};</script></html>`;

  const payload = await source.fetchList(company, {
    fetcher: async (url, target) => {
      calls.push({
        url,
        method: target.method,
        accept: target.headers?.Accept || "",
        referer: target.headers?.Referer || ""
      });
      if (url === boardUrl) {
        return {
          status: 200,
          url,
          body: boardHtml
        };
      }
      if (url === apiUrl) {
        return {
          status: 200,
          url,
          ...listFixture
        };
      }
      throw new Error(`unexpected isolvisolvedhire fetch URL ${url}`);
    }
  });

  assert.deepEqual(calls, [
    {
      url: boardUrl,
      method: "GET",
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      referer: ""
    },
    {
      url: apiUrl,
      method: "GET",
      accept: "application/json, text/plain, */*",
      referer: boardUrl
    }
  ]);
  assert.equal(payload.__sourceConfig.domainId, "12345");
  assert.equal(payload.__sourceConfig.apiUrl, apiUrl);
  assert.equal(payload.data.jobs.length, 4);

  const parsed = source.parse(payload, company);
  assert.equal(parsed.length, 4);
  const normalizedRows = parsed.map((row) => source.normalize(row, company));
  const normalized = normalizedRows[0];
  assert.equal(normalized.source_job_id, "iso-1001");
  assert.equal(normalized.country, "United States");
  assert.equal(normalized.remote_type, "remote");
  assert.equal(normalized.posting_date, "2026-05-21");
  assert.equal(source.validatePublic(normalized).status, "accepted");

  const placeholderRemote = normalizedRows.find((row) => row.source_job_id === "iso-1002");
  assert.equal(placeholderRemote.location_text, "Remote, USA");
  assert.equal(placeholderRemote.country, "United States");
  assert.equal(placeholderRemote.city, "");
  assert.equal(placeholderRemote.remote_type, "remote");
  assert.equal(placeholderRemote.evidence.country.evidence_path, "data.jobs[].iso3");
  assert.equal(placeholderRemote.evidence.remote_type.evidence_path, "data.jobs[].workplaceType");

  const spanishUsLocation = normalizedRows.find((row) => row.source_job_id === "iso-1003");
  assert.equal(spanishUsLocation.country, "United States");
  assert.equal(spanishUsLocation.city, "Centereach");
  assert.equal(spanishUsLocation.remote_type, "onsite");

  const usVirginIslands = normalizedRows.find((row) => row.source_job_id === "iso-1004");
  assert.equal(usVirginIslands.country, "U.S. Virgin Islands");
  assert.equal(usVirginIslands.region, "North America");
  assert.equal(usVirginIslands.remote_type, "onsite");

  await assert.rejects(
    () => source.fetchList(company, {
      fetcher: async () => ({
        status: 200,
        __sourceFetchFinalUrl: "https://example.com/jobs",
        body: boardHtml
      })
    }),
    /unexpected host/
  );
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

test("lever source module keeps source location when team duplicates a city label", () => {
  const source = getSourceModule("lever");
  const company = {
    company_name: "Planned Parenthood Los Angeles",
    company_url: "https://jobs.lever.co/pp-la",
    ATS_name: "Lever"
  };
  const parsed = source.parse([
    {
      id: "pp-la-van-nuys",
      text: "Health Center Supervisor - Van Nuys, CA",
      createdAt: 1778043600000,
      categories: {
        commitment: "Full-Time Regular",
        department: "Patient Services",
        location: "Van Nuys",
        team: "Van Nuys",
        allLocations: ["Van Nuys"]
      },
      country: null,
      workplaceType: "onsite",
      hostedUrl: "https://jobs.lever.co/pp-la/pp-la-van-nuys"
    }
  ], company);

  assert.equal(parsed[0].location, "Van Nuys");
  assert.equal(parsed[0].country, "United States");
  const normalized = source.normalize(parsed[0], company);
  assert.equal(normalized.location_text, "Van Nuys");
  assert.equal(normalized.country, "United States");
  assert.equal(normalized.city, "Van Nuys");
  assert.equal(normalized.remote_type, "onsite");
  assert.equal(normalized.source_evidence.country_rule_name, "lever_location_city_country_hint");
  assert.equal(source.validatePublic(normalized).status, "accepted");
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

test("ashby source module uses structured postal address as primary geo evidence", () => {
  const source = getSourceModule("ashby");
  const company = readJson(path.join(__dirname, "ashby", "fixtures", "company.json"));
  const parsed = source.parse({
    jobs: [
      {
        id: "ash-malmo",
        title: "Malmo Fleet Care Manager",
        location: "Malmö",
        address: {
          postalAddress: {
            addressLocality: "Malmö",
            addressRegion: "Malmö",
            addressCountry: "Sweden"
          }
        },
        isRemote: null,
        publishedAt: "2026-05-15T08:00:00+03:00",
        jobUrl: "https://jobs.ashbyhq.com/fixtureco/ash-malmo"
      }
    ]
  }, company);
  const normalized = source.normalize(parsed[0], company);

  assert.equal(normalized.location_text, "Malmö / Malmö, Malmö, Sweden");
  assert.equal(normalized.country, "Sweden");
  assert.equal(normalized.region, "EMEA");
  assert.equal(normalized.city, "Malmö");
  assert.equal(normalized.remote_type, "onsite");
  assert.equal(normalized.source_evidence.location_path, "jobs[].address.postalAddress");
  assert.equal(normalized.source_evidence.country_path, "jobs[].address.postalAddress.addressCountry");
  assert.equal(normalized.source_evidence.remote_rule_name, "ashby_structured_physical_location");
  assert.equal(normalized.evidence.remote_type.explicit, true);
  assert.equal(source.validatePublic(normalized).status, "accepted");
});

test("ashby source module treats global source-location scopes as explicit remote evidence", () => {
  const source = getSourceModule("ashby");
  const company = readJson(path.join(__dirname, "ashby", "fixtures", "company.json"));
  const parsed = source.parse({
    jobs: [
      {
        id: "ash-worldwide",
        title: "Worldwide Protocol Lead",
        location: "Worldwide",
        isRemote: null,
        workplaceType: null,
        jobUrl: "https://jobs.ashbyhq.com/fixtureco/ash-worldwide"
      },
      {
        id: "ash-global",
        title: "Global Legal Counsel",
        location: "Global",
        isRemote: null,
        workplaceType: null,
        jobUrl: "https://jobs.ashbyhq.com/fixtureco/ash-global"
      },
      {
        id: "ash-all-locations",
        title: "General Application",
        location: "All Locations",
        isRemote: null,
        workplaceType: null,
        jobUrl: "https://jobs.ashbyhq.com/fixtureco/ash-all-locations"
      }
    ]
  }, company);
  const normalized = Object.fromEntries(
    parsed.map((posting) => {
      const row = source.normalize(posting, company);
      return [row.source_job_id, row];
    })
  );

  assert.equal(normalized["ash-worldwide"].remote_type, "remote");
  assert.equal(normalized["ash-worldwide"].country || "", "");
  assert.equal(normalized["ash-worldwide"].source_evidence.remote_path, "jobs[].location");
  assert.equal(normalized["ash-worldwide"].source_evidence.remote_rule_name, "ashby_global_remote_scope");
  assert.equal(source.validatePublic(normalized["ash-worldwide"]).status, "accepted");

  assert.equal(normalized["ash-global"].remote_type, "remote");
  assert.equal(normalized["ash-global"].country || "", "");
  assert.equal(normalized["ash-global"].source_evidence.remote_path, "jobs[].location");
  assert.equal(normalized["ash-global"].source_evidence.remote_rule_name, "ashby_global_remote_scope");
  assert.equal(source.validatePublic(normalized["ash-global"]).status, "accepted");

  const allLocationsGate = source.validatePublic(normalized["ash-all-locations"]);
  assert.equal(normalized["ash-all-locations"].remote_type, "unknown");
  assert.equal(allLocationsGate.status, "quarantined");
  assert.ok(allLocationsGate.reason_codes.includes("ambiguous_location"));
  assert.ok(allLocationsGate.reason_codes.includes("no_geo_no_remote"));
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
      },
      {
        id: "bhr-leeds",
        jobOpeningName: "Leeds Operations Lead",
        applicationUrl: "https://fixtureco.bamboohr.com/careers/bhr-leeds",
        location: {
          city: "Leeds",
          state: "West Yorkshire"
        },
        isRemote: null,
        locationType: "0"
      },
      {
        id: "bhr-western-cape",
        jobOpeningName: "Cape Town Growth Manager",
        applicationUrl: "https://fixtureco.bamboohr.com/careers/bhr-western-cape",
        location: {
          city: "Bellville",
          state: "Western Cape"
        },
        isRemote: null,
        locationType: "0"
      },
      {
        id: "bhr-hokkaido",
        jobOpeningName: "Niseko Resort Coordinator",
        applicationUrl: "https://fixtureco.bamboohr.com/careers/bhr-hokkaido",
        location: {
          city: "Kutchan-cho, Abuta-gun",
          state: "Hokkaido"
        },
        isRemote: null,
        locationType: "0"
      },
      {
        id: "bhr-lagos",
        jobOpeningName: "Lagos Dealer Manager",
        applicationUrl: "https://fixtureco.bamboohr.com/careers/bhr-lagos",
        location: {
          city: "Ikeja",
          state: "Lagos"
        },
        isRemote: null,
        locationType: "0"
      },
      {
        id: "bhr-various-london",
        jobOpeningName: "London Development Coach",
        applicationUrl: "https://fixtureco.bamboohr.com/careers/bhr-various-london",
        location: {
          city: "Various",
          state: "Greater London",
          country: "United Kingdom"
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

  const leeds = byId.get("bhr-leeds");
  assert.equal(leeds.location_text, "Leeds, West Yorkshire, United Kingdom");
  assert.equal(leeds.country, "United Kingdom");
  assert.equal(leeds.region, "EMEA");
  assert.equal(leeds.city, "Leeds");
  assert.equal(leeds.remote_type, "onsite");
  assert.equal(leeds.source_evidence.location_rule_name, "bamboohr_admin_region_location");
  assert.equal(source.validatePublic(leeds).status, "accepted");

  const westernCape = byId.get("bhr-western-cape");
  assert.equal(westernCape.location_text, "Bellville, Western Cape, South Africa");
  assert.equal(westernCape.country, "South Africa");
  assert.equal(westernCape.region, "EMEA");
  assert.equal(westernCape.city, "Bellville");
  assert.equal(westernCape.remote_type, "onsite");
  assert.equal(westernCape.source_evidence.location_rule_name, "bamboohr_admin_region_location");
  assert.equal(source.validatePublic(westernCape).status, "accepted");

  const hokkaido = byId.get("bhr-hokkaido");
  assert.equal(hokkaido.location_text, "Kutchan-cho, Abuta-gun, Hokkaido, Japan");
  assert.equal(hokkaido.country, "Japan");
  assert.equal(hokkaido.region, "APAC");
  assert.equal(hokkaido.city, "Kutchan-cho, Abuta-gun");
  assert.equal(hokkaido.remote_type, "onsite");
  assert.equal(hokkaido.source_evidence.location_rule_name, "bamboohr_admin_region_location");
  assert.equal(source.validatePublic(hokkaido).status, "accepted");

  const lagos = byId.get("bhr-lagos");
  assert.equal(lagos.location_text, "Ikeja, Lagos, Nigeria");
  assert.equal(lagos.country, "Nigeria");
  assert.equal(lagos.region, "EMEA");
  assert.equal(lagos.city, "Ikeja");
  assert.equal(lagos.remote_type, "onsite");
  assert.equal(lagos.source_evidence.location_rule_name, "bamboohr_admin_region_location");
  assert.equal(source.validatePublic(lagos).status, "accepted");

  const variousLondon = byId.get("bhr-various-london");
  assert.equal(variousLondon.location_text, "United Kingdom");
  assert.equal(variousLondon.country, "United Kingdom");
  assert.equal(variousLondon.region, "EMEA");
  assert.equal(variousLondon.city, "");
  assert.equal(variousLondon.remote_type, "onsite");
  assert.equal(variousLondon.source_evidence.location_rule_name, "bamboohr_country_scope_location");
  assert.equal(variousLondon.source_evidence.location_raw, "Various, Greater London, United Kingdom");
  assert.equal(source.validatePublic(variousLondon).status, "accepted");
});

test("bamboohr source module maps observed source-local admin and city geo hints", () => {
  const source = getSourceModule("bamboohr");
  const company = readJson(path.join(__dirname, "bamboohr", "fixtures", "company.json"));
  const parsed = source.parse({
    result: [
      {
        id: "bhr-conwy",
        jobOpeningName: "Waste Water Operative",
        applicationUrl: "https://fixtureco.bamboohr.com/careers/bhr-conwy",
        location: { city: "Towyn", state: "Conwy" },
        locationType: "0"
      },
      {
        id: "bhr-south-jakarta",
        jobOpeningName: "Sales Manager",
        applicationUrl: "https://fixtureco.bamboohr.com/careers/bhr-south-jakarta",
        location: { city: "South Jakarta", state: null },
        locationType: "0"
      },
      {
        id: "bhr-juba",
        jobOpeningName: "Access and Liaison Assistant",
        applicationUrl: "https://fixtureco.bamboohr.com/careers/bhr-juba",
        location: { city: "Juba", state: null },
        locationType: "0"
      },
      {
        id: "bhr-hasaka",
        jobOpeningName: "Health Coordinator",
        applicationUrl: "https://fixtureco.bamboohr.com/careers/bhr-hasaka",
        location: { city: "Der Alzor, Hasaka", state: "." },
        locationType: "0"
      },
      {
        id: "bhr-johor",
        jobOpeningName: "Sample Preparation Technician",
        applicationUrl: "https://fixtureco.bamboohr.com/careers/bhr-johor",
        location: { city: "Johor Darul Takzim", state: "N/A" },
        locationType: "0"
      },
      {
        id: "bhr-makati",
        jobOpeningName: "Finance Officer",
        applicationUrl: "https://fixtureco.bamboohr.com/careers/bhr-makati",
        location: { city: "Makati City", state: "Legaspi Village" },
        locationType: "0"
      }
    ]
  }, company);
  const normalized = new Map(parsed.map((posting) => {
    const row = source.normalize(posting, company);
    return [row.source_job_id, row];
  }));

  const conwy = normalized.get("bhr-conwy");
  assert.equal(conwy.country, "United Kingdom");
  assert.equal(conwy.region, "EMEA");
  assert.equal(conwy.city, "Towyn");
  assert.equal(conwy.source_evidence.location_rule_name, "bamboohr_admin_region_location");
  assert.equal(source.validatePublic(conwy).status, "accepted");

  const southJakarta = normalized.get("bhr-south-jakarta");
  assert.equal(southJakarta.country, "Indonesia");
  assert.equal(southJakarta.region, "APAC");
  assert.equal(southJakarta.city, "South Jakarta");
  assert.equal(southJakarta.source_evidence.location_rule_name, "bamboohr_admin_region_location");
  assert.equal(source.validatePublic(southJakarta).status, "accepted");

  const juba = normalized.get("bhr-juba");
  assert.equal(juba.country, "South Sudan");
  assert.equal(juba.region, "EMEA");
  assert.equal(juba.city, "Juba");
  assert.equal(juba.source_evidence.location_rule_name, "bamboohr_admin_region_location");
  assert.equal(source.validatePublic(juba).status, "accepted");

  const hasaka = normalized.get("bhr-hasaka");
  assert.equal(hasaka.country, "Syria");
  assert.equal(hasaka.region, "EMEA");
  assert.equal(hasaka.city, "Der Alzor, Hasaka");
  assert.equal(hasaka.source_evidence.location_rule_name, "bamboohr_admin_region_location");
  assert.equal(source.validatePublic(hasaka).status, "accepted");

  const johor = normalized.get("bhr-johor");
  assert.equal(johor.country, "Malaysia");
  assert.equal(johor.region, "APAC");
  assert.equal(johor.city, "Johor Darul Takzim");
  assert.equal(johor.source_evidence.location_rule_name, "bamboohr_admin_region_location");
  assert.equal(source.validatePublic(johor).status, "accepted");

  const makati = normalized.get("bhr-makati");
  assert.equal(makati.country, "Philippines");
  assert.equal(makati.region, "APAC");
  assert.equal(makati.city, "Makati City");
  assert.equal(makati.source_evidence.location_rule_name, "bamboohr_admin_region_location");
  assert.equal(source.validatePublic(makati).status, "accepted");
});

test("bamboohr source module treats empty boards and malformed source rows conservatively", () => {
  const source = getSourceModule("bamboohr");
  const sourceDir = path.join(__dirname, "bamboohr", "fixtures");
  const route = readJson(path.join(sourceDir, "route-detection.json"));
  const malformed = readJson(path.join(sourceDir, "malformed-list-shapes.json"));
  const missingGeo = readJson(path.join(sourceDir, "missing-geo-list.json"));
  const company = {
    company_name: route.company_name,
    url_string: route.board_url,
    ATS_name: "bamboohr"
  };

  const discovered = source.discover(company);
  assert.equal(discovered.config.companySubdomainLower, route.expected.company_subdomain);
  assert.equal(discovered.list_url, route.api_url);
  assert.equal(source.parse(route.empty_payload, company).length, route.expected.parsed_count);
  assert.deepEqual(source.payloadShapePolicy.empty_job_list_stems, ["result"]);

  for (const item of malformed.cases) {
    assert.equal(
      source.parse(item.payload, company).length,
      item.expected_parsed_count,
      `BambooHR ${item.name} should not produce parser rows`
    );
  }

  const parsed = source.parse(missingGeo.payload, company);
  assert.equal(parsed.length, 1);
  const normalized = source.normalize(parsed[0], company);
  assert.equal(normalized.source_job_id, missingGeo.expected.source_job_id);
  const gate = source.validatePublic(normalized);
  assert.equal(gate.status, missingGeo.expected.public_gate_status);
  assert.ok(gate.reason_codes.includes(missingGeo.expected.reason_code));
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

  assert.equal(normalized.length, 6);

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

  const sourceFlagRemote = byId.get("476000000001006");
  assert.equal(sourceFlagRemote.position_name, "Source Flag Remote Engineer");
  assert.equal(sourceFlagRemote.location_text, null);
  assert.equal(sourceFlagRemote.country, "");
  assert.equal(sourceFlagRemote.remote_type, "remote");
  assert.equal(sourceFlagRemote.evidence.remote_type.evidence_path, "jobs[].Remote_Job");
  assert.equal(sourceFlagRemote.evidence.remote_type.rule_name, "zoho_remote_job_flag");
  assert.equal(source.validatePublic(sourceFlagRemote).status, "accepted");
});

test("zoho source module parses registry HTML payload wrappers", () => {
  const { source, company } = zohoFixtureContext();
  const rawList = readJson(path.join(__dirname, "zoho", "fixtures", "list.json"));
  const parsed = source.parse({
    body: rawList,
    url: "https://fixtureco.zohorecruit.com/jobs/Careers",
    status: 200,
    __sourceConfig: {
      careersUrl: "https://fixtureco.zohorecruit.com/jobs/Careers"
    }
  }, company);

  assert.equal(parsed.length, 6);
  assert.equal(parsed[0].source_job_id, "476000000001001");
  assert.equal(parsed[0].company_name, "Fixture Zoho");
});

test("zoho source module normalizes explicit country payload tokens", () => {
  const { source, company } = zohoFixtureContext();
  const jobs = [
    {
      id: "476000000001006",
      Posting_Title: "Ghana Operations Lead",
      City: "Accra",
      State: "Greater Accra",
      Country: "Ghana",
      Date_Opened: "2026-05-20"
    },
    {
      id: "476000000001007",
      Posting_Title: "Costa Rica Support Analyst",
      City: "San Rafael",
      State: "Alajuela",
      Country: "Costa Rica",
      Date_Opened: "2026-05-21"
    },
    {
      id: "476000000001008",
      Posting_Title: "Sri Lanka Admissions Officer",
      City: "Havelock Town",
      State: "Western Province",
      Country: "Sri Lanka",
      Date_Opened: "2026-05-22"
    }
  ];
  const parsed = source.parse(
    `<input id="meta" value='{"list_url":"https://fixtureco.zohorecruit.com/jobs/Careers"}'>` +
      `<input id="jobs" value='${JSON.stringify(jobs)}'>`,
    company
  );
  const normalized = parsed.map((posting) => source.normalize(posting, company));
  const byId = new Map(normalized.map((posting) => [posting.source_job_id, posting]));

  assert.equal(byId.get("476000000001006").country, "Ghana");
  assert.equal(byId.get("476000000001006").region, "EMEA");
  assert.equal(byId.get("476000000001007").country, "Costa Rica");
  assert.equal(byId.get("476000000001007").region, "LATAM");
  assert.equal(byId.get("476000000001008").country, "Sri Lanka");
  assert.equal(byId.get("476000000001008").region, "APAC");
  assert.equal(source.validatePublic(byId.get("476000000001006")).status, "accepted");
  assert.equal(source.validatePublic(byId.get("476000000001007")).status, "accepted");
  assert.equal(source.validatePublic(byId.get("476000000001008")).status, "accepted");
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

test("recruitcrm source module fetches paginated public API batches with POST metadata", async () => {
  const { source, company } = recruitCrmFixtureContext();
  const calls = [];
  const firstPage = Array.from({ length: 100 }, (_, index) => ({
    id: `rc-${index}`,
    name: `RecruitCRM Role ${index}`,
    slug: `recruitcrm-role-${index}`,
    remote: "1"
  }));
  const secondPage = [
    firstPage[0],
    {
      id: "rc-101",
      name: "RecruitCRM Final Role",
      slug: "recruitcrm-final-role",
      remote: "1"
    }
  ];

  const payload = await source.fetchList(company, {
    fetcher: async (url, target) => {
      calls.push({
        url,
        method: target.method,
        headers: target.headers,
        body: JSON.parse(target.body)
      });
      return {
        data: {
          jobs: calls.length === 1 ? firstPage : secondPage
        }
      };
    }
  });

  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, "https://albatross.recruitcrm.io/v1/external-pages/jobs-by-account/get?account=fixtureco&batch=true");
  assert.equal(calls[0].method, "POST");
  assert.equal(calls[0].headers["Content-Type"], "application/json");
  assert.equal(calls[0].body.limit, 100);
  assert.equal(calls[0].body.offset, 0);
  assert.equal(calls[0].body.onlyJobs, true);
  assert.equal(calls[1].body.offset, 100);
  assert.equal(payload.__sourceConfig.account, "fixtureco");
  assert.equal(payload.data.jobs.length, 101);
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

test("recruitcrm source module maps source-local structured city country hints", () => {
  const { source, company } = recruitCrmFixtureContext();
  const rawList = readJson(path.join(__dirname, "recruitcrm", "fixtures", "list.json"));
  const normalized = source.parse(rawList, company).map((posting) => source.normalize(posting, company));
  const byId = new Map(normalized.map((posting) => [posting.source_job_id, posting]));

  const malaysia = byId.get("rc-malaysia-city");
  assert.equal(malaysia.country, "Malaysia");
  assert.equal(malaysia.region, "APAC");
  assert.equal(malaysia.city, "Kuala Lumpur");
  assert.equal(malaysia.remote_type, "onsite");
  assert.equal(malaysia.source_evidence.country_source, "list_api");
  assert.equal(malaysia.source_evidence.country_path, "city");
  assert.equal(malaysia.source_evidence.country_rule_name, "recruitcrm_structured_city_country_hint");
  assert.equal(source.validatePublic(malaysia).status, "accepted");

  const philippines = byId.get("rc-philippines-city");
  assert.equal(philippines.country, "Philippines");
  assert.equal(philippines.region, "APAC");
  assert.equal(philippines.city, "Makati");
  assert.equal(philippines.remote_type, "unknown");
  assert.equal(philippines.source_evidence.country_path, "city");
  assert.equal(source.validatePublic(philippines).status, "accepted");

  const southAfrica = byId.get("rc-south-africa-remote-city");
  assert.equal(southAfrica.country, "South Africa");
  assert.equal(southAfrica.region, "EMEA");
  assert.equal(southAfrica.city, "Johannesburg");
  assert.equal(southAfrica.remote_type, "remote");
  assert.equal(southAfrica.source_evidence.country_rule_name, "recruitcrm_structured_city_country_hint");
  assert.equal(source.validatePublic(southAfrica).status, "accepted");
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

test("recruitee source module fetches public offers API with source-local discovery", async () => {
  const { source, company } = recruiteeFixtureContext();
  const calls = [];

  const payload = await source.fetchList(company, {
    fetcher: async (url, target) => {
      calls.push({ url, method: target.method, headers: target.headers });
      return {
        offers: [
          {
            id: 1001,
            title: "Fixture Recruitee Role",
            slug: "fixture-recruitee-role",
            remote: true
          }
        ]
      };
    }
  });

  assert.deepEqual(calls, [{
    url: "https://fixture.recruitee.com/api/offers/",
    method: "GET",
    headers: { Accept: "application/json, text/plain, */*" }
  }]);
  assert.equal(payload.__sourceConfig.baseUrl, "https://fixture.recruitee.com");
  assert.equal(payload.offers.length, 1);
});

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
