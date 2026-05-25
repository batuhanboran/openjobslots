const {
  asUrl,
  buildCompanyContext,
  clean
} = require("./helpers");

const BREEZY_SOURCE_FAMILY = "html_detail";

function parseBreezyCompany(urlString) {
  const parsed = asUrl(urlString);
  if (!parsed) return null;

  const host = String(parsed.hostname || "").toLowerCase();
  if (host === "breezy.hr" || host === "www.breezy.hr") return null;
  if (!host.endsWith(".breezy.hr")) return null;

  const [subdomain = ""] = host.split(".");
  if (!subdomain) return null;

  return {
    host,
    subdomain,
    subdomainLower: subdomain.toLowerCase(),
    origin: `${parsed.protocol}//${parsed.host}`,
    portalUrl: `${parsed.protocol}//${parsed.host}/`
  };
}

function createDiscover(parserVersion) {
  return function discover(company = {}) {
    const context = buildCompanyContext(company);
    const config = parseBreezyCompany(context.url_string);
    return {
      ats_key: "breezy",
      source_family: BREEZY_SOURCE_FAMILY,
      docs_url: "observed Breezy public portal HTML",
      company: context,
      list_url: clean(config?.portalUrl || context.url_string),
      config: config || {
        origin: asUrl(context.url_string)?.origin || ""
      },
      parser_version: parserVersion
    };
  };
}

module.exports = {
  BREEZY_SOURCE_FAMILY,
  createDiscover,
  parseBreezyCompany
};
