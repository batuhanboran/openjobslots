"use strict";

const { decodeHtmlEntities } = require("../../parsers/shared/html");

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
    const region = cleanK12jobspotText(locationObj.regionCode);
    const postal = cleanK12jobspotText(locationObj.postalCode);
    const locationParts = [city, region, postal].filter(Boolean);
    const location = locationParts.length > 0 ? locationParts.join(", ") : null;
    const postingDate = cleanK12jobspotText(job.postedDate) || null;

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
  parseK12jobspotPostingsFromPayload
};
