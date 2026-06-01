"use strict";

const { decodeHtmlEntities } = require("../../parsers/shared/html");
const { isRemoteOnlyLocationValue } = require("../../parsers/shared/location");
const { extractSourceIdFromPostingUrl } = require("../../parsers/shared/sourceIds");
const { locationLooksAmbiguous } = require("../../parserEvidence");
const { normalizeCountryFromLocation, normalizeCountryName, normalizeRemoteType } = require("../../posting");

const HRMDIRECT_US_STATE_NAMES = new Set([
  "alabama",
  "alaska",
  "arizona",
  "arkansas",
  "california",
  "colorado",
  "connecticut",
  "delaware",
  "district of columbia",
  "florida",
  "georgia",
  "hawaii",
  "idaho",
  "illinois",
  "indiana",
  "iowa",
  "kansas",
  "kentucky",
  "louisiana",
  "maine",
  "maryland",
  "massachusetts",
  "michigan",
  "minnesota",
  "mississippi",
  "missouri",
  "montana",
  "nebraska",
  "nevada",
  "new hampshire",
  "new jersey",
  "new mexico",
  "new york",
  "north carolina",
  "north dakota",
  "ohio",
  "oklahoma",
  "oregon",
  "pennsylvania",
  "rhode island",
  "south carolina",
  "south dakota",
  "tennessee",
  "texas",
  "utah",
  "vermont",
  "virginia",
  "washington",
  "west virginia",
  "wisconsin",
  "wyoming"
]);

const HRMDIRECT_CANADA_PROVINCE_NAMES = new Set([
  "alberta",
  "british columbia",
  "manitoba",
  "new brunswick",
  "newfoundland and labrador",
  "nova scotia",
  "northwest territories",
  "nunavut",
  "ontario",
  "prince edward island",
  "quebec",
  "saskatchewan",
  "yukon"
]);

const HRMDIRECT_PUERTO_RICO_NUMERIC_REGION_CITIES = new Set([
  "aibonito",
  "barceloneta",
  "carolina",
  "cayey",
  "dorado",
  "gurabo",
  "humacao",
  "juana diaz",
  "juncos",
  "manati",
  "punta santiago"
]);

const HRMDIRECT_US_STATE_ABBREVIATION_PATTERN =
  /\b(AL|AK|AZ|AR|CA|CO|CT|DC|DE|FL|GA|HI|IA|ID|IL|IN|KS|KY|LA|MA|MD|ME|MI|MN|MO|MS|MT|NC|ND|NE|NH|NJ|NM|NV|NY|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VA|VT|WA|WI|WV|WY)\b/i;
const HRMDIRECT_US_STATE_ABBREVIATION_EXACT_PATTERN =
  /^(AL|AK|AZ|AR|CA|CO|CT|DC|DE|FL|GA|HI|IA|ID|IL|IN|KS|KY|LA|MA|MD|ME|MI|MN|MO|MS|MT|NC|ND|NE|NH|NJ|NM|NV|NY|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VA|VT|WA|WI|WV|WY)$/i;
const HRMDIRECT_STREET_SUFFIX_PATTERN =
  /\b(?:ave(?:nue)?|blvd|boulevard|cir(?:cle)?|ct|court|dr(?:ive)?|hwy|highway|ln|lane|pkwy|parkway|pl|place|rd|road|st|street|way)\b/i;
const HRMDIRECT_OFFICE_COUNTRY_ALIASES = Object.freeze({
  "u s": "United States",
  "us": "United States",
  "u s a": "United States",
  "usa": "United States",
  "united states": "United States",
  "u k": "United Kingdom",
  "uk": "United Kingdom",
  "united kingdom": "United Kingdom",
  "guyana": "Guyana"
});

function parseUrl(urlString) {
  try {
    return new URL(String(urlString || ""));
  } catch {
    return null;
  }
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function cleanHrmDirectText(value) {
  return decodeHtmlEntities(String(value || "").replace(/&nbsp;/gi, " ").replace(/<[^>]+>/g, " "))
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanHrmDirectLocationText(value) {
  const text = cleanHrmDirectText(value)
    .replace(/\s*,\s*/g, ", ")
    .replace(/\s+/g, " ")
    .replace(/^,\s*/g, "")
    .replace(/\s*,$/g, "")
    .trim();
  if (!text || /^[,;:|/\s-]+$/.test(text)) return "";
  return text;
}

function normalizeHrmDirectSearchText(value) {
  return cleanHrmDirectText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function normalizeHrmDirectPuertoRicoNumericRegionCountry(city, state) {
  const normalizedCity = normalizeHrmDirectSearchText(city);
  const stateCode = cleanHrmDirectText(state);
  if (!/^\d{3}$/.test(stateCode)) return "";
  if (!HRMDIRECT_PUERTO_RICO_NUMERIC_REGION_CITIES.has(normalizedCity)) return "";
  return "Puerto Rico";
}

function isHrmDirectPlaceholderTitle(value) {
  const normalized = cleanHrmDirectText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return normalized === "apply today" || normalized === "here" || normalized === "read more";
}

function extractHrmDirectWorkModeLocationText(value) {
  const text = cleanHrmDirectLocationText(value);
  if (!text) return "";
  let withoutMode = text.replace(/^job\s+location\s*:\s*/i, "").trim();
  for (let index = 0; index < 3; index += 1) {
    const next = withoutMode
      .replace(/^(?:or\s+)?(?:remote|hybrid|on[-\s]?site|onsite)\s*(?:[-:|/]\s*)?/i, "")
      .trim();
    if (next === withoutMode) break;
    withoutMode = next;
  }
  const candidate = withoutMode === text && normalizeRemoteType(text) !== "unknown" ? "" : withoutMode;
  if (!candidate || isRemoteOnlyLocationValue(candidate)) return "";
  return cleanHrmDirectLocationText(candidate);
}

function normalizeHrmDirectRemoteScopeLocation(value) {
  const text = cleanHrmDirectLocationText(value);
  if (!text) return "";
  const normalized = text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (
    normalizeCountryFromLocation(text) === "United States" &&
    /^(?:continental\s+u\s+s|u\s+s|u\s+s\s+a|united\s+states)$/.test(normalized)
  ) {
    return "United States";
  }
  return text;
}

function extractHrmDirectListRemoteLocation(value) {
  const remoteType = normalizeRemoteType(value);
  if (!["remote", "hybrid"].includes(remoteType)) {
    return { location: "", remoteType: "unknown" };
  }
  return {
    location: normalizeHrmDirectRemoteScopeLocation(extractHrmDirectWorkModeLocationText(value)),
    remoteType
  };
}

function normalizeHrmDirectOfficeCountry(value) {
  const text = cleanHrmDirectLocationText(value);
  if (!text) return "";
  const normalizedKey = text
    .toLowerCase()
    .replace(/[.]/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return HRMDIRECT_OFFICE_COUNTRY_ALIASES[normalizedKey] || normalizeCountryName(text);
}

function stripHrmDirectOfficeDescriptor(value) {
  let candidate = cleanHrmDirectLocationText(value);
  if (!candidate) return "";
  candidate = candidate.replace(/^(?:corporate|field)\s+/i, "").trim();
  candidate = candidate.replace(/\s+(?:remote\s+)?(?:onshore|offshore)$/i, "").trim();
  candidate = candidate.replace(/\s+(?:remote|hybrid)$/i, "").trim();
  return cleanHrmDirectLocationText(candidate);
}

function titleCaseHrmDirectRegionName(value) {
  return cleanHrmDirectLocationText(value)
    .toLowerCase()
    .split(/\s+/)
    .map((part) => part === "of" ? part : part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function extractHrmDirectOfficeRemoteScopeType(value) {
  const text = cleanHrmDirectLocationText(value);
  if (!text) return "";
  const stateRemoteMatch = text.match(
    /^(?:AL|AK|AZ|AR|CA|CO|CT|DC|DE|FL|GA|HI|IA|ID|IL|IN|KS|KY|LA|MA|MD|ME|MI|MN|MO|MS|MT|NC|ND|NE|NH|NJ|NM|NV|NY|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VA|VT|WA|WI|WV|WY)\s*[-/]\s*(remote|hybrid)$/i
  );
  if (stateRemoteMatch?.[1]) return stateRemoteMatch[1].toLowerCase() === "hybrid" ? "hybrid" : "remote";
  const countryRemoteMatch = text
    .replace(/^corporate\s+/i, "")
    .trim()
    .match(/^(?:US|U\.S\.|USA|U\.S\.A\.|United States|UK|U\.K\.|United Kingdom)\s*[-/]?\s*(remote|hybrid)$/i);
  if (countryRemoteMatch?.[1]) return countryRemoteMatch[1].toLowerCase() === "hybrid" ? "hybrid" : "remote";
  return "";
}

function extractHrmDirectOfficeRemoteRegionScope(value) {
  const text = cleanHrmDirectLocationText(value);
  if (!text) return null;
  const prefixMatch = text.match(/^(remote|hybrid)\s*[-/]\s*(.+)$/i);
  const suffixMatch = text.match(/^(.+?)\s*[-/]\s*(remote|hybrid)$/i);
  const remoteValue = prefixMatch?.[1] || suffixMatch?.[2] || "";
  const regionValue = cleanHrmDirectLocationText(prefixMatch?.[2] || suffixMatch?.[1] || "");
  const remoteType = normalizeRemoteType(remoteValue);
  const normalizedRegion = regionValue.toLowerCase();
  if (!regionValue || !["remote", "hybrid"].includes(remoteType)) return null;
  if (HRMDIRECT_US_STATE_NAMES.has(normalizedRegion)) {
    return {
      location: titleCaseHrmDirectRegionName(regionValue),
      country: "United States",
      remoteType,
      ruleName: "hrmdirect_detail_office_remote_region_scope",
      remoteRuleName: "hrmdirect_detail_office_remote_scope"
    };
  }
  if (HRMDIRECT_CANADA_PROVINCE_NAMES.has(normalizedRegion)) {
    return {
      location: titleCaseHrmDirectRegionName(regionValue),
      country: "Canada",
      remoteType,
      ruleName: "hrmdirect_detail_office_remote_region_scope",
      remoteRuleName: "hrmdirect_detail_office_remote_scope"
    };
  }
  return null;
}

function extractHrmDirectOfficeLocation(value) {
  const text = cleanHrmDirectLocationText(value);
  if (!text || /^unassigned\s+office$/i.test(text)) {
    return { location: "", country: "", remoteType: "unknown", ruleName: "", remoteRuleName: "" };
  }
  const exactOfficeRemoteType = /^(?:remote|hybrid)$/i.test(text) ? normalizeRemoteType(text) : "unknown";
  if (exactOfficeRemoteType !== "unknown") {
    return {
      location: "",
      country: "",
      remoteType: exactOfficeRemoteType,
      ruleName: "",
      remoteRuleName: "hrmdirect_detail_office_remote_only"
    };
  }
  const officeRemoteRegionScope = extractHrmDirectOfficeRemoteRegionScope(text);
  if (officeRemoteRegionScope) return officeRemoteRegionScope;
  if (isRemoteOnlyLocationValue(text)) {
    return { location: "", country: "", remoteType: "unknown", ruleName: "", remoteRuleName: "" };
  }
  const remoteScopeType = extractHrmDirectOfficeRemoteScopeType(text);
  const stateRemoteMatch = text.match(HRMDIRECT_US_STATE_ABBREVIATION_PATTERN);
  if (remoteScopeType && stateRemoteMatch?.[0] && /^\s*[A-Z]{2}\s*[-/]\s*(?:remote|hybrid)\s*$/i.test(text)) {
    return {
      location: stateRemoteMatch[0].toUpperCase(),
      country: "United States",
      remoteType: remoteScopeType,
      ruleName: "hrmdirect_detail_office_state_remote_scope",
      remoteRuleName: "hrmdirect_detail_office_remote_scope"
    };
  }
  if (HRMDIRECT_US_STATE_NAMES.has(text.toLowerCase())) {
    return { location: text, country: "United States", remoteType: "unknown", ruleName: "hrmdirect_detail_office_state", remoteRuleName: "" };
  }
  if (HRMDIRECT_CANADA_PROVINCE_NAMES.has(text.toLowerCase())) {
    return { location: text, country: "Canada", remoteType: "unknown", ruleName: "hrmdirect_detail_office_province", remoteRuleName: "" };
  }
  const compactText = text.replace(/[^A-Za-z0-9]+/g, "");
  const country = compactText.length > 2 ? normalizeCountryName(text) : "";
  if (country) {
    return { location: country, country, remoteType: "unknown", ruleName: "hrmdirect_detail_office_country", remoteRuleName: "" };
  }
  const officeCandidate = stripHrmDirectOfficeDescriptor(text);
  const officeCountry = officeCandidate && officeCandidate !== text ? normalizeHrmDirectOfficeCountry(officeCandidate) : "";
  if (officeCountry) {
    return {
      location: officeCountry,
      country: officeCountry,
      remoteType: remoteScopeType || "unknown",
      ruleName: remoteScopeType ? "hrmdirect_detail_office_country_remote_scope" : "hrmdirect_detail_office_country_prefixed",
      remoteRuleName: remoteScopeType ? "hrmdirect_detail_office_remote_scope" : ""
    };
  }
  return { location: "", country: "", remoteType: "unknown", ruleName: "", remoteRuleName: "" };
}

function toHrmDirectListOfficeLocation(officeLocation) {
  if (!officeLocation?.location && !officeLocation?.remoteRuleName) return officeLocation;
  return {
    ...officeLocation,
    ruleName: officeLocation.location
      ? String(officeLocation.ruleName || "").replace("hrmdirect_detail_", "hrmdirect_list_")
      : String(officeLocation.ruleName || ""),
    remoteRuleName: String(officeLocation.remoteRuleName || "")
      .replace("hrmdirect_detail_", "hrmdirect_list_")
  };
}

function hrmDirectDetailLocationRuleName(value) {
  const text = cleanHrmDirectLocationText(value);
  if (HRMDIRECT_US_STATE_ABBREVIATION_EXACT_PATTERN.test(text)) return "hrmdirect_detail_location_state_abbreviation";
  return "";
}

function extractHrmDirectDetailRemoteTag(detailHtml) {
  const text = cleanHrmDirectText(detailHtml);
  const match = text.match(/(?:^|[\s.;,()[\]{}])#LI[-_\s]?(Remote|Hybrid)\b/i);
  if (!match?.[1]) return "";
  return String(match[1]).toLowerCase() === "hybrid" ? "hybrid" : "remote";
}

function extractHrmDirectDetailBodyLocationRemoteType(detailHtml) {
  const text = cleanHrmDirectText(detailHtml);
  const directMatch = text.match(/\bLocation\s*:\s*(Remote|Hybrid)\b/i);
  const roleMatch = text.match(/\bLocation\s*:\s*This\s+is\s+a\s+(remote|hybrid)\s+(?:role|position|job)\b/i);
  const value = directMatch?.[1] || roleMatch?.[1] || "";
  if (!value) return "";
  return String(value).toLowerCase() === "hybrid" ? "hybrid" : "remote";
}

function extractHrmDirectDetailBodyWorkArrangementRemoteType(detailHtml) {
  const text = cleanHrmDirectText(detailHtml);
  const match = text.match(
    /\bWork\s+(?:Arrangement|Environment)\s*:?\s*(?:This\s+is\s+a\s+)?(?:full[-\s]?time,?\s*)?(?:fully\s+)?(remote|hybrid)\s+(?:position|role|job)\b/i
  );
  if (!match?.[1]) return "";
  return String(match[1]).toLowerCase() === "hybrid" ? "hybrid" : "remote";
}

function extractHrmDirectDetailBodyWorkModeTagRemoteType(detailHtml) {
  const text = cleanHrmDirectText(detailHtml);
  const match = text.match(/\b(?:full[-\s]?time|part[-\s]?time|contract)\s*\/\s*(remote|hybrid)\b/i);
  if (match?.[1]) return String(match[1]).toLowerCase() === "hybrid" ? "hybrid" : "remote";
  const workFromHomeMatch = text.match(/\b(?:100%\s*)?remote\s*(?:[-\u2013\u2014\uFFFD]\s*)?(?:work\s+from\s+home|wfh)\b/i);
  if (workFromHomeMatch) return "remote";
  return "";
}

function extractHrmDirectDetailBodyAddressLocation(detailHtml) {
  const text = cleanHrmDirectText(detailHtml);
  const locationAddressPattern = /\bLocation\s*:\s*([^:]{0,220}?,\s*([A-Za-z][A-Za-z .'-]{1,60}),\s*(AL|AK|AZ|AR|CA|CO|CT|DC|DE|FL|GA|HI|IA|ID|IL|IN|KS|KY|LA|MA|MD|ME|MI|MN|MO|MS|MT|NC|ND|NE|NH|NJ|NM|NV|NY|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VA|VT|WA|WI|WV|WY)\s+\d{5}(?:-\d{4})?)\b/gi;
  let match = locationAddressPattern.exec(text);
  while (match) {
    const address = cleanHrmDirectLocationText(match[1]);
    const city = cleanHrmDirectLocationText(match[2]);
    const state = cleanHrmDirectText(match[3]).toUpperCase();
    const location = cleanHrmDirectLocationText(`${city}, ${state}`);
    if (
      address &&
      /\d/.test(address) &&
      HRMDIRECT_STREET_SUFFIX_PATTERN.test(address) &&
      HRMDIRECT_US_STATE_ABBREVIATION_PATTERN.test(state) &&
      city &&
      !/\d/.test(city) &&
      location
    ) {
      return location;
    }
    match = locationAddressPattern.exec(text);
  }
  return "";
}

function extractHrmDirectRssValue(itemXml, tagName) {
  const escapedTagName = escapeRegExp(tagName);
  const match = String(itemXml || "").match(new RegExp(`<${escapedTagName}\\b[^>]*>([\\s\\S]*?)<\\/${escapedTagName}>`, "i"));
  return cleanHrmDirectText(String(match?.[1] || "").replace(/<!\[CDATA\[/g, "").replace(/\]\]>/g, ""));
}

function extractHrmDirectRssPostingDateByReq(rssXml) {
  const source = String(rssXml || "");
  if (!source) return {};
  const postingDateByReq = {};
  const itemPattern = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
  let itemMatch = itemPattern.exec(source);
  while (itemMatch) {
    const itemXml = String(itemMatch[1] || "");
    const link = extractHrmDirectRssValue(itemXml, "link");
    const guid = extractHrmDirectRssValue(itemXml, "guid");
    const sourceJobId = [link, guid]
      .map((value) => extractSourceIdFromPostingUrl(value, "hrmdirect"))
      .find(Boolean);
    const pubDate = extractHrmDirectRssValue(itemXml, "pubDate");
    if (sourceJobId && pubDate && !postingDateByReq[sourceJobId]) {
      postingDateByReq[sourceJobId] = pubDate;
    }
    itemMatch = itemPattern.exec(source);
  }
  return postingDateByReq;
}

function normalizeHrmDirectHref(value) {
  return decodeHtmlEntities(String(value || ""))
    .replace(/&#job/gi, "")
    .replace(/#job/gi, "")
    .replace(/&{2,}/g, "&")
    .replace(/[&\s]+$/g, "")
    .trim();
}

function normalizeHrmDirectJobPostingUrl(value) {
  const parsed = parseUrl(value);
  if (!parsed) return String(value || "").trim();
  parsed.hash = "";
  if (/\/employment\/job-opening\.php$/i.test(parsed.pathname)) {
    for (const key of Array.from(parsed.searchParams.keys())) {
      if (/^cust_sort/i.test(key) || key === "search") parsed.searchParams.delete(key);
    }
  }
  return parsed.toString();
}

function extractHrmDirectReqLocFromPostingUrl(value) {
  const parsed = parseUrl(value);
  return cleanHrmDirectText(parsed?.searchParams?.get("req_loc") || "");
}

function buildHrmDirectSourceJobId(baseReq, reqLoc, duplicateReqIds) {
  const req = cleanHrmDirectText(baseReq);
  const locationId = cleanHrmDirectText(reqLoc);
  if (req && locationId && duplicateReqIds?.has(req)) return `${req}:${locationId}`;
  return req;
}

function extractHrmDirectCellValue(rowHtml, className) {
  const escapedClassName = escapeRegExp(String(className || "").trim());
  if (!escapedClassName) return "";
  const cellRegex = new RegExp(
    `<td[^>]*class=["'][^"']*\\b${escapedClassName}\\b[^"']*["'][^>]*>([\\s\\S]*?)<\\/td>`,
    "i"
  );
  return String(rowHtml.match(cellRegex)?.[1] || "");
}

function extractLatestHrmDirectDepartmentBefore(source, index) {
  const windowStart = Math.max(0, Number(index || 0) - 12000);
  const prefix = String(source || "").slice(windowStart, Number(index || 0));
  const departmentMatches = Array.from(prefix.matchAll(
    /<h3[^>]*class=["'][^"']*\breqhead\b[^"']*["'][^>]*>([\s\S]*?)<\/h3>/gi
  ));
  const latest = departmentMatches[departmentMatches.length - 1];
  return cleanHrmDirectText(latest?.[1] || "");
}

function extractHrmDirectGroupedDivLocationAfter(source, index) {
  const segment = String(source || "").slice(Number(index || 0), Number(index || 0) + 1800);
  const match = segment.match(/<div[^>]*style=["'][^"']*\bfloat\s*:\s*right\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
  const location = cleanHrmDirectLocationText(match?.[1] || "");
  if (/^location:?$/i.test(location)) return "";
  return location;
}

function canonicalHrmDirectDetailKey(urlValue) {
  try {
    const parsed = new URL(String(urlValue || ""));
    parsed.hash = "";
    return parsed.toString().replace(/\/+$/, "");
  } catch {
    return String(urlValue || "").trim().replace(/#.*$/, "").replace(/\/+$/, "");
  }
}

function lookupHrmDirectDetailHtml(detailHtmlByUrl, urlValue) {
  const map = detailHtmlByUrl && typeof detailHtmlByUrl === "object" ? detailHtmlByUrl : {};
  const key = canonicalHrmDirectDetailKey(urlValue);
  const candidates = [
    String(urlValue || ""),
    String(urlValue || "").replace(/#.*$/, ""),
    key,
    `${key}/`
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (typeof map[candidate] === "string") return map[candidate];
  }
  return "";
}

function lookupHrmDirectDetailMapValue(mapValue, urlValue) {
  const map = mapValue && typeof mapValue === "object" ? mapValue : {};
  const key = canonicalHrmDirectDetailKey(urlValue);
  const candidates = [
    String(urlValue || ""),
    String(urlValue || "").replace(/#.*$/, ""),
    key,
    `${key}/`
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (Object.prototype.hasOwnProperty.call(map, candidate)) return map[candidate];
  }
  return "";
}

function extractHrmDirectViewFieldsTable(detailHtml) {
  const source = String(detailHtml || "");
  const matches = Array.from(source.matchAll(
    /<table[^>]*class=["'][^"']*\bviewFields\b[^"']*["'][^>]*>([\s\S]*?)<\/table>/gi
  ));
  return matches.map((match) => String(match?.[1] || "")).filter(Boolean).join("\n");
}

function extractHrmDirectViewField(detailHtml, labels) {
  const source = extractHrmDirectViewFieldsTable(detailHtml);
  if (!source) return "";
  const normalizedLabels = new Set(
    (Array.isArray(labels) ? labels : [labels])
      .map((label) => cleanHrmDirectText(label).replace(/:$/g, "").toLowerCase())
      .filter(Boolean)
  );
  if (normalizedLabels.size === 0) return "";

  const rowPattern = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch = rowPattern.exec(source);
  while (rowMatch) {
    const cells = Array.from(String(rowMatch[1] || "").matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi))
      .map((cellMatch) => cleanHrmDirectText(cellMatch?.[1] || ""))
      .filter(Boolean);
    const label = String(cells[0] || "").replace(/:$/g, "").trim().toLowerCase();
    const value = cells.slice(1).join(" ").trim();
    if (normalizedLabels.has(label) && value) return value;
    rowMatch = rowPattern.exec(source);
  }
  return "";
}

function extractHrmDirectDetailFields(detailHtml) {
  const primaryLocationValue = cleanHrmDirectLocationText(extractHrmDirectViewField(detailHtml, ["Location", "Job Location", "Work Location"]));
  const primaryLocationRemoteType = normalizeRemoteType(primaryLocationValue);
  const detailLocationRemoteType = ["remote", "hybrid"].includes(primaryLocationRemoteType) ? primaryLocationRemoteType : "";
  const primaryLocation = detailLocationRemoteType
    ? extractHrmDirectWorkModeLocationText(primaryLocationValue)
    : primaryLocationValue;
  const primaryLocationRuleName =
    hrmDirectDetailLocationRuleName(primaryLocation) ||
    (detailLocationRemoteType && primaryLocation ? "hrmdirect_detail_remote_scope_location" : "");
  const officeLocation = primaryLocation
    ? { location: "", ruleName: "" }
    : extractHrmDirectOfficeLocation(extractHrmDirectViewField(detailHtml, "Office"));
  const bodyAddressLocation = primaryLocation || officeLocation.location
    ? ""
    : extractHrmDirectDetailBodyAddressLocation(detailHtml);
  const location = primaryLocation || officeLocation.location || bodyAddressLocation;
  const department = extractHrmDirectViewField(detailHtml, ["Department", "Team", "Category"]);
  const employmentType = extractHrmDirectViewField(detailHtml, ["Employment Type", "Job Type", "Type"]);
  const postingDate = extractHrmDirectViewField(detailHtml, ["Date Posted", "Posted Date", "Posting Date", "Open Date"]);
  const workplaceType = extractHrmDirectViewField(detailHtml, ["Workplace Type", "Work Type", "Work Arrangement", "Remote"]);
  const detailRemoteType = normalizeRemoteType(workplaceType);
  const detailRemoteTag = ["remote", "hybrid"].includes(detailRemoteType) || detailLocationRemoteType ? "" : extractHrmDirectDetailRemoteTag(detailHtml);
  const detailBodyRemoteType = ["remote", "hybrid"].includes(detailRemoteType) || detailLocationRemoteType || detailRemoteTag
    ? ""
    : extractHrmDirectDetailBodyLocationRemoteType(detailHtml);
  const detailBodyWorkArrangementRemoteType = ["remote", "hybrid"].includes(detailRemoteType) || detailLocationRemoteType || detailRemoteTag || detailBodyRemoteType
    ? ""
    : extractHrmDirectDetailBodyWorkArrangementRemoteType(detailHtml);
  const detailBodyWorkModeTagRemoteType = ["remote", "hybrid"].includes(detailRemoteType) || detailLocationRemoteType || detailRemoteTag || detailBodyRemoteType || detailBodyWorkArrangementRemoteType
    ? ""
    : extractHrmDirectDetailBodyWorkModeTagRemoteType(detailHtml);
  const detailOfficeRemoteType = officeLocation.remoteType && officeLocation.remoteType !== "unknown" ? officeLocation.remoteType : "";
  const remoteType = ["remote", "hybrid"].includes(detailRemoteType)
    ? detailRemoteType
    : detailLocationRemoteType || detailRemoteTag || detailBodyRemoteType || detailBodyWorkArrangementRemoteType || detailBodyWorkModeTagRemoteType || detailOfficeRemoteType;
  const locationPath = primaryLocation
    ? "table.viewFields Location"
    : officeLocation.location
      ? "table.viewFields Office"
      : bodyAddressLocation
        ? "detail body Location"
        : "";
  const locationSource = bodyAddressLocation ? "labeled_detail_body" : location ? "labeled_detail_html" : "";
  const locationRuleName = primaryLocationRuleName || officeLocation.ruleName || (bodyAddressLocation ? "hrmdirect_detail_body_location_address" : "");
  const country = primaryLocationRuleName === "hrmdirect_detail_location_state_abbreviation" ? "United States" : officeLocation.country || "";
  const remoteSource = remoteType
    ? detailRemoteTag ? "structured_detail_tag" : detailBodyRemoteType || detailBodyWorkArrangementRemoteType || detailBodyWorkModeTagRemoteType ? "labeled_detail_body" : "labeled_detail_html"
    : "";
  const remotePath = remoteType
    ? detailRemoteTag
      ? "detail text #LI-Remote/#LI-Hybrid"
      : detailBodyRemoteType
        ? "detail body Location"
        : detailBodyWorkArrangementRemoteType
          ? "detail body Work Arrangement/Work Environment"
          : detailBodyWorkModeTagRemoteType
            ? "detail body work mode tag"
            : detailLocationRemoteType
              ? "table.viewFields Location"
              : detailOfficeRemoteType
                ? "table.viewFields Office"
                : "table.viewFields Workplace Type"
    : "";
  const remoteRuleName = remoteType
    ? detailRemoteTag
      ? "hrmdirect_detail_li_remote_tag"
      : detailBodyRemoteType
        ? "hrmdirect_detail_body_location_remote"
        : detailBodyWorkArrangementRemoteType
          ? "hrmdirect_detail_body_work_arrangement_remote"
          : detailBodyWorkModeTagRemoteType
            ? "hrmdirect_detail_body_work_mode_tag"
            : detailLocationRemoteType
              ? "hrmdirect_detail_location_remote"
              : detailOfficeRemoteType
                ? officeLocation.remoteRuleName
                : "hrmdirect_detail_workplace_type"
    : "";
  return {
    location,
    department,
    employment_type: employmentType,
    posting_date: postingDate,
    remote_type: remoteType,
    country,
    evidence: {
      location_source: locationSource,
      location_path: locationPath,
      location_rule_name: locationRuleName,
      department_source: department ? "labeled_detail_html" : "",
      department_path: department ? "table.viewFields Department" : "",
      employment_type_source: employmentType ? "labeled_detail_html" : "",
      employment_type_path: employmentType ? "table.viewFields Employment Type/Job Type" : "",
      posting_date_source: postingDate ? "labeled_detail_html" : "",
      posting_date_path: postingDate ? "table.viewFields Date Posted/Posted Date/Posting Date/Open Date" : "",
      posting_date_rule_name: postingDate ? "hrmdirect_detail_posting_date" : "",
      remote_source: remoteSource,
      remote_path: remotePath,
      remote_rule_name: remoteRuleName
    }
  };
}

function hrmDirectSourceFailureReasons(posting) {
  const reasons = [];
  const location = cleanHrmDirectLocationText(posting.location || posting.location_text);
  const remoteType = cleanHrmDirectText(posting.remote_type).toLowerCase();
  const locationRemoteType = normalizeRemoteType(location);
  const hasExplicitRemote = ["remote", "hybrid"].includes(remoteType);
  const hasExplicitOnsite = remoteType === "onsite";
  if (location && locationLooksAmbiguous(location, posting)) {
    reasons.push("ambiguous_location");
  }
  if (!location && !hasExplicitRemote && locationRemoteType === "unknown") {
    reasons.push("no_geo_no_remote");
  }
  if (!location && !hasExplicitRemote && locationRemoteType === "unknown") {
    reasons.push("detail_no_structured_location");
    if (!hasExplicitOnsite) reasons.push("detail_no_explicit_remote");
  }
  return Array.from(new Set(reasons));
}

function hrmDirectDetailFailureReason(detailStatus, detailFailure) {
  const status = Number(detailStatus || 0);
  if (status === 404 || status === 410) return "detail_404_or_410";
  if (status === 401 || status === 403 || status === 429) return "blocked_or_rate_limited";
  return cleanHrmDirectText(detailFailure);
}

function enrichHrmDirectPostingFromDetail(posting, detailHtml, detailStatus, detailFailure) {
  if (!detailHtml) {
    const failureReason = hrmDirectDetailFailureReason(detailStatus, detailFailure);
    const sourceEvidence = {
      ...(posting.source_evidence || {}),
      detail_url: posting.job_posting_url,
      detail_fetch_status: detailStatus || "",
      detail_failure_reason: failureReason
    };
    return {
      ...posting,
      source_evidence: sourceEvidence,
      source_failure_reasons: Array.from(new Set([
        ...hrmDirectSourceFailureReasons(posting),
        failureReason
      ].filter(Boolean)))
    };
  }
  const detailFields = extractHrmDirectDetailFields(detailHtml);
  const sourceEvidence = {
    ...(posting.source_evidence || {}),
    detail_url: posting.job_posting_url,
    detail_fetch_status: detailStatus || 200,
    location_source: detailFields.evidence.location_source || posting.source_evidence?.location_source || "",
    location_path: detailFields.evidence.location_path || posting.source_evidence?.location_path || "",
    location_rule_name: detailFields.evidence.location_rule_name || posting.source_evidence?.location_rule_name || "",
    department_source: detailFields.evidence.department_source || posting.source_evidence?.department_source || "",
    department_path: detailFields.evidence.department_path || posting.source_evidence?.department_path || "",
    employment_type_source: detailFields.evidence.employment_type_source || posting.source_evidence?.employment_type_source || "",
    employment_type_path: detailFields.evidence.employment_type_path || posting.source_evidence?.employment_type_path || "",
    posting_date_source: posting.source_evidence?.posting_date_source || detailFields.evidence.posting_date_source || "",
    posting_date_path: posting.source_evidence?.posting_date_path || detailFields.evidence.posting_date_path || "",
    posting_date_rule_name: posting.source_evidence?.posting_date_rule_name || detailFields.evidence.posting_date_rule_name || "",
    remote_source: posting.source_evidence?.remote_source || detailFields.evidence.remote_source || "",
    remote_path: posting.source_evidence?.remote_path || detailFields.evidence.remote_path || "",
    remote_rule_name: posting.source_evidence?.remote_rule_name || detailFields.evidence.remote_rule_name || ""
  };
  const enriched = {
    ...posting,
    location: detailFields.location || posting.location || null,
    department: posting.department || detailFields.department || null,
    employment_type: posting.employment_type || detailFields.employment_type || null,
    posting_date: posting.posting_date || detailFields.posting_date || null,
    country: detailFields.country || posting.country || null,
    remote_type: posting.remote_type && posting.remote_type !== "unknown" ? posting.remote_type : detailFields.remote_type || posting.remote_type,
    source_evidence: sourceEvidence
  };
  return {
    ...enriched,
    source_failure_reasons: hrmDirectSourceFailureReasons(enriched)
  };
}

function parseHrmDirectPostingsFromHtml(companyNameForPostings, config, pageHtml) {
  const payload = pageHtml && typeof pageHtml === "object" && !Array.isArray(pageHtml) ? pageHtml : { html: pageHtml };
  const source = String(payload.html || payload.text || "");
  const listUrl = String(payload.__listUrl || config.list_url || config.jobsUrl || config.baseOrigin || "").trim();
  const detailHtmlByUrl = payload.__detailHtmlByUrl || payload.detailHtmlByUrl || {};
  const detailStatusByUrl = payload.__detailStatusByUrl || payload.detailStatusByUrl || {};
  const detailFailureByUrl = payload.__detailFailureByUrl || payload.detailFailureByUrl || {};
  const rssPostingDateByReq = {
    ...extractHrmDirectRssPostingDateByReq(payload.__rssXml || payload.rssXml || ""),
    ...(payload.__rssPostingDateByReq || payload.rssPostingDateByReq || {})
  };
  const postings = [];
  const seenUrls = new Set();
  const rowCandidates = [];
  const sourceJobIdCounts = new Map();
  const rowPattern =
    /<tr[^>]*class=["'][^"']*\breqitem1?\b[^"']*["'][^>]*>([\s\S]*?)<\/tr>/gi;

  let rowMatch = rowPattern.exec(source);
  while (rowMatch) {
    const rowHtml = String(rowMatch[1] || "");
    const titleCell = extractHrmDirectCellValue(rowHtml, "posTitle");
    const titleLinkMatch = titleCell.match(/<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)(?:<\/a>|$)/i);
    const href = normalizeHrmDirectHref(titleLinkMatch?.[1] || "");
    const titleText = cleanHrmDirectText(titleLinkMatch?.[2] || titleCell || "");
    if (isHrmDirectPlaceholderTitle(titleText)) {
      rowMatch = rowPattern.exec(source);
      continue;
    }
    if (!href) {
      rowMatch = rowPattern.exec(source);
      continue;
    }

    let absoluteUrl = "";
    try {
      absoluteUrl = normalizeHrmDirectJobPostingUrl(new URL(href, `${config.baseOrigin}/employment/`).toString());
    } catch {
      rowMatch = rowPattern.exec(source);
      continue;
    }
    const parsedAbsoluteUrl = parseUrl(absoluteUrl);
    if (!parsedAbsoluteUrl?.hostname?.endsWith(".hrmdirect.com")) {
      rowMatch = rowPattern.exec(source);
      continue;
    }
    if (!absoluteUrl || seenUrls.has(absoluteUrl)) {
      rowMatch = rowPattern.exec(source);
      continue;
    }

    const baseSourceJobId = extractSourceIdFromPostingUrl(absoluteUrl, "hrmdirect");
    const reqLoc = extractHrmDirectReqLocFromPostingUrl(absoluteUrl);
    rowCandidates.push({
      rowHtml,
      titleCell,
      titleLinkText: titleLinkMatch?.[2] || "",
      absoluteUrl,
      baseSourceJobId,
      reqLoc
    });
    if (baseSourceJobId) {
      sourceJobIdCounts.set(baseSourceJobId, (sourceJobIdCounts.get(baseSourceJobId) || 0) + 1);
    }
    seenUrls.add(absoluteUrl);
    rowMatch = rowPattern.exec(source);
  }

  const groupedAnchorPattern =
    /<a[^>]*href=["']([^"']*job-opening\.php\?[^"']*\breq=[^"']*)["'][^>]*>([\s\S]*?)(?:<\/a>|$)/gi;
  let groupedAnchorMatch = groupedAnchorPattern.exec(source);
  while (groupedAnchorMatch) {
    const href = normalizeHrmDirectHref(groupedAnchorMatch?.[1] || "");
    const titleText = cleanHrmDirectText(groupedAnchorMatch?.[2] || "");
    if (isHrmDirectPlaceholderTitle(titleText)) {
      groupedAnchorMatch = groupedAnchorPattern.exec(source);
      continue;
    }
    let absoluteUrl = "";
    try {
      absoluteUrl = normalizeHrmDirectJobPostingUrl(new URL(href, `${config.baseOrigin}/employment/`).toString());
    } catch {
      groupedAnchorMatch = groupedAnchorPattern.exec(source);
      continue;
    }
    const parsedAbsoluteUrl = parseUrl(absoluteUrl);
    if (!parsedAbsoluteUrl?.hostname?.endsWith(".hrmdirect.com")) {
      groupedAnchorMatch = groupedAnchorPattern.exec(source);
      continue;
    }
    if (!absoluteUrl || seenUrls.has(absoluteUrl)) {
      groupedAnchorMatch = groupedAnchorPattern.exec(source);
      continue;
    }

    const baseSourceJobId = extractSourceIdFromPostingUrl(absoluteUrl, "hrmdirect");
    const reqLoc = extractHrmDirectReqLocFromPostingUrl(absoluteUrl);
    rowCandidates.push({
      rowHtml: "",
      titleCell: "",
      titleLinkText: groupedAnchorMatch?.[2] || "",
      absoluteUrl,
      baseSourceJobId,
      reqLoc,
      layout: "grouped_div",
      listLocation: extractHrmDirectGroupedDivLocationAfter(source, groupedAnchorMatch.index + groupedAnchorMatch[0].length),
      department: extractLatestHrmDirectDepartmentBefore(source, groupedAnchorMatch.index)
    });
    if (baseSourceJobId) {
      sourceJobIdCounts.set(baseSourceJobId, (sourceJobIdCounts.get(baseSourceJobId) || 0) + 1);
    }
    seenUrls.add(absoluteUrl);
    groupedAnchorMatch = groupedAnchorPattern.exec(source);
  }

  const duplicateReqIds = new Set(
    Array.from(sourceJobIdCounts.entries())
      .filter(([, count]) => count > 1)
      .map(([sourceJobId]) => sourceJobId)
  );

  for (const candidate of rowCandidates) {
    const { rowHtml, titleCell, titleLinkText, absoluteUrl, baseSourceJobId, reqLoc } = candidate;
    const title = cleanHrmDirectText(titleLinkText || titleCell || "");
    if (isHrmDirectPlaceholderTitle(title)) continue;
    const sourceJobId = buildHrmDirectSourceJobId(baseSourceJobId, reqLoc, duplicateReqIds);
    const sourceJobIdPath = sourceJobId && sourceJobId !== baseSourceJobId
      ? "req + req_loc query params"
      : "req query param";
    const isGroupedDivLayout = candidate.layout === "grouped_div";
    const groupedLocation = isGroupedDivLayout ? cleanHrmDirectLocationText(candidate.listLocation) : "";
    const groupedRemoteLocation = isGroupedDivLayout ? extractHrmDirectListRemoteLocation(groupedLocation) : { location: "", remoteType: "unknown" };
    const cityCell = isGroupedDivLayout ? "" : cleanHrmDirectLocationText(extractHrmDirectCellValue(rowHtml, "cities"));
    const state = isGroupedDivLayout ? "" : cleanHrmDirectLocationText(extractHrmDirectCellValue(rowHtml, "state"));
    const department = cleanHrmDirectText(isGroupedDivLayout ? candidate.department : extractHrmDirectCellValue(rowHtml, "departments"));
    const workMode = cleanHrmDirectText(extractHrmDirectCellValue(rowHtml, "custSort1"));
    const workModeLocation = extractHrmDirectWorkModeLocationText(workMode);
    const listRemoteLocation = extractHrmDirectListRemoteLocation(cityCell);
    const city = listRemoteLocation.remoteType === "unknown" ? cityCell : "";
    const listState = listRemoteLocation.remoteType === "unknown" ? state : "";
    const listStateOnlyAbbreviation = !city && HRMDIRECT_US_STATE_ABBREVIATION_EXACT_PATTERN.test(listState);
    const listOfficeLocation = toHrmDirectListOfficeLocation(extractHrmDirectOfficeLocation(
      isGroupedDivLayout ? "" : extractHrmDirectCellValue(rowHtml, "offices")
    ));
    const workModeRemoteType = normalizeRemoteType(workMode);
    const listOfficeRemoteType = listOfficeLocation.remoteType && listOfficeLocation.remoteType !== "unknown" ? listOfficeLocation.remoteType : "unknown";
    const remoteType = workModeRemoteType !== "unknown"
      ? workModeRemoteType
      : listRemoteLocation.remoteType !== "unknown"
        ? listRemoteLocation.remoteType
        : groupedRemoteLocation.remoteType !== "unknown"
          ? groupedRemoteLocation.remoteType
          : listOfficeRemoteType;
    const listPostingDate =
      cleanHrmDirectText(extractHrmDirectCellValue(rowHtml, "date")) ||
      cleanHrmDirectText(extractHrmDirectCellValue(rowHtml, "dates")) ||
      "";
    const rssPostingDate = cleanHrmDirectText(rssPostingDateByReq[baseSourceJobId] || "");
    const postingDate = listPostingDate || rssPostingDate || null;
    const employmentType =
      cleanHrmDirectText(extractHrmDirectCellValue(rowHtml, "jobtype")) ||
      cleanHrmDirectText(extractHrmDirectCellValue(rowHtml, "jobType")) ||
      cleanHrmDirectText(extractHrmDirectCellValue(rowHtml, "employmentType")) ||
      cleanHrmDirectText(extractHrmDirectCellValue(rowHtml, "type")) ||
      null;
    const listLocation = [city, listState].filter(Boolean).join(", ");
    const location = listLocation || listRemoteLocation.location || groupedRemoteLocation.location || workModeLocation || listOfficeLocation.location;
    const puertoRicoNumericRegionCountry = listLocation
      ? normalizeHrmDirectPuertoRicoNumericRegionCountry(city, listState)
      : "";
    const country = listStateOnlyAbbreviation
      ? "United States"
      : listOfficeLocation.country || puertoRicoNumericRegionCountry || normalizeCountryFromLocation(location) || normalizeCountryName(state);
    const usesListOfficeLocation = Boolean(
      listOfficeLocation.location &&
      !listLocation &&
      !listRemoteLocation.location &&
      !groupedRemoteLocation.location &&
      !workModeLocation
    );
    const locationPath = location
      ? listLocation
        ? (listStateOnlyAbbreviation ? "td.state" : "td.cities + td.state")
        : listRemoteLocation.location
          ? "td.cities"
          : groupedRemoteLocation.location
            ? "div.reqResult location"
            : workModeLocation
              ? "td.custSort1"
              : listOfficeLocation.location
                ? "td.offices"
                : ""
      : "";
    const locationRuleName = listRemoteLocation.location
      ? "hrmdirect_list_remote_city_location"
      : groupedRemoteLocation.location
        ? "hrmdirect_grouped_list_remote_location"
        : listStateOnlyAbbreviation
          ? "hrmdirect_list_state_abbreviation"
          : puertoRicoNumericRegionCountry
            ? "hrmdirect_list_puerto_rico_numeric_region"
            : usesListOfficeLocation
              ? listOfficeLocation.ruleName
              : "";
    const remotePath = remoteType !== "unknown"
      ? workModeRemoteType !== "unknown"
        ? "td.custSort1"
        : listRemoteLocation.remoteType !== "unknown"
          ? "td.cities"
          : groupedRemoteLocation.remoteType !== "unknown"
            ? "div.reqResult location"
            : listOfficeRemoteType !== "unknown"
              ? "td.offices"
              : ""
      : "";
    const remoteRuleName = remoteType !== "unknown"
      ? workModeRemoteType !== "unknown"
        ? "hrmdirect_work_mode_column"
        : listRemoteLocation.remoteType !== "unknown"
          ? "hrmdirect_list_remote_city"
          : groupedRemoteLocation.remoteType !== "unknown"
            ? "hrmdirect_grouped_list_remote"
            : listOfficeLocation.remoteRuleName || ""
      : "";

    const basePosting = {
      company_name: companyNameForPostings,
      source_job_id: sourceJobId,
      position_name: title,
      job_posting_url: absoluteUrl,
      posting_date: postingDate,
      location: location || null,
      city: isRemoteOnlyLocationValue(city) ? null : city || null,
      country: country || null,
      remote_type: remoteType,
      department: department || null,
      employment_type: employmentType,
      source_requires_normalized_geo_or_remote: true,
      source_evidence: {
        list_url: listUrl,
        route_kind: "hrmdirect_job_openings_table",
        title_source: "labeled_html",
        title_path: "td.posTitle a",
        canonical_url_source: "url",
        canonical_url_path: "td.posTitle a[href]",
        source_job_id_source: "url",
        source_job_id_path: sourceJobIdPath,
        location_source: location ? "labeled_html" : "",
        location_path: locationPath,
        location_rule_name: locationRuleName,
        remote_source: remoteType !== "unknown" ? "labeled_html" : "",
        remote_path: remotePath,
        remote_rule_name: remoteRuleName,
        posting_date_source: listPostingDate ? "labeled_html" : rssPostingDate ? "rss_xml" : "",
        posting_date_path: listPostingDate ? "td.date/td.dates" : rssPostingDate ? "rss.channel.item pubDate" : "",
        posting_date_rule_name: rssPostingDate && !listPostingDate ? "hrmdirect_rss_pubdate" : ""
      }
    };
    postings.push(enrichHrmDirectPostingFromDetail(
      basePosting,
      lookupHrmDirectDetailHtml(detailHtmlByUrl, absoluteUrl),
      detailStatusByUrl[absoluteUrl] || detailStatusByUrl[canonicalHrmDirectDetailKey(absoluteUrl)],
      lookupHrmDirectDetailMapValue(detailFailureByUrl, absoluteUrl)
    ));
  }

  return postings;
}

module.exports = {
  extractHrmDirectDetailFields,
  parseHrmDirectPostingsFromHtml
};
