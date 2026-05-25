const JOBVITE_DOCS_URL = "observed Jobvite public job-list HTML";
const JOBVITE_SOURCE_FAMILY = "html_detail";
const JOBVITE_PARSER_VERSION = "source-jobvite-v1";

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

function supportedJobviteHost(host) {
  return host === "jobs.jobvite.com" || host === "careers.jobvite.com";
}

function parseJobviteCompany(urlString) {
  const parsed = parseUrl(urlString);
  if (!parsed) return null;

  const host = String(parsed.hostname || "").toLowerCase();
  if (!supportedJobviteHost(host)) return null;

  const pathParts = parsed.pathname
    .split("/")
    .map((part) => clean(part))
    .filter(Boolean);
  const companySlug = clean(pathParts[0]);
  if (!companySlug) return null;

  const baseOrigin = `${parsed.protocol}//${parsed.host}`;
  return {
    host,
    companySlug,
    companySlugLower: companySlug.toLowerCase(),
    baseOrigin,
    jobsUrl: `${baseOrigin}/${encodeURIComponent(companySlug)}/jobs`
  };
}

function buildCompanyContext(company = {}) {
  return {
    ...company,
    company_name: clean(company.company_name || company.companyName || company.name),
    url_string: clean(company.url_string || company.company_url || company.url),
    ATS_name: clean(company.ATS_name || company.ats_key || "jobvite")
  };
}

function createDiscover() {
  return function discover(company = {}) {
    const context = buildCompanyContext(company);
    const config = parseJobviteCompany(context.url_string) || {};
    return {
      ats_key: "jobvite",
      source_family: JOBVITE_SOURCE_FAMILY,
      docs_url: JOBVITE_DOCS_URL,
      company: context,
      list_url: clean(config.jobsUrl),
      config,
      parser_version: JOBVITE_PARSER_VERSION
    };
  };
}

module.exports = {
  JOBVITE_DOCS_URL,
  JOBVITE_PARSER_VERSION,
  JOBVITE_SOURCE_FAMILY,
  buildCompanyContext,
  clean,
  createDiscover,
  parseJobviteCompany,
  supportedJobviteHost
};
