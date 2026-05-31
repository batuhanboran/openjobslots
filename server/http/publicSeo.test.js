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
  assert.ok(html.includes("Search fresh Frontend Engineer job slots from public employer ATS boards."));
  assert.ok(html.includes('<meta property="og:url" content="https://openjobslots.com/?q=Frontend%20Engineer" />'));
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

function testRobotsAndSitemapUseConfiguredPublicOrigin() {
  const { buildRobotsTxt, buildSitemapXml } = createSeoHelpers({
    publicSiteUrl: "https://openjobslots.com"
  });
  const req = createRequest();

  assert.ok(buildRobotsTxt(req).includes("Sitemap: https://openjobslots.com/sitemap.xml"));
  assert.ok(buildSitemapXml(req).includes("<loc>https://openjobslots.com/</loc>"));
  assert.ok(buildSitemapXml(req).includes("<loc>https://openjobslots.com/tr/is-ilanlari</loc>"));
  assert.ok(buildSitemapXml(req).includes("<loc>https://openjobslots.com/en/remote-job-openings</loc>"));
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
  assert.doesNotMatch(robots, /Content-Signal/i);
  assert.match(robots, /^Sitemap: https:\/\/openjobslots\.com\/sitemap\.xml$/m);

  assert.match(sitemap, /<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9" xmlns:xhtml="http:\/\/www\.w3\.org\/1999\/xhtml">/);
  assert.match(sitemap, /<loc>https:\/\/openjobslots\.com\/<\/loc>/);
  assert.match(sitemap, /<loc>https:\/\/openjobslots\.com\/tr\/yazilim-muhendisi-is-ilanlari<\/loc>/);
  assert.match(sitemap, /<loc>https:\/\/openjobslots\.com\/ats\/greenhouse-jobs<\/loc>/);
  assert.match(sitemap, /xmlns:xhtml="http:\/\/www\.w3\.org\/1999\/xhtml"/);
  assert.match(sitemap, /<xhtml:link rel="alternate" hreflang="tr" href="https:\/\/openjobslots\.com\/tr\/uzaktan-calisma-ilanlari" \/>/);
  assert.match(sitemap, /<xhtml:link rel="alternate" hreflang="x-default" href="https:\/\/openjobslots\.com\/en\/remote-job-openings" \/>/);
  assert.doesNotMatch(sitemap, /\/postings|\/applications|\/settings|\/ingestion|\/mcp|\/frontend/);
  assert.doesNotMatch(sitemap, /\?q=/);
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
  const { buildSitemapXml } = createSeoHelpers({
    publicSiteUrl: "https://openjobslots.com"
  });
  const sitemap = buildSitemapXml(createRequest({ query: { q: "private@example.com" } }));
  const locMatches = sitemap.match(/<loc>/g) || [];

  assert.equal(locMatches.length, PUBLIC_SEO_ROUTES.length + 1);
  assert.match(sitemap, /<loc>https:\/\/openjobslots\.com\/<\/loc>/);
  assert.match(sitemap, /<loc>https:\/\/openjobslots\.com\/en\/product-manager-jobs<\/loc>/);
  assert.match(sitemap, /<loc>https:\/\/openjobslots\.com\/en\/data-analyst-jobs<\/loc>/);
  assert.match(sitemap, /<loc>https:\/\/openjobslots\.com\/en\/customer-success-manager-jobs<\/loc>/);
  assert.match(sitemap, /<loc>https:\/\/openjobslots\.com\/en\/devops-engineer-jobs<\/loc>/);
  assert.match(sitemap, /<loc>https:\/\/openjobslots\.com\/en\/ats-job-boards<\/loc>/);
  assert.match(sitemap, /<loc>https:\/\/openjobslots\.com\/en\/direct-apply-jobs<\/loc>/);
  assert.match(sitemap, /<loc>https:\/\/openjobslots\.com\/en\/hidden-jobs<\/loc>/);
  assert.match(sitemap, /<loc>https:\/\/openjobslots\.com\/en\/jobs-not-on-linkedin<\/loc>/);
  assert.doesNotMatch(sitemap, /private@example\.com/);
  assert.doesNotMatch(sitemap, /%40/);
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
testLocalizedSeoLandingPagesGetLanguageSpecificMetadataAndAlternates();
testHomeLanguagePagesGetBidirectionalHreflang();
testRobotsAndSitemapUseConfiguredPublicOrigin();
testRobotsAndSitemapStayCrawlSafe();
testRootFallbackLinksEveryCuratedSitemapRoute();
testAllCuratedSeoFallbacksClearLowWordCountThreshold();
testAllCuratedSeoPagesExposeCrawlerVisibleWordCount();
testSeoLandingPagesExposeCollectionAndBreadcrumbStructuredData();
testSitemapIgnoresRequestQueryAndOnlyUsesCuratedPublicLandingPages();
testBuildLlmsTxtUsesPlainMarkdownFormat();

console.log("public SEO tests passed");
