"use strict";

function cleanSchoolspringText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function extractSchoolspringSourceId(value) {
  const raw = cleanSchoolspringText(value);
  if (!raw) return "";
  const numeric = Number(raw);
  if (Number.isFinite(numeric) && numeric > 0) return String(Math.trunc(numeric));
  return raw;
}

function inferSchoolspringRemoteType(job = {}) {
  const evidence = [
    job?.remote_type,
    job?.remote,
    job?.workplaceType,
    job?.location,
    job?.title
  ].map(cleanSchoolspringText).filter(Boolean).join(" ").toLowerCase();

  if (/\bhybrid\b/.test(evidence)) return "hybrid";
  if (/\bremote\b/.test(evidence)) return "remote";
  if (cleanSchoolspringText(job?.location)) return "onsite";
  return "unknown";
}

function parseSchoolspringPostingsFromPayload(payload) {
  const jobs = payload?.value?.jobsList;
  if (!Array.isArray(jobs)) return [];

  const postings = [];
  const seenUrls = new Set();
  for (const job of jobs) {
    const sourceJobId = extractSchoolspringSourceId(job?.jobId);
    if (!sourceJobId) continue;
    const jobPostingUrl = `https://www.schoolspring.com/job.cfm?jid=${sourceJobId}`;
    if (seenUrls.has(jobPostingUrl)) continue;
    seenUrls.add(jobPostingUrl);

    const location = cleanSchoolspringText(job?.location) || null;
    const postingDate = cleanSchoolspringText(job?.displayDate) || null;

    postings.push({
      source_job_id: sourceJobId,
      company_name: cleanSchoolspringText(job?.employer) || "Unknown Employer",
      position_name: cleanSchoolspringText(job?.title) || "Untitled Position",
      job_posting_url: jobPostingUrl,
      posting_date: postingDate,
      location,
      remote_type: inferSchoolspringRemoteType(job),
      source_evidence: {
        source_job_id_path: "value.jobsList[].jobId",
        title_source: "list_api",
        title_path: "value.jobsList[].title",
        company_source: "list_api",
        company_path: "value.jobsList[].employer",
        location_source: location ? "list_api" : "",
        location_path: location ? "value.jobsList[].location" : "",
        posting_date_source: postingDate ? "list_api" : "",
        posting_date_path: postingDate ? "value.jobsList[].displayDate" : "",
        remote_source: "list_api",
        remote_path: "value.jobsList[].location/title"
      }
    });
  }
  return postings;
}

module.exports = {
  cleanSchoolspringText,
  extractSchoolspringSourceId,
  inferSchoolspringRemoteType,
  parseSchoolspringPostingsFromPayload
};
