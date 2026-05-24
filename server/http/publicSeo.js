function normalizeOrigin(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    return `${parsed.protocol}//${parsed.host}`.toLowerCase();
  } catch {
    return raw.replace(/\/+$/, "").toLowerCase();
  }
}

function escapeHtmlAttribute(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function removeExistingSeoTags(html) {
  return String(html || "")
    .replace(/\s*<meta[^>]+name=["'](?:description|robots|twitter:card|twitter:title|twitter:description)["'][^>]*>/gi, "")
    .replace(/\s*<meta[^>]+property=["'](?:og:title|og:description|og:type|og:url|og:site_name)["'][^>]*>/gi, "")
    .replace(/\s*<link[^>]+rel=["']canonical["'][^>]*>/gi, "");
}

function createPublicSeoHelpers(dependencies = {}) {
  const {
    buildPublicWebAnalyticsHeadTags = () => "",
    nodeEnv = "development",
    port = 8787,
    publicSiteUrl = "",
    readPublicWebAnalyticsConfig = () => ({}),
    seoDescription = "",
    seoTitle = "OpenJobSlots",
    stripPublicWebAnalyticsHeadTags = (html) => String(html || "")
  } = dependencies;

  function getPublicSiteOrigin(req) {
    const configured = normalizeOrigin(publicSiteUrl);
    if (configured) return configured;
    if (nodeEnv === "production") return "https://openjobslots.com";

    const forwardedProto = String(req.get("x-forwarded-proto") || "").split(",")[0].trim();
    const forwardedHost = String(req.get("x-forwarded-host") || "").split(",")[0].trim();
    const protocol = forwardedProto || req.protocol || "http";
    const host = forwardedHost || req.get("host") || `localhost:${port}`;
    return normalizeOrigin(`${protocol}://${host}`) || `http://localhost:${port}`;
  }

  function getPublicSiteCanonicalUrl(req) {
    return `${getPublicSiteOrigin(req)}/`;
  }

  function renderSeoIndexHtml(indexHtml, req) {
    const canonicalUrl = getPublicSiteCanonicalUrl(req);
    const title = escapeHtmlAttribute(seoTitle);
    const description = escapeHtmlAttribute(seoDescription);
    const canonical = escapeHtmlAttribute(canonicalUrl);
    const analyticsTags = buildPublicWebAnalyticsHeadTags(readPublicWebAnalyticsConfig());
    const tags = [
      '<meta name="description" content="' + description + '" />',
      '<link rel="canonical" href="' + canonical + '" />',
      '<meta name="robots" content="index, follow" />',
      '<meta property="og:type" content="website" />',
      '<meta property="og:site_name" content="OpenJobSlots" />',
      '<meta property="og:title" content="' + title + '" />',
      '<meta property="og:description" content="' + description + '" />',
      '<meta property="og:url" content="' + canonical + '" />',
      '<meta name="twitter:card" content="summary" />',
      '<meta name="twitter:title" content="' + title + '" />',
      '<meta name="twitter:description" content="' + description + '" />'
    ].join("\n    ");
    const managedAnalyticsTags = analyticsTags
      ? [
        "<!-- OpenJobSlots public analytics start -->",
        analyticsTags,
        "<!-- OpenJobSlots public analytics end -->"
      ].join("\n    ")
      : "";

    let html = stripPublicWebAnalyticsHeadTags(removeExistingSeoTags(indexHtml)).replace(
      /<title>[\s\S]*?<\/title>/i,
      `<title>${title}</title>`
    );
    if (!/<\/head>/i.test(html)) return html;
    const analyticsBlock = managedAnalyticsTags ? `\n    ${managedAnalyticsTags}` : "";
    return html.replace(
      /<\/head>/i,
      `    <!-- OpenJobSlots SEO metadata -->\n    ${tags}${analyticsBlock}\n</head>`
    );
  }

  function buildRobotsTxt(req) {
    return [
      "User-agent: *",
      "Allow: /",
      "Disallow: /applications",
      "Disallow: /settings",
      "Disallow: /sync",
      "Disallow: /ingestion",
      "Disallow: /mcp",
      "Disallow: /frontend",
      "Disallow: /postings",
      `Sitemap: ${getPublicSiteOrigin(req)}/sitemap.xml`
    ].join("\n") + "\n";
  }

  function buildSitemapXml(req) {
    const canonicalUrl = escapeHtmlAttribute(getPublicSiteCanonicalUrl(req));
    return [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      "  <url>",
      `    <loc>${canonicalUrl}</loc>`,
      "    <changefreq>daily</changefreq>",
      "    <priority>1.0</priority>",
      "  </url>",
      "</urlset>"
    ].join("\n") + "\n";
  }

  return {
    buildRobotsTxt,
    buildSitemapXml,
    getPublicSiteCanonicalUrl,
    getPublicSiteOrigin,
    renderSeoIndexHtml
  };
}

module.exports = {
  createPublicSeoHelpers,
  escapeHtmlAttribute,
  normalizeOrigin,
  removeExistingSeoTags
};
