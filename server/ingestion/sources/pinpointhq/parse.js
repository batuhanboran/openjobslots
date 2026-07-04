"use strict";

const { extractSourceIdFromPostingUrl } = require("../../parsers/shared/sourceIds");
const { guardPostingDateAgainstFuture } = require("../sourceModuleHelpers");

function formatPinpointHqLocation(locationValue) {
  const location = locationValue && typeof locationValue === "object" ? locationValue : {};
  const city = String(location?.city || "").trim();
  const province = String(location?.province || "").trim();
  const countryOrName = String(location?.name || "").trim();
  const parts = [city, province, countryOrName].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : null;
}

function parsePinpointHqPostingsFromApi(companyNameForPostings, config, responseJson) {
  const data = Array.isArray(responseJson?.data) ? responseJson.data : [];
  const nowEpoch = config?.__nowEpoch;
  const postings = [];
  const seenUrls = new Set();

  for (const row of data) {
    const item = row && typeof row === "object" ? row : {};
    const itemUrlRaw = String(item?.url || "").trim();
    const itemPathRaw = String(item?.path || "").trim();
    const jobUrl = itemUrlRaw
      ? itemUrlRaw
      : itemPathRaw
        ? new URL(itemPathRaw, `${config.baseOrigin || config.boardUrl || ""}/`).toString()
        : "";
    if (!jobUrl || seenUrls.has(jobUrl)) continue;

    // deadline_at is an application DEADLINE (JSON-LD validThrough), not a
    // posted date; excluding it stops future deadlines from becoming the
    // posting date. The guard is a backstop for future-valued posted fields.
    const postingDate = guardPostingDateAgainstFuture(
      String(item?.posted_at || item?.published_at || item?.created_at || item?.updated_at || "").trim() || null,
      nowEpoch
    );
    const department = String(item?.job?.department?.name || "").trim() || null;

    postings.push({
      company_name: companyNameForPostings,
      source_job_id:
        String(item?.id ?? item?.uuid ?? item?.job_id ?? item?.jobId ?? "").trim() ||
        extractSourceIdFromPostingUrl(jobUrl, "pinpointhq"),
      id: String(item?.id ?? item?.uuid ?? "").trim() || undefined,
      position_name: String(item?.title || "").trim() || "Untitled Position",
      job_posting_url: jobUrl,
      posting_date: postingDate,
      location: formatPinpointHqLocation(item?.location),
      department,
      employment_type: String(item?.employment_type_text || item?.employment_type || "").trim() || null,
      workplace_type: String(item?.workplace_type_text || item?.workplace_type || "").trim() || null
    });
    seenUrls.add(jobUrl);
  }

  return postings;
}

module.exports = {
  parsePinpointHqPostingsFromApi
};
