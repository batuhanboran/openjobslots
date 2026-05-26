const GOVERNMENTJOBS_DOCS_URL = "observed GovernmentJobs public search AJAX endpoint";
const GOVERNMENTJOBS_SOURCE_FAMILY = "public_sector";
const GOVERNMENTJOBS_PARSER_VERSION = "source-governmentjobs-v1";
const GOVERNMENTJOBS_LIST_URL = "https://www.governmentjobs.com/jobs";

function clean(value) {
  return String(value || "").trim();
}

function supportedGovernmentJobsHost(host) {
  const normalized = clean(host).toLowerCase();
  return normalized === "www.governmentjobs.com" || normalized === "governmentjobs.com";
}

function buildCompanyContext(company = {}) {
  return {
    ...company,
    company_name: clean(company.company_name || company.companyName || company.name || "GovernmentJobs"),
    url_string: clean(company.url_string || company.company_url || company.url || GOVERNMENTJOBS_LIST_URL),
    ATS_name: clean(company.ATS_name || company.ats_key || "governmentjobs")
  };
}

function createDiscover() {
  return function discover(company = {}) {
    const context = buildCompanyContext(company);
    return {
      ats_key: "governmentjobs",
      source_family: GOVERNMENTJOBS_SOURCE_FAMILY,
      docs_url: GOVERNMENTJOBS_DOCS_URL,
      company: context,
      list_url: GOVERNMENTJOBS_LIST_URL,
      config: {
        listUrl: GOVERNMENTJOBS_LIST_URL,
        host: "www.governmentjobs.com"
      },
      parser_version: GOVERNMENTJOBS_PARSER_VERSION
    };
  };
}

module.exports = {
  GOVERNMENTJOBS_DOCS_URL,
  GOVERNMENTJOBS_LIST_URL,
  GOVERNMENTJOBS_PARSER_VERSION,
  GOVERNMENTJOBS_SOURCE_FAMILY,
  buildCompanyContext,
  clean,
  createDiscover,
  supportedGovernmentJobsHost
};
