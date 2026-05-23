"use strict";

const { normalizeCountryFromLocation, normalizeCountryName } = require("../../posting");
const { isRemoteOnlyLocationValue } = require("../../parsers/shared/location");
const { extractSourceIdFromPostingUrl } = require("../../parsers/shared/sourceIds");

function pushUniqueText(values, value) {
  const text = String(value || "").trim();
  if (!text) return;
  if (values.some((existing) => existing.toLowerCase() === text.toLowerCase())) return;
  values.push(text);
}

function buildAddressLocationLabel(address) {
  const postalAddress = address?.postalAddress && typeof address.postalAddress === "object"
    ? address.postalAddress
    : address && typeof address === "object"
      ? address
      : {};
  const city = String(postalAddress?.addressLocality || postalAddress?.city || "").trim();
  const state = String(postalAddress?.addressRegion || postalAddress?.state || postalAddress?.region || "").trim();
  const country = String(postalAddress?.addressCountry || postalAddress?.country || "").trim();
  const parts = [city, state, country].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : "";
}

function extractAshbyLocationName(posting) {
  const names = [];
  pushUniqueText(names, posting?.locationName);
  pushUniqueText(names, posting?.location);
  pushUniqueText(names, buildAddressLocationLabel(posting?.address));

  const secondary = Array.isArray(posting?.secondaryLocations) ? posting.secondaryLocations : [];
  for (const location of secondary) {
    pushUniqueText(names, location?.locationName);
    pushUniqueText(names, location?.location);
    pushUniqueText(names, buildAddressLocationLabel(location?.address));
  }

  return names.length > 0 ? names.join(" / ") : null;
}

function extractAshbyPrimaryLocationParts(posting) {
  const address = posting?.address && typeof posting.address === "object" ? posting.address : {};
  const rawLocation = String(posting?.locationName || posting?.location || "").trim();
  const city = String(address?.addressLocality || address?.city || "").trim();
  const state = String(address?.addressRegion || address?.state || address?.region || "").trim();
  const country = String(address?.addressCountry || address?.country || "").trim();
  return {
    city: isRemoteOnlyLocationValue(city) ? "" : city,
    state,
    country: normalizeCountryName(country) || normalizeCountryFromLocation(rawLocation)
  };
}

function buildAshbyJobUrl(organizationHostedJobsPageName, jobId) {
  if (!organizationHostedJobsPageName || !jobId) return "";
  return `https://jobs.ashbyhq.com/${organizationHostedJobsPageName}/${jobId}`;
}

function parseAshbyPostingsFromApi(companyNameForPostings, config, response) {
  const graphQlJobBoard = response?.data?.jobBoard;
  const jobPostings = Array.isArray(graphQlJobBoard?.jobPostings)
    ? graphQlJobBoard.jobPostings
    : Array.isArray(response?.jobs)
      ? response.jobs
      : [];
  const teams = Array.isArray(graphQlJobBoard?.teams) ? graphQlJobBoard.teams : [];
  const teamNameById = new Map(
    teams
      .map((team) => [String(team?.id || "").trim(), String(team?.externalName || team?.name || "").trim()])
      .filter(([id, name]) => id && name)
  );
  const companyName = String(companyNameForPostings || config?.organizationHostedJobsPageNameLower || "").trim();
  const collected = [];
  const seenUrls = new Set();

  for (const posting of jobPostings) {
    const jobId = String(posting?.id || "").trim();
    const jobUrl = String(posting?.jobUrl || "").trim() || buildAshbyJobUrl(config?.organizationHostedJobsPageName, jobId);
    if (!jobUrl || seenUrls.has(jobUrl)) continue;
    const primaryLocation = extractAshbyPrimaryLocationParts(posting);

    collected.push({
      company_name: companyName,
      source_job_id: jobId || extractSourceIdFromPostingUrl(jobUrl, "ashby"),
      id: jobId || undefined,
      position_name: String(posting?.title || "").trim() || "Untitled Position",
      job_posting_url: jobUrl,
      apply_url: String(posting?.applyUrl || "").trim() || jobUrl,
      posting_date: String(posting?.publishedAt || posting?.createdAt || "").trim() || null,
      location: extractAshbyLocationName(posting),
      city: primaryLocation.city || null,
      state: primaryLocation.state || null,
      country: primaryLocation.country || null,
      workplaceType: String(posting?.workplaceType || "").trim() || (posting?.isRemote === true ? "Remote" : null),
      remote: posting?.isRemote === true,
      employment_type: String(posting?.employmentType || "").trim() || null,
      department:
        String(posting?.department || posting?.team || "").trim() ||
        teamNameById.get(String(posting?.teamId || "").trim()) ||
        null,
      description_html: String(posting?.descriptionHtml || "").trim() || null,
      description_plain: String(posting?.descriptionPlain || "").trim() || null
    });
    seenUrls.add(jobUrl);
  }

  return collected;
}

module.exports = {
  parseAshbyPostingsFromApi
};
