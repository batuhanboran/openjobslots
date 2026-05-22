const GOOGLE_TAG_MANAGER_ORIGIN = "https://www.googletagmanager.com";
const GOOGLE_ANALYTICS_ORIGIN = "https://www.google-analytics.com";
const GOOGLE_ANALYTICS_UI_ORIGIN = "https://analytics.google.com";
const GOOGLE_ANALYTICS_REGION1_ORIGIN = "https://region1.google-analytics.com";

function escapeHtmlAttribute(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function normalizeGaMeasurementId(value) {
  const raw = String(value || "").trim().toUpperCase();
  return /^G-[A-Z0-9]+$/.test(raw) ? raw : "";
}

function extractHtmlMetaContent(value) {
  const raw = String(value || "").trim();
  const match = raw.match(/<meta\b[^>]*\bname=["']google-site-verification["'][^>]*\bcontent=["']([^"']+)["'][^>]*>/i);
  return match ? match[1] : raw;
}

function normalizeGoogleSiteVerificationToken(value) {
  const raw = extractHtmlMetaContent(value).replace(/^google-site-verification=/i, "").trim();
  return /^[A-Za-z0-9_-]{8,256}$/.test(raw) ? raw : "";
}

function readPublicWebAnalyticsConfig(env = process.env) {
  const gaMeasurementId = normalizeGaMeasurementId(
    env.OPENJOBSLOTS_GA_MEASUREMENT_ID || env.GOOGLE_ANALYTICS_MEASUREMENT_ID || ""
  );
  const googleSiteVerificationToken = normalizeGoogleSiteVerificationToken(
    env.OPENJOBSLOTS_GSC_VERIFICATION_TOKEN || env.GOOGLE_SITE_VERIFICATION || ""
  );

  return {
    gaMeasurementId,
    googleSiteVerificationToken
  };
}

function buildPublicWebAnalyticsHeadTags(config = {}) {
  const gaMeasurementId = normalizeGaMeasurementId(config.gaMeasurementId);
  const googleSiteVerificationToken = normalizeGoogleSiteVerificationToken(config.googleSiteVerificationToken);
  const tags = [];

  if (googleSiteVerificationToken) {
    tags.push(
      `<meta name="google-site-verification" content="${escapeHtmlAttribute(googleSiteVerificationToken)}" />`
    );
  }

  if (gaMeasurementId) {
    const escapedId = escapeHtmlAttribute(gaMeasurementId);
    tags.push(
      `<script async src="${GOOGLE_TAG_MANAGER_ORIGIN}/gtag/js?id=${escapedId}"></script>`,
      [
        "<script>",
        "window.dataLayer = window.dataLayer || [];",
        "function gtag(){window.dataLayer.push(arguments);}",
        'gtag("js", new Date());',
        `gtag("config", "${escapedId}", { send_page_view: true });`,
        "</script>"
      ].join("\n")
    );
  }

  return tags.join("\n");
}

function stripPublicWebAnalyticsHeadTags(html) {
  return String(html || "")
    .replace(
      /\s*<!-- OpenJobSlots public analytics start -->[\s\S]*?<!-- OpenJobSlots public analytics end -->/gi,
      ""
    )
    .replace(/\s*<meta[^>]+name=["']google-site-verification["'][^>]*>/gi, "")
    .replace(
      /\s*<script\b[^>]*src=["']https:\/\/www\.googletagmanager\.com\/gtag\/js\?id=[^"']+["'][^>]*>\s*<\/script>/gi,
      ""
    )
    .replace(
      /\s*<script>\s*window\.dataLayer = window\.dataLayer \|\| \[\];[\s\S]*?<\/script>/gi,
      ""
    );
}

function buildGoogleAnalyticsCsp(config = {}) {
  if (!normalizeGaMeasurementId(config.gaMeasurementId)) {
    return { scriptSrc: [], connectSrc: [], imgSrc: [] };
  }

  return {
    scriptSrc: [GOOGLE_TAG_MANAGER_ORIGIN],
    connectSrc: [GOOGLE_ANALYTICS_ORIGIN, GOOGLE_ANALYTICS_UI_ORIGIN, GOOGLE_ANALYTICS_REGION1_ORIGIN],
    imgSrc: [GOOGLE_ANALYTICS_ORIGIN]
  };
}

module.exports = {
  buildGoogleAnalyticsCsp,
  buildPublicWebAnalyticsHeadTags,
  normalizeGaMeasurementId,
  normalizeGoogleSiteVerificationToken,
  readPublicWebAnalyticsConfig,
  stripPublicWebAnalyticsHeadTags
};
