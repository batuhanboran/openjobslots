"use strict";

const { extractSourceIdFromPostingUrl } = require("../../parsers/shared/sourceIds");

function extractLeverLocationName(posting) {
  const allLocations = Array.isArray(posting?.categories?.allLocations) ? posting.categories.allLocations : [];
  const normalizedAllLocations = allLocations
    .map((entry) => String(entry || "").trim())
    .filter(Boolean);
  if (normalizedAllLocations.length > 0) {
    return normalizedAllLocations.join(" / ");
  }

  const location = String(posting?.categories?.location || "").trim();
  return location || null;
}


function parseLeverPostingsFromApi(companyNameForPostings, config, response) {
  const jobPostings = Array.isArray(response) ? response : [];
  const normalizedCompanyName = String(companyNameForPostings || "").trim();
  const resolvedCompanyName =
    normalizedCompanyName && normalizedCompanyName.toLowerCase() !== "jobs"
      ? normalizedCompanyName
      : config?.organizationLower;

  const collected = [];
  for (const posting of jobPostings) {
    const jobUrl = String(posting?.hostedUrl || "").trim();
    if (!jobUrl) continue;

    const createdAt = Number(posting?.createdAt || 0);
    const postingDate =
      Number.isFinite(createdAt) && createdAt > 0 ? new Date(createdAt).toISOString() : null;

    collected.push({
      company_name: resolvedCompanyName,
      source_job_id: String(posting?.id || "").trim() || extractSourceIdFromPostingUrl(jobUrl, "lever"),
      id: String(posting?.id || "").trim() || undefined,
      position_name: String(posting?.text || "").trim() || "Untitled Position",
      job_posting_url: jobUrl,
      apply_url: String(posting?.applyUrl || "").trim() || jobUrl,
      posting_date: postingDate,
      location: extractLeverLocationName(posting),
      country: String(posting?.country || "").trim() || null,
      workplaceType: String(posting?.workplaceType || "").trim() || null,
      department: String(posting?.categories?.team || posting?.categories?.department || "").trim() || null,
      employment_type: String(posting?.categories?.commitment || "").trim() || null,
      description_html: String(posting?.description || posting?.opening || "").trim() || null,
      description_plain: String(posting?.descriptionPlain || posting?.openingPlain || "").trim() || null
    });
  }

  return collected;
}


module.exports = {
  parseLeverPostingsFromApi
};
