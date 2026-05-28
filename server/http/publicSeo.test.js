const assert = require("assert");

const { createPublicSeoHelpers } = require("./publicSeo");

function createRequest(overrides = {}) {
  const headers = {
    host: "localhost:8787",
    ...overrides.headers
  };
  return {
    protocol: overrides.protocol || "http",
    query: overrides.query || {},
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

function parseJsonLdById(html, id) {
  const pattern = new RegExp(
    `<script[^>]+id=["']${id}["'][^>]*>([\\s\\S]*?)<\\/script>`,
    "i"
  );
  const match = pattern.exec(html);
  assert.ok(match, `expected JSON-LD script ${id}`);
  return JSON.parse(match[1]);
}

function testRenderSeoIndexHtmlAddsOrganizationAndWebsiteJsonLd() {
  const { renderSeoIndexHtml } = createSeoHelpers({
    publicSiteUrl: "https://openjobslots.com",
    seoDescription: "Find fresh job openings from public employer ATS boards."
  });
  const html = renderSeoIndexHtml(
    "<html><head><title>Old</title><script type=\"application/ld+json\" id=\"openjobslots-website-jsonld\">{\"stale\":true}</script></head><body></body></html>",
    createRequest()
  );

  const organization = parseJsonLdById(html, "openjobslots-organization-jsonld");
  assert.equal(organization["@context"], "https://schema.org");
  assert.equal(organization["@type"], "Organization");
  assert.equal(organization["@id"], "https://openjobslots.com/#organization");
  assert.equal(organization.name, "OpenJobSlots");
  assert.equal(organization.url, "https://openjobslots.com/");
  assert.equal(organization.logo, "https://openjobslots.com/favicon.ico");

  const website = parseJsonLdById(html, "openjobslots-website-jsonld");
  assert.equal(website["@context"], "https://schema.org");
  assert.equal(website["@type"], "WebSite");
  assert.equal(website["@id"], "https://openjobslots.com/#website");
  assert.equal(website.name, "OpenJobSlots");
  assert.equal(website.url, "https://openjobslots.com/");
  assert.equal(website.description, "Find fresh job openings from public employer ATS boards.");
  assert.deepEqual(website.publisher, { "@id": "https://openjobslots.com/#organization" });
  assert.deepEqual(website.potentialAction, {
    "@type": "SearchAction",
    target: "https://openjobslots.com/?q={search_term_string}",
    "query-input": "required name=search_term_string"
  });
  assert.ok(!html.includes("\"stale\":true"));
}

function testSearchQueryPagesGetSpecificMetadataAndCanonical() {
  const { renderSeoIndexHtml } = createSeoHelpers({
    publicSiteUrl: "https://openjobslots.com",
    seoTitle: "OpenJobSlots | Fresh Job Openings",
    seoDescription: "Find fresh job openings from public employer ATS boards."
  });
  const html = renderSeoIndexHtml(
    "<html><head><title>Old</title></head><body></body></html>",
    createRequest({ query: { q: "Frontend Engineer" } })
  );

  assert.ok(html.includes("<title>Frontend Engineer jobs | OpenJobSlots</title>"));
  assert.ok(html.includes('<link rel="canonical" href="https://openjobslots.com/?q=Frontend%20Engineer" />'));
  assert.ok(html.includes("Search fresh Frontend Engineer job slots from public employer ATS boards."));
  assert.ok(html.includes('<meta property="og:url" content="https://openjobslots.com/?q=Frontend%20Engineer" />'));
}

function testRobotsAndSitemapUseConfiguredPublicOrigin() {
  const { buildRobotsTxt, buildSitemapXml } = createSeoHelpers({
    publicSiteUrl: "https://openjobslots.com"
  });
  const req = createRequest();

  assert.ok(buildRobotsTxt(req).includes("Sitemap: https://openjobslots.com/sitemap.xml"));
  assert.ok(buildSitemapXml(req).includes("<loc>https://openjobslots.com/</loc>"));
  assert.ok(buildSitemapXml(req).includes("<loc>https://openjobslots.com/?q=remote%20jobs</loc>"));
}

function testRobotsAndSitemapStayCrawlSafe() {
  const { buildRobotsTxt, buildSitemapXml } = createSeoHelpers({
    publicSiteUrl: "https://openjobslots.com"
  });
  const req = createRequest();
  const robots = buildRobotsTxt(req);
  const sitemap = buildSitemapXml(req);

  assert.match(robots, /^User-agent: \*/m);
  assert.match(robots, /^Allow: \/$/m);
  assert.match(robots, /^Disallow: \/applications$/m);
  assert.match(robots, /^Disallow: \/settings$/m);
  assert.match(robots, /^Disallow: \/ingestion$/m);
  assert.match(robots, /^Disallow: \/postings$/m);
  assert.doesNotMatch(robots, /^Disallow: \/$/m);
  assert.doesNotMatch(robots, /noindex/i);
  assert.match(robots, /^Sitemap: https:\/\/openjobslots\.com\/sitemap\.xml$/m);

  assert.match(sitemap, /<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/);
  assert.match(sitemap, /<loc>https:\/\/openjobslots\.com\/<\/loc>/);
  assert.match(sitemap, /<loc>https:\/\/openjobslots\.com\/\?q=frontend%20engineer<\/loc>/);
  assert.match(sitemap, /<loc>https:\/\/openjobslots\.com\/\?q=greenhouse%20jobs<\/loc>/);
  assert.doesNotMatch(sitemap, /\/postings|\/applications|\/settings|\/ingestion|\/mcp|\/frontend/);
}

function testSitemapIgnoresRequestQueryAndOnlyUsesCuratedPublicSearches() {
  const { buildSitemapXml } = createSeoHelpers({
    publicSiteUrl: "https://openjobslots.com"
  });
  const sitemap = buildSitemapXml(createRequest({ query: { q: "private@example.com" } }));
  const locMatches = sitemap.match(/<loc>/g) || [];

  assert.equal(locMatches.length, 26);
  assert.match(sitemap, /<loc>https:\/\/openjobslots\.com\/<\/loc>/);
  assert.match(sitemap, /<loc>https:\/\/openjobslots\.com\/\?q=product%20manager<\/loc>/);
  assert.doesNotMatch(sitemap, /private@example\.com/);
  assert.doesNotMatch(sitemap, /%40/);
}

testRenderSeoIndexHtmlReplacesMetadata();
testRenderSeoIndexHtmlAddsOrganizationAndWebsiteJsonLd();
testSearchQueryPagesGetSpecificMetadataAndCanonical();
testRobotsAndSitemapUseConfiguredPublicOrigin();
testRobotsAndSitemapStayCrawlSafe();
testSitemapIgnoresRequestQueryAndOnlyUsesCuratedPublicSearches();

console.log("public SEO tests passed");
