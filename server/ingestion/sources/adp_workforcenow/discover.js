const ADP_WORKFORCENOW_DOCS_URL = "observed ADP Workforce Now public recruitment endpoint";
const ADP_WORKFORCENOW_SOURCE_FAMILY = "enterprise_api";
const ADP_WORKFORCENOW_PARSER_VERSION = "source-adp_workforcenow-v1";

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
    ATS_name: clean(company.ATS_name || company.ats_key || "adp_workforcenow")
  };
}

function parseAdpWorkforcenowCompany(urlString) {
  const parsed = parseUrl(urlString);
  if (!parsed) return null;

  const host = String(parsed.hostname || "").toLowerCase();
  if (host !== "workforcenow.adp.com" && host !== "www.workforcenow.adp.com") return null;

  const cid = String(parsed.searchParams?.get("cid") || "").trim();
  const ccId = String(parsed.searchParams?.get("ccId") || "").trim();
  if (!cid || !ccId) return null;

  const baseOrigin = "https://workforcenow.adp.com";
  const boardUrl =
    `${baseOrigin}/mascsr/default/mdf/recruitment/recruitment.html?` +
    `cid=${encodeURIComponent(cid)}&ccId=${encodeURIComponent(ccId)}`;
  const apiBase = `${baseOrigin}/mascsr/default/careercenter/public/events/staffing/v1`;

  return {
    host,
    cid,
    ccId,
    boardUrl,
    jobRequisitionsUrl: `${apiBase}/job-requisitions?cid=${encodeURIComponent(cid)}&ccId=${encodeURIComponent(ccId)}`,
    contentLinksBaseUrl: `${apiBase}/content-links/career-center`
  };
}

function createDiscover(parserVersion = ADP_WORKFORCENOW_PARSER_VERSION) {
  return function discover(company = {}) {
    const context = buildCompanyContext(company);
    const config = parseAdpWorkforcenowCompany(context.url_string) || {};
    return {
      ats_key: "adp_workforcenow",
      source_family: ADP_WORKFORCENOW_SOURCE_FAMILY,
      docs_url: ADP_WORKFORCENOW_DOCS_URL,
      company: context,
      list_url: clean(config.boardUrl || context.url_string),
      config,
      parser_version: parserVersion
    };
  };
}

module.exports = {
  ADP_WORKFORCENOW_DOCS_URL,
  ADP_WORKFORCENOW_PARSER_VERSION,
  ADP_WORKFORCENOW_SOURCE_FAMILY,
  clean,
  buildCompanyContext,
  parseAdpWorkforcenowCompany,
  createDiscover
};
