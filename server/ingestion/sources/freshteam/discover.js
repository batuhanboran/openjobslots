const FRESHTEAM_DOCS_URL = "observed Freshteam public jobs HTML";
const FRESHTEAM_SOURCE_FAMILY = "html_detail";

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

function supportedFreshteamHost(host) {
  return (
    host.endsWith(".freshteam.com") &&
    host !== "freshteam.com" &&
    host !== "www.freshteam.com" &&
    host !== "assets.freshteam.com"
  );
}

function parseFreshteamCompany(urlString) {
  const parsed = parseUrl(urlString);
  if (!parsed) return null;

  const host = String(parsed.hostname || "").toLowerCase();
  if (!supportedFreshteamHost(host)) return null;

  const subdomain = clean(host.split(".")[0]);
  if (!subdomain) return null;

  const pathParts = parsed.pathname
    .split("/")
    .map((part) => clean(part))
    .filter(Boolean);
  if (pathParts.length > 0 && String(pathParts[0] || "").toLowerCase() !== "jobs") return null;

  const baseOrigin = `${parsed.protocol}//${parsed.host}`;
  return {
    host,
    subdomain,
    subdomainLower: subdomain.toLowerCase(),
    baseOrigin,
    boardUrl: `${baseOrigin}/jobs`,
    jobsUrl: `${baseOrigin}/jobs`
  };
}

function buildCompanyContext(company = {}) {
  return {
    ...company,
    company_name: clean(company.company_name || company.companyName || company.name),
    url_string: clean(company.url_string || company.company_url || company.url),
    ATS_name: clean(company.ATS_name || company.ats_key || "freshteam")
  };
}

function createDiscover() {
  return function discover(company = {}) {
    const context = buildCompanyContext(company);
    const config = parseFreshteamCompany(context.url_string) || {};
    return {
      ats_key: "freshteam",
      source_family: FRESHTEAM_SOURCE_FAMILY,
      docs_url: FRESHTEAM_DOCS_URL,
      company: context,
      list_url: clean(config.jobsUrl),
      config,
      parser_version: "source-freshteam-v1"
    };
  };
}

module.exports = {
  FRESHTEAM_DOCS_URL,
  FRESHTEAM_SOURCE_FAMILY,
  buildCompanyContext,
  clean,
  createDiscover,
  parseFreshteamCompany,
  supportedFreshteamHost
};
