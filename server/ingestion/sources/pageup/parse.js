"use strict";

const { decodeHtmlEntities } = require("../../parsers/shared/html");

function parseUrl(urlString) {
  try {
    return new URL(String(urlString || ""));
  } catch {
    return null;
  }
}

function cleanPageupText(value) {
  return decodeHtmlEntities(String(value || "").replace(/<[^>]+>/g, " "))
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractPageupCompanyNameFromTitle(pageHtml) {
  const source = String(pageHtml || "");
  const title = cleanPageupText(source.match(/<title>\s*([\s\S]*?)\s*<\/title>/i)?.[1] || "");
  if (!title) return "Unknown Company";
  const parts = title.split("|").map((part) => String(part || "").trim()).filter(Boolean);
  if (parts.length > 1) {
    return parts[parts.length - 1];
  }
  return title;
}

function extractPageupPostingDateFromListingRow(rowHtml) {
  const source = String(rowHtml || "");
  const patterns = [
    /<span[^>]*class=['"][^'"]*\bposted-date\b[^'"]*['"][^>]*>[\s\S]*?<time[^>]*datetime=['"]([^'"]+)['"]/i,
    /<span[^>]*class=['"][^'"]*\bopen-date\b[^'"]*['"][^>]*>[\s\S]*?<time[^>]*datetime=['"]([^'"]+)['"]/i,
    /<span[^>]*class=['"][^'"]*\bposting-date\b[^'"]*['"][^>]*>[\s\S]*?<time[^>]*datetime=['"]([^'"]+)['"]/i
  ];
  for (const pattern of patterns) {
    const value = cleanPageupText(source.match(pattern)?.[1] || "");
    if (value) return value;
  }
  return "";
}

function extractPageupPostingDateFromDetailHtml(pageHtml) {
  const source = String(pageHtml || "");
  const patterns = [
    /<span[^>]*class=['"][^'"]*\bopen-date\b[^'"]*['"][^>]*>\s*<time[^>]*datetime=['"]([^'"]+)['"]/i,
    /<b>\s*Advertised:\s*<\/b>\s*<span[^>]*>\s*<time[^>]*datetime=['"]([^'"]+)['"]/i,
    /<span[^>]*class=['"][^'"]*\bopen-date\b[^'"]*['"][^>]*>\s*<time[^>]*>([^<]+)<\/time>/i
  ];
  for (const pattern of patterns) {
    const value = cleanPageupText(source.match(pattern)?.[1] || "");
    if (value) return value;
  }
  return "";
}

function extractPageupPostingId(jobPostingUrl) {
  const parsed = parseUrl(jobPostingUrl);
  if (!parsed) return "";
  const pathParts = String(parsed.pathname || "")
    .split("/")
    .map((part) => String(part || "").trim())
    .filter(Boolean);
  const loweredPathParts = pathParts.map((part) => part.toLowerCase());
  const jobIndex = loweredPathParts.indexOf("job");
  if (jobIndex >= 0 && pathParts[jobIndex + 1]) {
    return String(pathParts[jobIndex + 1] || "").trim();
  }
  return "";
}

function parsePageupPostingsFromResults(companyNameForPostings, config, resultsHtml) {
  const source = String(resultsHtml || "");
  const postings = [];
  const seenUrls = new Set();

  const rowPattern = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  const linkPattern =
    /<a[^>]*class=['"][^'"]*\bjob-link\b[^'"]*['"][^>]*href=['"]([^"']+)['"][^>]*>([\s\S]*?)<\/a>/i;
  const locationPattern = /<span[^>]*class=['"][^'"]*\blocation\b[^'"]*['"][^>]*>([\s\S]*?)<\/span>/i;

  let rowMatch = rowPattern.exec(source);
  while (rowMatch) {
    const rowHtml = String(rowMatch[1] || "");
    const linkMatch = rowHtml.match(linkPattern);
    const hrefRaw = String(linkMatch?.[1] || "").trim();
    const href = decodeHtmlEntities(hrefRaw).replace(/\s+/g, "");
    if (!href) {
      rowMatch = rowPattern.exec(source);
      continue;
    }

    let absoluteUrl = "";
    try {
      absoluteUrl = new URL(href, `${config.baseOrigin || ""}/`).toString();
    } catch {
      rowMatch = rowPattern.exec(source);
      continue;
    }
    if (!absoluteUrl || seenUrls.has(absoluteUrl)) {
      rowMatch = rowPattern.exec(source);
      continue;
    }

    const title = cleanPageupText(linkMatch?.[2] || "") || "Untitled Position";
    const location = cleanPageupText(rowHtml.match(locationPattern)?.[1] || "");
    const postingDate = extractPageupPostingDateFromListingRow(rowHtml);
    const postingId = extractPageupPostingId(absoluteUrl);

    postings.push({
      company_name: companyNameForPostings,
      position_name: title,
      job_posting_url: absoluteUrl,
      posting_date: postingDate || null,
      location: location || null,
      external_id: postingId || null
    });

    seenUrls.add(absoluteUrl);
    rowMatch = rowPattern.exec(source);
  }

  return postings;
}

module.exports = {
  extractPageupCompanyNameFromTitle,
  extractPageupPostingDateFromDetailHtml,
  parsePageupPostingsFromResults
};
