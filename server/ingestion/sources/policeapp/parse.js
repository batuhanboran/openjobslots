"use strict";

const { decodeHtmlEntities } = require("../../parsers/shared/html");

function cleanPoliceappText(value) {
  return decodeHtmlEntities(String(value || "").replace(/<[^>]+>/g, " "))
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizePoliceappJobUrl(rawUrl, baseOrigin = "https://www.policeapp.com") {
  let value = String(rawUrl || "").trim();
  if (!value) return "";
  if (value.startsWith("/")) {
    value = new URL(value, `${baseOrigin}/`).toString();
  } else if (!/^https?:\/\//i.test(value)) {
    value = new URL(value, `${baseOrigin}/`).toString();
  }
  value = value.replace(
    /^(https?:\/\/www\.policeapp\.com\/)jobs\/urlrewrite_jobpostings\//i,
    "$1"
  );
  return value;
}

function parsePoliceappPostingsFromHtml(responseHtml) {
  const source = String(responseHtml || "");
  if (!source) return [];

  const postings = [];
  const seenUrls = new Set();
  const linkRegex = /<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;

  let linkMatch = linkRegex.exec(source);
  while (linkMatch) {
    const hrefRaw = cleanPoliceappText(linkMatch[1]);
    const hrefLower = hrefRaw.toLowerCase();
    if (!hrefLower || hrefLower.startsWith("javascript:") || hrefLower.startsWith("#")) {
      linkMatch = linkRegex.exec(source);
      continue;
    }
    if (!/\/\d+\/?$/.test(hrefLower)) {
      linkMatch = linkRegex.exec(source);
      continue;
    }

    const jobPostingUrl = normalizePoliceappJobUrl(hrefRaw);
    if (!jobPostingUrl || seenUrls.has(jobPostingUrl)) {
      linkMatch = linkRegex.exec(source);
      continue;
    }

    const bodyText = cleanPoliceappText(linkMatch[2]);
    const titlePart = bodyText.split(/deadline\s*:/i)[0].trim();
    const positionName = titlePart || "Untitled Position";

    const companyName = positionName.includes(" - ")
      ? positionName.split(" - ", 1)[0].trim() || "Unknown Company"
      : "Unknown Company";

    postings.push({
      company_name: companyName,
      position_name: positionName,
      job_posting_url: jobPostingUrl,
      posting_date: null,
      location: null
    });
    seenUrls.add(jobPostingUrl);
    linkMatch = linkRegex.exec(source);
  }

  return postings;
}

module.exports = {
  normalizePoliceappJobUrl,
  parsePoliceappPostingsFromHtml
};
