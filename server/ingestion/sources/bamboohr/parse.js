"use strict";

const { isRemoteOnlyLocationValue } = require("../../parsers/shared/location");
const { extractSourceIdFromPostingUrl } = require("../../parsers/shared/sourceIds");
const { normalizeCountryFromLocation } = require("../../posting");

function clean(value) {
  return String(value || "").trim();
}

function normalizeSearchText(value) {
  return clean(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function pushUniqueText(values, value) {
  const text = clean(value);
  if (!text) return;
  if (values.some((existing) => existing.toLowerCase() === text.toLowerCase())) return;
  values.push(text);
}

function inferSparseStructuredCountry(parts) {
  const city = normalizeSearchText(parts.city);
  const state = normalizeSearchText(parts.state);
  const locationName = normalizeSearchText(parts.locationName);
  const rawLocationText = normalizeSearchText(parts.rawLocationText);
  const rawAtsLocationText = normalizeSearchText(parts.rawAtsLocationText);

  if (city === "bruxelles" || state === "brussels" || state === "bruxelles") return "Belgium";
  if (city === "brussels" && !state) return "Belgium";
  if (city === "valletta" || state === "malta") return "Malta";
  if (city === "luxembourg" || state === "luxembourg") return "Luxembourg";
  if (/\bbruxelles\b/.test(locationName) || /\bbruxelles\b/.test(rawLocationText)) return "Belgium";
  if (/\bvalletta\b/.test(locationName) || /\bvalletta\b/.test(rawAtsLocationText)) return "Malta";
  if (/\bluxembourg\b/.test(locationName) || /\bluxembourg\b/.test(rawLocationText)) return "Luxembourg";
  return "";
}

function isAmbiguousBambooHrCity(value) {
  const text = normalizeSearchText(value);
  if (!text) return false;
  return /^(multiple|various|several|many)\b/.test(text) || /\bmultiple bases\b/.test(text);
}

function buildStructuredLocation(parts) {
  const values = [];
  pushUniqueText(values, parts.city);
  pushUniqueText(values, parts.state);
  pushUniqueText(values, parts.country);
  return values.join(", ");
}

function hasStructuredLocationValue(locationObject) {
  return Boolean(
    clean(locationObject?.city) ||
      clean(locationObject?.state) ||
      clean(locationObject?.province) ||
      clean(locationObject?.region) ||
      clean(locationObject?.country) ||
      clean(locationObject?.countryName) ||
      clean(locationObject?.countryCode)
  );
}

function parseBambooHrPostingsFromApi(companyNameForPostings, config, responseJson) {
  const result = Array.isArray(responseJson?.result) ? responseJson.result : [];
  const postings = [];
  const seenUrls = new Set();

  for (const row of result) {
    const item = row && typeof row === "object" ? row : {};
    const postingId = String(item?.id || "").trim();
    const itemUrlRaw = String(item?.url || item?.jobUrl || item?.applyUrl || item?.applicationUrl || "").trim();
    if (!itemUrlRaw && !postingId) continue;
    const jobUrl = itemUrlRaw
      ? new URL(itemUrlRaw, `${config.baseOrigin || config.boardUrl || ""}/`).toString()
      : postingId
        ? `${config.boardUrl}/${encodeURIComponent(postingId)}`
        : "";
    if (!jobUrl || seenUrls.has(jobUrl)) continue;

    const locationObject = item?.location && typeof item.location === "object" ? item.location : {};
    const atsLocationObject = item?.atsLocation && typeof item.atsLocation === "object" ? item.atsLocation : {};
    const rawLocationText = typeof item?.location === "string" ? clean(item.location) : "";
    const rawAtsLocationText = typeof item?.atsLocation === "string" ? clean(item.atsLocation) : "";
    const rawCity = clean(locationObject?.city || atsLocationObject?.city);
    const city = isRemoteOnlyLocationValue(rawCity) || isAmbiguousBambooHrCity(rawCity) ? "" : rawCity;
    const state = clean(
      locationObject?.state ||
        locationObject?.province ||
        locationObject?.region ||
        atsLocationObject?.state ||
        atsLocationObject?.province ||
        atsLocationObject?.region ||
        ""
    );
    const countryRaw = clean(
      locationObject?.country ||
        atsLocationObject?.country ||
        locationObject?.countryName ||
        atsLocationObject?.countryName ||
        locationObject?.countryCode ||
        atsLocationObject?.countryCode ||
        ""
    );
    const locationName = clean(
      locationObject?.name ||
        atsLocationObject?.name ||
        locationObject?.label ||
        atsLocationObject?.label ||
        locationObject?.displayName ||
        atsLocationObject?.displayName ||
        ""
    );
    const country =
      countryRaw ||
      inferSparseStructuredCountry({
        city: rawCity,
        state,
        country: countryRaw,
        locationName,
        rawLocationText,
        rawAtsLocationText
      }) ||
      normalizeCountryFromLocation(buildStructuredLocation({ city: rawCity, state, country: "" }));
    const structuredLocation = buildStructuredLocation({ city: rawCity, state, country });
    const location =
      structuredLocation ||
      locationName ||
      rawLocationText ||
      rawAtsLocationText ||
      clean(item?.employmentLocation || item?.workplaceLocation) ||
      (item?.isRemote ? "Remote" : null);
    const locationPath = hasStructuredLocationValue(locationObject)
      ? "result[].location"
      : hasStructuredLocationValue(atsLocationObject)
        ? "result[].atsLocation"
        : "";
    const sourceEvidence = locationPath
      ? {
          location_source: "list_api",
          location_path: locationPath,
          location_rule_name: country && (!countryRaw || locationPath === "result[].atsLocation")
            ? "bamboohr_sparse_structured_location"
            : "bamboohr_structured_location",
          location_raw: location
        }
      : undefined;

    const postingDate =
      clean(
        item?.postingDate ||
          item?.postedDate ||
          item?.postedAt ||
          item?.publishedAt ||
          item?.publishDate ||
          item?.datePosted ||
          item?.createdDate ||
          item?.createdAt ||
          item?.updatedDate ||
          item?.updatedAt ||
          item?.openedDate ||
          item?.openDate ||
          ""
      ) ||
      null;

    postings.push({
      company_name: companyNameForPostings,
      source_job_id: postingId || extractSourceIdFromPostingUrl(jobUrl, "bamboohr"),
      id: postingId,
      position_name: clean(item?.jobOpeningName || item?.title) || "Untitled Position",
      job_posting_url: jobUrl,
      posting_date: postingDate,
      location,
      city: city || null,
      country: country || null,
      remote: item?.isRemote === true,
      is_remote: item?.isRemote === true,
      workplaceType:
        clean(item?.workplaceType || item?.workplace_type || item?.remoteStatus || item?.locationType) ||
        (item?.isRemote === true ? "remote" : null),
      department: clean(item?.departmentLabel || item?.department) || null,
      employment_type: clean(item?.employmentStatusLabel || item?.employmentStatus) || null,
      source_evidence: sourceEvidence
    });
    seenUrls.add(jobUrl);
  }

  return postings;
}

module.exports = {
  parseBambooHrPostingsFromApi
};
