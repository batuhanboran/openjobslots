const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const { getSourceModule } = require("../index");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

const source = getSourceModule("adp_workforcenow");
const sourceDir = __dirname;
const company = readJson(path.join(sourceDir, "fixtures", "company.json"));
const fixtureList = readJson(path.join(sourceDir, "fixtures", "list.json"));

test("adp_workforcenow discover supports both workforcenow hosts and requires cid+ccId", () => {
  const discoveredPrimary = source.discover(company);
  const discoveredWww = source.discover({
    ...company,
    url_string: "https://www.workforcenow.adp.com/mascsr/default/mdf/recruitment/recruitment.html?cid=abc123&ccId=ACME-FOODS"
  });
  const discoveredMissingParams = source.discover({
    ...company,
    url_string: "https://workforcenow.adp.com/mascsr/default/mdf/recruitment/recruitment.html?cid=abc123"
  });

  assert.equal(discoveredPrimary.config.cid, "abc123");
  assert.equal(discoveredPrimary.config.ccId, "ACME-FOODS");
  assert.equal(discoveredPrimary.config.contentLinksBaseUrl, "https://workforcenow.adp.com/mascsr/default/careercenter/public/events/staffing/v1/content-links/career-center");
  assert.equal(discoveredPrimary.config.jobRequisitionsUrl, "https://workforcenow.adp.com/mascsr/default/careercenter/public/events/staffing/v1/job-requisitions?cid=abc123&ccId=ACME-FOODS");
  assert.equal(discoveredWww.config.host, "www.workforcenow.adp.com");
  assert.equal(discoveredWww.config.boardUrl, "https://workforcenow.adp.com/mascsr/default/mdf/recruitment/recruitment.html?cid=abc123&ccId=ACME-FOODS");
  assert.deepEqual(discoveredMissingParams.config, {});
});

test("adp_workforcenow fetchList runs content-links then jobs and preserves source request metadata", async () => {
  const expectedContentLinksUrl =
    "https://workforcenow.adp.com/mascsr/default/careercenter/public/events/staffing/v1/content-links/career-center" +
    "?cid=abc123&timeStamp=1700000000000&ccId=ACME-FOODS&locale=en_US&lang=en_US";
  const expectedJobsUrl = "https://workforcenow.adp.com/mascsr/default/careercenter/public/events/staffing/v1/job-requisitions?cid=abc123&ccId=ACME-FOODS";

  const requests = [];
  const raw = await source.fetchList(company, {
    now: () => 1700000000000,
    fetcher: async (url, target) => {
      requests.push({ url, target });
      if (url === expectedContentLinksUrl) {
        return {
          contentLinks: [
            {
              linkTypeCode: {
                codeValue: "WELCOME-TXT"
              },
              contentBody: {
                links: [{ title: "Fixture ADP WFN" }]
              }
            }
          ],
          url: expectedContentLinksUrl
        };
      }
      assert.equal(url, expectedJobsUrl);
      return {
        jobRequisitions: fixtureList.jobRequisitions,
        url: expectedJobsUrl
      };
    }
  });

  assert.deepEqual(requests.map((item) => item.url), [expectedContentLinksUrl, expectedJobsUrl]);
  assert.deepEqual(requests.map((item) => item.target.headers), [
    { Accept: "application/json, text/plain, */*" },
    { Accept: "application/json, text/plain, */*" }
  ]);
  assert.equal(raw.__sourceFetchFinalUrl, expectedJobsUrl);
  assert.equal(raw.__sourceConfig.ccId, "ACME-FOODS");
  assert.equal(raw.__sourceConfig.companyNameForPostings, "Fixture ADP WFN");
  assert.equal(raw.__sourceRequest.rateLimitMs, 60 * 1000);
  assert.equal(raw.__sourceRequest.boardUrl, "https://workforcenow.adp.com/mascsr/default/mdf/recruitment/recruitment.html?cid=abc123&ccId=ACME-FOODS");
  assert.equal(raw.__sourceRequest.contentLinksUrl, expectedContentLinksUrl);
  assert.equal(raw.__sourceRequest.contentLinksFinalUrl, expectedContentLinksUrl);
  assert.equal(raw.__sourceRequest.jobRequisitionsUrl, expectedJobsUrl);
  assert.equal(raw.__sourceRequest.jobRequisitionsFinalUrl, expectedJobsUrl);
  assert.equal(raw.__sourceRequest.requestCount.contentLinks, 1);
  assert.equal(raw.__sourceRequest.requestCount.jobRequisitions, 1);
  assert.equal(raw.__sourceRequest.requestCount.total, 2);
  assert.equal(raw.__sourceRequest.requestCount.total, raw.__sourceRequest.requestCount.contentLinks + raw.__sourceRequest.requestCount.jobRequisitions);

  const parsed = source.parse(raw, company);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].company_name, "Fixture ADP WFN");
  assert.equal(parsed[0].source_job_id, "REQ-5001");
  assert.equal(parsed[0].posting_date, "2026-05-08T08:00:00+03:00");
});

test("adp_workforcenow fetchList rejects non-JSON content-links responses deterministically", async () => {
  await assert.rejects(
    () => source.fetchList(company, {
      fetcher: async (url) => {
        if (url.includes("content-links/career-center")) {
          return {
            status: 200,
            url,
            body: "not-json"
          };
        }
        return { jobRequisitions: fixtureList.jobRequisitions, url };
      }
    }),
    /ADP Workforce Now content-links response was not JSON/
  );
});

test("adp_workforcenow fetchList rejects redirects to unexpected host", async () => {
  await assert.rejects(
    () => source.fetchList(company, {
      fetcher: async (url) => {
        if (url.includes("content-links/career-center")) {
          return {
            status: 200,
            url: "https://malicious.example.com"
          };
        }
        return { jobRequisitions: fixtureList.jobRequisitions, url };
      }
    }),
    /ADP Workforce Now content-links URL redirected to unexpected host/
  );
});

test("adp_workforcenow parse keeps source id/date and strips internal metadata", () => {
  const raw = {
    jobRequisitions: [
      {
        itemID: "REQ-5001",
        requisitionTitle: "Hybrid Payroll Analyst",
        postDate: "2026-05-08T08:00:00+03:00",
        links: []
      }
    ],
    __legacyParsed: [
      {
        source_job_id: "legacy-id",
        company_name: "Legacy"
      }
    ],
    __sourceConfig: {
      ccId: "ACME-FOODS"
    },
    __sourceRequest: {
      rateLimitMs: 60000
    }
  };

  const fromLegacy = source.parse(raw, company);
  assert.equal(fromLegacy.length, 1);
  assert.equal(fromLegacy[0].source_job_id, "legacy-id");
  assert.equal(fromLegacy[0].company_name, "Legacy");
  assert.equal(fromLegacy[0].posting_date, undefined);

  const parsed = source.parse({
    jobRequisitions: fixtureList.jobRequisitions,
    __companyNameForPostings: "Fixture ADP WFN",
    __sourceConfig: {
      ccId: "ACME-FOODS",
      boardUrl: "https://workforcenow.adp.com/mascsr/default/mdf/recruitment/recruitment.html?cid=abc123&ccId=ACME-FOODS"
    }
  }, company);
  assert.equal(parsed[0].source_job_id, "REQ-5001");
  assert.equal(parsed[0].posting_date, "2026-05-08T08:00:00+03:00");
  assert.equal(parsed[0].company_name, "Fixture ADP WFN");
});
