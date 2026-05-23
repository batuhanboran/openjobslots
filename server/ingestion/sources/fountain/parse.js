"use strict";

const { extractSourceIdFromPostingUrl } = require("../../parsers/shared/sourceIds");

function parseFountainPostingsFromApi(companyNameForPostings, config, responseJson) {
  const openings = Array.isArray(responseJson?.openings) ? responseJson.openings : [];
  const postings = [];
  const seenUrls = new Set();

  for (const opening of openings) {
    const item = opening && typeof opening === "object" ? opening : {};
    const toParam = String(item?.to_param || "").trim();
    const itemUrl = toParam ? `${config.boardUrl}/${toParam}` : config.boardUrl;
    if (!itemUrl || seenUrls.has(itemUrl)) continue;

    postings.push({
      company_name: companyNameForPostings,
      source_job_id:
        String(item?.id ?? item?.opening_id ?? item?.openingId ?? item?.uuid ?? toParam).trim() ||
        extractSourceIdFromPostingUrl(itemUrl, "fountain"),
      id: String(item?.id ?? item?.opening_id ?? item?.openingId ?? item?.uuid ?? "").trim() || undefined,
      position_name: String(item?.title || "").trim() || "Untitled Position",
      job_posting_url: itemUrl,
      posting_date:
        String(item?.posted_at || item?.created_at || item?.updated_at || item?.published_at || "").trim() || null,
      location:
        String(item?.location_name || item?.location_address || "").trim() || null,
      employment_type: String(item?.job_type || "").trim() || null
    });
    seenUrls.add(itemUrl);
  }

  return postings;
}

module.exports = {
  parseFountainPostingsFromApi
};
