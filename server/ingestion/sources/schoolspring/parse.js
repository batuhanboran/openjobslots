"use strict";

function parseSchoolspringPostingsFromPayload(payload) {
  const jobs = payload?.value?.jobsList;
  if (!Array.isArray(jobs)) return [];

  const postings = [];
  const seenUrls = new Set();
  for (const job of jobs) {
    const jobId = Number(job?.jobId || 0);
    if (!Number.isFinite(jobId) || jobId <= 0) continue;
    const jobPostingUrl = `https://www.schoolspring.com/job.cfm?jid=${jobId}`;
    if (seenUrls.has(jobPostingUrl)) continue;
    seenUrls.add(jobPostingUrl);

    postings.push({
      company_name: String(job?.employer || "").trim() || "Unknown Employer",
      position_name: String(job?.title || "").trim() || "Untitled Position",
      job_posting_url: jobPostingUrl,
      posting_date: String(job?.displayDate || "").trim() || null,
      location: String(job?.location || "").trim() || null
    });
  }
  return postings;
}

module.exports = {
  parseSchoolspringPostingsFromPayload
};
