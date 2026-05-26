"use strict";

const SCHOOLSPRING_SOURCE_FAMILY = "public_sector";
const SCHOOLSPRING_API_URL = "https://api.schoolspring.com/api/Jobs/GetPagedJobsWithSearch";

function clean(value) {
  return String(value || "").trim();
}

function supportedSchoolspringHost(hostname) {
  const host = clean(hostname).toLowerCase();
  return host === "api.schoolspring.com";
}

function buildCompanyContext(company = {}) {
  return {
    company_name: clean(company.company_name || company.companyName || company.name || "SchoolSpring"),
    url_string: clean(company.url_string || company.url || SCHOOLSPRING_API_URL)
  };
}

function createDiscover() {
  return function discoverSchoolspring(company = {}) {
    const context = buildCompanyContext(company);
    return {
      ats_key: "schoolspring",
      source_family: SCHOOLSPRING_SOURCE_FAMILY,
      list_url: SCHOOLSPRING_API_URL,
      config: {
        apiUrl: SCHOOLSPRING_API_URL,
        sourceUrl: context.url_string,
        publicOrigin: "https://www.schoolspring.com"
      }
    };
  };
}

module.exports = {
  SCHOOLSPRING_API_URL,
  SCHOOLSPRING_SOURCE_FAMILY,
  buildCompanyContext,
  clean,
  createDiscover,
  supportedSchoolspringHost
};
