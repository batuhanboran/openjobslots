"use strict";

const { decodeHtmlEntities } = require("../../parsers/shared/html");

const CALCAREERS_PUBLIC_ORIGIN = "https://www.calcareers.ca.gov";
const CALCAREERS_LIST_URL = "https://calcareers.ca.gov/CalHRPublic/Search/JobSearchResults.aspx";

function cleanCalcareersText(value) {
  return decodeHtmlEntities(String(value || "").replace(/<[^>]+>/g, " "))
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractCalcareersHiddenInputs(htmlSource) {
  const source = String(htmlSource || "");
  const hidden = {};
  const regex = /<input\b[^>]*>/gi;
  let match = regex.exec(source);
  while (match) {
    const tag = String(match[0] || "");
    const typeMatch = tag.match(/\btype=["']?([^"'\s>]+)["']?/i);
    if (String(typeMatch?.[1] || "").toLowerCase() !== "hidden") {
      match = regex.exec(source);
      continue;
    }
    const nameMatch = tag.match(/\bname=["']([^"']+)["']/i);
    if (!nameMatch?.[1]) {
      match = regex.exec(source);
      continue;
    }
    const valueMatch = tag.match(/\bvalue=["']([^"']*)["']/i);
    hidden[nameMatch[1]] = valueMatch?.[1] || "";
    match = regex.exec(source);
  }
  return hidden;
}

function extractCalcareersPagerTargets(htmlSource) {
  const source = decodeHtmlEntities(String(htmlSource || ""));
  const targets = [];
  const seen = new Set();
  const regex = /__doPostBack\(['"]([^'"]+btnPagerItem[^'"]*)['"],\s*['"][^'"]*['"]\)/gi;
  let match = regex.exec(source);
  while (match) {
    const target = String(match[1] || "").trim();
    if (target && !seen.has(target)) {
      seen.add(target);
      targets.push(target);
    }
    match = regex.exec(source);
  }
  return targets;
}

function fieldAfterLabel(block, label) {
  const escaped = String(label || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(
    `${escaped}:\\s*</div>\\s*<div[^>]*class=["'][^"']*job-details[^"']*["'][^>]*>([\\s\\S]*?)</div>`,
    "i"
  );
  const match = String(block || "").match(regex);
  return cleanCalcareersText(match?.[1] || "");
}

function extractFirstJobUrl(block, pageUrl = CALCAREERS_LIST_URL) {
  const hrefMatch = String(block || "").match(/\bhref=["']([^"']*JobPosting\.aspx\?[^"']*JobControlId=[^"']+)["']/i);
  const href = decodeHtmlEntities(hrefMatch?.[1] || "");
  if (!href) return "";
  try {
    return new URL(href, pageUrl || CALCAREERS_PUBLIC_ORIGIN).toString();
  } catch {
    return "";
  }
}

function sourceJobIdFromControl(jobControl, jobUrl) {
  const controlMatch = cleanCalcareersText(jobControl).match(/(?:JC[-\s]*)?(\d{3,})/i);
  if (controlMatch?.[1]) return controlMatch[1];
  try {
    const parsed = new URL(jobUrl);
    const urlId = parsed.searchParams.get("JobControlId") || "";
    const urlMatch = urlId.match(/(\d{3,})/);
    return urlMatch?.[1] || "";
  } catch {
    return "";
  }
}

function extractCalcareersCards(htmlSource) {
  const source = String(htmlSource || "");
  const sectionMatches = source.match(/<section\b[^>]*class=["'][^"']*job-search-result[^"']*["'][^>]*>[\s\S]*?<\/section>/gi);
  if (sectionMatches?.length) return sectionMatches;
  return source.split(/Working Title:\s*<\/div>/i).slice(1).map((chunk) => `Working Title:</div>${chunk}`);
}

function parseCalcareersPostingsFromHtml(htmlSource, pageUrl = CALCAREERS_LIST_URL) {
  const source = String(htmlSource || "");
  if (!source) return [];

  const postings = [];
  const seenUrls = new Set();
  for (const card of extractCalcareersCards(source)) {
    const positionName = fieldAfterLabel(card, "Working Title") || "Untitled Position";
    const companyName = fieldAfterLabel(card, "Department") || "Unknown Department";
    const jobControl = fieldAfterLabel(card, "Job Control");
    const location = fieldAfterLabel(card, "Location") || null;
    const postingDate = fieldAfterLabel(card, "Publish Date") || null;
    const jobPostingUrl = extractFirstJobUrl(card, pageUrl);
    const sourceJobId = sourceJobIdFromControl(jobControl, jobPostingUrl);
    if (!jobPostingUrl || seenUrls.has(jobPostingUrl)) continue;

    postings.push({
      company_name: companyName,
      position_name: positionName,
      job_posting_url: jobPostingUrl,
      source_job_id: sourceJobId,
      posting_date: postingDate,
      location,
      department: companyName,
      source_evidence: {
        list_url: pageUrl,
        source_id_path: jobControl ? "Job Control" : "JobControlId",
        location_path: "Location",
        posting_date_path: "Publish Date"
      }
    });
    seenUrls.add(jobPostingUrl);
  }

  return postings;
}

function buildCalcareersPostPayload(hiddenFields, eventTarget) {
  const payload = { ...(hiddenFields || {}) };
  payload.__EVENTTARGET = eventTarget;
  payload.__EVENTARGUMENT = "";
  payload["ctl00$cphMainContent$txtKeyword"] = "";
  payload["ctl00$cphMainContent$chkExactWordMatch"] = "on";
  payload["ctl00$cphMainContent$hdnInit"] = "true";
  payload["ctl00$ucUtilityHeader1$txtGoogleSiteSearch"] = payload["ctl00$ucUtilityHeader1$txtGoogleSiteSearch"] || "";
  payload["ctl00$hdnShowHeaderPadding"] = payload["ctl00$hdnShowHeaderPadding"] || "1";
  payload["ctl00$ucSessionTimeoutDialog$tmrCountdown"] = payload["ctl00$ucSessionTimeoutDialog$tmrCountdown"] || "1200";
  return payload;
}

module.exports = {
  buildCalcareersPostPayload,
  extractCalcareersHiddenInputs,
  extractCalcareersPagerTargets,
  parseCalcareersPostingsFromHtml
};
