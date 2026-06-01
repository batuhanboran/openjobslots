"use strict";

const { decodeHtmlEntities } = require("../../parsers/shared/html");
const { extractSourceIdFromPostingUrl } = require("../../parsers/shared/sourceIds");

function cleanFreshteamText(value) {
  return decodeHtmlEntities(String(value || "").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function decodePathPart(value) {
  try {
    return decodeURIComponent(String(value || ""));
  } catch {
    return String(value || "");
  }
}

function extractFreshteamSourceJobId(urlValue) {
  try {
    const parsed = new URL(String(urlValue || ""));
    const parts = parsed.pathname
      .split("/")
      .map((part) => decodePathPart(part).trim())
      .filter(Boolean);
    const jobsIndex = parts.findIndex((part) => part.toLowerCase() === "jobs");
    const sourceId = jobsIndex >= 0 ? parts[jobsIndex + 1] : "";
    if (sourceId && !["jobs", "careers", "employment"].includes(sourceId.toLowerCase())) {
      return sourceId;
    }
  } catch {
    // Fall back to the generic URL source-id extractor below.
  }
  return extractSourceIdFromPostingUrl(urlValue, "freshteam");
}

function parseFreshteamPostingsFromHtml(companyNameForPostings, config, pageHtml) {
  const source = String(pageHtml || "");
  const postings = [];
  const seenUrls = new Set();

  const cardPattern =
    /<a[^>]*href=["'](\/jobs\/[^"'#?]+(?:\/[^"'#?]+)?)["'][^>]*class=["'][^"']*\bheading\b[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi;
  const titlePattern = /<[^>]*class=["'][^"']*\bjob-title\b[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/i;
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
      source_job_id: extractFreshteamSourceJobId(absoluteUrl),
      position_name: title,
      job_posting_url: absoluteUrl,
      posting_date: null,
      location: location || locationInfo || null,
      location_info: locationInfo || null,
      is_remote: isRemoteRaw === "true" ? 1 : 0,
      source_evidence: {
        route_kind: "freshteam_jobs_html",
        canonical_url_source: "html",
        canonical_url_path: "a.heading[href^='/jobs/']",
        source_job_id_source: "url_path",
        source_job_id_path: "/jobs/:source_id/:slug?",
        location_source: location ? "data-portal-location" : (locationInfo ? ".location-info" : "source_location_absent"),
        remote_source: isRemoteRaw ? "data-portal-remote-location" : "source_remote_type_absent",
        posting_date_source: "source_posting_date_absent"
      }
    });

    seenUrls.add(absoluteUrl);
    cardMatch = cardPattern.exec(source);
  }

  return postings;
}

module.exports = {
  extractFreshteamSourceJobId,
  parseFreshteamPostingsFromHtml
};
