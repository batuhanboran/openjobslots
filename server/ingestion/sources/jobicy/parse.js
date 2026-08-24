"use strict";

const { normalizeCountryFromLocation, normalizeCountryName } = require("../../posting");

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function firstText(value) {
  if (Array.isArray(value)) return clean(value[0]);
  return clean(value);
}

function sourceIssuedId(job = {}) {
  for (const candidate of [job.id, job.guid]) {
    const value = clean(candidate);
    if (value && !/^https?:\/\//i.test(value)) return value;
  }
  return "";
}

function parseJobicyPostingsFromApi(rawPayload) {
  const jobs = Array.isArray(rawPayload?.jobs) ? rawPayload.jobs : [];
  const postings = [];
  const seenUrls = new Set();

  for (const job of jobs) {
    if (!job || typeof job !== "object") continue;
    const jobUrl = clean(job.url);
    const title = clean(job.jobTitle || job.title);
    const companyName = clean(job.companyName || job.company);
    // A canonical URL is useful for dedupe, but it is not source identity
    // evidence. Only accept an identifier that Jobicy supplied explicitly.
    const sourceJobId = sourceIssuedId(job);
    if (!jobUrl || !title || !companyName || !sourceJobId || seenUrls.has(jobUrl)) continue;

    const location = clean(job.jobGeo || job.location || "Anywhere") || "Anywhere";
    const country = normalizeCountryName(location) || normalizeCountryFromLocation(location) || null;
    const industry = firstText(job.jobIndustry || job.industry);
    const employmentType = Array.isArray(job.jobType)
      ? job.jobType.map(clean).filter(Boolean).join(", ")
      : clean(job.jobType || job.employmentType);

    postings.push({
      source_job_id: sourceJobId,
      id: sourceJobId,
      company_name: companyName,
      position_name: title,
      job_posting_url: jobUrl,
      apply_url: jobUrl,
      posting_date: clean(job.pubDate || job.publishedDate || job.created_at) || null,
      location,
      country,
      remote_type: "remote",
      department: industry || null,
      employment_type: employmentType || null,
      seniority: firstText(job.jobLevel || job.seniority) || null,
      description_html: clean(job.jobDescription || job.description) || null,
      description_plain: clean(job.jobExcerpt || job.excerpt) || null,
      source_evidence: Object.freeze({
        route_kind: "jobicy_public_api",
        original_source: "Jobicy",
        attribution_required: true,
        title_source: "api",
        canonical_url_source: "api_jobicy_url",
        location_source: "api_job_geo",
        remote_source: "board_is_remote_only",
        posting_date_source: job.pubDate ? "api_pub_date" : ""
      })
    });
    seenUrls.add(jobUrl);
  }

  return postings;
}

module.exports = { parseJobicyPostingsFromApi };
