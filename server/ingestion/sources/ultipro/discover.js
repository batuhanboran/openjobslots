const ULTIPRO_DOCS_URL = "observed UKG/UltiPro public JobBoard LoadSearchResults endpoint";
const ULTIPRO_SOURCE_FAMILY = "enterprise_api";
const ULTIPRO_PARSER_VERSION = "source-ultipro-v1";

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

function parseUltiProCompany(urlString) {
  const parsed = parseUrl(urlString);
  if (!parsed) return null;

  const host = String(parsed.hostname || "").toLowerCase();
  if (host !== "recruiting.ultipro.com") return null;

  const pathParts = parsed.pathname
    .split("/")
    .map((part) => clean(part))
    .filter(Boolean);
  const jobBoardIndex = pathParts.findIndex((part) => part.toLowerCase() === "jobboard");
  if (jobBoardIndex <= 0 || jobBoardIndex + 1 >= pathParts.length) return null;

  const tenant = pathParts[jobBoardIndex - 1];
  const boardId = pathParts[jobBoardIndex + 1];
  if (!tenant || !boardId) return null;

  const tenantEncoded = encodeURIComponent(tenant);
  const boardIdEncoded = encodeURIComponent(boardId);
  const baseBoardUrl = `${parsed.protocol}//${parsed.host}/${tenantEncoded}/JobBoard/${boardIdEncoded}`;
  return {
    host,
    tenant,
    tenantLower: tenant.toLowerCase(),
    boardId,
    baseBoardUrl,
    apiUrl: `${baseBoardUrl}/JobBoardView/LoadSearchResults`
  };
}

function buildCompanyContext(company = {}) {
  return {
    ...company,
    company_name: clean(company.company_name || company.companyName || company.name),
    url_string: clean(company.url_string || company.company_url || company.url),
    ATS_name: clean(company.ATS_name || company.ats_key || "ultipro")
  };
}

function createDiscover() {
  return function discover(company = {}) {
    const context = buildCompanyContext(company);
    const config = parseUltiProCompany(context.url_string) || {};
    return {
      ats_key: "ultipro",
      source_family: ULTIPRO_SOURCE_FAMILY,
      docs_url: ULTIPRO_DOCS_URL,
      company: context,
      list_url: clean(config.apiUrl),
      config,
      parser_version: ULTIPRO_PARSER_VERSION
    };
  };
}

module.exports = {
  ULTIPRO_DOCS_URL,
  ULTIPRO_PARSER_VERSION,
  ULTIPRO_SOURCE_FAMILY,
  buildCompanyContext,
  clean,
  createDiscover,
  parseUltiProCompany
};
