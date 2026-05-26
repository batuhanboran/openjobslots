const GETRO_DOCS_URL = "observed Getro Next.js __NEXT_DATA__ jobs payload";
const GETRO_SOURCE_FAMILY = "html_detail";
const GETRO_PARSER_VERSION = "source-getro-v1";

function clean(value) {
  return String(value || "").trim();
}

function parseUrl(value) {
  try {
    return new URL(clean(value));
  } catch {
    return null;
  }
}

function supportedGetroHost(host) {
  const normalized = clean(host).toLowerCase();
  return normalized.endsWith(".getro.com") && normalized !== "www.getro.com";
}

function parseGetroCompany(urlString) {
  const parsed = parseUrl(urlString);
  if (!parsed) return null;

  const host = clean(parsed.hostname).toLowerCase();
  if (!supportedGetroHost(host)) return null;

  const [subdomain = ""] = host.split(".");
  if (!subdomain) return null;

  const jobsUrl = new URL(`${parsed.protocol}//${parsed.host}/jobs`);
  return {
    host,
    subdomain,
    subdomainLower: subdomain.toLowerCase(),
    baseOrigin: `${parsed.protocol}//${parsed.host}`,
    jobsUrl: jobsUrl.toString()
  };
}

function buildCompanyContext(company = {}) {
  return {
    ...company,
    company_name: clean(company.company_name || company.companyName || company.name),
    url_string: clean(company.url_string || company.company_url || company.url),
    ATS_name: clean(company.ATS_name || company.ats_key || "getro")
  };
}

function createDiscover() {
  return function discover(company = {}) {
    const context = buildCompanyContext(company);
    const config = parseGetroCompany(context.url_string) || {};
    return {
      ats_key: "getro",
      source_family: GETRO_SOURCE_FAMILY,
      docs_url: GETRO_DOCS_URL,
      company: context,
      list_url: clean(config.jobsUrl),
      config,
      parser_version: GETRO_PARSER_VERSION
    };
  };
}

module.exports = {
  GETRO_DOCS_URL,
  GETRO_PARSER_VERSION,
  GETRO_SOURCE_FAMILY,
  buildCompanyContext,
  clean,
  createDiscover,
  parseGetroCompany,
  supportedGetroHost
};
