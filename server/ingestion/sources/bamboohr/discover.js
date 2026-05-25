const {
  asUrl,
  buildCompanyContext,
  clean
} = require("./helpers");

const BAMBOOHR_SOURCE_FAMILY = "direct_json";

function parseBambooHrCompany(urlString) {
  const parsed = asUrl(urlString);
  if (!parsed) return null;

  const host = String(parsed.hostname || "").toLowerCase();
  const suffix = ".bamboohr.com";
  if (!host.endsWith(suffix)) return null;

  const companySubdomain = clean(host.slice(0, -suffix.length));
  if (!companySubdomain || companySubdomain.includes(".") || companySubdomain === "www") return null;

  const pathParts = parsed.pathname
    .split("/")
    .map((part) => clean(part))
    .filter(Boolean);
  if (pathParts.length > 0 && String(pathParts[0] || "").toLowerCase() !== "careers") return null;

  const baseOrigin = `${parsed.protocol}//${parsed.host}`;
  return {
    host,
    companySubdomain,
    companySubdomainLower: companySubdomain.toLowerCase(),
    baseOrigin,
    boardUrl: `${baseOrigin}/careers`,
    apiUrl: `${baseOrigin}/careers/list`
  };
}

function createDiscover(parserVersion) {
  return function discover(company = {}) {
    const context = buildCompanyContext(company);
    const config = parseBambooHrCompany(context.url_string);
    const parsed = asUrl(context.url_string);
    const boardUrl = config?.boardUrl || clean(context.url_string).replace(/\/+$/, "");
    const listUrl = config?.apiUrl || (boardUrl ? `${boardUrl}/list` : "");
    return {
      ats_key: "bamboohr",
      source_family: BAMBOOHR_SOURCE_FAMILY,
      docs_url: "observed BambooHR public careers list JSON endpoint",
      company: context,
      list_url: listUrl,
      config: config || {
        baseOrigin: parsed ? parsed.origin : "",
        boardUrl,
        apiUrl: listUrl
      },
      parser_version: parserVersion
    };
  };
}

module.exports = {
  BAMBOOHR_SOURCE_FAMILY,
  createDiscover,
  parseBambooHrCompany
};
