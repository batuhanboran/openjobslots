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
  const normalized = cleanUsajobsText(value).toLowerCase();
  if (["true", "yes", "y", "remote"].includes(normalized)) return "remote";
  return "unknown";
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
      description_plain: cleanUsajobsText(details.JobSummary || details.MajorDuties || details.Requirements || "")
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
    if (!jobPostingUrl) {
      const documentId = cleanUsajobsText(job.DocumentID);
      if (documentId) {
        jobPostingUrl = `https://www.usajobs.gov/job/${documentId}`;
      }
    }
    if (!jobPostingUrl || seenUrls.has(jobPostingUrl)) continue;

    const positionName = cleanUsajobsText(job.Title) || "Untitled Position";
    const companyName = cleanUsajobsText(job.Agency) || "Unknown Agency";
    const location = cleanUsajobsText(job.LocationName || job.Location) || null;
    const postingDate = extractUsajobsOpenDate(job.DateDisplay);

    postings.push({
      company_name: companyName,
      position_name: positionName,
      job_posting_url: jobPostingUrl,
      posting_date: postingDate,
      location
    });
    seenUrls.add(jobPostingUrl);
  }

  return postings;
}

module.exports = {
  parseUsajobsOfficialSearchPayload,
  parseUsajobsPostingsFromPayload
};
