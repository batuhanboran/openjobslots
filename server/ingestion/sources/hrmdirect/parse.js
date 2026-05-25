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

function extractHrmDirectOfficeLocation(value) {
  const text = cleanHrmDirectLocationText(value);
  if (!text || isRemoteOnlyLocationValue(text)) return { location: "", ruleName: "" };
  if (HRMDIRECT_US_STATE_NAMES.has(text.toLowerCase())) {
    return { location: text, ruleName: "hrmdirect_detail_office_state" };
  }
  const compactText = text.replace(/[^A-Za-z0-9]+/g, "");
  const country = compactText.length > 2 ? normalizeCountryName(text) : "";
  if (country) {
    return { location: country, ruleName: "hrmdirect_detail_office_country" };
  }
  return { location: "", ruleName: "" };
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
    const sourceJobId = extractSourceIdFromPostingUrl(link, "hrmdirect");
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
  const primaryLocation = cleanHrmDirectLocationText(extractHrmDirectViewField(detailHtml, ["Location", "Job Location", "Work Location"]));
  const officeLocation = primaryLocation
    ? { location: "", ruleName: "" }
    : extractHrmDirectOfficeLocation(extractHrmDirectViewField(detailHtml, "Office"));
  const location = primaryLocation || officeLocation.location;
  const department = extractHrmDirectViewField(detailHtml, ["Department", "Team", "Category"]);
  const employmentType = extractHrmDirectViewField(detailHtml, ["Employment Type", "Job Type", "Type"]);
  const workplaceType = extractHrmDirectViewField(detailHtml, ["Workplace Type", "Work Type", "Work Arrangement", "Remote"]);
  const detailRemoteType = normalizeRemoteType(workplaceType);
  const remoteType = ["remote", "hybrid"].includes(detailRemoteType) ? detailRemoteType : "";
  const locationPath = primaryLocation ? "table.viewFields Location" : officeLocation.location ? "table.viewFields Office" : "";
  const locationRuleName = officeLocation.ruleName;
  return {
    location,
    department,
    employment_type: employmentType,
    remote_type: remoteType,
    evidence: {
      location_source: location ? "labeled_detail_html" : "",
      location_path: locationPath,
      location_rule_name: locationRuleName,
      department_source: department ? "labeled_detail_html" : "",
      department_path: department ? "table.viewFields Department" : "",
      employment_type_source: employmentType ? "labeled_detail_html" : "",
      employment_type_path: employmentType ? "table.viewFields Employment Type/Job Type" : "",
      remote_source: remoteType ? "labeled_detail_html" : "",
      remote_path: remoteType ? "table.viewFields Workplace Type" : "",
      remote_rule_name: remoteType ? "hrmdirect_detail_workplace_type" : ""
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

function enrichHrmDirectPostingFromDetail(posting, detailHtml, detailStatus) {
  if (!detailHtml) {
    return {
      ...posting,
      source_failure_reasons: hrmDirectSourceFailureReasons(posting)
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
    remote_source: posting.source_evidence?.remote_source || detailFields.evidence.remote_source || "",
    remote_path: posting.source_evidence?.remote_path || detailFields.evidence.remote_path || "",
    remote_rule_name: posting.source_evidence?.remote_rule_name || detailFields.evidence.remote_rule_name || ""
  };
  const enriched = {
    ...posting,
    location: detailFields.location || posting.location || null,
    department: posting.department || detailFields.department || null,
    employment_type: posting.employment_type || detailFields.employment_type || null,
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
    const city = cleanHrmDirectLocationText(extractHrmDirectCellValue(rowHtml, "cities"));
    const state = cleanHrmDirectLocationText(extractHrmDirectCellValue(rowHtml, "state"));
    const department = cleanHrmDirectText(extractHrmDirectCellValue(rowHtml, "departments"));
    const workMode = cleanHrmDirectText(extractHrmDirectCellValue(rowHtml, "custSort1"));
    const workModeLocation = extractHrmDirectWorkModeLocationText(workMode);
    const remoteType = normalizeRemoteType(workMode);
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
    const listLocation = [city, state].filter(Boolean).join(", ");
    const location = listLocation || workModeLocation;
    const country = normalizeCountryFromLocation(location) || normalizeCountryName(state);

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
        location_path: location ? (listLocation ? "td.cities + td.state" : "td.custSort1") : "",
        remote_source: remoteType !== "unknown" ? "labeled_html" : "",
        remote_path: remoteType !== "unknown" ? "td.custSort1" : "",
        remote_rule_name: remoteType !== "unknown" ? "hrmdirect_work_mode_column" : "",
        posting_date_source: listPostingDate ? "labeled_html" : rssPostingDate ? "rss_xml" : "",
        posting_date_path: listPostingDate ? "td.date/td.dates" : rssPostingDate ? "rss.channel.item pubDate" : "",
        posting_date_rule_name: rssPostingDate && !listPostingDate ? "hrmdirect_rss_pubdate" : ""
      }
    };
    postings.push(enrichHrmDirectPostingFromDetail(
      basePosting,
      lookupHrmDirectDetailHtml(detailHtmlByUrl, absoluteUrl),
      detailStatusByUrl[absoluteUrl] || detailStatusByUrl[canonicalHrmDirectDetailKey(absoluteUrl)]
    ));
  }

  return postings;
}

module.exports = {
  extractHrmDirectDetailFields,
  parseHrmDirectPostingsFromHtml
};
