const BRASSRING_DOCS_URL = "observed BrassRing public TGNewUI search API";
const BRASSRING_SOURCE_FAMILY = "brittle";

function clean(value) {
  return String(value || "").trim();
}

function parseUrl(value) {
  const url = clean(value);
  if (!url) return null;
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

function parseBrassringCompany(urlString) {
  const parsed = parseUrl(urlString);
  if (!parsed) return null;

  const host = String(parsed.hostname || "").toLowerCase();
  if (host !== "sjobs.brassring.com" && host !== "www.sjobs.brassring.com") return null;

  const partnerId = clean(parsed.searchParams.get("partnerid"));
  const siteId = clean(parsed.searchParams.get("siteid"));
  if (!partnerId || !siteId) return null;

  return {
    host,
    partnerId,
    siteId,
    boardUrl:
      `https://sjobs.brassring.com/TGnewUI/Search/Home/Home?partnerid=${encodeURIComponent(partnerId)}` +
      `&siteid=${encodeURIComponent(siteId)}`,
    apiUrl: "https://sjobs.brassring.com/TgNewUI/Search/Ajax/MatchedJobs"
  };
}

function createDiscover(parserVersion) {
  return function discover(company = {}) {
    const url = clean(company?.url_string || company?.company_url || company?.url);
    const config = parseBrassringCompany(url) || {};
    const listUrl = clean(config.boardUrl || url);
    return {
      ats_key: "brassring",
      source_family: BRASSRING_SOURCE_FAMILY,
      docs_url: BRASSRING_DOCS_URL,
      company,
      list_url: listUrl,
      listUrl,
      config,
      parser_version: clean(parserVersion) || "source-brassring-v1"
    };
  };
}

module.exports = {
  BRASSRING_DOCS_URL,
  BRASSRING_SOURCE_FAMILY,
  clean,
  createDiscover,
  parseBrassringCompany
};
