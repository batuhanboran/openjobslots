"use strict";

const { decodeHtmlEntities } = require("../../parsers/shared/html");
const { extractSourceIdFromPostingUrl } = require("../../parsers/shared/sourceIds");

function parseUrl(urlString) {
  try {
    return new URL(String(urlString || ""));
  } catch {
    return null;
  }
}

function cleanHirebridgeText(value) {
  return decodeHtmlEntities(String(value || "").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function parseHirebridgePostingsFromHtml(companyNameForPostings, config, pageHtml) {
  const source = String(pageHtml || "");
  const postings = [];
  const seenUrls = new Set();

  const itemPattern = /<li[^>]*>([\s\S]*?)<\/li>/gi;
  const linkPattern =
    /<a[^>]*href=["']([^"']*\/v3\/Jobs\/JobDetails\.aspx\?[^"']+)["'][^>]*>([\s\S]*?)<\/a>/i;
  const departmentPattern = /<span[^>]*class=["'][^"']*\bdepartment\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i;

  let itemMatch = itemPattern.exec(source);
  while (itemMatch) {
    const itemHtml = String(itemMatch[1] || "");
    const linkMatch = itemHtml.match(linkPattern);
    const hrefRaw = String(linkMatch?.[1] || "").trim();
    const href = decodeHtmlEntities(hrefRaw).replace(/\s+/g, "");
    const absoluteUrl = href ? new URL(href, `${config.baseOrigin || ""}/`).toString() : "";
    if (!absoluteUrl || seenUrls.has(absoluteUrl)) {
      itemMatch = itemPattern.exec(source);
      continue;
    }

    const title = cleanHirebridgeText(linkMatch?.[2] || "") || "Untitled Position";
    const department = cleanHirebridgeText(itemHtml.match(departmentPattern)?.[1] || "");

    postings.push({
      company_name: companyNameForPostings,
      source_job_id: extractSourceIdFromPostingUrl(absoluteUrl, "hirebridge"),
      position_name: title,
      job_posting_url: absoluteUrl,
      posting_date: null,
      location: department || null,
      department: department || null
    });

    seenUrls.add(absoluteUrl);
    itemMatch = itemPattern.exec(source);
  }

  return postings;
}

function extractHirebridgeDatePostedFromDetailHtml(pageHtml) {
  const source = String(pageHtml || "");
  const patterns = [
    /"datePosted"\s*:\s*"([^"]+)"/i,
    /["']dateposted["']\s*:\s*["']([^"']+)["']/i,
    /itemprop=["']datePosted["'][^>]*content=["']([^"']+)["']/i
  ];

  for (const pattern of patterns) {
    const value = String(source.match(pattern)?.[1] || "").trim();
    if (value) return value;
  }

  return null;
}

function buildHirebridgeDetailsUrl(config, jobPostingUrl) {
  const parsed = parseUrl(jobPostingUrl);
  if (!parsed) return "";

  const jid = String(parsed.searchParams?.get("jid") || "").trim();
  const cid = String(parsed.searchParams?.get("cid") || config?.cid || "").trim();
  if (!jid || !cid) return "";

  return `${config.detailsBaseUrl}?cid=${encodeURIComponent(cid)}&jid=${encodeURIComponent(jid)}`;
}

module.exports = {
  buildHirebridgeDetailsUrl,
  extractHirebridgeDatePostedFromDetailHtml,
  parseHirebridgePostingsFromHtml
};
