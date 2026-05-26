"use strict";

const { decodeHtmlEntities } = require("../../parsers/shared/html");

const US_STATE_CODES = new Set([
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DC", "DE", "FL", "GA", "HI", "IA", "ID",
  "IL", "IN", "KS", "KY", "LA", "MA", "MD", "ME", "MI", "MN", "MO", "MS", "MT", "NC",
  "ND", "NE", "NH", "NJ", "NM", "NV", "NY", "OH", "OK", "OR", "PA", "RI", "SC", "SD",
  "TN", "TX", "UT", "VA", "VT", "WA", "WI", "WV", "WY"
]);

function cleanK12jobspotText(value) {
  return decodeHtmlEntities(String(value || "").replace(/<[^>]+>/g, " "))
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseK12jobspotPostingsFromPayload(payload) {
  if (!payload || typeof payload !== "object") return [];
  const jobs = Array.isArray(payload.jobs) ? payload.jobs : [];
  const postings = [];
  const seenUrls = new Set();

  for (const job of jobs) {
    if (!job || typeof job !== "object") continue;
    const jobId = cleanK12jobspotText(job.id);
    if (!jobId) continue;

    const jobPostingUrl = `https://www.k12jobspot.com/Job/Detail/${jobId}`;
    if (seenUrls.has(jobPostingUrl)) continue;

    const companyName = cleanK12jobspotText(job.hiringOrganization) || "Unknown Organization";
    const positionName = cleanK12jobspotText(job.title) || "Untitled Position";
    const locationObj = job.location && typeof job.location === "object" ? job.location : {};
    const city = cleanK12jobspotText(locationObj.city);
    const region = cleanK12jobspotText(locationObj.regionCode).toUpperCase();
    const postal = cleanK12jobspotText(locationObj.postalCode);
    const locationParts = [city, region, postal].filter(Boolean);
    const location = locationParts.length > 0 ? locationParts.join(", ") : null;
    const postingDate = cleanK12jobspotText(job.postedDate) || null;
    const isUsLocation = US_STATE_CODES.has(region) && Boolean(city || postal);

    postings.push({
      company_name: companyName,
      position_name: positionName,
      job_posting_url: jobPostingUrl,
      source_job_id: jobId,
      posting_date: postingDate,
      location,
      location_text: location,
      city,
      region,
      country: isUsLocation ? "United States" : "",
      postal_code: postal,
      source_evidence: {
        route_kind: "k12jobspot_public_jobs_api",
        source_job_id: {
          value: jobId,
          evidence_source: "list",
          evidence_path: "jobs[].id",
          confidence: 0.99,
          rule_name: "k12jobspot_job_id"
        },
        location: {
          value: location || "",
          evidence_source: "list",
          evidence_path: "jobs[].location",
          confidence: location ? 0.9 : 0,
          rule_name: "k12jobspot_location_object"
        },
        posting_date: {
          value: postingDate || "",
          evidence_source: postingDate ? "list" : "absent",
          evidence_path: "jobs[].postedDate",
          confidence: postingDate ? 0.9 : 0,
          rule_name: "k12jobspot_posted_date"
        }
      }
    });
    seenUrls.add(jobPostingUrl);
  }

  return postings;
}

module.exports = {
  parseK12jobspotPostingsFromPayload
};
