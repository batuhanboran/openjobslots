"use strict";

const { extractSourceIdFromPostingUrl } = require("../../parsers/shared/sourceIds");
const { decodeHtmlEntities } = require("../../parsers/shared/html");

function cleanLoxoText(value) {
  return decodeHtmlEntities(String(value || "").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function parseLoxoPostingsFromHtml(companyNameForPostings, config, pageHtml) {
  const source = String(pageHtml || "");
  const postings = [];
  const seenUrls = new Set();

  const cardPattern =
    /<div[^>]*class=['"][^'"]*\bjobs-listing-card\b[^'"]*['"][^>]*>([\s\S]*?)<\/div>\s*<\/div>\s*<div[^>]*class=['"][^'"]*\bdata-cell\b[^'"]*['"][^>]*>[\s\S]*?<div[^>]*class=['"][^'"]*\bjob-location\b[^'"]*['"][^>]*>([\s\S]*?)<\/div>/gi;
  const hrefPattern = /<a[^>]*class=['"][^'"]*\bjob-title\b[^'"]*['"][^>]*href=['"]([^"']+)['"][^>]*>([\s\S]*?)<\/a>/i;
  const datePattern = /<div[^>]*class=['"][^'"]*\bjob-date\b[^'"]*['"][^>]*>([\s\S]*?)<\/div>/i;

  let match = cardPattern.exec(source);
  while (match) {
    const cardHtml = String(match[1] || "");
    const locationHtml = String(match[2] || "");
    const hrefMatch = cardHtml.match(hrefPattern);
    const href = String(hrefMatch?.[1] || "").trim();
    const absoluteUrl = href ? new URL(href, `${config.baseOrigin || ""}/`).toString() : "";
    if (!absoluteUrl || seenUrls.has(absoluteUrl)) {
      match = cardPattern.exec(source);
      continue;
    }

    const title = cleanLoxoText(hrefMatch?.[2] || "") || "Untitled Position";
    const postingDate = cleanLoxoText(cardHtml.match(datePattern)?.[1] || "");
    const location = cleanLoxoText(locationHtml).replace(/\blocation_on\b/gi, "").trim();

    postings.push({
      company_name: companyNameForPostings,
      position_name: title,
      source_job_id: extractSourceIdFromPostingUrl(absoluteUrl, "loxo"),
      job_posting_url: absoluteUrl,
      posting_date: postingDate || null,
      location: location || null
    });

    seenUrls.add(absoluteUrl);
    match = cardPattern.exec(source);
  }

  return postings;
}

module.exports = {
  parseLoxoPostingsFromHtml
};
