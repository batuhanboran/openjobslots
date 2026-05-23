"use strict";

const { decodeHtmlEntities } = require("../../parsers/shared/html");
const { isRemoteOnlyLocationValue } = require("../../parsers/shared/location");
const { extractSourceIdFromPostingUrl } = require("../../parsers/shared/sourceIds");
const { normalizeCountryFromLocation, normalizeCountryName, normalizeRemoteType } = require("../../posting");

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
  return decodeHtmlEntities(String(value || "").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeHrmDirectHref(value) {
  return decodeHtmlEntities(String(value || ""))
    .replace(/&#job/gi, "")
    .replace(/#job/gi, "")
    .replace(/&{2,}/g, "&")
    .replace(/[&\s]+$/g, "")
    .trim();
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
  const location = extractHrmDirectViewField(detailHtml, ["Location", "Job Location", "Work Location"]);
  const department = extractHrmDirectViewField(detailHtml, ["Department", "Team", "Category"]);
  const employmentType = extractHrmDirectViewField(detailHtml, ["Employment Type", "Job Type", "Type"]);
  return {
    location,
    department,
    employment_type: employmentType,
    evidence: {
      location_source: location ? "labeled_detail_html" : "",
      location_path: location ? "table.viewFields Location" : "",
      department_source: department ? "labeled_detail_html" : "",
      department_path: department ? "table.viewFields Department" : "",
      employment_type_source: employmentType ? "labeled_detail_html" : "",
      employment_type_path: employmentType ? "table.viewFields Employment Type/Job Type" : ""
    }
  };
}

function hrmDirectSourceFailureReasons(posting) {
  const reasons = [];
  const location = cleanHrmDirectText(posting.location || posting.location_text);
  const remoteType = cleanHrmDirectText(posting.remote_type).toLowerCase();
  const locationRemoteType = normalizeRemoteType(location);
  if (!location && !["remote", "hybrid", "onsite"].includes(remoteType) && locationRemoteType === "unknown") {
    reasons.push("no_geo_no_remote");
  }
  if (!location && locationRemoteType === "unknown") {
    reasons.push("detail_no_structured_location", "detail_no_explicit_remote");
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
    department_source: detailFields.evidence.department_source || posting.source_evidence?.department_source || "",
    department_path: detailFields.evidence.department_path || posting.source_evidence?.department_path || "",
    employment_type_source: detailFields.evidence.employment_type_source || posting.source_evidence?.employment_type_source || "",
    employment_type_path: detailFields.evidence.employment_type_path || posting.source_evidence?.employment_type_path || ""
  };
  const enriched = {
    ...posting,
    location: detailFields.location || posting.location || null,
    department: posting.department || detailFields.department || null,
    employment_type: posting.employment_type || detailFields.employment_type || null,
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
  const postings = [];
  const seenUrls = new Set();
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
      absoluteUrl = new URL(href, `${config.baseOrigin}/employment/`).toString();
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

    const title = cleanHrmDirectText(titleLinkMatch?.[2] || titleCell || "");
    const city = cleanHrmDirectText(extractHrmDirectCellValue(rowHtml, "cities"));
    const state = cleanHrmDirectText(extractHrmDirectCellValue(rowHtml, "state"));
    const department = cleanHrmDirectText(extractHrmDirectCellValue(rowHtml, "departments"));
    const postingDate =
      cleanHrmDirectText(extractHrmDirectCellValue(rowHtml, "date")) ||
      cleanHrmDirectText(extractHrmDirectCellValue(rowHtml, "dates")) ||
      null;
    const employmentType =
      cleanHrmDirectText(extractHrmDirectCellValue(rowHtml, "jobtype")) ||
      cleanHrmDirectText(extractHrmDirectCellValue(rowHtml, "jobType")) ||
      cleanHrmDirectText(extractHrmDirectCellValue(rowHtml, "employmentType")) ||
      cleanHrmDirectText(extractHrmDirectCellValue(rowHtml, "type")) ||
      null;
    const location = [city, state].filter(Boolean).join(", ");
    const country = normalizeCountryName(state) || normalizeCountryFromLocation(location);

    const basePosting = {
      company_name: companyNameForPostings,
      source_job_id: extractSourceIdFromPostingUrl(absoluteUrl, "hrmdirect"),
      position_name: title,
      job_posting_url: absoluteUrl,
      posting_date: postingDate,
      location: location || null,
      city: isRemoteOnlyLocationValue(city) ? null : city || null,
      country: country || null,
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
        source_job_id_path: "req query param",
        location_source: location ? "labeled_html" : "",
        location_path: location ? "td.cities + td.state" : "",
        posting_date_source: postingDate ? "labeled_html" : "",
        posting_date_path: postingDate ? "td.date/td.dates" : ""
      }
    };
    postings.push(enrichHrmDirectPostingFromDetail(
      basePosting,
      lookupHrmDirectDetailHtml(detailHtmlByUrl, absoluteUrl),
      detailStatusByUrl[absoluteUrl] || detailStatusByUrl[canonicalHrmDirectDetailKey(absoluteUrl)]
    ));
    seenUrls.add(absoluteUrl);
    rowMatch = rowPattern.exec(source);
  }

  return postings;
}

module.exports = {
  parseHrmDirectPostingsFromHtml
};
