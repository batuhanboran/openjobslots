const {
  asUrl,
  buildCompanyContext,
  clean
} = require("./helpers");

const APPLYTOJOB_SOURCE_FAMILY = "html_detail";

function parseApplyToJobCompany(urlString) {
  const parsed = asUrl(urlString);
  if (!parsed) return null;

  const host = String(parsed.hostname || "").toLowerCase();
  if (!host.endsWith(".applytojob.com")) return null;

  const [subdomain = ""] = host.split(".");
  if (!subdomain) return null;

  return {
    host,
    subdomain,
    subdomainLower: subdomain.toLowerCase(),
    baseOrigin: `${parsed.protocol}//${parsed.host}`,
    applyUrl: `${parsed.protocol}//${parsed.host}/apply`
  };
}

function createDiscover(parserVersion) {
  return function discover(company = {}) {
    const context = buildCompanyContext(company);
    const config = parseApplyToJobCompany(context.url_string);
    return {
      ats_key: "applytojob",
      source_family: APPLYTOJOB_SOURCE_FAMILY,
      docs_url: "observed ApplyToJob public list HTML",
      company: context,
      list_url: clean(config?.applyUrl || context.url_string),
      config: config || {
        baseOrigin: asUrl(context.url_string)?.origin || ""
      },
      parser_version: parserVersion
    };
  };
}

module.exports = {
  APPLYTOJOB_SOURCE_FAMILY,
  createDiscover,
  parseApplyToJobCompany
};
