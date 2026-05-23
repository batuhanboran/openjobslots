"use strict";

const { decodeHtmlEntities } = require("../../parsers/shared/html");

function cleanSimplicantText(value) {
  return decodeHtmlEntities(String(value || "").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function parseSimplicantPostingsFromHtml(companyNameForPostings, config, pageHtml) {
  const source = String(pageHtml || "");
  const postings = [];
  const seenUrls = new Set();

  const cardPattern =
    /<a[^>]*class=["'][^"']*\blist-group-item\b[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  const titlePattern = /<h3[^>]*class=["'][^"']*\bjob-title\b[^"']*["'][^>]*>([\s\S]*?)<\/h3>/i;
  const locationPattern = /<div[^>]*class=["'][^"']*\bjob-subtitle\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i;

  let match = cardPattern.exec(source);
  while (match) {
    const href = cleanSimplicantText(match[1] || "");
    if (!href || !href.includes("/jobs/") || !href.replace(/\/+$/, "").toLowerCase().endsWith("/detail")) {
      match = cardPattern.exec(source);
      continue;
    }

    const absoluteUrl = new URL(href, `${config.baseOrigin || ""}/`).toString();
    if (!absoluteUrl || seenUrls.has(absoluteUrl)) {
      match = cardPattern.exec(source);
      continue;
    }

    const bodyHtml = String(match[2] || "");
    const title = cleanSimplicantText(bodyHtml.match(titlePattern)?.[1] || "") || "Untitled Position";
    const location = cleanSimplicantText(bodyHtml.match(locationPattern)?.[1] || "");

    postings.push({
      company_name: companyNameForPostings,
      position_name: title,
      job_posting_url: absoluteUrl,
      posting_date: null,
      location: location || null
    });

    seenUrls.add(absoluteUrl);
    match = cardPattern.exec(source);
  }

  return postings;
}

module.exports = {
  parseSimplicantPostingsFromHtml
};
