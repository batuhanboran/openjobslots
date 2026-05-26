const TALENTLYFT_DOCS_URL = "observed TalentLyft landing config and paged fragments";
const TALENTLYFT_SOURCE_FAMILY = "html_detail";
const TALENTLYFT_PARSER_VERSION = "source-talentlyft-v1";

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

function supportedTalentlyftHost(host) {
  const normalized = clean(host).toLowerCase();
  return normalized.endsWith(".talentlyft.com");
}

function parseTalentlyftCompany(urlString) {
  const parsed = parseUrl(urlString);
  if (!parsed) return null;

  const host = clean(parsed.hostname).toLowerCase();
  if (!supportedTalentlyftHost(host)) return null;

  const [subdomain = ""] = host.split(".");
  if (!subdomain) return null;

  const careersUrl = new URL(`${parsed.protocol}//${parsed.host}/`);
  return {
    host,
    subdomain,
    subdomainLower: subdomain.toLowerCase(),
    baseOrigin: `${parsed.protocol}//${parsed.host}`,
    careersUrl: careersUrl.toString()
  };
}

function buildCompanyContext(company = {}) {
  return {
    ...company,
    company_name: clean(company.company_name || company.companyName || company.name),
    url_string: clean(company.url_string || company.company_url || company.url),
    ATS_name: clean(company.ATS_name || company.ats_key || "talentlyft")
  };
}

function createDiscover() {
  return function discover(company = {}) {
    const context = buildCompanyContext(company);
    const config = parseTalentlyftCompany(context.url_string) || {};
    return {
      ats_key: "talentlyft",
      source_family: TALENTLYFT_SOURCE_FAMILY,
      docs_url: TALENTLYFT_DOCS_URL,
      company: context,
      list_url: clean(config.careersUrl),
      config,
      parser_version: TALENTLYFT_PARSER_VERSION
    };
  };
}

module.exports = {
  TALENTLYFT_DOCS_URL,
  TALENTLYFT_PARSER_VERSION,
  TALENTLYFT_SOURCE_FAMILY,
  buildCompanyContext,
  clean,
  createDiscover,
  parseTalentlyftCompany,
  supportedTalentlyftHost
};
