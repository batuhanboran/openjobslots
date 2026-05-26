"use strict";

const SIMPLICANT_SOURCE_FAMILY = "html_detail";
const BLOCKED_SIMPLICANT_HOSTS = Object.freeze(new Set([
  "simplicant.com",
  "www.simplicant.com",
  "assets.simplicant.com",
  "app.simplicant.com",
  "jobs.simplicant.com"
]));

function clean(value) {
  return String(value || "").trim();
}

function parseUrl(urlString) {
  const raw = clean(urlString);
  if (!raw) return null;
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

function supportedSimplicantHost(hostname) {
  const host = clean(hostname).toLowerCase();
  return host.endsWith(".simplicant.com") && !BLOCKED_SIMPLICANT_HOSTS.has(host);
}

function parseSimplicantCompany(urlString) {
  const parsed = parseUrl(urlString);
  if (!parsed) return null;

  const host = String(parsed.hostname || "").toLowerCase();
  if (!supportedSimplicantHost(host)) return null;

  const [subdomain = ""] = host.split(".");
  if (!subdomain) return null;

  const pathParts = parsed.pathname
    .split("/")
    .map((part) => String(part || "").trim())
    .filter(Boolean);
  if (pathParts.length > 0 && !["jobs", "leads"].includes(String(pathParts[0] || "").toLowerCase())) return null;

  const baseOrigin = `${parsed.protocol}//${parsed.host}`;
  return {
    host,
    subdomain,
    subdomainLower: subdomain.toLowerCase(),
    baseOrigin,
    jobsUrl: `${baseOrigin}/`
  };
}

function buildCompanyContext(company = {}) {
  return {
    company_name: clean(company.company_name || company.companyName || company.name),
    url_string: clean(company.url_string || company.url || company.jobsUrl)
  };
}

function createDiscover() {
  return function discoverSimplicant(company = {}) {
    const context = buildCompanyContext(company);
    const config = parseSimplicantCompany(context.url_string);
    if (!config) {
      return {
        ats_key: "simplicant",
        source_family: SIMPLICANT_SOURCE_FAMILY,
        list_url: "",
        ok: false,
        reason: "unsupported_simplicant_url"
      };
    }
    return {
      ats_key: "simplicant",
      source_family: SIMPLICANT_SOURCE_FAMILY,
      list_url: config.jobsUrl,
      config
    };
  };
}

module.exports = {
  SIMPLICANT_SOURCE_FAMILY,
  buildCompanyContext,
  clean,
  createDiscover,
  parseSimplicantCompany,
  supportedSimplicantHost
};
