"use strict";

function formatRipplingLocation(locationsValue) {
  const locations = Array.isArray(locationsValue) ? locationsValue : [];
  const values = [];
  const seen = new Set();

  for (const location of locations) {
    const item = location && typeof location === "object" ? location : {};
    const name = String(item?.name || "").trim();
    const city = String(item?.city || "").trim();
    const state = String(item?.state || item?.stateCode || "").trim();
    const country = String(item?.country || "").trim();
    const fallback = [city, state, country].filter(Boolean).join(", ");
    const label = name || fallback;
    const normalized = label.toLowerCase();
    if (!label || seen.has(normalized)) continue;
    seen.add(normalized);
    values.push(label);
  }

  return values.length > 0 ? values.join(" / ") : null;
}

function parseRipplingPostingsFromApi(companyNameForPostings, config, responseJson) {
  const items = Array.isArray(responseJson?.items) ? responseJson.items : [];
  const postings = [];
  const seenUrls = new Set();

  for (const row of items) {
    const item = row && typeof row === "object" ? row : {};
    const postingId = String(item?.id || "").trim();
    const itemUrlRaw = String(item?.url || "").trim();
    const jobUrl = itemUrlRaw || (postingId ? `${config.boardUrl}/${postingId}` : "");
    if (!jobUrl || seenUrls.has(jobUrl)) continue;

    const postingDate =
      String(item?.postedAt || item?.createdAt || item?.updatedAt || item?.publishedAt || "").trim() || null;
    const department = String(item?.department?.name || "").trim() || null;

    postings.push({
      source_job_id: postingId || null,
      company_name: companyNameForPostings,
      position_name: String(item?.name || "").trim() || "Untitled Position",
      job_posting_url: jobUrl,
      posting_date: postingDate,
      location: formatRipplingLocation(item?.locations),
      department,
      employment_type: String(item?.employmentType || item?.employment_type || "").trim() || null,
      remote_type: String(item?.remoteType || item?.remote_type || item?.workplaceType || item?.workplace_type || "").trim() || null,
      workplace_type: String(item?.workplaceType || item?.workplace_type || "").trim() || null,
      language: String(item?.language || "").trim() || null
    });
    seenUrls.add(jobUrl);
  }

  return postings;
}

module.exports = {
  parseRipplingPostingsFromApi
};
