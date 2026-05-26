"use strict";

const PAGEUP_DOCS_URL = "observed PageUp public job listing pages";
const PAGEUP_SOURCE_FAMILY = "html_detail";

function clean(value) {
  return String(value || "").trim();
}

function parseUrl(urlString) {
  const candidate = clean(urlString);
  if (!candidate) return null;
  try {
    return new URL(candidate);
  } catch {
    return null;
  }
}

function supportedPageupHost(hostValue) {
  const host = clean(hostValue).toLowerCase();
  return host === "careers.pageuppeople.com" || host === "www.careers.pageuppeople.com";
}

function extractPageupRouteConfigFromUrl(urlString, fallbackRouteType = "cw", fallbackLocale = "en-us") {
  const parsed = parseUrl(urlString);
  const pathParts = String(parsed?.pathname || "")
    .split("/")
    .map((part) => clean(part))
    .filter(Boolean);

  let routeType = clean(fallbackRouteType).toLowerCase() || "cw";
  let locale = clean(fallbackLocale).toLowerCase() || "en-us";

  if (pathParts.length >= 3) {
    const maybeRouteType = clean(pathParts[1]).toLowerCase();
    const maybeLocale = clean(pathParts[2]).toLowerCase();
    if (maybeRouteType === "cw" || maybeRouteType === "ci") routeType = maybeRouteType;
    if (/^[a-z]{2}(?:-[a-z]{2})$/i.test(maybeLocale)) locale = maybeLocale;
  }

  return {
    routeType,
    locale
  };
}

function parsePageupCompany(urlString) {
  const parsed = parseUrl(urlString);
  if (!parsed) return null;

  const host = clean(parsed.hostname).toLowerCase();
  if (!supportedPageupHost(host)) return null;

  const pathParts = String(parsed.pathname || "")
    .split("/")
    .map((part) => clean(part))
    .filter(Boolean);
  if (pathParts.length === 0) return null;

  const boardId = clean(pathParts[0]).replace(/[^A-Za-z0-9_-]/g, "");
  if (!boardId) return null;

  const baseOrigin = `${parsed.protocol}//${parsed.host}`;
  const route = extractPageupRouteConfigFromUrl(urlString);
  const encodedBoardId = encodeURIComponent(boardId);

  return {
    host,
    boardId,
    routeType: route.routeType,
    locale: route.locale,
    baseOrigin,
    boardUrl: `${baseOrigin}/${encodedBoardId}`,
    searchUrl: `${baseOrigin}/${encodedBoardId}/${route.routeType}/${route.locale}/search/`
  };
}

function buildCompanyContext(company = {}) {
  return {
    ...company,
    company_name: clean(company.company_name || company.companyName || company.name),
    url_string: clean(company.url_string || company.company_url || company.url),
    ATS_name: clean(company.ATS_name || company.ats_key || "pageup")
  };
}

function createDiscover(parserVersion) {
  return function discover(company = {}) {
    const context = buildCompanyContext(company);
    const config = parsePageupCompany(context.url_string) || {};
    return {
      ats_key: "pageup",
      source_family: PAGEUP_SOURCE_FAMILY,
      docs_url: PAGEUP_DOCS_URL,
      company: context,
      list_url: clean(config.boardUrl || context.url_string),
      config,
      parser_version: clean(parserVersion) || "source-pageup-v1"
    };
  };
}

module.exports = {
  PAGEUP_DOCS_URL,
  PAGEUP_SOURCE_FAMILY,
  buildCompanyContext,
  clean,
  createDiscover,
  extractPageupRouteConfigFromUrl,
  parsePageupCompany,
  supportedPageupHost
};
