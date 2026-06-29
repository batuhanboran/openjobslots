"use strict";

const { normalizeCountryFromLocation } = require("../../posting");

function clean(value) {
  return String(value || "").trim();
}

function parseRemoteOkPostingsFromApi(companyName, config, rawPayload) {
  const items = Array.isArray(rawPayload) ? rawPayload : [];
  const postings = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    // Skip legal notice (first element) and invalid items
    if (!item || typeof item !== "object") continue;
    if (item.legal || (!item.position && !item.slug)) continue;

    const title = clean(item.position);
    if (!title) continue;

    const slug = clean(item.slug);
    const jobUrl = slug ? `https://remoteok.com/remote-jobs/${slug}` : clean(item.url);
    if (!jobUrl) continue;

    const location = clean(item.location);
    const country = normalizeCountryFromLocation(location) || null;
    const company = clean(item.company) || companyName;

    postings.push({
      company_name: company,
      source_job_id: String(item.id || slug || ""),
      position_name: title,
      job_posting_url: jobUrl,
      posting_date: clean(item.date) || null,
      location: location || "Remote",
      country,
      remote_type: "remote",
      department: Array.isArray(item.tags) ? item.tags[0] || null : null,
      description_html: clean(item.description) || null,
      source_evidence: Object.freeze({
        route_kind: "remoteok_public_api",
        title_source: "api",
        canonical_url_source: "api_slug",
        location_source: location ? "api_location" : "",
        remote_source: "board_is_remote_only"
      })
    });
  }

  return postings;
}

module.exports = { parseRemoteOkPostingsFromApi };
