"use strict";

const { normalizeCountryFromLocation } = require("../../posting");

function clean(value) {
  return String(value || "").trim();
}

function parseArbeitnowPostingsFromApi(companyName, config, rawPayload) {
  const payload = rawPayload && typeof rawPayload === "object" ? rawPayload : {};
  const items = Array.isArray(payload.data) ? payload.data : (Array.isArray(rawPayload) ? rawPayload : []);
  const postings = [];

  for (const item of items) {
    if (!item || typeof item !== "object") continue;

    const title = clean(item.title);
    if (!title) continue;

    const jobUrl = clean(item.url);
    if (!jobUrl) continue;

    const company = clean(item.company_name) || companyName;
    const location = clean(item.location);
    const country = normalizeCountryFromLocation(location) || null;
    const isRemote = item.remote === true;
    const tags = Array.isArray(item.tags) ? item.tags : [];

    postings.push({
      company_name: company,
      source_job_id: String(item.slug || item.id || ""),
      position_name: title,
      job_posting_url: jobUrl,
      posting_date: clean(item.created_at) || null,
      location: location || (isRemote ? "Remote" : null),
      country,
      remote_type: isRemote ? "remote" : (location ? "onsite" : null),
      department: tags[0] || null,
      description_html: clean(item.description) || null,
      source_evidence: Object.freeze({
        route_kind: "arbeitnow_public_api",
        title_source: "api",
        canonical_url_source: "api_url",
        location_source: location ? "api_location" : "",
        remote_source: isRemote ? "api_remote_boolean" : ""
      })
    });
  }

  return postings;
}

module.exports = { parseArbeitnowPostingsFromApi };
