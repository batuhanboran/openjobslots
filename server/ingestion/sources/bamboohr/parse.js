"use strict";

const { isRemoteOnlyLocationValue } = require("../../parsers/shared/location");
const { extractSourceIdFromPostingUrl } = require("../../parsers/shared/sourceIds");

function parseBambooHrPostingsFromApi(companyNameForPostings, config, responseJson) {
  const result = Array.isArray(responseJson?.result) ? responseJson.result : [];
  const postings = [];
  const seenUrls = new Set();

  for (const row of result) {
    const item = row && typeof row === "object" ? row : {};
    const postingId = String(item?.id || "").trim();
    const itemUrlRaw = String(item?.url || item?.jobUrl || item?.applyUrl || item?.applicationUrl || "").trim();
    if (!itemUrlRaw && !postingId) continue;
    const jobUrl = itemUrlRaw
      ? new URL(itemUrlRaw, `${config.baseOrigin || config.boardUrl || ""}/`).toString()
      : postingId
        ? `${config.boardUrl}/${encodeURIComponent(postingId)}`
        : "";
    if (!jobUrl || seenUrls.has(jobUrl)) continue;

    const locationObject = item?.location && typeof item.location === "object" ? item.location : {};
    const atsLocationObject = item?.atsLocation && typeof item.atsLocation === "object" ? item.atsLocation : {};
    const rawLocationText = typeof item?.location === "string" ? String(item.location || "").trim() : "";
    const rawAtsLocationText = typeof item?.atsLocation === "string" ? String(item.atsLocation || "").trim() : "";
    const city = String(locationObject?.city || atsLocationObject?.city || "").trim();
    const state = String(
      locationObject?.state ||
        locationObject?.province ||
        locationObject?.region ||
        atsLocationObject?.state ||
        atsLocationObject?.province ||
        atsLocationObject?.region ||
        ""
    ).trim();
    const country = String(
      locationObject?.country ||
        atsLocationObject?.country ||
        locationObject?.countryName ||
        atsLocationObject?.countryName ||
        locationObject?.countryCode ||
        atsLocationObject?.countryCode ||
        ""
    ).trim();
    const locationName = String(
      locationObject?.name ||
        atsLocationObject?.name ||
        locationObject?.label ||
        atsLocationObject?.label ||
        locationObject?.displayName ||
        atsLocationObject?.displayName ||
        ""
    ).trim();
    const structuredLocation = [city, state, country].filter(Boolean).join(", ");
    const location =
      structuredLocation ||
      locationName ||
      rawLocationText ||
      rawAtsLocationText ||
      String(item?.employmentLocation || item?.workplaceLocation || "").trim() ||
      (item?.isRemote ? "Remote" : null);

    const postingDate =
      String(
        item?.postingDate ||
          item?.postedDate ||
          item?.postedAt ||
          item?.publishedAt ||
          item?.publishDate ||
          item?.datePosted ||
          item?.createdDate ||
          item?.createdAt ||
          item?.updatedDate ||
          item?.updatedAt ||
          item?.openedDate ||
          item?.openDate ||
          ""
      ).trim() ||
      null;

    postings.push({
      company_name: companyNameForPostings,
      source_job_id: postingId || extractSourceIdFromPostingUrl(jobUrl, "bamboohr"),
      id: postingId,
      position_name: String(item?.jobOpeningName || item?.title || "").trim() || "Untitled Position",
      job_posting_url: jobUrl,
      posting_date: postingDate,
      location,
      city: isRemoteOnlyLocationValue(city) ? null : city || null,
      country: country || null,
      remote: item?.isRemote === true,
      is_remote: item?.isRemote === true,
      workplaceType:
        String(item?.workplaceType || item?.workplace_type || item?.remoteStatus || item?.locationType || "").trim() ||
        (item?.isRemote === true ? "remote" : null),
      department: String(item?.departmentLabel || item?.department || "").trim() || null,
      employment_type: String(item?.employmentStatusLabel || item?.employmentStatus || "").trim() || null
    });
    seenUrls.add(jobUrl);
  }

  return postings;
}

module.exports = {
  parseBambooHrPostingsFromApi
};
