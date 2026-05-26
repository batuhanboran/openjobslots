const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const { evaluatePublicPosting } = require("../../publicPostingGate");
const source = require(".");

function readFixture(name) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", name), "utf8"));
}

function response(payload, url) {
  return {
    ok: true,
    status: 200,
    url,
    json: async () => payload,
    text: async () => JSON.stringify(payload)
  };
}

test("usajobs discover exposes official Search API as disabled public-sector source", () => {
  const company = readFixture("company.json");
  const discovered = source.discover(company);

  assert.equal(discovered.ats_key, "usajobs");
  assert.equal(discovered.source_family, "public_sector");
  assert.equal(discovered.list_url, "https://data.usajobs.gov/api/Search");
  assert.equal(discovered.parser_version, "source-usajobs-v1");
});

test("usajobs fetchList uses official API headers, pagination, and source metadata", async () => {
  const company = readFixture("company.json");
  const list = readFixture("list.json");
  const secondPage = {
    SearchResult: {
      UserArea: { NumberOfPages: 2 },
      SearchResultItems: []
    }
  };
  const requests = [];
  const payload = await source.fetchList(company, {
    env: {
      OPENJOBSLOTS_USAJOBS_AUTHORIZATION_KEY: "fixture-key",
      OPENJOBSLOTS_USAJOBS_USER_AGENT: "fixture@example.com"
    },
    maxPages: 2,
    resultsPerPage: 2,
    fetcher: async (url, target) => {
      requests.push({ url, target });
      return response(requests.length === 1 ? {
        ...list,
        SearchResult: {
          ...list.SearchResult,
          UserArea: { NumberOfPages: 2 }
        }
      } : secondPage, url);
    }
  });

  assert.equal(requests.length, 2);
  assert.match(requests[0].url, /^https:\/\/data\.usajobs\.gov\/api\/Search\?/);
  assert.match(requests[0].url, /HiringPath=public/);
  assert.match(requests[0].url, /ResultsPerPage=2/);
  assert.match(requests[0].url, /Page=1/);
  assert.equal(requests[0].target.headers.Host, "data.usajobs.gov");
  assert.equal(requests[0].target.headers["Authorization-Key"], "fixture-key");
  assert.equal(requests[0].target.headers["User-Agent"], "fixture@example.com");
  assert.equal(payload.pages.length, 2);
  assert.equal(payload.__sourceConfig.fetched_pages, 2);
  assert.equal(payload.__sourceRequest.rateLimitMs, 60000);
});

test("usajobs fetchList requires official API key", async () => {
  const company = readFixture("company.json");
  await assert.rejects(
    () => source.fetchList(company, { env: {}, fetcher: async () => response({}, "https://data.usajobs.gov/api/Search") }),
    /USAJobs official API key is not configured/
  );
});

test("usajobs fetchList rejects unexpected redirect hosts", async () => {
  const company = readFixture("company.json");
  await assert.rejects(
    () => source.fetchList(company, {
      env: {
        OPENJOBSLOTS_USAJOBS_AUTHORIZATION_KEY: "fixture-key",
        OPENJOBSLOTS_USAJOBS_USER_AGENT: "fixture@example.com"
      },
      fetcher: async () => response({}, "https://example.com/api/Search")
    }),
    /unexpected host/
  );
});

test("usajobs parser preserves official ids, URLs, geo, remote, and dates", () => {
  const company = readFixture("company.json");
  const rawList = readFixture("list.json");
  const parsed = source.parse(rawList, company);

  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].source_job_id, "806553000");
  assert.equal(parsed[1].job_posting_url, "https://www.usajobs.gov/job/805000111");
  assert.equal(parsed[0].source_evidence.source_job_id_path, "SearchResultItems[].MatchedObjectDescriptor.PositionID|DocumentID|MatchedObjectId");
  assert.equal(parsed[0].remote_type, "remote");
  assert.equal(parsed[1].remote_type, "onsite");
});

test("usajobs normalize validates fixture evidence without invented fields", () => {
  const company = readFixture("company.json");
  const rawList = readFixture("list.json");
  const expected = readFixture("expected-normalized.json");
  const normalized = source.parse(rawList, company).map((posting) => source.normalize(posting, company));

  assert.equal(normalized.length, expected.length);
  for (let index = 0; index < expected.length; index += 1) {
    const row = normalized[index];
    const wanted = expected[index];
    assert.equal(source.validate(row).ok, true);
    assert.equal(row.parser_key, "usajobs");
    assert.equal(row.parser_version, "source-usajobs-v1");
    assert.equal(row.source_job_id, wanted.source_job_id);
    assert.equal(row.company_name, wanted.company_name);
    assert.equal(row.position_name, wanted.position_name);
    assert.equal(row.country, wanted.country);
    assert.equal(row.city, wanted.city);
    assert.equal(row.remote_type, wanted.remote_type);
    assert.equal(row.posting_date, wanted.posting_date);
    assert.equal(row.parser_confidence, wanted.parser_confidence);
    assert.equal(evaluatePublicPosting(row, { parserVersion: source.parserVersion }).status, "accepted");
  }
});

test("usajobs rejects or quarantines invalid source shapes", () => {
  const company = readFixture("company.json");
  const invalid = readFixture("invalid-shapes.json");

  for (const item of invalid.cases) {
    const normalized = source.normalize(item.posting, company);
    const basic = source.validate(normalized);
    const gate = evaluatePublicPosting(normalized, { parserVersion: source.parserVersion });
    if (item.expected === "rejected") {
      assert.equal(basic.ok, false, item.name);
      assert.match(basic.error, new RegExp(item.reason));
    } else {
      assert.equal(basic.ok, true, item.name);
      assert.equal(gate.status, "quarantined", item.name);
      assert.ok(gate.reason_codes.some((reason) => new RegExp(item.reason).test(reason)), item.name);
    }
  }
});

test("usajobs parse preserves __legacyParsed payloads", () => {
  const legacy = [{ source_job_id: "legacy", job_posting_url: "https://www.usajobs.gov/job/legacy" }];
  assert.deepEqual(source.parse({ __legacyParsed: legacy }, readFixture("company.json")), legacy);
});

test("usajobs legacy Jobs payload preserves remote signal and URL fallback", () => {
  const parsed = source.parse({
    Jobs: [
      {
        DocumentID: "legacy-remote-1",
        Title: "Legacy Remote Analyst",
        Agency: "Fixture Agency",
        LocationName: "Anywhere in the U.S.",
        DateDisplay: "Open 05/01/2026 to 05/30/2026",
        RemoteIndicator: "Yes"
      }
    ]
  }, readFixture("company.json"));

  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].source_job_id, "legacy-remote-1");
  assert.equal(parsed[0].job_posting_url, "https://www.usajobs.gov/job/legacy-remote-1");
  assert.equal(parsed[0].remote_type, "remote");
  assert.equal(parsed[0].posting_date, "05/01/2026");
  assert.equal(parsed[0].source_evidence.remote_path, "Jobs[].RemoteIndicator|RemoteJob|IsRemote");
});
