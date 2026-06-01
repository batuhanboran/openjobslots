"use strict";

const { normalizeCountryName, normalizeRemoteType } = require("../../posting");

function decodeBase64Utf8(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    return Buffer.from(raw, "base64").toString("utf8");
  } catch {
    return "";
  }
}

function extractGemNumericJobId(rawId) {
  const direct = String(rawId || "").trim();
  if (/^\d+$/.test(direct)) return direct;

  const decoded = decodeBase64Utf8(direct);
  const match = decoded.match(/:(\d{2,})$/);
  return String(match?.[1] || "").trim();
}

function buildGemJobPostingUrl(config, posting) {
  const boardUrl = String(config?.boardUrl || "").replace(/\/+$/, "");
  const item = posting && typeof posting === "object" ? posting : {};
  const numericId = extractGemNumericJobId(item?.id);
  const extId = String(item?.extId || "").trim();
  const fallbackId = String(item?.id || "").trim();
  const identifier = numericId || extId || fallbackId;
  if (!boardUrl || !identifier) return boardUrl || "";
  return `${boardUrl}/${encodeURIComponent(identifier)}`;
}

function normalizeGemLookupText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function isRemoteGemLocation(location) {
  const item = location && typeof location === "object" ? location : {};
  const text = [
    item.name,
    item.locationType,
    item.workplaceType
  ].map(normalizeGemLookupText).filter(Boolean).join(" ");
  return item.isRemote === true || /\b(remote|work from home|wfh|virtual)\b/.test(text);
}

function concreteGemCity(value) {
  const city = String(value || "").trim();
  const normalized = normalizeGemLookupText(city);
  if (!city || ["global", "remote", "worldwide"].includes(normalized)) return "";
  return city;
}

function normalizedGemLocationCountry(location) {
  const item = location && typeof location === "object" ? location : {};
  return normalizeCountryName(item.isoCountry || item.country || item.countryCode || "");
}

function uniqueValues(values) {
  return Array.from(new Set(values.map((value) => String(value || "").trim()).filter(Boolean)));
}

function extractGemPrimaryCountry(posting) {
  const locations = Array.isArray(posting?.locations) ? posting.locations : [];
  const allCountries = uniqueValues(locations.map(normalizedGemLocationCountry));
  if (allCountries.length === 1) return allCountries[0];

  const concreteCountries = uniqueValues(
    locations
      .filter((location) => !isRemoteGemLocation(location))
      .map(normalizedGemLocationCountry)
  );
  return concreteCountries.length === 1 ? concreteCountries[0] : "";
}

function extractGemPrimaryCity(posting) {
  const locations = Array.isArray(posting?.locations) ? posting.locations : [];
  const cities = uniqueValues(
    locations
      .filter((location) => !isRemoteGemLocation(location))
      .map((location) => concreteGemCity(location?.city))
  );
  return cities.length === 1 ? cities[0] : "";
}

function extractGemRemoteType(posting) {
  const item = posting && typeof posting === "object" ? posting : {};
  const explicit = normalizeRemoteType(item?.job?.locationType || item?.locationType || item?.workplaceType);
  if (explicit && explicit !== "unknown") return explicit;

  const locations = Array.isArray(item.locations) ? item.locations : [];
  if (locations.length === 0) return "";
  const remoteCount = locations.filter(isRemoteGemLocation).length;
  if (remoteCount === locations.length) return "remote";
  if (remoteCount > 0) return "hybrid";
  return "onsite";
}

function buildGemSourceEvidence(posting, country, city, remoteType) {
  const evidence = {};
  const locations = Array.isArray(posting?.locations) ? posting.locations : [];
  if (country && locations.some((location) => normalizedGemLocationCountry(location))) {
    Object.assign(evidence, {
      country_source: "list_api",
      country_path: "jobPostings[].locations[].isoCountry",
      country_rule_name: "gem_location_iso_country"
    });
  }
  if (city) {
    Object.assign(evidence, {
      city_source: "list_api",
      city_path: "jobPostings[].locations[].city",
      city_rule_name: "gem_location_city"
    });
  }
  if (remoteType) {
    const hasJobLocationType = Boolean(String(posting?.job?.locationType || posting?.locationType || "").trim());
    Object.assign(evidence, {
      remote_source: "list_api",
      remote_path: hasJobLocationType ? "jobPostings[].job.locationType" : "jobPostings[].locations[].isRemote",
      remote_rule_name: hasJobLocationType ? "gem_job_location_type" : "gem_location_remote_flag"
    });
  }
  return evidence;
}

function extractGemLocationLabel(posting) {
  const item = posting && typeof posting === "object" ? posting : {};
  const locations = Array.isArray(item?.locations) ? item.locations : [];
  const values = [];
  const seen = new Set();

  for (const location of locations) {
    const source = location && typeof location === "object" ? location : {};
    const name = String(source?.name || "").trim();
    const city = String(source?.city || "").trim();
    const country = String(source?.isoCountry || "").trim();
    const normalizedName = normalizeGemLookupText(name);
    const label = isRemoteGemLocation(source) && ["global", "worldwide"].includes(normalizedName)
      ? "Remote"
      : name || [city, country].filter(Boolean).join(", ");
    const normalized = label.toLowerCase();
    if (!label || seen.has(normalized)) continue;
    seen.add(normalized);
    values.push(label);
  }

  if (values.length > 0) return values.join(" / ");

  const locationType = String(item?.job?.locationType || "").trim().toUpperCase();
  if (locationType.includes("REMOTE")) return "Remote";
  return null;
}

function parseGemPostingsFromBatchResponse(companyNameForPostings, config, responseJson) {
  const payload = Array.isArray(responseJson) ? responseJson : [];
  let jobPostings = [];
  for (const item of payload) {
    const data = item && typeof item === "object" ? item.data : null;
    const external = data && typeof data === "object" ? data.oatsExternalJobPostings : null;
    const postings = external && typeof external === "object" ? external.jobPostings : null;
    if (!Array.isArray(postings)) continue;
    jobPostings = postings;
    break;
  }

  const collected = [];
  const seenUrls = new Set();

  for (const posting of jobPostings) {
    const item = posting && typeof posting === "object" ? posting : {};
    const normalizedId = extractGemNumericJobId(item?.id) || String(item?.extId || "").trim() || String(item?.id || "").trim();
    const postingUrl = buildGemJobPostingUrl(config, item);
    if (!postingUrl || seenUrls.has(postingUrl)) continue;

    const department = String(item?.job?.department?.name || "").trim();
    const country = extractGemPrimaryCountry(item);
    const city = extractGemPrimaryCity(item);
    const remoteType = extractGemRemoteType(item);
    collected.push({
      source_job_id: normalizedId,
      id: normalizedId,
      company_name: companyNameForPostings,
      position_name: String(item?.title || "").trim() || "Untitled Position",
      job_posting_url: postingUrl,
      posting_date: null,
      location: extractGemLocationLabel(item),
      country: country || null,
      city: city || null,
      remote_type: remoteType || null,
      workplaceType: String(item?.job?.locationType || item?.locationType || "").trim() || remoteType || null,
      department: department || null,
      source_evidence: buildGemSourceEvidence(item, country, city, remoteType)
    });
    seenUrls.add(postingUrl);
  }

  return collected;
}

module.exports = {
  parseGemPostingsFromBatchResponse
};
