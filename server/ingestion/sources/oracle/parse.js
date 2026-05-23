"use strict";

const { decodeHtmlEntities } = require("../../parsers/shared/html");

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

      postings.push({
        company_name: effectiveCompanyName,
        source_job_id: requisitionId || undefined,
        id: requisitionId || undefined,
        position_name: cleanOracleText(row?.Title || row?.title || "") || "Untitled Position",
        job_posting_url: postingUrl,
        posting_date: postingDate,
        location: extractOracleLocationFromRequisition(row),
        department: uniqueDepartments.length > 0 ? uniqueDepartments.join(" / ") : null,
        employment_type: uniqueEmploymentTypes.length > 0 ? uniqueEmploymentTypes.join(" / ") : null
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
