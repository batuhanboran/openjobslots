"use strict";

const { decodeHtmlEntities } = require("../../parsers/shared/html");

function parseUrl(urlString) {
  if (!urlString) return null;
  try {
    return new URL(String(urlString || ""));
  } catch {
    return null;
  }
}

function cleanTalentlyftText(value) {
  return decodeHtmlEntities(String(value || "").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function extractTalentlyftInitialConfig(pageHtml, fallbackUrl) {
  const source = String(pageHtml || "");
  const parsed = parseUrl(fallbackUrl);
  const websiteUrlDefault = parsed ? `${parsed.protocol}//${parsed.host}` : "";
  const subdomainDefault = parsed ? String(parsed.hostname || "").split(".")[0] : "";

  const pickFirst = (patterns) => {
    for (const pattern of patterns) {
      const match = source.match(pattern);
      if (match?.[1]) return String(match[1]).trim();
    }
    return "";
  };

  const layoutId = pickFirst([/layoutId\s*:\s*['"]([^'"]+)['"]/i, /layoutId\s*=\s*['"]([^'"]+)['"]/i]) || "Jobs-1";
  const themeId = pickFirst([/themeId\s*:\s*['"]([^'"]+)['"]/i, /themeId\s*=\s*['"]([^'"]+)['"]/i]) || "2";
  const language = pickFirst([/language\s*:\s*['"]([^'"]+)['"]/i, /language\s*=\s*['"]([^'"]+)['"]/i]) || "en";
  const subdomain =
    pickFirst([/subdomain\s*:\s*['"]([^'"]+)['"]/i, /subdomain\s*=\s*['"]([^'"]+)['"]/i]) || subdomainDefault;
  const websiteUrl =
    pickFirst([/websiteUrl\s*:\s*['"]([^'"]+)['"]/i, /websiteUrl\s*=\s*['"]([^'"]+)['"]/i]) || websiteUrlDefault;

  return {
    layoutId,
    themeId,
    language,
    subdomain,
    websiteUrl,
    apiUrl: websiteUrl ? `${websiteUrl}/JobList/` : ""
  };
}

function extractTalentlyftTotalPages(fragmentHtml) {
  const source = String(fragmentHtml || "");
  const matches = Array.from(source.matchAll(/data-page=['"](\d+)['"]/gi));
  const pages = matches
    .map((match) => Number(match?.[1] || 0))
    .filter((value) => Number.isFinite(value) && value > 0);
  return pages.length > 0 ? Math.max(...pages) : 1;
}

function parseTalentlyftPostingsFromFragment(companyNameForPostings, config, fragmentHtml) {
  const source = String(fragmentHtml || "");
  const postings = [];
  const seenUrls = new Set();
  const itemPattern =
    /<a[^>]*class=['"][^'"]*\bjobs__box\b[^'"]*['"][^>]*>([\s\S]*?)<\/a>/gi;

  let itemMatch = itemPattern.exec(source);
  while (itemMatch) {
    const blockHtml = String(itemMatch[0] || "");
    const bodyHtml = String(itemMatch[1] || "");

    const href = String(blockHtml.match(/\bhref=['"]([^'"]+)['"]/i)?.[1] || "").trim();
    const absoluteUrl = href ? new URL(href, `${config.baseOrigin || ""}/`).toString() : "";
    if (!absoluteUrl || seenUrls.has(absoluteUrl)) {
      itemMatch = itemPattern.exec(source);
      continue;
    }

    const id =
      String(blockHtml.match(/\bdata-job-id=['"](\d+)['"]/i)?.[1] || "").trim() ||
      String(blockHtml.match(/\bid=['"](\d+)['"]/i)?.[1] || "").trim() ||
      absoluteUrl;
    const title = cleanTalentlyftText(bodyHtml.match(/<h3[^>]*class=['"][^'"]*\bjobs__box__heading\b[^'"]*['"][^>]*>([\s\S]*?)<\/h3>/i)?.[1] || "");
    const location = cleanTalentlyftText(bodyHtml.match(/<p[^>]*class=['"][^'"]*\bjobs__box__text\b[^'"]*['"][^>]*>([\s\S]*?)<\/p>/i)?.[1] || "");

    postings.push({
      company_name: companyNameForPostings,
      position_name: title || "Untitled Position",
      job_posting_url: absoluteUrl,
      posting_date: null,
      location: location || null,
      source_job_id: id || null
    });
    seenUrls.add(absoluteUrl);
    itemMatch = itemPattern.exec(source);
  }

  return postings;
}

module.exports = {
  extractTalentlyftInitialConfig,
  extractTalentlyftTotalPages,
  parseTalentlyftPostingsFromFragment
};
