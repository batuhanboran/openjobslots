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

    const rawJobUrl =
      cleanSmartRecruitersText(item.applyUrl) ||
      cleanSmartRecruitersText(item.ref) ||
      cleanSmartRecruitersText(item.jobUrl) ||
      cleanSmartRecruitersText(item.url);
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

    postings.push({
      company_name: companyName,
      source_job_id:
        String(item?.id ?? item?.uuid ?? item?.refNumber ?? "").trim() ||
        extractSourceIdFromPostingUrl(rawJobUrl, "smartrecruiters"),
      id: String(item?.id ?? "").trim() || undefined,
      position_name: title,
      job_posting_url: rawJobUrl,
      posting_date: postedDate,
      location,
      city: locationParts.city || null,
      state: locationParts.state || null,
      country: locationParts.country || null,
      department,
      employment_type: employmentType,
      workplaceType:
        cleanSmartRecruitersText(item.workplaceType || item.locationType || item.remoteStatus) ||
        (item.remote === true ? "remote" : null),
      remote: item.remote === true || item.isRemote === true,
      industry: cleanSmartRecruitersText(item.industry?.label || item.industry?.name || item.industry) || null,
      description_html: cleanSmartRecruitersText(jobAdSections.jobDescription || item.descriptionHtml) || null,
      description_plain: cleanSmartRecruitersText(item.descriptionPlain || item.description) || null
    });
    seenUrls.add(rawJobUrl);
  }

  return postings;
}

module.exports = {
  parseSmartRecruitersPostingsFromApi
};
