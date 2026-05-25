const ADP_MYJOBS_DOCS_URL = "observed ADP MyJobs public requisitions endpoint";
const ADP_MYJOBS_SOURCE_FAMILY = "enterprise_api";
const ADP_MYJOBS_PARSER_VERSION = "source-adp_myjobs-v1";

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

function buildCompanyContext(company = {}) {
  return {
    ...company,
    company_name: clean(company.company_name || company.companyName || company.name),
    url_string: clean(company.url_string || company.company_url || company.url),
    ATS_name: clean(company.ATS_name || company.ats_key || "adp_myjobs")
  };
}

function parseAdpMyjobsCompany(urlString) {
  const parsed = parseUrl(urlString);
  if (!parsed) return null;

  const host = String(parsed.hostname || "").toLowerCase();
  if (host !== "myjobs.adp.com" && host !== "www.myjobs.adp.com") return null;

  const pathParts = parsed.pathname
    .split("/")
    .map((part) => clean(part))
    .filter(Boolean);
  const companyName = clean(pathParts[0]);
  if (!companyName) return null;

  return {
    host,
    companyName,
    companyNameLower: companyName.toLowerCase(),
    boardUrl: `https://myjobs.adp.com/${companyName}/cx/job-listing`,
    careerSiteUrl: `https://myjobs.adp.com/public/staffing/v1/career-site/${encodeURIComponent(companyName)}`
  };
}

function createDiscover() {
  return function discover(company = {}) {
    const context = buildCompanyContext(company);
    const config = parseAdpMyjobsCompany(context.url_string) || {};
    return {
      ats_key: "adp_myjobs",
      source_family: ADP_MYJOBS_SOURCE_FAMILY,
      docs_url: ADP_MYJOBS_DOCS_URL,
      company: context,
      list_url: clean(config.careerSiteUrl),
      config,
      parser_version: ADP_MYJOBS_PARSER_VERSION
    };
  };
}

module.exports = {
  ADP_MYJOBS_DOCS_URL,
  ADP_MYJOBS_PARSER_VERSION,
  ADP_MYJOBS_SOURCE_FAMILY,
  buildCompanyContext,
  clean,
  createDiscover,
  parseAdpMyjobsCompany
};
