"use strict";

const { extractSourceIdFromPostingUrl } = require("../../parsers/shared/sourceIds");
const { normalizeCountryName } = require("../../posting");

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeFountainCountryToken(value) {
  const token = clean(value).replace(/\.$/, "");
  return normalizeCountryName(token) || normalizeCountryName(token.toUpperCase()) || "";
}

function looksPostalCode(value) {
  return /^\d{4,}(?:-\d{4})?$/.test(clean(value));
}

function looksRegionCode(value) {
  return /^[A-Z]{2,3}$/.test(clean(value).toUpperCase());
}

function extractFountainAddressEvidence(opening) {
  const address = clean(opening?.location_address);
  if (!address) return null;

  const parts = address.split(",").map(clean).filter(Boolean);
  if (parts.length < 2) return null;

  const country = normalizeFountainCountryToken(parts[parts.length - 1]);
  if (!country) return null;

  const stateCode = clean(opening?.location_state_code).toUpperCase();
  const statePattern = stateCode
    ? new RegExp(`\\b${escapeRegExp(stateCode)}\\b(?:\\s+\\d{4,}(?:-\\d{4})?)?`, "i")
    : null;
  let state = stateCode || "";
  let city = "";

  if (statePattern) {
    for (let index = parts.length - 2; index >= 0; index -= 1) {
      if (!statePattern.test(parts[index])) continue;
      city = clean(parts[index - 1]);
      break;
    }
  }

  if (!city && parts.length >= 2) {
    const localityParts = parts.slice(0, -1);
    const lastLocalityPart = localityParts[localityParts.length - 1];
    if (localityParts.length >= 3 && looksPostalCode(lastLocalityPart)) {
      state = state || localityParts[localityParts.length - 2];
      city = localityParts[localityParts.length - 3];
    } else if (localityParts.length >= 2 && looksRegionCode(lastLocalityPart)) {
      state = state || lastLocalityPart.toUpperCase();
      city = localityParts[localityParts.length - 2];
    } else if (localityParts.length >= 1) {
      city = localityParts[0];
    }
  }

  const location = [city, state, country].filter(Boolean).join(", ");
  if (!location) return null;
  return { city, state, country, location };
}

function parseFountainPostingsFromApi(companyNameForPostings, config, responseJson) {
  const openings = Array.isArray(responseJson?.openings) ? responseJson.openings : [];
  const postings = [];
  const seenUrls = new Set();

  for (const opening of openings) {
    const item = opening && typeof opening === "object" ? opening : {};
    const toParam = String(item?.to_param || "").trim();
    const itemUrl = toParam ? `${config.boardUrl}/${toParam}` : config.boardUrl;
    if (!itemUrl || seenUrls.has(itemUrl)) continue;
    const addressEvidence = extractFountainAddressEvidence(item);

    postings.push({
      company_name: companyNameForPostings,
      source_job_id:
        String(item?.id ?? item?.opening_id ?? item?.openingId ?? item?.uuid ?? toParam).trim() ||
        extractSourceIdFromPostingUrl(itemUrl, "fountain"),
      id: String(item?.id ?? item?.opening_id ?? item?.openingId ?? item?.uuid ?? "").trim() || undefined,
      position_name: String(item?.title || "").trim() || "Untitled Position",
      job_posting_url: itemUrl,
      posting_date:
        String(item?.posted_at || item?.created_at || item?.updated_at || item?.published_at || "").trim() || null,
      location:
        addressEvidence?.location || clean(item?.location_name || item?.location_address) || null,
      city: addressEvidence?.city || null,
      state: addressEvidence?.state || null,
      country: addressEvidence?.country || null,
      employment_type: clean(item?.job_type) || null,
      source_evidence: addressEvidence
        ? {
            location_source: "list_api",
            location_path: "openings[].location_address",
            country_source: "list_api",
            country_path: "openings[].location_address",
            country_rule_name: "fountain_location_address_country"
          }
        : undefined
    });
    seenUrls.add(itemUrl);
  }

  return postings;
}

module.exports = {
  extractFountainAddressEvidence,
  parseFountainPostingsFromApi
};
