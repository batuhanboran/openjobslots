"use strict";

const APPLITRACK_SOURCE_FAMILY = "public_sector";

function clean(value) {
  return String(value || "").trim();
}

function asUrl(value) {
  try {
    return new URL(clean(value));
  } catch {
    return null;
  }
}

function buildCompanyContext(company = {}) {
  return {
    company_name: clean(company.company_name || company.companyName || company.name),
    url_string: clean(company.url_string || company.company_url || company.url),
    ATS_name: clean(company.ATS_name || company.ats_key)
  };
}

function applitrackSiteRoot(value) {
  const parsed = asUrl(value);
  if (!parsed) return "";
  const pathValue = String(parsed.pathname || "/");
  const lowerPath = pathValue.toLowerCase();
  const onlineAppIndex = lowerPath.indexOf("/onlineapp/");
  const rootPath = onlineAppIndex >= 0
    ? pathValue.slice(0, onlineAppIndex + "/onlineapp/".length)
    : pathValue.endsWith("/default.aspx")
      ? pathValue.slice(0, -1 * "default.aspx".length)
      : pathValue.endsWith("/")
        ? pathValue
        : `${pathValue.replace(/[^/]*$/, "")}`;
  const normalizedRootPath = rootPath.endsWith("/") ? rootPath : `${rootPath}/`;
  return `${parsed.protocol}//${parsed.host}${normalizedRootPath}`;
}

function createDiscover(parserVersion) {
  return function discover(company = {}) {
    const context = buildCompanyContext(company);
    const siteRoot = applitrackSiteRoot(context.url_string);
    return {
      ats_key: "applitrack",
      source_family: APPLITRACK_SOURCE_FAMILY,
      docs_url: "observed Applitrack Output.asp list and JobPostings/view.asp detail pages",
      company: context,
      list_url: siteRoot ? new URL("jobpostings/Output.asp?all=1", siteRoot).toString() : "",
      config: { siteRoot },
      parser_version: parserVersion
    };
  };
}

module.exports = {
  APPLITRACK_SOURCE_FAMILY,
  applitrackSiteRoot,
  buildCompanyContext,
  clean,
  createDiscover
};
