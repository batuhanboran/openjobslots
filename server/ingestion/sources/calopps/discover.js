"use strict";

const CALOPPS_PUBLIC_ORIGIN = "https://www.calopps.org";
const CALOPPS_LIST_URL = `${CALOPPS_PUBLIC_ORIGIN}/job-search-list`;
const CALOPPS_SOURCE_FAMILY = "public_sector";

function clean(value) {
  return String(value || "").trim();
}

function supportedCaloppsHost(hostname) {
  const host = clean(hostname).toLowerCase();
  return host === "www.calopps.org" || host === "calopps.org";
}

function buildCompanyContext(company = {}) {
  return {
    ...company,
    company_name: clean(company.company_name || company.companyName || company.name || "CalOpps"),
    url_string: clean(company.url_string || company.company_url || company.url || CALOPPS_LIST_URL),
    ATS_name: clean(company.ATS_name || company.ats_key || "calopps")
  };
}

function createDiscover() {
  return function discoverCalopps(company = {}) {
    const context = buildCompanyContext(company);
    if (context.url_string) {
      try {
        const parsed = new URL(context.url_string);
        if (!supportedCaloppsHost(parsed.hostname)) {
          return {
            ok: false,
            ats_key: "calopps",
            source_family: CALOPPS_SOURCE_FAMILY,
            reason: "unsupported_calopps_host",
            source_url: context.url_string
          };
        }
      } catch {
        return {
          ok: false,
          ats_key: "calopps",
          source_family: CALOPPS_SOURCE_FAMILY,
          reason: "invalid_calopps_url",
          source_url: context.url_string
        };
      }
    }

    return {
      ats_key: "calopps",
      source_family: CALOPPS_SOURCE_FAMILY,
      company: context,
      list_url: CALOPPS_LIST_URL,
      config: {
        listUrl: CALOPPS_LIST_URL,
        publicOrigin: CALOPPS_PUBLIC_ORIGIN,
        sourceUrl: context.url_string
      },
      parser_version: "source-calopps-v1"
    };
  };
}

module.exports = {
  CALOPPS_LIST_URL,
  CALOPPS_PUBLIC_ORIGIN,
  CALOPPS_SOURCE_FAMILY,
  buildCompanyContext,
  clean,
  createDiscover,
  supportedCaloppsHost
};
