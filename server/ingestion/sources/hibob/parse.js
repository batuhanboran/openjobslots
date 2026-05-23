"use strict";

function cleanText(value) {
  return String(value || "").trim();
}

function parseHibobPostingsFromApi(companyName, config, responseJson) {
  if (!responseJson || typeof responseJson !== "object") return [];
  const postings = [];
  const seenUrls = new Set();
  const jobAds = Array.isArray(responseJson.jobAdDetails) ? responseJson.jobAdDetails : [];

  for (const item of jobAds) {
    if (!item || typeof item !== "object") continue;
    const jobId = cleanText(item.id);
    if (!jobId) continue;

    const postingUrl = cleanText(item.jobUrl) || cleanText(item.absoluteUrl) || cleanText(item.url);
    const urlValue = postingUrl || `${config.baseOrigin}/job/${jobId}`;
    if (!urlValue || seenUrls.has(urlValue)) continue;

    const title = cleanText(item.title) || "Untitled Position";
    const location = cleanText(item.site) || cleanText(item.country) || null;
    const postingDate = cleanText(item.publishedAt) || null;

    postings.push({
      company_name: companyName,
      position_name: title,
      job_posting_url: urlValue,
      posting_date: postingDate,
      location
    });
    seenUrls.add(urlValue);
  }

  return postings;
}

module.exports = {
  parseHibobPostingsFromApi
};
