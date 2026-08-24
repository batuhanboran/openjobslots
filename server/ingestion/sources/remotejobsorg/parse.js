"use strict";

const { normalizeCountryFromLocation, normalizeCountryName } = require("../../posting");

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

const NEGATIVE_REMOTE_PATTERNS = Object.freeze([
  /\bnot (?:a )?remote (?:role|position|job)\b/i,
  /\b(?:on[- ]?site|in[- ]?office) only\b/i,
  /\bmust be (?:completed|performed|worked) at (?:the )?(?:physical )?(?:location|site|office)\b/i,
  /\bthere is no option to work remotely\b/i
]);

function sourceIssuedId(item = {}) {
  const value = clean(item.id);
  return value && !/^https?:\/\//i.test(value) ? value : "";
}

function companyName(item = {}, fallback = "") {
  if (item.company && typeof item.company === "object") return clean(item.company.name) || clean(fallback);
  return clean(item.company) || clean(fallback);
}

function resolveRemoteType(item = {}, location = "") {
  const structured = clean(item.remote_type || item.remoteType || item.workplace_type || item.workplaceType).toLowerCase();
  const sourceText = [item.description, item.title, location].map(clean).filter(Boolean).join(" ");

  // Negative source evidence must win even though this API is a remote-jobs catalog.
  if (NEGATIVE_REMOTE_PATTERNS.some((pattern) => pattern.test(sourceText))) {
    return { remoteType: "onsite", evidence: "api_negative_remote_text" };
  }
  if (["onsite", "on-site", "on site", "office"].includes(structured) || item.remote === false) {
    return { remoteType: "onsite", evidence: "api_explicit_onsite" };
  }
  if (["hybrid", "partially_remote", "partially remote"].includes(structured) || item.hybrid === true) {
    return { remoteType: "hybrid", evidence: "api_explicit_hybrid" };
  }
  if (["remote", "fully_remote", "fully remote", "100% remote"].includes(structured) || item.remote === true) {
    return { remoteType: "remote", evidence: "api_explicit_remote" };
  }
  if (/\bhybrid\b/i.test(sourceText)) {
    return { remoteType: "hybrid", evidence: "api_explicit_hybrid_text" };
  }
  if (/^remote(?:\b|\s*[-,/])/i.test(clean(location)) || /\b(?:fully remote|100% remote|remote[- ]only)\b/i.test(sourceText)) {
    return { remoteType: "remote", evidence: "api_explicit_remote_text" };
  }
  return { remoteType: "remote", evidence: "api_remote_jobs_catalog" };
}

function parseRemoteJobsOrgPostingsFromApi(rawPayload, fallbackCompany = "") {
  const items = Array.isArray(rawPayload?.data) ? rawPayload.data : [];
  const postings = [];
  const seenUrls = new Set();

  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const sourceJobId = sourceIssuedId(item);
    const title = clean(item.title);
    const company = companyName(item, fallbackCompany);
    const jobUrl = clean(item.url);
    if (!sourceJobId || !title || !company || !jobUrl || seenUrls.has(jobUrl)) continue;

    const location = clean(item.location);
    const country = normalizeCountryName(location) || normalizeCountryFromLocation(location) || null;
    const workMode = resolveRemoteType(item, location);
    const category = item.category && typeof item.category === "object"
      ? clean(item.category.name)
      : clean(item.category);

    postings.push({
      source_job_id: sourceJobId,
      id: sourceJobId,
      company_name: company,
      position_name: title,
      job_posting_url: jobUrl,
      apply_url: clean(item.apply_url) || jobUrl,
      posting_date: clean(item.posted_at) || null,
      location: location || null,
      country,
      remote_type: workMode.remoteType,
      department: category || null,
      employment_type: clean(item.type) || null,
      description_html: clean(item.description) || null,
      source_evidence: Object.freeze({
        route_kind: "remotejobsorg_public_api",
        original_source: "RemoteJobs.org",
        attribution_required: true,
        attribution_text: "Powered by RemoteJobs.org",
        title_source: "api",
        canonical_url_source: "api_remotejobsorg_url",
        location_source: location ? "api_location" : "",
        remote_source: workMode.evidence,
        posting_date_source: item.posted_at ? "api_posted_at" : ""
      })
    });
    seenUrls.add(jobUrl);
  }

  return postings;
}

module.exports = { parseRemoteJobsOrgPostingsFromApi, resolveRemoteType };
