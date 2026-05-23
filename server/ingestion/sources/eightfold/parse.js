"use strict";

const { decodeHtmlEntities } = require("../../parsers/shared/html");

function cleanEightfoldText(value) {
  return decodeHtmlEntities(String(value || ""))
    .replace(/\s+/g, " ")
    .trim();
}

function extractEightfoldDomainFromHtml(pageHtml) {
  const source = String(pageHtml || "");
  const match = source.match(/window\._EF_GROUP_ID\s*=\s*["']([^"']+)["']/i);
  const value = cleanEightfoldText(match?.[1] || "");
  return value || "";
}

function buildEightfoldApiUrl(config, domainValue) {
  const siteBaseUrl = String(config?.siteBaseUrl || "").replace(/\/+$/, "");
  const domain = cleanEightfoldText(domainValue || "");
  if (!siteBaseUrl || !domain) return "";
  return `${siteBaseUrl}/api/pcsx/search?domain=${encodeURIComponent(domain)}&query=&location=&start=0&`;
}

function parseEightfoldPostingsFromApi(companyNameForPostings, config, responseJson) {
  const data = responseJson?.data && typeof responseJson.data === "object" ? responseJson.data : {};
  const positions = Array.isArray(data?.positions) ? data.positions : [];
  const postings = [];
  const seenIds = new Set();
  const seenUrls = new Set();

  const fallbackCompanyKey =
    String(config?.host || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "board";
  const effectiveCompanyName = cleanEightfoldText(companyNameForPostings) || `eightfold_${fallbackCompanyKey}`;

  for (const position of positions) {
    if (!position || typeof position !== "object") continue;

    const positionId = cleanEightfoldText(position?.id || "");
    const normalizedPositionId = positionId.toLowerCase();
    if (!positionId || seenIds.has(normalizedPositionId)) continue;

    const rawPositionUrl = cleanEightfoldText(position?.positionUrl || "");
    let postingUrl = "";
    if (rawPositionUrl) {
      try {
        postingUrl = new URL(rawPositionUrl, `${String(config?.siteBaseUrl || "").replace(/\/+$/, "")}/`).toString();
      } catch {
        postingUrl = "";
      }
    }
    if (!postingUrl || seenUrls.has(postingUrl)) continue;

    const locations = Array.isArray(position?.locations)
      ? position.locations.map((item) => cleanEightfoldText(item || "")).filter(Boolean)
      : [];
    const fallbackLocation = cleanEightfoldText(position?.locations || "");
    const workLocationOption = cleanEightfoldText(position?.workLocationOption || "");
    let location = locations.length > 0 ? locations.join(", ") : fallbackLocation;
    if (!location && /remote/i.test(workLocationOption)) {
      location = "Remote";
    }

    const rawPostedTs = position?.postedTs;
    let postingDate = "";
    if (Number.isFinite(Number(rawPostedTs)) && Number(rawPostedTs) > 0) {
      postingDate = String(Math.floor(Number(rawPostedTs)));
    } else {
      postingDate = cleanEightfoldText(rawPostedTs || "");
    }

    const department = Array.isArray(position?.department)
      ? position.department.map((item) => cleanEightfoldText(item || "")).filter(Boolean).join(" / ")
      : cleanEightfoldText(position?.department || "");
    const externalId = cleanEightfoldText(position?.atsJobId || "");

    postings.push({
      company_name: effectiveCompanyName,
      position_name: cleanEightfoldText(position?.name || "") || "Untitled Position",
      job_posting_url: postingUrl,
      posting_date: postingDate || null,
      location: location || null,
      department: department || null,
      employment_type: workLocationOption || null,
      external_id: externalId || null
    });
    seenIds.add(normalizedPositionId);
    seenUrls.add(postingUrl);
  }

  return postings;
}

module.exports = {
  buildEightfoldApiUrl,
  extractEightfoldDomainFromHtml,
  parseEightfoldPostingsFromApi
};
