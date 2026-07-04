"use strict";

const { decodeHtmlEntities } = require("../../parsers/shared/html");
const { isRemoteOnlyLocationValue } = require("../../parsers/shared/location");
const { normalizeCountryFromLocation, normalizeCountryName } = require("../../posting");
const { guardPostingDateAgainstFuture } = require("../sourceModuleHelpers");

function parseUrl(urlString) {
  try {
    return new URL(String(urlString || ""));
  } catch {
    return null;
  }
}

function extractZohoHiddenInputValue(pageHtml, inputId) {
  const source = String(pageHtml || "");
  const tagMatch = source.match(
    new RegExp(`<input[^>]*\\bid=["']${String(inputId || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["'][^>]*>`, "is")
  );
  if (!tagMatch?.[0]) return "";

  const valueMatch = tagMatch[0].match(/\bvalue=(["'])([\s\S]*?)\1/i);
  return String(valueMatch?.[2] || "").trim();
}

function cleanZohoText(value) {
  return decodeHtmlEntities(String(value || "").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function isZohoRemoteJob(job) {
  if (job?.Remote_Job === true) return true;
  return cleanZohoText(job?.Remote_Job).toLowerCase() === "true";
}

function extractZohoListUrl(pageHtml, fallbackUrl) {
  const fallbackParsed = parseUrl(fallbackUrl);
  const fallbackHost = fallbackParsed?.hostname || "";
  const isAllowedZohoListUrl = (candidate) => {
    const parsed = parseUrl(candidate);
    if (!parsed?.protocol || !parsed?.host) return false;
    if (!parsed.hostname.endsWith(".zohorecruit.com")) return false;
    return !fallbackHost || parsed.hostname === fallbackHost;
  };
  const metaPayload = extractZohoHiddenInputValue(pageHtml, "meta");
  if (metaPayload) {
    try {
      const metaData = JSON.parse(decodeHtmlEntities(metaPayload));
      const listUrl = String(metaData?.list_url || "").trim();
      if (listUrl && isAllowedZohoListUrl(listUrl)) return listUrl;
    } catch {
      // Continue to fallback extraction paths.
    }
  }

  const ogMatch = String(pageHtml || "").match(
    /<meta[^>]*property=["']og:url["'][^>]*content=["']([^"']+)["']/i
  );
  const ogUrl = String(ogMatch?.[1] || "").trim();
  if (ogUrl) {
    const decodedOgUrl = decodeHtmlEntities(ogUrl);
    if (isAllowedZohoListUrl(decodedOgUrl)) return decodedOgUrl;
  }

  if (fallbackParsed?.protocol && fallbackParsed?.host) {
    return `${fallbackParsed.protocol}//${fallbackParsed.host}/jobs/Careers`;
  }
  return String(fallbackUrl || "").trim();
}

function buildZohoJobUrl(listUrl, jobId) {
  const parsed = parseUrl(listUrl);
  if (!parsed?.protocol || !parsed?.host) return String(listUrl || "").trim();

  let normalizedPath = String(parsed.pathname || "").replace(/\/+$/, "");
  if (!normalizedPath) normalizedPath = "/jobs/Careers";
  if (!normalizedPath.toLowerCase().includes("/jobs/careers")) {
    normalizedPath = "/jobs/Careers";
  }

  return `${parsed.protocol}//${parsed.host}${normalizedPath}/${encodeURIComponent(String(jobId || "").trim())}`;
}

function parseZohoPostingsFromHtml(companyNameForPostings, config, pageHtml) {
  const rawJobsPayload = extractZohoHiddenInputValue(pageHtml, "jobs");
  if (!rawJobsPayload) return [];

  let jobs = [];
  try {
    const parsed = JSON.parse(decodeHtmlEntities(rawJobsPayload));
    if (Array.isArray(parsed)) {
      jobs = parsed;
    }
  } catch {
    return [];
  }

  const listUrl = extractZohoListUrl(pageHtml, config?.careersUrl || config?.origin || "");
  const nowEpoch = config?.__nowEpoch;
  const postings = [];
  const seenIds = new Set();

  for (const job of jobs) {
    if (!job || typeof job !== "object") continue;
    if (job?.Publish === false) continue;

    const jobId = String(job?.id || "").trim();
    if (!jobId || seenIds.has(jobId)) continue;

    const title = cleanZohoText(job?.Posting_Title) || cleanZohoText(job?.Job_Opening_Name) || "Untitled Position";
    const city = cleanZohoText(job?.City);
    const state = cleanZohoText(job?.State);
    const country = cleanZohoText(job?.Country);
    const location = [city, state, country].filter(Boolean).join(", ") || null;
    // Date_Opened is the posted date, but Zoho also uses it for scheduled future
    // openings; the guard drops values that resolve past now + 24h.
    const postingDate = guardPostingDateAgainstFuture(cleanZohoText(job?.Date_Opened) || null, nowEpoch);
    const remoteJob = isZohoRemoteJob(job);

    postings.push({
      company_name: companyNameForPostings,
      source_job_id: jobId,
      id: jobId,
      position_name: title,
      job_posting_url: buildZohoJobUrl(listUrl, jobId),
      posting_date: postingDate || null,
      location,
      city: isRemoteOnlyLocationValue(city) ? null : city || null,
      state: state || null,
      country: normalizeCountryName(country) || normalizeCountryFromLocation(country) || null,
      remote_type: remoteJob ? "remote" : null,
      is_remote: remoteJob || null,
      workplaceType: remoteJob ? "Remote" : null,
      department: cleanZohoText(job?.Industry) || null,
      source_evidence: {
        list_url: listUrl,
        source_url: listUrl,
        title_source: "embedded_json",
        title_path: job?.Posting_Title ? "jobs[].Posting_Title" : "jobs[].Job_Opening_Name",
        canonical_url_source: "url",
        canonical_url_path: "jobs[].id",
        source_job_id_source: "embedded_json",
        source_job_id_path: "jobs[].id",
        location_source: location ? "embedded_json" : "",
        location_path: location ? "jobs[].City/State/Country" : "",
        country_path: country ? "jobs[].Country" : "",
        city_path: city ? "jobs[].City" : "",
        remote_source: remoteJob ? "embedded_json" : "",
        remote_path: remoteJob ? "jobs[].Remote_Job" : "",
        remote_rule_name: remoteJob ? "zoho_remote_job_flag" : "",
        posting_date_source: postingDate ? "embedded_json" : "",
        posting_date_path: postingDate ? "jobs[].Date_Opened" : ""
      }
    });
    seenIds.add(jobId);
  }

  return postings;
}

module.exports = {
  parseZohoPostingsFromHtml
};
