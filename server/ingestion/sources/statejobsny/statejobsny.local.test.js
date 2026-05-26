const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const { evaluatePublicPosting } = require("../../publicPostingGate");

const source = require("./index");
const { STATEJOBSNY_RATE_LIMIT_WAIT_MS } = require("./fetchList");

const sourceDir = __dirname;

function readJson(fileName) {
  return JSON.parse(fs.readFileSync(path.join(sourceDir, "fixtures", fileName), "utf8"));
}

test("statejobsny discover exposes the dated public vacancy table", () => {
  const company = readJson("company.json");
  const discovered = source.discover(company);

  assert.equal(discovered.ats_key, "statejobsny");
  assert.equal(discovered.source_family, "public_sector");
  assert.equal(discovered.config.publicOrigin, "https://www.statejobsny.com");
  assert.match(discovered.list_url, /^https:\/\/www\.statejobsny\.com\/public\/vacancyTable\.cfm\?searchResults=yes/);
});

test("statejobsny discover rejects unsupported hosts", () => {
  const discovered = source.discover({
    company_name: "Bad Host",
    url_string: "https://example.com/public/vacancyTable.cfm"
  });

  assert.equal(discovered.ok, false);
  assert.equal(discovered.reason, "unsupported_statejobsny_host");
});

test("statejobsny fetchList gets the rolling list and bounded details with source metadata", async () => {
  const company = readJson("company.json");
  const listFixture = readJson("list.json");
  const details = readJson("detail-pages.json");
  const requests = [];

  const raw = await source.fetchList(company, {
    referenceDate: new Date("2026-05-26T12:00:00Z"),
    detailLimit: 2,
    fetcher: async (url, target) => {
      requests.push({ url, target });
      if (url.includes("vacancyTable.cfm")) {
        return { status: 200, url, body: listFixture.html };
      }
      const id = new URL(url).searchParams.get("id");
      return { status: 200, url, body: details[id] || "" };
    }
  });

  assert.equal(requests[0].target.method, "GET");
  assert.equal(requests[0].target.source_key, "statejobsny");
  assert.equal(requests[0].target.headers["Cache-Control"], "no-cache");
  assert.equal(requests[0].target.rateLimitMs, STATEJOBSNY_RATE_LIMIT_WAIT_MS);
  assert.match(requests[0].url, /minDate=05%2F25%2F26/);
  assert.match(requests[0].url, /maxDate=05%2F27%2F26/);
  assert.equal(raw.__sourceConfig.detail_fetch_count, 2);
  assert.equal(raw.__sourceRequest.rateLimitMs, STATEJOBSNY_RATE_LIMIT_WAIT_MS);
  assert.ok(raw.detail_html_by_source_job_id["216785"]);
  assert.ok(raw.detail_html_by_source_job_id["216786"]);
});

test("statejobsny fetchList rejects unexpected redirect hosts", async () => {
  const company = readJson("company.json");

  await assert.rejects(
    () => source.fetchList(company, {
      fetcher: async () => ({
        status: 200,
        url: "https://example.com/public/vacancyTable.cfm",
        body: "<table></table>"
      })
    }),
    (error) => error?.ingestionErrorType === "unexpected_redirect_host"
  );
});

test("statejobsny parser preserves ids, agency, county, dates, and detail-backed geo", () => {
  const company = readJson("company.json");
  const fixture = readJson("list.json");

  const parsed = source.parse(fixture, company);
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].source_job_id, "216785");
  assert.equal(parsed[0].company_name, "Office of Mental Health");
  assert.equal(parsed[0].county, "Albany");
  assert.equal(parsed[0].location, "Albany, NY");
  assert.equal(parsed[0].posting_date, "05/25/26");
  assert.equal(parsed[1].source_job_id, "216786");
  assert.equal(parsed[1].location, "Buffalo, NY");
  assert.equal(parsed[1].remote_type, "hybrid");
});

test("statejobsny parser keeps county-only list rows out of location evidence", () => {
  const company = readJson("company.json");
  const fixture = readJson("list.json");
  const parsed = source.parse({ html: fixture.html }, company);

  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].county, "Albany");
  assert.equal(parsed[0].location, null);
});

test("statejobsny normalize validates detail-backed fixture evidence", () => {
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
    assert.equal(row.location_text, expected.location);
    assert.equal(row.country, expected.country);
    assert.equal(row.city, expected.city);
    assert.equal(row.remote_type, expected.remote_type);
    assert.equal(row.parser_confidence, expected.parser_confidence);
    const gate = evaluatePublicPosting(row, { parserVersion: source.parserVersion });
    assert.equal(gate.status, "accepted");
  }
});

test("statejobsny rejects or quarantines invalid source shapes", () => {
  const company = readJson("company.json");
  const invalid = readJson("invalid-shapes.json");

  for (const item of invalid.cases) {
    const normalized = source.normalize(item.posting, company);
    const basic = source.validate(normalized);
    const gate = evaluatePublicPosting(normalized, { parserVersion: source.parserVersion });
    if (item.expected === "rejected") {
      assert.equal(basic.ok, false, `${item.name} should fail validation`);
      assert.match(basic.error, new RegExp(item.reason));
    } else {
      assert.equal(basic.ok, true, `${item.name} should pass basic validation`);
      assert.equal(gate.status, "quarantined", `${item.name} should be quarantined`);
      assert.ok(gate.reason_codes.some((reason) => new RegExp(item.reason).test(reason)));
    }
  }
});

test("statejobsny parse preserves __legacyParsed payloads", () => {
  const company = readJson("company.json");
  const legacy = [{ source_job_id: "legacy-1", company_name: "StateJobsNY", position_name: "Legacy" }];
  const parsed = source.parse({ __legacyParsed: legacy }, company);
  assert.deepEqual(parsed, legacy);
});
