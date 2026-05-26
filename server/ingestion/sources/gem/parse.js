"use strict";

function decodeBase64Utf8(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    return Buffer.from(raw, "base64").toString("utf8");
  } catch {
    return "";
  }
}

function extractGemNumericJobId(rawId) {
  const direct = String(rawId || "").trim();
  if (/^\d+$/.test(direct)) return direct;

  const decoded = decodeBase64Utf8(direct);
  const match = decoded.match(/:(\d{2,})$/);
  return String(match?.[1] || "").trim();
}

function buildGemJobPostingUrl(config, posting) {
  const boardUrl = String(config?.boardUrl || "").replace(/\/+$/, "");
  const item = posting && typeof posting === "object" ? posting : {};
  const numericId = extractGemNumericJobId(item?.id);
  const extId = String(item?.extId || "").trim();
  const fallbackId = String(item?.id || "").trim();
  const identifier = numericId || extId || fallbackId;
  if (!boardUrl || !identifier) return boardUrl || "";
  return `${boardUrl}/${encodeURIComponent(identifier)}`;
}

function extractGemLocationLabel(posting) {
  const item = posting && typeof posting === "object" ? posting : {};
  const locations = Array.isArray(item?.locations) ? item.locations : [];
  const values = [];
  const seen = new Set();

  for (const location of locations) {
    const source = location && typeof location === "object" ? location : {};
    const name = String(source?.name || "").trim();
    const city = String(source?.city || "").trim();
    const country = String(source?.isoCountry || "").trim();
    const label = name || [city, country].filter(Boolean).join(", ");
    const normalized = label.toLowerCase();
    if (!label || seen.has(normalized)) continue;
    seen.add(normalized);
    values.push(label);
  }

  if (values.length > 0) return values.join(" / ");

  const locationType = String(item?.job?.locationType || "").trim().toUpperCase();
  if (locationType.includes("REMOTE")) return "Remote";
  return null;
}

function parseGemPostingsFromBatchResponse(companyNameForPostings, config, responseJson) {
  const payload = Array.isArray(responseJson) ? responseJson : [];
  let jobPostings = [];
  for (const item of payload) {
    const data = item && typeof item === "object" ? item.data : null;
    const external = data && typeof data === "object" ? data.oatsExternalJobPostings : null;
    const postings = external && typeof external === "object" ? external.jobPostings : null;
    if (!Array.isArray(postings)) continue;
    jobPostings = postings;
    break;
  }

  const collected = [];
  const seenUrls = new Set();

  for (const posting of jobPostings) {
    const item = posting && typeof posting === "object" ? posting : {};
    const normalizedId = extractGemNumericJobId(item?.id) || String(item?.extId || "").trim() || String(item?.id || "").trim();
    const postingUrl = buildGemJobPostingUrl(config, item);
    if (!postingUrl || seenUrls.has(postingUrl)) continue;

    const department = String(item?.job?.department?.name || "").trim();
    collected.push({
      source_job_id: normalizedId,
      id: normalizedId,
      company_name: companyNameForPostings,
      position_name: String(item?.title || "").trim() || "Untitled Position",
      job_posting_url: postingUrl,
      posting_date: null,
      location: extractGemLocationLabel(item),
      department: department || null
    });
    seenUrls.add(postingUrl);
  }

  return collected;
}

module.exports = {
  parseGemPostingsFromBatchResponse
};
