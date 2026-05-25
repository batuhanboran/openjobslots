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

function parsePathParts(urlString) {
  const parsed = asUrl(urlString);
  if (!parsed) return [];
  return parsed.pathname.split("/").map((part) => part.trim()).filter(Boolean);
}

function parseRecruitCrmPublicCompany(urlString) {
  const parsed = asUrl(urlString);
  if (!parsed) return null;
  const host = String(parsed.hostname || "").toLowerCase();
  if (host !== "recruitcrm.io" && !host.endsWith(".recruitcrm.io")) return null;

  const pathParts = parsePathParts(urlString);
  let account = "";
  if (pathParts.length >= 2 && pathParts[0].toLowerCase() === "jobs") {
    account = pathParts[1];
  } else {
    account = clean(parsed.searchParams.get("account"));
  }
  if (!account) return null;

  return {
    account,
    publicJobsUrl: `https://recruitcrm.io/jobs/${encodeURIComponent(account)}`,
    apiUrl: `https://albatross.recruitcrm.io/v1/external-pages/jobs-by-account/get?account=${encodeURIComponent(account)}&batch=true`
  };
}

function createDiscover(parserVersion) {
  return function discover(company = {}) {
    const config = parseRecruitCrmPublicCompany(company.url_string || company.company_url || company.url) || {};
    return {
      ats_key: "recruitcrm",
      source_family: "direct_json",
      docs_url: "observed Recruit CRM public jobs endpoint",
      company,
      list_url: config.apiUrl || "",
      config,
      parser_version: parserVersion
    };
  };
}

module.exports = {
  createDiscover,
  parseRecruitCrmPublicCompany
};
