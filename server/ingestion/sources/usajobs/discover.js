const USAJOBS_DOCS_URL = "https://developer.usajobs.gov/API-Reference/GET-api-Search";
const USAJOBS_LIST_URL = "https://data.usajobs.gov/api/Search";
const USAJOBS_PARSER_VERSION = "source-usajobs-v1";
const USAJOBS_SOURCE_FAMILY = "public_sector";

function clean(value) {
  return String(value || "").trim();
}

function supportedUsajobsHost(host) {
  const normalized = clean(host).toLowerCase();
  return normalized === "data.usajobs.gov";
}

function buildCompanyContext(company = {}) {
  return {
    ...company,
    company_name: clean(company.company_name || company.companyName || company.name || "USAJobs"),
    url_string: clean(company.url_string || company.company_url || company.url || USAJOBS_LIST_URL),
    ATS_name: clean(company.ATS_name || company.ats_key || "usajobs")
  };
}

function createDiscover() {
  return function discover(company = {}) {
    const context = buildCompanyContext(company);
    return {
      ats_key: "usajobs",
      source_family: USAJOBS_SOURCE_FAMILY,
      docs_url: USAJOBS_DOCS_URL,
      company: context,
      list_url: USAJOBS_LIST_URL,
      config: {
        listUrl: USAJOBS_LIST_URL,
        host: "data.usajobs.gov"
      },
      parser_version: USAJOBS_PARSER_VERSION
    };
  };
}

module.exports = {
  USAJOBS_DOCS_URL,
  USAJOBS_LIST_URL,
  USAJOBS_PARSER_VERSION,
  USAJOBS_SOURCE_FAMILY,
  buildCompanyContext,
  clean,
  createDiscover,
  supportedUsajobsHost
};
