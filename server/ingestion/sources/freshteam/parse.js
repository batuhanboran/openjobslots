"use strict";

const { decodeHtmlEntities } = require("../../parsers/shared/html");

function cleanFreshteamText(value) {
  return decodeHtmlEntities(String(value || "").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function parseFreshteamPostingsFromHtml(companyNameForPostings, config, pageHtml) {
  const source = String(pageHtml || "");
  const postings = [];
  const seenUrls = new Set();

  const cardPattern =
    /<a[^>]*href=["'](\/jobs\/[^"'#?]+(?:\/[^"'#?]+)?)["'][^>]*class=["'][^"']*\bheading\b[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi;
  const titlePattern = /<div[^>]*class=["'][^"']*\bjob-title\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i;
  const locationInfoPattern = /<div[^>]*class=["'][^"']*\blocation-info\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i;
  const locationAttrPattern = /\bdata-portal-location=["']([^"']*)["']/i;
  const remoteAttrPattern = /\bdata-portal-remote-location=(true|false)\b/i;

  let cardMatch = cardPattern.exec(source);
  while (cardMatch) {
    const href = String(cardMatch[1] || "").trim();
    const absoluteUrl = href ? new URL(href, `${config.baseOrigin || ""}/`).toString() : "";
    if (!absoluteUrl || seenUrls.has(absoluteUrl)) {
      cardMatch = cardPattern.exec(source);
      continue;
    }

    const cardHtml = String(cardMatch[0] || "");
    const bodyHtml = String(cardMatch[2] || "");
    const title = cleanFreshteamText(bodyHtml.match(titlePattern)?.[1] || "") || "Untitled Position";
    const location = cleanFreshteamText(cardHtml.match(locationAttrPattern)?.[1] || "");
    const locationInfo = cleanFreshteamText(bodyHtml.match(locationInfoPattern)?.[1] || "");
    const isRemoteRaw = String(cardHtml.match(remoteAttrPattern)?.[1] || "").trim().toLowerCase();

    postings.push({
      company_name: companyNameForPostings,
      position_name: title,
      job_posting_url: absoluteUrl,
      posting_date: null,
      location: location || locationInfo || null,
      location_info: locationInfo || null,
      is_remote: isRemoteRaw === "true" ? 1 : 0
    });

    seenUrls.add(absoluteUrl);
    cardMatch = cardPattern.exec(source);
  }

  return postings;
}

module.exports = {
  parseFreshteamPostingsFromHtml
};
