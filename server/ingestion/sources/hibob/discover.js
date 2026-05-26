const HIBOB_DOCS_URL = "observed HiBob careers board plus job-ad API";
const HIBOB_SOURCE_FAMILY = "html_detail";
const HIBOB_PARSER_VERSION = "source-hibob-v1";

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

function supportedHibobHost(host) {
  const normalized = clean(host).toLowerCase();
  return (
    normalized.endsWith(".careers.hibob.com") &&
    normalized !== "careers.hibob.com" &&
    normalized !== "www.careers.hibob.com"
  );
}

function parseHibobCompany(urlString) {
  const parsed = parseUrl(urlString);
  if (!parsed || !parsed.protocol || !parsed.host) {
    return { error: "invalid_hibob_url" };
  }

  const host = clean(parsed.hostname).toLowerCase();
  if (!supportedHibobHost(host)) {
    return { error: "unsupported_hibob_host" };
  }

  const companySubdomain = host.replace(".careers.hibob.com", "").trim();
  if (!companySubdomain) {
    return { error: "unsupported_hibob_host" };
  }

  const baseOrigin = `${parsed.protocol}//${parsed.host}`;
  return {
    host,
    companySubdomain,
    companySubdomainLower: companySubdomain.toLowerCase(),
    baseOrigin,
    boardUrl: `${baseOrigin}/jobs`,
    apiUrl: `${baseOrigin}/api/job-ad`
  };
}

function buildCompanyContext(company = {}) {
  return {
    ...company,
    company_name: clean(company.company_name || company.companyName || company.name),
    url_string: clean(company.url_string || company.company_url || company.url),
    ATS_name: clean(company.ATS_name || company.ats_key || "hibob")
  };
}

function createDiscover() {
  return function discover(company = {}) {
    const context = buildCompanyContext(company);
    const config = parseHibobCompany(context.url_string);
    return {
      ats_key: "hibob",
      source_family: HIBOB_SOURCE_FAMILY,
      docs_url: HIBOB_DOCS_URL,
      company: context,
      list_url: clean(config.apiUrl),
      config,
      parser_version: HIBOB_PARSER_VERSION
    };
  };
}

module.exports = {
  HIBOB_DOCS_URL,
  HIBOB_PARSER_VERSION,
  HIBOB_SOURCE_FAMILY,
  buildCompanyContext,
  clean,
  createDiscover,
  parseHibobCompany,
  supportedHibobHost
};
