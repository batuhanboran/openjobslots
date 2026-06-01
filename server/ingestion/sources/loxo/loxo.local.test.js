const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const source = require("./index");
const { LOXO_RATE_LIMIT_WAIT_MS } = require("./fetchList");

const sourceDir = __dirname;

function readJson(fileName) {
  return JSON.parse(fs.readFileSync(path.join(sourceDir, "fixtures", fileName), "utf8"));
}

test("loxo discover parses app.loxo.co board route", () => {
  const company = readJson("company.json");
  const discovered = source.discover(company);

  assert.equal(discovered.ats_key, "loxo");
  assert.equal(discovered.list_url, "https://app.loxo.co/fixtureco");
  assert.equal(discovered.config.boardSlug, "fixtureco");
  assert.equal(discovered.config.boardSlugLower, "fixtureco");
  assert.equal(discovered.config.baseOrigin, "https://app.loxo.co");
});

test("loxo fetchList succeeds with injected fetcher and exposes source request metadata", async () => {
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
  assert.equal(requests[0].url, "https://app.loxo.co/fixtureco");
  assert.equal(requests[0].target.method, "GET");
  assert.equal(requests[0].target.source_key, "loxo");
  assert.equal(raw.__sourceFetchFinalUrl, "https://app.loxo.co/fixtureco");
  assert.equal(raw.__sourceConfig.baseOrigin, "https://app.loxo.co");
  assert.equal(raw.__sourceRequest.rateLimitMs, LOXO_RATE_LIMIT_WAIT_MS);
  assert.equal(raw.__sourceRequest.boardUrl, "https://app.loxo.co/fixtureco");
});

test("loxo fetchList throws no_public_jobs_route for missing route", async () => {
  const company = {
    ...readJson("company.json"),
    url_string: "https://app.loxo.co"
  };

  await assert.rejects(
    () =>
      source.fetchList(company, {
        fetcher: async () => ({ status: 200, url: "https://app.loxo.co", body: "<html></html>" })
      }),
    (error) => error?.ingestionErrorType === "no_public_jobs_route"
  );
});

test("loxo fetchList rejects unexpected redirect hosts", async () => {
  const company = readJson("company.json");

  await assert.rejects(
    () =>
      source.fetchList(company, {
        fetcher: async () => ({
          status: 200,
          url: "https://example.com/fixtureco",
          body: "<html></html>"
        })
      }),
    (error) => error?.ingestionErrorType === "unexpected_redirect_host"
  );
});

test("loxo parser preserves source ids, location, and date-null behavior", () => {
  const company = readJson("company.json");
  const fixture = readJson("list.json");

  const parsed = source.parse({ html: fixture.html }, company);
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].source_job_id, "1001");
  assert.equal(parsed[0].location, "Remote");
  assert.equal(parsed[0].posting_date, "2026-05-01");
  assert.equal(parsed[1].source_job_id, "1002");
  assert.equal(parsed[1].posting_date, null);
  assert.equal(parsed[1].location, "Istanbul, Turkey");
  assert.equal(parsed[1].source_evidence?.route_kind, "loxo_public_list");
  assert.equal(parsed[1].source_evidence?.list_url, "https://app.loxo.co/fixtureco");
});

test("loxo parser maps source-local region codes without global token inference", () => {
  const company = readJson("company.json");
  const card = (id, title, location) => `
    <div class='jobs-listing-card'>
      <a class='job-title' href='/job/${id}'>${title}</a>
      <div class='job-date'>2 days ago</div>
    </div></div>
    <div class='data-cell'><div class='job-location'>${location}</div></div>
  `;
  const parsed = source.parse({
    html: [
      card("uk-eng", "Quantity Surveyor", "Northwich, ENG"),
      card("uk-wls", "Prototype Engineer", "Cardiff, WLS"),
      card("be-bru", "Functional Analyst", "Bruxelles, BRU"),
      card("nl-ze", "Marine Engineer", "Vlissingen, ZE"),
      card("fr-city", "Relationship Manager", "Dunkerque, 59")
    ].join("")
  }, company);
  const normalized = Object.fromEntries(parsed.map((posting) => {
    const row = source.normalize(posting, company);
    return [row.source_job_id, row];
  }));

  assert.equal(normalized["uk-eng"].country, "United Kingdom");
  assert.equal(normalized["uk-wls"].country, "United Kingdom");
  assert.equal(normalized["be-bru"].country, "Belgium");
  assert.equal(normalized["nl-ze"].country, "Netherlands");
  assert.equal(normalized["fr-city"].country, "France");
  assert.equal(normalized["be-bru"].city, "Bruxelles");
  assert.equal(normalized["be-bru"].source_evidence.country_rule_name, "loxo_list_region_country_code");
  assert.equal(normalized["fr-city"].source_evidence.country_rule_name, "loxo_list_city_country_hint");
});

test("loxo parse preserves __legacyParsed payloads", () => {
  const company = readJson("company.json");
  const legacy = [{ source_job_id: "legacy-1", company_name: "Fixture Loxo", position_name: "Legacy" }];
  const parsed = source.parse({ __legacyParsed: legacy }, company);
  assert.deepEqual(parsed, legacy);
});
