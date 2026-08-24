"use strict";

const { decodeHtmlEntities } = require("../../parsers/shared/html");
const { isRemoteOnlyLocationValue } = require("../../parsers/shared/location");
const { extractSourceIdFromPostingUrl } = require("../../parsers/shared/sourceIds");
const { normalizeCountryFromLocation, normalizeCountryName, normalizeRemoteType } = require("../../posting");

function cleanSmartRecruitersText(value) {
  return decodeHtmlEntities(String(value || "").replace(/<[^>]+>/g, " "))
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildSmartRecruitersLocationLabel(locationObj, shortLocation) {
  const locationData = locationObj && typeof locationObj === "object" ? locationObj : {};
  const city = cleanSmartRecruitersText(locationData.city);
  const region = cleanSmartRecruitersText(locationData.region);
  const country = cleanSmartRecruitersText(locationData.country);
  const structuredParts = [city, region, country].filter(Boolean);
  const structured = structuredParts.length > 0 ? structuredParts.join(", ") : "";
  const shortValue = cleanSmartRecruitersText(shortLocation);
  if (structured && shortValue && normalizeRemoteType(shortValue) !== "unknown") {
    return `${shortValue} - ${structured}`;
  }
  return structured || shortValue || null;
}

function extractSmartRecruitersLocationParts(locationObj) {
  const locationData = locationObj && typeof locationObj === "object" ? locationObj : {};
  const city = cleanSmartRecruitersText(locationData.city);
  const region = cleanSmartRecruitersText(locationData.region);
  const country = cleanSmartRecruitersText(locationData.country);
  return {
    city: isRemoteOnlyLocationValue(city) ? "" : city,
    state: region,
    country: normalizeCountryName(country) || normalizeCountryFromLocation(country)
  };
}

function smartRecruitersRemoteEvidence(item) {
  const location = item?.location && typeof item.location === "object" ? item.location : {};
  if (location.hybrid === true || item.hybrid === true) {
    return { remoteType: "hybrid", path: location.hybrid === true ? "content[].location.hybrid" : "content[].hybrid" };
  }
  if (location.remote === true || item.remote === true || item.isRemote === true) {
    const path = location.remote === true
      ? "content[].location.remote"
      : item.remote === true
        ? "content[].remote"
        : "content[].isRemote";
    return { remoteType: "remote", path };
  }
  const raw = cleanSmartRecruitersText(item.workplaceType || item.locationType || item.remoteStatus);
  const remoteType = normalizeRemoteType(raw);
  return remoteType === "unknown"
    ? { remoteType: "", path: "" }
    : { remoteType, path: "content[].workplaceType/locationType/remoteStatus" };
}

function smartRecruitersPostingUrl(item, config) {
  for (const value of [item.postingUrl, item.applyUrl, item.jobAdUrl, item.jobUrl, item.url]) {
    const candidate = cleanSmartRecruitersText(value);
    if (candidate) return candidate;
  }
  const id = cleanSmartRecruitersText(item.id || item.uuid);
  const company = cleanSmartRecruitersText(item.company?.identifier || config?.companySlug);
  const slug = cleanSmartRecruitersText(item.name || item.title)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return id && company
    ? `https://jobs.smartrecruiters.com/${encodeURIComponent(company)}/${encodeURIComponent(id)}${slug ? `-${slug}` : ""}`
    : "";
}

function parseSmartRecruitersPostingsFromApi(companyNameForPostings, config, payload) {
  const contentItems = Array.isArray(payload?.content)
    ? payload.content
    : Array.isArray(payload?.jobs)
      ? payload.jobs
      : Array.isArray(payload)
        ? payload
        : [];
  const postings = [];
  const seenUrls = new Set();

  for (const item of contentItems) {
    if (!item || typeof item !== "object") continue;

    const rawJobUrl = smartRecruitersPostingUrl(item, config);
    if (!rawJobUrl || seenUrls.has(rawJobUrl)) continue;

    const company = item.company && typeof item.company === "object" ? item.company : {};
    const companyName =
      cleanSmartRecruitersText(companyNameForPostings) ||
      cleanSmartRecruitersText(company.name) ||
      cleanSmartRecruitersText(config?.companySlug);
    const title = cleanSmartRecruitersText(item.name || item.title) || "Untitled Position";
    const location = buildSmartRecruitersLocationLabel(item.location, item.shortLocation);
    const locationParts = extractSmartRecruitersLocationParts(item.location);
    const postedDate = cleanSmartRecruitersText(item.releasedDate || item.updatedOn || item.createdOn) || null;
    const department =
      cleanSmartRecruitersText(item.department?.label || item.department?.name || item.department) || null;
    const employmentType =
      cleanSmartRecruitersText(item.typeOfEmployment?.label || item.typeOfEmployment?.name || item.typeOfEmployment || item.employmentType) || null;
    const jobAdSections = item.jobAd?.sections && typeof item.jobAd.sections === "object" ? item.jobAd.sections : {};
    const remoteEvidence = smartRecruitersRemoteEvidence(item);

    postings.push({
      company_name: companyName,
      source_job_id:
        String(item?.id ?? item?.uuid ?? item?.refNumber ?? "").trim() ||
        extractSourceIdFromPostingUrl(rawJobUrl, "smartrecruiters"),
      id: String(item?.id ?? "").trim() || undefined,
      position_name: title,
      job_posting_url: rawJobUrl,
      apply_url: cleanSmartRecruitersText(item.applyUrl) || rawJobUrl,
      posting_date: postedDate,
      location,
      city: locationParts.city || null,
      state: locationParts.state || null,
      country: locationParts.country || null,
      department,
      employment_type: employmentType,
      workplaceType: remoteEvidence.remoteType || null,
      remote_type: remoteEvidence.remoteType || null,
      remote: remoteEvidence.remoteType === "remote",
      industry: cleanSmartRecruitersText(item.industry?.label || item.industry?.name || item.industry) || null,
      description_html: cleanSmartRecruitersText(jobAdSections.jobDescription || item.descriptionHtml) || null,
      description_plain: cleanSmartRecruitersText(item.descriptionPlain || item.description) || null,
      source_evidence: Object.freeze({
        route_kind: "smartrecruiters_search_api",
        title_source: "api",
        canonical_url_source: "api",
        location_source: item.location ? "api_location" : "",
        remote_source: remoteEvidence.remoteType ? "api_location_type" : "",
        remote_path: remoteEvidence.path
      })
    });
    seenUrls.add(rawJobUrl);
  }

  return postings;
}

module.exports = {
  parseSmartRecruitersPostingsFromApi
};
