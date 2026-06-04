const assert = require("assert");

const { createPublicSeoHelpers } = require("./publicSeo");
const { PUBLIC_SEO_ROUTES } = require("../../src/publicSeoRoutes");

function createRequest(overrides = {}) {
  const headers = {
    host: "localhost:8787",
    ...overrides.headers
  };
  return {
    protocol: overrides.protocol || "http",
    path: overrides.path || "/",
    originalUrl: overrides.originalUrl || overrides.path || "/",
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

function extractNoscriptText(html) {
  const match = /<noscript>([\s\S]*?)<\/noscript>/i.exec(String(html || ""));
  assert.ok(match, "expected static SEO fallback noscript content");
  return match[1]
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function extractStaticSeoContentText(html) {
  const match = /<main[^>]+id=["']openjobslots-static-seo-content["'][^>]*>([\s\S]*?)<\/main>/i.exec(String(html || ""));
  assert.ok(match, "expected crawlable static SEO content");
  return match[1]
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function extractStaticSeoContentHtml(html) {
  const match = /<main[^>]+id=["']openjobslots-static-seo-content["'][^>]*>([\s\S]*?)<\/main>/i.exec(String(html || ""));
  assert.ok(match, "expected crawlable static SEO content");
  return match[1];
}

function extractSitemapUrlEntry(sitemapXml, loc) {
  return (String(sitemapXml || "").match(/<url>[\s\S]*?<\/url>/g) || [])
    .find((entry) => entry.includes(`<loc>${loc}</loc>`)) || "";
}

function countWords(value) {
  const text = String(value || "");
  const cjkCharacters = (text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu) || []).length;
  const words = (
    text
      .replace(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu, " ")
      .match(/[\p{L}\p{N}]+(?:[-'][\p{L}\p{N}]+)?/gu) || []
  ).length;
  return words + Math.ceil(cjkCharacters / 2);
}

function countConservativeCrawlerWords(value) {
  return (String(value || "").match(/[\p{L}\p{N}]+(?:[-'][\p{L}\p{N}]+)?/gu) || []).length;
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

  const webpage = parseJsonLdById(html, "openjobslots-webpage-jsonld");
  assert.equal(webpage["@context"], "https://schema.org");
  assert.equal(webpage["@type"], "WebPage");
  assert.equal(webpage["@id"], "https://openjobslots.com/#webpage");
  assert.equal(webpage.url, "https://openjobslots.com/");
  assert.equal(webpage.isPartOf["@id"], "https://openjobslots.com/#website");

  const breadcrumb = parseJsonLdById(html, "openjobslots-breadcrumb-jsonld");
  assert.equal(breadcrumb["@type"], "BreadcrumbList");
  assert.equal(breadcrumb.itemListElement.length, 1);
}

function testRenderSeoIndexHtmlAddsStaticNoscriptSeoFallback() {
  const { renderSeoIndexHtml } = createSeoHelpers({
    publicSiteUrl: "https://openjobslots.com",
    seoTitle: "OpenJobSlots | Fresh Job Openings",
    seoDescription: "Find fresh job openings from public employer ATS boards."
  });
  const html = renderSeoIndexHtml(
    "<html><head><title>Old</title></head><body><noscript>You need to enable JavaScript to run this app.</noscript><div id=\"root\"></div></body></html>",
    createRequest()
  );

  assert.ok(html.includes("<noscript>"));
  assert.ok(html.includes("<h1>OpenJobSlots</h1>"));
  assert.ok(html.includes("Find fresh job openings from public employer ATS boards."));
  assert.ok(html.includes('href="https://openjobslots.com/en/job-openings"'));
  assert.ok(html.includes('href="https://openjobslots.com/ats/greenhouse-jobs"'));
  assert.ok(html.includes('href="https://openjobslots.com/ats/workday-jobs"'));
  assert.ok(html.includes('href="https://openjobslots.com/ats/bamboohr-jobs"'));
  assert.ok(countWords(extractNoscriptText(html)) >= 200);
  assert.ok(!html.includes("You need to enable JavaScript"));
}

function testRenderSeoIndexHtmlAddsCrawlerVisibleSemanticContent() {
  const { renderSeoIndexHtml } = createSeoHelpers({
    publicSiteUrl: "https://openjobslots.com",
    seoTitle: "OpenJobSlots | Fresh Job Openings",
    seoDescription: "Find fresh job openings from public employer ATS boards."
  });
  const html = renderSeoIndexHtml(
    "<html><head><title>Old</title></head><body><div id=\"root\"></div></body></html>",
    createRequest({ path: "/en/software-engineer-jobs" })
  );

  assert.ok(html.includes('id="openjobslots-static-seo-style"'));
  assert.ok(html.includes('id="openjobslots-static-seo-content"'));
  assert.ok(html.includes("<section"));
  assert.ok(html.includes("<article"));
  assert.ok(html.includes("<aside"));
  assert.ok(html.includes("<footer"));
  assert.ok(html.includes("<dl>"));
  assert.ok(html.includes("Search FAQ"));
  assert.ok(html.includes("Where do the listings come from?"));
  assert.ok(html.includes("<nav>"));
  assert.ok(html.includes('href="https://openjobslots.com/ats/workday-jobs"'));
  assert.ok(html.includes('href="https://openjobslots.com/ats/bamboohr-jobs"'));
  assert.ok(!html.includes('rel="nofollow"'));
  assert.ok(countWords(extractStaticSeoContentText(html)) >= 200);
}

function testRouteSpecificContentPagesExplainDirectEmployerSearch() {
  const { renderSeoIndexHtml } = createSeoHelpers({
    publicSiteUrl: "https://openjobslots.com",
    seoTitle: "OpenJobSlots | Fresh Job Openings",
    seoDescription: "Find fresh job openings from public employer ATS boards."
  });
  const html = renderSeoIndexHtml(
    "<html><head><title>Old</title></head><body><div id=\"root\"></div></body></html>",
    createRequest({ path: "/en/jobs-not-on-linkedin" })
  );
  const staticText = extractStaticSeoContentText(html);
  const fallbackText = extractNoscriptText(html);

  assert.ok(html.includes("<title>Jobs not on LinkedIn | OpenJobSlots</title>"));
  assert.ok(html.includes('href="https://openjobslots.com/en/ats-job-boards"'));
  assert.ok(html.includes('href="https://openjobslots.com/en/direct-apply-jobs"'));
  assert.ok(html.includes('href="https://openjobslots.com/en/hidden-jobs"'));
  assert.ok(staticText.includes("OpenJobSlots should not promise that a posting is absent from LinkedIn"));
  assert.ok(staticText.includes("source-first discovery"));
  assert.ok(staticText.includes("Can OpenJobSlots prove a job is not on LinkedIn?"));
  assert.ok(fallbackText.includes("public employer career pages and ATS boards directly"));
  assert.ok(!staticText.includes("private, leaked, or internal roles"));
  assert.ok(countWords(staticText) >= 260);
}

function testAtsPagesExposeSourceSpecificCopyWithoutPartnershipClaims() {
  const { renderSeoIndexHtml } = createSeoHelpers({
    publicSiteUrl: "https://openjobslots.com",
    seoTitle: "OpenJobSlots | Fresh Job Openings",
    seoDescription: "Find fresh job openings from public employer ATS boards."
  });
  const html = renderSeoIndexHtml(
    "<html><head><title>Old</title></head><body><div id=\"root\"></div></body></html>",
    createRequest({ path: "/ats/lever-jobs" })
  );
  const staticText = extractStaticSeoContentText(html);

  assert.ok(staticText.includes("jobs.lever.co"));
  assert.ok(staticText.includes("independent search entry"));
  assert.ok(staticText.includes("No. OpenJobSlots only uses public employer postings"));
  assert.ok(!staticText.includes("official partner"));
  assert.ok(countWords(staticText) >= 260);
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
  assert.ok(html.includes('<meta name="robots" content="noindex, follow" />'));
  assert.ok(html.includes("Search fresh Frontend Engineer jobs from public employer ATS boards."));
  assert.ok(html.includes('<meta property="og:url" content="https://openjobslots.com/?q=Frontend%20Engineer" />'));
  assert.doesNotMatch(html, /<link rel="alternate"/i);

  const webpage = parseJsonLdById(html, "openjobslots-webpage-jsonld");
  assert.equal(webpage["@type"], "WebPage");
}

function testCuratedPathSearchQueryPagesStayOutOfHreflangClusters() {
  const { renderSeoIndexHtml } = createSeoHelpers({
    publicSiteUrl: "https://openjobslots.com",
    seoTitle: "OpenJobSlots | Fresh Job Openings",
    seoDescription: "Find fresh job openings from public employer ATS boards."
  });
  const html = renderSeoIndexHtml(
    "<html><head><title>Old</title></head><body></body></html>",
    createRequest({ path: "/en", originalUrl: "/en?q=technical%20support%20US", query: { q: "technical support US" } })
  );

  assert.ok(html.includes('<link rel="canonical" href="https://openjobslots.com/en" />'));
  assert.ok(html.includes("<title>Technical Support US jobs in English | OpenJobSlots</title>"));
  assert.ok(html.includes("Search fresh Technical Support US jobs in English from public employer ATS boards."));
  assert.ok(html.includes('<meta name="robots" content="noindex, follow" />'));
  assert.doesNotMatch(html, /<link rel="alternate"/i);

  const webpage = parseJsonLdById(html, "openjobslots-webpage-jsonld");
  assert.equal(webpage["@type"], "WebPage");
}

function testLocalizedSeoLandingPagesGetLanguageSpecificMetadataAndAlternates() {
  const { renderSeoIndexHtml } = createSeoHelpers({
    publicSiteUrl: "https://openjobslots.com",
    seoTitle: "OpenJobSlots | Fresh Job Openings",
    seoDescription: "Find fresh job openings from public employer ATS boards."
  });
  const html = renderSeoIndexHtml(
    "<html lang=\"en\"><head><title>Old</title><link rel=\"alternate\" hreflang=\"en\" href=\"https://old.example/en\" /></head><body></body></html>",
    createRequest({ path: "/tr/uzaktan-calisma-ilanlari" })
  );

  assert.ok(html.includes("<html lang=\"tr\">"));
  assert.ok(html.includes("<title>Uzaktan çalışma ilanları | OpenJobSlots</title>"));
  assert.ok(html.includes("Türkiye ve global pazarlardaki güncel uzaktan çalışma ilanlarını ara."));
  assert.ok(html.includes('<link rel="canonical" href="https://openjobslots.com/tr/uzaktan-calisma-ilanlari" />'));
  assert.ok(html.includes('<link rel="alternate" hreflang="tr" href="https://openjobslots.com/tr/uzaktan-calisma-ilanlari" />'));
  assert.ok(html.includes('<link rel="alternate" hreflang="en" href="https://openjobslots.com/en/remote-job-openings" />'));
  assert.ok(html.includes('<link rel="alternate" hreflang="x-default" href="https://openjobslots.com/en/remote-job-openings" />'));
  assert.ok(!html.includes("https://old.example/en"));

  const website = parseJsonLdById(html, "openjobslots-website-jsonld");
  assert.equal(website.inLanguage, "tr");
  const fallbackText = extractNoscriptText(html);
  assert.ok(countWords(fallbackText) >= 200);
  assert.ok(fallbackText.includes("crawler"));
  assert.ok(!fallbackText.includes("OpenJobSlots indexes fresh public employer ATS job openings"));
}

function testHomeLanguagePagesGetBidirectionalHreflang() {
  const { renderSeoIndexHtml } = createSeoHelpers({
    publicSiteUrl: "https://openjobslots.com"
  });
  const html = renderSeoIndexHtml(
    "<html><head><title>Old</title></head><body></body></html>",
    createRequest({ path: "/de" })
  );

  assert.ok(html.includes("<html lang=\"de\">"));
  assert.ok(html.includes('<link rel="canonical" href="https://openjobslots.com/de" />'));
  assert.ok(html.includes('<link rel="alternate" hreflang="x-default" href="https://openjobslots.com/" />'));
  assert.ok(html.includes('<link rel="alternate" hreflang="en" href="https://openjobslots.com/en" />'));
  assert.ok(html.includes('<link rel="alternate" hreflang="tr" href="https://openjobslots.com/tr" />'));
  assert.ok(html.includes('<link rel="alternate" hreflang="de" href="https://openjobslots.com/de" />'));
  assert.ok(html.includes('<link rel="alternate" hreflang="fr" href="https://openjobslots.com/fr" />'));
  assert.ok(html.includes('<link rel="alternate" hreflang="es" href="https://openjobslots.com/es" />'));
}

function testAdditionalLanguagePagesSkipHreflangUntilContentIsReliable() {
  const { buildSitemapSectionXml, renderSeoIndexHtml } = createSeoHelpers({
    publicSiteUrl: "https://openjobslots.com",
    seoTitle: "OpenJobSlots | Fresh Job Openings",
    seoDescription: "Find fresh job openings from public employer ATS boards."
  });
  const html = renderSeoIndexHtml(
    "<html><head><title>Old</title></head><body></body></html>",
    createRequest({ path: "/pl/data-analyst-jobs" })
  );
  const staticSitemap = buildSitemapSectionXml(createRequest(), "/sitemaps/static.xml");
  const plEntry = extractSitemapUrlEntry(staticSitemap, "https://openjobslots.com/pl/data-analyst-jobs");
  const enEntry = extractSitemapUrlEntry(staticSitemap, "https://openjobslots.com/en/data-analyst-jobs");

  assert.ok(plEntry, "expected Polish route to remain in the sitemap");
  assert.ok(enEntry, "expected English route to remain in the sitemap");
  assert.doesNotMatch(html, /<link rel="alternate"/i);
  assert.doesNotMatch(plEntry, /xhtml:link/i);
  assert.match(enEntry, /hreflang="en"/);
  assert.match(enEntry, /hreflang="tr"/);
  assert.match(enEntry, /hreflang="de"/);
  assert.match(enEntry, /hreflang="fr"/);
  assert.match(enEntry, /hreflang="es"/);
}

function testLocalizedStaticFallbackLinksStayWithinLanguageCluster() {
  const { renderSeoIndexHtml } = createSeoHelpers({
    publicSiteUrl: "https://openjobslots.com",
    seoTitle: "OpenJobSlots | Fresh Job Openings",
    seoDescription: "Find fresh job openings from public employer ATS boards."
  });
  const html = renderSeoIndexHtml(
    "<html><head><title>Old</title></head><body><div id=\"root\"></div></body></html>",
    createRequest({ path: "/pl/data-analyst-jobs" })
  );
  const staticHtml = extractStaticSeoContentHtml(html);
  const staticText = extractStaticSeoContentText(html);

  assert.match(staticHtml, /href="https:\/\/openjobslots\.com\/pl\/devops-engineer-jobs"/);
  assert.doesNotMatch(staticHtml, /href="https:\/\/openjobslots\.com\/ats\//);
  assert.doesNotMatch(staticHtml, /href="https:\/\/openjobslots\.com\/en\//);
  assert.doesNotMatch(staticHtml, /ATS source job pages/);
  assert.match(staticHtml, /<footer/);
  assert.ok(countWords(staticText) >= 200);
}

function testRobotsAndSitemapUseConfiguredPublicOrigin() {
  const { buildRobotsTxt, buildSitemapSectionXml, buildSitemapXml } = createSeoHelpers({
    publicSiteUrl: "https://openjobslots.com"
  });
  const req = createRequest();
  const sitemapIndex = buildSitemapXml(req);
  const staticSitemap = buildSitemapSectionXml(req, "/sitemaps/static.xml");
  const atsSitemap = buildSitemapSectionXml(req, "/sitemaps/ats-sources.xml");

  assert.ok(buildRobotsTxt(req).includes("Sitemap: https://openjobslots.com/sitemap.xml"));
  assert.ok(sitemapIndex.includes("<loc>https://openjobslots.com/sitemaps/static.xml</loc>"));
  assert.ok(sitemapIndex.includes("<loc>https://openjobslots.com/sitemaps/ats-sources.xml</loc>"));
  assert.ok(staticSitemap.includes("<loc>https://openjobslots.com/</loc>"));
  assert.ok(staticSitemap.includes("<loc>https://openjobslots.com/tr/is-ilanlari</loc>"));
  assert.ok(staticSitemap.includes("<loc>https://openjobslots.com/en/remote-job-openings</loc>"));
  assert.ok(atsSitemap.includes("<loc>https://openjobslots.com/ats/greenhouse-jobs</loc>"));
  assert.ok(atsSitemap.includes("<loc>https://openjobslots.com/ats/icims-jobs</loc>"));
}

function testRobotsAndSitemapStayCrawlSafe() {
  const { buildRobotsTxt, buildSitemapSectionXml, buildSitemapXml } = createSeoHelpers({
    publicSiteUrl: "https://openjobslots.com"
  });
  const req = createRequest();
  const robots = buildRobotsTxt(req);
  const sitemapIndex = buildSitemapXml(req);
  const staticSitemap = buildSitemapSectionXml(req, "/sitemaps/static.xml");
  const atsSitemap = buildSitemapSectionXml(req, "/sitemaps/ats-sources.xml");
  const combinedSitemaps = [sitemapIndex, staticSitemap, atsSitemap].join("\n");

  assert.match(robots, /^User-agent: \*/m);
  assert.match(robots, /^Allow: \/$/m);
  assert.match(robots, /^Disallow: \/applications$/m);
  assert.match(robots, /^Disallow: \/settings$/m);
  assert.match(robots, /^Disallow: \/ingestion$/m);
  assert.match(robots, /^Disallow: \/postings$/m);
  assert.doesNotMatch(robots, /^Disallow: \/$/m);
  assert.doesNotMatch(robots, /noindex/i);
  assert.doesNotMatch(robots, /Content-Signal/i);
  assert.match(robots, /^Sitemap: https:\/\/openjobslots\.com\/sitemap\.xml$/m);

  assert.match(sitemapIndex, /<sitemapindex xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/);
  assert.match(sitemapIndex, /<loc>https:\/\/openjobslots\.com\/sitemaps\/static\.xml<\/loc>/);
  assert.match(sitemapIndex, /<loc>https:\/\/openjobslots\.com\/sitemaps\/ats-sources\.xml<\/loc>/);
  assert.match(staticSitemap, /<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9" xmlns:xhtml="http:\/\/www\.w3\.org\/1999\/xhtml">/);
  assert.match(staticSitemap, /<loc>https:\/\/openjobslots\.com\/<\/loc>/);
  assert.match(staticSitemap, /<loc>https:\/\/openjobslots\.com\/tr\/yazilim-muhendisi-is-ilanlari<\/loc>/);
  assert.match(staticSitemap, /xmlns:xhtml="http:\/\/www\.w3\.org\/1999\/xhtml"/);
  assert.match(staticSitemap, /<xhtml:link rel="alternate" hreflang="tr" href="https:\/\/openjobslots\.com\/tr\/uzaktan-calisma-ilanlari" \/>/);
  assert.match(staticSitemap, /<xhtml:link rel="alternate" hreflang="x-default" href="https:\/\/openjobslots\.com\/en\/remote-job-openings" \/>/);
  assert.match(atsSitemap, /<loc>https:\/\/openjobslots\.com\/ats\/greenhouse-jobs<\/loc>/);
  assert.match(atsSitemap, /<loc>https:\/\/openjobslots\.com\/ats\/icims-jobs<\/loc>/);
  assert.doesNotMatch(staticSitemap, /\/ats\//);
  assert.doesNotMatch(atsSitemap, /<loc>https:\/\/openjobslots\.com\/en\//);
  assert.doesNotMatch(combinedSitemaps, /\/postings|\/applications|\/settings|\/ingestion|\/mcp|\/frontend/);
  assert.doesNotMatch(combinedSitemaps, /\?q=/);
}

function testRootFallbackLinksEveryCuratedSitemapRoute() {
  const { renderSeoIndexHtml } = createSeoHelpers({
    publicSiteUrl: "https://openjobslots.com",
    seoTitle: "OpenJobSlots | Fresh Job Openings",
    seoDescription: "Find fresh job openings from public employer ATS boards."
  });
  const html = renderSeoIndexHtml(
    "<html><head><title>Old</title></head><body></body></html>",
    createRequest()
  );

  for (const route of PUBLIC_SEO_ROUTES) {
    assert.ok(
      html.includes(`href="https://openjobslots.com${route.path}"`),
      `expected root fallback to link ${route.path}`
    );
  }
}

function testAllCuratedSeoFallbacksClearLowWordCountThreshold() {
  const { renderSeoIndexHtml } = createSeoHelpers({
    publicSiteUrl: "https://openjobslots.com",
    seoTitle: "OpenJobSlots | Fresh Job Openings",
    seoDescription: "Find fresh job openings from public employer ATS boards."
  });
  const indexHtml = "<html><head><title>Old</title></head><body></body></html>";
  const routes = [{ path: "/" }, ...PUBLIC_SEO_ROUTES];

  for (const route of routes) {
    const html = renderSeoIndexHtml(indexHtml, createRequest({ path: route.path }));
    const wordCount = countWords(extractNoscriptText(html));
    assert.ok(wordCount >= 200, `expected ${route.path} fallback word count >= 200, got ${wordCount}`);
  }
}

function testAllCuratedSeoPagesExposeCrawlerVisibleWordCount() {
  const { renderSeoIndexHtml } = createSeoHelpers({
    publicSiteUrl: "https://openjobslots.com",
    seoTitle: "OpenJobSlots | Fresh Job Openings",
    seoDescription: "Find fresh job openings from public employer ATS boards."
  });
  const indexHtml = "<html><head><title>Old</title></head><body><div id=\"root\"></div></body></html>";
  const routes = [{ path: "/" }, ...PUBLIC_SEO_ROUTES];

  for (const route of routes) {
    const html = renderSeoIndexHtml(indexHtml, createRequest({ path: route.path }));
    const wordCount = countWords(extractStaticSeoContentText(html));
    assert.ok(wordCount >= 200, `expected ${route.path} static SEO word count >= 200, got ${wordCount}`);
  }
}

function testCjkSeoPagesKeepConservativeCrawlerWordBuffer() {
  const { renderSeoIndexHtml } = createSeoHelpers({
    publicSiteUrl: "https://openjobslots.com",
    seoTitle: "OpenJobSlots | Fresh Job Openings",
    seoDescription: "Find fresh job openings from public employer ATS boards."
  });
  const indexHtml = "<html><head><title>Old</title></head><body><div id=\"root\"></div></body></html>";
  const routes = PUBLIC_SEO_ROUTES.filter((route) => ["ja", "ko", "zh-CN"].includes(route.languageCode));

  for (const route of routes) {
    const html = renderSeoIndexHtml(indexHtml, createRequest({ path: route.path }));
    const wordCount = countConservativeCrawlerWords(extractStaticSeoContentText(html));
    assert.ok(wordCount >= 220, `expected ${route.path} conservative crawler word count >= 220, got ${wordCount}`);
  }
}

function testSeoLandingPagesExposeCollectionAndBreadcrumbStructuredData() {
  const { renderSeoIndexHtml } = createSeoHelpers({
    publicSiteUrl: "https://openjobslots.com"
  });
  const html = renderSeoIndexHtml(
    "<html><head><title>Old</title></head><body></body></html>",
    createRequest({ path: "/ats/workday-jobs" })
  );

  const webpage = parseJsonLdById(html, "openjobslots-webpage-jsonld");
  assert.equal(webpage["@type"], "CollectionPage");
  assert.equal(webpage["@id"], "https://openjobslots.com/ats/workday-jobs#webpage");
  assert.equal(webpage.url, "https://openjobslots.com/ats/workday-jobs");
  assert.equal(webpage.name, "Workday jobs");
  assert.deepEqual(webpage.breadcrumb, {
    "@id": "https://openjobslots.com/ats/workday-jobs#breadcrumb"
  });

  const breadcrumb = parseJsonLdById(html, "openjobslots-breadcrumb-jsonld");
  assert.equal(breadcrumb.itemListElement.length, 2);
  assert.equal(breadcrumb.itemListElement[1].name, "Workday jobs");
  assert.equal(breadcrumb.itemListElement[1].item, "https://openjobslots.com/ats/workday-jobs");
}

function testSitemapIgnoresRequestQueryAndOnlyUsesCuratedPublicLandingPages() {
  const { buildSitemapSectionXml, buildSitemapXml } = createSeoHelpers({
    publicSiteUrl: "https://openjobslots.com"
  });
  const req = createRequest({ query: { q: "private@example.com" } });
  const sitemapIndex = buildSitemapXml(req);
  const staticSitemap = buildSitemapSectionXml(req, "/sitemaps/static.xml");
  const atsSitemap = buildSitemapSectionXml(req, "/sitemaps/ats-sources.xml");
  const combinedSitemaps = [sitemapIndex, staticSitemap, atsSitemap].join("\n");
  const locMatches = (staticSitemap.match(/<loc>/g) || []).length + (atsSitemap.match(/<loc>/g) || []).length;

  assert.equal(locMatches, PUBLIC_SEO_ROUTES.length + 1);
  assert.match(staticSitemap, /<loc>https:\/\/openjobslots\.com\/<\/loc>/);
  assert.match(staticSitemap, /<loc>https:\/\/openjobslots\.com\/en\/product-manager-jobs<\/loc>/);
  assert.match(staticSitemap, /<loc>https:\/\/openjobslots\.com\/en\/data-analyst-jobs<\/loc>/);
  assert.match(staticSitemap, /<loc>https:\/\/openjobslots\.com\/en\/customer-success-manager-jobs<\/loc>/);
  assert.match(staticSitemap, /<loc>https:\/\/openjobslots\.com\/en\/devops-engineer-jobs<\/loc>/);
  assert.match(staticSitemap, /<loc>https:\/\/openjobslots\.com\/en\/ats-job-boards<\/loc>/);
  assert.match(staticSitemap, /<loc>https:\/\/openjobslots\.com\/en\/direct-apply-jobs<\/loc>/);
  assert.match(staticSitemap, /<loc>https:\/\/openjobslots\.com\/en\/hidden-jobs<\/loc>/);
  assert.match(staticSitemap, /<loc>https:\/\/openjobslots\.com\/en\/jobs-not-on-linkedin<\/loc>/);
  assert.match(atsSitemap, /<loc>https:\/\/openjobslots\.com\/ats\/breezy-jobs<\/loc>/);
  assert.match(atsSitemap, /<loc>https:\/\/openjobslots\.com\/ats\/paylocity-jobs<\/loc>/);
  assert.doesNotMatch(combinedSitemaps, /private@example\.com/);
  assert.doesNotMatch(combinedSitemaps, /%40/);
}

function testBuildLlmsTxtUsesPlainMarkdownFormat() {
  const { buildLlmsTxt } = createSeoHelpers({
    publicSiteUrl: "https://openjobslots.com",
    seoDescription: "Find fresh job openings from public employer ATS boards."
  });
  const llms = buildLlmsTxt(createRequest());

  assert.match(llms, /^# OpenJobSlots$/m);
  assert.match(llms, /^> Find fresh job openings from public employer ATS boards\.$/m);
  assert.match(llms, /^## Core pages$/m);
  assert.match(llms, /^## Source-first content pages$/m);
  assert.match(llms, /^- \[Search open job slots\]\(https:\/\/openjobslots\.com\/en\):/m);
  assert.match(llms, /^- \[Direct apply jobs\]\(https:\/\/openjobslots\.com\/en\/direct-apply-jobs\):/m);
  assert.match(llms, /^- \[Greenhouse jobs\]\(https:\/\/openjobslots\.com\/ats\/greenhouse-jobs\):/m);
  assert.doesNotMatch(llms, /<html|<script|<meta|<\/a>/i);
}

testRenderSeoIndexHtmlReplacesMetadata();
testRenderSeoIndexHtmlAddsOrganizationAndWebsiteJsonLd();
testRenderSeoIndexHtmlAddsStaticNoscriptSeoFallback();
testRenderSeoIndexHtmlAddsCrawlerVisibleSemanticContent();
testRouteSpecificContentPagesExplainDirectEmployerSearch();
testAtsPagesExposeSourceSpecificCopyWithoutPartnershipClaims();
testSearchQueryPagesGetSpecificMetadataAndCanonical();
testCuratedPathSearchQueryPagesStayOutOfHreflangClusters();
testLocalizedSeoLandingPagesGetLanguageSpecificMetadataAndAlternates();
testHomeLanguagePagesGetBidirectionalHreflang();
testAdditionalLanguagePagesSkipHreflangUntilContentIsReliable();
testLocalizedStaticFallbackLinksStayWithinLanguageCluster();
testRobotsAndSitemapUseConfiguredPublicOrigin();
testRobotsAndSitemapStayCrawlSafe();
testRootFallbackLinksEveryCuratedSitemapRoute();
testAllCuratedSeoFallbacksClearLowWordCountThreshold();
testAllCuratedSeoPagesExposeCrawlerVisibleWordCount();
testCjkSeoPagesKeepConservativeCrawlerWordBuffer();
testSeoLandingPagesExposeCollectionAndBreadcrumbStructuredData();
testSitemapIgnoresRequestQueryAndOnlyUsesCuratedPublicLandingPages();
testBuildLlmsTxtUsesPlainMarkdownFormat();

console.log("public SEO tests passed");
