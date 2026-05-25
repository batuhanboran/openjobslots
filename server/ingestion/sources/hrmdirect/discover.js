const {
  asUrl,
  buildCompanyContext,
  clean
} = require("./helpers");

const HRMDIRECT_SOURCE_FAMILY = "html_detail";

function parseHrmDirectCompany(urlString) {
  const parsed = asUrl(urlString);
  if (!parsed) return null;

  const host = String(parsed.hostname || "").toLowerCase();
  if (!host.endsWith(".hrmdirect.com")) return null;

  const [subdomain = ""] = host.split(".");
  if (!subdomain) return null;

  const jobsUrl = new URL(parsed.toString());
  if (!/\/employment\/(?:job-openings|openings)\.php$/i.test(String(jobsUrl.pathname || ""))) {
    jobsUrl.pathname = "/employment/job-openings.php";
  }
  if (!jobsUrl.searchParams.has("search")) {
    jobsUrl.searchParams.set("search", "true");
  }
  jobsUrl.hash = "";

  return {
    host,
    subdomain,
    subdomainLower: subdomain.toLowerCase(),
    baseOrigin: `${parsed.protocol}//${parsed.host}`,
    jobsUrl: jobsUrl.toString()
  };
}

function normalizeHrmDirectListUrl(urlValue) {
  const parsed = asUrl(urlValue);
  if (!parsed) return clean(urlValue);
  const host = String(parsed.hostname || "").toLowerCase();
  if (!host.endsWith(".hrmdirect.com")) return parsed.toString();
  if (/\/employment\/(?:job-openings|openings)\.php$/i.test(parsed.pathname) && !parsed.searchParams.has("search")) {
    parsed.searchParams.set("search", "true");
  }
  parsed.hash = "";
  return parsed.toString();
}

function createDiscover(parserVersion) {
  return function discover(company = {}) {
    const context = buildCompanyContext(company);
    const config = parseHrmDirectCompany(context.url_string);
    const listUrl = normalizeHrmDirectListUrl(config?.jobsUrl || context.url_string);
    return {
      ats_key: "hrmdirect",
      source_family: HRMDIRECT_SOURCE_FAMILY,
      docs_url: "observed HRMDirect public job-openings table HTML",
      company: context,
      list_url: listUrl,
      config: config || {
        baseOrigin: asUrl(context.url_string)?.origin || ""
      },
      parser_version: parserVersion
    };
  };
}

module.exports = {
  HRMDIRECT_SOURCE_FAMILY,
  createDiscover,
  normalizeHrmDirectListUrl,
  parseHrmDirectCompany
};
