"use strict";

function extractAdpMyjobsLocationParts(locationItem) {
  const item = locationItem && typeof locationItem === "object" ? locationItem : {};
  const nameCode = item?.nameCode && typeof item.nameCode === "object" ? item.nameCode : {};
  const locationName = String(nameCode?.longName || "").trim();
  const address = item?.address && typeof item.address === "object" ? item.address : {};
  const city = String(address?.cityName || "").trim();
  const stateData =
    address?.countrySubdivisionLevel1 && typeof address.countrySubdivisionLevel1 === "object"
      ? address.countrySubdivisionLevel1
      : {};
  const state = String(stateData?.codeValue || stateData?.longName || "").trim();
  const countryData = address?.country && typeof address.country === "object" ? address.country : {};
  const country = String(countryData?.longName || countryData?.codeValue || "").trim();
  const addressValue = [city, state, country].filter(Boolean).join(", ");
  return {
    locationName,
    addressValue,
    city,
    state,
    country
  };
}

function formatAdpMyjobsLocation(job) {
  const item = job && typeof job === "object" ? job : {};
  const values = [];
  const seen = new Set();

  for (const field of ["requisitionLocations", "workLocations", "postingLocations"]) {
    const locations = Array.isArray(item?.[field]) ? item[field] : [];
    for (const locationItem of locations) {
      const { locationName, addressValue } = extractAdpMyjobsLocationParts(locationItem);
      const label = locationName && addressValue ? `${locationName} - ${addressValue}` : locationName || addressValue;
      const normalized = String(label || "").trim().toLowerCase();
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      values.push(String(label || "").trim());
    }
  }

  return values.length > 0 ? values.join(" / ") : null;
}

function parseAdpMyjobsPostingsFromApi(companyNameForPostings, config, responseJson) {
  const jobs = Array.isArray(responseJson?.jobRequisitions) ? responseJson.jobRequisitions : [];
  const postings = [];
  const seenUrls = new Set();
  const seenIds = new Set();

  for (const row of jobs) {
    const item = row && typeof row === "object" ? row : {};
    const reqId = String(item?.reqId || "").trim();
    if (reqId && seenIds.has(reqId)) continue;

    const itemUrlRaw = String(item?.url || item?.jobUrl || "").trim();
    const jobUrl = itemUrlRaw || (reqId ? `https://myjobs.adp.com/${config.companyName}/cx/job-details?reqId=${encodeURIComponent(reqId)}` : "");
    if (!jobUrl || seenUrls.has(jobUrl)) continue;

    const postingDate = String(item?.postingDate || "").trim() || null;
    const firstLocation =
      (Array.isArray(item?.requisitionLocations) && item.requisitionLocations[0]) ||
      (Array.isArray(item?.workLocations) && item.workLocations[0]) ||
      (Array.isArray(item?.postingLocations) && item.postingLocations[0]) ||
      null;
    const firstLocationParts = extractAdpMyjobsLocationParts(firstLocation);
    const departmentValues = Array.isArray(item?.organizationalUnits)
      ? item.organizationalUnits
          .map((unit) => String(unit?.nameCode?.longName || unit?.name || "").trim())
          .filter(Boolean)
      : [];

    postings.push({
      company_name: companyNameForPostings,
      source_job_id: reqId || undefined,
      id: reqId || undefined,
      position_name: String(item?.publishedJobTitle || item?.jobTitle || "").trim() || "Untitled Position",
      job_posting_url: jobUrl,
      posting_date: postingDate,
      location: formatAdpMyjobsLocation(item),
      city: firstLocationParts.city || null,
      state: firstLocationParts.state || null,
      country: firstLocationParts.country || null,
      department: departmentValues.length > 0 ? departmentValues.join(" / ") : null,
      employment_type: String(item?.type || "").trim() || null
    });
    seenUrls.add(jobUrl);
    if (reqId) {
      seenIds.add(reqId);
    }
  }

  return postings;
}

module.exports = {
  parseAdpMyjobsPostingsFromApi
};
