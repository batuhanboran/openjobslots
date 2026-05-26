const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const source = require("./index");
const { GOVERNMENTJOBS_RATE_LIMIT_WAIT_MS } = require("./fetchList");

const sourceDir = __dirname;

function readJson(fileName) {
  return JSON.parse(fs.readFileSync(path.join(sourceDir, "fixtures", fileName), "utf8"));
}

test("governmentjobs discover exposes public search target", () => {
  const company = readJson("company.json");
  const discovered = source.discover(company);

  assert.equal(discovered.ats_key, "governmentjobs");
  assert.equal(discovered.source_family, "public_sector");
  assert.equal(discovered.list_url, "https://www.governmentjobs.com/jobs");
  assert.equal(discovered.config.host, "www.governmentjobs.com");
});

test("governmentjobs fetchList follows AJAX search pages with source request metadata", async () => {
  const company = readJson("company.json");
  const fixture = readJson("list.json");
  const requests = [];

  const raw = await source.fetchList(company, {
    now: () => 1779814800000,
    fetcher: async (url, target) => {
      requests.push({ url, target });
      const page = url.includes("page=2") ? 1 : 0;
      return {
        status: 200,
        url,
        view1: fixture.view_html_pages[page]
      };
    }
  });

  assert.equal(requests.length, 2);
  assert.equal(requests[0].target.method, "GET");
  assert.equal(requests[0].target.source_key, "governmentjobs");
  assert.equal(requests[0].target.headers["X-Requested-With"], "XMLHttpRequest");
  assert.equal(raw.__sourceConfig.last_page, 2);
  assert.equal(raw.__sourceConfig.fetched_pages, 2);
  assert.equal(raw.__sourceRequest.rateLimitMs, GOVERNMENTJOBS_RATE_LIMIT_WAIT_MS);
});

test("governmentjobs fetchList rejects unexpected redirect hosts", async () => {
  const company = readJson("company.json");

  await assert.rejects(
    () => source.fetchList(company, {
      fetcher: async () => ({
        status: 200,
        url: "https://example.com/jobs",
        view1: "<ul></ul>"
      })
    }),
    (error) => error?.ingestionErrorType === "unexpected_redirect_host"
  );
});

test("governmentjobs parser preserves source ids, organizations, location, and relative source dates", () => {
  const company = readJson("company.json");
  const fixture = readJson("list.json");

  const parsed = source.parse(fixture, company);
  assert.equal(parsed.length, 3);
  assert.equal(parsed[0].source_job_id, "4523011-0");
  assert.equal(parsed[0].company_name, "Fixture City");
  assert.equal(parsed[0].location, "Austin, TX");
  assert.equal(parsed[0].posting_date, "Posted Today");
  assert.equal(parsed[1].source_job_id, "4523012-0");
  assert.equal(parsed[1].location, "Remote");
  assert.equal(parsed[2].source_job_id, "4523013-0");
});

test("governmentjobs normalize validates fixture evidence without invented fields", () => {
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
    assert.equal(row.posting_date, expected.posting_date);
    assert.equal(row.remote_type, expected.remote_type);
    assert.equal(row.parser_confidence, expected.parser_confidence);
    if (expected.country) assert.equal(row.country, expected.country);
    if (expected.city) assert.equal(row.city, expected.city);
  }
});

test("governmentjobs parse preserves __legacyParsed payloads", () => {
  const company = readJson("company.json");
  const legacy = [{ source_job_id: "legacy-1", company_name: "Fixture GovernmentJobs", position_name: "Legacy" }];
  const parsed = source.parse({ __legacyParsed: legacy }, company);
  assert.deepEqual(parsed, legacy);
});
