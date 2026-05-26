"use strict";

const SMARTRECRUITERS_DOCS_URL = "https://developers.smartrecruiters.com/docs/endpoints";
const SMARTRECRUITERS_SEARCH_URL = "https://jobs.smartrecruiters.com/sr-jobs/search";

function clean(value) {
  return String(value || "").trim();
}

function asUrl(urlString) {
  try {
    return new URL(clean(urlString));
  } catch {
    return null;
  }
}

function parseSmartRecruitersCompany(urlString) {
  const parsed = asUrl(urlString);
  if (!parsed) return null;

  const host = String(parsed.hostname || "").toLowerCase();
  if (host !== "jobs.smartrecruiters.com" && host !== "www.jobs.smartrecruiters.com") return null;

  const pathParts = parsed.pathname
    .split("/")
    .map((part) => clean(part))
    .filter(Boolean);
  const queryCompany = clean(parsed.searchParams.get("company"));
  const companySlug = queryCompany || (pathParts[0]?.toLowerCase() === "sr-jobs" ? "" : pathParts[0] || "");
  if (!companySlug) return null;

  const searchUrl = new URL(SMARTRECRUITERS_SEARCH_URL);
  searchUrl.searchParams.set("company", companySlug);
  searchUrl.searchParams.set("limit", "100");

  return {
    host,
    companySlug,
    companySlugLower: companySlug.toLowerCase(),
    searchUrl: searchUrl.toString()
  };
}

function createDiscover(parserVersion) {
  return function discover(company = {}) {
    const config = parseSmartRecruitersCompany(company.url_string || company.company_url || company.url) || {};
    return {
      ats_key: "smartrecruiters",
      source_family: "direct_json",
      docs_url: SMARTRECRUITERS_DOCS_URL,
      company,
      list_url: config.searchUrl || "",
      config,
      parser_version: parserVersion
    };
  };
}

module.exports = {
  SMARTRECRUITERS_DOCS_URL,
  SMARTRECRUITERS_SEARCH_URL,
  createDiscover,
  parseSmartRecruitersCompany
};
