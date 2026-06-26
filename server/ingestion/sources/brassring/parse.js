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

function normalizeBrassringWorkMode(value) {
  const normalized = cleanBrassringText(value).toLowerCase();
  if (!normalized) return "";
  if (/\bhybrid\b/.test(normalized)) return "hybrid";
  if (/\b(remote|work from home|wfh|virtual|telework|telecommute)\b/.test(normalized)) return "remote";
  if (/^(?:on[- ]?site|onsite|in[- ]?person|office based|in office)$/i.test(normalized)) return "onsite";
  return "";
}

function extractBrassringWorkMode(item) {
  const questionNames = [
    "workmode",
    "work_mode",
    "work mode",
    "work arrangement",
    "workarrangement",
    "workplace",
    "workplace type",
    "workplacetype"
  ];
  for (const name of questionNames) {
    const mode = normalizeBrassringWorkMode(extractBrassringQuestionValue(item, name));
    if (mode) return mode;
  }
  return "";
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

function extractLocationFromTitle(title) {
  if (typeof title !== "string") return null;
  const match =
    title.match(/\b([A-Z][A-Za-z .'-]+),\s*(AL|AK|AZ|AR|CA|CO|CT|DC|DE|FL|GA|HI|IA|ID|IL|IN|KS|KY|LA|MA|MD|ME|MI|MN|MO|MS|MT|NC|ND|NE|NH|NJ|NM|NV|NY|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VA|VT|WA|WI|WV|WY)\b/i) ||
    title.match(
      /\b([A-Z][A-Za-z .'-]+),\s*(Alabama|Alaska|Arizona|Arkansas|California|Colorado|Connecticut|Delaware|Florida|Georgia|Hawaii|Idaho|Illinois|Indiana|Iowa|Kansas|Kentucky|Louisiana|Maine|Maryland|Massachusetts|Michigan|Minnesota|Mississippi|Missouri|Montana|Nebraska|Nevada|New\s+Hampshire|New\s+Jersey|New\s+Mexico|New\s+York|North\s+Carolina|North\s+Dakota|Ohio|Oklahoma|Oregon|Pennsylvania|Rhode\s+Island|South\s+Carolina|South\s+Dakota|Tennessee|Texas|Utah|Vermont|Virginia|Washington|West\s+Virginia|Wisconsin|Wyoming)\b/i
    );

  if (match) {
    return `${match[1].trim()}, ${match[2].trim()}`;
  }
  return null;
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

    const positionName = extractBrassringQuestionValue(item, "jobtitle") || "Untitled Position";
    let location = extractBrassringLocation(item);
    if (!location || /^-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?$/.test(location) || location === "0.0,0.0") {
      const fromTitle = extractLocationFromTitle(positionName);
      if (fromTitle) {
        location = fromTitle;
      }
    }

    postings.push({
      company_name: companyNameForPostings,
      source_job_id: reqId || undefined,
      id: reqId || undefined,
      position_name: positionName,
      job_posting_url: jobUrl,
      posting_date: extractBrassringQuestionValue(item, "lastupdated") || null,
      location: location,
      remote_type: extractBrassringWorkMode(item) || null,
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
