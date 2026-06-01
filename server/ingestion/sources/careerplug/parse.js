"use strict";

const { decodeHtmlEntities, extractJsonLdObjectsFromHtml } = require("../../parsers/shared/html");
const { extractSourceIdFromPostingUrl } = require("../../parsers/shared/sourceIds");
const { normalizeCountryFromLocation, normalizeCountryName } = require("../../posting");

const CAREERPLUG_US_STATE_CODES = new Set([
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DC", "DE", "FL",
  "GA", "HI", "IA", "ID", "IL", "IN", "KS", "KY", "LA", "MA",
  "MD", "ME", "MI", "MN", "MO", "MS", "MT", "NC", "ND", "NE",
  "NH", "NJ", "NM", "NV", "NY", "OH", "OK", "OR", "PA", "RI",
  "SC", "SD", "TN", "TX", "UT", "VA", "VT", "WA", "WI", "WV",
  "WY"
]);

const CAREERPLUG_CANADA_PROVINCE_CODES = new Set([
  "AB", "BC", "MB", "NB", "NL", "NS", "NT", "NU", "ON", "PE", "QC", "SK", "YT"
]);

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

function careerplugLocationWorkMode(value) {
  return String(value || "").match(/\b(hybrid|remote)\b\s*-?\s*(?:US|USA|United States|CA|Canada)?\s*$/i)?.[1]?.toLowerCase() || "";
}

function stripCareerplugLocationWorkModeSuffix(value) {
  return String(value || "")
    .replace(/\s+\b(?:hybrid|remote)\b\s*-?\s*(?:US|USA|United States|CA|Canada)?\s*$/i, "")
    .trim();
}

function normalizeCareerplugStateCityZipLocation(value) {
  const raw = normalizeCareerplugMeta(value);
  const remoteType = careerplugLocationWorkMode(raw);
  const withoutRemoteSuffix = stripCareerplugLocationWorkModeSuffix(raw);
  const match = withoutRemoteSuffix.match(/^([A-Z]{2})-(.+?)(?:-([A-Z]\d[A-Z]\s?\d[A-Z]\d|\d{5}(?:-\d{4})?))?$/i);
  const state = String(match?.[1] || "").toUpperCase();
  const city = cleanCareerplugText(match?.[2] || "").replace(/\s*-\s*/g, "-").trim();
  const country = CAREERPLUG_CANADA_PROVINCE_CODES.has(state) ? "Canada" : "United States";
  if (!state || !city || (!CAREERPLUG_US_STATE_CODES.has(state) && !CAREERPLUG_CANADA_PROVINCE_CODES.has(state))) return null;
  if (/^\d+$/.test(city)) return null;
  const ruleName = country === "Canada" ? "careerplug_province_city_postal_location" : "careerplug_state_city_zip_location";
  return {
    location: `${city}, ${state}, ${country}`,
    city,
    state,
    country,
    remote_type: remoteType || "onsite",
    workplace_type: remoteType || "onsite",
    evidence: {
      location_source: "labeled_html",
      location_path: ".job-location",
      location_rule_name: ruleName,
      city_source: "labeled_html",
      city_path: ".job-location",
      city_rule_name: ruleName,
      region_source: "labeled_html",
      region_path: ".job-location",
      region_rule_name: ruleName,
      country_source: "labeled_html",
      country_path: ".job-location",
      country_rule_name: ruleName,
      remote_source: "labeled_html",
      remote_path: ".job-location",
      remote_rule_name: remoteType ? "careerplug_labeled_location_work_mode" : "careerplug_structured_physical_location"
    }
  };
}

function normalizeCareerplugDashedLocation(value) {
  const raw = normalizeCareerplugMeta(value);
  if (!raw || raw === "-") return null;
  const remoteType = careerplugLocationWorkMode(raw);
  const withoutRemoteSuffix = stripCareerplugLocationWorkModeSuffix(raw);
  const parts = withoutRemoteSuffix.split("-").map((part) => cleanCareerplugText(part)).filter(Boolean);
  if (parts.length < 2) return null;

  let country = "";
  let city = "";
  let state = "";
  let ruleName = "";
  if (parts[0].toUpperCase() === "PR" && parts[1]) {
    country = "Puerto Rico";
    city = parts[1];
    state = "PR";
    ruleName = "careerplug_pr_city_zip_location";
  } else {
    const stateIndex = parts.findIndex((part, index) => {
      if (index === 0) return false;
      const code = part.toUpperCase();
      return CAREERPLUG_US_STATE_CODES.has(code) || CAREERPLUG_CANADA_PROVINCE_CODES.has(code);
    });
    if (stateIndex <= 0) return null;
    state = parts[stateIndex].toUpperCase();
    country = CAREERPLUG_CANADA_PROVINCE_CODES.has(state) ? "Canada" : "United States";
    city = parts.slice(0, stateIndex).join("-").trim();
    ruleName = country === "Canada" ? "careerplug_canada_city_province_location" : "careerplug_us_city_state_location";
  }

  if (!city || /^\d+$/.test(city)) return null;
  const cityForField = /\/|\bcount(?:y|ies)\b/i.test(city) ? "" : city;
  const location = [cityForField || city, state, country].filter(Boolean).join(", ");

  return {
    location,
    city: cityForField,
    state,
    country,
    remote_type: remoteType || "onsite",
    workplace_type: remoteType || "onsite",
    evidence: {
      location_source: "labeled_html",
      location_path: ".job-location",
      location_rule_name: ruleName,
      city_source: cityForField ? "labeled_html" : "",
      city_path: cityForField ? ".job-location" : "",
      city_rule_name: cityForField ? ruleName : "",
      region_source: "labeled_html",
      region_path: ".job-location",
      region_rule_name: ruleName,
      country_source: "labeled_html",
      country_path: ".job-location",
      country_rule_name: ruleName,
      remote_source: "labeled_html",
      remote_path: ".job-location",
      remote_rule_name: remoteType ? "careerplug_labeled_location_work_mode" : "careerplug_structured_physical_location"
    }
  };
}

function careerplugListLocationFields(value) {
  const normalized = normalizeCareerplugMeta(value);
  if (!normalized) return {
    location: "",
    evidence: {}
  };
  const structured = normalizeCareerplugStateCityZipLocation(normalized);
  if (structured) return structured;
  const dashed = normalizeCareerplugDashedLocation(normalized);
  if (dashed) return dashed;
  return {
    location: normalized,
    evidence: {
      location_source: "labeled_html",
      location_path: ".job-location",
      location_rule_name: "careerplug_job_location"
    }
  };
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

function decodeCareerplugUrlText(value) {
  const normalized = String(value || "").replace(/\+/g, " ");
  try {
    return decodeURIComponent(normalized);
  } catch {
    return normalized;
  }
}

function extractCareerplugTaggedText(sourceHtml, className) {
  return extractCareerplugTaggedTexts(sourceHtml, className)[0] || "";
}

function extractCareerplugTaggedTexts(sourceHtml, className) {
  const escaped = String(className || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`<[^>]*class=["'][^"']*\\b${escaped}\\b[^"']*["'][^>]*>([\\s\\S]*?)<\\/[^>]+>`, "gi");
  const matches = [];
  const source = String(sourceHtml || "");
  let match = pattern.exec(source);
  while (match) {
    const text = cleanCareerplugText(match[1] || "");
    if (text) matches.push(text);
    match = pattern.exec(source);
  }
  return matches;
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

function extractCareerplugShareLocationFields(sourceHtml) {
  const source = String(sourceHtml || "");
  const candidates = [];
  const mailtoPattern = /\bhref=["']mailto:\?([^"']*)["']/gi;
  let mailtoMatch = mailtoPattern.exec(source);
  while (mailtoMatch) {
    candidates.push(decodeCareerplugUrlText(decodeHtmlEntities(mailtoMatch[1] || "")));
    mailtoMatch = mailtoPattern.exec(source);
  }
  candidates.push(cleanCareerplugText(source));

  for (const candidate of candidates) {
    const match = String(candidate || "").match(/\b([A-Z]{2})\s*-\s*([A-Za-z][A-Za-z .'-]{1,80}?)(?:\s*-\s*[^,\r\n]{0,80})?\s+\d{5}(?:-\d{4})?\b/);
    const state = String(match?.[1] || "").toUpperCase();
    const city = cleanCareerplugText(match?.[2] || "");
    if (!state || !city || !CAREERPLUG_US_STATE_CODES.has(state)) continue;
    return {
      location: `${city}, ${state}, United States`,
      city,
      state,
      country: "United States",
      remote_type: "onsite",
      workplace_type: "onsite",
      evidence: {
        location_source: "detail_html",
        location_path: "mailto share body",
        location_rule_name: "careerplug_detail_share_state_city_zip",
        city_source: "detail_html",
        city_path: "mailto share body",
        city_rule_name: "careerplug_detail_share_state_city_zip",
        region_source: "detail_html",
        region_path: "mailto share body",
        region_rule_name: "careerplug_detail_share_state_city_zip",
        country_source: "detail_html",
        country_path: "mailto share body",
        country_rule_name: "careerplug_detail_share_state_city_zip",
        remote_source: "detail_html",
        remote_path: "mailto share body",
        remote_rule_name: "careerplug_detail_structured_physical_location"
      }
    };
  }
  return null;
}

function normalizeCareerplugEmploymentType(value) {
  const cleaned = cleanCareerplugText(value);
  if (!/^(full[\s-]*time|part[\s-]*time|temporary|seasonal|contract|internship|independent contractor)\b/i.test(cleaned)) {
    return "";
  }
  return cleaned;
}

function extractCareerplugDetailPagePosting(companyNameForPostings, config, sourceHtml, seenUrls) {
  const source = String(sourceHtml || "");
  const rawUrl = extractCareerplugDetailJobUrlFromHtml(source);
  const absoluteUrl = normalizeCareerplugCanonicalJobUrl(rawUrl, config);
  if (!absoluteUrl || seenUrls.has(absoluteUrl)) return null;

  const title = cleanCareerplugText(
    extractCareerplugTaggedText(source, "headline") ||
    extractCareerplugTaggedText(source, "job-name") ||
    String(source.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "").replace(/\s+\|\s+.*$/i, "")
  ).replace(/^Future Opening:\s*/i, "").trim();
  if (!title) return null;

  const jobInfoValues = extractCareerplugTaggedTexts(source, "job-info");
  let jobInfoParts = [];
  let employmentType = "";
  for (const jobInfo of jobInfoValues) {
    const parts = jobInfo.split(/\s*(?:&bull;|\u2022|\|)\s*/);
    const candidate = normalizeCareerplugEmploymentType(parts[0] || "");
    if (!candidate) continue;
    jobInfoParts = parts;
    employmentType = candidate;
    break;
  }
  if (!jobInfoParts.length && jobInfoValues.length) {
    jobInfoParts = jobInfoValues[0].split(/\s*(?:&bull;|\u2022|\|)\s*/);
  }
  const locationFields = extractCareerplugShareLocationFields(source) || careerplugListLocationFields(
    extractCareerplugTaggedText(source, "job-location") ||
    jobInfoParts.slice(1).join(" ")
  );

  return {
    company_name: companyNameForPostings,
    source_job_id: extractSourceIdFromPostingUrl(absoluteUrl, "careerplug"),
    position_name: title,
    job_posting_url: absoluteUrl,
    posting_date: null,
    location: locationFields.location || null,
    city: locationFields.city || null,
    state: locationFields.state || null,
    country: locationFields.country || null,
    remote_type: locationFields.remote_type || null,
    workplace_type: locationFields.workplace_type || null,
    employment_type: employmentType || null,
    source_evidence: {
      route_kind: "careerplug_detail_html",
      title_source: "detail_html",
      title_path: "h1.headline|.job-name|title",
      canonical_url_source: "detail_page",
      canonical_url_path: "link[rel='alternate']|a[href*='/jobs/']",
      source_job_id_source: "url",
      source_job_id_path: "/jobs/:id",
      ...(locationFields.evidence || {}),
      employment_type_source: employmentType ? "detail_html" : "",
      employment_type_path: employmentType ? ".job-info" : ""
    }
  };
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
  const detailPosting = extractCareerplugDetailPagePosting(companyNameForPostings, config, source, seenUrls);
  if (detailPosting) {
    postings.push(detailPosting);
    seenUrls.add(detailPosting.job_posting_url);
  }

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
    const locationFields = careerplugListLocationFields(rowHtml.match(locationPattern)?.[1] || "");
    const jobType = normalizeCareerplugMeta(rowHtml.match(typePattern)?.[1] || "");

    postings.push({
      company_name: companyNameForPostings,
      source_job_id: extractSourceIdFromPostingUrl(absoluteUrl, "careerplug"),
      position_name: title,
      job_posting_url: absoluteUrl,
      posting_date: null,
      location: locationFields.location || null,
      city: locationFields.city || null,
      state: locationFields.state || null,
      country: locationFields.country || null,
      remote_type: locationFields.remote_type || null,
      workplace_type: locationFields.workplace_type || null,
      employment_type: jobType || null,
      source_evidence: {
        route_kind: "careerplug_jobs_html",
        title_source: "labeled_html",
        title_path: ".job-title|aria-label",
        canonical_url_source: "labeled_html",
        canonical_url_path: "a[href*='/jobs/']",
        source_job_id_source: "url",
        source_job_id_path: "/jobs/:id",
        ...(locationFields.evidence || {}),
        employment_type_source: jobType ? "labeled_html" : "",
        employment_type_path: jobType ? ".job-type" : ""
      }
    });
    seenUrls.add(absoluteUrl);
    rowMatch = rowPattern.exec(source);
  }

  return postings;
}

module.exports = {
  normalizeCareerplugCanonicalJobUrl,
  parseCareerplugPostingsFromHtml
};
