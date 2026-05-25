const WORKDAY_DOCS_URL = "observed Workday CXS public jobs endpoint";
const WORKDAY_SOURCE_FAMILY = "enterprise_api";
const WORKDAY_PARSER_VERSION = "source-workday-v1";
const LOCALE_SEGMENT_REGEX = /^[a-z]{2}(?:-[A-Z]{2})?$/;

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

function pickSite(pathParts, subdomain) {
  if (!Array.isArray(pathParts) || pathParts.length === 0) return subdomain;
  const jobsIndex = pathParts.findIndex((part) => part.toLowerCase() === "jobs");
  if (jobsIndex > 0) return pathParts[jobsIndex - 1];

  const [first = "", second = ""] = pathParts;
  if (first && LOCALE_SEGMENT_REGEX.test(first) && second) return second;
  return first || subdomain;
}

function parseWorkdayCompany(urlString) {
  const parsed = parseUrl(urlString);
  if (!parsed) return null;

  const host = String(parsed.hostname || "").toLowerCase();
  if (!host.endsWith("myworkdayjobs.com")) return null;

  const subdomain = clean(host.split(".")[0]).toLowerCase();
  const pathParts = parsed.pathname
    .split("/")
    .map((part) => clean(part))
    .filter(Boolean);
  const site = pickSite(pathParts, subdomain);
  if (!subdomain || !site) return null;

  const siteEncoded = encodeURIComponent(site);
  const tenantEncoded = encodeURIComponent(subdomain);
  const companyBaseUrl = `${parsed.origin}/${site}`.replace(/\/+$/, "");
  return {
    host,
    tenant: subdomain,
    subdomain,
    site,
    siteLower: site.toLowerCase(),
    companyBaseUrl,
    cxsUrl: `${parsed.origin}/wday/cxs/${tenantEncoded}/${siteEncoded}/jobs`
  };
}

function buildCompanyContext(company = {}) {
  return {
    ...company,
    company_name: clean(company.company_name || company.companyName || company.name),
    url_string: clean(company.url_string || company.company_url || company.url),
    ATS_name: clean(company.ATS_name || company.ats_key || "workday")
  };
}

function createDiscover() {
  return function discover(company = {}) {
    const context = buildCompanyContext(company);
    const config = parseWorkdayCompany(context.url_string) || {};
    return {
      ats_key: "workday",
      source_family: WORKDAY_SOURCE_FAMILY,
      docs_url: WORKDAY_DOCS_URL,
      company: context,
      list_url: clean(config.cxsUrl),
      config,
      parser_version: WORKDAY_PARSER_VERSION
    };
  };
}

module.exports = {
  WORKDAY_DOCS_URL,
  WORKDAY_PARSER_VERSION,
  WORKDAY_SOURCE_FAMILY,
  buildCompanyContext,
  clean,
  createDiscover,
  parseWorkdayCompany
};
