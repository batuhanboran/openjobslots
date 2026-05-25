const RIPPLING_DOCS_URL = "observed Rippling public board JSON endpoint";
const RIPPLING_SOURCE_FAMILY = "direct_json";

function clean(value) {
  return String(value || "").trim();
}

function parseUrl(urlString) {
  if (!urlString) return null;
  try {
    return new URL(urlString);
  } catch {
    return null;
  }
}

function parseRipplingCompany(urlString) {
  const parsed = parseUrl(urlString);
  if (!parsed) return null;

  const host = String(parsed.hostname || "").toLowerCase();
  if (host !== "ats.rippling.com") return null;

  const pathParts = parsed.pathname
    .split("/")
    .map((part) => clean(part))
    .filter(Boolean);

  let companySlug = "";
  if (String(pathParts[0] || "").toLowerCase() === "api") {
    const boardIndex = pathParts.findIndex((part) => part.toLowerCase() === "board");
    companySlug = boardIndex >= 0 ? clean(pathParts[boardIndex + 1]) : "";
  } else {
    companySlug = clean(pathParts[0]);
  }

  if (!companySlug) return null;

  return {
    host,
    companySlug,
    companySlugLower: companySlug.toLowerCase(),
    boardUrl: `https://ats.rippling.com/${companySlug}/jobs`,
    apiUrl: `https://ats.rippling.com/api/v2/board/${companySlug}/jobs`
  };
}

function buildCompanyContext(company = {}) {
  return {
    ...company,
    company_name: clean(company.company_name || company.companyName || company.name),
    url_string: clean(company.url_string || company.company_url || company.url),
    ATS_name: clean(company.ATS_name || company.ats_key || "rippling")
  };
}

function createDiscover() {
  return function discover(company = {}) {
    const context = buildCompanyContext(company);
    const config = parseRipplingCompany(context.url_string) || {};
    return {
      ats_key: "rippling",
      source_family: RIPPLING_SOURCE_FAMILY,
      docs_url: RIPPLING_DOCS_URL,
      company: context,
      list_url: clean(config.apiUrl),
      config,
      parser_version: "source-rippling-v1"
    };
  };
}

module.exports = {
  RIPPLING_DOCS_URL,
  RIPPLING_SOURCE_FAMILY,
  buildCompanyContext,
  clean,
  createDiscover,
  parseRipplingCompany
};
