"use strict";

const { decodeHtmlEntities } = require("../../parsers/shared/html");

function cleanGovernmentJobsText(value) {
  return decodeHtmlEntities(String(value || "").replace(/<[^>]+>/g, " "))
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractGovernmentJobsLastPage(viewHtml) {
  const source = String(viewHtml || "");
  const pageValues = [];
  const pageRegex = /[?&]page=(\d+)/gi;
  let match = pageRegex.exec(source);
  while (match) {
    const pageNumber = Number.parseInt(String(match[1] || "").trim(), 10);
    if (Number.isFinite(pageNumber) && pageNumber > 0) {
      pageValues.push(pageNumber);
    }
    match = pageRegex.exec(source);
  }
  return pageValues.length > 0 ? Math.max(...pageValues) : 1;
}

function extractGovernmentJobsViewHtmlFromResponse(response, bodyText) {
  const contentType = String(response?.headers?.get("content-type") || "").toLowerCase();
  const rawBody = String(bodyText || "");
  if (!contentType.includes("application/json")) {
    return rawBody;
  }
  try {
    const parsed = JSON.parse(rawBody);
    if (parsed && typeof parsed === "object") {
      return String(parsed.view1 || "");
    }
  } catch {
    return "";
  }
  return "";
}

function parseGovernmentJobsPostingsFromViewHtml(viewHtml) {
  const source = String(viewHtml || "");
  if (!source) return [];

  const postings = [];
  const seenUrls = new Set();
  const itemRegex = /<li[^>]*class=["'][^"']*\bjob-item\b[^"']*["'][^>]*>([\s\S]*?)<\/li>/gi;
  const linkRegex =
    /<a[^>]*class=["'][^"']*\bjob-details-link\b[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i;
  const orgRegex = /<div[^>]*class=["'][^"']*\bjob-organization\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i;
  const locationRegex = /<span[^>]*class=["'][^"']*\bjob-location\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i;

  let itemMatch = itemRegex.exec(source);
  while (itemMatch) {
    const itemHtml = String(itemMatch[1] || "");
    const linkMatch = linkRegex.exec(itemHtml);
    if (!linkMatch) {
      itemMatch = itemRegex.exec(source);
      continue;
    }

    const href = cleanGovernmentJobsText(linkMatch[1]).replace(/\s+/g, "");
    const jobPostingUrl = href ? new URL(href, "https://www.governmentjobs.com/").toString() : "";
    if (!jobPostingUrl || !jobPostingUrl.toLowerCase().includes("governmentjobs.com/jobs/") || seenUrls.has(jobPostingUrl)) {
      itemMatch = itemRegex.exec(source);
      continue;
    }

    const companyName = cleanGovernmentJobsText((orgRegex.exec(itemHtml) || [])[1]) || "Unknown Company";
    const positionName = cleanGovernmentJobsText(linkMatch[2]) || "Untitled Position";
    const location = cleanGovernmentJobsText((locationRegex.exec(itemHtml) || [])[1]) || null;

    postings.push({
      company_name: companyName,
      position_name: positionName,
      job_posting_url: jobPostingUrl,
      posting_date: "Posted Today",
      location
    });
    seenUrls.add(jobPostingUrl);
    itemMatch = itemRegex.exec(source);
  }

  return postings;
}

module.exports = {
  extractGovernmentJobsLastPage,
  extractGovernmentJobsViewHtmlFromResponse,
  parseGovernmentJobsPostingsFromViewHtml
};
