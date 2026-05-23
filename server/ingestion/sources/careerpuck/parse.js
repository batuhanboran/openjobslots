"use strict";

function parseCareerpuckPostingsFromApi(companyNameForPostings, responseJson) {
  const jobs = Array.isArray(responseJson?.jobs) ? responseJson.jobs : [];
  const postings = [];
  const seenUrls = new Set();

  for (const job of jobs) {
    const status = String(job?.status || "").trim().toLowerCase();
    if (status && status !== "public") continue;

    const publicUrl = String(job?.publicUrl || "").trim();
    const applyUrl = String(job?.applyUrl || "").trim();
    const jobUrl = publicUrl || applyUrl;
    if (!jobUrl || seenUrls.has(jobUrl)) continue;

    const title = String(job?.title || "").trim() || "Untitled Position";
    const location = String(job?.location || "").trim() || null;
    const postingDate = String(job?.postedAt || "").trim() || null;
    const departmentNames = Array.isArray(job?.departments)
      ? job.departments
          .map((item) => String(item?.name || "").trim())
          .filter(Boolean)
      : [];

    postings.push({
      company_name: companyNameForPostings,
      position_name: title,
      job_posting_url: jobUrl,
      posting_date: postingDate,
      location,
      department: departmentNames.length > 0 ? departmentNames.join(" / ") : null
    });
    seenUrls.add(jobUrl);
  }

  return postings;
}

module.exports = {
  parseCareerpuckPostingsFromApi
};
