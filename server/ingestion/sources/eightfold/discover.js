"use strict";

const EIGHTFOLD_DOCS_URL = "observed Eightfold careers HTML plus search API";
const EIGHTFOLD_SOURCE_FAMILY = "enterprise_api";
const EIGHTFOLD_PARSER_VERSION = "source-eightfold-v1";

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

function supportedEightfoldHost(hostname) {
  const host = clean(hostname).toLowerCase();
  return host === "eightfold.ai" || host === "www.eightfold.ai" || host.endsWith(".eightfold.ai");
}

function assertEightfoldFinalHost(finalUrl, fallbackUrl) {
  const value = clean(finalUrl || fallbackUrl);
  const parsed = parseUrl(value);
  const host = String(parsed?.hostname || "").toLowerCase();
  if (parsed && supportedEightfoldHost(host)) return;
  throw new Error(`Eightfold URL redirected to unexpected host: ${value}`);
}

function buildCompanyContext(company = {}) {
  return {
    ...company,
    company_name: clean(company.company_name || company.companyName || company.name),
    url_string: clean(company.url_string || company.company_url || company.url),
    ATS_name: clean(company.ATS_name || company.ats_key || "eightfold")
  };
}

function parseEightfoldCompany(urlString) {
  const parsed = parseUrl(urlString);
  if (!parsed) return null;

  const host = String(parsed.hostname || "").toLowerCase();
  if (!supportedEightfoldHost(host)) return null;

  const pathParts = String(parsed.pathname || "")
    .split("/")
    .map((part) => clean(part))
    .filter(Boolean);
  if (pathParts.length === 0 || pathParts[0].toLowerCase() !== "careers") return null;

  const siteBaseUrl = `${parsed.protocol}//${parsed.host}`;
  return {
    host,
    siteBaseUrl,
    boardUrl: `${siteBaseUrl}/careers`
  };
}

function createDiscover(parserVersion = EIGHTFOLD_PARSER_VERSION) {
  return function discover(company = {}) {
    const context = buildCompanyContext(company);
    const config = parseEightfoldCompany(context.url_string) || {};
    return {
      ats_key: "eightfold",
      source_family: EIGHTFOLD_SOURCE_FAMILY,
      docs_url: EIGHTFOLD_DOCS_URL,
      company: context,
      list_url: clean(config.boardUrl || context.url_string),
      config,
      parser_version: clean(parserVersion) || EIGHTFOLD_PARSER_VERSION
    };
  };
}

module.exports = {
  EIGHTFOLD_DOCS_URL,
  EIGHTFOLD_PARSER_VERSION,
  EIGHTFOLD_SOURCE_FAMILY,
  assertEightfoldFinalHost,
  buildCompanyContext,
  clean,
  createDiscover,
  parseEightfoldCompany,
  parseUrl,
  supportedEightfoldHost
};
