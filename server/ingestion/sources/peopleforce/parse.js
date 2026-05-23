"use strict";

const { decodeHtmlEntities } = require("../../parsers/shared/html");

function cleanPeopleforceText(value) {
  return decodeHtmlEntities(String(value || "").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function parsePeopleforcePostingsFromHtml(companyNameForPostings, config, pageHtml) {
  const source = String(pageHtml || "");
  const postings = [];
  const seenUrls = new Set();

  const postingPattern =
    /<a[^>]*class=["'][^"']*\bstretched-link\b[^"']*["'][^>]*href=["'](\/careers\/v\/[^"'#?]+)["'][^>]*>([\s\S]*?)<\/a>([\s\S]*?)(?=<a[^>]*class=["'][^"']*\bstretched-link\b|$)/gi;
  const locationPattern =
    /<div[^>]*class=["'][^"']*\btw-text-neutral-dark-80\b[^"']*\bsmall\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i;

  let postingMatch = postingPattern.exec(source);
  while (postingMatch) {
    const href = String(postingMatch[1] || "").trim();
    const absoluteUrl = href ? new URL(href, `${config.baseOrigin || ""}/`).toString() : "";
    if (!absoluteUrl || seenUrls.has(absoluteUrl)) {
      postingMatch = postingPattern.exec(source);
      continue;
    }

    const title = cleanPeopleforceText(postingMatch[2] || "") || "Untitled Position";
    const locationRaw = String(postingMatch[3] || "");
    const location = cleanPeopleforceText(locationRaw.match(locationPattern)?.[1] || "");

    postings.push({
      company_name: companyNameForPostings,
      position_name: title,
      job_posting_url: absoluteUrl,
      posting_date: null,
      location: location || null
    });

    seenUrls.add(absoluteUrl);
    postingMatch = postingPattern.exec(source);
  }

  return postings;
}

module.exports = {
  parsePeopleforcePostingsFromHtml
};
