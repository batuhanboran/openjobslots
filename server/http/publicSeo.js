const {
  PUBLIC_SEO_ROUTES,
  getPublicSeoAlternateGroupPages,
  getPublicSeoRouteHintByPath,
  normalizePublicSeoPath
} = require("../../src/publicSeoRoutes");

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

function normalizeInlineText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function stripOpenJobSlotsTitleSuffix(value) {
  return normalizeInlineText(value).replace(/\s+\|\s+OpenJobSlots\s*$/i, "").trim();
}

function getSeoHeadingFromTitle(value) {
  const normalized = normalizeInlineText(value);
  if (/^OpenJobSlots\s+\|/i.test(normalized)) return "OpenJobSlots";
  return stripOpenJobSlotsTitleSuffix(normalized);
}

function escapeMarkdownLinkText(value) {
  return normalizeInlineText(value).replace(/[\[\]]/g, "");
}

function removeExistingSeoTags(html) {
  return String(html || "")
    .replace(/\s*<meta[^>]+name=["'](?:description|robots|twitter:card|twitter:title|twitter:description)["'][^>]*>/gi, "")
    .replace(/\s*<meta[^>]+property=["'](?:og:title|og:description|og:type|og:url|og:site_name)["'][^>]*>/gi, "")
    .replace(/\s*<link[^>]+rel=["']canonical["'][^>]*>/gi, "")
    .replace(/\s*<link[^>]+rel=["']alternate["'][^>]*hreflang=["'][^"']+["'][^>]*>/gi, "")
    .replace(/\s*<script[^>]+id=["']openjobslots-(?:organization|website)-jsonld["'][^>]*>[\s\S]*?<\/script>/gi, "");
}

function stringifyJsonLd(value) {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function sanitizeSearchQuery(value) {
  const normalized = String(value || "").replace(/\s+/g, " ").trim();
  if (normalized.length < 2) return "";
  if (/[^\s@]+@[^\s@]+\.[^\s@]+/.test(normalized)) return "";
  if (/\b(?:https?:\/\/|www\.)\S+/i.test(normalized)) return "";
  return normalized.slice(0, 80);
}

function getRequestPath(req) {
  return normalizePublicSeoPath(req?.path || req?.originalUrl || req?.url || "/");
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

  function getSeoRoute(req) {
    return getPublicSeoRouteHintByPath(getRequestPath(req));
  }

  function getPublicSiteCanonicalUrl(req) {
    const seoRoute = getSeoRoute(req);
    if (seoRoute) return `${getPublicSiteOrigin(req)}${seoRoute.path}`;
    const searchQuery = sanitizeSearchQuery(req?.query?.q || req?.query?.search || "");
    if (!searchQuery) return `${getPublicSiteOrigin(req)}/`;
    return `${getPublicSiteOrigin(req)}/?q=${encodeURIComponent(searchQuery)}`;
  }

  function getPublicSearchLandingUrl(req, searchTerm) {
    const searchQuery = sanitizeSearchQuery(searchTerm);
    if (!searchQuery) return "";
    return `${getPublicSiteOrigin(req)}/?q=${encodeURIComponent(searchQuery)}`;
  }

  function getSeoMeta(req) {
    const seoRoute = getSeoRoute(req);
    if (seoRoute) {
      return {
        title: seoRoute.title,
        description: seoRoute.description,
        languageCode: seoRoute.languageCode || "en"
      };
    }
    const searchQuery = sanitizeSearchQuery(req?.query?.q || req?.query?.search || "");
    if (!searchQuery) {
      return {
        title: String(seoTitle || "OpenJobSlots").trim(),
        description: String(seoDescription || "").trim(),
        languageCode: "en"
      };
    }
    return {
      title: `${searchQuery} jobs | OpenJobSlots`,
      description: `Search fresh ${searchQuery} job slots from public employer ATS boards.`,
      languageCode: "en"
    };
  }

  function getPublicSeoAlternateLinks(req) {
    const seoRoute = getSeoRoute(req);
    const requestPath = getRequestPath(req);
    const alternateGroup = seoRoute?.alternateGroup || (requestPath === "/" ? "home" : "");
    return getPublicSeoAlternateLinksForGroup(getPublicSiteOrigin(req), alternateGroup);
  }

  function getPublicSeoAlternateLinksForGroup(siteOrigin, alternateGroup) {
    const groupPages = getPublicSeoAlternateGroupPages(alternateGroup);
    if (groupPages.length === 0) return [];
    const links = groupPages.map((page) => ({
      hreflang: page.languageCode,
      href: `${siteOrigin}${page.path}`
    }));
    const xDefaultPath = alternateGroup === "home" ? "/" : groupPages.find((page) => page.languageCode === "en")?.path;
    if (xDefaultPath) {
      links.push({
        hreflang: "x-default",
        href: `${siteOrigin}${xDefaultPath}`
      });
    }
    return links;
  }

  function buildAlternateLanguageLinkTags(req) {
    return getPublicSeoAlternateLinks(req)
      .map((item) =>
        '<link rel="alternate" hreflang="' +
        escapeHtmlAttribute(item.hreflang) +
        '" href="' +
        escapeHtmlAttribute(item.href) +
        '" />'
      )
      .join("\n    ");
  }

  function buildStructuredDataTags(req) {
    const siteOrigin = getPublicSiteOrigin(req);
    const siteUrl = `${siteOrigin}/`;
    const seoMeta = getSeoMeta(req);
    const description = String(seoMeta.description || seoDescription || "").trim();
    const organization = {
      "@context": "https://schema.org",
      "@type": "Organization",
      "@id": `${siteOrigin}/#organization`,
      name: "OpenJobSlots",
      url: siteUrl,
      logo: `${siteOrigin}/favicon.ico`
    };
    const website = {
      "@context": "https://schema.org",
      "@type": "WebSite",
      "@id": `${siteOrigin}/#website`,
      name: "OpenJobSlots",
      url: siteUrl,
      description,
      inLanguage: seoMeta.languageCode || "en",
      publisher: {
        "@id": organization["@id"]
      },
      potentialAction: {
        "@type": "SearchAction",
        target: `${siteOrigin}/?q={search_term_string}`,
        "query-input": "required name=search_term_string"
      }
    };

    return [
      '<script type="application/ld+json" id="openjobslots-organization-jsonld">' + stringifyJsonLd(organization) + "</script>",
      '<script type="application/ld+json" id="openjobslots-website-jsonld">' + stringifyJsonLd(website) + "</script>"
    ].join("\n    ");
  }

  function getStaticSeoFallbackLinks(req) {
    const seoMeta = getSeoMeta(req);
    const languageCode = seoMeta.languageCode || "en";
    const localizedRoutes = PUBLIC_SEO_ROUTES.filter(
      (route) => route.languageCode === languageCode && route.alternateGroup && route.alternateGroup !== "home"
    );
    const atsRoutes = PUBLIC_SEO_ROUTES.filter((route) => String(route.path || "").startsWith("/ats/")).slice(0, 3);
    return [...localizedRoutes, ...atsRoutes].slice(0, 10);
  }

  function buildStaticSeoFallback(req) {
    const siteOrigin = getPublicSiteOrigin(req);
    const seoMeta = getSeoMeta(req);
    const heading = getSeoHeadingFromTitle(seoMeta.title) || "OpenJobSlots";
    const description = normalizeInlineText(seoMeta.description || seoDescription);
    const links = getStaticSeoFallbackLinks(req)
      .map((route) => {
        const label = stripOpenJobSlotsTitleSuffix(route.title) || route.searchQuery || route.path;
        return [
          "        <li>",
          '<a href="' + escapeHtmlAttribute(`${siteOrigin}${route.path}`) + '">',
          escapeHtmlAttribute(label),
          "</a>",
          "</li>"
        ].join("");
      })
      .join("\n");

    return [
      "<noscript>",
      '  <main id="openjobslots-seo-fallback">',
      "    <h1>" + escapeHtmlAttribute(heading) + "</h1>",
      "    <p>" + escapeHtmlAttribute(description) + "</p>",
      "    <p>OpenJobSlots indexes fresh public employer ATS job openings for role, company, location, remote mode, source, and posting freshness searches. Use the curated public landing pages below to browse common searches while the interactive job search app loads.</p>",
      '    <nav aria-label="Popular job search pages">',
      "      <ul>",
      links,
      "      </ul>",
      "    </nav>",
      "  </main>",
      "</noscript>"
    ].join("\n");
  }

  function replaceStaticSeoFallback(html, req) {
    const fallback = buildStaticSeoFallback(req);
    if (/<noscript>[\s\S]*?<\/noscript>/i.test(html)) {
      return html.replace(/<noscript>[\s\S]*?<\/noscript>/i, fallback);
    }
    if (/<body\b[^>]*>/i.test(html)) {
      return html.replace(/<body\b[^>]*>/i, (match) => `${match}\n    ${fallback}`);
    }
    return html;
  }

  function setHtmlLanguage(html, languageCode) {
    const htmlLang = escapeHtmlAttribute(languageCode || "en");
    return String(html || "").replace(/<html\b([^>]*)>/i, (match, attrs) => {
      if (/\s+lang\s*=\s*["'][^"']*["']/i.test(attrs)) {
        return `<html${attrs.replace(/\s+lang\s*=\s*["'][^"']*["']/i, ` lang="${htmlLang}"`)}>`;
      }
      return `<html lang="${htmlLang}"${attrs}>`;
    });
  }

  function renderSeoIndexHtml(indexHtml, req) {
    const canonicalUrl = getPublicSiteCanonicalUrl(req);
    const seoMeta = getSeoMeta(req);
    const title = escapeHtmlAttribute(seoMeta.title);
    const description = escapeHtmlAttribute(seoMeta.description);
    const canonical = escapeHtmlAttribute(canonicalUrl);
    const alternateTags = buildAlternateLanguageLinkTags(req);
    const analyticsTags = buildPublicWebAnalyticsHeadTags(readPublicWebAnalyticsConfig());
    const tags = [
      '<meta name="description" content="' + description + '" />',
      '<link rel="canonical" href="' + canonical + '" />',
      alternateTags,
      '<meta name="robots" content="index, follow" />',
      '<meta property="og:type" content="website" />',
      '<meta property="og:site_name" content="OpenJobSlots" />',
      '<meta property="og:title" content="' + title + '" />',
      '<meta property="og:description" content="' + description + '" />',
      '<meta property="og:url" content="' + canonical + '" />',
      '<meta name="twitter:card" content="summary" />',
      '<meta name="twitter:title" content="' + title + '" />',
      '<meta name="twitter:description" content="' + description + '" />'
    ].filter(Boolean).join("\n    ");
    const structuredDataTags = buildStructuredDataTags(req);
    const managedAnalyticsTags = analyticsTags
      ? [
        "<!-- OpenJobSlots public analytics start -->",
        analyticsTags,
        "<!-- OpenJobSlots public analytics end -->"
      ].join("\n    ")
      : "";

    let html = setHtmlLanguage(stripPublicWebAnalyticsHeadTags(removeExistingSeoTags(indexHtml)), seoMeta.languageCode || "en")
      .replace(/<title>[\s\S]*?<\/title>/i, `<title>${title}</title>`);
    html = replaceStaticSeoFallback(html, req);
    if (!/<\/head>/i.test(html)) return html;
    const analyticsBlock = managedAnalyticsTags ? `\n    ${managedAnalyticsTags}` : "";
    return html.replace(
      /<\/head>/i,
      `    <!-- OpenJobSlots SEO metadata -->\n    ${tags}\n    ${structuredDataTags}${analyticsBlock}\n</head>`
    );
  }

  function buildLlmsTxt(req) {
    const siteOrigin = getPublicSiteOrigin(req);
    const description = normalizeInlineText(seoDescription || "Find fresh job openings from public employer ATS boards.");
    const byPath = new Map(PUBLIC_SEO_ROUTES.map((route) => [route.path, route]));
    const corePaths = [
      "/en",
      "/en/job-openings",
      "/en/remote-job-openings",
      "/en/software-engineer-jobs",
      "/en/product-manager-jobs",
      "/en/technical-support-engineer-jobs"
    ];
    const atsRoutes = PUBLIC_SEO_ROUTES.filter((route) => String(route.path || "").startsWith("/ats/"));

    function markdownRoute(route) {
      const title = escapeMarkdownLinkText(stripOpenJobSlotsTitleSuffix(route.title) || route.searchQuery || route.path);
      const summary = normalizeInlineText(route.description || `OpenJobSlots landing page for ${route.searchQuery || route.path}.`);
      return `- [${title}](${siteOrigin}${route.path}): ${summary}`;
    }

    const coreLinks = corePaths.map((routePath) => byPath.get(routePath)).filter(Boolean).map(markdownRoute);
    const atsLinks = atsRoutes.map(markdownRoute);

    return [
      "# OpenJobSlots",
      "",
      `> ${description}`,
      "",
      "OpenJobSlots is a public job search product for discovering fresh job slots from employer ATS boards. Public pages focus on crawlable search entry points; app endpoints return structured public posting data.",
      "",
      "## Core pages",
      "",
      ...coreLinks,
      "",
      "## ATS source pages",
      "",
      ...atsLinks,
      "",
      "## Optional",
      "",
      `- [Sitemap](${siteOrigin}/sitemap.xml): XML sitemap for curated public landing pages.`,
      `- [Robots policy](${siteOrigin}/robots.txt): Crawl policy for public and internal routes.`,
      ""
    ].join("\n");
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
    const siteOrigin = getPublicSiteOrigin(req);
    const urls = [
      {
        loc: `${siteOrigin}/`,
        changefreq: "daily",
        priority: "1.0",
        alternateGroup: "home"
      },
      ...PUBLIC_SEO_ROUTES.map((route) => ({
        loc: `${siteOrigin}${route.path}`,
        changefreq: route.changefreq || "daily",
        priority: route.priority || "0.8",
        alternateGroup: route.alternateGroup || ""
      }))
    ];
    const urlEntries = urls.map((item) => {
      const alternateEntries = getPublicSeoAlternateLinksForGroup(siteOrigin, item.alternateGroup)
        .map((alternate) =>
          `    <xhtml:link rel="alternate" hreflang="${escapeHtmlAttribute(alternate.hreflang)}" href="${escapeHtmlAttribute(alternate.href)}" />`
        );
      return [
        "  <url>",
        `    <loc>${escapeHtmlAttribute(item.loc)}</loc>`,
        ...alternateEntries,
        `    <changefreq>${escapeHtmlAttribute(item.changefreq)}</changefreq>`,
        `    <priority>${escapeHtmlAttribute(item.priority)}</priority>`,
        "  </url>"
      ].join("\n");
    });

    return [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
      ...urlEntries,
      "</urlset>"
    ].join("\n") + "\n";
  }

  return {
    buildLlmsTxt,
    buildRobotsTxt,
    buildSitemapXml,
    buildStructuredDataTags,
    getPublicSearchLandingUrl,
    getPublicSiteCanonicalUrl,
    getPublicSiteOrigin,
    renderSeoIndexHtml
  };
}

module.exports = {
  createPublicSeoHelpers,
  escapeHtmlAttribute,
  normalizeOrigin,
  removeExistingSeoTags,
  stringifyJsonLd
};
