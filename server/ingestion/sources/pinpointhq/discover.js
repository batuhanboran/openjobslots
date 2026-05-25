const PINPOINTHQ_DOCS_URL = "observed Pinpoint public postings JSON endpoint";
const PINPOINTHQ_SOURCE_FAMILY = "direct_json";

function clean(value) {
  return String(value || "").trim();
}

function parseUrl(urlString) {
  if (!urlString) return null;
  try {
    return new URL(urlString);
  } catch {
    return null;
  }
}

function parsePinpointHqCompany(urlString) {
  const parsed = parseUrl(urlString);
  if (!parsed) return null;

  const host = String(parsed.hostname || "").toLowerCase();
  if (!host.endsWith(".pinpointhq.com")) return null;
  if (host === "pinpointhq.com" || host === "www.pinpointhq.com") return null;

  const [subdomain = ""] = host.split(".");
  if (!subdomain) return null;

  const baseOrigin = `${parsed.protocol}//${parsed.host}`;
  return {
    host,
    subdomain,
    subdomainLower: subdomain.toLowerCase(),
    baseOrigin,
    boardUrl: `${baseOrigin}/`,
    apiUrl: `${baseOrigin}/postings.json`
  };
}

function buildCompanyContext(company = {}) {
  return {
    ...company,
    company_name: clean(company.company_name || company.companyName || company.name),
    url_string: clean(company.url_string || company.company_url || company.url),
    ATS_name: clean(company.ATS_name || company.ats_key || "pinpointhq")
  };
}

function createDiscover() {
  return function discover(company = {}) {
    const context = buildCompanyContext(company);
    const config = parsePinpointHqCompany(context.url_string) || {};
    return {
      ats_key: "pinpointhq",
      source_family: PINPOINTHQ_SOURCE_FAMILY,
      docs_url: PINPOINTHQ_DOCS_URL,
      company: context,
      list_url: clean(config.apiUrl),
      config,
      parser_version: "source-pinpointhq-v1"
    };
  };
}

module.exports = {
  PINPOINTHQ_DOCS_URL,
  PINPOINTHQ_SOURCE_FAMILY,
  buildCompanyContext,
  clean,
  createDiscover,
  parsePinpointHqCompany
};
