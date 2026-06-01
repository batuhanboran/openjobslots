"use strict";

const { normalizeCountryFromLocation, normalizeCountryName } = require("../../posting");
const { extractSourceIdFromPostingUrl } = require("../../parsers/shared/sourceIds");
const { decodeHtmlEntities } = require("../../parsers/shared/html");

const CAREERSPAGE_CITY_COUNTRY_HINTS = Object.freeze({
  akron: "United States",
  albuquerque: "United States",
  anaheim: "United States",
  atlanta: "United States",
  "baton rouge": "United States",
  "boca raton": "United States",
  buford: "United States",
  burbank: "United States",
  carmel: "United States",
  charlotte: "United States",
  cleveland: "United States",
  "corpus christi": "United States",
  cumming: "United States",
  downey: "United States",
  durham: "United States",
  escondido: "United States",
  "fort myers": "United States",
  "fort wayne": "United States",
  gaithersburg: "United States",
  gaylord: "United States",
  "glendale heights": "United States",
  glastonbury: "United States",
  hagerstown: "United States",
  "high point": "United States",
  "holly springs": "United States",
  knoxville: "United States",
  "lauderdale lakes": "United States",
  "long beach": "United States",
  louisville: "United States",
  "marina del rey": "United States",
  mcdonough: "United States",
  mishawaka: "United States",
  nanuet: "United States",
  nashville: "United States",
  "new haven": "United States",
  "new orleans": "United States",
  norcross: "United States",
  omaha: "United States",
  orlando: "United States",
  "palm beach": "United States",
  "palm beach gardens": "United States",
  "peachtree city": "United States",
  petoskey: "United States",
  piscataway: "United States",
  sarasota: "United States",
  savannah: "United States",
  "san clemente": "United States",
  "san diego": "United States",
  "south gate": "United States",
  spartanburg: "United States",
  tallahassee: "United States",
  teterboro: "United States",
  torrance: "United States",
  "winter park": "United States",
  winder: "United States"
});

function cleanCareerspageText(value) {
  return decodeHtmlEntities(String(value || "").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeCareerspageLookupText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function extractCareerspageLocationEvidence(value) {
  const location = cleanCareerspageText(value);
  if (!location || /^(remote|hybrid|virtual|work from home|wfh)$/i.test(location)) return {};

  const parts = location.split(",").map((part) => part.trim()).filter(Boolean);
  const city = parts[0] || "";
  const countryLabel = parts.length > 1 ? parts[parts.length - 1] : "";
  const explicitCountry = normalizeCountryName(countryLabel) || normalizeCountryFromLocation(countryLabel);
  if (explicitCountry) {
    return {
      city: normalizeCountryName(city) ? "" : city,
      country: explicitCountry,
      source_evidence: {
        country_source: "labeled_html",
        country_path: ".job-item location span",
        country_rule_name: "careerspage_labeled_country",
        city_source: city && !normalizeCountryName(city) ? "labeled_html" : "",
        city_path: city && !normalizeCountryName(city) ? ".job-item location span" : ""
      }
    };
  }

  const cityHintCountry = CAREERSPAGE_CITY_COUNTRY_HINTS[normalizeCareerspageLookupText(city)] || "";
  if (cityHintCountry) {
    return {
      city,
      country: cityHintCountry,
      source_evidence: {
        country_source: "labeled_html",
        country_path: ".job-item location span",
        country_rule_name: "careerspage_city_country_hint",
        city_source: "labeled_html",
        city_path: ".job-item location span"
      }
    };
  }

  const locationCountry = normalizeCountryFromLocation(location);
  if (locationCountry) {
    return {
      city: normalizeCountryName(city) ? "" : city,
      country: locationCountry,
      source_evidence: {
        country_source: "labeled_html",
        country_path: ".job-item location span",
        country_rule_name: "careerspage_location_text_country",
        city_source: city && !normalizeCountryName(city) ? "labeled_html" : "",
        city_path: city && !normalizeCountryName(city) ? ".job-item location span" : ""
      }
    };
  }

  return {
    city,
    country: "",
    source_evidence: city ? {
      city_source: "labeled_html",
      city_path: ".job-item location span"
    } : {}
  };
}

function parseCareerspagePostingsFromHtml(companyNameForPostings, config, pageHtml) {
  const source = String(pageHtml || "");
  const postings = [];
  const seenUrls = new Set();

  const jobItemPattern = /<div[^>]*class=['"][^'"]*\bjob-item\b[^'"]*['"][^>]*>([\s\S]*?)<\/div>\s*<\/div>/gi;
  let itemMatch = jobItemPattern.exec(source);

  while (itemMatch) {
    const itemHtml = String(itemMatch[1] || "");
    const hrefRaw = String(
      itemHtml.match(/href=['"](https?:\/\/careerspage\.io\/[^'"?#]+\/[^'"?#]+)['"]/i)?.[1] || ""
    ).trim();
    if (!hrefRaw) {
      itemMatch = jobItemPattern.exec(source);
      continue;
    }

    const title = cleanCareerspageText(itemHtml.match(/<h3[^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>[\s\S]*?<\/h3>/i)?.[1] || "");
    if (!title) {
      itemMatch = jobItemPattern.exec(source);
      continue;
    }

    let jobUrl = "";
    try {
      jobUrl = new URL(hrefRaw, `${String(config?.boardUrl || "").replace(/\/+$/, "")}/`).toString();
    } catch {
      itemMatch = jobItemPattern.exec(source);
      continue;
    }
    if (!jobUrl || seenUrls.has(jobUrl)) {
      itemMatch = jobItemPattern.exec(source);
      continue;
    }

    const location = cleanCareerspageText(
      itemHtml.match(/fa-location-arrow[^<]*<\/i>\s*<\/span>\s*<span[^>]*>([\s\S]*?)<\/span>/i)?.[1] || ""
    );
    const locationEvidence = extractCareerspageLocationEvidence(location);
    const employmentType = cleanCareerspageText(
      itemHtml.match(/fa-business-time[^<]*<\/i>\s*<\/span>\s*<span[^>]*>([\s\S]*?)<\/span>/i)?.[1] || ""
    );

    postings.push({
      company_name: companyNameForPostings,
      position_name: title || "Untitled Position",
      source_job_id: extractSourceIdFromPostingUrl(jobUrl, "careerspage"),
      job_posting_url: jobUrl,
      posting_date: null,
      location: location || null,
      city: locationEvidence.city || null,
      country: locationEvidence.country || null,
      source_evidence: {
        location_source: location ? "labeled_html" : "",
        location_path: location ? ".job-item location span" : "",
        ...(locationEvidence.source_evidence || {})
      },
      employment_type: employmentType || null
    });
    seenUrls.add(jobUrl);
    itemMatch = jobItemPattern.exec(source);
  }

  return postings;
}

module.exports = {
  parseCareerspagePostingsFromHtml
};
