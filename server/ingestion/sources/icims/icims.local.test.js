const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const { getSourceModule } = require("../index");
const {
  extractIcimsIframeUrlFromHtml,
  extractIcimsNextPageUrlFromHtml
} = require("./fetchList");

const source = getSourceModule("icims");

function readJson(fileName) {
  return JSON.parse(
    fs.readFileSync(path.join(__dirname, "fixtures", fileName), "utf8")
  );
}

test("icims discover normalizes public portal routes and extracts tenant", () => {
  const company = readJson("company.json");
  const discovered = source.discover({
    ...company,
    url_string: "https://fixtureco.icims.com/jobs/search?ss=9&in_iframe=1"
  });

  assert.equal(discovered.ats_key, "icims");
  assert.equal(discovered.config.tenant, "fixtureco");
  assert.equal(discovered.config.host, "fixtureco.icims.com");
  assert.equal(discovered.config.origin, "https://fixtureco.icims.com");
  assert.equal(discovered.config.searchUrl, "https://fixtureco.icims.com/jobs/search?ss=1");
  assert.equal(discovered.config.routeKind, "icims_public_portal");
});

test("icims fetchList follows iframe source, decodes wrappers, and enriches from detail", async () => {
  const company = readJson("company.json");
  const fixture = readJson("route-detection.json");
  const requests = [];
  const raw = await source.fetchList(company, {
    fetcher: async (url) => {
      requests.push(url);
      if (url === fixture.wrapper_url) return fixture.wrapper_html;
      if (url === fixture.iframe_url) return fixture.list_html;
      if (url === fixture.detail_url) return fixture.detail_html;
      throw new Error(`unexpected fixture iCIMS URL ${url}`);
    }
  });

  assert.equal(requests[0], fixture.wrapper_url);
  assert.equal(requests[1], fixture.iframe_url);
  assert.equal(requests[2], fixture.detail_url);
  assert.equal(raw.__sourceConfig.list_pages_fetched, 1);
  assert.equal(raw.__sourceConfig.detail_fetch_count, 1);
  assert.equal(raw.__sourceConfig.routeKind, "icims_public_portal");

  const parsed = source.parse(raw, company);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].source_evidence?.route_kind, "icims_public_iframe_list");
  assert.equal(parsed[0].source_evidence?.location_source, "json_ld_joblocation");
  assert.equal(parsed[0].source_job_id, "7001");
  assert.equal(parsed[0].remote_type, "onsite");
});

test("icims fetchList follows next-page links only on same host", async () => {
  const company = readJson("company.json");
  const requests = [];
  const originalDetailLimit = process.env.OPENJOBSLOTS_ICIMS_DETAIL_FETCH_LIMIT_PER_COMPANY;
  process.env.OPENJOBSLOTS_ICIMS_DETAIL_FETCH_LIMIT_PER_COMPANY = "0";
  const fixture = {
    wrapper_url: "https://fixtureco.icims.com/jobs/search?ss=1",
    iframe_url: "https://fixtureco.icims.com/jobs/search?ss=1&in_iframe=1",
    page_one_html:
      "<html><body>" +
      "<ul>" +
      "<li class=\"iCIMS_JobCardItem\"><a href=\"/jobs/7001/page-one/job\"><h3>Page One Role</h3></a></li>" +
      "</ul>" +
      "<link rel=\"next\" href=\"https://fixtureco.icims.com/jobs/search?ss=1&page=2\">" +
      "</body></html>",
    page_two_html:
      "<html><body>" +
      "<ul>" +
      "<li class=\"iCIMS_JobCardItem\"><a href=\"/jobs/7002/page-two/job\"><h3>Page Two Role</h3></a></li>" +
      "</ul>" +
      "</body></html>",
    wrapper_html:
      "<html><body><iframe id=\"icims_content_iframe\" src=\"/jobs/search?ss=1\"></iframe></body></html>"
  };

  let raw;
  try {
    raw = await source.fetchList(company, {
      fetcher: async (url) => {
        requests.push(url);
        if (url === fixture.wrapper_url) return fixture.wrapper_html;
        if (url === fixture.iframe_url) return fixture.page_one_html;
        if (url === "https://fixtureco.icims.com/jobs/search?ss=1&page=2&in_iframe=1") return fixture.page_two_html;
        throw new Error(`unexpected iCIMS pagination URL ${url}`);
      }
    });
  } finally {
    process.env.OPENJOBSLOTS_ICIMS_DETAIL_FETCH_LIMIT_PER_COMPANY = originalDetailLimit;
  }
  assert.equal(raw.__sourceConfig.list_pages_fetched, 2);
  const parsed = source.parse(raw, company);

  assert.equal(requests[1], fixture.iframe_url);
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].source_job_id, "7001");
  assert.equal(parsed[1].source_job_id, "7002");
  assert.equal(raw.__sourceConfig.detail_fetch_count, 0);
  assert.equal(requests[0], fixture.wrapper_url);
  assert.equal(requests[1], fixture.iframe_url);
});

test("icims fetchList rejects unexpected host redirects", async () => {
  const company = readJson("company.json");
  await assert.rejects(
    async () => source.fetchList(company, {
      fetcher: async () => ({
        status: 200,
        url: "https://malicious.example.com/jobs/search",
        text: "<html><iframe id=\"icims_content_iframe\" src=\"/jobs/search\"></iframe></html>"
      })
    }),
    (error) => error?.ingestionErrorType === "unexpected_redirect_host"
  );
});

test("icims fetchList throws portal_search_empty when no parseable postings remain", async () => {
  const company = readJson("company.json");
  const wrapperUrl = "https://fixtureco.icims.com/jobs/search?ss=1";
  const iframeUrl = "https://fixtureco.icims.com/jobs/search?ss=1&in_iframe=1";
  await assert.rejects(
    async () => source.fetchList(company, {
      fetcher: (url) => {
        if (url === wrapperUrl) {
          return `<html><body><iframe id=\"icims_content_iframe\" src=\"/jobs/search?ss=1\"></iframe></body></html>`;
        }
        if (url === iframeUrl) {
          return "<html><body><p>no jobs</p><a href=\"/jobs/intro\">intro</a></body></html>";
        }
        throw new Error(`unexpected iCIMS empty-search URL ${url}`);
      }
    }),
    (error) => error?.ingestionErrorType === "portal_search_empty"
  );
});

test("icims detail fetches only missing fields and tracks fetch count", async () => {
  const company = readJson("company.json");
  const listUrl = "https://fixtureco.icims.com/jobs/search?ss=1";
  const iframeUrl = "https://fixtureco.icims.com/jobs/search?ss=1&in_iframe=1";
  const detailTargetUrl = "https://fixtureco.icims.com/jobs/7009/detail-only/job?in_iframe=1";
  const listHtml =
    "<html><body>" +
    "<li class=\"iCIMS_JobCardItem\"><a href=\"/jobs/7009/detail-only/job\"><h3>Detail-only Role</h3></a></li>" +
    "</body></html>";
  const detailHtml =
    "<html><body>" +
    "<script type=\"application/ld+json\">" +
    JSON.stringify({
      "@context": "http://schema.org",
      "@type": "JobPosting",
      title: "Detail-only Role",
      datePosted: "2026-05-10",
      jobLocationType: "ONSITE",
      jobLocation: {
        "@type": "Place",
        address: {
          "@type": "PostalAddress",
          addressLocality: "Austin",
          addressRegion: "TX",
          addressCountry: "US"
        }
      }
    }) +
    "</script></body></html>";

  const raw = await source.fetchList(company, {
    fetcher: async (url) => {
      if (url === listUrl) {
        return `<html><body><iframe id=\"icims_content_iframe\" src=\"/jobs/search?ss=1\"></iframe></body></html>`;
      }
      if (url === iframeUrl) {
        return listHtml;
      }
      if (url === detailTargetUrl) {
        return detailHtml;
      }
      throw new Error(`unexpected iCIMS detail URL ${url}`);
    }
  });

  assert.equal(raw.__sourceConfig.detail_fetch_count, 1);
  const parsed = source.parse(raw, company);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].location, "Austin, TX, United States");
  assert.equal(parsed[0].remote_type, "onsite");
  assert.equal(parsed[0].posting_date, "2026-05-10");
});

test("icims parse preserves __legacyParsed payloads", () => {
  const legacy = [{
    source_job_id: "legacy-1",
    source_evidence: { route_kind: "legacy" }
  }];
  const parsed = source.parse({ __legacyParsed: legacy }, { company_name: "Legacy Co" });
  assert.deepEqual(parsed, legacy);
});

test("icims helper extracts same-host next page links", () => {
  const currentUrl = "https://fixtureco.icims.com/jobs/search?ss=1&in_iframe=1";
  const pageHtml = "<html><a href=\"/jobs/search?ss=1&page=2\">Next</a></html>";
  const nextUrl = extractIcimsNextPageUrlFromHtml(pageHtml, currentUrl, "fixtureco.icims.com");
  assert.equal(nextUrl, "https://fixtureco.icims.com/jobs/search?ss=1&page=2&in_iframe=1");
});

test("icims helper normalizes iframe urls, decodes wrappers, and resolves protocol-relative links", () => {
  const html = "<script>icimsFrame.src='\\/jobs/search?ss=2&amp;q=remote'</script>";
  const fromEscaped = extractIcimsIframeUrlFromHtml(html, "https://fixtureco.icims.com/jobs/search");
  assert.equal(fromEscaped, "https://fixtureco.icims.com/jobs/search?ss=2&q=remote&in_iframe=1");

  const protocolRelative = "<iframe id=\"icims_content_iframe\" src=\"//fixtureco.icims.com/jobs/search?ss=1\"></iframe>";
  const fromProtocolRelative = extractIcimsIframeUrlFromHtml(protocolRelative, "https://tenant.icims.com/jobs");
  assert.equal(fromProtocolRelative, "https://fixtureco.icims.com/jobs/search?ss=1&in_iframe=1");
});
