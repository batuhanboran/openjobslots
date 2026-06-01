"use strict";

const { decodeHtmlEntities, extractJsonLdObjectsFromHtml } = require("../../parsers/shared/html");
const { extractSourceIdFromPostingUrl } = require("../../parsers/shared/sourceIds");
const { normalizeCountryName, normalizeRegionFromCountry } = require("../../posting");

function cleanJobviteText(value) {
  return decodeHtmlEntities(String(value || "").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .replace(/\s*,\s*/g, ", ")
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
    const country = normalizeCountryName(cleanJobviteStructuredValue(address.addressCountry));
    const label = [city, state, country].filter(Boolean).join(", ");
    const key = label.toLowerCase();
    if (!label || seen.has(key)) continue;
    seen.add(key);
    output.push({ city, state, country, label });
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
    region: country ? normalizeRegionFromCountry(country) : ""
  };
}

function jobviteListLocationLooksAmbiguous(location) {
  return /^\s*(?:\d+\s+locations?|multiple locations?|various locations?|all locations?)\s*$/i.test(cleanJobviteText(location));
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

function buildJobviteSourceEvidence({ usesDetailLocation, hasDetailGeo, hasDetailDate, detailUrl } = {}) {
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
    ...(hasDetailGeo
      ? {
          country_source: "detail_json_ld",
          country_path: "script[type='application/ld+json'].jobLocation[].address.addressCountry",
          country_rule_name: "jobvite_json_ld_country",
          region_source: "detail_json_ld",
          region_path: "script[type='application/ld+json'].jobLocation[].address.addressCountry",
          region_rule_name: "jobvite_json_ld_region",
          city_source: "detail_json_ld",
          city_path: "script[type='application/ld+json'].jobLocation[].address.addressLocality",
          city_rule_name: "jobvite_json_ld_city"
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
      const detailLocation = detailFields.location || "";
      const mergedLocation = mergeJobviteListAndDetailLocation(listLocation, detailFields);
      const usesDetailLocation = Boolean(detailLocation && mergedLocation && mergedLocation.includes(detailLocation));
      const hasDetailGeo = Boolean(detailFields.country);
      const hasDetailDate = Boolean(detailFields.postingDate);

      postings.push({
        company_name: companyNameForPostings,
        source_job_id: extractSourceIdFromPostingUrl(absoluteUrl, "jobvite"),
        position_name: cleanJobviteText(rowMatch[2]) || "Untitled Position",
        job_posting_url: absoluteUrl,
        posting_date: detailFields.postingDate || null,
        location: mergedLocation,
        source_list_location: listLocation,
        city: detailFields.city || null,
        country: detailFields.country || null,
        region: detailFields.region || null,
        department: cleanJobviteText(department) || null,
        employment_type: detailFields.employmentType || null,
        source_evidence: buildJobviteSourceEvidence({
          usesDetailLocation,
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
