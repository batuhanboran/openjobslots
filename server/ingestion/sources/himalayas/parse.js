"use strict";

const { normalizeCountryName } = require("../../posting");

function clean(value) {
  return String(value || "").trim();
}

function parseHimalayasPostingsFromApi(companyName, config, rawPayload) {
  const payload = rawPayload && typeof rawPayload === "object" ? rawPayload : {};
  const items = Array.isArray(payload.jobs) ? payload.jobs : (Array.isArray(rawPayload) ? rawPayload : []);
  const postings = [];

  for (const item of items) {
    if (!item || typeof item !== "object") continue;

    const title = clean(item.title);
    if (!title) continue;

    const jobUrl = clean(item.applicationLink || item.url || item.applyUrl);
    if (!jobUrl) continue;

    const company = clean(item.companyName || item.company) || companyName;
    const restrictions = Array.isArray(item.locationRestrictions) ? item.locationRestrictions : [];
    const country = restrictions.length > 0 ? (normalizeCountryName(restrictions[0]) || restrictions[0]) : null;
    const location = restrictions.length > 0 ? restrictions.join(", ") : "Remote";
    const categories = Array.isArray(item.categories) ? item.categories : [];

    postings.push({
      company_name: company,
      source_job_id: String(item.id || item.slug || ""),
      position_name: title,
      job_posting_url: jobUrl,
      posting_date: clean(item.pubDate || item.publishedDate || item.created_at) || null,
      location,
      country,
      remote_type: "remote",
      department: categories[0] || null,
      seniority: clean(item.seniority) || null,
      description_html: clean(item.description) || null,
      source_evidence: Object.freeze({
        route_kind: "himalayas_public_api",
        title_source: "api",
        canonical_url_source: "api_applicationlink",
        location_source: restrictions.length > 0 ? "api_location_restrictions" : "",
        remote_source: "board_is_remote_only"
      })
    });
  }

  return postings;
}

module.exports = { parseHimalayasPostingsFromApi };
