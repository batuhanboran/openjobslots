"use strict";

const GREENHOUSE_API_URL_BASE = "https://boards-api.greenhouse.io/v1/boards";
const GREENHOUSE_DOCS_URL = "https://developers.greenhouse.io/job-board.html";
const GREENHOUSE_SOURCE_FAMILY = "direct-json-stable";

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

function buildCompanyContext(company = {}) {
  return {
    ...company,
    company_name: clean(company.company_name || company.companyName || company.name),
    url_string: clean(company.url_string || company.company_url || company.url),
    ATS_name: clean(company.ATS_name || company.ats_key || "greenhouse")
  };
}

function parseGreenhouseCompany(urlString) {
  const parsed = parseUrl(urlString);
  if (!parsed) return null;

  const [boardToken = ""] = String(parsed.pathname || "")
    .split("/")
    .map((part) => {
      try {
        return clean(decodeURIComponent(part));
      } catch {
        return clean(part);
      }
    })
    .filter(Boolean);
  if (!boardToken) return null;

  return {
    boardToken,
    boardTokenLower: boardToken.toLowerCase()
  };
}

function greenhouseListUrl(config = {}) {
  const boardToken = clean(config.boardToken);
  return boardToken ? `${GREENHOUSE_API_URL_BASE}/${encodeURIComponent(boardToken)}/jobs?content=true` : "";
}

function createDiscover(parserVersion = "source-greenhouse-v1") {
  return function discover(company = {}) {
    const context = buildCompanyContext(company);
    const config = parseGreenhouseCompany(context.url_string) || {};

    return {
      ats_key: "greenhouse",
      source_family: GREENHOUSE_SOURCE_FAMILY,
      docs_url: GREENHOUSE_DOCS_URL,
      company: context,
      list_url: greenhouseListUrl(config),
      config,
      parser_version: clean(parserVersion)
    };
  };
}

module.exports = {
  GREENHOUSE_API_URL_BASE,
  GREENHOUSE_DOCS_URL,
  GREENHOUSE_SOURCE_FAMILY,
  clean,
  buildCompanyContext,
  parseGreenhouseCompany,
  greenhouseListUrl,
  createDiscover,
  parseUrl
};
