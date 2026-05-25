const ISOLVISOLVEDHIRE_DOCS_URL = "observed isolvedhire public jobs endpoint";
const ISOLVISOLVEDHIRE_SOURCE_FAMILY = "direct_json";
const ISOLVISOLVEDHIRE_PARSER_VERSION = "source-isolvisolvedhire-v1";

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
    ATS_name: clean(company.ATS_name || company.ats_key || "isolvisolvedhire")
  };
}

function parseIsolvisolvedhireCompany(urlString) {
  const parsed = parseUrl(urlString);
  if (!parsed) return null;

  const host = String(parsed.hostname || "").toLowerCase();
  if (!host.endsWith(".isolvedhire.com")) return null;
  if (host === "isolvedhire.com" || host === "www.isolvedhire.com") return null;

  const baseOrigin = `${parsed.protocol}//${parsed.host}`;
  const tenant = clean(host.replace(/\.isolvedhire\.com$/i, ""));
  const boardUrl = clean(urlString);
  return {
    host,
    tenant,
    tenantLower: tenant.toLowerCase(),
    baseOrigin,
    boardUrl
  };
}

function createDiscover() {
  return function discover(company = {}) {
    const context = buildCompanyContext(company);
    const config = parseIsolvisolvedhireCompany(context.url_string) || {};
    return {
      ats_key: "isolvisolvedhire",
      source_family: ISOLVISOLVEDHIRE_SOURCE_FAMILY,
      docs_url: ISOLVISOLVEDHIRE_DOCS_URL,
      company: context,
      list_url: clean(config.boardUrl),
      config,
      parser_version: ISOLVISOLVEDHIRE_PARSER_VERSION
    };
  };
}

module.exports = {
  ISOLVISOLVEDHIRE_DOCS_URL,
  ISOLVISOLVEDHIRE_PARSER_VERSION,
  ISOLVISOLVEDHIRE_SOURCE_FAMILY,
  buildCompanyContext,
  clean,
  createDiscover,
  parseIsolvisolvedhireCompany
};
