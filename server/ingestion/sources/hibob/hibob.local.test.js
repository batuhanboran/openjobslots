const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const source = require("./index");
const { HIBOB_RATE_LIMIT_WAIT_MS } = require("./fetchList");

const sourceDir = __dirname;

function readJson(fileName) {
  return JSON.parse(fs.readFileSync(path.join(sourceDir, "fixtures", fileName), "utf8"));
}

test("hibob discover parses careers board route", () => {
  const company = readJson("company.json");
  const discovered = source.discover(company);

  assert.equal(discovered.ats_key, "hibob");
  assert.equal(discovered.source_family, "html_detail");
  assert.equal(discovered.list_url, "https://fixture.careers.hibob.com/api/job-ad");
  assert.equal(discovered.config.host, "fixture.careers.hibob.com");
  assert.equal(discovered.config.companySubdomainLower, "fixture");
  assert.equal(discovered.config.boardUrl, "https://fixture.careers.hibob.com/jobs");
});

test("hibob discover rejects unsupported hosts", () => {
  const discovered = source.discover({
    ...readJson("company.json"),
    url_string: "https://example.com/jobs"
  });

  assert.equal(discovered.list_url, "");
  assert.equal(discovered.config.error, "unsupported_hibob_host");
});

test("hibob fetchList gets board then API with source metadata", async () => {
  const company = readJson("company.json");
  const listFixture = readJson("list.json");
  const requests = [];

  const raw = await source.fetchList(company, {
    fetcher: async (url, target) => {
      requests.push({ url, target });
      if (url.endsWith("/jobs")) {
        return { status: 200, url, body: "<html><body>HiBob fixture board</body></html>" };
      }
      return { status: 200, url, ...listFixture };
    }
  });

  assert.equal(requests.length, 2);
  assert.equal(requests[0].url, "https://fixture.careers.hibob.com/jobs");
  assert.equal(requests[0].target.method, "GET");
  assert.equal(requests[0].target.source_key, "hibob");
  assert.equal(requests[1].url, "https://fixture.careers.hibob.com/api/job-ad");
  assert.equal(requests[1].target.method, "GET");
  assert.equal(requests[1].target.headers.Referer, "https://fixture.careers.hibob.com/jobs");
  assert.equal(requests[1].target.headers.Origin, "https://fixture.careers.hibob.com");
  assert.equal(raw.__sourceFetchFinalUrl, "https://fixture.careers.hibob.com/api/job-ad");
  assert.equal(raw.__sourceConfig.companySubdomainLower, "fixture");
  assert.equal(raw.__sourceRequest.rateLimitMs, HIBOB_RATE_LIMIT_WAIT_MS);
});

test("hibob fetchList rejects unexpected redirect hosts", async () => {
  const company = readJson("company.json");

  await assert.rejects(
    () => source.fetchList(company, {
      fetcher: async (url) => {
        if (url.endsWith("/jobs")) return { status: 200, url, body: "<html></html>" };
        return { status: 200, url: "https://example.com/api/job-ad", jobAdDetails: [] };
      }
    }),
    (error) => error?.ingestionErrorType === "unexpected_redirect_host"
  );
});

test("hibob parser preserves source ids, URLs, site/country evidence, and dates", () => {
  const company = readJson("company.json");
  const parsed = source.parse(readJson("list.json"), company);

  assert.equal(parsed.length, 3);
  assert.equal(parsed[0].source_job_id, "hb-1001");
  assert.equal(parsed[0].location, "Istanbul, Turkey");
  assert.equal(parsed[0].posting_date, "2026-05-20");
  assert.equal(parsed[1].source_job_id, "hb-1002");
  assert.equal(parsed[1].location, "United Kingdom");
  assert.equal(parsed[1].posting_date, null);
  assert.equal(parsed[2].source_job_id, "hb-1003");
  assert.equal(parsed[2].job_posting_url, "https://fixture.careers.hibob.com/job/hb-1003");
  assert.equal(parsed[2].source_evidence.route_kind, "hibob_job_ad_api");
});

test("hibob normalize validates fixture evidence without invented city or date", () => {
  const company = readJson("company.json");
  const expectedRows = readJson("expected-normalized.json");
  const normalized = source.parse(readJson("list.json"), company).map((posting) => source.normalize(posting, company));

  assert.equal(normalized.length, expectedRows.length);
  for (let index = 0; index < expectedRows.length; index += 1) {
    const expected = expectedRows[index];
    const row = normalized[index];
    assert.equal(source.validate(row).ok, true);
    assert.equal(row.source_job_id, expected.source_job_id);
    assert.equal(row.position_name, expected.position_name);
    assert.equal(row.posting_date || null, expected.posting_date);
    assert.equal(row.remote_type, expected.remote_type);
    assert.equal(row.parser_confidence, expected.parser_confidence);
    assert.equal(row.city || null, expected.city);
    assert.equal(row.country || null, expected.country);
  }
});

test("hibob rejects or quarantines invalid source shapes", () => {
  const company = readJson("company.json");
  const cases = readJson("invalid-shapes.json").cases;

  for (const item of cases) {
    const normalized = source.normalize(item.posting, company);
    const validation = source.validate(normalized);
    const publicDecision = source.validatePublic(normalized);
    if (item.expected === "rejected") {
      assert.equal(validation.ok, false, item.name);
      assert.match(validation.error, new RegExp(item.reason), item.name);
    } else {
      assert.equal(validation.ok, true, item.name);
      assert.equal(publicDecision.status, "quarantined", item.name);
      assert.match(publicDecision.reason, new RegExp(item.reason), item.name);
    }
  }
});

test("hibob parse preserves __legacyParsed payloads", () => {
  const company = readJson("company.json");
  const legacy = [{ source_job_id: "legacy-hibob", company_name: "Fixture HiBob", position_name: "Legacy" }];
  assert.deepEqual(source.parse({ __legacyParsed: legacy }, company), legacy);
});
