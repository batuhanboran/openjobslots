const TEAMTAILOR_DOCS_URL = "observed Teamtailor public jobs HTML";
const TEAMTAILOR_SOURCE_FAMILY = "html_detail";

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

function parseTeamtailorCompany(urlString) {
  const parsed = parseUrl(urlString);
  if (!parsed) return null;

  const host = String(parsed.hostname || "").toLowerCase();
  if (!host.endsWith(".teamtailor.com")) return null;

  const subdomain = clean(host.split(".")[0]);
  if (!subdomain) return null;

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
    ATS_name: clean(company.ATS_name || company.ats_key || "teamtailor")
  };
}

function createDiscover() {
  return function discover(company = {}) {
    const context = buildCompanyContext(company);
    const config = parseTeamtailorCompany(context.url_string) || {};
    return {
      ats_key: "teamtailor",
      source_family: TEAMTAILOR_SOURCE_FAMILY,
      docs_url: TEAMTAILOR_DOCS_URL,
      company: context,
      list_url: clean(config.jobsUrl),
      config,
      parser_version: "source-teamtailor-v1"
    };
  };
}

module.exports = {
  TEAMTAILOR_DOCS_URL,
  TEAMTAILOR_SOURCE_FAMILY,
  buildCompanyContext,
  clean,
  createDiscover,
  parseTeamtailorCompany
};
