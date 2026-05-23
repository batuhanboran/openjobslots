"use strict";

const { decodeHtmlEntities } = require("../../parsers/shared/html");

function cleanCalcareersText(value) {
  return decodeHtmlEntities(String(value || "").replace(/<[^>]+>/g, " "))
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractCalcareersHiddenInputs(htmlSource) {
  const source = String(htmlSource || "");
  const hidden = {};
  const regex = /<input[^>]+type=["']hidden["'][^>]*>/gi;
  let match = regex.exec(source);
  while (match) {
    const tag = String(match[0] || "");
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
  const source = String(htmlSource || "");
  const targets = [];
  const seen = new Set();
  const regex = /__doPostBack\(&#39;([^']+btnPagerItem[^']*)&#39;,\s*&#39;[^']*&#39;\)/gi;
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

function parseCalcareersPostingsFromHtml(htmlSource) {
  const source = String(htmlSource || "");
  if (!source) return [];

  const postings = [];
  const seenUrls = new Set();
  const cardRegex = new RegExp(
    String.raw`Working Title:\s*</div>\s*<div class="col-xs-6 job-details">\s*<span[^>]*>(.*?)</span>` +
      String.raw`[\s\S]*?Job Control:\s*</div>\s*<div class="col-xs-6 job-details">\s*(\d+)\s*</div>` +
      String.raw`[\s\S]*?Department:\s*</div>\s*<div class="col-xs-6 job-details">\s*(.*?)\s*</div>` +
      String.raw`[\s\S]*?Location:\s*</div>\s*<div class="col-xs-6 job-details">\s*(.*?)\s*</div>` +
      String.raw`[\s\S]*?Publish Date:\s*</div>\s*<div class="col-xs-6 job-details">\s*<time[^>]*>\s*([^<]+)\s*</time>` +
      String.raw`[\s\S]*?href="(https:\/\/www\.calcareers\.ca\.gov\/CalHrPublic\/Jobs\/JobPosting\.aspx\?JobControlId=\d+)"`,
    "gi"
  );

  let match = cardRegex.exec(source);
  while (match) {
    const positionName = cleanCalcareersText(match[1]) || "Untitled Position";
    const companyName = cleanCalcareersText(match[3]) || "Unknown Department";
    const location = cleanCalcareersText(match[4]) || null;
    const postingDate = cleanCalcareersText(match[5]) || null;
    const jobPostingUrl = cleanCalcareersText(match[6]);
    if (!jobPostingUrl || seenUrls.has(jobPostingUrl)) {
      match = cardRegex.exec(source);
      continue;
    }
    postings.push({
      company_name: companyName,
      position_name: positionName,
      job_posting_url: jobPostingUrl,
      posting_date: postingDate,
      location
    });
    seenUrls.add(jobPostingUrl);
    match = cardRegex.exec(source);
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
