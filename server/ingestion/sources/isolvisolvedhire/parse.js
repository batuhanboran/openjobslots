"use strict";

const { extractSourceIdFromPostingUrl } = require("../../parsers/shared/sourceIds");

function cleanText(value) {
  return String(value || "").trim();
}

function extractIsolvisolvedhireDomainId(pageHtml) {
  const page = String(pageHtml || "");
  const routeDataMatch = page.match(/courierCurrentRouteData\s*=\s*(\{[\s\S]*?\});/i);
  if (routeDataMatch) {
    try {
      const parsed = JSON.parse(routeDataMatch[1]);
      const domainId = cleanText(parsed?.domain_id);
      if (domainId) return domainId;
    } catch {}
  }

  const directMatch = page.match(/"domain_id"\s*:\s*"?(?<id>\d+)"?/i);
  if (directMatch?.groups?.id) return cleanText(directMatch.groups.id);
  return "";
}

function parseIsolvisolvedhirePostingsFromApi(companyName, responseJson) {
  if (!responseJson || typeof responseJson !== "object") return [];
  const jobs = Array.isArray(responseJson?.data?.jobs) ? responseJson.data.jobs : [];
  const postings = [];
  const seenUrls = new Set();

  for (const job of jobs) {
    if (!job || typeof job !== "object") continue;
    const postingUrl = cleanText(job.jobUrl) || "";
    if (!postingUrl || seenUrls.has(postingUrl)) continue;
    const sourceJobId =
      cleanText(job.id) ||
      cleanText(job.jobId) ||
      extractSourceIdFromPostingUrl(postingUrl, "isolvisolvedhire");

    postings.push({
      company_name: companyName,
      source_job_id: sourceJobId,
      id: sourceJobId || undefined,
      position_name: cleanText(job.title) || "Untitled Position",
      job_posting_url: postingUrl,
      posting_date: cleanText(job.startDateRef) || null,
      location: cleanText(job.jobLocation) || null
    });
    seenUrls.add(postingUrl);
  }
  return postings;
}

module.exports = {
  extractIsolvisolvedhireDomainId,
  parseIsolvisolvedhirePostingsFromApi
};
