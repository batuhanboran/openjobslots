"use strict";

function extractUltiProLocationName(opportunity) {
  const locations = Array.isArray(opportunity?.Locations) ? opportunity.Locations : [];
  const values = [];
  const seen = new Set();

  for (const location of locations) {
    const item = location && typeof location === "object" ? location : {};
    const address = item.Address && typeof item.Address === "object" ? item.Address : {};
    const city = String(address.City || "").trim();
    const state = String(address?.State?.Code || "").trim();
    const country = String(address?.Country?.Name || "").trim();
    const fallback = String(item.LocalizedDescription || item.LocalizedName || "").trim();

    const cityState = [city, state].filter(Boolean).join(", ");
    let label = "";
    if (cityState && country) {
      label = `${cityState}, ${country}`;
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

  return values.length > 0 ? values.join(" / ") : null;
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

    postings.push({
      company_name: companyName,
      source_job_id: opportunityId,
      id: opportunityId,
      position_name: String(item?.Title || item?.title || "").trim() || "Untitled Position",
      job_posting_url: `${String(config?.baseBoardUrl || "").replace(/\/+$/, "")}/OpportunityDetail?opportunityId=${encodeURIComponent(opportunityId)}`,
      posting_date: String(item?.PostedDate || item?.postedDate || item?.CreatedDate || "").trim() || null,
      location: extractUltiProLocationName(item),
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
