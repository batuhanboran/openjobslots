const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const { evaluatePublicPosting } = require("../publicPostingGate");
const { getSourceModule } = require("./index");

const ENTERPRISE_SOURCES = Object.freeze([
  "workday",
  "icims",
  "taleo",
  "oracle",
  "paylocity",
  "adp_workforcenow",
  "adp_myjobs",
  "ultipro",
  "pageup",
  "saphrcloud",
  "brassring"
]);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function readText(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

for (const atsKey of ENTERPRISE_SOURCES) {
  test(`${atsKey} enterprise source module parses fixture with strict evidence`, () => {
    const source = getSourceModule(atsKey);
    assert.ok(source, `expected source module ${atsKey}`);
    const sourceDir = path.join(__dirname, atsKey);
    const company = readJson(path.join(sourceDir, "fixtures", "company.json"));
    const rawList = readJson(path.join(sourceDir, "fixtures", "list.json"));
    const expectedRows = readJson(path.join(sourceDir, "fixtures", "expected-normalized.json"));

    const discovered = source.discover(company);
    assert.equal(discovered.ats_key, atsKey);
    assert.ok(source.parserVersion.startsWith(`source-${atsKey}-v`));
    assert.ok(["enterprise_api", "html_detail", "brittle"].includes(discovered.source_family));

    const parsed = source.parse(rawList, company);
    assert.equal(parsed.length, expectedRows.length, `${atsKey} parsed fixture count should match`);
    const normalized = parsed.map((posting) => source.normalize(posting, company));

    for (let index = 0; index < expectedRows.length; index += 1) {
      const row = normalized[index];
      const expected = expectedRows[index];
      assert.equal(source.validate(row).ok, true);
      assert.equal(row.ats_key, atsKey);
      assert.equal(row.parser_key, atsKey);
      assert.equal(row.parser_version, source.parserVersion);
      assert.equal(typeof row.parser_confidence, "number");
      assert.equal(typeof row.confidence_score, "number");
      assert.ok(row.evidence?.title?.present);
      assert.ok(row.evidence?.company?.present);
      assert.ok(row.evidence?.canonical_url?.present);
      assert.equal(row.source_job_id, expected.source_job_id);
      assert.equal(row.company_name, expected.company_name);
      assert.equal(row.position_name, expected.position_name);
      assert.equal(row.country, expected.country || "");
      if (expected.city) assert.equal(row.city, expected.city);
      assert.equal(row.remote_type, expected.remote_type || "unknown");
      if (expected.posting_date) assert.equal(row.posting_date, expected.posting_date);
      assert.equal(row.parser_confidence, expected.parser_confidence);
      const gate = evaluatePublicPosting(row, { parserVersion: source.parserVersion });
      assert.equal(gate.status, "accepted", `${atsKey} valid fixture should pass public gate`);
    }
  });

  test(`${atsKey} enterprise source module rejects or quarantines invalid source shapes`, () => {
    const source = getSourceModule(atsKey);
    const sourceDir = path.join(__dirname, atsKey);
    const company = readJson(path.join(sourceDir, "fixtures", "company.json"));
    const invalid = readJson(path.join(sourceDir, "fixtures", "invalid-shapes.json"));

    for (const item of invalid.cases) {
      const normalized = source.normalize(item.posting, company);
      const basic = source.validate(normalized);
      const gate = evaluatePublicPosting(normalized, { parserVersion: source.parserVersion });
      if (item.expected === "rejected") {
        assert.equal(basic.ok, false, `${atsKey} ${item.name} should fail validation`);
        assert.match(basic.error, new RegExp(item.reason));
      } else {
        assert.equal(basic.ok, true, `${atsKey} ${item.name} should pass basic validation`);
        assert.equal(gate.status, "quarantined", `${atsKey} ${item.name} should be quarantined`);
        assert.ok(gate.reason_codes.includes(item.reason), `${atsKey} ${item.name} should include ${item.reason}`);
      }
    }
  });
}

test("paylocity discovery accepts both short and slugified board URLs", () => {
  const source = getSourceModule("paylocity");
  const sourceDir = path.join(__dirname, "paylocity");
  const fixtureCompany = readJson(path.join(sourceDir, "fixtures", "company.json"));
  const shortListingUrl = "https://recruiting.paylocity.com/recruiting/jobs/All/fixtureco";
  const listedBySlugUrl = "https://www.recruiting.paylocity.com/recruiting/jobs/Engineering/fixtureco/engineering-ops";

  const shortListing = source.discover({ ...fixtureCompany, url_string: shortListingUrl });
  const withSlug = source.discover({ ...fixtureCompany, url_string: listedBySlugUrl });

  assert.equal(shortListing.ats_key, "paylocity");
  assert.equal(shortListing.config.siteBaseUrl, "https://recruiting.paylocity.com");
  assert.equal(shortListing.config.listingSegment, "All");
  assert.equal(shortListing.config.companyId, "fixtureco");
  assert.equal(typeof shortListing.config.companySlug, "undefined");
  assert.equal(shortListing.list_url, shortListingUrl);

  assert.equal(withSlug.config.siteBaseUrl, "https://www.recruiting.paylocity.com");
  assert.equal(withSlug.config.listingSegment, "Engineering");
  assert.equal(withSlug.config.companyId, "fixtureco");
  assert.equal(withSlug.config.companySlug, "engineering-ops");
  assert.equal(withSlug.list_url, listedBySlugUrl);
});

test("paylocity fetchList extracts window.pageData and keeps source metadata", async () => {
  const source = getSourceModule("paylocity");
  const sourceDir = path.join(__dirname, "paylocity");
  const company = readJson(path.join(sourceDir, "fixtures", "company.json"));
  const boardUrl = "https://recruiting.paylocity.com/recruiting/jobs/All/fixtureco";
  const requests = [];
  const raw = await source.fetchList({ ...company, url_string: boardUrl }, {
    fetcher: async (url, target) => {
      requests.push({ url, target });
      return `
        <html><body>
          <script>
            window.pageData = ${JSON.stringify({
              Jobs: [
                {
                  JobId: "5001",
                  JobTitle: "Paylocity Role 1",
                  PublishedDate: "2026-05-08T08:00:00+03:00",
                  JobLocation: { City: "Berlin", Country: "Germany" }
                },
                {
                  JobId: "5001",
                  JobTitle: "Duplicate Paylocity Role",
                  PublishedDate: "2026-05-07T08:00:00+03:00",
                  JobLocation: { City: "Berlin", Country: "Germany" }
                },
                {
                  JobId: "5002",
                  JobTitle: "Missing Date Role",
                  PublishedDate: "",
                  JobLocation: { City: "Austin", Country: "United States" }
                }
              ]
            })}
          </script>
        </body></html>
      `;
    }
  });

  assert.deepEqual(requests.map((request) => request.url), [boardUrl]);
  assert.equal(requests[0].target.source_family, "enterprise_api");
  assert.equal(raw.__sourceFetchFinalUrl, boardUrl);
  assert.equal(raw.__sourceRequest.rateLimitMs, 60 * 1000);
  assert.equal(raw.__sourceConfig.companyId, "fixtureco");
  assert.equal(raw.__sourceConfig.siteBaseUrl, "https://recruiting.paylocity.com");
  assert.equal(raw.__sourceConfig.listingSegment, "All");

  const parsed = source.parse(raw, company);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].source_job_id, "5001");
  assert.equal(parsed[0].position_name, "Paylocity Role 1");
  assert.equal(parsed[0].job_posting_url, "https://recruiting.paylocity.com/Recruiting/Jobs/Details/5001");
});

test("paylocity source fetchList rejects redirect to unexpected host", async () => {
  const source = getSourceModule("paylocity");
  const sourceDir = path.join(__dirname, "paylocity");
  const company = readJson(path.join(sourceDir, "fixtures", "company.json"));
  const boardUrl = "https://recruiting.paylocity.com/recruiting/jobs/All/fixtureco";

  await assert.rejects(
    () => source.fetchList(company, {
      fetcher: async () => ({
        status: 200,
        url: "https://malicious.example.com/recruiting/jobs/All/fixtureco",
        text: "window.pageData={\"Jobs\":[]};"
      })
    }),
    /Paylocity URL redirected to unexpected host:/
  );
});

test("brassring discovery normalizes preload board URLs to source-local config", () => {
  const source = getSourceModule("brassring");
  const sourceDir = path.join(__dirname, "brassring");
  const fixtureCompany = readJson(path.join(sourceDir, "fixtures", "company.json"));

  const discovered = source.discover(fixtureCompany);

  assert.equal(discovered.ats_key, "brassring");
  assert.equal(discovered.source_family, "brittle");
  assert.equal(discovered.config.partnerId, "1");
  assert.equal(discovered.config.siteId, "2");
  assert.equal(discovered.config.boardUrl, "https://sjobs.brassring.com/TGnewUI/Search/Home/Home?partnerid=1&siteid=2");
  assert.equal(discovered.config.apiUrl, "https://sjobs.brassring.com/TgNewUI/Search/Ajax/MatchedJobs");
  assert.equal(discovered.list_url, discovered.config.boardUrl);
});

test("brassring fetchList posts MatchedJobs request with source-local tokens and metadata", async () => {
  const source = getSourceModule("brassring");
  const sourceDir = path.join(__dirname, "brassring");
  const company = readJson(path.join(sourceDir, "fixtures", "company.json"));
  const requests = [];
  const boardUrl = "https://sjobs.brassring.com/TGnewUI/Search/Home/Home?partnerid=1&siteid=2";
  const apiUrl = "https://sjobs.brassring.com/TgNewUI/Search/Ajax/MatchedJobs";

  const raw = await source.fetchList(company, {
    fetcher: async (url, target) => {
      requests.push({ url, target });
      if (url === boardUrl) {
        return {
          status: 200,
          url: boardUrl,
          headers: {
            get(name) {
              return String(name || "").toLowerCase() === "set-cookie"
                ? "BRSESSION=abc; Path=/, OTHER=def; Path=/"
                : "";
            }
          },
          body: `
            <html><head><title>Search Jobs at | Fixture BrassRing</title></head>
            <body>
              <input type="hidden" name="__RequestVerificationToken" value="token-123">
              <input type="hidden" name="CookieValue" value="encrypted-session">
              <script>{"PartnerName":"Fixture BrassRing"}</script>
            </body></html>
          `
        };
      }
      assert.equal(url, apiUrl);
      return {
        status: 200,
        url: apiUrl,
        Jobs: {
          Job: [
            {
              Questions: [
                { QuestionName: "reqid", Value: "BR-7001" },
                { QuestionName: "jobtitle", Value: "BrassRing Role 1" },
                { QuestionName: "location", Value: "Toronto, ON, Canada" },
                { QuestionName: "lastupdated", Value: "2026-05-12" }
              ]
            }
          ]
        }
      };
    }
  });

  assert.equal(requests.length, 2);
  assert.equal(requests[0].target.method, "GET");
  assert.equal(requests[0].target.source_family, "brittle");
  assert.equal(requests[1].target.method, "POST");
  assert.equal(requests[1].target.source_family, "brittle");
  assert.equal(requests[1].target.headers.RFT, "token-123");
  assert.equal(requests[1].target.headers.Cookie, "BRSESSION=abc; OTHER=def");
  const body = JSON.parse(requests[1].target.body);
  assert.equal(body.PartnerId, "1");
  assert.equal(body.SiteId, "2");
  assert.equal(body.encryptedsessionvalue, "encrypted-session");
  assert.equal(raw.__sourceFetchFinalUrl, apiUrl);
  assert.equal(raw.__sourceRequest.boardUrl, boardUrl);
  assert.equal(raw.__sourceRequest.rateLimitMs, 60 * 1000);
  assert.equal(raw.__sourceConfig.boardCompanyName, "Fixture BrassRing");

  const parsed = source.parse(raw, company);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].source_job_id, "BR-7001");
  assert.equal(parsed[0].position_name, "BrassRing Role 1");
});

test("brassring source fetchList rejects redirect to unexpected host", async () => {
  const source = getSourceModule("brassring");
  const sourceDir = path.join(__dirname, "brassring");
  const company = readJson(path.join(sourceDir, "fixtures", "company.json"));

  await assert.rejects(
    () => source.fetchList(company, {
      fetcher: async () => ({
        status: 200,
        url: "https://malicious.example.com/TGnewUI/Search/Home/Home?partnerid=1&siteid=2",
        body: "<html></html>"
      })
    }),
    /BrassRing URL redirected to unexpected host:/
  );
});

test("target enterprise ATS modules return no postings for empty raw payloads", () => {
  for (const atsKey of ["workday", "icims"]) {
    const source = getSourceModule(atsKey);
    const company = readJson(path.join(__dirname, atsKey, "fixtures", "company.json"));
    assert.deepEqual(source.parse({ html: "", jobPostings: [] }, company), [], atsKey);
  }
});

test("icims source module ignores malformed or unsupported raw list shapes", () => {
  const source = getSourceModule("icims");
  const sourceDir = path.join(__dirname, "icims");
  const company = readJson(path.join(sourceDir, "fixtures", "company.json"));
  const malformed = readJson(path.join(sourceDir, "fixtures", "malformed-list-shapes.json"));

  for (const item of malformed.cases) {
    const parsed = source.parse(item.payload, company);
    assert.equal(parsed.length, 0, `icims ${item.name} should not produce postings`);
  }
});

test("workday source module fetches CXS list with POST pagination body", async () => {
  const source = getSourceModule("workday");
  const company = readJson(path.join(__dirname, "workday", "fixtures", "company.json"));
  const seenRequests = [];
  const raw = await source.fetchList(company, {
    fetcher: async (url, target) => {
      seenRequests.push({ url, target });
      assert.equal(target.method, "POST");
      assert.equal(target.source_family, "enterprise_api");
      assert.equal(target.headers.Accept, "application/json");
      assert.equal(target.headers["Content-Type"], "application/json");
      const body = JSON.parse(target.body);
      assert.equal(body.limit, 20);
      assert.equal(body.offset, 0);
      assert.equal(body.searchText, "");
      return {
        jobPostings: [
          {
            jobRequisitionId: "JR7001",
            title: "Remote Workday Fixture",
            externalPath: "/job/Remote-US/Remote-Workday-Fixture_JR7001",
            postedOnDate: "2026-05-11",
            locationsText: "Remote - United States",
            remoteType: "Remote"
          }
        ]
      };
    }
  });
  assert.equal(seenRequests.length, 1);
  const parsed = source.parse(raw, company);
  assert.equal(parsed.length, 1);
  const normalized = source.normalize(parsed[0], company);
  assert.equal(normalized.source_job_id, "JR7001");
  assert.equal(normalized.country, "United States");
  assert.equal(normalized.remote_type, "remote");
  assert.equal(source.validatePublic(normalized).status, "accepted");
});

test("adp_myjobs source module fetches career-site token before requisitions API", async () => {
  const source = getSourceModule("adp_myjobs");
  const company = readJson(path.join(__dirname, "adp_myjobs", "fixtures", "company.json"));
  const fixtureList = readJson(path.join(__dirname, "adp_myjobs", "fixtures", "list.json"));
  const requests = [];
  const raw = await source.fetchList(company, {
    pageSize: 100,
    maxPages: 3,
    fetcher: async (url, target) => {
      requests.push({ url, target });
      if (url === "https://myjobs.adp.com/public/staffing/v1/career-site/acme") {
        assert.equal(target.method, "GET");
        assert.equal(target.source_family, "enterprise_api");
        assert.equal(target.headers.Accept, "application/json, text/plain, */*");
        return {
          myJobsToken: "fixture-token",
          properties: {
            myadpUrl: "https://fixture.adp.example"
          }
        };
      }
      if (url.startsWith("https://fixture.adp.example/myadp_prefix/mycareer/public/staffing/v1/job-requisitions/apply-custom-filters?")) {
        const parsedUrl = new URL(url);
        assert.equal(target.method, "GET");
        assert.equal(target.source_family, "enterprise_api");
        assert.equal(target.headers.Accept, "application/json, text/plain, */*");
        assert.equal(target.headers.myjobstoken, "fixture-token");
        assert.equal(target.headers.rolecode, "manager");
        assert.equal(target.headers.Origin, "https://myjobs.adp.com");
        assert.equal(target.headers.Referer, "https://myjobs.adp.com/acme/cx/job-listing");
        assert.equal(parsedUrl.searchParams.get("$top"), "100");
        assert.equal(parsedUrl.searchParams.get("$skip"), "0");
        return fixtureList;
      }
      throw new Error(`unexpected ADP MyJobs fixture fetch ${url}`);
    }
  });

  assert.deepEqual(requests.map((request) => request.target.method), ["GET", "GET"]);
  const parsed = source.parse(raw, company);
  assert.equal(parsed.length, 1);
  const normalized = source.normalize(parsed[0], company);
  assert.equal(normalized.source_job_id, "REQ-5001");
  assert.equal(normalized.country, "Canada");
  assert.equal(normalized.city, "Toronto");
  assert.equal(normalized.remote_type, "onsite");
  assert.equal(normalized.posting_date, "2026-05-08");
  assert.equal(source.validatePublic(normalized).status, "accepted");
});

test("ultipro source module fetches LoadSearchResults with source-local POST metadata", async () => {
  const source = getSourceModule("ultipro");
  const company = readJson(path.join(__dirname, "ultipro", "fixtures", "company.json"));
  const requests = [];
  const raw = await source.fetchList(company, {
    fetcher: async (url, target) => {
      requests.push({ url, target });
      assert.equal(url, "https://recruiting.ultipro.com/ACME1000/JobBoard/11111111-1111-1111-1111-111111111111/JobBoardView/LoadSearchResults");
      assert.equal(target.method, "POST");
      assert.equal(target.headers.Accept, "application/json");
      assert.equal(target.headers["Content-Type"], "application/json");
      const body = JSON.parse(target.body);
      assert.equal(body.opportunitySearch.Top, 50);
      assert.equal(body.opportunitySearch.Skip, 0);
      assert.equal(body.opportunitySearch.OrderBy[0].PropertyName, "PostedDate");
      return {
        opportunities: [
          {
            Id: "OPP-5001",
            Title: "Onsite Warehouse Supervisor",
            PostedDate: "2026-05-08",
            Locations: [
              {
                Address: {
                  City: "Dallas",
                  State: { Code: "TX" },
                  Country: { Name: "United States" }
                }
              }
            ]
          }
        ],
        totalCount: 1
      };
    }
  });

  assert.equal(requests.length, 1);
  const parsed = source.parse(raw, company);
  assert.equal(parsed.length, 1);
  const normalized = source.normalize(parsed[0], company);
  assert.equal(normalized.source_job_id, "OPP-5001");
  assert.equal(normalized.country, "United States");
  assert.equal(normalized.city, "Dallas");
  assert.equal(normalized.remote_type, "onsite");
  assert.equal(normalized.posting_date, "2026-05-08");
  assert.equal(source.validatePublic(normalized).status, "accepted");
});

test("icims source module follows wrapper iframe and enriches from public detail", async () => {
  const source = getSourceModule("icims");
  const sourceDir = path.join(__dirname, "icims");
  const company = readJson(path.join(sourceDir, "fixtures", "company.json"));
  const fixture = readJson(path.join(sourceDir, "fixtures", "route-detection.json"));
  const responses = new Map([
    [fixture.wrapper_url, fixture.wrapper_html],
    [fixture.iframe_url, fixture.list_html],
    [fixture.detail_url, fixture.detail_html]
  ]);

  const raw = await source.fetchList(company, {
    fetcher: async (url) => {
      assert.ok(responses.has(url), `unexpected iCIMS fixture fetch ${url}`);
      return responses.get(url);
    }
  });
  const parsed = source.parse(raw, company);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].source_evidence?.route_kind, "icims_public_iframe_list");
  assert.equal(parsed[0].source_evidence?.location_source, "json_ld_joblocation");

  const normalized = source.normalize(parsed[0], company);
  assert.equal(normalized.source_job_id, fixture.expected.source_job_id);
  assert.equal(normalized.position_name, fixture.expected.position_name);
  assert.equal(normalized.country, fixture.expected.country);
  assert.equal(normalized.city, fixture.expected.city);
  assert.equal(normalized.remote_type, fixture.expected.remote_type);
  assert.equal(normalized.posting_date, fixture.expected.posting_date);
  const gate = evaluatePublicPosting(normalized, { parserVersion: source.parserVersion });
  assert.equal(gate.status, "accepted");
});

test("taleo source module parses AJAX fallback fixture and rejects unsupported shapes", () => {
  const source = getSourceModule("taleo");
  const sourceDir = path.join(__dirname, "taleo");
  const company = readJson(path.join(sourceDir, "fixtures", "company.json"));
  const ajaxText = readText(path.join(sourceDir, "fixtures", "ajax-list.txt"));
  const unsupported = readJson(path.join(sourceDir, "fixtures", "unsupported-shapes.json"));

  const raw = {
    ajaxText,
    __sourceConfig: {
      baseSectionUrl: "https://fixture.taleo.net/careersection/001",
      lang: "en"
    }
  };
  const parsed = source.parse(raw, company);
  assert.equal(parsed.length, 2);
  const normalized = parsed.map((posting) => source.normalize(posting, company));
  const byId = new Map(normalized.map((posting) => [posting.source_job_id, posting]));

  const remote = byId.get("TALEO-7001");
  assert.equal(remote.country, "Canada");
  assert.equal(remote.remote_type, "remote");
  assert.equal(source.validatePublic(remote).status, "accepted");

  const hybrid = byId.get("TALEO-7002");
  assert.equal(hybrid.country, "United Kingdom");
  assert.equal(hybrid.city, "London");
  assert.equal(hybrid.remote_type, "hybrid");
  assert.equal(source.validatePublic(hybrid).status, "accepted");

  const numericTitle = source.normalize({
    company_name: "Fixture Taleo",
    source_job_id: "7003",
    position_name: "7003",
    job_posting_url: "https://fixture.taleo.net/careersection/001/jobdetail.ftl?job=7003&lang=en",
    location: "Austin, TX, United States"
  }, company);
  assert.ok(numericTitle.source_failure_reasons.includes("unsupported_tenant_shape"));

  for (const item of unsupported.cases) {
    assert.equal(source.parse(item.payload, company).length, item.expected_count, item.name);
  }
});

test("taleo source module fetches bootstrap page and REST results with source-local request metadata", async () => {
  const source = getSourceModule("taleo");
  const company = readJson(path.join(__dirname, "taleo", "fixtures", "company.json"));
  const requests = [];

  const raw = await source.fetchList(company, {
    fetcher: async (url, target) => {
      requests.push({
        url,
        method: target.method,
        headers: target.headers,
        body: target.body
      });
      if (url === "https://fixture.taleo.net/careersection/001/jobsearch.ftl?lang=en") {
        return {
          body: [
            "<html><script>",
            "window.TALEO = 'portal=123456';",
            "sessionCSRFTokenName: 'csrfTokenName';",
            "sessionCSRFToken: 'csrfTokenValue';",
            "</script></html>"
          ].join(""),
          status: 200,
          url
        };
      }
      if (url === "https://fixture.taleo.net/careersection/rest/jobboard/searchjobs?lang=en&portal=123456") {
        const body = JSON.parse(target.body);
        assert.equal(body.pageNo, 1);
        return {
          requisitionList: [{
            jobId: "9001",
            contestNo: "TALEO-9001",
            column: [
              "Remote Taleo Registry Engineer",
              "Remote - United States",
              "Full-time",
              "May 25, 2026"
            ]
          }],
          pagingData: {
            pageSize: 25,
            totalCount: 1
          }
        };
      }
      throw new Error(`unexpected Taleo fixture fetch ${url}`);
    }
  });

  assert.deepEqual(requests.map((request) => [request.url, request.method]), [
    ["https://fixture.taleo.net/careersection/001/jobsearch.ftl?lang=en", "GET"],
    ["https://fixture.taleo.net/careersection/rest/jobboard/searchjobs?lang=en&portal=123456", "POST"]
  ]);
  assert.equal(requests[0].headers.Accept, "text/html,application/xhtml+xml");
  assert.equal(requests[1].headers["Content-Type"], "application/json");
  assert.equal(requests[1].headers.csrfTokenName, "csrfTokenValue");

  const parsed = source.parse(raw, company);
  assert.equal(parsed.length, 1);
  const normalized = source.normalize(parsed[0], company);
  assert.equal(normalized.source_job_id, "TALEO-9001");
  assert.equal(normalized.country, "United States");
  assert.equal(normalized.remote_type, "remote");
  assert.equal(normalized.posting_date, "May 25, 2026");
  assert.equal(source.validatePublic(normalized).status, "accepted");
});
