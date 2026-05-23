"use strict";

const { decodeHtmlEntities } = require("../../parsers/shared/html");

function urljoin(baseUrl, href) {
  const value = String(href || "").trim();
  if (!value) return "";
  try {
    return new URL(value, String(baseUrl || "")).toString();
  } catch {
    return "";
  }
}

function toTitleCase(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

function cleanCaloppsText(value) {
  return decodeHtmlEntities(String(value || "").replace(/<[^>]+>/g, " "))
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function inferCaloppsCompanyFromPath(pathValue) {
  const path = String(pathValue || "").trim().replace(/^\/+|\/+$/g, "");
  if (!path) return "Unknown Agency";
  const firstSegment = path.split("/", 1)[0];
  const company = firstSegment.replace(/-/g, " ").trim();
  return company ? toTitleCase(company) : "Unknown Agency";
}

function parseCaloppsPostingsFromHtml(pageHtml, pageUrl) {
  const source = String(pageHtml || "");
  if (!source) return [];

  const postings = [];
  const seenUrls = new Set();
  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  const cellRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
  const linkRegex = /<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i;

  let rowMatch = rowRegex.exec(source);
  while (rowMatch) {
    const rowHtml = String(rowMatch[1] || "");
    if (!rowHtml.toLowerCase().includes("views-field-label")) {
      rowMatch = rowRegex.exec(source);
      continue;
    }

    const cells = [];
    let cellMatch = cellRegex.exec(rowHtml);
    while (cellMatch) {
      cells.push(String(cellMatch[1] || ""));
      cellMatch = cellRegex.exec(rowHtml);
    }
    if (cells.length < 5) {
      rowMatch = rowRegex.exec(source);
      continue;
    }

    const linkMatch = linkRegex.exec(cells[0]);
    if (!linkMatch) {
      rowMatch = rowRegex.exec(source);
      continue;
    }

    const href = cleanCaloppsText(linkMatch[1]);
    const jobPostingUrl = urljoin(pageUrl, href);
    if (!jobPostingUrl || seenUrls.has(jobPostingUrl)) {
      rowMatch = rowRegex.exec(source);
      continue;
    }

    const title = cleanCaloppsText(linkMatch[2]) || "Untitled Position";
    const region = cleanCaloppsText(cells[1]) || null;
    const category = cleanCaloppsText(cells[2]) || null;
    const jobType = cleanCaloppsText(cells[3]) || null;
    const closeDate = cleanCaloppsText(cells[4]) || null;
    const postingIdMatch = href.match(/\/job-(\d+)/i);
    const postingId = postingIdMatch?.[1] || jobPostingUrl;

    postings.push({
      id: postingId,
      company_name: inferCaloppsCompanyFromPath(href),
      position_name: title,
      job_posting_url: jobPostingUrl,
      posting_date: new Date().toISOString(),
      location: region,
      category,
      work_type: jobType,
      close_date: closeDate
    });
    seenUrls.add(jobPostingUrl);

    rowMatch = rowRegex.exec(source);
  }

  return postings;
}

function extractCaloppsNextPageUrl(pageHtml, pageUrl) {
  const source = String(pageHtml || "");
  const match = source.match(
    /<li[^>]*class=["'][^"']*\bnext\b[^"']*["'][^>]*>\s*<a[^>]*href=["']([^"']+)["']/i
  );
  if (!match?.[1]) return null;
  return urljoin(pageUrl, cleanCaloppsText(match[1]));
}

module.exports = {
  extractCaloppsNextPageUrl,
  parseCaloppsPostingsFromHtml
};
