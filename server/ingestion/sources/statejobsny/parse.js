"use strict";

const { decodeHtmlEntities } = require("../../parsers/shared/html");

function urljoin(baseUrl, href) {
  const value = String(href || "").trim();
  if (!value) return "";
  try {
    return new URL(value, String(baseUrl || "")).toString();
  } catch {
    return "";
  }
}

function formatStatejobsnyDate(dateValue) {
  const date = dateValue instanceof Date ? dateValue : new Date(dateValue);
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const year = String(date.getUTCFullYear()).slice(-2);
  return `${month}/${day}/${year}`;
}

function buildStatejobsnyWindowUrl(referenceDate = new Date()) {
  const baseUrl = new URL("https://www.statejobsny.com/public/vacancyTable.cfm");
  const now = referenceDate instanceof Date ? referenceDate : new Date(referenceDate);
  const startUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1));
  const endUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  baseUrl.searchParams.set("searchResults", "yes");
  baseUrl.searchParams.set("minDate", formatStatejobsnyDate(startUtc));
  baseUrl.searchParams.set("maxDate", formatStatejobsnyDate(endUtc));
  return baseUrl.toString();
}

function cleanStatejobsnyText(value) {
  return decodeHtmlEntities(String(value || "").replace(/<[^>]+>/g, " "))
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeLabel(value) {
  return cleanStatejobsnyText(value)
    .toLowerCase()
    .replace(/[?:]+$/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function extractStatejobsnySourceJobIdFromUrl(urlString) {
  try {
    const parsed = new URL(urlString, "https://www.statejobsny.com/public/");
    return cleanStatejobsnyText(parsed.searchParams.get("id"));
  } catch {
    return "";
  }
}

function cleanItemNumber(value) {
  return cleanStatejobsnyText(value).replace(/[^A-Za-z0-9_-]+/g, "");
}

function parseStatejobsnyDetailFromHtml(detailHtml) {
  const source = String(detailHtml || "");
  if (!source) return {};

  const labels = {};
  const tableRowRegex = /<tr[^>]*>\s*<t[hd][^>]*>([\s\S]*?)<\/t[hd]>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<\/tr>/gi;
  let tableMatch = tableRowRegex.exec(source);
  while (tableMatch) {
    const label = normalizeLabel(tableMatch[1]);
    const value = cleanStatejobsnyText(tableMatch[2]);
    if (label && value) labels[label] = value;
    tableMatch = tableRowRegex.exec(source);
  }

  const descriptionRegex = /<dt[^>]*>([\s\S]*?)<\/dt>\s*<dd[^>]*>([\s\S]*?)<\/dd>/gi;
  let descriptionMatch = descriptionRegex.exec(source);
  while (descriptionMatch) {
    const label = normalizeLabel(descriptionMatch[1]);
    const value = cleanStatejobsnyText(descriptionMatch[2]);
    if (label && value) labels[label] = value;
    descriptionMatch = descriptionRegex.exec(source);
  }

  return {
    county: labels.county || "",
    street_address: labels.street_address || labels["street address"] || "",
    city: labels.city || "",
    state: labels.state || "",
    postal_code: labels.zip_code || labels["zip code"] || labels.zip || "",
    telecommuting_allowed: labels.telecommuting_allowed || labels["telecommuting allowed"] || ""
  };
}

function mergeStatejobsnyDetailEvidence(posting = {}, detail = {}, detailUrl = "") {
  const city = cleanStatejobsnyText(detail.city);
  const region = cleanStatejobsnyText(detail.state);
  const telecommutingAllowed = cleanStatejobsnyText(detail.telecommuting_allowed);
  const remoteType = /^yes$/i.test(telecommutingAllowed)
    ? "hybrid"
    : /^no$/i.test(telecommutingAllowed)
      ? "onsite"
      : posting.remote_type;
  const location = city && region ? `${city}, ${region}` : null;
  return {
    ...posting,
    county: cleanStatejobsnyText(detail.county) || posting.county || null,
    detail_city: city || null,
    detail_state: region || null,
    street_address: cleanStatejobsnyText(detail.street_address) || null,
    postal_code: cleanStatejobsnyText(detail.postal_code) || null,
    telecommuting_allowed: telecommutingAllowed || null,
    remote_type: remoteType || posting.remote_type,
    location,
    city: location ? city : posting.city,
    region: location ? region : posting.region,
    country: location ? "United States" : posting.country,
    source_evidence: {
      ...(posting.source_evidence || {}),
      detail_url: cleanStatejobsnyText(detailUrl || posting.job_posting_url),
      detail_city_path: city ? "detail.City" : null,
      detail_state_path: region ? "detail.State" : null,
      remote_type_path: telecommutingAllowed ? "detail.Telecommuting allowed?" : null,
      telecommuting_path: telecommutingAllowed ? "detail.Telecommuting allowed?" : null
    }
  };
}

function parseStatejobsnyPostingsFromHtml(pageHtml, pageUrl) {
  const source = String(pageHtml || "");
  if (!source) return [];

  const postings = [];
  const seenUrls = new Set();
  const tbodyMatch = source.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/i);
  const tbodyHtml = tbodyMatch?.[1] || source;
  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  const cellRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
  const linkRegex = /<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i;

  let rowMatch = rowRegex.exec(tbodyHtml);
  while (rowMatch) {
    const rowHtml = String(rowMatch[1] || "");
    const cells = [];
    let cellMatch = cellRegex.exec(rowHtml);
    while (cellMatch) {
      cells.push(String(cellMatch[1] || ""));
      cellMatch = cellRegex.exec(rowHtml);
    }

    if (cells.length < 7) {
      rowMatch = rowRegex.exec(tbodyHtml);
      continue;
    }

    const titleLink = linkRegex.exec(cells[1]);
    if (!titleLink) {
      rowMatch = rowRegex.exec(tbodyHtml);
      continue;
    }

    const itemNumber = cleanItemNumber(cells[0]);
    const href = cleanStatejobsnyText(titleLink[1]);
    const jobPostingUrl = urljoin(pageUrl, href);
    if (!jobPostingUrl || seenUrls.has(jobPostingUrl)) {
      rowMatch = rowRegex.exec(tbodyHtml);
      continue;
    }

    const sourceJobId = extractStatejobsnySourceJobIdFromUrl(jobPostingUrl) || itemNumber;
    if (!sourceJobId) {
      rowMatch = rowRegex.exec(tbodyHtml);
      continue;
    }

    const positionName = cleanStatejobsnyText(titleLink[2]) || "Untitled Position";
    const companyName = cleanStatejobsnyText(cells[5]) || "Unknown Agency";
    const county = cleanStatejobsnyText(cells[6]) || null;
    const postingDate = cleanStatejobsnyText(cells[3]) || null;

    postings.push({
      source_job_id: sourceJobId,
      company_name: companyName,
      position_name: positionName,
      job_posting_url: jobPostingUrl,
      posting_date: postingDate,
      grade: cleanStatejobsnyText(cells[2]) || null,
      deadline: cleanStatejobsnyText(cells[4]) || null,
      county,
      location: null,
      source_evidence: {
        route_kind: "statejobsny_public_vacancy_table",
        list_url: cleanStatejobsnyText(pageUrl),
        source_job_id_path: "detail_href.id || table.Item #",
        title_path: "table.Title a",
        company_path: "table.Agency",
        county_path: "table.County",
        posting_date_path: "table.Posted"
      }
    });
    seenUrls.add(jobPostingUrl);
    rowMatch = rowRegex.exec(tbodyHtml);
  }

  return postings;
}

module.exports = {
  buildStatejobsnyWindowUrl,
  extractStatejobsnySourceJobIdFromUrl,
  mergeStatejobsnyDetailEvidence,
  parseStatejobsnyDetailFromHtml,
  parseStatejobsnyPostingsFromHtml
};
