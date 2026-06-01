"use strict";

const COUNTRY_CODE_ALIASES = Object.freeze({
  CA: "Canada",
  GB: "United Kingdom",
  MX: "Mexico",
  UK: "United Kingdom",
  US: "United States"
});

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function countryLabel(country, countryCode) {
  const explicit = clean(country);
  if (explicit) return explicit;
  const code = clean(countryCode).toUpperCase();
  return COUNTRY_CODE_ALIASES[code] || code;
}

function locationNameLooksRemoteScope(value) {
  return /\b(remote|hybrid|work from home|wfh|telework|virtual)\b/i.test(clean(value));
}

function formatStructuredRipplingLocation(item = {}) {
  const city = clean(item?.city);
  const state = clean(item?.state || item?.stateCode);
  const country = countryLabel(item?.country, item?.countryCode);
  const parts = [city, state, country].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : "";
}

function hasStructuredSubdivision(item = {}) {
  return Boolean(clean(item?.city) || clean(item?.state || item?.stateCode));
}

function formatRipplingLocation(locationsValue) {
  const locations = Array.isArray(locationsValue) ? locationsValue : [];
  const values = [];
  const seen = new Set();

  for (const location of locations) {
    const item = location && typeof location === "object" ? location : {};
    const name = clean(item?.name);
    const structured = formatStructuredRipplingLocation(item);
    const label = structured && (!locationNameLooksRemoteScope(name) || hasStructuredSubdivision(item))
      ? structured
      : (name || structured);
    const normalized = label.toLowerCase();
    if (!label || seen.has(normalized)) continue;
    seen.add(normalized);
    values.push(label);
  }

  return values.length > 0 ? values.join(" / ") : null;
}

function normalizeRipplingWorkplaceType(value) {
  const normalized = clean(value).toLowerCase().replace(/[_-]+/g, " ");
  if (!normalized) return "";
  if (/\b(remote|telecommute|work from home|wfh|virtual)\b/.test(normalized)) return "remote";
  if (/\bhybrid\b/.test(normalized)) return "hybrid";
  if (/\b(on site|onsite|office)\b/.test(normalized)) return "onsite";
  return "";
}

function remoteTypeFromRipplingLocations(locationsValue) {
  const values = (Array.isArray(locationsValue) ? locationsValue : [])
    .map((location) => normalizeRipplingWorkplaceType(location?.workplaceType || location?.workplace_type))
    .filter(Boolean);
  if (values.length === 0) return "";
  const unique = Array.from(new Set(values));
  if (unique.length === 1) return unique[0];
  if (unique.includes("hybrid")) return "hybrid";
  if (unique.includes("remote") && !unique.includes("onsite")) return "remote";
  return "";
}

function uniqueNonBlank(values) {
  const seen = new Map();
  for (const value of values) {
    const cleaned = clean(value);
    if (!cleaned) continue;
    const key = cleaned.toLowerCase();
    if (!seen.has(key)) seen.set(key, cleaned);
  }
  return Array.from(seen.values());
}

function extractStructuredRipplingLocation(locationsValue) {
  const locations = Array.isArray(locationsValue) ? locationsValue : [];
  const cities = [];
  const states = [];
  const countries = [];

  for (const location of locations) {
    const item = location && typeof location === "object" ? location : {};
    cities.push(item?.city);
    states.push(item?.state || item?.stateCode);
    countries.push(countryLabel(item?.country, item?.countryCode));
  }

  const uniqueCities = uniqueNonBlank(cities);
  const uniqueStates = uniqueNonBlank(states);
  const uniqueCountries = uniqueNonBlank(countries);

  return {
    city: uniqueCities.length === 1 ? uniqueCities[0] : "",
    state: uniqueStates.length === 1 ? uniqueStates[0] : "",
    country: uniqueCountries.length === 1 ? uniqueCountries[0] : ""
  };
}

function buildRipplingSourceEvidence({ locationText, structuredLocation, remoteType, postingDate }) {
  const evidence = {};
  if (locationText) {
    Object.assign(evidence, {
      location_source: "list_api",
      location_path: "items[].locations[]",
      location_rule_name: "rippling_structured_location_fields"
    });
  }
  if (structuredLocation.city) {
    Object.assign(evidence, {
      city_source: "list_api",
      city_path: "items[].locations[].city",
      city_rule_name: "rippling_structured_location_city"
    });
  }
  if (structuredLocation.state) {
    Object.assign(evidence, {
      region_source: "list_api",
      region_path: "items[].locations[].state|stateCode",
      region_rule_name: "rippling_structured_location_region"
    });
  }
  if (structuredLocation.country) {
    Object.assign(evidence, {
      country_source: "list_api",
      country_path: "items[].locations[].country|countryCode",
      country_rule_name: "rippling_structured_location_country"
    });
  }
  if (remoteType) {
    Object.assign(evidence, {
      remote_source: "list_api",
      remote_path: "items[].locations[].workplaceType|workplaceType",
      remote_rule_name: "rippling_structured_workplace_type"
    });
  }
  if (postingDate) {
    Object.assign(evidence, {
      posting_date_source: "list_api",
      posting_date_path: "items[].postedAt|createdAt|updatedAt|publishedAt",
      posting_date_rule_name: "rippling_posting_date"
    });
  }
  return Object.keys(evidence).length > 0 ? evidence : undefined;
}

function parseRipplingPostingsFromApi(companyNameForPostings, config, responseJson) {
  const items = Array.isArray(responseJson?.items) ? responseJson.items : [];
  const postings = [];
  const seenUrls = new Set();

  for (const row of items) {
    const item = row && typeof row === "object" ? row : {};
    const postingId = String(item?.id || "").trim();
    const itemUrlRaw = String(item?.url || "").trim();
    const jobUrl = itemUrlRaw || (postingId ? `${config.boardUrl}/${postingId}` : "");
    if (!jobUrl || seenUrls.has(jobUrl)) continue;

    const postingDate =
      String(item?.postedAt || item?.createdAt || item?.updatedAt || item?.publishedAt || "").trim() || null;
    const department = String(item?.department?.name || "").trim() || null;
    const locationRemoteType = remoteTypeFromRipplingLocations(item?.locations);
    const remoteType = String(item?.remoteType || item?.remote_type || item?.workplaceType || item?.workplace_type || locationRemoteType || "").trim() || null;
    const workplaceType = String(item?.workplaceType || item?.workplace_type || locationRemoteType || "").trim() || null;
    const locationText = formatRipplingLocation(item?.locations);
    const structuredLocation = extractStructuredRipplingLocation(item?.locations);

    postings.push({
      source_job_id: postingId || null,
      company_name: companyNameForPostings,
      position_name: String(item?.name || "").trim() || "Untitled Position",
      job_posting_url: jobUrl,
      posting_date: postingDate,
      location: locationText,
      city: structuredLocation.city || null,
      state: structuredLocation.state || null,
      country: structuredLocation.country || null,
      department,
      employment_type: String(item?.employmentType || item?.employment_type || "").trim() || null,
      remote_type: remoteType,
      workplace_type: workplaceType,
      language: String(item?.language || "").trim() || null,
      source_evidence: buildRipplingSourceEvidence({
        locationText,
        structuredLocation,
        remoteType: normalizeRipplingWorkplaceType(remoteType || workplaceType),
        postingDate
      })
    });
    seenUrls.add(jobUrl);
  }

  return postings;
}

module.exports = {
  parseRipplingPostingsFromApi
};
