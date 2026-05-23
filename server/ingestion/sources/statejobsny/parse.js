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

function formatStatejobsnyDate(dateValue) {
  const date = dateValue instanceof Date ? dateValue : new Date(dateValue);
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const year = String(date.getUTCFullYear()).slice(-2);
  return `${month}/${day}/${year}`;
}

function buildStatejobsnyWindowUrl() {
  const baseUrl = new URL("https://www.statejobsny.com/public/vacancyTable.cfm");
  const now = new Date();
  const startUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1));
  const endUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  baseUrl.searchParams.set("searchResults", "yes");
  baseUrl.searchParams.set("minDate", formatStatejobsnyDate(startUtc));
  baseUrl.searchParams.set("maxDate", formatStatejobsnyDate(endUtc));
  return baseUrl.toString();
}

function cleanStatejobsnyText(value) {
  return decodeHtmlEntities(String(value || "").replace(/<[^>]+>/g, " "))
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseStatejobsnyPostingsFromHtml(pageHtml, pageUrl) {
  const source = String(pageHtml || "");
  if (!source) return [];

  const postings = [];
  const seenUrls = new Set();
  const tbodyMatch = source.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/i);
  const tbodyHtml = tbodyMatch?.[1] || source;
  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  const cellRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
  const linkRegex = /<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i;

  let rowMatch = rowRegex.exec(tbodyHtml);
  while (rowMatch) {
    const rowHtml = String(rowMatch[1] || "");
    const cells = [];
    let cellMatch = cellRegex.exec(rowHtml);
    while (cellMatch) {
      cells.push(String(cellMatch[1] || ""));
      cellMatch = cellRegex.exec(rowHtml);
    }

    if (cells.length < 7) {
      rowMatch = rowRegex.exec(tbodyHtml);
      continue;
    }

    const titleLink = linkRegex.exec(cells[1]);
    if (!titleLink) {
      rowMatch = rowRegex.exec(tbodyHtml);
      continue;
    }

    const href = cleanStatejobsnyText(titleLink[1]);
    const jobPostingUrl = urljoin(pageUrl, href);
    if (!jobPostingUrl || seenUrls.has(jobPostingUrl)) {
      rowMatch = rowRegex.exec(tbodyHtml);
      continue;
    }

    const positionName = cleanStatejobsnyText(titleLink[2]) || "Untitled Position";
    const companyName = cleanStatejobsnyText(cells[5]) || "Unknown Agency";
    const location = cleanStatejobsnyText(cells[6]) || null;
    const postingDate = cleanStatejobsnyText(cells[3]) || null;

    postings.push({
      company_name: companyName,
      position_name: positionName,
      job_posting_url: jobPostingUrl,
      posting_date: postingDate,
      location
    });
    seenUrls.add(jobPostingUrl);
    rowMatch = rowRegex.exec(tbodyHtml);
  }

  return postings;
}

module.exports = {
  buildStatejobsnyWindowUrl,
  parseStatejobsnyPostingsFromHtml
};
