"use strict";

const { normalizeCountryFromLocation, normalizeCountryName, normalizeRemoteType } = require("../../posting");
const { isRemoteOnlyLocationValue } = require("../../parsers/shared/location");
const { extractSourceIdFromPostingUrl } = require("../../parsers/shared/sourceIds");

const ASHBY_LOCATION_HINTS = Object.freeze({
  nyc: {
    location: "New York, NY, United States",
    city: "New York",
    country: "United States",
    ruleName: "ashby_city_shorthand"
  },
  sf: {
    location: "San Francisco, CA, United States",
    city: "San Francisco",
    country: "United States",
    ruleName: "ashby_city_shorthand"
  }
});

function pushUniqueText(values, value) {
  const text = String(value || "").trim();
  if (!text) return;
  if (values.some((existing) => existing.toLowerCase() === text.toLowerCase())) return;
  values.push(text);
}

function normalizeAshbyLocationKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\./g, "")
    .replace(/\s+/g, " ");
}

function extractAshbyLocationHint(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  const exact = ASHBY_LOCATION_HINTS[normalizeAshbyLocationKey(text)];
  if (exact) return exact;
  if (/\bremote\b/i.test(text) && /\b(?:us|usa|united states)\b/i.test(text)) {
    return {
      location: text,
      city: "",
      country: "United States",
      ruleName: "ashby_remote_country_hint"
    };
  }
  return null;
}

function pushAshbyLocationName(values, value) {
  const hint = extractAshbyLocationHint(value);
  pushUniqueText(values, hint?.location || value);
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

function getAshbyPostalAddress(address) {
  if (address?.postalAddress && typeof address.postalAddress === "object") {
    return address.postalAddress;
  }
  return address && typeof address === "object" ? address : {};
}

function extractAshbyLocationName(posting) {
  const names = [];
  pushAshbyLocationName(names, posting?.locationName);
  pushAshbyLocationName(names, posting?.location);
  pushUniqueText(names, buildAddressLocationLabel(posting?.address));

  const secondary = Array.isArray(posting?.secondaryLocations) ? posting.secondaryLocations : [];
  for (const location of secondary) {
    pushAshbyLocationName(names, location?.locationName);
    pushAshbyLocationName(names, location?.location);
    pushUniqueText(names, buildAddressLocationLabel(location?.address));
  }

  return names.length > 0 ? names.join(" / ") : null;
}

function extractAshbyPrimaryLocationParts(posting) {
  const address = getAshbyPostalAddress(posting?.address);
  const rawLocation = String(posting?.locationName || posting?.location || "").trim();
  const sourceHint = extractAshbyLocationHint(rawLocation);
  const city = String(address?.addressLocality || address?.city || "").trim();
  const state = String(address?.addressRegion || address?.state || address?.region || "").trim();
  const country = String(address?.addressCountry || address?.country || "").trim();
  const structuredCountry = normalizeCountryName(country);
  const normalizedCountry = structuredCountry || normalizeCountryFromLocation(sourceHint?.location || rawLocation);
  return {
    city: sourceHint?.city !== undefined ? sourceHint.city : isRemoteOnlyLocationValue(city) ? "" : city,
    state,
    region: sourceHint?.region || "",
    country: sourceHint?.country || normalizedCountry,
    hasStructuredPhysicalLocation: Boolean(city || state || structuredCountry)
  };
}

function inferAshbyWorkplaceType(posting, primaryLocation, rawLocation) {
  const explicit = String(posting?.workplaceType || "").trim();
  if (explicit) return explicit;
  if (posting?.isRemote === true) return "Remote";
  const rawLocationRemoteType = normalizeRemoteType(rawLocation);
  if (rawLocationRemoteType === "remote" || rawLocationRemoteType === "hybrid") return rawLocationRemoteType;
  return primaryLocation?.hasStructuredPhysicalLocation ? "Onsite" : null;
}

function buildAshbySourceEvidence(primaryLocationHint, primaryRawLocation, primaryLocation, workplaceType) {
  const evidence = {};
  if (primaryLocationHint) {
    Object.assign(evidence, {
      location_source: "list_api",
      location_path: "jobs[].location",
      location_rule_name: primaryLocationHint.ruleName,
      location_raw: primaryRawLocation
    });
  }
  if (primaryLocation?.hasStructuredPhysicalLocation) {
    Object.assign(evidence, {
      location_source: "list_api",
      location_path: "jobs[].address.postalAddress",
      location_rule_name: "ashby_structured_address",
      location_raw: primaryRawLocation,
      city_source: "list_api",
      city_path: "jobs[].address.postalAddress.addressLocality",
      city_rule_name: "ashby_structured_address_city",
      country_source: "list_api",
      country_path: "jobs[].address.postalAddress.addressCountry",
      country_rule_name: "ashby_structured_address_country"
    });
  }
  if (workplaceType === "Onsite" && primaryLocation?.hasStructuredPhysicalLocation) {
    Object.assign(evidence, {
      remote_source: "list_api",
      remote_path: "jobs[].address.postalAddress",
      remote_rule_name: "ashby_structured_physical_location"
    });
  }
  return Object.keys(evidence).length > 0 ? evidence : undefined;
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
    const primaryRawLocation = String(posting?.locationName || posting?.location || "").trim();
    const primaryLocationHint = extractAshbyLocationHint(primaryRawLocation);
    const primaryLocation = extractAshbyPrimaryLocationParts(posting);
    const workplaceType = inferAshbyWorkplaceType(posting, primaryLocation, primaryRawLocation);

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
      region: primaryLocation.region || null,
      state: primaryLocation.state || null,
      country: primaryLocation.country || null,
      workplaceType,
      remote: posting?.isRemote === true,
      employment_type: String(posting?.employmentType || "").trim() || null,
      department:
        String(posting?.department || posting?.team || "").trim() ||
        teamNameById.get(String(posting?.teamId || "").trim()) ||
        null,
      description_html: String(posting?.descriptionHtml || "").trim() || null,
      description_plain: String(posting?.descriptionPlain || "").trim() || null,
      source_evidence: buildAshbySourceEvidence(primaryLocationHint, primaryRawLocation, primaryLocation, workplaceType)
    });
    seenUrls.add(jobUrl);
  }

  return collected;
}

module.exports = {
  parseAshbyPostingsFromApi
};
