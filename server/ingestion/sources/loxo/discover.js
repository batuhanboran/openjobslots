const LOXO_DOCS_URL = "observed Loxo public jobs HTML";
const LOXO_SOURCE_FAMILY = "html_detail";
const LOXO_PARSER_VERSION = "source-loxo-v1";

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

function supportedLoxoHost(host) {
  return host === "app.loxo.co" || host === "www.app.loxo.co";
}

function parseLoxoCompany(urlString) {
  const parsed = parseUrl(urlString);
  if (!parsed) return null;

  const host = String(parsed.hostname || "").toLowerCase();
  if (!supportedLoxoHost(host)) return null;

  const pathParts = parsed.pathname
    .split("/")
    .map((part) => clean(part))
    .filter(Boolean);
  if (pathParts.length === 0) return null;
  if (String(pathParts[0] || "").toLowerCase() === "job") return null;

  const companySlug = clean(pathParts[0]);
  if (!companySlug) return null;

  const boardUrl = new URL(`${parsed.protocol}//${parsed.host}/${encodeURIComponent(companySlug)}`);
  return {
    host,
    boardSlug: companySlug,
    boardSlugLower: companySlug.toLowerCase(),
    companySlug,
    companySlugLower: companySlug.toLowerCase(),
    baseOrigin: `${parsed.protocol}//${parsed.host}`,
    boardUrl: boardUrl.toString()
  };
}

function buildCompanyContext(company = {}) {
  return {
    ...company,
    company_name: clean(company.company_name || company.companyName || company.name),
    url_string: clean(company.url_string || company.company_url || company.url),
    ATS_name: clean(company.ATS_name || company.ats_key || "loxo")
  };
}

function createDiscover() {
  return function discover(company = {}) {
    const context = buildCompanyContext(company);
    const config = parseLoxoCompany(context.url_string) || {};
    return {
      ats_key: "loxo",
      source_family: LOXO_SOURCE_FAMILY,
      docs_url: LOXO_DOCS_URL,
      company: context,
      list_url: clean(config.boardUrl),
      config,
      parser_version: LOXO_PARSER_VERSION
    };
  };
}

module.exports = {
  LOXO_DOCS_URL,
  LOXO_PARSER_VERSION,
  LOXO_SOURCE_FAMILY,
  buildCompanyContext,
  clean,
  createDiscover,
  parseLoxoCompany,
  supportedLoxoHost
};
