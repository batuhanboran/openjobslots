"use strict";

const { decodeHtmlEntities } = require("../../parsers/shared/html");
const { extractSourceIdFromPostingUrl } = require("../../parsers/shared/sourceIds");
const { normalizeCountryName, normalizeRemoteType } = require("../../posting");

function clean(value) {
  return decodeHtmlEntities(String(value || "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1"))
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function xmlValue(source, tagName) {
  const pattern = new RegExp(`<${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tagName}>`, "i");
  return clean(String(source || "").match(pattern)?.[1] || "");
}

function xmlBlocks(source, tagName) {
  const blocks = [];
  const pattern = new RegExp(`<${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tagName}>`, "gi");
  let match = pattern.exec(String(source || ""));
  while (match) {
    blocks.push(String(match[1] || ""));
    match = pattern.exec(String(source || ""));
  }
  return blocks;
}

function normalizePersonioCountry(value) {
  return normalizeCountryName(value) || normalizeCountryName(String(value || "").toUpperCase()) || "";
}

function buildPersonioJobUrl(config, block) {
  const explicit = xmlValue(block, "jobUrl") || xmlValue(block, "url") || xmlValue(block, "link");
  if (explicit) return explicit;
  const id = xmlValue(block, "id");
  const slug = String(config?.companySlug || "").trim();
  if (slug && id) return `${String(config?.boardUrl || `https://${slug}.jobs.personio.de/`).replace(/\/+$/, "")}/job/${encodeURIComponent(id)}`;
  return "";
}

function extractLocation(block) {
  const office = xmlValue(block, "office");
  const location = xmlValue(block, "location");
  const city = xmlValue(block, "city");
  const country = normalizePersonioCountry(xmlValue(block, "country"));
  const label = location || [city, country || office].filter(Boolean).join(", ") || office;
  return {
    location: label || null,
    city: city || null,
    office: office || null,
    country: country || null
  };
}

function extractRemoteType(block, location) {
  const candidates = [
    { value: xmlValue(block, "workplace"), path: "workzag-jobs.position.workplace" },
    { value: xmlValue(block, "workplace_type"), path: "workzag-jobs.position.workplace_type" },
    { value: xmlValue(block, "remote"), path: "workzag-jobs.position.remote" },
    { value: location.office, path: "workzag-jobs.position.office" },
    { value: location.location, path: "workzag-jobs.position.location/office" }
  ];
  for (const candidate of candidates) {
    const remoteType = normalizeRemoteType(candidate.value);
    if (remoteType !== "unknown") {
      return {
        remote_type: remoteType,
        path: candidate.path
      };
    }
  }
  return {
    remote_type: "",
    path: ""
  };
}

function parsePersonioPostingsFromXml(companyNameForPostings, config, response) {
  const xml = typeof response === "string" ? response : String(response?.xml || "");
  const positionBlocks = xmlBlocks(xml, "position");
  const postings = [];
  const seenUrls = new Set();

  for (const block of positionBlocks) {
    const title = xmlValue(block, "name") || xmlValue(block, "title");
    const jobUrl = buildPersonioJobUrl(config, block);
    if (!title || !jobUrl || seenUrls.has(jobUrl)) continue;

    const id = xmlValue(block, "id") || extractSourceIdFromPostingUrl(jobUrl, "personio");
    const location = extractLocation(block);
    const remote = extractRemoteType(block, location);
    const postingDate = xmlValue(block, "created_at") ||
      xmlValue(block, "createdAt") ||
      xmlValue(block, "updated_at") ||
      xmlValue(block, "updatedAt") ||
      null;

    postings.push({
      source_job_id: id || extractSourceIdFromPostingUrl(jobUrl, "personio"),
      id: id || undefined,
      company_name: companyNameForPostings,
      position_name: title,
      job_posting_url: jobUrl,
      apply_url: jobUrl,
      posting_date: postingDate,
      location: location.location,
      city: location.city,
      country: location.country,
      remote_type: remote.remote_type || null,
      department: xmlValue(block, "department") || null,
      employment_type: xmlValue(block, "employment_type") || xmlValue(block, "employmentType") || null,
      description_html: xmlValue(block, "description") || null,
      source_evidence: {
        title_source: "xml_feed",
        title_path: "workzag-jobs.position.name",
        source_job_id_source: "xml_feed",
        source_job_id_path: id ? "workzag-jobs.position.id" : "canonical_url",
        location_source: location.location ? "xml_feed" : "",
        location_path: location.location ? "workzag-jobs.position.office/location/city/country" : "",
        country_source: location.country ? "xml_feed" : "",
        country_path: location.country ? "workzag-jobs.position.country" : "",
        remote_source: remote.remote_type ? "xml_feed" : "",
        remote_path: remote.path,
        remote_rule_name: remote.remote_type ? "personio_source_remote_field" : "",
        posting_date_source: postingDate ? "xml_feed" : "",
        posting_date_path: postingDate ? "workzag-jobs.position.created_at/updated_at" : ""
      }
    });
    seenUrls.add(jobUrl);
  }

  return postings;
}

module.exports = {
  parsePersonioPostingsFromXml
};
