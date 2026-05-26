const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const { evaluatePublicPosting } = require("../../publicPostingGate");

const source = require("./index");
const { CALCAREERS_RATE_LIMIT_WAIT_MS } = require("./fetchList");

const sourceDir = __dirname;

function readJson(fileName) {
  return JSON.parse(fs.readFileSync(path.join(sourceDir, "fixtures", fileName), "utf8"));
}

test("calcareers discover exposes the ASP.NET search endpoint", () => {
  const company = readJson("company.json");
  const discovered = source.discover(company);

  assert.equal(discovered.ats_key, "calcareers");
  assert.equal(discovered.source_family, "public_sector");
  assert.equal(discovered.config.publicOrigin, "https://calcareers.ca.gov");
  assert.equal(discovered.list_url, "https://calcareers.ca.gov/CalHRPublic/Search/JobSearchResults.aspx");
});

test("calcareers discover rejects unsupported hosts", () => {
  const discovered = source.discover({
    company_name: "Bad Host",
    url_string: "https://example.com/CalHRPublic/Search/JobSearchResults.aspx"
  });

  assert.equal(discovered.ok, false);
  assert.equal(discovered.reason, "unsupported_calcareers_host");
});

test("calcareers fetchList gets landing, search postback, row-count postback, and bounded pager pages", async () => {
  const company = readJson("company.json");
  const fixture = readJson("list.json");
  const requests = [];

  const raw = await source.fetchList(company, {
    maxPages: 3,
    fetcher: async (url, target) => {
      requests.push({ url, target });
      if (target.method === "GET") {
        return { status: 200, url, body: fixture.landing_html };
      }
      const body = new URLSearchParams(target.body || "");
      const eventTarget = body.get("__EVENTTARGET");
      if (eventTarget === "ctl00$cphMainContent$btnSearch") {
        return { status: 200, url, body: fixture.html_pages[0] };
      }
      if (eventTarget === "ctl00$cphMainContent$ddlRowCount") {
        assert.equal(body.get("ctl00$cphMainContent$ddlRowCount"), "100");
        return { status: 200, url, body: fixture.html_pages[0] };
      }
      if (eventTarget === "ctl00$cphMainContent$rptPager$ctl02$btnPagerItem") {
        return { status: 200, url, body: fixture.html_pages[1] };
      }
      throw new Error(`unexpected event target ${eventTarget}`);
    }
  });

  assert.equal(requests[0].target.method, "GET");
  assert.equal(requests[0].target.source_key, "calcareers");
  assert.equal(requests[0].target.rateLimitMs, CALCAREERS_RATE_LIMIT_WAIT_MS);
  assert.equal(requests[1].target.method, "POST");
  assert.equal(new URLSearchParams(requests[1].target.body).get("__VIEWSTATE"), "view-fixture");
  assert.equal(raw.__sourceConfig.fetched_pages, 3);
  assert.equal(raw.__sourceRequest.rateLimitMs, CALCAREERS_RATE_LIMIT_WAIT_MS);
  assert.equal(raw.html_pages.length, 3);
});

test("calcareers fetchList rejects unexpected redirect hosts", async () => {
  const company = readJson("company.json");

  await assert.rejects(
    () => source.fetchList(company, {
      fetcher: async () => ({
        status: 200,
        url: "https://example.com/CalHRPublic/Search/JobSearchResults.aspx",
        body: "<html></html>"
      })
    }),
    (error) => error?.ingestionErrorType === "unexpected_redirect_host"
  );
});

test("calcareers parser preserves source ids, department, location, and publish date", () => {
  const company = readJson("company.json");
  const fixture = readJson("list.json");

  const parsed = source.parse(fixture, company);
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].source_job_id, "431234");
  assert.equal(parsed[0].company_name, "Air Resources Board");
  assert.equal(parsed[0].location, "Sacramento, CA");
  assert.equal(parsed[0].posting_date, "05/26/2026");
  assert.equal(parsed[1].source_job_id, "431235");
  assert.equal(parsed[1].company_name, "Department of Health Care Services");
});

test("calcareers normalize validates fixture evidence", () => {
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

test("calcareers rejects or quarantines invalid source shapes", () => {
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

test("calcareers parse preserves __legacyParsed payloads", () => {
  const company = readJson("company.json");
  const legacy = [{ source_job_id: "legacy-1", company_name: "CalCareers", position_name: "Legacy" }];
  const parsed = source.parse({ __legacyParsed: legacy }, company);
  assert.deepEqual(parsed, legacy);
});
