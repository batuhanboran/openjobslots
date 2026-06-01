"use strict";

const { extractSourceIdFromPostingUrl } = require("../../parsers/shared/sourceIds");

const APPLICANTPRO_ISO3_COUNTRY_REGION = Object.freeze({
  BMU: { country: "Bermuda", region: "North America" },
  CIV: { country: "Cote d'Ivoire", region: "EMEA" },
  COD: { country: "Democratic Republic of the Congo", region: "EMEA" },
  MLI: { country: "Mali", region: "EMEA" },
  MNP: { country: "Northern Mariana Islands", region: "APAC" },
  NGA: { country: "Nigeria", region: "EMEA" },
  SLE: { country: "Sierra Leone", region: "EMEA" },
  TGO: { country: "Togo", region: "EMEA" }
});

function extractApplicantProDomainId(pageHtml) {
  const source = String(pageHtml || "");
  const patterns = [
    /["']domain_id["']\s*:\s*["']?(\d{2,})["']?/i,
    /["']domainId["']\s*:\s*["']?(\d{2,})["']?/i,
    /data-domain-id=["'](\d{2,})["']/i,
    /name=["']domain_id["'][^>]*value=["'](\d{2,})["']/i,
    /name=["']domainId["'][^>]*value=["'](\d{2,})["']/i,
    /domain_id\s*=\s*["']?(\d{2,})["']?/i,
    /domainId\s*=\s*["']?(\d{2,})["']?/i
  ];

  for (const pattern of patterns) {
    const match = source.match(pattern);
    const value = String(match?.[1] || "").trim();
    if (value) return value;
  }

  return "";
}

function extractApplicantProLocationLabel(job) {
  const location = String(job?.jobLocation || job?.location || job?.locationName || "").trim();
  if (location) return location;

  const city = String(job?.city || "").trim();
  const state = String(job?.abbreviation || job?.stateName || "").trim();
  const country = String(job?.country || job?.countryName || job?.iso3 || "").trim();
  const values = [city, state, country].filter(Boolean);
  return values.length > 0 ? values.join(", ") : null;
}

function normalizeApplicantProIso3Country(job) {
  const rawIso3 = String(job?.iso3 || "").trim().toUpperCase();
  if (!rawIso3) return { iso3: "", country: "", region: "" };
  return {
    iso3: rawIso3,
    country: APPLICANTPRO_ISO3_COUNTRY_REGION[rawIso3]?.country || "",
    region: APPLICANTPRO_ISO3_COUNTRY_REGION[rawIso3]?.region || ""
  };
}

function normalizeApplicantProWorkplaceType(value) {
  const raw = String(value || "").trim();
  const normalized = raw.toLowerCase();
  if (!normalized) return "";
  if (/^(on[-\s]?site|onsite)$/.test(normalized)) return "onsite";
  if (/\bhybrid\b/.test(normalized)) return "hybrid";
  if (/^work from home flexibility$/.test(normalized)) return "hybrid";
  if (/\b(remote|work from home|wfh|telecommute|telework|virtual)\b/.test(normalized)) return "remote";
  return "";
}

function parseApplicantProPostingsFromApi(companyNameForPostings, config, response) {
  const jobs = Array.isArray(response?.data?.jobs)
    ? response.data.jobs
    : Array.isArray(response?.jobs)
      ? response.jobs
      : Array.isArray(response?.data)
        ? response.data
        : [];
  const origin = String(config?.origin || "").trim();
  const companyName = String(companyNameForPostings || config?.subdomainLower || "").trim();
  const collected = [];
  const seenUrls = new Set();

  for (const job of jobs) {
    const countryEvidence = normalizeApplicantProIso3Country(job);
    const workplaceType = String(job?.workplaceType || "").trim();
    const rawJobUrl = String(job?.jobUrl || job?.url || job?.applyUrl || job?.applicationUrl || "").trim();
    const fallbackJobId = String(job?.id ?? job?.job_id ?? job?.jobId ?? job?.jobID ?? "").trim();
    const absoluteUrl = rawJobUrl
      ? new URL(rawJobUrl, origin ? `${origin}/` : "https://example.invalid/").toString()
      : fallbackJobId && origin
        ? `${origin}/jobs/${encodeURIComponent(fallbackJobId)}`
        : "";
    if (!absoluteUrl || seenUrls.has(absoluteUrl)) continue;

    collected.push({
      company_name: companyName,
      source_job_id: fallbackJobId || extractSourceIdFromPostingUrl(absoluteUrl, "applicantpro"),
      id: fallbackJobId || undefined,
      position_name: String(job?.title || job?.jobTitle || job?.name || "").trim() || "Untitled Position",
      job_posting_url: absoluteUrl,
      posting_date: String(job?.startDateRef || job?.postedDate || job?.datePosted || job?.published_at || job?.created_at || "").trim() || null,
      location: extractApplicantProLocationLabel(job),
      city: String(job?.city || "").trim() || null,
      country: countryEvidence.country || String(job?.country || job?.countryName || job?.iso3 || "").trim() || null,
      region: countryEvidence.region || null,
      applicantpro_iso3: countryEvidence.iso3 || null,
      applicantpro_workplace_type: workplaceType || null,
      remote_type: normalizeApplicantProWorkplaceType(workplaceType) || null,
      department: String(job?.department?.name || job?.department || job?.jobCategory || job?.category || "").trim() || null,
      employment_type: String(job?.employmentType || job?.jobType || job?.employment_type || "").trim() || null
    });
    seenUrls.add(absoluteUrl);
  }

  return collected;
}

module.exports = {
  extractApplicantProDomainId,
  normalizeApplicantProIso3Country,
  normalizeApplicantProWorkplaceType,
  parseApplicantProPostingsFromApi
};
