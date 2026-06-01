"use strict";

const { decodeHtmlEntities, extractJsonLdObjectsFromHtml } = require("../../parsers/shared/html");
const { extractSourceIdFromPostingUrl } = require("../../parsers/shared/sourceIds");
const { normalizeCountryFromLocation, normalizeCountryName, normalizeRegionFromCountry } = require("../../posting");

const JOBVITE_LOCATION_COUNTRY_HINTS = Object.freeze({
  "acuamanala tlaxcala": "Mexico",
  "aguascaliente aguascaliente": "Mexico",
  "aguascalientes aguascalientes": "Mexico",
  "ajax store ajax": "Canada",
  "albufeira": "Portugal",
  "almancil": "Portugal",
  "applewood store mississauga": "Canada",
  "aurora store aurora": "Canada",
  "aveiro": "Portugal",
  "bolton store bolton": "Canada",
  "boxgrove store markham": "Canada",
  "braga": "Portugal",
  "brampton store brampton": "Canada",
  "brooklin store whitby": "Canada",
  "faro": "Portugal",
  "fleet hants": "United Kingdom",
  "glen erin store mississauga": "Canada",
  "kleinburg store kleinburg": "Canada",
  "leiria": "Portugal",
  "maple store maple": "Canada",
  "markham store markham": "Canada",
  "matosinhos": "Portugal",
  "milton store milton": "Canada",
  "mt prospect illinios": "United States",
  "pacos de ferreira": "Portugal",
  "paços de ferreira": "Portugal",
  "ponta delgada": "Portugal",
  "pontevedra": "Spain",
  "ponytrail store mississauga": "Canada",
  "port of nigg highland": "United Kingdom",
  "portimao": "Portugal",
  "portimão": "Portugal",
  "rio de mouro sintra": "Portugal",
  "rutherford store woodbridge": "Canada",
  "scottsdale phoenix": "United States",
  "seixal": "Portugal",
  "setubal": "Portugal",
  "setúbal": "Portugal",
  "shin yokohama shin yokohama": "Japan",
  "stouffville store stouffville": "Canada",
  "vila do conde": "Portugal",
  "vila nova de famalicao": "Portugal",
  "vila nova de famalicão": "Portugal",
  "vila real": "Portugal",
  "welland store welland": "Canada",
  "yonge sheppard store north york": "Canada"
});

const JOBVITE_REGION_COUNTRY_HINTS = Object.freeze({
  aguascaliente: "Mexico",
  aguascalientes: "Mexico",
  coahuila: "Mexico",
  gujarat: "India",
  hants: "United Kingdom",
  highland: "United Kingdom",
  laguna: "Philippines",
  "nova scotia": "Canada",
  "novia scotia": "Canada",
  pampanga: "Philippines",
  tlaxcala: "Mexico"
});

function cleanJobviteText(value) {
  return decodeHtmlEntities(String(value || "").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .replace(/\s*,\s*/g, ", ")
    .trim();
}

function normalizeJobviteLookupText(value) {
  return cleanJobviteText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function canonicalJobviteDetailKey(urlValue) {
  try {
    const parsed = new URL(String(urlValue || ""));
    parsed.hash = "";
    return parsed.toString().replace(/\/+$/, "");
  } catch {
    return String(urlValue || "").trim().replace(/#.*$/, "").replace(/\/+$/, "");
  }
}

function lookupJobviteDetailHtml(detailHtmlByUrl, urlValue) {
  const map = detailHtmlByUrl && typeof detailHtmlByUrl === "object" ? detailHtmlByUrl : {};
  const key = canonicalJobviteDetailKey(urlValue);
  const candidates = [
    String(urlValue || ""),
    String(urlValue || "").replace(/#.*$/, ""),
    key,
    `${key}/`
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (typeof map[candidate] === "string") return map[candidate];
  }
  return "";
}

function findJobviteJobPostingJsonLd(sourceHtml) {
  return extractJsonLdObjectsFromHtml(sourceHtml).find((item) => {
    const type = item?.["@type"];
    return Array.isArray(type)
      ? type.some((value) => String(value || "").toLowerCase() === "jobposting")
      : String(type || "").toLowerCase() === "jobposting";
  }) || null;
}

function cleanJobviteStructuredValue(value) {
  if (value && typeof value === "object") {
    return cleanJobviteStructuredValue(value.name || value.value || value["@id"]);
  }
  return cleanJobviteText(value);
}

function extractJobviteJsonLdLocations(jobPosting) {
  const locations = Array.isArray(jobPosting?.jobLocation)
    ? jobPosting.jobLocation
    : jobPosting?.jobLocation
      ? [jobPosting.jobLocation]
      : [];
  const output = [];
  const seen = new Set();

  for (const location of locations) {
    const address = location?.address && typeof location.address === "object" ? location.address : {};
    const city = cleanJobviteStructuredValue(address.addressLocality);
    const state = cleanJobviteStructuredValue(address.addressRegion);
    const countryRaw = cleanJobviteStructuredValue(address.addressCountry);
    const countryHint = resolveJobviteCountryHint({
      label: [city, state, countryRaw].filter(Boolean).join(", "),
      city,
      state,
      countryRaw,
      defaultRuleName: "jobvite_json_ld_country",
      source: "detail_json_ld",
      countryPath: "script[type='application/ld+json'].jobLocation[].address.addressCountry",
      regionPath: "script[type='application/ld+json'].jobLocation[].address.addressRegion",
      cityPath: "script[type='application/ld+json'].jobLocation[].address.addressLocality"
    });
    const country = countryHint.country;
    const label = [city, state, country].filter(Boolean).join(", ");
    const key = label.toLowerCase();
    if (!label || seen.has(key)) continue;
    seen.add(key);
    output.push({ city, state, country, label, countryHint });
  }

  const countriesWithCity = new Set(output
    .filter((item) => item.city && item.country)
    .map((item) => item.country.toLowerCase()));
  if (!countriesWithCity.size) return output;
  return output.filter((item) => {
    if (item.city) return true;
    if (!item.country) return true;
    return !countriesWithCity.has(item.country.toLowerCase());
  });
}

function extractJobviteDetailFields(detailHtml) {
  const jobPosting = findJobviteJobPostingJsonLd(detailHtml);
  if (!jobPosting) return {};

  const locations = extractJobviteJsonLdLocations(jobPosting);
  const firstLocation = locations[0] || {};
  const country = firstLocation.country || "";

  return {
    postingDate: cleanJobviteStructuredValue(jobPosting.datePosted),
    employmentType: cleanJobviteStructuredValue(jobPosting.employmentType),
    location: locations.map((item) => item.label).join(" / "),
    city: firstLocation.city || "",
    country,
    region: country ? normalizeRegionFromCountry(country) : "",
    countrySource: firstLocation.countryHint?.source || "",
    countryPath: firstLocation.countryHint?.countryPath || "",
    countryRuleName: firstLocation.countryHint?.ruleName || "",
    regionSource: firstLocation.countryHint?.source || "",
    regionPath: firstLocation.countryHint?.regionPath || firstLocation.countryHint?.countryPath || "",
    regionRuleName: country ? "jobvite_json_ld_region" : "",
    citySource: firstLocation.city ? "detail_json_ld" : "",
    cityPath: firstLocation.city ? "script[type='application/ld+json'].jobLocation[].address.addressLocality" : "",
    cityRuleName: firstLocation.city ? "jobvite_json_ld_city" : ""
  };
}

function jobviteListLocationLooksAmbiguous(location) {
  return /^\s*(?:\d+\s+locations?|multiple(?:\s+locations?)?|various(?:\s+locations?)?|all(?:\s+locations?))(?:,\s*[A-Za-z][A-Za-z .'-]+)?\s*$/i.test(cleanJobviteText(location));
}

function extractJobviteWorkModePrefix(location) {
  const value = cleanJobviteText(location);
  const match = value.match(/^\s*(hybrid(?:\s+remote)?|remote)\b/i);
  return match ? cleanJobviteText(match[1]) : "";
}

function stripJobviteWorkModePrefix(location) {
  const value = cleanJobviteText(location);
  return value.replace(/^\s*(?:hybrid(?:\s+remote)?|remote)\b\s*,?\s*/i, "").trim();
}

function locationPartLooksStoreLabel(value) {
  return /\bstore\b/i.test(cleanJobviteText(value));
}

function resolveJobviteCountryHint({
  label = "",
  city = "",
  state = "",
  countryRaw = "",
  source = "list_html",
  defaultRuleName = "jobvite_list_location_country",
  countryPath = "table.jv-job-list td.jv-job-list-location",
  regionPath = "table.jv-job-list td.jv-job-list-location",
  cityPath = "table.jv-job-list td.jv-job-list-location"
} = {}) {
  const country = normalizeCountryName(countryRaw) ||
    normalizeCountryFromLocation(countryRaw) ||
    normalizeCountryFromLocation(label);
  if (country) {
    return { country, source, countryPath, regionPath: countryPath, cityPath, ruleName: defaultRuleName };
  }

  const stateKey = normalizeJobviteLookupText(state);
  const stateCountry = JOBVITE_REGION_COUNTRY_HINTS[stateKey];
  if (stateCountry) {
    return {
      country: stateCountry,
      source,
      countryPath: regionPath,
      regionPath,
      cityPath,
      ruleName: source === "detail_json_ld" ? "jobvite_json_ld_region_country_hint" : "jobvite_list_region_country_hint"
    };
  }

  const labelKey = normalizeJobviteLookupText(label);
  const labelCountry = JOBVITE_LOCATION_COUNTRY_HINTS[labelKey];
  if (labelCountry) {
    return {
      country: labelCountry,
      source,
      countryPath,
      regionPath,
      cityPath,
      ruleName: source === "detail_json_ld" ? "jobvite_json_ld_location_country_hint" : "jobvite_list_location_country_hint"
    };
  }

  const cityKey = normalizeJobviteLookupText(city);
  const cityCountry = JOBVITE_LOCATION_COUNTRY_HINTS[cityKey];
  if (cityCountry) {
    return {
      country: cityCountry,
      source,
      countryPath: cityPath,
      regionPath,
      cityPath,
      ruleName: source === "detail_json_ld" ? "jobvite_json_ld_city_country_hint" : "jobvite_list_city_country_hint"
    };
  }

  return { country: "", source: "", countryPath: "", regionPath: "", cityPath: "", ruleName: "" };
}

function extractJobviteListLocationFields(location) {
  const sourceLocation = cleanJobviteText(location);
  const value = stripJobviteWorkModePrefix(sourceLocation);
  if (!value || jobviteListLocationLooksAmbiguous(value)) return {};
  if (/^(remote|hybrid(?:\s+remote)?)$/i.test(sourceLocation)) return {};

  const parts = value.split(",").map((part) => cleanJobviteText(part)).filter(Boolean);
  const firstPart = parts[0] || value;
  const secondPart = parts[1] || "";
  const city = locationPartLooksStoreLabel(firstPart) && secondPart ? secondPart : firstPart;
  const countryHint = resolveJobviteCountryHint({
    label: value,
    city,
    state: secondPart,
    source: "list_html"
  });
  const country = countryHint.country;
  if (!country) return {};

  return {
    city,
    country,
    region: normalizeRegionFromCountry(country),
    countrySource: countryHint.source,
    countryPath: countryHint.countryPath,
    countryRuleName: countryHint.ruleName,
    regionSource: countryHint.source,
    regionPath: countryHint.countryPath,
    regionRuleName: "jobvite_list_country_region",
    citySource: city ? "list_html" : "",
    cityPath: city ? "table.jv-job-list td.jv-job-list-location" : "",
    cityRuleName: city ? "jobvite_list_city" : ""
  };
}

function mergeJobviteListAndDetailLocation(listLocation, detailFields = {}) {
  const listValue = cleanJobviteText(listLocation);
  const detailLocation = cleanJobviteText(detailFields.location);
  if (!detailLocation) {
    const workModePrefix = extractJobviteWorkModePrefix(listValue);
    if (workModePrefix && jobviteListLocationLooksAmbiguous(stripJobviteWorkModePrefix(listValue))) {
      return workModePrefix;
    }
    if (jobviteListLocationLooksAmbiguous(listValue)) return null;
    return listValue || null;
  }
  if (!listValue) return detailLocation;

  const workModePrefix = extractJobviteWorkModePrefix(listValue);
  if (workModePrefix && !extractJobviteWorkModePrefix(detailLocation)) {
    const listRemainder = stripJobviteWorkModePrefix(listValue);
    if (detailFields.city || jobviteListLocationLooksAmbiguous(listRemainder)) {
      return `${workModePrefix}, ${detailLocation}`;
    }
    return listValue;
  }

  if (jobviteListLocationLooksAmbiguous(listValue)) return detailLocation;
  if (detailFields.city) return detailLocation;
  if (detailFields.country) return listValue;
  return listValue;
}

function buildJobviteSourceEvidence({ usesDetailLocation, geoEvidence = {}, hasDetailGeo, hasDetailDate, detailUrl } = {}) {
  return {
    source_family: "html_detail",
    title_source: "list_html",
    title_path: "table.jv-job-list td.jv-job-list-name a",
    title_rule_name: "jobvite_list_title",
    company_source: "existing_value",
    company_path: "company.company_name",
    company_rule_name: "source_company",
    canonical_url_source: "list_html",
    canonical_url_path: "table.jv-job-list td.jv-job-list-name a[href]",
    canonical_url_rule_name: "jobvite_list_url",
    source_job_id_source: "url",
    source_job_id_path: "jobvite_url_id",
    source_job_id_rule_name: "jobvite_url_source_id",
    location_source: usesDetailLocation ? "detail_json_ld" : "list_html",
    location_path: usesDetailLocation ? "script[type='application/ld+json'].jobLocation[].address" : "table.jv-job-list td.jv-job-list-location",
    location_rule_name: usesDetailLocation ? "jobvite_json_ld_location" : "jobvite_list_location",
    ...((geoEvidence.country || hasDetailGeo)
      ? {
          country_source: geoEvidence.countrySource || "detail_json_ld",
          country_path: geoEvidence.countryPath || "script[type='application/ld+json'].jobLocation[].address.addressCountry",
          country_rule_name: geoEvidence.countryRuleName || "jobvite_json_ld_country",
          region_source: geoEvidence.regionSource || geoEvidence.countrySource || "detail_json_ld",
          region_path: geoEvidence.regionPath || geoEvidence.countryPath || "script[type='application/ld+json'].jobLocation[].address.addressCountry",
          region_rule_name: geoEvidence.regionRuleName || "jobvite_json_ld_region",
          city_source: geoEvidence.citySource || "detail_json_ld",
          city_path: geoEvidence.cityPath || "script[type='application/ld+json'].jobLocation[].address.addressLocality",
          city_rule_name: geoEvidence.cityRuleName || "jobvite_json_ld_city"
        }
      : {}),
    ...(hasDetailDate
      ? {
          posting_date_source: "detail_json_ld",
          posting_date_path: "script[type='application/ld+json'].datePosted",
          posting_date_rule_name: "jobvite_json_ld_date_posted"
        }
      : {}),
    detail_url: detailUrl || ""
  };
}

function parseJobvitePostingsFromHtml(companyNameForPostings, config, pagePayload) {
  const payload = pagePayload && typeof pagePayload === "object" && !Array.isArray(pagePayload)
    ? pagePayload
    : { html: String(pagePayload || "") };
  const source = String(payload.html || payload.body || "");
  const detailHtmlByUrl = payload.__detailHtmlByUrl || {};
  const tablePattern =
    /<h3[^>]*>([\s\S]*?)<\/h3>\s*<table[^>]*class=["'][^"']*\bjv-job-list\b[^"']*["'][^>]*>([\s\S]*?)<\/table>/gi;
  const rowPattern =
    /<tr[^>]*>[\s\S]*?<td[^>]*class=["'][^"']*\bjv-job-list-name\b[^"']*["'][^>]*>[\s\S]*?<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>[\s\S]*?<\/td>[\s\S]*?<td[^>]*class=["'][^"']*\bjv-job-list-location\b[^"']*["'][^>]*>([\s\S]*?)<\/td>[\s\S]*?<\/tr>/gi;

  const postings = [];
  const seenUrls = new Set();

  const pushRows = (rowsHtml, department = "") => {
    let rowMatch = rowPattern.exec(rowsHtml);
    while (rowMatch) {
      const href = String(rowMatch[1] || "").trim();
      const absoluteUrl = href ? new URL(href, `${config.baseOrigin}/`).toString() : "";
      if (!absoluteUrl || seenUrls.has(absoluteUrl)) {
        rowMatch = rowPattern.exec(rowsHtml);
        continue;
      }

      const detailHtml = lookupJobviteDetailHtml(detailHtmlByUrl, absoluteUrl);
      const detailFields = extractJobviteDetailFields(detailHtml);
      const listLocation = cleanJobviteText(rowMatch[3]) || null;
      const listLocationFields = extractJobviteListLocationFields(listLocation);
      const detailLocation = detailFields.location || "";
      const mergedLocation = mergeJobviteListAndDetailLocation(listLocation, detailFields);
      const usesDetailLocation = Boolean(detailLocation && mergedLocation && mergedLocation.includes(detailLocation));
      const hasDetailGeo = Boolean(detailFields.country);
      const hasDetailDate = Boolean(detailFields.postingDate);
      const geoEvidence = {
        country: detailFields.country || listLocationFields.country || "",
        countrySource: detailFields.country ? detailFields.countrySource : listLocationFields.countrySource,
        countryPath: detailFields.country ? detailFields.countryPath : listLocationFields.countryPath,
        countryRuleName: detailFields.country ? detailFields.countryRuleName : listLocationFields.countryRuleName,
        regionSource: detailFields.country ? detailFields.regionSource : listLocationFields.regionSource,
        regionPath: detailFields.country ? detailFields.regionPath : listLocationFields.regionPath,
        regionRuleName: detailFields.country ? detailFields.regionRuleName : listLocationFields.regionRuleName,
        citySource: detailFields.city ? detailFields.citySource : listLocationFields.citySource,
        cityPath: detailFields.city ? detailFields.cityPath : listLocationFields.cityPath,
        cityRuleName: detailFields.city ? detailFields.cityRuleName : listLocationFields.cityRuleName
      };

      postings.push({
        company_name: companyNameForPostings,
        source_job_id: extractSourceIdFromPostingUrl(absoluteUrl, "jobvite"),
        position_name: cleanJobviteText(rowMatch[2]) || "Untitled Position",
        job_posting_url: absoluteUrl,
        posting_date: detailFields.postingDate || null,
        location: mergedLocation,
        source_list_location: listLocation,
        city: detailFields.city || listLocationFields.city || null,
        country: detailFields.country || listLocationFields.country || null,
        region: detailFields.region || listLocationFields.region || null,
        department: cleanJobviteText(department) || null,
        employment_type: detailFields.employmentType || null,
        source_evidence: buildJobviteSourceEvidence({
          usesDetailLocation,
          geoEvidence,
          hasDetailGeo,
          hasDetailDate,
          detailUrl: detailHtml ? absoluteUrl : ""
        })
      });
      seenUrls.add(absoluteUrl);
      rowMatch = rowPattern.exec(rowsHtml);
    }
    rowPattern.lastIndex = 0;
  };

  let tableMatch = tablePattern.exec(source);
  while (tableMatch) {
    pushRows(String(tableMatch[2] || ""), String(tableMatch[1] || ""));
    tableMatch = tablePattern.exec(source);
  }

  if (postings.length === 0) {
    pushRows(source, "");
  }

  return postings;
}


module.exports = {
  extractJobviteDetailFields,
  parseJobvitePostingsFromHtml
};
