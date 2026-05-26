"use strict";

const PAYLOCITY_DOCS_URL = "observed Paylocity public recruiting page data";
const PAYLOCITY_SOURCE_FAMILY = "enterprise_api";

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

function parsePaylocityCompany(urlString) {
  const parsed = parseUrl(urlString);
  if (!parsed) return null;

  const host = String(parsed.hostname || "").toLowerCase();
  if (host !== "recruiting.paylocity.com" && host !== "www.recruiting.paylocity.com") return null;

  const pathParts = String(parsed.pathname || "")
    .split("/")
    .map((part) => String(part || "").trim())
    .filter(Boolean);

  if (pathParts.length < 4) return null;
  if (pathParts[0].toLowerCase() !== "recruiting" || pathParts[1].toLowerCase() !== "jobs") return null;

  const listingSegment = String(pathParts[2] || "All").trim();
  const companyId = String(pathParts[3] || "").trim();
  if (!companyId) return null;

  const rawCompanySlug = String(pathParts[4] || "").trim();

  const safeListing = listingSegment ? listingSegment.replace(/[^A-Za-z0-9_-]/g, "") || "All" : "All";
  const safeCompanyId = companyId.replace(/[^A-Za-z0-9-]/g, "");
  if (!safeCompanyId) return null;
  const safeCompanySlug = rawCompanySlug
    ? rawCompanySlug.replace(/[^A-Za-z0-9-_.]/g, "")
    : "";

  const siteBaseUrl = `${parsed.protocol}//${parsed.host}`;
  const boardUrl =
    `${siteBaseUrl}/recruiting/jobs/${encodeURIComponent(safeListing)}` +
    `/${encodeURIComponent(safeCompanyId)}` +
    (safeCompanySlug ? `/${encodeURIComponent(safeCompanySlug)}` : "");

  return {
    host,
    siteBaseUrl,
    listingSegment: safeListing,
    listingSegmentLower: safeListing.toLowerCase(),
    companyId: safeCompanyId,
    companySlug: safeCompanySlug || undefined,
    companySlugLower: safeCompanySlug ? safeCompanySlug.toLowerCase() : undefined,
    boardUrl
  };
}

function createDiscover(parserVersion) {
  return function discover(company = {}) {
    const context = {
      ...company,
      company_name: clean(company.company_name || company.companyName || company.name),
      url_string: clean(company.url_string || company.company_url || company.url)
    };
    const config = parsePaylocityCompany(context.url_string) || {};

    return {
      ats_key: "paylocity",
      source_family: PAYLOCITY_SOURCE_FAMILY,
      docs_url: PAYLOCITY_DOCS_URL,
      company: context,
      list_url: clean(config.boardUrl || context.url_string),
      config,
      parser_version: clean(parserVersion) || "source-paylocity-v1"
    };
  };
}

module.exports = {
  PAYLOCITY_DOCS_URL,
  PAYLOCITY_SOURCE_FAMILY,
  clean,
  createDiscover,
  parsePaylocityCompany
};
