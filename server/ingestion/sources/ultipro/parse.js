"use strict";

const COUNTRY_CODE_ALIASES = Object.freeze({
  CA: "Canada",
  CAN: "Canada",
  GB: "United Kingdom",
  GBR: "United Kingdom",
  UK: "United Kingdom",
  US: "United States",
  USA: "United States"
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

function locationLabelLooksRemoteScope(value) {
  return /\b(remote|hybrid|work from home|wfh|telework|virtual)\b/i.test(clean(value));
}

function uniqueSingle(values) {
  const unique = Array.from(new Set(values.map(clean).filter(Boolean)));
  return unique.length === 1 ? unique[0] : "";
}

function extractUltiProLocationEvidence(opportunity) {
  const locations = Array.isArray(opportunity?.Locations) ? opportunity.Locations : [];
  const values = [];
  const cities = [];
  const countries = [];
  const seen = new Set();

  for (const location of locations) {
    const item = location && typeof location === "object" ? location : {};
    const address = item.Address && typeof item.Address === "object" ? item.Address : {};
    const city = clean(address.City);
    const state = clean(address?.State?.Code || address?.State?.Name);
    const country = countryLabel(address?.Country?.Name, address?.Country?.Code);
    const fallback = clean(item.LocalizedName || item.LocalizedDescription);
    if (city) cities.push(city);
    if (country) countries.push(country);

    const cityState = [city, state].filter(Boolean).join(", ");
    let label = "";
    if (cityState && country) {
      label = `${cityState}, ${country}`;
    } else if (city && country) {
      label = `${city}, ${country}`;
    } else if (fallback && country && locationLabelLooksRemoteScope(fallback)) {
      label = `${fallback}, ${country}`;
    } else if (cityState) {
      label = cityState;
    } else if (fallback) {
      label = fallback;
    } else if (country) {
      label = country;
    }

    const normalized = label.toLowerCase();
    if (!label || seen.has(normalized)) continue;
    seen.add(normalized);
    values.push(label);
  }

  return {
    location: values.length > 0 ? values.join(" / ") : null,
    city: uniqueSingle(cities),
    country: uniqueSingle(countries)
  };
}

function parseUltiProPostingsFromApi(companyNameForPostings, config, responseJson) {
  const opportunities = Array.isArray(responseJson?.opportunities) ? responseJson.opportunities : [];
  const postings = [];
  const seenIds = new Set();
  const companyName = String(companyNameForPostings || config?.tenantLower || "").trim();

  for (const opportunity of opportunities) {
    const item = opportunity && typeof opportunity === "object" ? opportunity : {};
    const opportunityId = String(item?.Id || item?.OpportunityId || item?.opportunityId || "").trim();
    if (!opportunityId || seenIds.has(opportunityId)) continue;
    const locationEvidence = extractUltiProLocationEvidence(item);

    postings.push({
      company_name: companyName,
      source_job_id: opportunityId,
      id: opportunityId,
      position_name: String(item?.Title || item?.title || "").trim() || "Untitled Position",
      job_posting_url: `${String(config?.baseBoardUrl || "").replace(/\/+$/, "")}/OpportunityDetail?opportunityId=${encodeURIComponent(opportunityId)}`,
      posting_date: String(item?.PostedDate || item?.postedDate || item?.CreatedDate || "").trim() || null,
      location: locationEvidence.location,
      city: locationEvidence.city || null,
      country: locationEvidence.country || null,
      employment_type: String(item?.JobType || item?.EmploymentType || item?.JobCategory || "").trim() || null,
      department: String(item?.Department || item?.DepartmentName || "").trim() || null
    });
    seenIds.add(opportunityId);
  }

  return postings;
}

module.exports = {
  parseUltiProPostingsFromApi
};
