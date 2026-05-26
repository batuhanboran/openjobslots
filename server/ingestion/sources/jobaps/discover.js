const JOBAPS_DOCS_URL = "observed JobApsCloud public careers HTML";
const JOBAPS_SOURCE_FAMILY = "public_sector";
const JOBAPS_PARSER_VERSION = "source-jobaps-v1";

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

function supportedJobApsHost(host) {
  const normalized = clean(host).toLowerCase();
  return normalized.endsWith(".jobapscloud.com");
}

function parseJobApsCompany(urlString) {
  const parsed = parseUrl(urlString);
  if (!parsed) return null;

  const host = clean(parsed.hostname).toLowerCase();
  if (!supportedJobApsHost(host)) return null;

  const pathParts = parsed.pathname
    .split("/")
    .map((part) => clean(part))
    .filter(Boolean);
  const hostPrefix = clean(host.split(".")[0]).toLowerCase();
  const tenantToken = hostPrefix && hostPrefix !== "www"
    ? hostPrefix
    : clean(pathParts[0]).toLowerCase();
  if (!tenantToken) return null;

  parsed.hash = "";
  return {
    host,
    hostPrefix,
    tenantToken,
    tenantTokenLower: tenantToken.toLowerCase(),
    baseOrigin: `${parsed.protocol}//${parsed.host}`,
    boardUrl: parsed.toString()
  };
}

function buildCompanyContext(company = {}) {
  return {
    ...company,
    company_name: clean(company.company_name || company.companyName || company.name),
    url_string: clean(company.url_string || company.company_url || company.url),
    ATS_name: clean(company.ATS_name || company.ats_key || "jobaps")
  };
}

function createDiscover() {
  return function discover(company = {}) {
    const context = buildCompanyContext(company);
    const config = parseJobApsCompany(context.url_string) || {};
    return {
      ats_key: "jobaps",
      source_family: JOBAPS_SOURCE_FAMILY,
      docs_url: JOBAPS_DOCS_URL,
      company: context,
      list_url: clean(config.boardUrl),
      config,
      parser_version: JOBAPS_PARSER_VERSION
    };
  };
}

module.exports = {
  JOBAPS_DOCS_URL,
  JOBAPS_PARSER_VERSION,
  JOBAPS_SOURCE_FAMILY,
  buildCompanyContext,
  clean,
  createDiscover,
  parseJobApsCompany,
  supportedJobApsHost
};
