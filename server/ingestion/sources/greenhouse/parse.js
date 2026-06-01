"use strict";

const { extractSourceIdFromPostingUrl } = require("../../parsers/shared/sourceIds");
const { normalizeCountryFromLocation, normalizeRegionFromCountry } = require("../../posting");

function extractGreenhouseLocationName(posting) {
  const nestedLocation = String(posting?.location?.name || "").trim();
  if (nestedLocation) return nestedLocation;

  const flatLocation = String(posting?.location || "").trim();
  return flatLocation || null;
}

function extractGreenhouseOfficeGeo(posting) {
  const offices = Array.isArray(posting?.offices) ? posting.offices : [];
  for (const office of offices) {
    const officeLocation = String(office?.location || "").trim();
    const officeName = String(office?.name || "").trim();
    for (const value of [officeLocation, officeName]) {
      const country = normalizeCountryFromLocation(value);
      if (country) {
        return {
          country,
          region: normalizeRegionFromCountry(country),
          evidencePath: value === officeLocation ? "jobs[].offices[].location" : "jobs[].offices[].name",
          evidenceValue: value
        };
      }
    }
  }
  return { country: "", region: "", evidencePath: "", evidenceValue: "" };
}

function normalizeGreenhouseRemoteType(location, posting, officeGeo, country) {
  const locationText = String(location || "").trim();
  if (/\bhybrid\b/i.test(locationText)) return { remoteType: "hybrid", evidencePath: "jobs[].location.name" };
  if (/\bremote\b/i.test(locationText)) return { remoteType: "remote", evidencePath: "jobs[].location.name" };

  const officeText = [
    officeGeo?.evidenceValue,
    ...(Array.isArray(posting?.offices) ? posting.offices.map((office) => office?.name || office?.location || "") : [])
  ].join(" ");
  if (/\bremote\b/i.test(officeText) && locationAllowsOfficeRemote(locationText, country || officeGeo?.country)) {
    return { remoteType: "remote", evidencePath: officeGeo?.evidencePath || "jobs[].offices[].name" };
  }
  return { remoteType: "", evidencePath: "" };
}

function locationHasMultiCityCounter(location) {
  return /^\s*\d+\s+locations?\s*$/i.test(String(location || "").trim());
}

function normalizeCountryOnlyToken(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\./g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function locationIsCountryOnly(location, country) {
  const rawToken = normalizeCountryOnlyToken(location);
  const countryToken = normalizeCountryOnlyToken(country);
  if (!rawToken || !countryToken) return false;
  if (rawToken === countryToken) return true;
  if (country === "United States") {
    return ["us", "usa", "u s", "u s a", "united states of america"].includes(rawToken);
  }
  return false;
}

function locationAllowsOfficeRemote(location, country) {
  const rawLocation = String(location || "").trim();
  if (!rawLocation) return true;
  if (locationHasMultiCityCounter(rawLocation)) return true;
  return locationIsCountryOnly(rawLocation, country);
}

function locationHasConjoinedCities(location) {
  const value = String(location || "").trim();
  return /\b[A-Za-z][A-Za-z .'-]+\s*&\s*[A-Za-z][A-Za-z .'-]+\b/.test(value);
}

function rewriteCountryCityLocation(location, country) {
  const rawLocation = String(location || "").trim();
  const match = rawLocation.match(/^(.+?)\s+-\s+(.+)$/);
  if (!match?.[1] || !match?.[2]) return "";
  const leftCountry = normalizeCountryFromLocation(match[1]);
  const city = String(match[2] || "").trim();
  if (!leftCountry || leftCountry !== country || !city) return "";
  if (/\b(remote|hybrid|onsite|on[-\s]?site|anywhere|worldwide)\b/i.test(city)) return "";
  return `${city}, ${country}`;
}

function buildGreenhouseLocationLabel(location, country, remoteType) {
  const rawLocation = String(location || "").trim();
  if (!rawLocation) return country || null;
  if (locationHasMultiCityCounter(rawLocation)) return country || null;
  if ((remoteType === "remote" || remoteType === "hybrid") && country && locationHasConjoinedCities(rawLocation)) {
    return `${remoteType === "hybrid" ? "Hybrid" : "Remote"}, ${country}`;
  }
  const countryCityLocation = rewriteCountryCityLocation(rawLocation, country);
  if (countryCityLocation) return countryCityLocation;
  return rawLocation;
}

function buildGreenhouseSourceEvidence(countryPath, remotePath) {
  const evidence = {
    source_family: "direct_json",
    title_source: "list_api",
    title_path: "jobs[].title",
    title_rule_name: "greenhouse_api_title",
    company_source: "existing_value",
    company_path: "company.company_name",
    company_rule_name: "source_company",
    canonical_url_source: "list_api",
    canonical_url_path: "jobs[].absolute_url",
    canonical_url_rule_name: "greenhouse_absolute_url",
    source_job_id_source: "list_api",
    source_job_id_path: "jobs[].id",
    source_job_id_rule_name: "greenhouse_job_id",
    location_source: "list_api",
    location_path: "jobs[].location.name",
    location_rule_name: "greenhouse_location_name",
    posting_date_source: "list_api",
    posting_date_path: "jobs[].first_published|updated_at",
    posting_date_rule_name: "greenhouse_first_published"
  };
  if (countryPath) {
    evidence.country_source = "list_api";
    evidence.country_path = countryPath;
    evidence.country_rule_name = "greenhouse_source_country";
    evidence.region_source = "list_api";
    evidence.region_path = countryPath;
    evidence.region_rule_name = "greenhouse_source_region";
  }
  if (remotePath) {
    evidence.remote_source = "list_api";
    evidence.remote_path = remotePath;
    evidence.remote_rule_name = "greenhouse_source_work_mode";
  }
  return evidence;
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
    const rawLocation = extractGreenhouseLocationName(posting) || officeLocation || null;
    const locationCountry = normalizeCountryFromLocation(rawLocation);
    const officeGeo = extractGreenhouseOfficeGeo(posting);
    const country = locationCountry || officeGeo.country || "";
    const remoteEvidence = normalizeGreenhouseRemoteType(rawLocation, posting, officeGeo, country);
    const location = buildGreenhouseLocationLabel(rawLocation, country, remoteEvidence.remoteType);
    const countryPath = locationCountry ? "jobs[].location.name" : officeGeo.evidencePath;

    collected.push({
      company_name: resolvedCompanyName,
      source_job_id: String(posting?.id ?? posting?.internal_job_id ?? "").trim() || extractSourceIdFromPostingUrl(jobUrl, "greenhouse"),
      id: String(posting?.id ?? "").trim() || undefined,
      position_name: String(posting?.title || "").trim() || "Untitled Position",
      job_posting_url: jobUrl,
      apply_url: jobUrl,
      posting_date: String(posting?.first_published || posting?.updated_at || "").trim() || null,
      location,
      country: country || null,
      region: country ? normalizeRegionFromCountry(country) : null,
      remote_type: remoteEvidence.remoteType || null,
      department: String(posting?.departments?.[0]?.name || posting?.metadata?.[0]?.value || "").trim() || null,
      description_html: String(posting?.content || "").trim() || null,
      source_evidence: buildGreenhouseSourceEvidence(countryPath, remoteEvidence.evidencePath)
    });
  }

  return collected;
}


module.exports = {
  parseGreenhousePostingsFromApi
};
