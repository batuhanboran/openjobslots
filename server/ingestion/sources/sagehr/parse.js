"use strict";

const { decodeHtmlEntities } = require("../../parsers/shared/html");

function cleanSagehrText(value) {
  return decodeHtmlEntities(String(value || "").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function extractSagehrCompanyNameFromHtml(pageHtml) {
  const source = String(pageHtml || "");
  const companyMatch = source.match(
    /<div[^>]*class=['"][^'"]*\btitle-wrap\b[^'"]*['"][^>]*>[\s\S]*?<h1[^>]*>([\s\S]*?)<\/h1>/i
  );
  const fromTitleWrap = cleanSagehrText(companyMatch?.[1] || "");
  if (fromTitleWrap) return fromTitleWrap;

  const fallbackMatch = source.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const fallback = cleanSagehrText(fallbackMatch?.[1] || "");
  return fallback || "Unknown Company";
}

function parseSagehrPostingsFromHtml(companyNameForPostings, config, pageHtml) {
  const source = String(pageHtml || "");
  const postings = [];
  const seenUrls = new Set();

  const jobPattern = /<div[^>]*class=['"][^'"]*\bjob\b[^'"]*['"][^>]*>([\s\S]*?)<\/div>/gi;
  const linkPattern =
    /<a[^>]*class=['"][^'"]*\btitle\b[^'"]*['"][^>]*href=['"]([^"']+)['"][^>]*>([\s\S]*?)<\/a>/i;
  const locationPattern = /<div[^>]*class=['"][^'"]*\blocation\b[^'"]*['"][^>]*>([\s\S]*?)<\/div>/i;

  let jobMatch = jobPattern.exec(source);
  while (jobMatch) {
    const jobHtml = String(jobMatch[1] || "");
    const linkMatch = jobHtml.match(linkPattern);
    const hrefRaw = cleanSagehrText(linkMatch?.[1] || "");
    const href = decodeHtmlEntities(hrefRaw).replace(/\s+/g, "");
    if (!href || !href.toLowerCase().includes("/jobs/")) {
      jobMatch = jobPattern.exec(source);
      continue;
    }

    let absoluteUrl = "";
    try {
      absoluteUrl = new URL(href, `${config.baseOrigin || ""}/`).toString();
    } catch {
      jobMatch = jobPattern.exec(source);
      continue;
    }

    if (!absoluteUrl || seenUrls.has(absoluteUrl)) {
      jobMatch = jobPattern.exec(source);
      continue;
    }

    const title = cleanSagehrText(linkMatch?.[2] || "") || "Untitled Position";
    const location = cleanSagehrText(jobHtml.match(locationPattern)?.[1] || "");

    postings.push({
      company_name: companyNameForPostings,
      position_name: title,
      job_posting_url: absoluteUrl,
      posting_date: null,
      location: location || null
    });
    seenUrls.add(absoluteUrl);
    jobMatch = jobPattern.exec(source);
  }

  return postings;
}

module.exports = {
  extractSagehrCompanyNameFromHtml,
  parseSagehrPostingsFromHtml
};
