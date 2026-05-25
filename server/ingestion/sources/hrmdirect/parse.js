"use strict";

const { decodeHtmlEntities } = require("../../parsers/shared/html");
const { isRemoteOnlyLocationValue } = require("../../parsers/shared/location");
const { extractSourceIdFromPostingUrl } = require("../../parsers/shared/sourceIds");
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

const HRMDIRECT_US_STATE_ABBREVIATION_PATTERN =
  /\b(AL|AK|AZ|AR|CA|CO|CT|DC|DE|FL|GA|HI|IA|ID|IL|IN|KS|KY|LA|MA|MD|ME|MI|MN|MO|MS|MT|NC|ND|NE|NH|NJ|NM|NV|NY|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VA|VT|WA|WI|WV|WY)\b/i;
const HRMDIRECT_US_STATE_ABBREVIATION_EXACT_PATTERN =
  /^(AL|AK|AZ|AR|CA|CO|CT|DC|DE|FL|GA|HI|IA|ID|IL|IN|KS|KY|LA|MA|MD|ME|MI|MN|MO|MS|MT|NC|ND|NE|NH|NJ|NM|NV|NY|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VA|VT|WA|WI|WV|WY)$/i;
const HRMDIRECT_STREET_SUFFIX_PATTERN =
  /\b(?:ave(?:nue)?|blvd|boulevard|cir(?:cle)?|ct|court|dr(?:ive)?|hwy|highway|ln|lane|pkwy|parkway|pl|place|rd|road|st|street|way)\b/i;

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

function extractHrmDirectOfficeLocation(value) {
  const text = cleanHrmDirectLocationText(value);
  if (!text || isRemoteOnlyLocationValue(text)) return { location: "", ruleName: "" };
  if (HRMDIRECT_US_STATE_NAMES.has(text.toLowerCase())) {
    return { location: text, ruleName: "hrmdirect_detail_office_state" };
  }
  if (HRMDIRECT_CANADA_PROVINCE_NAMES.has(text.toLowerCase())) {
    return { location: text, ruleName: "hrmdirect_detail_office_province" };
  }
  const compactText = text.replace(/[^A-Za-z0-9]+/g, "");
  const country = compactText.length > 2 ? normalizeCountryName(text) : "";
  if (country) {
    return { location: country, ruleName: "hrmdirect_detail_office_country" };
  }
  return { location: "", ruleName: "" };
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
  const primaryLocationRemoteType = isRemoteOnlyLocationValue(primaryLocationValue)
    ? normalizeRemoteType(primaryLocationValue)
    : "unknown";
  const primaryLocation = primaryLocationRemoteType === "unknown" ? primaryLocationValue : "";
  const primaryLocationRuleName = hrmDirectDetailLocationRuleName(primaryLocation);
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
  const detailLocationRemoteType = ["remote", "hybrid"].includes(primaryLocationRemoteType) ? primaryLocationRemoteType : "";
  const detailRemoteTag = ["remote", "hybrid"].includes(detailRemoteType) || detailLocationRemoteType ? "" : extractHrmDirectDetailRemoteTag(detailHtml);
  const detailBodyRemoteType = ["remote", "hybrid"].includes(detailRemoteType) || detailLocationRemoteType || detailRemoteTag
    ? ""
    : extractHrmDirectDetailBodyLocationRemoteType(detailHtml);
  const remoteType = ["remote", "hybrid"].includes(detailRemoteType) ? detailRemoteType : detailLocationRemoteType || detailRemoteTag || detailBodyRemoteType;
  const locationPath = primaryLocation
    ? "table.viewFields Location"
    : officeLocation.location
      ? "table.viewFields Office"
      : bodyAddressLocation
        ? "detail body Location"
        : "";
  const locationSource = bodyAddressLocation ? "labeled_detail_body" : location ? "labeled_detail_html" : "";
  const locationRuleName = primaryLocationRuleName || officeLocation.ruleName || (bodyAddressLocation ? "hrmdirect_detail_body_location_address" : "");
  const country = primaryLocationRuleName === "hrmdirect_detail_location_state_abbreviation" ? "United States" : "";
  const remoteSource = remoteType
    ? detailRemoteTag ? "structured_detail_tag" : detailBodyRemoteType ? "labeled_detail_body" : "labeled_detail_html"
    : "";
  const remotePath = remoteType
    ? detailRemoteTag ? "detail text #LI-Remote/#LI-Hybrid" : detailBodyRemoteType ? "detail body Location" : detailLocationRemoteType ? "table.viewFields Location" : "table.viewFields Workplace Type"
    : "";
  const remoteRuleName = remoteType
    ? detailRemoteTag ? "hrmdirect_detail_li_remote_tag" : detailBodyRemoteType ? "hrmdirect_detail_body_location_remote" : detailLocationRemoteType ? "hrmdirect_detail_location_remote" : "hrmdirect_detail_workplace_type"
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

  const duplicateReqIds = new Set(
    Array.from(sourceJobIdCounts.entries())
      .filter(([, count]) => count > 1)
      .map(([sourceJobId]) => sourceJobId)
  );

  for (const candidate of rowCandidates) {
    const { rowHtml, titleCell, titleLinkText, absoluteUrl, baseSourceJobId, reqLoc } = candidate;
    const title = cleanHrmDirectText(titleLinkText || titleCell || "");
    const sourceJobId = buildHrmDirectSourceJobId(baseSourceJobId, reqLoc, duplicateReqIds);
    const sourceJobIdPath = sourceJobId && sourceJobId !== baseSourceJobId
      ? "req + req_loc query params"
      : "req query param";
    const cityCell = cleanHrmDirectLocationText(extractHrmDirectCellValue(rowHtml, "cities"));
    const state = cleanHrmDirectLocationText(extractHrmDirectCellValue(rowHtml, "state"));
    const department = cleanHrmDirectText(extractHrmDirectCellValue(rowHtml, "departments"));
    const workMode = cleanHrmDirectText(extractHrmDirectCellValue(rowHtml, "custSort1"));
    const workModeLocation = extractHrmDirectWorkModeLocationText(workMode);
    const listRemoteLocation = extractHrmDirectListRemoteLocation(cityCell);
    const city = listRemoteLocation.remoteType === "unknown" ? cityCell : "";
    const listState = listRemoteLocation.remoteType === "unknown" ? state : "";
    const listStateOnlyAbbreviation = !city && HRMDIRECT_US_STATE_ABBREVIATION_EXACT_PATTERN.test(listState);
    const workModeRemoteType = normalizeRemoteType(workMode);
    const remoteType = workModeRemoteType !== "unknown" ? workModeRemoteType : listRemoteLocation.remoteType;
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
    const location = listLocation || listRemoteLocation.location || workModeLocation;
    const country = listStateOnlyAbbreviation ? "United States" : normalizeCountryFromLocation(location) || normalizeCountryName(state);

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
        location_path: location ? (listLocation ? (listStateOnlyAbbreviation ? "td.state" : "td.cities + td.state") : listRemoteLocation.location ? "td.cities" : "td.custSort1") : "",
        location_rule_name: listRemoteLocation.location ? "hrmdirect_list_remote_city_location" : listStateOnlyAbbreviation ? "hrmdirect_list_state_abbreviation" : "",
        remote_source: remoteType !== "unknown" ? "labeled_html" : "",
        remote_path: remoteType !== "unknown" ? (workModeRemoteType !== "unknown" ? "td.custSort1" : "td.cities") : "",
        remote_rule_name: remoteType !== "unknown" ? (workModeRemoteType !== "unknown" ? "hrmdirect_work_mode_column" : "hrmdirect_list_remote_city") : "",
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
