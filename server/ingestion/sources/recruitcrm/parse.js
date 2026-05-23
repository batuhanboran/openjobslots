"use strict";

const { normalizeCountryFromLocation, normalizeCountryName } = require("../../posting");
const { extractSourceIdFromPostingUrl } = require("../../parsers/shared/sourceIds");

function parseUrl(urlString) {
  if (!urlString) return null;
  try {
    return new URL(urlString);
  } catch {
    return null;
  }
}

function formatRecruitCrmLocation(item) {
  const parts = extractRecruitCrmLocationParts(item);
  if (parts.locationText) return parts.locationText;
  const values = [parts.city, parts.locality, parts.state, parts.country, parts.postalCode].filter(Boolean);
  return values.length > 0 ? values.join(", ") : null;
}

function recruitCrmLocationObject(item = {}) {
  const candidates = [
    item?.location,
    item?.job_location,
    item?.jobLocation,
    item?.job_location_data,
    item?.work_location,
    item?.workLocation,
    item?.address
  ];
  for (const candidate of candidates) {
    if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) return candidate;
  }
  return {};
}

function recruitCrmLocationText(item = {}) {
  const direct = [
    item?.location,
    item?.job_location,
    item?.jobLocation,
    item?.location_name,
    item?.locationName,
    item?.work_location,
    item?.workLocation,
    item?.address
  ].find((value) => typeof value === "string" && value.trim());
  if (direct) return String(direct).trim();

  const location = recruitCrmLocationObject(item);
  return String(
    location?.name ||
      location?.label ||
      location?.display_name ||
      location?.displayName ||
      location?.formatted_address ||
      location?.formattedAddress ||
      location?.address ||
      ""
  ).trim();
}

function extractRecruitCrmLocationParts(item = {}) {
  const location = recruitCrmLocationObject(item);
  const city = String(item?.city || location?.city || location?.city_name || location?.cityName || "").trim();
  const locality = String(item?.locality || location?.locality || location?.suburb || "").trim();
  const state = String(
    item?.state ||
      item?.province ||
      item?.region ||
      item?.state_name ||
      location?.state ||
      location?.province ||
      location?.region ||
      location?.state_name ||
      location?.stateName ||
      ""
  ).trim();
  const country = String(
    item?.country ||
      item?.country_name ||
      item?.countryCode ||
      item?.country_code ||
      location?.country ||
      location?.country_name ||
      location?.countryName ||
      location?.countryCode ||
      location?.country_code ||
      ""
  ).trim();
  const postalCode = String(item?.postalcode || item?.postal_code || location?.postalcode || location?.postal_code || "").trim();
  const locationText = recruitCrmLocationText(item);
  return {
    city,
    locality,
    state,
    country,
    postalCode,
    locationText
  };
}

function normalizeRecruitCrmJobUrl(config = {}, itemUrlRaw, slug) {
  const publicJobsUrl = String(config.publicJobsUrl || "").replace(/\/+$/, "");
  const rawUrl = String(itemUrlRaw || "").trim();
  if (rawUrl) {
    const parsed = parseUrl(rawUrl);
    if (parsed?.protocol && parsed?.host) return parsed.toString();
    if (publicJobsUrl && rawUrl.startsWith("/")) {
      try {
        return new URL(rawUrl, `${publicJobsUrl}/`).toString();
      } catch {
        // Fall through to slug fallback.
      }
    }
  }
  const stableSlug = String(slug || "").trim();
  return publicJobsUrl && stableSlug ? `${publicJobsUrl}/${encodeURIComponent(stableSlug)}` : "";
}

function normalizeRecruitCrmRemoteType(item = {}) {
  const rawRemote = String(item?.remote ?? item?.is_remote ?? item?.isRemote ?? "").trim().toLowerCase();
  if (["1", "true", "yes", "remote"].includes(rawRemote)) return "remote";
  if (["0", "false", "no", "onsite", "on-site", "non-remote"].includes(rawRemote)) return "onsite";

  const workplaceType = String(item?.workplace_type || item?.workplaceType || item?.workplace_type_text || "").trim().toLowerCase();
  if (["remote", "hybrid", "onsite", "on-site"].includes(workplaceType)) {
    return workplaceType === "on-site" ? "onsite" : workplaceType;
  }
  return "";
}

function extractRecruitCrmJobs(responseJson) {
  const data = responseJson?.data;
  const candidates = [
    data?.jobs,
    data?.records,
    data?.items,
    data?.jobs?.data,
    data?.result?.jobs,
    responseJson?.jobs,
    responseJson?.records,
    responseJson?.items,
    responseJson?.result?.jobs,
    data
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
  }
  return [];
}

function isRecruitCrmPlaceholderTitle(value) {
  return /^(untitled|unknown|n\/?a|not available|job opening|new job|open position|position)$/i.test(
    String(value || "").replace(/\s+/g, " ").trim()
  );
}

function parseRecruitCrmPostingsFromApi(companyNameForPostings, config, responseJson) {
  const jobs = extractRecruitCrmJobs(responseJson);
  const postings = [];
  const seenUrls = new Set();

  for (const row of jobs) {
    const item = row && typeof row === "object" ? row : {};
    const slug = String(item?.slug || "").trim();
    const itemUrlRaw = String(item?.url || item?.job_url || item?.jobUrl || item?.public_url || item?.publicUrl || item?.apply_url || item?.applyUrl || "").trim();
    const itemUrl = normalizeRecruitCrmJobUrl(config, itemUrlRaw, slug);
    if (!itemUrl || seenUrls.has(itemUrl)) continue;

    const postingDate =
      String(
        item?.posted_at ||
          item?.published_at ||
          item?.publishedAt ||
          item?.postedAt ||
          item?.created_at ||
          item?.createdAt ||
          item?.updated_at ||
          item?.updatedAt ||
          item?.createdon ||
          item?.updatedon ||
          ""
      ).trim() || null;
    const remoteType = normalizeRecruitCrmRemoteType(item);
    const locationParts = extractRecruitCrmLocationParts(item);
    const sourceCountry = locationParts.country;
    const sourceCity = locationParts.city;
    const sourceState = locationParts.state;
    const sourceLocality = locationParts.locality;
    const sourcePostalCode = locationParts.postalCode;
    const formattedLocation = formatRecruitCrmLocation(item);
    const hasStructuredGeo = Boolean(sourceCity || sourceLocality || sourceState || sourceCountry || sourcePostalCode);
    const sourceFailureReasons = [];
    if (remoteType === "onsite" && !hasStructuredGeo && !formattedLocation) {
      sourceFailureReasons.push("no_structured_location");
    }
    const sourceJobId =
      String(item?.id ?? item?.job_id ?? item?.jobId ?? item?.uuid ?? item?.jobcode ?? item?.job_code ?? item?.code ?? slug).trim() ||
      extractSourceIdFromPostingUrl(itemUrl, "recruitcrm");
    const rawTitle = String(item?.name || item?.job_title || item?.jobTitle || item?.title || "").trim();

    postings.push({
      company_name: companyNameForPostings,
      source_job_id: sourceJobId,
      id: String(item?.id ?? item?.job_id ?? item?.jobId ?? "").trim() || undefined,
      position_name: rawTitle && !isRecruitCrmPlaceholderTitle(rawTitle) ? rawTitle : "Untitled Position",
      job_posting_url: itemUrl,
      posting_date: postingDate,
      location: remoteType === "remote" ? "Remote" : formattedLocation,
      city: sourceCity || null,
      state: sourceState || null,
      country: normalizeCountryName(sourceCountry) ||
        normalizeCountryFromLocation(sourceCountry) ||
        normalizeCountryFromLocation(formattedLocation) ||
        null,
      remote_type: remoteType || null,
      employment_type: String(item?.employment_type || item?.job_type || item?.jobType || "").trim() || null,
      department: String(item?.department?.name || item?.department || item?.team?.name || item?.team || "").trim() || null,
      source_evidence: {
        route_kind: "recruitcrm_jobs_api",
        location_source: formattedLocation ? "list_api" : "",
        location_path: formattedLocation ? "location/job_location/city/state/country" : "",
        remote_source: remoteType ? "list_api" : "",
        remote_path: remoteType ? "remote/workplace_type" : "",
        posting_date_source: postingDate ? "list_api" : "",
        posting_date_path: postingDate ? "posted_at/published_at/created_at/updated_at" : ""
      },
      source_failure_reasons: sourceFailureReasons
    });
    seenUrls.add(itemUrl);
  }

  return postings;
}

module.exports = {
  parseRecruitCrmPostingsFromApi
};
