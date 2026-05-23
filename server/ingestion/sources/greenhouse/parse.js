"use strict";

const { extractSourceIdFromPostingUrl } = require("../../parsers/shared/sourceIds");
const { normalizeCountryFromLocation } = require("../../posting");

function extractGreenhouseLocationName(posting) {
  const nestedLocation = String(posting?.location?.name || "").trim();
  if (nestedLocation) return nestedLocation;

  const flatLocation = String(posting?.location || "").trim();
  return flatLocation || null;
}


function parseGreenhousePostingsFromApi(companyNameForPostings, config, response) {
  const jobPostings = Array.isArray(response?.jobs) ? response.jobs : [];
  const normalizedCompanyName = String(companyNameForPostings || "").trim();
  const resolvedCompanyName =
    normalizedCompanyName && normalizedCompanyName.toLowerCase() !== "job-boards"
      ? normalizedCompanyName
      : config?.boardTokenLower;

  const collected = [];
  for (const posting of jobPostings) {
    const jobUrl = String(posting?.absolute_url || "").trim();
    if (!jobUrl) continue;
    const officeLocation = String(posting?.offices?.[0]?.location || "").trim();
    const location = extractGreenhouseLocationName(posting) || officeLocation || null;

    collected.push({
      company_name: resolvedCompanyName,
      source_job_id: String(posting?.id ?? posting?.internal_job_id ?? "").trim() || extractSourceIdFromPostingUrl(jobUrl, "greenhouse"),
      id: String(posting?.id ?? "").trim() || undefined,
      position_name: String(posting?.title || "").trim() || "Untitled Position",
      job_posting_url: jobUrl,
      apply_url: jobUrl,
      posting_date: String(posting?.first_published || posting?.updated_at || "").trim() || null,
      location,
      country: normalizeCountryFromLocation(location) || null,
      department: String(posting?.departments?.[0]?.name || posting?.metadata?.[0]?.value || "").trim() || null,
      description_html: String(posting?.content || "").trim() || null
    });
  }

  return collected;
}


module.exports = {
  parseGreenhousePostingsFromApi
};
