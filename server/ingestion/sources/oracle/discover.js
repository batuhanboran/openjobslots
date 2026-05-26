"use strict";

const ORACLE_DOCS_URL = "Oracle HCM Candidate Experience public requisitions endpoint";
const ORACLE_SOURCE_FAMILY = "enterprise_api";
const ORACLE_PARSER_VERSION = "source-oracle-v1";
const ORACLE_FACETS_VALUE =
  "LOCATIONS;WORK_LOCATIONS;WORKPLACE_TYPES;TITLES;CATEGORIES;ORGANIZATIONS;POSTING_DATES;FLEX_FIELDS";
const ORACLE_PAGE_SIZE = 25;

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

function sanitizeOracleSegment(value) {
  return clean(value).replace(/[^A-Za-z0-9_-]/g, "");
}

function parseOracleCompany(urlString) {
  const parsed = parseUrl(urlString);
  if (!parsed) return null;

  const host = String(parsed.hostname || "").toLowerCase();
  if (!host.endsWith(".oraclecloud.com")) return null;

  const pathParts = String(parsed.pathname || "")
    .split("/")
    .map((part) => clean(part))
    .filter(Boolean);
  const loweredPathParts = pathParts.map((part) => part.toLowerCase());

  const candidateExperienceIndex = loweredPathParts.indexOf("candidateexperience");
  if (candidateExperienceIndex < 0) return null;

  let language = "en";
  if (candidateExperienceIndex + 1 < pathParts.length) {
    const maybeLanguage = String(pathParts[candidateExperienceIndex + 1] || "").trim();
    if (maybeLanguage && maybeLanguage.toLowerCase() !== "sites") {
      language = maybeLanguage;
    }
  }

  let siteNumber = "";
  const sitesIndex = loweredPathParts.indexOf("sites", candidateExperienceIndex + 1);
  if (sitesIndex >= 0 && sitesIndex + 1 < pathParts.length) {
    siteNumber = String(pathParts[sitesIndex + 1] || "").trim();
  }
  if (!siteNumber) {
    siteNumber = String(parsed.searchParams?.get("siteNumber") || "").trim();
  }

  const safeLanguage = sanitizeOracleSegment(language) || "en";
  const safeSiteNumber = sanitizeOracleSegment(siteNumber) || "CX";

  const siteBaseUrl = `${parsed.protocol}//${parsed.host}`;
  const boardUrl = `${siteBaseUrl}/hcmUI/CandidateExperience/${safeLanguage}/sites/${safeSiteNumber}/jobs`;
  const apiUrl = `${siteBaseUrl}/hcmRestApi/resources/latest/recruitingCEJobRequisitions`;
  const finder =
    `findReqs;siteNumber=${safeSiteNumber},` +
    `facetsList=${ORACLE_FACETS_VALUE},` +
    `limit=${ORACLE_PAGE_SIZE},sortBy=POSTING_DATES_DESC`;

  return {
    siteBaseUrl,
    host,
    boardUrl,
    apiUrl,
    siteNumber: safeSiteNumber,
    language: safeLanguage,
    finder
  };
}

function assertOracleFinalHost(urlString, fallbackUrl = "") {
  const finalUrl = parseUrl(clean(urlString || fallbackUrl));
  const host = String(finalUrl?.hostname || "").toLowerCase();
  if (!host.endsWith(".oraclecloud.com")) {
    throw new Error(`Oracle API URL redirected to unexpected host: ${clean(urlString || fallbackUrl)}`);
  }
}

function buildCompanyContext(company = {}) {
  return {
    ...company,
    company_name: clean(company.company_name || company.companyName || company.name),
    url_string: clean(company.url_string || company.company_url || company.url),
    ATS_name: clean(company.ATS_name || company.ats_key || "oracle")
  };
}

function createDiscover(parserVersion = ORACLE_PARSER_VERSION) {
  return function discover(company = {}) {
    const context = buildCompanyContext(company);
    const config = parseOracleCompany(context.url_string) || {};
    return {
      ats_key: "oracle",
      source_family: ORACLE_SOURCE_FAMILY,
      docs_url: ORACLE_DOCS_URL,
      company: context,
      list_url: clean(config.boardUrl || context.url_string),
      config,
      parser_version: clean(parserVersion) || ORACLE_PARSER_VERSION
    };
  };
}

module.exports = {
  ORACLE_DOCS_URL,
  ORACLE_SOURCE_FAMILY,
  ORACLE_PARSER_VERSION,
  ORACLE_FACETS_VALUE,
  ORACLE_PAGE_SIZE,
  assertOracleFinalHost,
  buildCompanyContext,
  clean,
  createDiscover,
  parseOracleCompany,
  sanitizeOracleSegment,
  parseUrl
};
