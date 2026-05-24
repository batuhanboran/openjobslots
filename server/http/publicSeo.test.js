const assert = require("assert");

const { createPublicSeoHelpers } = require("./publicSeo");

function createRequest(overrides = {}) {
  const headers = {
    host: "localhost:8787",
    ...overrides.headers
  };
  return {
    protocol: overrides.protocol || "http",
    get(name) {
      return headers[String(name || "").toLowerCase()] || "";
    }
  };
}

function createSeoHelpers(overrides = {}) {
  return createPublicSeoHelpers({
    buildPublicWebAnalyticsHeadTags: () => "<script>analytics()</script>",
    nodeEnv: "development",
    port: 8787,
    publicSiteUrl: "",
    readPublicWebAnalyticsConfig: () => ({ enabled: true }),
    seoDescription: "Fresh job openings",
    seoTitle: "OpenJobSlots",
    stripPublicWebAnalyticsHeadTags: (html) => String(html).replace(/<!-- old analytics -->/g, ""),
    ...overrides
  });
}

function testRenderSeoIndexHtmlReplacesMetadata() {
  const { renderSeoIndexHtml } = createSeoHelpers();
  const html = renderSeoIndexHtml(
    "<html><head><title>Old</title><meta name=\"description\" content=\"old\" /><!-- old analytics --></head><body></body></html>",
    createRequest()
  );

  assert.ok(html.includes("<title>OpenJobSlots</title>"));
  assert.ok(html.includes('<meta name="description" content="Fresh job openings" />'));
  assert.ok(html.includes('<link rel="canonical" href="http://localhost:8787/" />'));
  assert.ok(html.includes("<script>analytics()</script>"));
  assert.ok(!html.includes("content=\"old\""));
  assert.ok(!html.includes("old analytics"));
}

function testRobotsAndSitemapUseConfiguredPublicOrigin() {
  const { buildRobotsTxt, buildSitemapXml } = createSeoHelpers({
    publicSiteUrl: "https://openjobslots.com"
  });
  const req = createRequest();

  assert.ok(buildRobotsTxt(req).includes("Sitemap: https://openjobslots.com/sitemap.xml"));
  assert.ok(buildSitemapXml(req).includes("<loc>https://openjobslots.com/</loc>"));
}

testRenderSeoIndexHtmlReplacesMetadata();
testRobotsAndSitemapUseConfiguredPublicOrigin();

console.log("public SEO tests passed");
