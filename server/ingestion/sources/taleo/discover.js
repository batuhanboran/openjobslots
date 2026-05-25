const TALEO_SOURCE_FAMILY = "brittle";
const TALEO_DOCS_URL = "observed Taleo careersection REST/AJAX public endpoints";

function clean(value) {
  return String(value || "").trim();
}

function parseUrl(urlString) {
  if (!urlString) return null;
  try {
    return new URL(urlString);
  } catch {
    return null;
  }
}

function parseTaleoCompany(urlString) {
  const parsed = parseUrl(urlString);
  if (!parsed) return null;

  const host = String(parsed.hostname || "").toLowerCase();
  if (!host.endsWith(".taleo.net")) return null;

  const pathParts = parsed.pathname
    .split("/")
    .map((part) => clean(part))
    .filter(Boolean);
  if (pathParts.length < 2 || pathParts[0].toLowerCase() !== "careersection") return null;

  const careerSection = clean(pathParts[1]);
  if (!careerSection) return null;

  const lang = clean(parsed.searchParams.get("lang")) || "en";
  return {
    careerSection,
    careerSectionLower: careerSection.toLowerCase(),
    lang,
    baseOrigin: `${parsed.protocol}//${parsed.host}`,
    baseSectionUrl: `${parsed.protocol}//${parsed.host}/careersection/${careerSection}`
  };
}

function buildCompanyContext(company = {}) {
  return {
    ...company,
    company_name: clean(company.company_name || company.name),
    url_string: clean(company.url_string || company.url || company.board_url || company.source_url),
    ATS_name: clean(company.ATS_name || company.ats_key || "taleo")
  };
}

function createDiscover() {
  return function discover(company = {}) {
    const context = buildCompanyContext(company);
    const config = parseTaleoCompany(context.url_string) || {};
    return {
      ats_key: "taleo",
      source_family: TALEO_SOURCE_FAMILY,
      docs_url: TALEO_DOCS_URL,
      company: context,
      list_url: clean(context.url_string),
      config,
      parser_version: "source-taleo-v1"
    };
  };
}

module.exports = {
  TALEO_DOCS_URL,
  TALEO_SOURCE_FAMILY,
  buildCompanyContext,
  clean,
  createDiscover,
  parseTaleoCompany
};
