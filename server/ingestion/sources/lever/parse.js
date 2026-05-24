"use strict";

const { extractSourceIdFromPostingUrl } = require("../../parsers/shared/sourceIds");

function clean(value) {
  return String(value || "").trim();
}

function normalizeCategoryText(value) {
  return clean(value)
    .toLowerCase()
    .replace(/[_\s]+/g, "-")
    .replace(/[^a-z0-9-]+/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function isLeverEmploymentCategory(value) {
  return [
    "apprenticeship",
    "contract",
    "contractor",
    "freelance",
    "full-time",
    "intern",
    "internship",
    "new-grad",
    "part-time",
    "permanent",
    "seasonal",
    "temporary"
  ].includes(normalizeCategoryText(value));
}

function isSameCategoryValue(left, right) {
  const normalizedLeft = normalizeCategoryText(left);
  const normalizedRight = normalizeCategoryText(right);
  return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight);
}

function isLeverNonLocationCategory(posting, value) {
  const categories = posting?.categories || {};
  if (isLeverEmploymentCategory(value)) return true;
  if (isSameCategoryValue(value, categories.commitment)) return true;
  if (isSameCategoryValue(value, categories.team)) return true;
  if (isSameCategoryValue(value, categories.department)) return true;
  return false;
}

function extractLeverEmploymentType(posting) {
  const commitment = clean(posting?.categories?.commitment);
  if (commitment) return commitment;

  const candidates = [
    posting?.categories?.location,
    ...(Array.isArray(posting?.categories?.allLocations) ? posting.categories.allLocations : [])
  ];
  for (const candidate of candidates) {
    const value = clean(candidate);
    if (value && isLeverEmploymentCategory(value)) return value;
  }
  return null;
}

function extractLeverLocationName(posting) {
  const allLocations = Array.isArray(posting?.categories?.allLocations) ? posting.categories.allLocations : [];
  const normalizedAllLocations = allLocations
    .map((entry) => clean(entry))
    .filter(Boolean);
  const locationEntries = normalizedAllLocations.filter((entry) => !isLeverNonLocationCategory(posting, entry));
  if (locationEntries.length > 0) {
    return locationEntries.join(" / ");
  }

  const location = clean(posting?.categories?.location);
  return location && !isLeverNonLocationCategory(posting, location) ? location : null;
}

function extractLeverWorkplaceType(posting, location) {
  const rawType = clean(posting?.workplaceType || posting?.workplace_type || posting?.categories?.workplaceType);
  const normalized = normalizeCategoryText(rawType);
  if (normalized === "remote" || normalized === "hybrid") return rawType;
  if (normalized === "onsite" || normalized === "on-site") return location ? rawType : null;
  return null;
}

function buildLeverSourceEvidence(posting, location, workplaceType) {
  return {
    title_source: "list_api",
    title_path: "[].text",
    title_rule_name: "lever_text",
    company_source: "list_api",
    company_path: "company",
    company_rule_name: "lever_company_context",
    canonical_url_source: "url",
    canonical_url_path: "[].hostedUrl",
    canonical_url_rule_name: "lever_hosted_url",
    source_job_id_source: "list_api",
    source_job_id_path: "[].id",
    source_job_id_rule_name: "lever_id",
    location_source: location ? "list_api" : "",
    location_path: location ? "[].categories.allLocations|[].categories.location" : "",
    location_rule_name: location ? "lever_location_categories" : "lever_filtered_non_location_category",
    remote_source: workplaceType ? "list_api" : "",
    remote_path: workplaceType ? "[].workplaceType" : "",
    remote_rule_name: workplaceType ? "lever_workplace_type" : "",
    posting_date_source: clean(posting?.createdAt) ? "list_api" : "",
    posting_date_path: clean(posting?.createdAt) ? "[].createdAt" : "",
    posting_date_rule_name: clean(posting?.createdAt) ? "lever_created_at" : ""
  };
}

function parseLeverPostingsFromApi(companyNameForPostings, config, response) {
  const jobPostings = Array.isArray(response) ? response : [];
  const normalizedCompanyName = clean(companyNameForPostings);
  const resolvedCompanyName =
    normalizedCompanyName && normalizedCompanyName.toLowerCase() !== "jobs"
      ? normalizedCompanyName
      : config?.organizationLower;

  const collected = [];
  for (const posting of jobPostings) {
    const jobUrl = clean(posting?.hostedUrl);
    if (!jobUrl) continue;

    const createdAt = Number(posting?.createdAt || 0);
    const postingDate =
      Number.isFinite(createdAt) && createdAt > 0 ? new Date(createdAt).toISOString() : null;
    const location = extractLeverLocationName(posting);
    const workplaceType = extractLeverWorkplaceType(posting, location);

    collected.push({
      company_name: resolvedCompanyName,
      source_job_id: clean(posting?.id) || extractSourceIdFromPostingUrl(jobUrl, "lever"),
      id: clean(posting?.id) || undefined,
      position_name: clean(posting?.text) || "Untitled Position",
      job_posting_url: jobUrl,
      apply_url: clean(posting?.applyUrl) || jobUrl,
      posting_date: postingDate,
      location,
      country: clean(posting?.country) || null,
      workplaceType,
      department: clean(posting?.categories?.team || posting?.categories?.department) || null,
      employment_type: extractLeverEmploymentType(posting),
      description_html: clean(posting?.description || posting?.opening) || null,
      description_plain: clean(posting?.descriptionPlain || posting?.openingPlain) || null,
      source_evidence: buildLeverSourceEvidence(posting, location, workplaceType)
    });
  }

  return collected;
}


module.exports = {
  parseLeverPostingsFromApi
};
