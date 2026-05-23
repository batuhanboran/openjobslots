"use strict";

const { decodeHtmlEntities, extractJsonLdObjectsFromHtml } = require("../../parsers/shared/html");
const { extractSourceIdFromPostingUrl } = require("../../parsers/shared/sourceIds");
const { normalizeCountryFromLocation, normalizeCountryName } = require("../../posting");

function cleanCareerplugText(value) {
  return decodeHtmlEntities(String(value || "").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .replace(/\s*,\s*/g, ", ")
    .trim();
}

function normalizeCareerplugMeta(value) {
  return cleanCareerplugText(value)
    .replace(/^\s*Location:\s*/i, "")
    .replace(/^\s*Full\s*\/\s*Part\s*Time:\s*/i, "")
    .trim();
}

function normalizeCareerplugAriaTitle(value) {
  const cleaned = cleanCareerplugText(value)
    .replace(/^\s*(view|open|apply\s+for|view\s+details\s+for)\s+(job|position|role)?\s*[:\-]?\s*/i, "")
    .replace(/\s+\|\s+.*$/i, "")
    .trim();
  return /^(view|open|apply|job|jobs|position|role|details)$/i.test(cleaned) ? "" : cleaned;
}

function extractCareerplugDivBlock(source, startIndex) {
  const html = String(source || "");
  const start = Number(startIndex || 0);
  const opening = html.slice(start).match(/^<div\b[^>]*>/i);
  if (!opening) return "";
  const tagPattern = /<\/?div\b[^>]*>/gi;
  tagPattern.lastIndex = start;
  let depth = 0;
  let tagMatch = tagPattern.exec(html);
  while (tagMatch) {
    if (/^<div\b/i.test(tagMatch[0])) depth += 1;
    else depth -= 1;
    if (depth === 0) return html.slice(start, tagPattern.lastIndex);
    tagMatch = tagPattern.exec(html);
  }
  return html.slice(start);
}

function extractCareerplugRowHtml(source, anchorIndex) {
  const html = String(source || "");
  const beforeAnchor = html.slice(0, Math.max(0, Number(anchorIndex || 0)));
  const rowPattern = /<div\b[^>]*class=["'][^"']*\brow\b[^"']*["'][^>]*>/gi;
  let rowMatch = rowPattern.exec(beforeAnchor);
  let latest = null;
  while (rowMatch) {
    latest = rowMatch;
    rowMatch = rowPattern.exec(beforeAnchor);
  }
  if (!latest) return "";
  const rowHtml = extractCareerplugDivBlock(html, latest.index);
  return rowHtml && rowHtml.includes("/jobs/") ? rowHtml : "";
}

function extractCareerplugTitleFromHtml(titleHtml, anchorAttrs) {
  const source = String(titleHtml || "");
  const nameMatch = source.match(/<span[^>]*class=["'][^"']*\bname\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i);
  return cleanCareerplugText(nameMatch?.[1] || source)
    || normalizeCareerplugAriaTitle(String(anchorAttrs || "").match(/\baria-label=["']([^"']*)["']/i)?.[1] || "");
}

function cleanCareerplugStructuredValue(value) {
  if (Array.isArray(value)) {
    return value.map(cleanCareerplugStructuredValue).filter(Boolean).join(", ");
  }
  if (value && typeof value === "object") {
    return cleanCareerplugStructuredValue(value.name || value.value || value["@id"]);
  }
  return cleanCareerplugText(value);
}

function firstCareerplugJobLocationAddress(value) {
  const locations = Array.isArray(value) ? value : value ? [value] : [];
  for (const location of locations) {
    if (location?.address && typeof location.address === "object") return location.address;
  }
  return {};
}

function findCareerplugJobPostingJsonLd(sourceHtml) {
  return extractJsonLdObjectsFromHtml(sourceHtml).find((item) => {
    const type = item?.["@type"];
    return Array.isArray(type)
      ? type.some((value) => String(value || "").toLowerCase() === "jobposting")
      : String(type || "").toLowerCase() === "jobposting";
  }) || null;
}

function normalizeCareerplugCanonicalJobUrl(rawUrl, config = {}) {
  const value = cleanCareerplugText(rawUrl);
  if (!value) return "";
  const baseOrigin = cleanCareerplugText(config.baseOrigin);
  try {
    const parsed = new URL(value, baseOrigin ? `${baseOrigin}/` : "https://example.invalid/");
    const id = parsed.pathname.match(/\/jobs\/(\d+)(?:\/apps(?:\/new)?)?(?:\/|$)/i)?.[1] || "";
    if (id && baseOrigin) return new URL(`/jobs/${id}`, `${baseOrigin}/`).toString();
    return parsed.toString();
  } catch {
    return "";
  }
}

function extractCareerplugDetailJobUrlFromHtml(sourceHtml) {
  const source = String(sourceHtml || "");
  const patterns = [
    /\b(?:href|action)=["']([^"']*\/jobs\/\d+(?:\/apps(?:\/new)?)?[^"']*)["']/i,
    /\bcontent=["']([^"']*\/jobs\/\d+[^"']*)["']/i
  ];
  for (const pattern of patterns) {
    const match = source.match(pattern);
    if (match?.[1]) return match[1];
  }
  return "";
}

function extractCareerplugJsonLdFieldsFromObject(jobPosting) {
  if (!jobPosting) return {};
  const address = firstCareerplugJobLocationAddress(jobPosting.jobLocation);
  const city = cleanCareerplugStructuredValue(address.addressLocality);
  const state = cleanCareerplugStructuredValue(address.addressRegion);
  const countryRaw = cleanCareerplugStructuredValue(address.addressCountry);
  const country = normalizeCountryName(countryRaw) || normalizeCountryFromLocation(countryRaw) || countryRaw;
  const datePosted = cleanCareerplugStructuredValue(jobPosting.datePosted);
  const employmentType = cleanCareerplugStructuredValue(jobPosting.employmentType);
  const locationParts = [city, state, country].filter(Boolean);
  return {
    location: locationParts.length > 0 ? locationParts.join(", ") : "",
    city,
    state,
    country,
    posting_date: datePosted,
    employment_type: employmentType,
    evidence: {
      location_source: locationParts.length > 0 ? "json_ld" : "",
      location_path: locationParts.length > 0 ? "jobLocation.address" : "",
      city_source: city ? "json_ld" : "",
      city_path: city ? "jobLocation.address.addressLocality" : "",
      region_source: state ? "json_ld" : "",
      region_path: state ? "jobLocation.address.addressRegion" : "",
      country_source: country ? "json_ld" : "",
      country_path: country ? "jobLocation.address.addressCountry" : "",
      posting_date_source: datePosted ? "json_ld" : "",
      posting_date_path: datePosted ? "datePosted" : "",
      employment_type_source: employmentType ? "json_ld" : "",
      employment_type_path: employmentType ? "employmentType" : ""
    }
  };
}

function collectCareerplugJsonLdPostings(companyNameForPostings, config, sourceHtml, seenUrls) {
  const jobPosting = findCareerplugJobPostingJsonLd(sourceHtml);
  if (!jobPosting) return [];
  const rawUrl =
    cleanCareerplugStructuredValue(jobPosting.url || jobPosting.sameAs) ||
    extractCareerplugDetailJobUrlFromHtml(sourceHtml);
  const absoluteUrl = normalizeCareerplugCanonicalJobUrl(rawUrl, config);
  if (!absoluteUrl || seenUrls.has(absoluteUrl)) return [];
  const fields = extractCareerplugJsonLdFieldsFromObject(jobPosting);
  const title = cleanCareerplugStructuredValue(jobPosting.title || jobPosting.name);
  if (!title) return [];
  seenUrls.add(absoluteUrl);
  return [{
    company_name: companyNameForPostings,
    source_job_id: extractSourceIdFromPostingUrl(absoluteUrl, "careerplug"),
    position_name: title,
    job_posting_url: absoluteUrl,
    posting_date: fields.posting_date || null,
    location: fields.location || null,
    city: fields.city || null,
    state: fields.state || null,
    country: fields.country || null,
    employment_type: fields.employment_type || null,
    source_evidence: {
      route_kind: "careerplug_json_ld_detail",
      title_source: "json_ld",
      title_path: "JobPosting.title/name",
      canonical_url_source: "detail_page",
      canonical_url_path: "JobPosting.url/link/form action",
      source_job_id_source: "url",
      source_job_id_path: "/jobs/:id",
      ...(fields.evidence || {})
    }
  }];
}

function parseCareerplugPostingsFromHtml(companyNameForPostings, config, pageHtml) {
  const source = String(pageHtml || "");
  const postings = [];
  const seenUrls = new Set();
  postings.push(...collectCareerplugJsonLdPostings(companyNameForPostings, config, source, seenUrls));

  const rowPattern = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  const hrefPattern = /\bhref=["'](\/jobs\/\d+(?:[?#][^"']*)?)["']/i;
  const titlePattern = /<div[^>]*class=["'][^"']*\bjob-title\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i;
  const locationPattern = /<div[^>]*class=["'][^"']*\bjob-location\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i;
  const typePattern = /<div[^>]*class=["'][^"']*\bjob-type\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i;

  let rowMatch = rowPattern.exec(source);
  while (rowMatch) {
    const attrs = String(rowMatch[1] || "");
    const href = String(attrs.match(hrefPattern)?.[1] || "").trim();
    const rowBody = String(rowMatch[2] || "");
    const rowHtml = extractCareerplugRowHtml(source, rowMatch.index) || rowMatch[0] || rowBody;
    if (!href && !titlePattern.test(rowHtml)) {
      rowMatch = rowPattern.exec(source);
      continue;
    }
    const absoluteUrl = href ? new URL(href, `${config.baseOrigin}/`).toString() : "";
    if (!absoluteUrl || seenUrls.has(absoluteUrl)) {
      rowMatch = rowPattern.exec(source);
      continue;
    }

    const title = extractCareerplugTitleFromHtml(rowHtml.match(titlePattern)?.[1] || "", attrs);
    const location = normalizeCareerplugMeta(rowHtml.match(locationPattern)?.[1] || "");
    const jobType = normalizeCareerplugMeta(rowHtml.match(typePattern)?.[1] || "");

    postings.push({
      company_name: companyNameForPostings,
      source_job_id: extractSourceIdFromPostingUrl(absoluteUrl, "careerplug"),
      position_name: title,
      job_posting_url: absoluteUrl,
      posting_date: null,
      location: location || null,
      employment_type: jobType || null
    });
    seenUrls.add(absoluteUrl);
    rowMatch = rowPattern.exec(source);
  }

  return postings;
}


module.exports = {
  parseCareerplugPostingsFromHtml
};
