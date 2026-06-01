"use strict";

const { decodeHtmlEntities } = require("../../parsers/shared/html");
const { normalizeExplicitRemoteValue } = require("../../parsers/shared/remote");
const { extractSourceIdFromPostingUrl } = require("../../parsers/shared/sourceIds");
const { normalizeCountryName } = require("../../posting");

const US_STATE_CODES = new Set([
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DC", "DE", "FL", "GA", "HI", "IA", "ID", "IL", "IN",
  "KS", "KY", "LA", "MA", "MD", "ME", "MI", "MN", "MO", "MS", "MT", "NC", "ND", "NE", "NH", "NJ",
  "NM", "NV", "NY", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VA", "VT", "WA",
  "WI", "WV", "WY"
]);
const CANADA_PROVINCE_CODES = new Set(["AB", "BC", "MB", "NB", "NL", "NS", "NT", "NU", "ON", "PE", "QC", "SK", "YT"]);

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

function normalizeCountryToken(value) {
  if (!value) return "";
  if (typeof value === "object") {
    return normalizeCountryToken(value.name || value.addressCountry || value["@id"]);
  }
  const token = cleanHirebridgeText(value).replace(/\.$/, "");
  return normalizeCountryName(token) || normalizeCountryName(token.toUpperCase()) || "";
}

function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function flattenJsonLd(value, output = []) {
  if (!value) return output;
  if (Array.isArray(value)) {
    for (const item of value) flattenJsonLd(item, output);
    return output;
  }
  if (typeof value !== "object") return output;
  output.push(value);
  flattenJsonLd(value["@graph"], output);
  return output;
}

function extractHirebridgeJsonLdPostings(pageHtml) {
  const source = String(pageHtml || "");
  const postings = [];
  const scriptPattern = /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match = scriptPattern.exec(source);
  while (match) {
    const payload = decodeHtmlEntities(String(match[1] || ""))
      .replace(/^\s*<!--/, "")
      .replace(/-->\s*$/, "")
      .trim();
    const parsed = safeJsonParse(payload);
    for (const item of flattenJsonLd(parsed)) {
      const types = Array.isArray(item?.["@type"]) ? item["@type"] : [item?.["@type"]];
      if (types.map((type) => cleanHirebridgeText(type).toLowerCase()).includes("jobposting")) {
        postings.push(item);
      }
    }
    match = scriptPattern.exec(source);
  }
  return postings;
}

function addressFromJobLocation(jobLocation) {
  const locations = Array.isArray(jobLocation) ? jobLocation : [jobLocation];
  for (const location of locations) {
    if (!location || typeof location !== "object") continue;
    const address = location.address && typeof location.address === "object" ? location.address : {};
    if (Object.keys(address).length > 0) return address;
  }
  return {};
}

function inferCountryFromAddress(address = {}) {
  const explicit = normalizeCountryToken(address.addressCountry);
  if (explicit) return explicit;
  const state = cleanHirebridgeText(address.addressRegion).toUpperCase();
  const postalCode = cleanHirebridgeText(address.postalCode);
  if (CANADA_PROVINCE_CODES.has(state) && /^[A-Z]\d[A-Z][\s-]?\d[A-Z]\d$/i.test(postalCode)) return "Canada";
  if (US_STATE_CODES.has(state)) return "United States";
  return "";
}

function normalizeHirebridgeLocationText(value) {
  const raw = cleanHirebridgeText(value);
  if (!raw) return null;
  const remoteType = normalizeExplicitRemoteValue(raw);
  if (remoteType === "remote" || remoteType === "hybrid") {
    return { location: null, city: "", state: "", country: "", remote_type: remoteType };
  }

  const cityState = raw.match(/\b([A-Z][A-Za-z .'-]+),\s*([A-Z]{2})(?:\s+\d{4,}(?:-\d{4})?)?\b/);
  if (cityState?.[1] && US_STATE_CODES.has(cityState[2].toUpperCase())) {
    const city = cleanHirebridgeText(cityState[1]);
    const state = cityState[2].toUpperCase();
    return {
      location: `${city}, ${state}, United States`,
      city,
      state,
      country: "United States",
      remote_type: null
    };
  }

  const commaParts = raw.split(",").map(cleanHirebridgeText).filter(Boolean);
  if (commaParts.length >= 2) {
    const country = normalizeCountryToken(commaParts[commaParts.length - 1]);
    if (country) {
      const city = commaParts[0];
      return {
        location: [city, country].filter(Boolean).join(", "),
        city,
        state: "",
        country,
        remote_type: null
      };
    }
  }

  const statePrefix = raw.match(/^\s*([A-Z]{2})\s*-\s*([A-Z][A-Za-z .'-]+?)(?:\s*-|\s*\(|$)/);
  if (statePrefix?.[1] && statePrefix?.[2] && US_STATE_CODES.has(statePrefix[1].toUpperCase())) {
    const state = statePrefix[1].toUpperCase();
    const city = cleanHirebridgeText(statePrefix[2]);
    return {
      location: `${city}, ${state}, United States`,
      city,
      state,
      country: "United States",
      remote_type: null
    };
  }

  const country = normalizeCountryToken(raw);
  if (country) return { location: country, city: "", state: "", country, remote_type: null };
  if (/[A-Z][A-Za-z .'-]+,\s*[A-Z][A-Za-z .'-]+/.test(raw)) {
    return { location: raw, city: "", state: "", country: "", remote_type: null };
  }
  return null;
}

function normalizeHirebridgeAddress(address = {}) {
  const city = cleanHirebridgeText(address.addressLocality);
  const state = cleanHirebridgeText(address.addressRegion).toUpperCase();
  const country = inferCountryFromAddress(address);
  if (!city && !state && !country) return null;
  return {
    location: [city, state, country].filter(Boolean).join(", "),
    city,
    state,
    country,
    remote_type: null
  };
}

function extractSpanTextByIdSuffix(pageHtml, suffix) {
  const escaped = String(suffix || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`<span\\b[^>]*id=["'][^"']*${escaped}["'][^>]*>([\\s\\S]*?)<\\/span>`, "i");
  return cleanHirebridgeText(String(pageHtml || "").match(pattern)?.[1] || "");
}

function classifyHirebridgeListLocation(value) {
  return normalizeHirebridgeLocationText(value);
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
    const listLocation = classifyHirebridgeListLocation(department);
    const listEvidence = listLocation
      ? {
          location_source: "list_html",
          location_path: ".department",
          location_rule_name: "hirebridge_list_department_geo_or_remote",
          remote_source: listLocation.remote_type ? "list_html" : "",
          remote_path: listLocation.remote_type ? ".department" : ""
        }
      : undefined;

    postings.push({
      company_name: companyNameForPostings,
      source_job_id: extractSourceIdFromPostingUrl(absoluteUrl, "hirebridge"),
      position_name: title,
      job_posting_url: absoluteUrl,
      posting_date: null,
      location: listLocation?.location || null,
      city: listLocation?.city || null,
      state: listLocation?.state || null,
      country: listLocation?.country || null,
      remote_type: listLocation?.remote_type || null,
      department: department || null,
      source_evidence: listEvidence
    });

    seenUrls.add(absoluteUrl);
    itemMatch = itemPattern.exec(source);
  }

  return postings;
}

function extractHirebridgeDetailFields(pageHtml) {
  const jsonPosting = extractHirebridgeJsonLdPostings(pageHtml)[0] || {};
  const addressLocation = normalizeHirebridgeAddress(addressFromJobLocation(jsonPosting.jobLocation));
  const htmlLocation = normalizeHirebridgeLocationText(extractSpanTextByIdSuffix(pageHtml, "jobloc"));
  const location = addressLocation || htmlLocation;
  const jsonRemoteType = normalizeExplicitRemoteValue(jsonPosting.jobLocationType);
  const htmlRemoteType = normalizeExplicitRemoteValue(extractSpanTextByIdSuffix(pageHtml, "jobtype"));
  const remoteType = jsonRemoteType || htmlRemoteType || location?.remote_type || null;
  const locationSource = addressLocation ? "detail_json_ld" : (htmlLocation ? "detail_html" : "");
  const locationPath = addressLocation ? "script[type=\"application/ld+json\"].jobLocation.address" : "span[id$=\"jobloc\"]";

  return {
    posting_date: cleanHirebridgeText(jsonPosting.datePosted) || extractHirebridgeDatePostedFromDetailHtml(pageHtml),
    location: location?.location || null,
    city: location?.city || null,
    state: location?.state || null,
    country: location?.country || null,
    remote_type: remoteType,
    department: extractSpanTextByIdSuffix(pageHtml, "jobdept") || extractSpanTextByIdSuffix(pageHtml, "jobcat") || null,
    employment_type: cleanHirebridgeText(jsonPosting.employmentType) || extractSpanTextByIdSuffix(pageHtml, "jobtype") || null,
    location_source: locationSource,
    location_path: locationPath,
    remote_source: jsonRemoteType ? "detail_json_ld" : (htmlRemoteType || location?.remote_type ? locationSource : ""),
    remote_path: jsonRemoteType ? "script[type=\"application/ld+json\"].jobLocationType" : (htmlRemoteType || location?.remote_type ? locationPath : "")
  };
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
  extractHirebridgeDetailFields,
  extractHirebridgeJsonLdPostings,
  parseHirebridgePostingsFromHtml
};
