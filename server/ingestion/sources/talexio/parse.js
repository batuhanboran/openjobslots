"use strict";

function parseTalexioPostingsFromApi(companyNameForPostings, config, responseJson) {
  const vacancies = Array.isArray(responseJson?.vacancies) ? responseJson.vacancies : [];
  const postings = [];
  const seenUrls = new Set();

  for (const vacancy of vacancies) {
    const item = vacancy && typeof vacancy === "object" ? vacancy : {};
    const vacancyId = String(item?.id || "").trim();
    const itemUrlRaw = String(item?.url || item?.jobUrl || item?.vacancyUrl || item?.applyUrl || "").trim();
    const itemUrl = itemUrlRaw
      ? new URL(itemUrlRaw, `${config.baseOrigin || config.jobsUrl || ""}/`).toString()
      : vacancyId
        ? `${config.jobsUrl}?vacancyId=${encodeURIComponent(vacancyId)}`
        : "";
    if (!itemUrl || seenUrls.has(itemUrl)) continue;

    const workLocation = String(item?.workLocation || "").trim();
    const country = String(item?.country || "").trim();
    const location = [workLocation, country].filter(Boolean).join(", ");
    const postingDate = String(item?.publishDate || "").trim() || null;

    postings.push({
      company_name: companyNameForPostings,
      source_job_id: vacancyId || String(item?.reference || "").trim() || undefined,
      id: vacancyId || undefined,
      position_name: String(item?.title || "").trim() || "Untitled Position",
      job_posting_url: itemUrl,
      posting_date: postingDate,
      location: location || null,
      reference: String(item?.reference || "").trim() || null,
      department: String(item?.department || "").trim() || null,
      employment_type: String(item?.jobType || "").trim() || null
    });
    seenUrls.add(itemUrl);
  }

  return postings;
}

module.exports = {
  parseTalexioPostingsFromApi
};
