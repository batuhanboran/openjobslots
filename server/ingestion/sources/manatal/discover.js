const MANATAL_DOCS_URL = "observed Manatal careers-page public jobs endpoint";
const MANATAL_SOURCE_FAMILY = "direct_json";

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

function parseManatalCompany(urlString) {
  const parsed = parseUrl(urlString);
  if (!parsed) return null;

  const host = String(parsed.hostname || "").toLowerCase();
  if (host !== "www.careers-page.com" && !host.endsWith(".careers-page.com")) return null;

  const pathParts = parsed.pathname
    .split("/")
    .map((part) => clean(part))
    .filter(Boolean);
  const hostSubdomain =
    host.endsWith(".careers-page.com") && host !== "www.careers-page.com"
      ? clean(host.split(".")[0])
      : "";

  let domainSlug = hostSubdomain || clean(pathParts[0]);
  if (!domainSlug) return null;
  domainSlug = domainSlug.toLowerCase();
  if (!domainSlug || domainSlug === "job" || domainSlug === "jobs") return null;

  const baseOrigin = `${parsed.protocol}//${parsed.host}`;
  const publicBaseUrl = "https://www.careers-page.com";
  const boardUrl = host === "www.careers-page.com" ? `${baseOrigin}/${domainSlug}/` : `${baseOrigin}/`;

  return {
    host,
    domainSlug,
    domainSlugLower: domainSlug,
    baseOrigin,
    publicBaseUrl,
    boardUrl,
    careersUrl: boardUrl,
    jobsApiUrl: `${publicBaseUrl}/api/v1.0/c/${encodeURIComponent(domainSlug)}/jobs/`
  };
}

function buildCompanyContext(company = {}) {
  return {
    ...company,
    company_name: clean(company.company_name || company.companyName || company.name),
    url_string: clean(company.url_string || company.company_url || company.url),
    ATS_name: clean(company.ATS_name || company.ats_key || "manatal")
  };
}

function createDiscover() {
  return function discover(company = {}) {
    const context = buildCompanyContext(company);
    const config = parseManatalCompany(context.url_string) || {};
    return {
      ats_key: "manatal",
      source_family: MANATAL_SOURCE_FAMILY,
      docs_url: MANATAL_DOCS_URL,
      company: context,
      list_url: clean(config.jobsApiUrl),
      config,
      parser_version: "source-manatal-v1"
    };
  };
}

module.exports = {
  MANATAL_DOCS_URL,
  MANATAL_SOURCE_FAMILY,
  buildCompanyContext,
  clean,
  createDiscover,
  parseManatalCompany
};
