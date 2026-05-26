const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const sourceDir = __dirname;

function readJson(name) {
  return JSON.parse(fs.readFileSync(path.join(sourceDir, "fixtures", name), "utf8"));
}

test("talentreef discovery handles apply.jobappnetwork.com hosts and parses company route", () => {
  const company = readJson("company.json");
  const { createDiscover, parseTalentreefCompany, supportedTalentreefHost } = require("./discover");
  const discover = createDiscover("source-talentreef-v1");

  const discovered = discover(company);
  assert.equal(discovered.ats_key, "talentreef");
  assert.equal(discovered.list_url, "https://apply.jobappnetwork.com/fixture");
  assert.equal(discovered.config.companyNameLower, "fixture");
  assert.equal(discovered.config.boardUrl, "https://apply.jobappnetwork.com/fixture");
  assert.equal(parseTalentreefCompany("https://www.apply.jobappnetwork.com/fixture").companyNameLower, "fixture");
  assert.equal(supportedTalentreefHost("apply.jobappnetwork.com"), true);
  assert.equal(supportedTalentreefHost("evil.example.com"), false);
});

test("talentreef fetchList reads alias then search API and preserves __sourceRequest metadata", async () => {
  const source = require("./index");
  const { createDiscover } = require("./discover");
  const { createFetchList, TALENTREEF_RATE_LIMIT_WAIT_MS } = require("./fetchList");
  const company = readJson("company.json");
  const fixture = readJson("fetch-list.json");
  const requested = [];
  const fetchList = createFetchList({ discover: createDiscover("source-talentreef-v1") });

  const raw = await fetchList(company, {
    fetcher: async (url, target) => {
      requested.push({ url, method: target.method, accept: target.headers.Accept });
      if (url === "https://prod-kong.internal.talentreef.com/apply/careerPages/alias/fixture") {
        return { status: 200, url, body: JSON.stringify(fixture.alias) };
      }
      if (url === "https://prod-kong.internal.talentreef.com/apply/proxy-es/search-en-us/posting/_search") {
        return { status: 200, url, body: JSON.stringify(fixture.search) };
      }
      return { status: 404, url, body: "" };
    }
  });

  assert.deepEqual(requested, [{
    url: "https://prod-kong.internal.talentreef.com/apply/careerPages/alias/fixture",
    method: "GET",
    accept: "application/json"
  }, {
    url: "https://prod-kong.internal.talentreef.com/apply/proxy-es/search-en-us/posting/_search",
    method: "POST",
    accept: "application/json"
  }]);

  assert.equal(raw.__sourceConfig.clientId, "fixture-client-id");
  assert.equal(raw.__sourceConfig.brand, "Fixture Brand");
  assert.equal(raw.__sourceConfig.aliasFinalUrl, "https://prod-kong.internal.talentreef.com/apply/careerPages/alias/fixture");
  assert.equal(raw.__sourceConfig.searchFinalUrl, "https://prod-kong.internal.talentreef.com/apply/proxy-es/search-en-us/posting/_search");
  assert.equal(raw.__sourceRequest.boardUrl, "https://apply.jobappnetwork.com/fixture");
  assert.equal(raw.__sourceRequest.aliasApiUrl, "https://prod-kong.internal.talentreef.com/apply/careerPages/alias/fixture");
  assert.equal(raw.__sourceRequest.searchApiUrl, "https://prod-kong.internal.talentreef.com/apply/proxy-es/search-en-us/posting/_search");
  assert.equal(raw.__sourceRequest.rateLimitMs, TALENTREEF_RATE_LIMIT_WAIT_MS);
  assert.equal(raw.__sourceRequest.searchRequestCount, 1);
  assert.equal(raw.__sourceConfig.requestCount.total, 2);
  assert.equal(raw.__sourceConfig.requestCount.search, 1);
  assert.equal(raw.__sourceConfig.requestCount.aliases, 1);

  const parsed = source.parse(raw, company);
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].source_job_id, "TR1001");
  assert.equal(parsed[1].source_job_id, "TR1002");
  assert.equal(parsed[0].source_evidence.list_url, "https://apply.jobappnetwork.com/fixture");
  assert.equal(parsed[0].source_evidence.api_url, "https://prod-kong.internal.talentreef.com/apply/proxy-es/search-en-us/posting/_search");
});

test("talentreef fetchList rejects missing clientId in alias response", async () => {
  const { createDiscover } = require("./discover");
  const { createFetchList } = require("./fetchList");
  const company = readJson("company.json");
  const fetchList = createFetchList({ discover: createDiscover("source-talentreef-v1") });

  await assert.rejects(
    () => fetchList(company, {
      fetcher: async (url) => {
        if (url === "https://prod-kong.internal.talentreef.com/apply/careerPages/alias/fixture") {
          return { status: 200, url, body: "[{\"clients\":[{}]}]" };
        }
        return { status: 200, url, body: "{}" };
      }
    }),
    /missing clientId/i
  );
});

test("talentreef fetchList rejects non-JSON search payloads", async () => {
  const { createDiscover } = require("./discover");
  const { createFetchList } = require("./fetchList");
  const company = readJson("company.json");
  const fixture = readJson("fetch-list.json");
  const fetchList = createFetchList({ discover: createDiscover("source-talentreef-v1") });

  await assert.rejects(
    () => fetchList(company, {
      fetcher: async (url) => {
        if (url === "https://prod-kong.internal.talentreef.com/apply/careerPages/alias/fixture") {
          return { status: 200, url, body: JSON.stringify(fixture.alias) };
        }
        return { status: 200, url, body: "<html>not json</html>" };
      }
    }),
    /TalentReef search response was not JSON/i
  );
});

test("talentreef fetchList rejects unexpected host redirections for alias and search API", async () => {
  const { createDiscover } = require("./discover");
  const { createFetchList } = require("./fetchList");
  const company = readJson("company.json");
  const fixture = readJson("fetch-list.json");
  const fetchList = createFetchList({ discover: createDiscover("source-talentreef-v1") });

  await assert.rejects(
    () => fetchList(company, {
      fetcher: async (url) => ({
        status: 200,
        url: "https://example.com/apply/careerPages/alias/fixture",
        body: JSON.stringify(fixture.alias)
      })
    }),
    /unexpected host/i
  );

  await assert.rejects(
    () => fetchList(company, {
      fetcher: async (url) => {
        if (url === "https://prod-kong.internal.talentreef.com/apply/careerPages/alias/fixture") {
          return { status: 200, url, body: JSON.stringify(fixture.alias) };
        }
        return { status: 200, url: "https://example.com/apply/proxy-es/search-en-us/posting/_search", body: JSON.stringify({ hits: { hits: [] } }) };
      }
    }),
    /unexpected host/i
  );
});
