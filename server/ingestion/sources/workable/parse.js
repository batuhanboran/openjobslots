"use strict";

const { extractSourceIdFromPostingUrl } = require("../../parsers/shared/sourceIds");
const { normalizeCountryName, normalizeRemoteType } = require("../../posting");

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeWorkableCountry(value) {
  return normalizeCountryName(value) || normalizeCountryName(String(value || "").toUpperCase()) || "";
}

function buildWorkableJobUrl(config, job) {
  const item = job && typeof job === "object" ? job : {};
  for (const key of ["url", "job_url", "shortlink", "application_url"]) {
    const candidate = clean(item?.[key]);
    if (candidate) return candidate;
  }
  const shortcode = clean(item?.shortcode || item?.id);
  if (shortcode && config?.boardUrl) return `${String(config.boardUrl).replace(/\/+$/, "")}/jobs/${encodeURIComponent(shortcode)}`;
  return "";
}

function firstLocation(job) {
  const item = job && typeof job === "object" ? job : {};
  if (item.location && typeof item.location === "object") return item.location;
  const locations = Array.isArray(item.locations) ? item.locations : [];
  return locations[0] && typeof locations[0] === "object" ? locations[0] : {};
}

function hasOwn(object, key) {
  return Boolean(object && Object.prototype.hasOwnProperty.call(object, key));
}

function extractWorkableRemoteType(job, location, locationText) {
  const item = job && typeof job === "object" ? job : {};
  const sourceFields = [
    { value: location.workplace_type, path: "jobs[].location.workplace_type" },
    { value: location.workplaceType, path: "jobs[].location.workplaceType" },
    { value: item.workplace_type, path: "jobs[].workplace_type" },
    { value: item.workplaceType, path: "jobs[].workplaceType" },
    { value: item.remote, path: "jobs[].remote" }
  ];
  for (const field of sourceFields) {
    const remoteType = normalizeRemoteType(field.value);
    if (remoteType !== "unknown") return { remote_type: remoteType, path: field.path };
  }
  if (location.telecommuting === true || item.telecommuting === true) {
    return { remote_type: "remote", path: location.telecommuting === true ? "jobs[].location.telecommuting" : "jobs[].telecommuting" };
  }
  if (hasOwn(location, "telecommuting") && location.telecommuting === false) {
    return { remote_type: "onsite", path: "jobs[].location.telecommuting" };
  }
  if (hasOwn(item, "telecommuting") && item.telecommuting === false) {
    return { remote_type: "onsite", path: "jobs[].telecommuting" };
  }
  const locationRemoteType = normalizeRemoteType(locationText);
  if (locationRemoteType === "remote" || locationRemoteType === "hybrid") {
    return { remote_type: locationRemoteType, path: "jobs[].location.location_str" };
  }
  return { remote_type: "", path: "" };
}

function extractLocation(job) {
  const location = firstLocation(job);
  const city = clean(location.city || "");
  const region = clean(location.region || location.region_code || location.state || location.state_code || "");
  const country = normalizeWorkableCountry(location.country || location.country_name || location.country_code || "");
  const locationText = clean(location.location_str || [city, region, country].filter(Boolean).join(", "));
  const remote = extractWorkableRemoteType(job, location, locationText);
  return {
    location: locationText || null,
    city: city || null,
    state: region || null,
    country: country || null,
    remote_type: remote.remote_type,
    remote_path: remote.path
  };
}

function parseWorkablePostingsFromApi(companyNameForPostings, config, responseJson) {
  const jobs = Array.isArray(responseJson?.jobs) ? responseJson.jobs : [];
  const postings = [];
  const seenUrls = new Set();

  for (const job of jobs) {
    const item = job && typeof job === "object" ? job : {};
    const state = clean(item.state || "");
    if (state && state !== "published") continue;
    const title = clean(item.title || item.full_title || "");
    const jobUrl = buildWorkableJobUrl(config, item);
    if (!title || !jobUrl || seenUrls.has(jobUrl)) continue;

    const location = extractLocation(item);
    const remoteType = location.remote_type;
    const shortcode = clean(item.shortcode || item.id || extractSourceIdFromPostingUrl(jobUrl, "workable"));
    postings.push({
      source_job_id: shortcode,
      id: shortcode || undefined,
      company_name: companyNameForPostings,
      position_name: title,
      job_posting_url: jobUrl,
      apply_url: clean(item.application_url || item.shortlink || jobUrl),
      posting_date: clean(item.created_at || item.published_at || item.updated_at || "") || null,
      location: location.location,
      city: location.city,
      state: location.state,
      country: location.country,
      remote_type: remoteType && remoteType !== "unknown" ? remoteType : null,
      department: clean(item.department || item.department_hierarchy?.[0]?.name || "") || null,
      employment_type: clean(item.employment_type || item.type || "") || null,
      description_html: clean(item.description || item.description_html || "") || null,
      source_evidence: {
        title_source: "public_account_api",
        title_path: "jobs[].title",
        source_job_id_source: "public_account_api",
        source_job_id_path: shortcode ? "jobs[].shortcode/id" : "canonical_url",
        location_source: location.location ? "public_account_api" : "",
        location_path: location.location ? "jobs[].location.location_str/locations[]" : "",
        country_source: location.country ? "public_account_api" : "",
        country_path: location.country ? "jobs[].location.country/country_code" : "",
        remote_source: remoteType && remoteType !== "unknown" ? "public_account_api" : "",
        remote_path: remoteType && remoteType !== "unknown" ? location.remote_path : "",
        remote_rule_name: remoteType && remoteType !== "unknown" ? "workable_source_remote_field" : "",
        posting_date_source: item.created_at || item.published_at || item.updated_at ? "public_account_api" : "",
        posting_date_path: item.created_at ? "jobs[].created_at" : item.published_at ? "jobs[].published_at" : item.updated_at ? "jobs[].updated_at" : ""
      }
    });
    seenUrls.add(jobUrl);
  }

  return postings;
}

module.exports = {
  parseWorkablePostingsFromApi
};
