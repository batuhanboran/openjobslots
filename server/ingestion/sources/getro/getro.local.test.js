const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const source = require("./index");
const { GETRO_RATE_LIMIT_WAIT_MS } = require("./fetchList");

const sourceDir = __dirname;

function readJson(fileName) {
  return JSON.parse(fs.readFileSync(path.join(sourceDir, "fixtures", fileName), "utf8"));
}

test("getro discover parses Getro jobs route", () => {
  const company = readJson("company.json");
  const discovered = source.discover(company);

  assert.equal(discovered.ats_key, "getro");
  assert.equal(discovered.source_family, "html_detail");
  assert.equal(discovered.list_url, "https://fixture.getro.com/jobs");
  assert.equal(discovered.config.host, "fixture.getro.com");
  assert.equal(discovered.config.subdomainLower, "fixture");
  assert.equal(discovered.config.baseOrigin, "https://fixture.getro.com");
});

test("getro fetchList succeeds with injected fetcher and source request metadata", async () => {
  const company = readJson("company.json");
  const listFixture = readJson("list.json");
  const requests = [];

  const raw = await source.fetchList(company, {
    fetcher: async (url, target) => {
      requests.push({ url, target });
      return {
        status: 200,
        url,
        body: listFixture.html
      };
    }
  });

  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "https://fixture.getro.com/jobs");
  assert.equal(requests[0].target.method, "GET");
  assert.equal(requests[0].target.source_key, "getro");
  assert.equal(raw.__sourceFetchFinalUrl, "https://fixture.getro.com/jobs");
  assert.equal(raw.__sourceConfig.subdomainLower, "fixture");
  assert.equal(raw.__sourceRequest.rateLimitMs, GETRO_RATE_LIMIT_WAIT_MS);
});

test("getro fetchList throws no_public_jobs_route for missing route", async () => {
  const company = {
    ...readJson("company.json"),
    url_string: "https://www.getro.com"
  };

  await assert.rejects(
    () => source.fetchList(company, {
      fetcher: async () => ({ status: 200, url: "https://www.getro.com", body: "<html></html>" })
    }),
    (error) => error?.ingestionErrorType === "no_public_jobs_route"
  );
});

test("getro fetchList rejects unexpected redirect hosts", async () => {
  const company = readJson("company.json");

  await assert.rejects(
    () => source.fetchList(company, {
      fetcher: async () => ({
        status: 200,
        url: "https://example.com/jobs",
        body: "<html></html>"
      })
    }),
    (error) => error?.ingestionErrorType === "unexpected_redirect_host"
  );
});

test("getro parser preserves source ids, location, and source dates", () => {
  const company = readJson("company.json");
  const fixture = readJson("list.json");

  const parsed = source.parse(fixture, company);
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].source_job_id, "getro-1001");
  assert.equal(parsed[0].location, "Istanbul, Turkey");
  assert.equal(parsed[0].posting_date, "2026-05-01");
  assert.equal(parsed[1].source_job_id, "getro-1002");
  assert.equal(parsed[1].location, "Remote");
  assert.equal(parsed[1].posting_date, "1778889600");
  assert.equal(parsed[1].source_evidence?.route_kind, "getro_next_data_jobs");
  assert.equal(parsed[1].source_evidence?.list_url, "https://fixture.getro.com/jobs");
});

test("getro normalize validates fixture evidence without invented fields", () => {
  const company = readJson("company.json");
  const expectedRows = readJson("expected-normalized.json");
  const parsed = source.parse(readJson("list.json"), company);
  const normalized = parsed.map((posting) => source.normalize(posting, company));

  assert.equal(normalized.length, expectedRows.length);
  for (let index = 0; index < expectedRows.length; index += 1) {
    const expected = expectedRows[index];
    const row = normalized[index];
    assert.equal(source.validate(row).ok, true);
    assert.equal(row.source_job_id, expected.source_job_id);
    assert.equal(row.position_name, expected.position_name);
    assert.equal(row.posting_date, expected.posting_date);
    assert.equal(row.remote_type, expected.remote_type);
    assert.equal(row.parser_confidence, expected.parser_confidence);
    if (expected.country) assert.equal(row.country, expected.country);
    if (expected.city) assert.equal(row.city, expected.city);
  }
});

test("getro parse preserves __legacyParsed payloads", () => {
  const company = readJson("company.json");
  const legacy = [{ source_job_id: "legacy-1", company_name: "Fixture Getro", position_name: "Legacy" }];
  const parsed = source.parse({ __legacyParsed: legacy }, company);
  assert.deepEqual(parsed, legacy);
});
