"use strict";

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

function normalizeCompanySlug(value) {
  return clean(value)
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function extractPersonioConfig(value) {
  const parsed = parseUrl(value);
  if (!parsed) return {};
  const host = parsed.hostname.toLowerCase();
  const hostParts = host.split(".");
  let companySlug = "";

  if (host.endsWith(".jobs.personio.de") && hostParts.length >= 4) {
    companySlug = normalizeCompanySlug(hostParts[0]);
  } else if (host === "api.personio.de") {
    companySlug = normalizeCompanySlug(parsed.searchParams.get("company") || "");
  }

  if (!companySlug) return {};
  const language = clean(parsed.searchParams.get("language") || "en").toLowerCase() || "en";
  const normalizedLanguage = ["de", "en", "fr", "es", "nl", "it", "pt"].includes(language) ? language : "en";
  const feedUrl = `https://${companySlug}.jobs.personio.de/xml?language=${encodeURIComponent(normalizedLanguage)}`;
  return {
    companySlug,
    companySlugLower: companySlug,
    language: normalizedLanguage,
    feedUrl,
    boardUrl: `https://${companySlug}.jobs.personio.de/`
  };
}

function discover(company = {}) {
  const config = extractPersonioConfig(company.url_string || company.company_url || company.url);
  return {
    ats_key: "personio",
    source_family: "direct_json",
    list_url: clean(config.feedUrl),
    config,
    parser_version: "source-personio-v1"
  };
}

module.exports = {
  clean,
  discover,
  extractPersonioConfig
};
