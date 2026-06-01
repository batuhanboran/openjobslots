const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const source = require("./index");
const discover = require("./discover");
const { createDiscover } = discover;
const { createFetchList, GREENHOUSE_RATE_LIMIT_WAIT_MS } = require("./fetchList");

const sourceDir = __dirname;

function readJson(fileName) {
  return JSON.parse(fs.readFileSync(path.join(sourceDir, "fixtures", fileName), "utf8"));
}

const company = readJson("company.json");
const listFixture = readJson("list.json");

test("greenhouse discover parses board token and builds API list URL", () => {
  const discovered = source.discover(company);
  const parsed = discover.parseGreenhouseCompany("https://boards.greenhouse.io/Foo%20Bar/jobs");

  assert.equal(discovered.ats_key, "greenhouse");
  assert.equal(discovered.config.boardToken, "fixtureco");
  assert.equal(discovered.config.boardTokenLower, "fixtureco");
  assert.equal(discovered.list_url, "https://boards-api.greenhouse.io/v1/boards/fixtureco/jobs?content=true");
  assert.equal(discovered.source_family, "direct-json-stable");
  assert.equal(discovered.parser_version, source.parserVersion);

  assert.deepEqual(parsed, { boardToken: "Foo Bar", boardTokenLower: "foo bar" });
});

test("greenhouse fetchList preserves API metadata and request options", async () => {
  const requests = [];
  const fetchList = createFetchList({ discover: createDiscover(source.parserVersion) });

  const raw = await fetchList(company, {
    fetcher: async (url, target) => {
      requests.push({ url, target });
      return {
        status: 200,
        url,
        body: JSON.stringify(listFixture)
      };
    }
  });

  assert.deepEqual(
    requests.map((item) => item.url),
    ["https://boards-api.greenhouse.io/v1/boards/fixtureco/jobs?content=true"]
  );
  assert.deepEqual(requests[0].target.headers, { Accept: "application/json" });
  assert.equal(raw.__sourceFetchFinalUrl, "https://boards-api.greenhouse.io/v1/boards/fixtureco/jobs?content=true");
  assert.equal(raw.__sourceConfig.boardToken, "fixtureco");
  assert.equal(raw.__sourceConfig.boardTokenLower, "fixtureco");
  assert.equal(raw.__sourceRequest.rateLimitMs, GREENHOUSE_RATE_LIMIT_WAIT_MS);
  assert.equal(raw.__sourceRequest.requestCount.total, 1);
  assert.equal(raw.__sourceRequest.boardUrl, "https://boards-api.greenhouse.io/v1/boards/fixtureco/jobs?content=true");
  assert.equal(raw.__sourceConfig.companyNameForPostings, "Fixture Greenhouse");

  const parsed = source.parse(raw, company);
  assert.equal(parsed.length, listFixture.jobs.length);
  assert.equal(parsed[0].source_job_id, "1001");
});

test("greenhouse fetchList retries without content when the API payload is too large", async () => {
  const requests = [];
  const fetchList = createFetchList({ discover: createDiscover(source.parserVersion) });

  const raw = await fetchList(company, {
    fetcher: async (url) => {
      requests.push(url);
      if (url.endsWith("?content=true")) {
        const error = new Error("source response is too large");
        error.ingestionErrorType = "response_too_large";
        throw error;
      }
      return {
        status: 200,
        url,
        body: JSON.stringify({
          jobs: listFixture.jobs.map((job) => {
            const { content, ...rest } = job;
            return rest;
          })
        })
      };
    }
  });

  assert.deepEqual(requests, [
    "https://boards-api.greenhouse.io/v1/boards/fixtureco/jobs?content=true",
    "https://boards-api.greenhouse.io/v1/boards/fixtureco/jobs"
  ]);
  assert.equal(raw.__sourceRequest.contentIncluded, false);
  assert.equal(raw.__sourceRequest.requestCount.total, 2);
  assert.equal(raw.__sourceRequest.requestedUrl, "https://boards-api.greenhouse.io/v1/boards/fixtureco/jobs");
  const parsed = source.parse(raw, company);
  assert.equal(parsed.length, listFixture.jobs.length);
  assert.equal(parsed[0].source_job_id, "1001");
  assert.equal(parsed[0].description_html, null);
});

test("greenhouse fetchList rejects non-JSON API payloads", async () => {
  const fetchList = createFetchList({ discover: createDiscover(source.parserVersion) });

  await assert.rejects(
    () =>
      fetchList(company, {
        fetcher: async () => ({
          status: 200,
          url: "https://boards-api.greenhouse.io/v1/boards/fixtureco/jobs?content=true",
          body: "<html>not json</html>"
        })
      }),
    /Greenhouse jobs API response was not JSON/
  );
});

test("greenhouse fetchList rejects missing board routes", async () => {
  const fetchList = createFetchList({ discover: createDiscover(source.parserVersion) });
  await assert.rejects(
    () => fetchList({ ...company, url_string: "https://boards.greenhouse.io" }),
    /Greenhouse company URL does not expose a usable public board token/
  );
});

test("greenhouse fetchList rejects unexpected redirect host", async () => {
  const fetchList = createFetchList({ discover: createDiscover(source.parserVersion) });

  await assert.rejects(
    () =>
      fetchList(company, {
        fetcher: async () => ({
          status: 200,
          url: "https://example.evil/boards/fixtureco/jobs?content=true",
          body: JSON.stringify(listFixture)
        })
      }),
    /Greenhouse API URL redirected to unexpected host/
  );
});

test("greenhouse parse uses __legacyParsed and preserves fixture source id and posting date", () => {
  const legacy = [
    {
      source_job_id: "legacy-id",
      company_name: "Legacy Greenhouse",
      posting_date: "2026-01-01T00:00:00+00:00"
    }
  ];

  const legacyParsed = source.parse({
    __legacyParsed: legacy
  }, {
    company_name: "Legacy"
  });
  assert.deepEqual(legacyParsed, legacy);

  const parsed = source.parse({ ...listFixture, __sourceConfig: { boardTokenLower: "fixtureco" } }, company);
  assert.equal(parsed.length, listFixture.jobs.length);
  assert.equal(parsed[0].source_job_id, "1001");
  assert.equal(parsed[0].posting_date, "2026-05-05T08:00:00+03:00");
});
