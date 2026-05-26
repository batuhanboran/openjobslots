"use strict";

const K12JOBSPOT_API_URL = "https://api.k12jobspot.com/api/Jobs/Search";
const K12JOBSPOT_PUBLIC_ORIGIN = "https://www.k12jobspot.com";
const K12JOBSPOT_SOURCE_FAMILY = "public_sector";

function clean(value) {
  return String(value || "").trim();
}

function supportedK12jobspotHost(hostname) {
  const host = clean(hostname).toLowerCase();
  return host === "api.k12jobspot.com" || host === "www.k12jobspot.com" || host === "k12jobspot.com";
}

function supportedK12jobspotApiHost(hostname) {
  return clean(hostname).toLowerCase() === "api.k12jobspot.com";
}

function buildCompanyContext(company = {}) {
  return {
    company_name: clean(company.company_name || company.companyName || company.name || "K12JobSpot"),
    url_string: clean(company.url_string || company.url || K12JOBSPOT_API_URL)
  };
}

function createDiscover() {
  return function discoverK12jobspot(company = {}) {
    const context = buildCompanyContext(company);
    if (context.url_string) {
      try {
        const parsed = new URL(context.url_string);
        if (!supportedK12jobspotHost(parsed.hostname)) {
          return {
            ok: false,
            ats_key: "k12jobspot",
            source_family: K12JOBSPOT_SOURCE_FAMILY,
            reason: "unsupported_k12jobspot_host",
            source_url: context.url_string
          };
        }
      } catch {
        return {
          ok: false,
          ats_key: "k12jobspot",
          source_family: K12JOBSPOT_SOURCE_FAMILY,
          reason: "invalid_k12jobspot_url",
          source_url: context.url_string
        };
      }
    }

    return {
      ats_key: "k12jobspot",
      source_family: K12JOBSPOT_SOURCE_FAMILY,
      list_url: K12JOBSPOT_API_URL,
      config: {
        apiUrl: K12JOBSPOT_API_URL,
        sourceUrl: context.url_string,
        publicOrigin: K12JOBSPOT_PUBLIC_ORIGIN
      }
    };
  };
}

module.exports = {
  K12JOBSPOT_API_URL,
  K12JOBSPOT_PUBLIC_ORIGIN,
  K12JOBSPOT_SOURCE_FAMILY,
  buildCompanyContext,
  clean,
  createDiscover,
  supportedK12jobspotApiHost,
  supportedK12jobspotHost
};
