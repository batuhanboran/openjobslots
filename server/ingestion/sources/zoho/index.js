const { createSourceModule } = require("../common");
const parser = require("./parse");

const baseSource = createSourceModule("zoho");

function clean(value) {
  return String(value || "").trim();
}

function inferCompanyName(company = {}, config = {}) {
  const explicitName = clean(company.company_name);
  if (explicitName) return explicitName;

  const sourceUrl = clean(config.careersUrl || company.company_url || company.url_string);
  try {
    const parsed = new URL(sourceUrl);
    const subdomain = clean(parsed.hostname.split(".")[0]);
    if (subdomain) return subdomain.toLowerCase();
  } catch {
    // Fall back to the ATS key when no trustworthy tenant name is available.
  }

  return "zoho";
}

function extractHtmlPayload(rawPayload) {
  if (typeof rawPayload === "string") return rawPayload;
  if (rawPayload && typeof rawPayload === "object" && !Array.isArray(rawPayload)) {
    return rawPayload.body || rawPayload.html || "";
  }
  return "";
}

function parse(rawPayload, company = {}) {
  const discovered = baseSource.discover(company);
  const config = rawPayload && typeof rawPayload === "object" && !Array.isArray(rawPayload)
    ? rawPayload.__sourceConfig || discovered.config || {}
    : discovered.config || {};
  return parser.parseZohoPostingsFromHtml(inferCompanyName(company, config), config, extractHtmlPayload(rawPayload));
}

module.exports = {
  ...baseSource,
  ...parser,
  parse
};
