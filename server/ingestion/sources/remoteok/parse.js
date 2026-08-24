"use strict";

const { normalizeCountryFromLocation } = require("../../posting");

function clean(value) {
  return String(value || "").trim();
}

const NEGATIVE_REMOTE_PATTERNS = Object.freeze([
  /\bthere is no option to work remotely\b/i,
  /\bno (?:option|opportunity|ability) (?:to|for) (?:work|working) remotely\b/i,
  /\bnot (?:a )?remote (?:role|position|job)\b/i,
  /\b(?:on[- ]?site|in[- ]?office) only\b/i,
  /\bmust be (?:completed|performed|worked) at (?:the )?(?:physical )?(?:location|site|office)\b/i
]);

function resolveRemoteType(item = {}, location = "") {
  const structured = clean(item.remote_type || item.remoteType || item.workplace_type || item.workplaceType).toLowerCase();
  if (["remote", "fully_remote", "fully remote", "100% remote"].includes(structured) || item.remote === true) {
    return { remoteType: "remote", evidence: "api_explicit_remote" };
  }
  if (["hybrid", "partially_remote", "partially remote"].includes(structured) || item.hybrid === true) {
    return { remoteType: "hybrid", evidence: "api_explicit_hybrid" };
  }
  if (["onsite", "on-site", "on site", "office"].includes(structured) || item.remote === false) {
    return { remoteType: "onsite", evidence: "api_explicit_onsite" };
  }

  const sourceText = [item.description, item.position, location].map(clean).filter(Boolean).join(" ");
  if (NEGATIVE_REMOTE_PATTERNS.some((pattern) => pattern.test(sourceText))) {
    return { remoteType: "onsite", evidence: "api_negative_remote_text" };
  }
  if (/\bhybrid\b/i.test(sourceText)) {
    return { remoteType: "hybrid", evidence: "api_explicit_hybrid_text" };
  }
  if (/\b(?:fully remote|100% remote|remote[- ]only|work remotely)\b/i.test(sourceText)) {
    return { remoteType: "remote", evidence: "api_explicit_remote_text" };
  }
  if (/^remote(?:\b|\s*[-,/])/i.test(clean(location))) {
    return { remoteType: "remote", evidence: "api_remote_location" };
  }
  return { remoteType: "unknown", evidence: "api_work_mode_unproven" };
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
    const sourceJobId = clean(item.id);
    if (!jobUrl || !sourceJobId) continue;

    const location = clean(item.location);
    const country = normalizeCountryFromLocation(location) || null;
    const company = clean(item.company) || companyName;
    const workMode = resolveRemoteType(item, location);

    postings.push({
      company_name: company,
      source_job_id: sourceJobId,
      position_name: title,
      job_posting_url: jobUrl,
      posting_date: clean(item.date) || null,
      location: location || null,
      country,
      remote_type: workMode.remoteType,
      department: Array.isArray(item.tags) ? item.tags[0] || null : null,
      description_html: clean(item.description) || null,
      source_evidence: Object.freeze({
        route_kind: "remoteok_public_api",
        original_source: "Remote OK",
        attribution_required: true,
        title_source: "api",
        canonical_url_source: "api_slug",
        location_source: location ? "api_location" : "",
        remote_source: workMode.evidence
      })
    });
  }

  return postings;
}

module.exports = { parseRemoteOkPostingsFromApi, resolveRemoteType };
