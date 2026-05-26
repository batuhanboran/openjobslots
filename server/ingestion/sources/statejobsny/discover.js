"use strict";

const { buildStatejobsnyWindowUrl } = require("./parse");

const STATEJOBSNY_PUBLIC_ORIGIN = "https://www.statejobsny.com";
const STATEJOBSNY_LIST_BASE_URL = `${STATEJOBSNY_PUBLIC_ORIGIN}/public/vacancyTable.cfm`;
const STATEJOBSNY_SOURCE_FAMILY = "public_sector";

function clean(value) {
  return String(value || "").trim();
}

function supportedStatejobsnyHost(hostname) {
  const host = clean(hostname).toLowerCase();
  return host === "www.statejobsny.com" || host === "statejobsny.com";
}

function buildCompanyContext(company = {}) {
  return {
    ...company,
    company_name: clean(company.company_name || company.companyName || company.name || "StateJobsNY"),
    url_string: clean(company.url_string || company.company_url || company.url || STATEJOBSNY_LIST_BASE_URL),
    ATS_name: clean(company.ATS_name || company.ats_key || "statejobsny")
  };
}

function createDiscover() {
  return function discoverStatejobsny(company = {}) {
    const context = buildCompanyContext(company);
    if (context.url_string) {
      try {
        const parsed = new URL(context.url_string);
        if (!supportedStatejobsnyHost(parsed.hostname)) {
          return {
            ok: false,
            ats_key: "statejobsny",
            source_family: STATEJOBSNY_SOURCE_FAMILY,
            reason: "unsupported_statejobsny_host",
            source_url: context.url_string
          };
        }
      } catch {
        return {
          ok: false,
          ats_key: "statejobsny",
          source_family: STATEJOBSNY_SOURCE_FAMILY,
          reason: "invalid_statejobsny_url",
          source_url: context.url_string
        };
      }
    }

    const listUrl = buildStatejobsnyWindowUrl();
    return {
      ats_key: "statejobsny",
      source_family: STATEJOBSNY_SOURCE_FAMILY,
      company: context,
      list_url: listUrl,
      config: {
        listUrl,
        baseListUrl: STATEJOBSNY_LIST_BASE_URL,
        publicOrigin: STATEJOBSNY_PUBLIC_ORIGIN,
        sourceUrl: context.url_string
      },
      parser_version: "source-statejobsny-v1"
    };
  };
}

module.exports = {
  STATEJOBSNY_LIST_BASE_URL,
  STATEJOBSNY_PUBLIC_ORIGIN,
  STATEJOBSNY_SOURCE_FAMILY,
  buildCompanyContext,
  clean,
  createDiscover,
  supportedStatejobsnyHost
};
