"use strict";

const { decodeHtmlEntities } = require("../../parsers/shared/html");
const {
  normalizeCountryFromLocation,
  normalizeCountryName,
  normalizeRegionFromCountry,
  normalizeRemoteType
} = require("../../posting");

const ORACLE_COUNTRY_HINTS = Object.freeze({
  afghanistan: { country: "Afghanistan", region: "APAC" },
  algeria: { country: "Algeria", region: "EMEA" },
  djibouti: { country: "Djibouti", region: "EMEA" },
  kazakhstan: { country: "Kazakhstan", region: "APAC" }
});

function cleanOracleText(value) {
  return decodeHtmlEntities(String(value || ""))
    .replace(/\s+/g, " ")
    .trim();
}

function extractOracleCompanyNameFromFacetList(facets) {
  if (!Array.isArray(facets)) return "";
  for (const facet of facets) {
    if (!facet || typeof facet !== "object") continue;
    const companyName = cleanOracleText(facet?.Name || facet?.name || "");
    if (companyName) return companyName;
  }
  return "";
}

function extractOracleCompanyNameFromItem(item) {
  if (!item || typeof item !== "object") return "";

  const direct = extractOracleCompanyNameFromFacetList(item.organizationsFacet);
  if (direct) return direct;

  const workLocationsFacet = Array.isArray(item.workLocationsFacet)
    ? item.workLocationsFacet
    : item.workLocationsFacet && typeof item.workLocationsFacet === "object"
      ? [item.workLocationsFacet]
      : [];
  for (const workLocation of workLocationsFacet) {
    if (!workLocation || typeof workLocation !== "object") continue;
    const nested = extractOracleCompanyNameFromFacetList(workLocation.organizationsFacet);
    if (nested) return nested;
  }

  return "";
}

function extractOracleCompanyNameFromResponse(responseJson) {
  const items = Array.isArray(responseJson?.items) ? responseJson.items : [];
  for (const item of items) {
    const companyName = extractOracleCompanyNameFromItem(item);
    if (companyName) return companyName;
  }
  return "";
}

function extractOracleLocationFromRequisition(item) {
  const requisition = item && typeof item === "object" ? item : {};
  const primaryLocation = cleanOracleText(requisition?.PrimaryLocation || requisition?.primaryLocation || "");
  if (primaryLocation) return primaryLocation;

  const workLocations = Array.isArray(requisition?.workLocation) ? requisition.workLocation : [];
  const values = [];
  const seen = new Set();

  for (const workLocation of workLocations) {
    const location = workLocation && typeof workLocation === "object" ? workLocation : {};
    const city = cleanOracleText(location?.TownOrCity || location?.townOrCity || "");
    const state = cleanOracleText(location?.Region2 || location?.region2 || "");
    const country = cleanOracleText(location?.Country || location?.country || "");
    const locationName = cleanOracleText(location?.LocationName || location?.locationName || "");
    const label = [city, state, country].filter(Boolean).join(", ") || locationName;
    const normalized = String(label || "").toLowerCase();
    if (!label || seen.has(normalized)) continue;
    seen.add(normalized);
    values.push(label);
  }

  return values.length > 0 ? values.join(" / ") : null;
}

function normalizeOracleCountry(value) {
  const text = cleanOracleText(value);
  if (!text) return "";
  const normalized = text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return normalizeCountryName(text) ||
    normalizeCountryFromLocation(text) ||
    ORACLE_COUNTRY_HINTS[normalized]?.country ||
    "";
}

function normalizeOracleRegion(country) {
  const normalized = String(country || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return normalizeRegionFromCountry(country) || ORACLE_COUNTRY_HINTS[normalized]?.region || "";
}

function extractOracleLocationEvidence(item) {
  const requisition = item && typeof item === "object" ? item : {};
  const primaryLocation = cleanOracleText(requisition?.PrimaryLocation || requisition?.primaryLocation || "");
  const workLocations = Array.isArray(requisition?.workLocation) ? requisition.workLocation : [];

  for (const workLocation of workLocations) {
    const location = workLocation && typeof workLocation === "object" ? workLocation : {};
    const city = cleanOracleText(location?.TownOrCity || location?.townOrCity || "");
    const state = cleanOracleText(location?.Region2 || location?.region2 || "");
    const countryRaw = cleanOracleText(location?.Country || location?.country || "");
    const country = normalizeOracleCountry(countryRaw);
    const locationName = cleanOracleText(location?.LocationName || location?.locationName || "");
    if (!city && !state && !country && !locationName) continue;
    const locationText = [city, state, country].filter(Boolean).join(", ") || primaryLocation || locationName;
    return {
      location: locationText,
      city,
      state,
      country,
      region: normalizeOracleRegion(country),
      hasStructuredPhysicalLocation: Boolean(city || state || country),
      source_evidence: {
        location_source: "list_api",
        location_path: "requisitionList[].workLocation[]",
        location_rule_name: "oracle_work_location",
        location_raw: locationText,
        ...(city
          ? {
              city_source: "list_api",
              city_path: "requisitionList[].workLocation[].TownOrCity",
              city_rule_name: "oracle_work_location_city"
            }
          : {}),
        ...(country
          ? {
              country_source: "list_api",
              country_path: "requisitionList[].workLocation[].Country",
              country_rule_name: "oracle_work_location_country"
            }
          : {})
      }
    };
  }

  const country = normalizeOracleCountry(primaryLocation);
  return {
    location: primaryLocation || null,
    city: "",
    state: "",
    country,
    region: normalizeOracleRegion(country),
    hasStructuredPhysicalLocation: false,
    source_evidence: primaryLocation
      ? {
          location_source: "list_api",
          location_path: "requisitionList[].PrimaryLocation",
          location_rule_name: "oracle_primary_location",
          location_raw: primaryLocation,
          ...(country
            ? {
                country_source: "list_api",
                country_path: "requisitionList[].PrimaryLocation",
                country_rule_name: "oracle_primary_location_country"
              }
            : {})
        }
      : {}
  };
}

function inferOracleRemoteType(row, locationEvidence) {
  const workplaceType = cleanOracleText(row?.WorkplaceType || row?.workplaceType || "");
  const workplaceRemoteType = normalizeRemoteType(workplaceType);
  if (workplaceRemoteType !== "unknown") {
    return {
      value: workplaceRemoteType,
      path: "requisitionList[].WorkplaceType",
      ruleName: "oracle_workplace_type"
    };
  }

  const locationRemoteType = normalizeRemoteType(locationEvidence?.location || "");
  if (locationRemoteType === "remote" || locationRemoteType === "hybrid") {
    return {
      value: locationRemoteType,
      path: locationEvidence?.source_evidence?.location_path || "requisitionList[].PrimaryLocation",
      ruleName: "oracle_location_remote_text"
    };
  }

  if (locationEvidence?.hasStructuredPhysicalLocation) {
    return {
      value: "onsite",
      path: "requisitionList[].workLocation[]",
      ruleName: "oracle_structured_work_location"
    };
  }

  return {
    value: "",
    path: "",
    ruleName: ""
  };
}

function buildOraclePostingUrl(config, requisitionId) {
  const id = String(requisitionId || "").trim();
  if (!id) return String(config?.boardUrl || "").trim();
  return (
    `${config.siteBaseUrl}/hcmUI/CandidateExperience/${encodeURIComponent(config.language)}` +
    `/sites/${encodeURIComponent(config.siteNumber)}/job/${encodeURIComponent(id)}`
  );
}

function parseOraclePostingsFromApi(companyNameForPostings, config, responseJson) {
  const items = Array.isArray(responseJson?.items) ? responseJson.items : [];
  const inferredCompanyName = extractOracleCompanyNameFromResponse(responseJson);
  const effectiveCompanyName =
    cleanOracleText(companyNameForPostings) ||
    inferredCompanyName ||
    `oracle_${String(config?.siteNumber || "cx").toLowerCase()}`;

  const postings = [];
  const seenIds = new Set();
  const seenUrls = new Set();

  for (const item of items) {
    const container = item && typeof item === "object" ? item : {};
    const requisitions = Array.isArray(container?.requisitionList) ? container.requisitionList : [];

    for (const requisition of requisitions) {
      const row = requisition && typeof requisition === "object" ? requisition : {};
      const requisitionId = cleanOracleText(row?.Id || row?.id || "");
      if (requisitionId && seenIds.has(requisitionId)) continue;

      const postingDate = cleanOracleText(row?.PostedDate || row?.postDate || "");
      if (!postingDate) continue;

      const postingUrl = buildOraclePostingUrl(config, requisitionId);
      if (!postingUrl || seenUrls.has(postingUrl)) continue;

      const departmentValues = [
        cleanOracleText(row?.Department || row?.department || ""),
        cleanOracleText(row?.JobFamily || row?.jobFamily || ""),
        cleanOracleText(row?.Organization || row?.organization || ""),
        cleanOracleText(row?.BusinessUnit || row?.businessUnit || "")
      ].filter(Boolean);
      const uniqueDepartments = Array.from(new Set(departmentValues.map((value) => value.toLowerCase()))).map(
        (lowered) => departmentValues.find((value) => value.toLowerCase() === lowered) || lowered
      );

      const employmentTypeValues = [
        cleanOracleText(row?.WorkerType || row?.workerType || ""),
        cleanOracleText(row?.JobType || row?.jobType || ""),
        cleanOracleText(row?.ContractType || row?.contractType || ""),
        cleanOracleText(row?.WorkplaceType || row?.workplaceType || "")
      ].filter(Boolean);
      const uniqueEmploymentTypes = Array.from(
        new Set(employmentTypeValues.map((value) => value.toLowerCase()))
      ).map((lowered) => employmentTypeValues.find((value) => value.toLowerCase() === lowered) || lowered);
      const locationEvidence = extractOracleLocationEvidence(row);
      const remoteType = inferOracleRemoteType(row, locationEvidence);

      postings.push({
        company_name: effectiveCompanyName,
        source_job_id: requisitionId || undefined,
        id: requisitionId || undefined,
        position_name: cleanOracleText(row?.Title || row?.title || "") || "Untitled Position",
        job_posting_url: postingUrl,
        posting_date: postingDate,
        location: locationEvidence.location || extractOracleLocationFromRequisition(row),
        city: locationEvidence.city || null,
        state: locationEvidence.state || null,
        country: locationEvidence.country || null,
        region: locationEvidence.region || null,
        remote_type: remoteType.value || null,
        remote: remoteType.value === "remote",
        is_remote: remoteType.value === "remote" || remoteType.value === "hybrid",
        workplaceType: remoteType.value || null,
        department: uniqueDepartments.length > 0 ? uniqueDepartments.join(" / ") : null,
        employment_type: uniqueEmploymentTypes.length > 0 ? uniqueEmploymentTypes.join(" / ") : null,
        source_evidence: {
          ...(locationEvidence.source_evidence || {}),
          ...(remoteType.value
            ? {
                remote_source: "list_api",
                remote_path: remoteType.path,
                remote_rule_name: remoteType.ruleName
              }
            : {}),
          posting_date_source: "list_api",
          posting_date_path: "requisitionList[].PostedDate",
          posting_date_rule_name: "oracle_posted_date"
        }
      });

      seenUrls.add(postingUrl);
      if (requisitionId) seenIds.add(requisitionId);
    }
  }

  return postings;
}

module.exports = {
  parseOraclePostingsFromApi
};
