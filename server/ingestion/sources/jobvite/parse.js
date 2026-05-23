"use strict";

const { decodeHtmlEntities } = require("../../parsers/shared/html");
const { extractSourceIdFromPostingUrl } = require("../../parsers/shared/sourceIds");

function cleanJobviteText(value) {
  return decodeHtmlEntities(String(value || "").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .replace(/\s*,\s*/g, ", ")
    .trim();
}

function parseJobvitePostingsFromHtml(companyNameForPostings, config, pageHtml) {
  const source = String(pageHtml || "");
  const tablePattern =
    /<h3[^>]*>([\s\S]*?)<\/h3>\s*<table[^>]*class=["'][^"']*\bjv-job-list\b[^"']*["'][^>]*>([\s\S]*?)<\/table>/gi;
  const rowPattern =
    /<tr[^>]*>[\s\S]*?<td[^>]*class=["'][^"']*\bjv-job-list-name\b[^"']*["'][^>]*>[\s\S]*?<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>[\s\S]*?<\/td>[\s\S]*?<td[^>]*class=["'][^"']*\bjv-job-list-location\b[^"']*["'][^>]*>([\s\S]*?)<\/td>[\s\S]*?<\/tr>/gi;

  const postings = [];
  const seenUrls = new Set();

  const pushRows = (rowsHtml, department = "") => {
    let rowMatch = rowPattern.exec(rowsHtml);
    while (rowMatch) {
      const href = String(rowMatch[1] || "").trim();
      const absoluteUrl = href ? new URL(href, `${config.baseOrigin}/`).toString() : "";
      if (!absoluteUrl || seenUrls.has(absoluteUrl)) {
        rowMatch = rowPattern.exec(rowsHtml);
        continue;
      }

      postings.push({
        company_name: companyNameForPostings,
        source_job_id: extractSourceIdFromPostingUrl(absoluteUrl, "jobvite"),
        position_name: cleanJobviteText(rowMatch[2]) || "Untitled Position",
        job_posting_url: absoluteUrl,
        posting_date: null,
        location: cleanJobviteText(rowMatch[3]) || null,
        department: cleanJobviteText(department) || null
      });
      seenUrls.add(absoluteUrl);
      rowMatch = rowPattern.exec(rowsHtml);
    }
    rowPattern.lastIndex = 0;
  };

  let tableMatch = tablePattern.exec(source);
  while (tableMatch) {
    pushRows(String(tableMatch[2] || ""), String(tableMatch[1] || ""));
    tableMatch = tablePattern.exec(source);
  }

  if (postings.length === 0) {
    pushRows(source, "");
  }

  return postings;
}


module.exports = {
  parseJobvitePostingsFromHtml
};
