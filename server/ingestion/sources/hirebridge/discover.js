const HIREBRIDGE_DOCS_URL = "observed HireBridge public list HTML and detail pages";
const HIREBRIDGE_SOURCE_FAMILY = "html_detail";

function clean(value) {
  return String(value || "").trim();
}

function parseUrl(value) {
  const url = clean(value);
  if (!url) return null;
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

function supportedHirebridgeHost(hostValue) {
  const host = clean(hostValue).toLowerCase();
  return host === "recruit.hirebridge.com" || host === "www.recruit.hirebridge.com";
}

function parseHirebridgeCompany(urlString) {
  const parsed = parseUrl(urlString);
  if (!parsed) return null;

  const host = clean(parsed.hostname).toLowerCase();
  if (!supportedHirebridgeHost(host)) return null;

  const cid = clean(parsed.searchParams.get("cid"));
  if (!cid) return null;

  const baseOrigin = `${parsed.protocol}//${parsed.host}`;
  return {
    host,
    cid,
    baseOrigin,
    boardUrl: `${baseOrigin}/v3/jobs/list.aspx?cid=${encodeURIComponent(cid)}`,
    detailsBaseUrl: `${baseOrigin}/v3/CareerCenter/v2/details.aspx`
  };
}

function buildCompanyContext(company = {}) {
  return {
    ...company,
    company_name: clean(company.company_name || company.companyName || company.name),
    url_string: clean(company.url_string || company.company_url || company.url),
    ATS_name: clean(company.ATS_name || company.ats_key || "hirebridge")
  };
}

function createDiscover(parserVersion) {
  return function discover(company = {}) {
    const context = buildCompanyContext(company);
    const config = parseHirebridgeCompany(context.url_string) || {};
    return {
      ats_key: "hirebridge",
      source_family: HIREBRIDGE_SOURCE_FAMILY,
      docs_url: HIREBRIDGE_DOCS_URL,
      company: context,
      list_url: clean(config.boardUrl || context.url_string),
      config,
      parser_version: clean(parserVersion) || "source-hirebridge-v1"
    };
  };
}

module.exports = {
  HIREBRIDGE_DOCS_URL,
  HIREBRIDGE_SOURCE_FAMILY,
  buildCompanyContext,
  clean,
  createDiscover,
  parseHirebridgeCompany,
  supportedHirebridgeHost
};
