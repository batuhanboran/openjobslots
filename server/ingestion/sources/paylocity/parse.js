"use strict";

const { decodeHtmlEntities } = require("../../parsers/shared/html");
const { normalizeCountryName, normalizeRemoteType } = require("../../posting");

function cleanPaylocityText(value) {
  return decodeHtmlEntities(String(value || ""))
    .replace(/\s+/g, " ")
    .trim();
}

function inferPaylocityRemoteType(job, locationText) {
  if (job?.IsRemote === true) {
    return {
      value: "remote",
      path: "Jobs[].IsRemote",
      ruleName: "paylocity_is_remote_true"
    };
  }

  const locationRemoteType = normalizeRemoteType(locationText);
  if (locationRemoteType === "remote" || locationRemoteType === "hybrid") {
    return {
      value: locationRemoteType,
      path: "Jobs[].JobLocation.Name",
      ruleName: "paylocity_location_remote_text"
    };
  }

  const titleRemoteType = normalizeRemoteType(job?.JobTitle || "");
  if (titleRemoteType === "remote" || titleRemoteType === "hybrid") {
    return {
      value: titleRemoteType,
      path: "Jobs[].JobTitle",
      ruleName: "paylocity_title_remote_text"
    };
  }

  if (job?.IsRemote === false) {
    return {
      value: "onsite",
      path: "Jobs[].IsRemote",
      ruleName: "paylocity_is_remote_false"
    };
  }

  return {
    value: "",
    path: "",
    ruleName: ""
  };
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
    if (!location) location = cleanPaylocityText(jobLocation?.Name || "");
    if (!location && isRemote) location = "Remote";
    if (!location && country) location = country;
    const remoteType = inferPaylocityRemoteType(job, location);
    const normalizedCountry = normalizeCountryName(country);

    postings.push({
      company_name: effectiveCompanyName,
      source_job_id: jobId,
      id: jobId,
      position_name: cleanPaylocityText(job?.JobTitle || "") || "Untitled Position",
      job_posting_url: `${String(config?.siteBaseUrl || "").replace(/\/+$/, "")}/Recruiting/Jobs/Details/${encodeURIComponent(jobId)}`,
      posting_date: cleanPaylocityText(job?.PublishedDate || "") || null,
      location: location || null,
      city: city || null,
      state: state || null,
      country: country || null,
      remote_type: remoteType.value || null,
      remote: remoteType.value === "remote",
      is_remote: remoteType.value === "remote" || remoteType.value === "hybrid",
      workplaceType: remoteType.value || null,
      department: cleanPaylocityText(job?.HiringDepartment || "") || null,
      employment_type: isRemote ? "Remote" : null,
      source_evidence: {
        ...(location
          ? {
              location_source: "list_api",
              location_path: "Jobs[].JobLocation",
              location_rule_name: "paylocity_job_location",
              location_raw: location
            }
          : {}),
        ...(normalizedCountry
          ? {
              country_source: "list_api",
              country_path: "Jobs[].JobLocation.Country",
              country_rule_name: "paylocity_job_location_country"
            }
          : {}),
        ...(city
          ? {
              city_source: "list_api",
              city_path: "Jobs[].JobLocation.City",
              city_rule_name: "paylocity_job_location_city"
            }
          : {}),
        ...(remoteType.value
          ? {
              remote_source: "list_api",
              remote_path: remoteType.path,
              remote_rule_name: remoteType.ruleName
            }
          : {})
      }
    });
    seenIds.add(normalizedJobId);
  }

  return postings;
}

module.exports = {
  extractPaylocityPageDataJson,
  parsePaylocityPostingsFromPageData
};
