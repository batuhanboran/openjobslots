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
  parseTeamtailorPostingsFromHtml
};
