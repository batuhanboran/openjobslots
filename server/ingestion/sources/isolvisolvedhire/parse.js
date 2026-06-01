"use strict";

const { extractSourceIdFromPostingUrl } = require("../../parsers/shared/sourceIds");

const ISOLVEDHIRE_ISO3_COUNTRY_REGION = Object.freeze({
  VIR: { country: "U.S. Virgin Islands", region: "North America" }
});

function cleanText(value) {
  return String(value || "").trim();
}

function extractIsolvisolvedhireDomainId(pageHtml) {
  const page = String(pageHtml || "");
  const routeDataMatch = page.match(/courierCurrentRouteData\s*=\s*(\{[\s\S]*?\});/i);
  if (routeDataMatch) {
    try {
      const parsed = JSON.parse(routeDataMatch[1]);
      const domainId = cleanText(parsed?.domain_id);
      if (domainId) return domainId;
    } catch {}
  }

  const directMatch = page.match(/"domain_id"\s*:\s*"?(?<id>\d+)"?/i);
  if (directMatch?.groups?.id) return cleanText(directMatch.groups.id);
  return "";
}

function normalizeIsolvisolvedhireIso3Country(job) {
  const iso3 = cleanText(job?.iso3).toUpperCase();
  if (!iso3) return { iso3: "", country: "", region: "" };
  return {
    iso3,
    country: ISOLVEDHIRE_ISO3_COUNTRY_REGION[iso3]?.country || iso3,
    region: ISOLVEDHIRE_ISO3_COUNTRY_REGION[iso3]?.region || ""
  };
}

function normalizeIsolvisolvedhireWorkplaceType(value) {
  const raw = cleanText(value);
  const normalized = raw.toLowerCase();
  if (!normalized) return "";
  if (/\bhybrid\b/.test(normalized)) return "hybrid";
  if (/^work from home flexibility$/.test(normalized)) return "hybrid";
  if (/\b(remote|fully remote|work from home|wfh|telecommute|telework|virtual)\b/.test(normalized)) return "remote";
  if (/^(on[-\s]?site|onsite)$/.test(normalized)) return "onsite";
  return "";
}

function isPlaceholderCountryOnlyLocation(value) {
  const normalized = cleanText(value).replace(/\s+/g, " ");
  return /^(?:0{5}|00000),?\s*(?:US|USA|United States)$/i.test(normalized) ||
    /^(?:US|USA|United States),\s*(?:0{5}|00000)$/i.test(normalized);
}

function buildIsolvisolvedhireLocationLabel(job, countryEvidence, remoteType) {
  const rawLocation = cleanText(job?.jobLocation);
  const sourceCountry = cleanText(countryEvidence?.country || countryEvidence?.iso3);
  if (rawLocation && isPlaceholderCountryOnlyLocation(rawLocation) && sourceCountry) {
    return remoteType === "remote" ? `Remote, ${sourceCountry}` : sourceCountry;
  }
  if (rawLocation) return rawLocation;

  const structuredParts = [
    cleanText(job?.city),
    cleanText(job?.abbreviation || job?.stateName),
    sourceCountry
  ].filter(Boolean);
  return structuredParts.length > 0 ? structuredParts.join(", ") : null;
}

function buildIsolvisolvedhireSourceEvidence(config, countryEvidence, remoteType) {
  const evidence = {
    source_family: "direct_json",
    source_url: cleanText(config?.apiUrl),
    title_source: "list_api",
    title_path: "data.jobs[].title",
    title_rule_name: "isolvisolvedhire_api_title",
    company_source: "existing_value",
    company_path: "company.company_name",
    company_rule_name: "source_company",
    canonical_url_source: "list_api",
    canonical_url_path: "data.jobs[].jobUrl",
    canonical_url_rule_name: "isolvisolvedhire_job_url",
    source_job_id_source: "list_api",
    source_job_id_path: "data.jobs[].id",
    source_job_id_rule_name: "isolvisolvedhire_job_id",
    location_source: "list_api",
    location_path: "data.jobs[].jobLocation|city|stateName|abbreviation|iso3",
    location_rule_name: "isolvisolvedhire_structured_location",
    posting_date_source: "list_api",
    posting_date_path: "data.jobs[].startDateRef",
    posting_date_rule_name: "isolvisolvedhire_start_date"
  };

  if (countryEvidence?.iso3) {
    evidence.country_source = "list_api";
    evidence.country_path = "data.jobs[].iso3";
    evidence.country_rule_name = "isolvisolvedhire_iso3_country";
    evidence.region_source = "list_api";
    evidence.region_path = countryEvidence.region ? "data.jobs[].iso3" : "";
    evidence.region_rule_name = countryEvidence.region ? "isolvisolvedhire_iso3_region" : "";
  }

  evidence.city_source = "list_api";
  evidence.city_path = "data.jobs[].city";
  evidence.city_rule_name = "isolvisolvedhire_structured_city";

  if (remoteType) {
    evidence.remote_source = "list_api";
    evidence.remote_path = "data.jobs[].workplaceType";
    evidence.remote_rule_name = "isolvisolvedhire_workplace_type";
  }

  return evidence;
}

function parseIsolvisolvedhirePostingsFromApi(companyName, responseJson, config = {}) {
  if (!responseJson || typeof responseJson !== "object") return [];
  const jobs = Array.isArray(responseJson?.data?.jobs) ? responseJson.data.jobs : [];
  const postings = [];
  const seenUrls = new Set();

  for (const job of jobs) {
    if (!job || typeof job !== "object") continue;
    const countryEvidence = normalizeIsolvisolvedhireIso3Country(job);
    const remoteType = normalizeIsolvisolvedhireWorkplaceType(job.workplaceType);
    const postingUrl = cleanText(job.jobUrl) || "";
    if (!postingUrl || seenUrls.has(postingUrl)) continue;
    const sourceJobId =
      cleanText(job.id) ||
      cleanText(job.jobId) ||
      extractSourceIdFromPostingUrl(postingUrl, "isolvisolvedhire");

    postings.push({
      company_name: companyName,
      source_job_id: sourceJobId,
      id: sourceJobId || undefined,
      position_name: cleanText(job.title) || "Untitled Position",
      job_posting_url: postingUrl,
      posting_date: cleanText(job.startDateRef) || null,
      location: buildIsolvisolvedhireLocationLabel(job, countryEvidence, remoteType),
      city: cleanText(job.city) || null,
      state: cleanText(job.abbreviation || job.stateName) || null,
      country: countryEvidence.country || null,
      region: countryEvidence.region || null,
      iso3: countryEvidence.iso3 || null,
      workplaceType: cleanText(job.workplaceType) || null,
      remote_type: remoteType || null,
      employment_type: cleanText(job.employmentType) || null,
      department: cleanText(job.jobCategory || job.classification) || null,
      source_evidence: buildIsolvisolvedhireSourceEvidence(config, countryEvidence, remoteType)
    });
    seenUrls.add(postingUrl);
  }
  return postings;
}

module.exports = {
  extractIsolvisolvedhireDomainId,
  normalizeIsolvisolvedhireIso3Country,
  normalizeIsolvisolvedhireWorkplaceType,
  parseIsolvisolvedhirePostingsFromApi
};
