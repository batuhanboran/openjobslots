"use strict";

const { decodeHtmlEntities } = require("../../parsers/shared/html");

const { extractSourceIdFromPostingUrl } = require("../../parsers/shared/sourceIds");

function cleanTeamtailorText(value) {
  return decodeHtmlEntities(String(value || "").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function isTeamtailorSeparator(value) {
  const cleaned = String(value || "").trim();
  const markerCode = cleaned.length === 1 ? cleaned.charCodeAt(0) : 0;
  return cleaned === "&middot;" || markerCode === 183 || markerCode === 8226;
}

function extractTeamtailorMetaParts(value) {
  const source = String(value || "");
  const parts = [];
  const seen = new Set();
  const spanPattern = /<span[^>]*>([\s\S]*?)<\/span>/gi;
  let spanMatch = spanPattern.exec(source);

  while (spanMatch) {
    const cleaned = cleanTeamtailorText(spanMatch[1] || "");
    const normalized = cleaned.toLowerCase();
    if (cleaned && !isTeamtailorSeparator(cleaned) && !seen.has(normalized)) {
      parts.push(cleaned);
      seen.add(normalized);
    }
    spanMatch = spanPattern.exec(source);
  }

  return parts;
}

function extractTagText(source, tagName) {
  const escaped = String(tagName || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escaped}>`, "i");
  const match = String(source || "").match(pattern);
  if (!match) return "";
  return cleanTeamtailorText(String(match[1] || "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1"));
}

function extractFirstTagBlock(source, tagName) {
  const escaped = String(tagName || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escaped}>`, "i");
  return String(source || "").match(pattern)?.[1] || "";
}

function parseRssDate(value) {
  const parsed = Date.parse(String(value || "").trim());
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toISOString().slice(0, 10);
}

function mapTeamtailorRemoteStatus(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "fully") return "remote";
  if (normalized === "hybrid") return "hybrid";
  if (normalized === "none") return "onsite";
  return "unknown";
}

function extractRssLocation(itemXml) {
  const locationBlock = extractFirstTagBlock(itemXml, "tt:location");
  const city = extractTagText(locationBlock, "tt:city");
  const country = extractTagText(locationBlock, "tt:country");
  const name = extractTagText(locationBlock, "tt:name");
  if (city && country) return `${city}, ${country}`;
  if (city) return city;
  if (country) return country;
  return name || null;
}

function parseTeamtailorPostingsFromRss(companyNameForPostings, rssXml) {
  const source = String(rssXml || "");
  const postings = [];
  const seenUrls = new Set();
  const itemPattern = /<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi;
  let itemMatch = itemPattern.exec(source);

  while (itemMatch) {
    const itemXml = String(itemMatch[1] || "");
    const jobUrl = extractTagText(itemXml, "link");
    if (!jobUrl || seenUrls.has(jobUrl)) {
      itemMatch = itemPattern.exec(source);
      continue;
    }
    const title = extractTagText(itemXml, "title") || "Untitled Position";
    const remoteType = mapTeamtailorRemoteStatus(extractTagText(itemXml, "remoteStatus"));

    postings.push({
      company_name: companyNameForPostings,
      source_job_id: extractSourceIdFromPostingUrl(jobUrl, "teamtailor") || extractTagText(itemXml, "guid"),
      position_name: title,
      job_posting_url: jobUrl,
      posting_date: parseRssDate(extractTagText(itemXml, "pubDate")),
      location: extractRssLocation(itemXml),
      department: extractTagText(itemXml, "tt:department") || null,
      remote_type: remoteType
    });
    seenUrls.add(jobUrl);
    itemMatch = itemPattern.exec(source);
  }

  return postings;
}

function firstMatch(source, patterns) {
  for (const pattern of patterns) {
    const match = String(source || "").match(pattern);
    const value = cleanTeamtailorText(match?.[1] || "");
    if (value) return value;
  }
  return "";
}

function buildRssLocationCountryHints(rssPostings = []) {
  const hints = new Map();
  for (const posting of rssPostings) {
    const location = String(posting?.location || "").trim();
    const parts = location.split(",").map((part) => part.trim()).filter(Boolean);
    if (parts.length !== 2) continue;
    const [city, country] = parts;
    if (!city || !country) continue;
    hints.set(city.toLowerCase(), { city, country });
  }
  return hints;
}

function qualifyHtmlLocationFromRssHints(location, hints = new Map()) {
  const value = String(location || "").trim();
  if (!value || value.includes("/")) return null;
  if (value.includes(",")) return value;
  const hint = hints.get(value.toLowerCase());
  if (!hint?.country) return null;
  return `${hint.city || value}, ${hint.country}`;
}

function parseTeamtailorPostingsFromHtml(companyNameForPostings, config, pageHtml) {
  const source = String(pageHtml || "");
  const postings = [];
  const seenUrls = new Set();
  const itemPattern =
    /<li\b[^>]*>(?=[\s\S]*?<a\b[^>]*href=["'][^"']*\/jobs\/[^"']+["'][^>]*>)([\s\S]*?)<\/li>/gi;
  const hrefPattern = /<a[^>]*href=["']([^"']+)["'][^>]*>/i;
  const titleAttrPattern =
    /<span[^>]*class=["'][^"']*\btext-block-base-link\b[^"']*["'][^>]*\btitle=["']([^"']+)["'][^>]*>/i;
  const titleBodyPattern =
    /<span[^>]*class=["'][^"']*\btext-block-base-link\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i;
  const anchorBodyPattern = /<a[^>]*href=["'][^"']*\/jobs\/[^"']+["'][^>]*>([\s\S]*?)<\/a>/i;
  const metaPattern =
    /<div[^>]*class=["'][^"']*\bmt-1\b[^"']*\btext-md\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i;

  let itemMatch = itemPattern.exec(source);
  while (itemMatch) {
    const itemHtml = String(itemMatch[1] || "");
    const hrefMatch = itemHtml.match(hrefPattern);
    const href = String(hrefMatch?.[1] || "").trim();
    const jobUrl = href ? new URL(href, `${config.baseOrigin || ""}/`).toString() : "";
    if (!jobUrl || seenUrls.has(jobUrl)) {
      itemMatch = itemPattern.exec(source);
      continue;
    }

    const titleFromAttr = cleanTeamtailorText(itemHtml.match(titleAttrPattern)?.[1] || "");
    const titleFromBody = firstMatch(itemHtml, [titleBodyPattern, anchorBodyPattern]);
    const title = titleFromAttr || titleFromBody || "Untitled Position";

    const metaRaw = String(itemHtml.match(metaPattern)?.[1] || "");
    const metaParts = extractTeamtailorMetaParts(metaRaw);
    const department = metaParts.length > 1 ? metaParts[0] : null;
    const location = metaParts.length > 1 ? metaParts.slice(1).join(" / ") : metaParts[0] || null;

    postings.push({
      company_name: companyNameForPostings,
      source_job_id: extractSourceIdFromPostingUrl(jobUrl, "teamtailor"),
      position_name: title,
      job_posting_url: jobUrl,
      posting_date: null,
      location,
      department
    });
    seenUrls.add(jobUrl);
    itemMatch = itemPattern.exec(source);
  }

  return postings;
}

function mergeTeamtailorRssAndHtmlPostings(rssPostings = [], htmlPostings = []) {
  const byUrl = new Map();
  const bySourceId = new Map();
  const rssLocationCountryHints = buildRssLocationCountryHints(rssPostings);
  for (const posting of htmlPostings) {
    const urlKey = String(posting?.job_posting_url || "").trim().toLowerCase();
    const sourceIdKey = String(posting?.source_job_id || "").trim().toLowerCase();
    if (urlKey) byUrl.set(urlKey, posting);
    if (sourceIdKey) bySourceId.set(sourceIdKey, posting);
  }

  const merged = [];
  const seenHtmlKeys = new Set();
  for (const posting of rssPostings) {
    const urlKey = String(posting?.job_posting_url || "").trim().toLowerCase();
    const sourceIdKey = String(posting?.source_job_id || "").trim().toLowerCase();
    const htmlPosting = byUrl.get(urlKey) || bySourceId.get(sourceIdKey);
    if (htmlPosting) {
      if (urlKey) seenHtmlKeys.add(urlKey);
      if (sourceIdKey) seenHtmlKeys.add(sourceIdKey);
    }
    merged.push({
      ...posting,
      location: posting?.location || qualifyHtmlLocationFromRssHints(htmlPosting?.location, rssLocationCountryHints),
      department: posting?.department || htmlPosting?.department || null
    });
  }

  if (rssPostings.length === 0) {
    for (const posting of htmlPostings) {
      const urlKey = String(posting?.job_posting_url || "").trim().toLowerCase();
      const sourceIdKey = String(posting?.source_job_id || "").trim().toLowerCase();
      if ((urlKey && seenHtmlKeys.has(urlKey)) || (sourceIdKey && seenHtmlKeys.has(sourceIdKey))) continue;
      merged.push(posting);
    }
  }

  return merged;
}

module.exports = {
  parseTeamtailorPostingsFromRss,
  parseTeamtailorPostingsFromHtml,
  mergeTeamtailorRssAndHtmlPostings
};
