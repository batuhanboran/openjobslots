const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const sourceDir = __dirname;

function readJson(name) {
  return JSON.parse(fs.readFileSync(path.join(sourceDir, "fixtures", name), "utf8"));
}

test("oracle discover builds CandidateExperience list configuration with sane defaults and sanitization", () => {
  const source = require("./index");
  const discover = require("./discover");
  const company = readJson("company.json");

  const discovered = source.discover(company);
  assert.equal(discovered.ats_key, "oracle");
  assert.equal(discovered.source_family, "enterprise_api");
  assert.equal(discovered.parser_version, "source-oracle-v1");
  assert.equal(discovered.config.language, "en");
  assert.equal(discovered.config.siteNumber, "CX_1");
  assert.equal(discovered.config.boardUrl, "https://example.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/jobs");
  assert.equal(
    discovered.config.apiUrl,
    "https://example.oraclecloud.com/hcmRestApi/resources/latest/recruitingCEJobRequisitions"
  );
  assert.equal(
    discovered.config.finder,
    "findReqs;siteNumber=CX_1,facetsList=LOCATIONS;WORK_LOCATIONS;WORKPLACE_TYPES;TITLES;CATEGORIES;ORGANIZATIONS;POSTING_DATES;FLEX_FIELDS,limit=25,sortBy=POSTING_DATES_DESC"
  );

  const minimal = source.discover({
    ...company,
    url_string: "https://example.oraclecloud.com/hcmUI/CandidateExperience?siteNumber=site@number"
  });
  assert.equal(minimal.config.language, "en");
  assert.equal(minimal.config.siteNumber, "sitenumber");
  assert.equal(minimal.config.boardUrl, "https://example.oraclecloud.com/hcmUI/CandidateExperience/en/sites/sitenumber/jobs");

  const sanitized = discover.parseOracleCompany("https://example.oraclecloud.com/hcmUI/CandidateExperience/en/sites/invalid$site/jobs");
  assert.equal(sanitized.siteNumber, "invalidsite");
});

test("oracle fetchList paginates with 25-item pages and keeps request/page metadata", async () => {
  const source = require("./index");
  const { createDiscover } = require("./discover");
  const { createFetchList, ORACLE_RATE_LIMIT_WAIT_MS } = require("./fetchList");
  const company = readJson("company.json");

  const pagePayloads = [
    {
      items: [
        {
          requisitionList: [
            {
              Id: "REQ-5001",
              Title: "Oracle Role 1",
              PostedDate: "2026-05-08T08:00:00+03:00"
            }
          ]
        }
      ],
      hasMore: true
    },
    {
      items: [
        {
          requisitionList: [
            {
              Id: "REQ-5002",
              Title: "Oracle Role 2",
              PostedDate: "2026-05-07T08:00:00+03:00"
            }
          ]
        }
      ],
      hasMore: false
    }
  ];
  const requests = [];
  const fetchList = createFetchList({ discover: createDiscover("source-oracle-v1") });

  const raw = await fetchList(company, {
    fetcher: async (url) => {
      const parsed = new URL(url);
      const offset = Number(parsed.searchParams.get("offset") || "0");
      requests.push(url);
      if (offset === 0) {
        return {
          status: 200,
          url,
          body: JSON.stringify(pagePayloads[0])
        };
      }
      if (offset === 25) {
        return {
          status: 200,
          url,
          body: JSON.stringify(pagePayloads[1])
        };
      }
      return { status: 200, url, body: JSON.stringify({ items: [], hasMore: false }) };
    }
  });

  assert.equal(requests.length, 2);
  assert.equal(raw.__sourceConfig.requestCount.total, 2);
  assert.equal(raw.__sourceConfig.requestCount.pages, 2);
  assert.equal(raw.__sourceConfig.pageCount, 2);
  assert.equal(raw.__sourceRequest.rateLimitMs, ORACLE_RATE_LIMIT_WAIT_MS);
  assert.equal(raw.__sourceRequest.pageCount, 2);
  assert.equal(raw.__sourceRequest.requestCount.total, 2);
  assert.equal(raw.__sourceRequest.requestCount.pages, 2);
  assert.equal(raw.__sourceRequest.pageSize, 25);
  assert.equal(raw.items.length, 2);

  const firstRequest = new URL(requests[0]);
  const secondRequest = new URL(requests[1]);
  assert.equal(firstRequest.searchParams.get("onlyData"), "true");
  assert.equal(firstRequest.searchParams.get("expand"), "requisitionList.workLocation,requisitionList.otherWorkLocations,requisitionList.secondaryLocations,flexFieldsFacet.values,requisitionList.requisitionFlexFields");
  assert.equal(firstRequest.searchParams.get("finder"), "findReqs;siteNumber=CX_1,facetsList=LOCATIONS;WORK_LOCATIONS;WORKPLACE_TYPES;TITLES;CATEGORIES;ORGANIZATIONS;POSTING_DATES;FLEX_FIELDS,limit=25,sortBy=POSTING_DATES_DESC");
  assert.equal(firstRequest.searchParams.get("offset"), "0");
  assert.equal(firstRequest.searchParams.get("limit"), "25");
  assert.equal(secondRequest.searchParams.get("offset"), "25");
  assert.equal(raw.__sourceFetchFinalUrl, requests[1]);
});

test("oracle fetchList rejects non-JSON API bodies", async () => {
  const { createDiscover } = require("./discover");
  const { createFetchList } = require("./fetchList");
  const company = readJson("company.json");
  const fetchList = createFetchList({ discover: createDiscover("source-oracle-v1") });

  await assert.rejects(
    () =>
      fetchList(company, {
        fetcher: async (url) => ({
          status: 200,
          url,
          body: "<html>not json</html>"
        })
      }),
    /Oracle job requisitions API response was not JSON/i
  );
});

test("oracle fetchList rejects URLs redirected outside oraclecloud", async () => {
  const { createDiscover } = require("./discover");
  const { createFetchList } = require("./fetchList");
  const company = readJson("company.json");
  const fetchList = createFetchList({ discover: createDiscover("source-oracle-v1") });

  await assert.rejects(
    () =>
      fetchList(company, {
        fetcher: async (url) => ({
          status: 200,
          url: "https://example.com/recruitingCEJobRequisitions",
          body: JSON.stringify({ items: [], hasMore: false })
        })
      }),
    /Oracle API URL redirected to unexpected host/i
  );
});

test("oracle parse preserves posting id and date fields", () => {
  const source = require("./index");
  const company = readJson("company.json");
  const raw = readJson("list.json");
  const parsed = source.parse(raw, company);

  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].source_job_id, "REQ-5001");
  assert.equal(parsed[0].posting_date, "2026-05-08T08:00:00+03:00");
});

test("oracle parse preserves __legacyParsed payload", () => {
  const source = require("./index");
  const legacy = [{ source_job_id: "LEGACY-1", posting_date: "2026-01-01", position_name: "Legacy", job_posting_url: "https://example.oraclecloud.com/job/legacy" }];
  const parsed = source.parse({ __legacyParsed: legacy }, { company_name: "Legacy Oracle" });
  assert.deepEqual(parsed, legacy);
});
