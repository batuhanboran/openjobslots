"use strict";

const { decodeHtmlEntities } = require("../../parsers/shared/html");
const { normalizeCountryFromLocation } = require("../../posting");

function cleanTaleoText(value) {
  return decodeHtmlEntities(String(value || "").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .replace(/\s*,\s*/g, ", ")
    .trim();
}

function extractTaleoLocationLabel(value) {
  if (Array.isArray(value)) {
    const normalized = value.map((item) => extractTaleoLocationLabel(item)).filter(Boolean);
    return normalized.length > 0 ? normalized.join(" / ") : null;
  }
  if (value && typeof value === "object") {
    return extractTaleoLocationLabel(
      value.label ||
      value.name ||
      value.text ||
      value.value ||
      value.descriptor ||
      value.displayName ||
      ""
    );
  }
  const text = String(value || "").trim();
  if (!text) return null;

  if (text.startsWith("[") && text.endsWith("]")) {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) {
        const normalized = parsed.map((item) => String(item || "").trim()).filter(Boolean);
        if (normalized.length > 0) return normalized.join(" / ");
      }
    } catch {
      // Fall through to the raw string value.
    }
  }

  return cleanTaleoText(text);
}

function isBooleanLikeTaleoValue(value) {
  return /^(?:true|false)$/i.test(String(value || "").trim());
}

function isLikelyTaleoDateValue(value) {
  const text = String(value || "").trim();
  if (!text || isBooleanLikeTaleoValue(text)) return false;
  if (/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(text)) return true;
  if (/^\d{1,2}[-.](?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*[-.]\d{2,4}$/i.test(text)) return true;
  if (/^\d{1,2}[./]\d{1,2}[./]\d{4}$/.test(text)) return true;
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return true;
  if (/\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4}\b/i.test(text)) return true;
  if (/^(?:posted\s+)?(?:today|yesterday)$/i.test(text)) return true;
  if (/^(?:posted\s+)?\d+\s+(?:hour|day)s?\s+ago$/i.test(text)) return true;
  return false;
}

function isLikelyTaleoLocationValue(value) {
  const text = extractTaleoLocationLabel(value);
  if (!text || isBooleanLikeTaleoValue(text) || isLikelyTaleoDateValue(text)) return false;
  if (normalizeCountryFromLocation(text)) return true;
  if (/^(?:remote|hybrid|onsite|on-site|work from home|telework|virtual)$/i.test(text)) return true;
  if (/^(?:remote|hybrid|onsite|on-site|work from home|telework|virtual)\s*[-,]\s+\S+/i.test(text)) return true;
  if (/\S+\s*[-,]\s*(?:remote|hybrid|onsite|on-site|work from home|telework|virtual)$/i.test(text)) return true;
  if (/\b[A-Z][A-Za-z .'-]+,\s*(?:AL|AK|AZ|AR|CA|CO|CT|DC|DE|FL|GA|HI|IA|ID|IL|IN|KS|KY|LA|MA|MD|ME|MI|MN|MO|MS|MT|NC|ND|NE|NH|NJ|NM|NV|NY|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VA|VT|WA|WI|WV|WY)\b/.test(text)) return true;
  return false;
}

function pickTaleoDate(columns) {
  for (const value of columns) {
    const text = String(value || "").trim();
    if (isLikelyTaleoDateValue(text)) return text;
  }
  return null;
}

function pickTaleoLocation(columns, title = "") {
  const normalizedTitle = String(title || "").trim().toLowerCase();
  for (const value of columns) {
    const location = extractTaleoLocationLabel(value);
    if (!location || location.toLowerCase() === normalizedTitle) continue;
    if (isLikelyTaleoLocationValue(location)) return location;
  }
  return null;
}

function normalizeTaleoWorkMode(value) {
  const text = cleanTaleoText(value).toLowerCase();
  if (!text) return "";
  if (/\bhybrid\b/.test(text)) return "hybrid";
  if (/\b(remote|fully remote|work from home|wfh|virtual|telework|telecommute)\b/.test(text)) return "remote";
  if (/^(?:on[- ]?site|onsite|in[- ]?person|office based|in office)$/i.test(text)) return "onsite";
  return "";
}

function pickTaleoWorkMode(columns, title = "", location = "") {
  const normalizedTitle = cleanTaleoText(title).toLowerCase();
  const normalizedLocation = cleanTaleoText(location).toLowerCase();
  for (const value of columns) {
    const text = cleanTaleoText(value);
    const normalized = text.toLowerCase();
    if (!text || normalized === normalizedTitle || normalized === normalizedLocation) continue;
    const mode = normalizeTaleoWorkMode(text);
    if (mode) return mode;
  }
  return "";
}

function pickTaleoTitle(requisition, columns) {
  const direct = String(
    requisition?.title ||
    requisition?.jobTitle ||
    requisition?.requisitionTitle ||
    requisition?.jobName ||
    requisition?.name ||
    ""
  ).trim();
  if (direct) return direct;

  for (const value of columns) {
    const text = cleanTaleoText(value);
    if (!text || isBooleanLikeTaleoValue(text) || isLikelyTaleoDateValue(text) || isLikelyTaleoLocationValue(text)) continue;
    if (/^(?:full[- ]?time|part[- ]?time|regular|temporary|contract|internship)$/i.test(text)) continue;
    return text;
  }
  return "";
}

function extractTaleoPostingsFromRest(companyNameForPostings, config, requisitions) {
  const items = Array.isArray(requisitions) ? requisitions : [];
  const postings = [];

  for (const requisition of items) {
    const jobId = String(requisition?.jobId || requisition?.contestNo || "").trim();
    if (!jobId) continue;

    const columns = Array.isArray(requisition?.column) ? requisition.column : [];
    const title = pickTaleoTitle(requisition, columns) || "Untitled Position";
    const location = pickTaleoLocation(columns, title);
    const remoteType = pickTaleoWorkMode(columns, title, location);
    const postingDate = pickTaleoDate(columns);
    const contestNo = String(requisition?.contestNo || "").trim();
    const detailRef = contestNo || jobId;
    const jobUrl = detailRef
      ? `${config.baseSectionUrl}/jobdetail.ftl?job=${encodeURIComponent(detailRef)}&lang=${encodeURIComponent(
          config.lang
        )}`
      : `${config.baseSectionUrl}/jobsearch.ftl?lang=${encodeURIComponent(config.lang)}`;

    postings.push({
      company_name: companyNameForPostings,
      source_job_id: detailRef,
      position_name: title,
      job_posting_url: jobUrl,
      posting_date: postingDate,
      remote_type: remoteType || null,
      location
    });
  }

  return postings;
}

function extractTaleoPostingsFromAjax(companyNameForPostings, config, ajaxText) {
  const source = String(ajaxText || "");
  if (!source.includes("!|!")) return [];

  const tokens = source.split("!|!");
  const applyPrefix = "Apply for this position (";
  const postings = [];
  const seenKeys = new Set();

  for (let index = 0; index < tokens.length; index += 1) {
    const tokenText = String(tokens[index] || "").trim();
    if (!tokenText.startsWith(applyPrefix)) continue;

    let titleFromApply = tokenText.slice(applyPrefix.length).trim();
    if (titleFromApply.endsWith(")")) {
      titleFromApply = titleFromApply.slice(0, -1).trim();
    }

    const postedDate = index >= 2 ? String(tokens[index - 2] || "").trim() : "";
    const locationRaw = index >= 8 ? String(tokens[index - 8] || "").trim() : "";
    const jobNumber = index >= 9 ? String(tokens[index - 9] || "").trim() : "";
    let jobId = index >= 14 ? String(tokens[index - 14] || "").trim() : "";
    const fallbackTitle = index >= 13 ? String(tokens[index - 13] || "").trim() : "";

    if (!/^\d+$/.test(jobId)) {
      for (let step = 1; step <= 20; step += 1) {
        const candidate = String(tokens[index - step] || "").trim();
        if (/^\d+$/.test(candidate)) {
          jobId = candidate;
          break;
        }
      }
    }

    const title = titleFromApply || fallbackTitle || "Untitled Position";
    const detailRef = jobNumber || jobId;
    const location = extractTaleoLocationLabel(locationRaw);
    const remoteType = normalizeTaleoWorkMode(location);
    const dedupeKey = `${detailRef}|${title}|${location || ""}`.toLowerCase();
    if (!detailRef || seenKeys.has(dedupeKey)) continue;

    seenKeys.add(dedupeKey);
    postings.push({
      company_name: companyNameForPostings,
      source_job_id: detailRef,
      position_name: title,
      job_posting_url: `${config.baseSectionUrl}/jobdetail.ftl?job=${encodeURIComponent(
        detailRef
      )}&lang=${encodeURIComponent(config.lang)}`,
      posting_date: isLikelyTaleoDateValue(postedDate) ? postedDate : null,
      remote_type: remoteType || null,
      location
    });
  }

  return postings;
}


module.exports = {
  extractTaleoPostingsFromAjax,
  extractTaleoPostingsFromRest
};
