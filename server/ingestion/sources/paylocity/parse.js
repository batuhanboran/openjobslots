"use strict";

const { decodeHtmlEntities } = require("../../parsers/shared/html");

function cleanPaylocityText(value) {
  return decodeHtmlEntities(String(value || ""))
    .replace(/\s+/g, " ")
    .trim();
}

function extractPaylocityPageDataJson(pageHtml) {
  const source = String(pageHtml || "");
  const marker = "window.pageData =";
  let startIndex = source.indexOf(marker);
  if (startIndex < 0) return {};

  startIndex = source.indexOf("{", startIndex);
  if (startIndex < 0) return {};

  let depth = 0;
  let inString = false;
  let escape = false;
  let stringChar = "";

  for (let index = startIndex; index < source.length; index += 1) {
    const char = source[index];

    if (inString) {
      if (escape) {
        escape = false;
      } else if (char === "\\") {
        escape = true;
      } else if (char === stringChar) {
        inString = false;
      }
      continue;
    }

    if (char === "'" || char === '"') {
      inString = true;
      stringChar = char;
      continue;
    }

    if (char === "{") {
      depth += 1;
      continue;
    }
    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(source.slice(startIndex, index + 1));
        } catch {
          return {};
        }
      }
    }
  }

  return {};
}

function parsePaylocityPostingsFromPageData(companyNameForPostings, config, pageData) {
  const jobs = Array.isArray(pageData?.Jobs) ? pageData.Jobs : [];
  const postings = [];
  const seenIds = new Set();
  const effectiveCompanyName =
    cleanPaylocityText(companyNameForPostings) || `paylocity_${String(config?.companyId || "").toLowerCase()}`;

  for (const job of jobs) {
    if (!job || typeof job !== "object") continue;

    const jobId = cleanPaylocityText(job?.JobId || "");
    const normalizedJobId = jobId.toLowerCase();
    if (!jobId || seenIds.has(normalizedJobId)) continue;

    const jobLocation = job?.JobLocation && typeof job.JobLocation === "object" ? job.JobLocation : {};
    const city = cleanPaylocityText(jobLocation?.City || "");
    const state = cleanPaylocityText(jobLocation?.State || "");
    const country = cleanPaylocityText(jobLocation?.Country || "");
    const isRemote = Boolean(job?.IsRemote);

    const locationParts = [city, state].filter(Boolean);
    let location = locationParts.join(", ");
    if (!location) location = cleanPaylocityText(job?.LocationName || "");
    if (!location && isRemote) location = "Remote";
    if (!location && country) location = country;

    postings.push({
      company_name: effectiveCompanyName,
      source_job_id: jobId,
      id: jobId,
      position_name: cleanPaylocityText(job?.JobTitle || "") || "Untitled Position",
      job_posting_url: `${String(config?.siteBaseUrl || "").replace(/\/+$/, "")}/Recruiting/Jobs/Details/${encodeURIComponent(jobId)}`,
      posting_date: cleanPaylocityText(job?.PublishedDate || "") || null,
      location: location || null,
      department: cleanPaylocityText(job?.HiringDepartment || "") || null,
      employment_type: isRemote ? "Remote" : null
    });
    seenIds.add(normalizedJobId);
  }

  return postings;
}

module.exports = {
  extractPaylocityPageDataJson,
  parsePaylocityPostingsFromPageData
};
