const ICIMS_DOCS_URL = "iCIMS Job Portal/Search API and public portal detail pages";
const ICIMS_SOURCE_FAMILY = "html_detail";
const ICIMS_SOURCE_ROUTE_KIND = "icims_public_portal";

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

function buildCompanyContext(company = {}) {
  return {
    ...company,
    company_name: clean(company.company_name || company.companyName || company.name),
    url_string: clean(company.url_string || company.company_url || company.url),
    ATS_name: clean(company.ATS_name || company.ats_key || "icims")
  };
}

function parseIcimsPublicCompany(urlString) {
  const parsed = parseUrl(urlString);
  if (!parsed) return null;

  const host = String(parsed.hostname || "").toLowerCase();
  if (!host.endsWith(".icims.com")) return null;

  const [tenant = ""] = host.split(".");
  if (!tenant) return null;

  const searchUrl = new URL(parsed.toString());
  searchUrl.pathname = "/jobs/search";
  searchUrl.searchParams.set("ss", "1");
  searchUrl.searchParams.delete("in_iframe");

  return {
    tenant,
    host,
    origin: parsed.origin,
    searchUrl: searchUrl.toString(),
    routeKind: ICIMS_SOURCE_ROUTE_KIND
  };
}

function createDiscover(parserVersion = "source-icims-v1") {
  return function discover(company = {}) {
    const context = buildCompanyContext(company);
    const route = parseIcimsPublicCompany(context.url_string) || {};
    return {
      ats_key: "icims",
      source_family: ICIMS_SOURCE_FAMILY,
      docs_url: ICIMS_DOCS_URL,
      company: context,
      list_url: clean(route.searchUrl || context.url_string),
      config: route,
      parser_version: clean(parserVersion) || "source-icims-v1"
    };
  };
}

module.exports = {
  ICIMS_DOCS_URL,
  ICIMS_SOURCE_FAMILY,
  ICIMS_SOURCE_ROUTE_KIND,
  clean,
  buildCompanyContext,
  parseIcimsPublicCompany,
  createDiscover,
  parseUrl
};
