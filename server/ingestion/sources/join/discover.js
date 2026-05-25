const JOIN_DOCS_URL = "observed Join public company Next.js page";
const JOIN_SOURCE_FAMILY = "embedded_json";

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

function parseJoinCompany(urlString) {
  const parsed = parseUrl(urlString);
  if (!parsed) return null;

  const host = String(parsed.hostname || "").toLowerCase();
  if (host !== "join.com" && host !== "www.join.com") return null;

  const pathParts = parsed.pathname
    .split("/")
    .map((part) => clean(part))
    .filter(Boolean);
  if (pathParts.length < 2 || String(pathParts[0] || "").toLowerCase() !== "companies") return null;

  const companySlug = pathParts[1];
  if (!companySlug) return null;

  return {
    host,
    companySlug,
    companySlugLower: companySlug.toLowerCase(),
    boardUrl: `${parsed.protocol}//${parsed.host}/companies/${companySlug}`
  };
}

function buildCompanyContext(company = {}) {
  return {
    ...company,
    company_name: clean(company.company_name || company.companyName || company.name),
    url_string: clean(company.url_string || company.company_url || company.url),
    ATS_name: clean(company.ATS_name || company.ats_key || "join")
  };
}

function createDiscover() {
  return function discover(company = {}) {
    const context = buildCompanyContext(company);
    const config = parseJoinCompany(context.url_string) || {};
    return {
      ats_key: "join",
      source_family: JOIN_SOURCE_FAMILY,
      docs_url: JOIN_DOCS_URL,
      company: context,
      list_url: clean(config.boardUrl),
      config,
      parser_version: "source-join-v1"
    };
  };
}

module.exports = {
  JOIN_DOCS_URL,
  JOIN_SOURCE_FAMILY,
  buildCompanyContext,
  clean,
  createDiscover,
  parseJoinCompany
};
