"use strict";

const APPLICANTAI_DOCS_URL = "observed ApplicantAI public careers HTML";
const APPLICANTAI_SOURCE_FAMILY = "html_detail";
const APPLICANTAI_PARSER_VERSION = "source-applicantai-v1";

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

function isSupportedApplicantAiHost(host) {
  const normalized = clean(host).toLowerCase();
  return normalized === "applicantai.com" || normalized === "www.applicantai.com";
}

function parseApplicantAiCompany(urlString) {
  const parsed = parseUrl(urlString);
  if (!parsed) return null;

  const host = clean(parsed.hostname).toLowerCase();
  if (!isSupportedApplicantAiHost(host)) return null;

  const pathParts = parsed.pathname
    .split("/")
    .map((part) => clean(part))
    .filter(Boolean);
  const slug = clean(pathParts[0]);
  if (!slug) return null;

  const baseOrigin = `${parsed.protocol}//${parsed.host}`;
  return {
    host,
    slug,
    slugLower: slug.toLowerCase(),
    baseOrigin,
    careersUrl: `${baseOrigin}/${slug}`
  };
}

function buildCompanyContext(company = {}) {
  return {
    ...company,
    company_name: clean(company.company_name || company.companyName || company.name),
    url_string: clean(company.url_string || company.company_url || company.url),
    ATS_name: clean(company.ATS_name || company.ats_key || "applicantai")
  };
}

function createDiscover() {
  return function discover(company = {}) {
    const context = buildCompanyContext(company);
    const config = parseApplicantAiCompany(context.url_string) || {};
    return {
      ats_key: "applicantai",
      source_family: APPLICANTAI_SOURCE_FAMILY,
      docs_url: APPLICANTAI_DOCS_URL,
      company: context,
      list_url: clean(config.careersUrl),
      config,
      parser_version: APPLICANTAI_PARSER_VERSION
    };
  };
}

module.exports = {
  APPLICANTAI_DOCS_URL,
  APPLICANTAI_PARSER_VERSION,
  APPLICANTAI_SOURCE_FAMILY,
  buildCompanyContext,
  clean,
  createDiscover,
  isSupportedApplicantAiHost,
  parseApplicantAiCompany
};
