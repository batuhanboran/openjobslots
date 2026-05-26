"use strict";

const CAREERSPAGE_DOCS_URL = "observed CareersPage public jobs HTML";
const CAREERSPAGE_SOURCE_FAMILY = "html_detail";
const CAREERSPAGE_PARSER_VERSION = "source-careerspage-v1";

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

function supportedCareerspageHost(host) {
  return host === "careerspage.io" || host === "www.careerspage.io";
}

function parseCareerspageCompany(urlString) {
  const parsed = parseUrl(urlString);
  if (!parsed) return null;

  const host = String(parsed.hostname || "").toLowerCase();
  if (!supportedCareerspageHost(host)) return null;

  const pathParts = parsed.pathname
    .split("/")
    .map((part) => clean(part))
    .filter(Boolean);
  const companySlug = clean(pathParts[0]);
  if (!companySlug) return null;

  const hostWithPort = `${parsed.host}`;
  const baseOrigin = `${parsed.protocol}//${hostWithPort}`;
  return {
    host,
    companySlug,
    companySlugLower: companySlug.toLowerCase(),
    baseOrigin,
    boardUrl: `${baseOrigin}/${encodeURIComponent(companySlug)}`
  };
}

function buildCompanyContext(company = {}) {
  return {
    ...company,
    company_name: clean(company.company_name || company.companyName || company.name),
    url_string: clean(company.url_string || company.company_url || company.url),
    ATS_name: clean(company.ATS_name || company.ats_key || "careerspage")
  };
}

function createDiscover() {
  return function discover(company = {}) {
    const context = buildCompanyContext(company);
    const config = parseCareerspageCompany(context.url_string) || {};
    return {
      ats_key: "careerspage",
      source_family: CAREERSPAGE_SOURCE_FAMILY,
      docs_url: CAREERSPAGE_DOCS_URL,
      company: context,
      list_url: clean(config.boardUrl),
      config,
      parser_version: CAREERSPAGE_PARSER_VERSION
    };
  };
}

module.exports = {
  CAREERSPAGE_DOCS_URL,
  CAREERSPAGE_PARSER_VERSION,
  CAREERSPAGE_SOURCE_FAMILY,
  buildCompanyContext,
  clean,
  createDiscover,
  parseCareerspageCompany,
  supportedCareerspageHost
};
