"use strict";

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

function parseFountainCompany(urlString) {
  const parsed = asUrl(urlString);
  if (!parsed) return null;

  const host = String(parsed.hostname || "").toLowerCase();
  if (host !== "web.fountain.com" && host !== "www.web.fountain.com") return null;

  const pathParts = parsed.pathname
    .replace(/\.json\/?$/i, "")
    .split("/")
    .map((part) => clean(part))
    .filter(Boolean);
  if (pathParts.length < 4 || pathParts[0].toLowerCase() !== "c") return null;

  const companySlug = clean(pathParts[1]);
  if (!companySlug) return null;

  const boardPath = pathParts.slice(0, 4).join("/");
  const boardUrl = `${parsed.protocol}//${parsed.host}/${boardPath}`;

  return {
    host,
    companySlug,
    companySlugLower: companySlug.toLowerCase(),
    boardUrl,
    apiUrl: `${boardUrl}.json`
  };
}

function createDiscover(parserVersion) {
  return function discover(company = {}) {
    const config = parseFountainCompany(company.url_string || company.company_url || company.url) || {};
    return {
      ats_key: "fountain",
      source_family: "direct_json",
      docs_url: "observed Fountain public openings JSON endpoint",
      company,
      list_url: config.apiUrl || "",
      config,
      parser_version: parserVersion
    };
  };
}

module.exports = {
  createDiscover,
  parseFountainCompany
};
