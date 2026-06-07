"use strict";

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

function normalizeSubdomain(value) {
  return clean(value)
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function extractWorkableConfig(value) {
  const parsed = parseUrl(value);
  if (!parsed) return {};
  const host = parsed.hostname.toLowerCase();
  const parts = host.split(".");
  let subdomain = "";
  if (host.endsWith(".workable.com") && parts.length >= 3 && parts[0] !== "www") {
    subdomain = normalizeSubdomain(parts[0]);
  } else if (host === "apply.workable.com") {
    const pathParts = parsed.pathname.split("/").filter(Boolean);
    subdomain = normalizeSubdomain(pathParts[0] || "");
  } else if (host === "www.workable.com") {
    const pathParts = parsed.pathname.split("/").filter(Boolean);
    const accountsIndex = pathParts.findIndex((part) => part === "accounts");
    if (accountsIndex >= 0) subdomain = normalizeSubdomain(pathParts[accountsIndex + 1] || "");
  }
  if (!subdomain) return {};
  return {
    subdomain,
    subdomainLower: subdomain,
    apiUrl: `https://www.workable.com/api/accounts/${encodeURIComponent(subdomain)}?details=true`,
    locationsUrl: `https://www.workable.com/api/accounts/${encodeURIComponent(subdomain)}/locations`,
    departmentsUrl: `https://www.workable.com/api/accounts/${encodeURIComponent(subdomain)}/departments`,
    boardUrl: `https://${subdomain}.workable.com/`
  };
}

function discover(company = {}) {
  const config = extractWorkableConfig(company.url_string || company.company_url || company.url);
  return {
    ats_key: "workable",
    source_family: "direct_json",
    list_url: clean(config.apiUrl),
    config,
    parser_version: "source-workable-v1"
  };
}

module.exports = {
  clean,
  discover,
  extractWorkableConfig
};
