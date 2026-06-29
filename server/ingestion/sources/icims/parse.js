"use strict";

const { decodeHtmlEntities, extractJsonLdObjectsFromHtml } = require("../../parsers/shared/html");
const { normalizeExplicitRemoteValue } = require("../../parsers/shared/remote");
const { normalizeCountryFromLocation, normalizeCountryName } = require("../../posting");

function cleanIcimsText(value) {
  return decodeHtmlEntities(String(value || "").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .replace(/\s*,\s*/g, ", ")
    .trim();
}

function icimsTextLines(sourceHtml) {
  return decodeHtmlEntities(
    String(sourceHtml || "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(?:dt|dd|li|div|span|p|h[1-6])>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  )
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function extractIcimsLabeledText(sourceHtml, labels) {
  const normalizedLabels = new Set((Array.isArray(labels) ? labels : [])
    .map((label) => String(label || "").trim().toLowerCase())
    .filter(Boolean));
  const lines = icimsTextLines(sourceHtml);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const normalizedLine = line.toLowerCase().replace(/\s*:\s*$/, "");
    if (normalizedLabels.has(normalizedLine)) {
      return lines.slice(index + 1).find((candidate) => candidate && !normalizedLabels.has(candidate.toLowerCase())) || null;
    }
    for (const label of normalizedLabels) {
      const prefix = `${label}:`;
      if (normalizedLine.startsWith(prefix)) {
        const value = line.slice(prefix.length).trim();
        if (value) return value;
      }
    }
  }
  return null;
}

function findIcimsJobPostingJsonLd(sourceHtml) {
  return extractJsonLdObjectsFromHtml(sourceHtml).find((item) => {
    const type = item?.["@type"];
    return Array.isArray(type)
      ? type.some((value) => String(value || "").toLowerCase() === "jobposting")
      : String(type || "").toLowerCase() === "jobposting";
  }) || null;
}

function cleanStructuredJobValue(value) {
  const raw = String(value || "").trim();
  return raw && raw.toUpperCase() !== "UNAVAILABLE" ? raw : "";
}

function extractIcimsLocationFromJsonLd(sourceHtml) {
  const jobPosting = findIcimsJobPostingJsonLd(sourceHtml);
  const locations = Array.isArray(jobPosting?.jobLocation)
    ? jobPosting.jobLocation
    : jobPosting?.jobLocation
      ? [jobPosting.jobLocation]
      : [];
  for (const location of locations) {
    const address = location?.address && typeof location.address === "object" ? location.address : {};
    const country = cleanStructuredJobValue(address.addressCountry);
    const countryName = normalizeCountryName(country) || cleanStructuredJobValue(country);
    const parts = [
      cleanStructuredJobValue(address.addressLocality),
      cleanStructuredJobValue(address.addressRegion),
      countryName
    ].filter(Boolean);
    if (parts.length > 0) return parts.join(", ");
  }
  return null;
}

function extractIcimsPostingDateFromJsonLd(sourceHtml) {
  const jobPosting = findIcimsJobPostingJsonLd(sourceHtml);
  return cleanStructuredJobValue(jobPosting?.datePosted);
}

function extractIcimsRemoteTypeFromJsonLd(sourceHtml) {
  const jobPosting = findIcimsJobPostingJsonLd(sourceHtml);
  if (!jobPosting) return null;
  const jobLocationType = Array.isArray(jobPosting.jobLocationType)
    ? jobPosting.jobLocationType.join(" ")
    : cleanStructuredJobValue(jobPosting.jobLocationType);
  return normalizeExplicitRemoteValue(jobLocationType);
}

function collectIcimsJsonLdPostings(companyNameForPostings, config, sourceHtml, seenUrls) {
  const postings = [];
  for (const jobPosting of extractJsonLdObjectsFromHtml(sourceHtml)) {
    const type = jobPosting?.["@type"];
    const isJobPosting = Array.isArray(type)
      ? type.some((value) => String(value || "").toLowerCase() === "jobposting")
      : String(type || "").toLowerCase() === "jobposting";
    if (!isJobPosting) continue;

    const rawUrl = String(jobPosting?.url || "").trim();
    if (!rawUrl) continue;
    let absoluteUrl = "";
    try {
      absoluteUrl = new URL(rawUrl, `${config.origin}/`).toString();
    } catch {
      continue;
    }
    if (!absoluteUrl || seenUrls.has(absoluteUrl) || absoluteUrl.toLowerCase().includes("/jobs/intro")) continue;

    const identifier = jobPosting?.identifier;
    const identifierValue = cleanStructuredJobValue(
      Array.isArray(identifier) ? identifier[0]?.value || identifier[0]?.name : identifier?.value || identifier?.name
    );
    const scriptHtml = `<script type="application/ld+json">${JSON.stringify(jobPosting)}</script>`;
    postings.push({
      company_name: companyNameForPostings,
      source_job_id: extractIcimsSourceJobId(absoluteUrl) || identifierValue,
      position_name: cleanIcimsText(jobPosting?.title || jobPosting?.name) || "Untitled Position",
      job_posting_url: absoluteUrl,
      remote_type: extractIcimsRemoteTypeFromJsonLd(scriptHtml),
      posting_date: extractIcimsPostingDateFromJsonLd(scriptHtml),
      location: extractIcimsLocationFromJsonLd(scriptHtml) || extractIcimsLocationFromTitleOrUrl(jobPosting?.title || jobPosting?.name, absoluteUrl),
      source_evidence: {
        route_kind: "icims_json_ld_list",
        title_source: "json_ld",
        canonical_url_source: "json_ld",
        location_source: extractIcimsLocationFromJsonLd(scriptHtml) ? "json_ld_joblocation" : "",
        remote_source: extractIcimsRemoteTypeFromJsonLd(scriptHtml) ? "json_ld_joblocationtype" : "",
        posting_date_source: extractIcimsPostingDateFromJsonLd(scriptHtml) ? "json_ld_dateposted" : ""
      }
    });
    seenUrls.add(absoluteUrl);
  }
  return postings;
}

function extractIcimsLocationFromHtml(sourceHtml) {
  const source = String(sourceHtml || "");
  const structuredLocation = extractIcimsLocationFromJsonLd(source);
  if (structuredLocation) return structuredLocation;

  const patterns = [
    /field-label">Location\s*<\/span>\s*<\/dt>\s*<dd[^>]*class=["'][^"']*iCIMS_JobHeaderData[^"']*["'][^>]*>\s*<span[^>]*>([\s\S]*?)<\/span>/i,
    /glyphicons-map-marker[^>]*>[\s\S]*?<\/dt>\s*<dd[^>]*class=["'][^"']*iCIMS_JobHeaderData[^"']*["'][^>]*>\s*<span[^>]*>([\s\S]*?)<\/span>/i,
    /data-(?:field|label)=["'](?:location|job-location|primary-location)["'][^>]*>([\s\S]*?)<\/(?:span|div|dd|li)>/i,
    // Additional iCIMS template patterns
    /class=["'][^"']*(?:job-location|jobLocation|location-field)[^"']*["'][^>]*>([^<]+)/i,
    /itemprop=["']jobLocation["'][^>]*>[\s\S]*?itemprop=["']address["'][^>]*>[\s\S]*?<span[^>]*>([^<]+)/i,
    /data-automation=["']job-location["'][^>]*>([^<]+)/i
  ];

  for (const pattern of patterns) {
    const match = source.match(pattern);
    if (!match?.[1]) continue;
    const location = cleanIcimsText(match[1]);
    if (location) return location;
  }

  const labeled = extractIcimsLabeledText(source, ["Location", "Job Location", "Primary Location", "Work Location"]);
  if (labeled) return cleanIcimsText(labeled);

  return null;
}

function extractIcimsPostingDateFromHtml(sourceHtml) {
  const source = String(sourceHtml || "");
  const structuredDate = extractIcimsPostingDateFromJsonLd(source);
  if (structuredDate) return structuredDate;

  const patterns = [
    /field-label">Date Posted\s*<\/span>\s*<span[^>]*?(?:title=["']([^"']+)["'])?[^>]*>\s*([^<]*)/i,
    /data-(?:field|label)=["'](?:date-posted|posted-date|posting-date)["'][^>]*>([\s\S]*?)<\/(?:span|div|dd|li)>/i
  ];
  for (const pattern of patterns) {
    const match = source.match(pattern);
    const withTitle = String(match?.[0] || "").match(/title=["']([^"']+)["']/i)?.[1] || String(match?.[1] || "").trim();
    if (withTitle) return withTitle;
    const fallback = cleanIcimsText(match?.[2] || match?.[1] || "");
    if (fallback) return fallback;
  }
  const labeled = extractIcimsLabeledText(source, ["Date Posted", "Posted Date", "Posting Date", "Posted"]);
  return labeled ? cleanIcimsText(labeled) : null;
}

function extractIcimsRemoteTypeFromHtml(sourceHtml) {
  const source = String(sourceHtml || "");
  const structuredRemoteType = extractIcimsRemoteTypeFromJsonLd(source);
  if (structuredRemoteType) return structuredRemoteType;

  const patterns = [
    /field-label">Remote\s*<\/span>\s*<\/dt>\s*<dd[^>]*class=["'][^"']*iCIMS_JobHeaderData[^"']*["'][^>]*>\s*<span[^>]*>([\s\S]*?)<\/span>/i,
    /data-(?:field|label)=["'](?:remote|workplace-type|location-type)["'][^>]*>([\s\S]*?)<\/(?:span|div|dd|li)>/i,
    // Additional remote patterns
    /data-(?:field|label)=["'](?:telework|work-arrangement|flexible-location)["'][^>]*>([\s\S]*?)<\/(?:span|div|dd|li)>/i
  ];

  for (const pattern of patterns) {
    const match = source.match(pattern);
    const remoteType = normalizeExplicitRemoteValue(match?.[1] || "");
    if (remoteType) return remoteType;
  }

  const labeled = extractIcimsLabeledText(source, ["Remote", "Remote Type", "Workplace Type", "Work Location Type"]);
  return normalizeExplicitRemoteValue(labeled);
}

function extractIcimsSourceJobId(urlValue) {
  const match = String(urlValue || "").match(/\/jobs\/(\d+)/i);
  return String(match?.[1] || "").trim();
}

function extractIcimsLocationFromTitleOrUrl(positionName, jobUrl = "") {
  const title = cleanIcimsText(positionName);
  const candidates = [];

  for (const match of title.matchAll(/\(([^)]+)\)/g)) {
    if (match?.[1]) candidates.push(match[1]);
  }

  const dashParts = title
    .split(/\s+[-\u2013\u2014]{1,2}\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (dashParts.length > 1) {
    candidates.push(dashParts[dashParts.length - 1]);
  }

  try {
    const parsed = new URL(String(jobUrl || ""));
    const parts = parsed.pathname.split("/").map((part) => decodeURIComponent(part)).filter(Boolean);
    const jobsIndex = parts.findIndex((part) => part.toLowerCase() === "jobs");
    if (jobsIndex >= 0 && parts[jobsIndex + 2]) {
      candidates.push(
        parts[jobsIndex + 2]
          .replace(/%2c/gi, ",")
          .replace(/%26/gi, "&")
          .replace(/[-_]+/g, " ")
      );
    }
  } catch {
    // Ignore malformed URL fallback.
  }

  for (const candidate of candidates) {
    const cleaned = cleanIcimsText(candidate);
    if (!cleaned || cleaned.length > 100) continue;
    if (normalizeCountryFromLocation(cleaned)) return cleaned;
    if (/\b(remote|hybrid|work from home|telework|virtual)\b/i.test(cleaned)) return cleaned;
    if (/\b[A-Z][A-Za-z .'-]+,\s*(?:AL|AK|AZ|AR|CA|CO|CT|DC|DE|FL|GA|HI|IA|ID|IL|IN|KS|KY|LA|MA|MD|ME|MI|MN|MO|MS|MT|NC|ND|NE|NH|NJ|NM|NV|NY|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VA|VT|WA|WI|WV|WY)(?:\s*-\s*US)?\b/.test(cleaned)) {
      return cleaned;
    }
  }

  return null;
}

function parseIcimsPostingsFromHtml(companyNameForPostings, config, pageHtml) {
  const source = String(pageHtml || "");
  const postings = [];
  const seenUrls = new Set();

  // Collect JSON-LD postings FIRST — they have richer structured location data
  postings.push(...collectIcimsJsonLdPostings(companyNameForPostings, config, source, seenUrls));

  const cardPattern = /<li[^>]*class=["'][^"']*iCIMS_JobCardItem[^"']*["'][^>]*>([\s\S]*?)<\/li>/gi;

  let cardMatch = cardPattern.exec(source);
  while (cardMatch) {
    const cardHtml = String(cardMatch[1] || "");
    const anchorPattern = /<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;

    let linkHref = "";
    let linkBody = "";
    let anchorMatch = anchorPattern.exec(cardHtml);
    while (anchorMatch) {
      const href = String(anchorMatch[1] || "").trim();
      if (/\/jobs\/\d+/i.test(href)) {
        linkHref = href;
        linkBody = String(anchorMatch[2] || "");
        break;
      }
      anchorMatch = anchorPattern.exec(cardHtml);
    }

    if (!linkHref) {
      cardMatch = cardPattern.exec(source);
      continue;
    }

    const absoluteUrl = new URL(linkHref, `${config.origin}/`).toString();
    if (!absoluteUrl || seenUrls.has(absoluteUrl) || absoluteUrl.toLowerCase().includes("/jobs/intro")) {
      cardMatch = cardPattern.exec(source);
      continue;
    }

    const titleMatch = linkBody.match(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/i);
    const positionName = cleanIcimsText(titleMatch?.[1] || linkBody) || "Untitled Position";

    postings.push({
      company_name: companyNameForPostings,
      source_job_id: extractIcimsSourceJobId(absoluteUrl),
      position_name: positionName,
      job_posting_url: absoluteUrl,
      remote_type: extractIcimsRemoteTypeFromHtml(cardHtml),
      posting_date: extractIcimsPostingDateFromHtml(cardHtml),
      location: extractIcimsLocationFromHtml(cardHtml) || extractIcimsLocationFromTitleOrUrl(positionName, absoluteUrl)
    });
    seenUrls.add(absoluteUrl);
    cardMatch = cardPattern.exec(source);
  }

  if (postings.length > 0) return postings;

  const fallbackLinkPattern = /<a[^>]*href=["']([^"']*\/jobs\/\d+[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let fallbackMatch = fallbackLinkPattern.exec(source);
  while (fallbackMatch) {
    const href = String(fallbackMatch[1] || "").trim();
    const absoluteUrl = href ? new URL(href, `${config.origin}/`).toString() : "";
    if (!absoluteUrl || seenUrls.has(absoluteUrl) || absoluteUrl.toLowerCase().includes("/jobs/intro")) {
      fallbackMatch = fallbackLinkPattern.exec(source);
      continue;
    }

    const linkBody = String(fallbackMatch[2] || "");
    const titleMatch = linkBody.match(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/i);
    const positionName = cleanIcimsText(titleMatch?.[1] || linkBody) || "Untitled Position";

    const contextStart = Math.max(0, Number(fallbackMatch.index || 0) - 800);
    const contextEnd = Math.min(source.length, Number(fallbackMatch.index || 0) + String(fallbackMatch[0] || "").length + 2200);
    const contextHtml = source.slice(contextStart, contextEnd);

    postings.push({
      company_name: companyNameForPostings,
      source_job_id: extractIcimsSourceJobId(absoluteUrl),
      position_name: positionName,
      job_posting_url: absoluteUrl,
      remote_type: extractIcimsRemoteTypeFromHtml(contextHtml),
      posting_date: extractIcimsPostingDateFromHtml(contextHtml),
      location: extractIcimsLocationFromHtml(contextHtml) || extractIcimsLocationFromTitleOrUrl(positionName, absoluteUrl)
    });
    seenUrls.add(absoluteUrl);
    fallbackMatch = fallbackLinkPattern.exec(source);
  }

  postings.push(...collectIcimsJsonLdPostings(companyNameForPostings, config, source, seenUrls));

  return postings;
}

module.exports = {
  extractIcimsLocationFromHtml,
  extractIcimsLocationFromTitleOrUrl,
  extractIcimsPostingDateFromHtml,
  extractIcimsRemoteTypeFromHtml,
  parseIcimsPostingsFromHtml
};
