"use strict";

const COUNTRY_CODE_ALIASES = Object.freeze({
  CA: "Canada",
  CAN: "Canada",
  ET: "Ethiopia",
  ETH: "Ethiopia",
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
    country: uniqueSingle(countries),
    hasLocation: values.length > 0,
    hasCity: cities.some((value) => clean(value)),
    hasCountry: countries.some((value) => clean(value))
  };
}

function remoteTypeFromUltiProOpportunity(opportunity, locationText) {
  const jobLocationType = clean(opportunity?.JobLocationType);
  if (jobLocationType === "1") {
    return {
      value: "onsite",
      path: "opportunities[].JobLocationType",
      rule: "ultipro_job_location_type_onsite"
    };
  }
  if (jobLocationType === "2") {
    return {
      value: "remote",
      path: "opportunities[].JobLocationType",
      rule: "ultipro_job_location_type_remote"
    };
  }
  if (jobLocationType === "3") {
    return {
      value: "hybrid",
      path: "opportunities[].JobLocationType",
      rule: "ultipro_job_location_type_hybrid"
    };
  }
  if (locationLabelLooksRemoteScope(locationText)) {
    return {
      value: "remote",
      path: "opportunities[].Locations[].LocalizedName|LocalizedDescription",
      rule: "ultipro_location_label_remote"
    };
  }
  return {
    value: "",
    path: "",
    rule: ""
  };
}

function buildUltiProSourceEvidence({ locationEvidence, remoteEvidence, postingDate }) {
  return {
    title_source: "list_api",
    title_path: "opportunities[].Title",
    canonical_url_source: "url",
    canonical_url_path: "opportunities[].Id",
    source_job_id_source: "list_api",
    source_job_id_path: "opportunities[].Id|OpportunityId",
    location_source: locationEvidence.hasLocation ? "list_api" : "",
    location_path: locationEvidence.hasLocation ? "opportunities[].Locations[].Address|LocalizedName|LocalizedDescription" : "",
    city_source: locationEvidence.hasCity ? "list_api" : "",
    city_path: locationEvidence.hasCity ? "opportunities[].Locations[].Address.City" : "",
    country_source: locationEvidence.hasCountry ? "list_api" : "",
    country_path: locationEvidence.hasCountry ? "opportunities[].Locations[].Address.Country.Name|Code" : "",
    remote_source: remoteEvidence.value ? "list_api" : "",
    remote_path: remoteEvidence.path,
    remote_rule_name: remoteEvidence.rule,
    posting_date_source: postingDate ? "list_api" : "",
    posting_date_path: postingDate ? "opportunities[].PostedDate|CreatedDate" : ""
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
    const title = clean(item?.Title || item?.title || item?.JobTitle || item?.PositionTitle);
    if (!opportunityId || seenIds.has(opportunityId)) continue;
    if (!title) continue;
    const locationEvidence = extractUltiProLocationEvidence(item);
    const remoteEvidence = remoteTypeFromUltiProOpportunity(item, locationEvidence.location);
    const postingDate = String(item?.PostedDate || item?.postedDate || item?.CreatedDate || "").trim() || null;

    postings.push({
      company_name: companyName,
      source_job_id: opportunityId,
      id: opportunityId,
      position_name: title,
      job_posting_url: `${String(config?.baseBoardUrl || "").replace(/\/+$/, "")}/OpportunityDetail?opportunityId=${encodeURIComponent(opportunityId)}`,
      posting_date: postingDate,
      location: locationEvidence.location,
      city: locationEvidence.city || null,
      country: locationEvidence.country || null,
      remote_type: remoteEvidence.value || null,
      workplace_type: remoteEvidence.value || null,
      employment_type: String(item?.JobType || item?.EmploymentType || item?.JobCategory || "").trim() || null,
      department: String(item?.Department || item?.DepartmentName || "").trim() || null,
      source_evidence: buildUltiProSourceEvidence({
        locationEvidence,
        remoteEvidence,
        postingDate
      })
    });
    seenIds.add(opportunityId);
  }

  return postings;
}

module.exports = {
  parseUltiProPostingsFromApi
};
