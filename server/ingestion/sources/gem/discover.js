const GEM_DOCS_URL = "observed Gem GraphQL batch endpoint";
const GEM_SOURCE_FAMILY = "direct_json";
const GEM_API_URL = "https://jobs.gem.com/api/public/graphql/batch";

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

function parseGemPublicCompany(urlString) {
  const parsed = parseUrl(urlString);
  if (!parsed) return null;

  const host = String(parsed.hostname || "").toLowerCase();
  if (host !== "jobs.gem.com" && host !== "www.jobs.gem.com") return null;

  const pathParts = parsed.pathname
    .split("/")
    .map((part) => String(part || "").trim())
    .filter(Boolean);
  if (pathParts.length === 0) return null;

  const boardId = pathParts[0];
  if (!boardId) return null;

  return {
    host,
    boardId,
    boardIdLower: String(boardId).toLowerCase(),
    boardUrl: `${parsed.protocol}//${parsed.host}/${encodeURIComponent(boardId)}`,
    apiUrl: GEM_API_URL
  };
}

function buildCompanyContext(company = {}) {
  return {
    ...company,
    company_name: clean(company.company_name || company.companyName || company.name),
    url_string: clean(company.url_string || company.company_url || company.url),
    ATS_name: clean(company.ATS_name || company.ats_key || "gem")
  };
}

function createDiscover(parserVersion) {
  return function discover(company = {}) {
    const context = buildCompanyContext(company);
    const config = parseGemPublicCompany(context.url_string) || {};
    return {
      ats_key: "gem",
      source_family: GEM_SOURCE_FAMILY,
      docs_url: GEM_DOCS_URL,
      company: context,
      list_url: clean(config.apiUrl),
      config,
      parser_version: clean(parserVersion) || "source-gem-v1"
    };
  };
}

module.exports = {
  GEM_API_URL,
  GEM_DOCS_URL,
  GEM_SOURCE_FAMILY,
  clean,
  createDiscover,
  parseGemPublicCompany,
  buildCompanyContext
};
