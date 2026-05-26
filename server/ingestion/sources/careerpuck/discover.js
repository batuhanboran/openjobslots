const CAREERPUCK_DOCS_URL = "observed CareerPuck public job board API";
const CAREERPUCK_SOURCE_FAMILY = "direct_json";
const CAREERPUCK_PARSER_VERSION = "source-careerpuck-v1";

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

function supportedCareerpuckBoardHost(host) {
  const normalized = clean(host).toLowerCase();
  return normalized === "app.careerpuck.com" || normalized === "www.app.careerpuck.com";
}

function supportedCareerpuckApiHost(host) {
  return clean(host).toLowerCase() === "api.careerpuck.com";
}

function parseCareerpuckCompany(urlString) {
  const parsed = parseUrl(urlString);
  if (!parsed) return null;

  const host = clean(parsed.hostname).toLowerCase();
  if (!supportedCareerpuckBoardHost(host)) return null;

  const pathParts = parsed.pathname
    .split("/")
    .map((part) => clean(part))
    .filter(Boolean);
  if (pathParts.length < 2 || pathParts[0].toLowerCase() !== "job-board") return null;

  const boardSlug = clean(pathParts[1]);
  if (!boardSlug) return null;

  return {
    host,
    boardSlug,
    boardSlugLower: boardSlug.toLowerCase(),
    boardUrl: `${parsed.protocol}//${parsed.host}/job-board/${boardSlug}`,
    apiUrl: `https://api.careerpuck.com/v1/public/job-boards/${encodeURIComponent(boardSlug)}`
  };
}

function buildCompanyContext(company = {}) {
  return {
    ...company,
    company_name: clean(company.company_name || company.companyName || company.name),
    url_string: clean(company.url_string || company.company_url || company.url),
    ATS_name: clean(company.ATS_name || company.ats_key || "careerpuck")
  };
}

function createDiscover() {
  return function discover(company = {}) {
    const context = buildCompanyContext(company);
    const config = parseCareerpuckCompany(context.url_string) || {};
    return {
      ats_key: "careerpuck",
      source_family: CAREERPUCK_SOURCE_FAMILY,
      docs_url: CAREERPUCK_DOCS_URL,
      company: context,
      list_url: clean(config.apiUrl),
      config,
      parser_version: CAREERPUCK_PARSER_VERSION
    };
  };
}

module.exports = {
  CAREERPUCK_DOCS_URL,
  CAREERPUCK_PARSER_VERSION,
  CAREERPUCK_SOURCE_FAMILY,
  buildCompanyContext,
  clean,
  createDiscover,
  parseCareerpuckCompany,
  supportedCareerpuckApiHost,
  supportedCareerpuckBoardHost
};
