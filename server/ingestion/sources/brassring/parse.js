"use strict";

const { decodeHtmlEntities } = require("../../parsers/shared/html");

function cleanBrassringText(value) {
  return decodeHtmlEntities(String(value || "").replace(/<[^>]+>/g, " "))
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractBrassringHiddenInput(pageHtml, fieldName) {
  const source = String(pageHtml || "");
  const match = source.match(
    new RegExp(`name=["']${String(fieldName || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["'][^>]*value=["']([^"']*)["']`, "i")
  );
  return cleanBrassringText(match?.[1] || "");
}

function extractBrassringCompanyName(pageHtml) {
  const source = decodeHtmlEntities(String(pageHtml || ""));
  const partnerNameMatch = source.match(/["']PartnerName["']\s*:\s*["']([^"']+)["']/i);
  if (partnerNameMatch?.[1]) return cleanBrassringText(partnerNameMatch[1]) || "Unknown Company";

  const titleMatch = source.match(/Search\s+Jobs\s+at\s*\|\s*([^<\r\n]+)/i);
  if (titleMatch?.[1]) return cleanBrassringText(titleMatch[1]) || "Unknown Company";

  return "Unknown Company";
}

function extractBrassringQuestionValue(item, questionName) {
  const questions = Array.isArray(item?.Questions) ? item.Questions : [];
  const normalizedQuestionName = String(questionName || "").trim().toLowerCase();
  for (const question of questions) {
    if (!question || typeof question !== "object") continue;
    const currentName = String(question?.QuestionName || "").trim().toLowerCase();
    if (currentName !== normalizedQuestionName) continue;
    return cleanBrassringText(question?.Value || "");
  }
  return "";
}

function extractBrassringLocation(item) {
  const directLocation = extractBrassringQuestionValue(item, "location");
  if (directLocation) return directLocation;

  const city = extractBrassringQuestionValue(item, "city");
  const state = extractBrassringQuestionValue(item, "state");
  const country = extractBrassringQuestionValue(item, "country");
  const combinedLocation = [city, state, country].filter(Boolean).join(", ");
  if (combinedLocation) return combinedLocation;

  const latitude = extractBrassringQuestionValue(item, "latitude");
  const longitude = extractBrassringQuestionValue(item, "longitude");
  if (latitude && longitude) return `${latitude},${longitude}`;
  return null;
}

function buildBrassringPostingUrl(config, item) {
  const itemUrl = cleanBrassringText(item?.Link || "");
  if (itemUrl) return itemUrl;

  const reqId = extractBrassringQuestionValue(item, "reqid");
  if (!reqId) return config.boardUrl;
  return (
    "https://sjobs.brassring.com/TGnewUI/Search/home/HomeWithPreLoad?" +
    `partnerid=${encodeURIComponent(config.partnerId)}&siteid=${encodeURIComponent(config.siteId)}` +
    `&PageType=JobDetails&jobid=${encodeURIComponent(reqId)}`
  );
}

function parseBrassringPostingsFromApi(companyNameForPostings, config, responseJson) {
  const jobs = Array.isArray(responseJson?.Jobs?.Job) ? responseJson.Jobs.Job : [];
  const postings = [];
  const seenUrls = new Set();
  const seenIds = new Set();

  for (const row of jobs) {
    const item = row && typeof row === "object" ? row : {};
    const reqId = extractBrassringQuestionValue(item, "reqid");
    if (reqId && seenIds.has(reqId)) continue;

    const jobUrl = buildBrassringPostingUrl(config, item);
    if (!jobUrl || seenUrls.has(jobUrl)) continue;

    postings.push({
      company_name: companyNameForPostings,
      source_job_id: reqId || undefined,
      id: reqId || undefined,
      position_name: extractBrassringQuestionValue(item, "jobtitle") || "Untitled Position",
      job_posting_url: jobUrl,
      posting_date: extractBrassringQuestionValue(item, "lastupdated") || null,
      location: extractBrassringLocation(item),
      department: extractBrassringQuestionValue(item, "department") || null
    });
    seenUrls.add(jobUrl);
    if (reqId) seenIds.add(reqId);
  }

  return postings;
}

module.exports = {
  extractBrassringCompanyName,
  extractBrassringHiddenInput,
  extractBrassringQuestionValue,
  parseBrassringPostingsFromApi
};
