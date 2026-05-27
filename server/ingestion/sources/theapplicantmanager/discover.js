"use strict";

const THEAPPLICANTMANAGER_DOCS_URL = "observed The Applicant Manager public careers HTML";
const THEAPPLICANTMANAGER_SOURCE_FAMILY = "html_detail";
const THEAPPLICANTMANAGER_PARSER_VERSION = "source-theapplicantmanager-v1";

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

function isSupportedTheApplicantManagerHost(host) {
  const normalized = clean(host).toLowerCase();
  return normalized === "theapplicantmanager.com" || normalized === "www.theapplicantmanager.com";
}

function parseTheApplicantManagerCompany(urlString) {
  const parsed = parseUrl(urlString);
  if (!parsed) return null;

  const host = clean(parsed.hostname).toLowerCase();
  if (!isSupportedTheApplicantManagerHost(host)) return null;

  const companyCode = clean(parsed.searchParams.get("co")).toLowerCase();
  if (!companyCode) return null;

  const baseOrigin = `${parsed.protocol}//${parsed.host}`;
  return {
    host,
    companyCode,
    companyCodeLower: companyCode,
    baseOrigin,
    careersUrl: `${baseOrigin}/careers?co=${encodeURIComponent(companyCode)}`
  };
}

function buildCompanyContext(company = {}) {
  return {
    ...company,
    company_name: clean(company.company_name || company.companyName || company.name),
    url_string: clean(company.url_string || company.company_url || company.url),
    ATS_name: clean(company.ATS_name || company.ats_key || "theapplicantmanager")
  };
}

function createDiscover() {
  return function discover(company = {}) {
    const context = buildCompanyContext(company);
    const config = parseTheApplicantManagerCompany(context.url_string) || {};
    return {
      ats_key: "theapplicantmanager",
      source_family: THEAPPLICANTMANAGER_SOURCE_FAMILY,
      docs_url: THEAPPLICANTMANAGER_DOCS_URL,
      company: context,
      list_url: clean(config.careersUrl),
      config,
      parser_version: THEAPPLICANTMANAGER_PARSER_VERSION
    };
  };
}

module.exports = {
  THEAPPLICANTMANAGER_DOCS_URL,
  THEAPPLICANTMANAGER_PARSER_VERSION,
  THEAPPLICANTMANAGER_SOURCE_FAMILY,
  buildCompanyContext,
  clean,
  createDiscover,
  isSupportedTheApplicantManagerHost,
  parseTheApplicantManagerCompany
};
