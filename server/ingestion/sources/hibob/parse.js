"use strict";

const {
  normalizeCountryFromLocation,
  normalizeCountryName,
  normalizeRemoteType,
  normalizeRemoteTypeFromEvidence
} = require("../../posting");

function cleanText(value) {
  return String(value || "").trim();
}

function extractCountry(item, location) {
  return normalizeCountryName(item?.country) || normalizeCountryFromLocation(location);
}

function extractCityFromSite(site, country) {
  const location = cleanText(site);
  if (!location) return null;
  const firstSegment = cleanText(location.split(/\s*,\s*/)[0]);
  if (!firstSegment) return null;
  if (/^(remote|hybrid|onsite|on[- ]?site|worldwide|anywhere)$/i.test(firstSegment)) return null;
  if (/^\(?\s*(multiple|various|several|all)\b/i.test(firstSegment)) return null;
  if (normalizeCountryName(firstSegment)) return null;
  if (country && firstSegment.toLowerCase() === cleanText(country).toLowerCase()) return null;
  return firstSegment;
}

function extractRemoteType(item, location, country) {
  const explicitRemoteSignal = cleanText(
    item?.remoteType ||
    item?.remote_type ||
    item?.locationType ||
    item?.location_type ||
    item?.workplaceType ||
    item?.workplace_type
  );
  const explicitRemoteType = normalizeRemoteType(explicitRemoteSignal);
  if (explicitRemoteType !== "unknown") return explicitRemoteType;
  if (location || country) return normalizeRemoteTypeFromEvidence("onsite", location || country);
  return null;
}

function parseHibobPostingsFromApi(companyName, config, responseJson) {
  if (!responseJson || typeof responseJson !== "object") return [];
  const postings = [];
  const seenUrls = new Set();
  const jobAds = Array.isArray(responseJson.jobAdDetails) ? responseJson.jobAdDetails : [];

  for (const item of jobAds) {
    if (!item || typeof item !== "object") continue;
    const jobId = cleanText(item.id);
    if (!jobId) continue;

    const postingUrl = cleanText(item.jobUrl) || cleanText(item.absoluteUrl) || cleanText(item.url);
    const urlValue = postingUrl || `${config.baseOrigin}/job/${jobId}`;
    if (!urlValue || seenUrls.has(urlValue)) continue;

    const title = cleanText(item.title) || "Untitled Position";
    const location = cleanText(item.site) || cleanText(item.country) || null;
    const country = extractCountry(item, location);
    const city = extractCityFromSite(item.site, country);
    const remoteType = extractRemoteType(item, location, country);
    const postingDate = cleanText(item.publishedAt) || null;

    postings.push({
      id: jobId,
      source_job_id: jobId,
      company_name: companyName,
      position_name: title,
      job_posting_url: urlValue,
      posting_date: postingDate,
      location,
      country,
      city,
      remote_type: remoteType,
      source_evidence: {
        route_kind: "hibob_job_ad_api",
        list_url: cleanText(config.apiUrl),
        title_path: "jobAdDetails[].title",
        company_path: "company.company_name",
        canonical_url_path: postingUrl ? "jobAdDetails[].jobUrl|absoluteUrl|url" : "derived:/job/{id}",
        source_job_id_path: "jobAdDetails[].id",
        location_path: cleanText(item.site) ? "jobAdDetails[].site" : "jobAdDetails[].country",
        country_path: cleanText(item.country) ? "jobAdDetails[].country" : "jobAdDetails[].site",
        city_path: city ? "jobAdDetails[].site" : "source_absent",
        remote_path: remoteType ? (cleanText(item.locationType || item.location_type || item.remoteType || item.remote_type || item.workplaceType || item.workplace_type) ? "jobAdDetails[].remoteType" : "jobAdDetails[].site") : "source_absent",
        remote_rule_name: remoteType ? "hibob_source_location_physical" : "source_remote_type_absent",
        posting_date_path: postingDate ? "jobAdDetails[].publishedAt" : "source_absent",
        posting_date_rule_name: postingDate ? "hibob_published_at" : "source_posting_date_absent"
      }
    });
    seenUrls.add(urlValue);
  }

  return postings;
}

module.exports = {
  parseHibobPostingsFromApi
};
