const {
  asUrl,
  buildCompanyContext,
  clean
} = require("./helpers");

const CAREERPLUG_SOURCE_FAMILY = "html_detail";

function parseCareerplugCompany(urlString) {
  const parsed = asUrl(urlString);
  if (!parsed) return null;

  const host = String(parsed.hostname || "").toLowerCase();
  if (!host.endsWith(".careerplug.com")) return null;

  const [subdomain = ""] = host.split(".");
  if (!subdomain) return null;

  return {
    host,
    subdomain,
    subdomainLower: subdomain.toLowerCase(),
    baseOrigin: `${parsed.protocol}//${parsed.host}`,
    jobsUrl: `${parsed.protocol}//${parsed.host}/jobs`
  };
}

function createDiscover(parserVersion) {
  return function discover(company = {}) {
    const context = buildCompanyContext(company);
    const config = parseCareerplugCompany(context.url_string);
    return {
      ats_key: "careerplug",
      source_family: CAREERPLUG_SOURCE_FAMILY,
      docs_url: "observed CareerPlug public jobs HTML plus JSON-LD detail pages",
      company: context,
      list_url: clean(config?.jobsUrl || context.url_string),
      config: config || {
        baseOrigin: asUrl(context.url_string)?.origin || ""
      },
      parser_version: parserVersion
    };
  };
}

module.exports = {
  CAREERPLUG_SOURCE_FAMILY,
  createDiscover,
  parseCareerplugCompany
};
