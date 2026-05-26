const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const source = require("./index");
const { SIMPLICANT_RATE_LIMIT_WAIT_MS } = require("./fetchList");

const sourceDir = __dirname;

function readJson(fileName) {
  return JSON.parse(fs.readFileSync(path.join(sourceDir, "fixtures", fileName), "utf8"));
}

test("simplicant discover parses supported board routes", () => {
  const company = readJson("company.json");
  const discovered = source.discover(company);

  assert.equal(discovered.ats_key, "simplicant");
  assert.equal(discovered.source_family, "html_detail");
  assert.equal(discovered.list_url, "https://fixture.simplicant.com/");
  assert.equal(discovered.config.host, "fixture.simplicant.com");
  assert.equal(discovered.config.subdomainLower, "fixture");
  assert.equal(discovered.config.baseOrigin, "https://fixture.simplicant.com");
});

test("simplicant fetchList succeeds with injected fetcher and source metadata", async () => {
  const company = readJson("company.json");
  const fixture = readJson("list.json");
  const requests = [];

  const raw = await source.fetchList(company, {
    fetcher: async (url, target) => {
      requests.push({ url, target });
      return {
        status: 200,
        url,
        body: fixture.html
      };
    }
  });

  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "https://fixture.simplicant.com/");
  assert.equal(requests[0].target.method, "GET");
  assert.equal(requests[0].target.source_key, "simplicant");
  assert.equal(raw.__sourceFetchFinalUrl, "https://fixture.simplicant.com/");
  assert.equal(raw.__sourceConfig.subdomainLower, "fixture");
  assert.equal(raw.__sourceRequest.rateLimitMs, SIMPLICANT_RATE_LIMIT_WAIT_MS);
});

test("simplicant fetchList rejects unsupported routes and redirect hosts", async () => {
  await assert.rejects(
    () => source.fetchList({
      company_name: "Fixture Simplicant",
      url_string: "https://simplicant.com/jobs"
    }, {
      fetcher: async () => ({ status: 200, url: "https://simplicant.com/jobs", body: "" })
    }),
    (error) => error?.ingestionErrorType === "no_public_jobs_route"
  );

  await assert.rejects(
    () => source.fetchList(readJson("company.json"), {
      fetcher: async () => ({
        status: 200,
        url: "https://example.com/jobs",
        body: "<html></html>"
      })
    }),
    (error) => error?.ingestionErrorType === "unexpected_redirect_host"
  );
});

test("simplicant parser preserves source ids, jobs and leads detail routes, and source evidence", () => {
  const company = readJson("company.json");
  const parsed = source.parse(readJson("list.json"), company);

  assert.equal(parsed.length, 3);
  assert.equal(parsed[0].source_job_id, "SIMP1001");
  assert.equal(parsed[0].location, "Austin, TX");
  assert.equal(parsed[0].remote_type, "onsite");
  assert.equal(parsed[0].source_evidence.route_kind, "simplicant_public_board_html");
  assert.equal(parsed[1].source_job_id, "SIMP1002");
  assert.equal(parsed[1].remote_type, "remote");
  assert.equal(parsed[2].source_job_id, "SIMP1003");
  assert.equal(parsed[2].job_posting_url, "https://fixture.simplicant.com/leads/SIMP1003/detail");
  assert.equal(parsed[2].remote_type, "hybrid");
});

test("simplicant normalize validates fixture evidence without invented posting dates", () => {
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
    assert.equal(row.company_name, expected.company_name);
    assert.equal(row.position_name, expected.position_name);
    assert.equal(row.country, expected.country);
    if (expected.city) assert.equal(row.city, expected.city);
    assert.equal(row.remote_type, expected.remote_type);
    assert.equal(row.posting_date, null);
    assert.equal(row.parser_confidence, expected.parser_confidence);
    assert.equal(source.validatePublic(row).status, "accepted");
  }
});

test("simplicant parse preserves __legacyParsed payloads", () => {
  const legacy = [{ source_job_id: "legacy-1", company_name: "Fixture Simplicant", position_name: "Legacy" }];
  assert.deepEqual(source.parse({ __legacyParsed: legacy }, readJson("company.json")), legacy);
});
