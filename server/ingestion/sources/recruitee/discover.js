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

function parseRecruiteeCompany(urlString) {
  const parsed = asUrl(urlString);
  if (!parsed) return null;
  const host = String(parsed.hostname || "").toLowerCase();
  if (!host.endsWith(".recruitee.com")) return null;
  const subdomain = clean(host.split(".")[0]).toLowerCase();
  if (!subdomain) return null;

  const baseUrl = `${parsed.protocol}//${parsed.host}`.replace(/\/+$/, "");
  return {
    subdomain,
    baseUrl,
    apiUrl: `${baseUrl}/api/offers/`
  };
}

function createDiscover(parserVersion) {
  return function discover(company = {}) {
    const config = parseRecruiteeCompany(company.url_string || company.company_url || company.url) || {};
    return {
      ats_key: "recruitee",
      source_family: "direct_json",
      docs_url: "https://docs.recruitee.com/reference/intro-to-careers-site-api",
      company,
      list_url: config.apiUrl || "",
      config,
      parser_version: parserVersion
    };
  };
}

module.exports = {
  createDiscover,
  parseRecruiteeCompany
};
