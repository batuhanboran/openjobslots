"use strict";

const { decodeHtmlEntities } = require("../../parsers/shared/html");

const { normalizeCountryName } = require("../../posting");

function cleanUsajobsText(value) {
  return decodeHtmlEntities(String(value || "").replace(/<[^>]+>/g, " "))
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractUsajobsOpenDate(dateDisplay) {
  const raw = cleanUsajobsText(dateDisplay);
  if (!raw) return null;
  const match = raw.match(/open\s+(\d{2}\/\d{2}\/\d{4})\s+to/i);
  return match?.[1] || null;
}

function normalizeUsajobsRemoteType(value) {
  if (value === true) return "remote";
  if (value === false) return "onsite";
  const normalized = cleanUsajobsText(value).toLowerCase();
  if (["true", "yes", "y", "remote"].includes(normalized)) return "remote";
  if (["false", "no", "n", "onsite", "on-site", "not remote"].includes(normalized)) return "onsite";
  return "unknown";
}

function firstPresent(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && cleanUsajobsText(value) !== "") return value;
  }
  return "";
}

function getUsajobsStructuredLocation(descriptor = {}) {
  const locations = Array.isArray(descriptor.PositionLocation) ? descriptor.PositionLocation : [];
  const first = locations.find((location) => location && typeof location === "object") || {};
  const city = cleanUsajobsText(first.CityName);
  const region = cleanUsajobsText(first.CountrySubDivisionCode || first.CountrySubDivision);
  const countryCode = cleanUsajobsText(first.CountryCode);
  const country = countryCode ? normalizeCountryName(countryCode) : cleanUsajobsText(first.CountryName);
  const display = cleanUsajobsText(descriptor.PositionLocationDisplay);
  const location = display || [city, region, country].filter(Boolean).join(", ");
  return { city, region, country, location };
}

function parseUsajobsOfficialSearchPayload(payload) {
  const items = Array.isArray(payload?.SearchResult?.SearchResultItems)
    ? payload.SearchResult.SearchResultItems
    : [];
  const postings = [];
  const seenUrls = new Set();
  for (const item of items) {
    const descriptor = item?.MatchedObjectDescriptor;
    if (!descriptor || typeof descriptor !== "object") continue;
    const sourceJobId = cleanUsajobsText(descriptor.PositionID || descriptor.DocumentID || descriptor.MatchedObjectId);
    let jobPostingUrl = cleanUsajobsText(descriptor.PositionURI);
    if (!jobPostingUrl && sourceJobId) jobPostingUrl = `https://www.usajobs.gov/job/${sourceJobId}`;
    if (!jobPostingUrl || seenUrls.has(jobPostingUrl)) continue;

    const details = descriptor.UserArea?.Details || {};
    const location = getUsajobsStructuredLocation(descriptor);

    postings.push({
      company_name: cleanUsajobsText(descriptor.OrganizationName || descriptor.DepartmentName) || "Unknown Agency",
      position_name: cleanUsajobsText(descriptor.PositionTitle) || "Untitled Position",
      job_posting_url: jobPostingUrl,
      source_job_id: sourceJobId,
      posting_date: cleanUsajobsText(descriptor.PublicationStartDate),
      location: location.location || null,
      city: location.city || null,
      region: location.region || null,
      country: location.country || null,
      remote_type: normalizeUsajobsRemoteType(details.RemoteIndicator),
      description_plain: cleanUsajobsText(details.JobSummary || details.MajorDuties || details.Requirements || ""),
      source_evidence: {
        route_kind: "usajobs_official_search_api",
        list_url: "https://data.usajobs.gov/api/Search",
        title_path: "SearchResultItems[].MatchedObjectDescriptor.PositionTitle",
        company_path: "SearchResultItems[].MatchedObjectDescriptor.OrganizationName|DepartmentName",
        canonical_url_path: cleanUsajobsText(descriptor.PositionURI)
          ? "SearchResultItems[].MatchedObjectDescriptor.PositionURI"
          : "derived:/job/{PositionID|DocumentID|MatchedObjectId}",
        source_job_id_path: "SearchResultItems[].MatchedObjectDescriptor.PositionID|DocumentID|MatchedObjectId",
        location_path: location.location ? "SearchResultItems[].MatchedObjectDescriptor.PositionLocationDisplay|PositionLocation[]" : "source_absent",
        country_path: location.country ? "SearchResultItems[].MatchedObjectDescriptor.PositionLocation[].CountryCode|CountryName" : "source_absent",
        city_path: location.city ? "SearchResultItems[].MatchedObjectDescriptor.PositionLocation[].CityName" : "source_absent",
        remote_path: details.RemoteIndicator === undefined ? "source_absent" : "SearchResultItems[].MatchedObjectDescriptor.UserArea.Details.RemoteIndicator",
        remote_rule_name: details.RemoteIndicator === undefined ? "source_remote_type_absent" : "usajobs_remote_indicator",
        posting_date_path: cleanUsajobsText(descriptor.PublicationStartDate)
          ? "SearchResultItems[].MatchedObjectDescriptor.PublicationStartDate"
          : "source_absent",
        posting_date_rule_name: cleanUsajobsText(descriptor.PublicationStartDate)
          ? "usajobs_publication_start_date"
          : "source_posting_date_absent"
      }
    });
    seenUrls.add(jobPostingUrl);
  }
  return postings;
}

function parseUsajobsPostingsFromPayload(payload) {
  if (!payload || typeof payload !== "object") return [];
  const officialPostings = parseUsajobsOfficialSearchPayload(payload);
  if (officialPostings.length > 0) return officialPostings;
  const jobs = Array.isArray(payload.Jobs) ? payload.Jobs : [];
  const postings = [];
  const seenUrls = new Set();

  for (const job of jobs) {
    if (!job || typeof job !== "object") continue;

    let jobPostingUrl = cleanUsajobsText(job.PositionURI);
    const sourceJobId = cleanUsajobsText(job.DocumentID || job.PositionID || job.MatchedObjectId);
    if (!jobPostingUrl) {
      if (sourceJobId) {
        jobPostingUrl = `https://www.usajobs.gov/job/${sourceJobId}`;
      }
    }
    if (!jobPostingUrl || seenUrls.has(jobPostingUrl)) continue;

    const positionName = cleanUsajobsText(job.Title) || "Untitled Position";
    const companyName = cleanUsajobsText(job.Agency) || "Unknown Agency";
    const location = cleanUsajobsText(job.LocationName || job.Location) || null;
    const postingDate = extractUsajobsOpenDate(job.DateDisplay);
    const remoteSignal = firstPresent(job.RemoteIndicator, job.RemoteJob, job.IsRemote);

    postings.push({
      company_name: companyName,
      position_name: positionName,
      job_posting_url: jobPostingUrl,
      source_job_id: sourceJobId,
      posting_date: postingDate,
      location,
      remote_type: normalizeUsajobsRemoteType(remoteSignal),
      source_evidence: {
        route_kind: "usajobs_legacy_search_payload",
        list_url: "https://data.usajobs.gov/api/Search",
        title_path: "Jobs[].Title",
        company_path: "Jobs[].Agency",
        canonical_url_path: cleanUsajobsText(job.PositionURI) ? "Jobs[].PositionURI" : "derived:/job/{DocumentID|PositionID|MatchedObjectId}",
        source_job_id_path: sourceJobId ? "Jobs[].DocumentID|PositionID|MatchedObjectId" : "source_absent",
        location_path: location ? "Jobs[].LocationName|Location" : "source_absent",
        country_path: location ? "Jobs[].LocationName|Location" : "source_absent",
        city_path: location ? "Jobs[].LocationName|Location" : "source_absent",
        remote_path: cleanUsajobsText(remoteSignal)
          ? "Jobs[].RemoteIndicator|RemoteJob|IsRemote"
          : "source_absent",
        remote_rule_name: cleanUsajobsText(remoteSignal)
          ? "usajobs_remote_indicator"
          : "source_remote_type_absent",
        posting_date_path: postingDate ? "Jobs[].DateDisplay" : "source_absent",
        posting_date_rule_name: postingDate ? "usajobs_date_display_open_date" : "source_posting_date_absent"
      }
    });
    seenUrls.add(jobPostingUrl);
  }

  return postings;
}

module.exports = {
  parseUsajobsOfficialSearchPayload,
  parseUsajobsPostingsFromPayload
};
