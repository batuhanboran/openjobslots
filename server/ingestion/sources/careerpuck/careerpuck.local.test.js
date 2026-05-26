const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const source = require("./index");
const { CAREERPUCK_RATE_LIMIT_WAIT_MS } = require("./fetchList");

const sourceDir = __dirname;

function readJson(fileName) {
  return JSON.parse(fs.readFileSync(path.join(sourceDir, "fixtures", fileName), "utf8"));
}

test("careerpuck discover parses public job-board route", () => {
  const company = readJson("company.json");
  const discovered = source.discover(company);

  assert.equal(discovered.ats_key, "careerpuck");
  assert.equal(discovered.source_family, "direct_json");
  assert.equal(discovered.list_url, "https://api.careerpuck.com/v1/public/job-boards/fixtureco");
  assert.equal(discovered.config.host, "app.careerpuck.com");
  assert.equal(discovered.config.boardSlugLower, "fixtureco");
  assert.equal(discovered.config.boardUrl, "https://app.careerpuck.com/job-board/fixtureco");
});

test("careerpuck fetchList succeeds with injected fetcher and source request metadata", async () => {
  const company = readJson("company.json");
  const listFixture = readJson("list.json");
  const requests = [];

  const raw = await source.fetchList(company, {
    fetcher: async (url, target) => {
      requests.push({ url, target });
      return {
        status: 200,
        url,
        ...listFixture
      };
    }
  });

  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "https://api.careerpuck.com/v1/public/job-boards/fixtureco");
  assert.equal(requests[0].target.method, "GET");
  assert.equal(requests[0].target.source_key, "careerpuck");
  assert.equal(raw.__sourceFetchFinalUrl, "https://api.careerpuck.com/v1/public/job-boards/fixtureco");
  assert.equal(raw.__sourceConfig.boardSlugLower, "fixtureco");
  assert.equal(raw.__sourceRequest.rateLimitMs, CAREERPUCK_RATE_LIMIT_WAIT_MS);
});

test("careerpuck fetchList throws no_public_jobs_route for missing route", async () => {
  const company = {
    ...readJson("company.json"),
    url_string: "https://app.careerpuck.com/"
  };

  await assert.rejects(
    () => source.fetchList(company, {
      fetcher: async () => ({ status: 200, url: "https://api.careerpuck.com/v1/public/job-boards/", jobs: [] })
    }),
    (error) => error?.ingestionErrorType === "no_public_jobs_route"
  );
});

test("careerpuck fetchList rejects unexpected redirect hosts", async () => {
  const company = readJson("company.json");

  await assert.rejects(
    () => source.fetchList(company, {
      fetcher: async () => ({
        status: 200,
        url: "https://example.com/v1/public/job-boards/fixtureco",
        jobs: []
      })
    }),
    (error) => error?.ingestionErrorType === "unexpected_redirect_host"
  );
});

test("careerpuck parser preserves source ids, location, department, and dates", () => {
  const company = readJson("company.json");
  const fixture = readJson("list.json");

  const parsed = source.parse(fixture, company);
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].source_job_id, "cp-1001");
  assert.equal(parsed[0].location, "Istanbul, Turkey");
  assert.equal(parsed[0].department, "Data");
  assert.equal(parsed[0].posting_date, "2026-05-20");
  assert.equal(parsed[1].source_job_id, "cp-1002");
  assert.equal(parsed[1].location, "Remote");
  assert.equal(parsed[1].posting_date, "2026-05-21");
  assert.equal(parsed[1].source_evidence?.route_kind, "careerpuck_public_job_board_api");
});

test("careerpuck normalize validates fixture evidence without invented fields", () => {
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
    if (expected.department) assert.equal(row.department, expected.department);
  }
});

test("careerpuck parse preserves __legacyParsed payloads", () => {
  const company = readJson("company.json");
  const legacy = [{ source_job_id: "legacy-1", company_name: "Fixture CareerPuck", position_name: "Legacy" }];
  const parsed = source.parse({ __legacyParsed: legacy }, company);
  assert.deepEqual(parsed, legacy);
});
