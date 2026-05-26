"use strict";

const TALENTREEF_DOCS_URL = "observed TalentReef public career-page alias and posting search response";
const TALENTREEF_SOURCE_FAMILY = "html_detail";
const TALENTREEF_PARSER_VERSION = "source-talentreef-v1";
const TALENTREEF_ALIAS_API_URL = "https://prod-kong.internal.talentreef.com/apply/careerPages/alias/";
const TALENTREEF_SEARCH_API_URL = "https://prod-kong.internal.talentreef.com/apply/proxy-es/search-en-us/posting/_search";

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

function supportedTalentreefHost(hostname) {
  const host = clean(hostname).toLowerCase();
  return host === "apply.jobappnetwork.com" || host === "www.apply.jobappnetwork.com";
}

function supportedTalentreefApiHost(hostname) {
  return clean(hostname).toLowerCase() === "prod-kong.internal.talentreef.com";
}

function parseTalentreefCompany(urlString) {
  const parsed = parseUrl(urlString);
  if (!parsed) return null;

  const host = parsed.hostname.toLowerCase();
  if (!supportedTalentreefHost(host)) return null;

  const companyName = String(parsed.pathname || "")
    .split("/")
    .map((part) => clean(part))
    .filter(Boolean)[0] || "";
  if (!companyName) return null;

  const baseOrigin = `${parsed.origin}`;
  const boardUrl = `${baseOrigin}/${companyName}`;
  const apiCompanyName = encodeURIComponent(companyName);
  return {
    host,
    companyName,
    companyNameLower: companyName.toLowerCase(),
    baseOrigin,
    boardUrl,
    careersUrl: boardUrl,
    aliasApiUrl: `${TALENTREEF_ALIAS_API_URL}${apiCompanyName}`,
    searchApiUrl: TALENTREEF_SEARCH_API_URL
  };
}

function assertTalentreefHost(urlString, fallbackUrl) {
  const finalUrl = clean(urlString || fallbackUrl);
  const parsed = parseUrl(finalUrl);
  const host = String(parsed?.hostname || "").toLowerCase();
  if (!supportedTalentreefHost(host)) {
    throw new Error(`TalentReef source URL redirected to unexpected host: ${finalUrl}`);
  }
}

function assertTalentreefApiHost(urlString, fallbackUrl) {
  const finalUrl = clean(urlString || fallbackUrl);
  const parsed = parseUrl(finalUrl);
  const host = String(parsed?.hostname || "").toLowerCase();
  if (!supportedTalentreefApiHost(host)) {
    throw new Error(`TalentReef API URL redirected to unexpected host: ${finalUrl}`);
  }
}

function buildCompanyContext(company = {}) {
  return {
    ...company,
    company_name: clean(company.company_name || company.companyName || company.name),
    url_string: clean(company.url_string || company.company_url || company.url),
    ATS_name: clean(company.ATS_name || company.ats_key || "talentreef")
  };
}

function createDiscover(parserVersion = TALENTREEF_PARSER_VERSION) {
  return function discover(company = {}) {
    const context = buildCompanyContext(company);
    const config = parseTalentreefCompany(context.url_string) || {};
    return {
      ats_key: "talentreef",
      source_family: TALENTREEF_SOURCE_FAMILY,
      docs_url: TALENTREEF_DOCS_URL,
      company: context,
      list_url: clean(config.boardUrl || context.url_string),
      config,
      parser_version: clean(parserVersion) || TALENTREEF_PARSER_VERSION
    };
  };
}

module.exports = {
  TALENTREEF_ALIAS_API_URL,
  TALENTREEF_DOCS_URL,
  TALENTREEF_PARSER_VERSION,
  TALENTREEF_SEARCH_API_URL,
  TALENTREEF_SOURCE_FAMILY,
  assertTalentreefApiHost,
  assertTalentreefHost,
  buildCompanyContext,
  clean,
  createDiscover,
  parseTalentreefCompany,
  parseUrl,
  supportedTalentreefHost,
  supportedTalentreefApiHost
};
