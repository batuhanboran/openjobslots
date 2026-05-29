"use strict";

const { decodeHtmlEntities } = require("../../parsers/shared/html");

const { extractSourceIdFromPostingUrl } = require("../../parsers/shared/sourceIds");

function cleanTeamtailorText(value) {
  return decodeHtmlEntities(String(value || "").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
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
    if (cleaned && cleaned !== "·" && cleaned !== "&middot;" && !seen.has(normalized)) {
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

function parseTeamtailorPostingsFromHtml(companyNameForPostings, config, pageHtml) {
  const source = String(pageHtml || "");
  const postings = [];
  const seenUrls = new Set();
  const itemPattern =
    /<li[^>]*class=["'][^"']*\bblock-grid-item\b[^"']*["'][^>]*>([\s\S]*?)<\/li>/gi;
  const hrefPattern = /<a[^>]*href=["']([^"']+)["'][^>]*>/i;
  const titleAttrPattern =
    /<span[^>]*class=["'][^"']*\btext-block-base-link\b[^"']*["'][^>]*\btitle=["']([^"']+)["'][^>]*>/i;
  const titleBodyPattern =
    /<span[^>]*class=["'][^"']*\btext-block-base-link\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i;
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
    const titleFromBody = cleanTeamtailorText(itemHtml.match(titleBodyPattern)?.[1] || "");
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

module.exports = {
  parseTeamtailorPostingsFromRss,
  parseTeamtailorPostingsFromHtml
};
