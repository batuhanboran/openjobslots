"use strict";

const CALCAREERS_PUBLIC_ORIGIN = "https://calcareers.ca.gov";
const CALCAREERS_LIST_URL = `${CALCAREERS_PUBLIC_ORIGIN}/CalHRPublic/Search/JobSearchResults.aspx`;
const CALCAREERS_SOURCE_FAMILY = "public_sector";

function clean(value) {
  return String(value || "").trim();
}

function supportedCalcareersHost(hostname) {
  const host = clean(hostname).toLowerCase();
  return host === "calcareers.ca.gov" || host === "www.calcareers.ca.gov";
}

function buildCompanyContext(company = {}) {
  return {
    ...company,
    company_name: clean(company.company_name || company.companyName || company.name || "CalCareers"),
    url_string: clean(company.url_string || company.company_url || company.url || CALCAREERS_LIST_URL),
    ATS_name: clean(company.ATS_name || company.ats_key || "calcareers")
  };
}

function createDiscover() {
  return function discoverCalcareers(company = {}) {
    const context = buildCompanyContext(company);
    if (context.url_string) {
      try {
        const parsed = new URL(context.url_string);
        if (!supportedCalcareersHost(parsed.hostname)) {
          return {
            ok: false,
            ats_key: "calcareers",
            source_family: CALCAREERS_SOURCE_FAMILY,
            reason: "unsupported_calcareers_host",
            source_url: context.url_string
          };
        }
      } catch {
        return {
          ok: false,
          ats_key: "calcareers",
          source_family: CALCAREERS_SOURCE_FAMILY,
          reason: "invalid_calcareers_url",
          source_url: context.url_string
        };
      }
    }

    return {
      ats_key: "calcareers",
      source_family: CALCAREERS_SOURCE_FAMILY,
      company: context,
      list_url: CALCAREERS_LIST_URL,
      config: {
        listUrl: CALCAREERS_LIST_URL,
        publicOrigin: CALCAREERS_PUBLIC_ORIGIN,
        sourceUrl: context.url_string
      },
      parser_version: "source-calcareers-v1"
    };
  };
}

module.exports = {
  CALCAREERS_LIST_URL,
  CALCAREERS_PUBLIC_ORIGIN,
  CALCAREERS_SOURCE_FAMILY,
  buildCompanyContext,
  clean,
  createDiscover,
  supportedCalcareersHost
};
