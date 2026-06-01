"use strict";

const { decodeHtmlEntities } = require("../../parsers/shared/html");
const { normalizeCountryName, normalizeRemoteType } = require("../../posting");

function cleanDayforceText(value) {
  return decodeHtmlEntities(String(value || "").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function uniqueClean(values) {
  return Array.from(new Set(values.map(cleanDayforceText).filter(Boolean)));
}

function countryFromLocation(location = {}) {
  return normalizeCountryName(
    location.isoCountryCode ||
    location.countryCode ||
    location.country ||
    location.countryName ||
    ""
  );
}

function compactLocation(location = {}) {
  const country = countryFromLocation(location);
  const city = cleanDayforceText(location.cityName || location.city || "");
  const state = cleanDayforceText(location.stateCode || location.state || "");
  if (city || state || country) return [city, state, country].filter(Boolean).join(", ");
  return cleanDayforceText(location.formattedAddress || "");
}

function summarizeDayforceLocations(job = {}) {
  const locations = Array.isArray(job.postingLocations)
    ? job.postingLocations.filter((location) => location && typeof location === "object")
    : [];
  const locationTexts = uniqueClean(locations.map(compactLocation));
  const countries = uniqueClean(locations.map(countryFromLocation));
  const cities = uniqueClean(locations.map((location) => location.cityName || location.city || ""));
  const states = uniqueClean(locations.map((location) => location.stateCode || location.state || ""));

  if (job.hasVirtualLocation === true && countries.length === 1) {
    return {
      location: `Virtual, ${countries[0]}`,
      country: countries[0],
      city: "",
      state: "",
      locationCount: locations.length
    };
  }

  return {
    location: locationTexts.join("; "),
    country: countries.length === 1 ? countries[0] : "",
    city: cities.length === 1 ? cities[0] : "",
    state: states.length === 1 ? states[0] : "",
    locationCount: locations.length
  };
}

function inferDayforceRemoteType(job = {}, locationSummary = {}) {
  if (job.hasVirtualLocation === true) {
    return {
      value: "remote",
      path: "jobPostings[].hasVirtualLocation",
      ruleName: "dayforce_virtual_location_true"
    };
  }

  const locationRemoteType = normalizeRemoteType(locationSummary.location || "");
  if (locationRemoteType === "remote" || locationRemoteType === "hybrid") {
    return {
      value: locationRemoteType,
      path: "jobPostings[].postingLocations[].formattedAddress",
      ruleName: "dayforce_location_work_mode_text"
    };
  }

  if (locationSummary.locationCount > 0 && locationSummary.country) {
    return {
      value: "onsite",
      path: "jobPostings[].postingLocations[]",
      ruleName: "dayforce_structured_physical_location"
    };
  }

  return {
    value: "",
    path: "",
    ruleName: ""
  };
}

function parseDayforceHcmPostingsFromApi(companyNameForPostings, config = {}, payload = {}) {
  const jobs = Array.isArray(payload?.jobPostings) ? payload.jobPostings : [];
  const postings = [];
  const seenIds = new Set();
  const companyName = cleanDayforceText(companyNameForPostings || config.clientNamespace || "dayforcehcm");
  const boardUrl = String(config.boardUrl || "").replace(/\/+$/, "");

  for (const job of jobs) {
    if (!job || typeof job !== "object") continue;
    const jobPostingId = cleanDayforceText(job.jobPostingId || "");
    const jobReqId = cleanDayforceText(job.jobReqId || "");
    const sourceJobId = jobPostingId || jobReqId;
    const dedupeId = sourceJobId.toLowerCase();
    if (!sourceJobId || seenIds.has(dedupeId)) continue;

    const title = cleanDayforceText(job.jobTitle || "");
    if (!title) continue;

    const canonicalUrl = boardUrl && jobPostingId
      ? `${boardUrl}/jobs/${encodeURIComponent(jobPostingId)}`
      : "";
    if (!canonicalUrl) continue;

    const locationSummary = summarizeDayforceLocations(job);
    const remoteType = inferDayforceRemoteType(job, locationSummary);
    const postingDate = cleanDayforceText(job.postingStartTimestampUTC || "") || null;

    postings.push({
      company_name: companyName,
      source_job_id: sourceJobId,
      id: sourceJobId,
      position_name: title,
      job_posting_url: canonicalUrl,
      posting_date: postingDate,
      location: locationSummary.location || null,
      city: locationSummary.city || null,
      state: locationSummary.state || null,
      country: locationSummary.country || null,
      remote_type: remoteType.value || null,
      remote: remoteType.value === "remote",
      is_remote: remoteType.value === "remote" || remoteType.value === "hybrid",
      description_html: cleanDayforceText(job.jobDescription || "") || null,
      expiration_date: cleanDayforceText(job.postingExpiryTimestampUTC || "") || null,
      source_evidence: {
        route_kind: "dayforce_jobposting_search_api",
        list_url: config.apiUrl || null,
        canonical_url_source: "url",
        canonical_url_path: "/:culture/:clientNamespace/:jobBoardCode/jobs/:jobPostingId",
        source_job_id_source: "list_api",
        source_job_id_path: jobPostingId ? "jobPostings[].jobPostingId" : "jobPostings[].jobReqId",
        req_id: jobReqId || null,
        ...(locationSummary.location
          ? {
              location_source: "list_api",
              location_path: "jobPostings[].postingLocations[]",
              location_rule_name: job.hasVirtualLocation === true
                ? "dayforce_virtual_country_location"
                : "dayforce_structured_posting_locations",
              location_raw: locationSummary.location
            }
          : {}),
        ...(locationSummary.country
          ? {
              country_source: "list_api",
              country_path: "jobPostings[].postingLocations[].isoCountryCode",
              country_rule_name: "dayforce_location_iso_country"
            }
          : {}),
        ...(locationSummary.city
          ? {
              city_source: "list_api",
              city_path: "jobPostings[].postingLocations[].cityName",
              city_rule_name: "dayforce_location_city"
            }
          : {}),
        ...(remoteType.value
          ? {
              remote_source: "list_api",
              remote_path: remoteType.path,
              remote_rule_name: remoteType.ruleName
            }
          : {}),
        ...(postingDate
          ? {
              posting_date_source: "list_api",
              posting_date_path: "jobPostings[].postingStartTimestampUTC",
              posting_date_rule_name: "dayforce_posting_start_timestamp"
            }
          : {
              posting_date_source: "source_posting_date_absent"
            })
      }
    });
    seenIds.add(dedupeId);
  }

  return postings;
}

module.exports = {
  cleanDayforceText,
  parseDayforceHcmPostingsFromApi,
  summarizeDayforceLocations
};
