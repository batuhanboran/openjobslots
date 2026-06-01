"use strict";

const { extractSourceIdFromPostingUrl } = require("../../parsers/shared/sourceIds");
const { decodeHtmlEntities } = require("../../parsers/shared/html");

const LOXO_REGION_COUNTRY_CODES = Object.freeze({
  BRU: "Belgium",
  ENG: "United Kingdom",
  NIR: "United Kingdom",
  SCT: "United Kingdom",
  VAN: "Belgium",
  VBR: "Belgium",
  VLI: "Belgium",
  VOV: "Belgium",
  WBR: "Belgium",
  WHT: "Belgium",
  WLG: "Belgium",
  WLS: "United Kingdom",
  ZE: "Netherlands"
});

const LOXO_CITY_COUNTRY_HINTS = Object.freeze({
  bergues: "France",
  dunkerque: "France",
  florange: "France",
  montpellier: "France",
  nantes: "France",
  occitanie: "France",
  "saint amand": "France"
});

function cleanLoxoText(value) {
  return decodeHtmlEntities(String(value || "").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeLoxoLookupText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function extractLoxoLocationEvidence(locationValue) {
  const location = cleanLoxoText(locationValue).replace(/\blocation_on\b/gi, "").trim();
  if (!location || /^wifi\s+remote$/i.test(location)) return {};
  const parts = location.split(",").map((part) => part.trim()).filter(Boolean);
  const city = parts[0] && !/^wifi\s+remote$/i.test(parts[0]) ? parts[0] : "";
  const suffix = parts.length > 1 ? parts[parts.length - 1].replace(/[^A-Za-z0-9]+/g, "").toUpperCase() : "";
  const regionCodeCountry = LOXO_REGION_COUNTRY_CODES[suffix] || "";
  const cityHintCountry = LOXO_CITY_COUNTRY_HINTS[normalizeLoxoLookupText(city)] || "";
  const country = regionCodeCountry || cityHintCountry;
  if (!country) return { city };
  return {
    city,
    country,
    source_evidence: {
      country_source: "list_html",
      country_path: "div.job-location",
      country_rule_name: regionCodeCountry ? "loxo_list_region_country_code" : "loxo_list_city_country_hint",
      city_source: city ? "list_html" : "",
      city_path: city ? "div.job-location" : ""
    }
  };
}

function parseLoxoPostingsFromHtml(companyNameForPostings, config, pageHtml) {
  const source = String(pageHtml || "");
  const postings = [];
  const seenUrls = new Set();

  const cardPattern =
    /<div[^>]*class=['"][^'"]*\bjobs-listing-card\b[^'"]*['"][^>]*>([\s\S]*?)<\/div>\s*<\/div>\s*<div[^>]*class=['"][^'"]*\bdata-cell\b[^'"]*['"][^>]*>[\s\S]*?<div[^>]*class=['"][^'"]*\bjob-location\b[^'"]*['"][^>]*>([\s\S]*?)<\/div>/gi;
  const hrefPattern = /<a[^>]*class=['"][^'"]*\bjob-title\b[^'"]*['"][^>]*href=['"]([^"']+)['"][^>]*>([\s\S]*?)<\/a>/i;
  const datePattern = /<div[^>]*class=['"][^'"]*\bjob-date\b[^'"]*['"][^>]*>([\s\S]*?)<\/div>/i;

  let match = cardPattern.exec(source);
  while (match) {
    const cardHtml = String(match[1] || "");
    const locationHtml = String(match[2] || "");
    const hrefMatch = cardHtml.match(hrefPattern);
    const href = String(hrefMatch?.[1] || "").trim();
    const absoluteUrl = href ? new URL(href, `${config.baseOrigin || ""}/`).toString() : "";
    if (!absoluteUrl || seenUrls.has(absoluteUrl)) {
      match = cardPattern.exec(source);
      continue;
    }

    const title = cleanLoxoText(hrefMatch?.[2] || "") || "Untitled Position";
    const postingDate = cleanLoxoText(cardHtml.match(datePattern)?.[1] || "");
    const location = cleanLoxoText(locationHtml).replace(/\blocation_on\b/gi, "").trim();
    const locationEvidence = extractLoxoLocationEvidence(location);

    postings.push({
      company_name: companyNameForPostings,
      position_name: title,
      source_job_id: extractSourceIdFromPostingUrl(absoluteUrl, "loxo"),
      job_posting_url: absoluteUrl,
      posting_date: postingDate || null,
      location: location || null,
      city: locationEvidence.city || null,
      country: locationEvidence.country || null,
      source_evidence: locationEvidence.source_evidence || {}
    });

    seenUrls.add(absoluteUrl);
    match = cardPattern.exec(source);
  }

  return postings;
}

module.exports = {
  extractLoxoLocationEvidence,
  parseLoxoPostingsFromHtml
};
