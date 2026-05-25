"use strict";

const { decodeHtmlEntities, extractJsonLdObjectsFromHtml } = require("../../parsers/shared/html");
const { extractSourceIdFromPostingUrl } = require("../../parsers/shared/sourceIds");
const { normalizeCountryFromLocation, normalizeCountryName } = require("../../posting");
const { readLimitedResponseText, safeFetch } = require("../../safeFetch");

const CAREERPLUG_DEFAULT_DETAIL_LIMIT = 30;
const CAREERPLUG_DEFAULT_DETAIL_DELAY_MS = 150;
const CAREERPLUG_US_STATE_CODES = new Set([
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DC", "DE", "FL",
  "GA", "HI", "IA", "ID", "IL", "IN", "KS", "KY", "LA", "MA",
  "MD", "ME", "MI", "MN", "MO", "MS", "MT", "NC", "ND", "NE",
  "NH", "NJ", "NM", "NV", "NY", "OH", "OK", "OR", "PA", "RI",
  "SC", "SD", "TN", "TX", "UT", "VA", "VT", "WA", "WI", "WV",
  "WY"
]);

function cleanCareerplugText(value) {
  return decodeHtmlEntities(String(value || "").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .replace(/\s*,\s*/g, ", ")
    .trim();
}

function normalizeCareerplugMeta(value) {
  return cleanCareerplugText(value)
    .replace(/^\s*Location:\s*/i, "")
    .replace(/^\s*Full\s*\/\s*Part\s*Time:\s*/i, "")
    .trim();
}

function normalizeCareerplugStateCityZipLocation(value) {
  const raw = normalizeCareerplugMeta(value);
  const match = raw.match(/^([A-Z]{2})-(.+?)(?:-(\d{5}(?:-\d{4})?))?$/i);
  const state = String(match?.[1] || "").toUpperCase();
  const city = cleanCareerplugText(match?.[2] || "").replace(/\s*-\s*/g, "-").trim();
  if (!state || !city || !CAREERPLUG_US_STATE_CODES.has(state)) return null;
  if (/^\d+$/.test(city)) return null;
  return {
    location: `${city}, ${state}, United States`,
    city,
    state,
    country: "United States",
    evidence: {
      location_source: "labeled_html",
      location_path: ".job-location",
      location_rule_name: "careerplug_state_city_zip_location",
      city_source: "labeled_html",
      city_path: ".job-location",
      city_rule_name: "careerplug_state_city_zip_location",
      country_source: "labeled_html",
      country_path: ".job-location",
      country_rule_name: "careerplug_state_city_zip_location"
    }
  };
}

function careerplugListLocationFields(value) {
  const normalized = normalizeCareerplugMeta(value);
  if (!normalized) return {
    location: "",
    evidence: {}
  };
  const structured = normalizeCareerplugStateCityZipLocation(normalized);
  if (structured) return structured;
  return {
    location: normalized,
    evidence: {
      location_source: "labeled_html",
      location_path: ".job-location",
      location_rule_name: "careerplug_job_location"
    }
  };
}

function normalizeCareerplugAriaTitle(value) {
  const cleaned = cleanCareerplugText(value)
    .replace(/^\s*(view|open|apply\s+for|view\s+details\s+for)\s+(job|position|role)?\s*[:\-]?\s*/i, "")
    .replace(/\s+\|\s+.*$/i, "")
    .trim();
  return /^(view|open|apply|job|jobs|position|role|details)$/i.test(cleaned) ? "" : cleaned;
}

function extractCareerplugDivBlock(source, startIndex) {
  const html = String(source || "");
  const start = Number(startIndex || 0);
  const opening = html.slice(start).match(/^<div\b[^>]*>/i);
  if (!opening) return "";
  const tagPattern = /<\/?div\b[^>]*>/gi;
  tagPattern.lastIndex = start;
  let depth = 0;
  let tagMatch = tagPattern.exec(html);
  while (tagMatch) {
    if (/^<div\b/i.test(tagMatch[0])) depth += 1;
    else depth -= 1;
    if (depth === 0) return html.slice(start, tagPattern.lastIndex);
    tagMatch = tagPattern.exec(html);
  }
  return html.slice(start);
}

function extractCareerplugRowHtml(source, anchorIndex) {
  const html = String(source || "");
  const beforeAnchor = html.slice(0, Math.max(0, Number(anchorIndex || 0)));
  const rowPattern = /<div\b[^>]*class=["'][^"']*\brow\b[^"']*["'][^>]*>/gi;
  let rowMatch = rowPattern.exec(beforeAnchor);
  let latest = null;
  while (rowMatch) {
    latest = rowMatch;
    rowMatch = rowPattern.exec(beforeAnchor);
  }
  if (!latest) return "";
  const rowHtml = extractCareerplugDivBlock(html, latest.index);
  return rowHtml && rowHtml.includes("/jobs/") ? rowHtml : "";
}

function extractCareerplugTitleFromHtml(titleHtml, anchorAttrs) {
  const source = String(titleHtml || "");
  const nameMatch = source.match(/<span[^>]*class=["'][^"']*\bname\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i);
  return cleanCareerplugText(nameMatch?.[1] || source)
    || normalizeCareerplugAriaTitle(String(anchorAttrs || "").match(/\baria-label=["']([^"']*)["']/i)?.[1] || "");
}

function cleanCareerplugStructuredValue(value) {
  if (Array.isArray(value)) {
    return value.map(cleanCareerplugStructuredValue).filter(Boolean).join(", ");
  }
  if (value && typeof value === "object") {
    return cleanCareerplugStructuredValue(value.name || value.value || value["@id"]);
  }
  return cleanCareerplugText(value);
}

function firstCareerplugJobLocationAddress(value) {
  const locations = Array.isArray(value) ? value : value ? [value] : [];
  for (const location of locations) {
    if (location?.address && typeof location.address === "object") return location.address;
  }
  return {};
}

function findCareerplugJobPostingJsonLd(sourceHtml) {
  return extractJsonLdObjectsFromHtml(sourceHtml).find((item) => {
    const type = item?.["@type"];
    return Array.isArray(type)
      ? type.some((value) => String(value || "").toLowerCase() === "jobposting")
      : String(type || "").toLowerCase() === "jobposting";
  }) || null;
}

function normalizeCareerplugCanonicalJobUrl(rawUrl, config = {}) {
  const value = cleanCareerplugText(rawUrl);
  if (!value) return "";
  const baseOrigin = cleanCareerplugText(config.baseOrigin);
  try {
    const parsed = new URL(value, baseOrigin ? `${baseOrigin}/` : "https://example.invalid/");
    const id = parsed.pathname.match(/\/jobs\/(\d+)(?:\/apps(?:\/new)?)?(?:\/|$)/i)?.[1] || "";
    if (id && baseOrigin) return new URL(`/jobs/${id}`, `${baseOrigin}/`).toString();
    return parsed.toString();
  } catch {
    return "";
  }
}

function extractCareerplugDetailJobUrlFromHtml(sourceHtml) {
  const source = String(sourceHtml || "");
  const patterns = [
    /\b(?:href|action)=["']([^"']*\/jobs\/\d+(?:\/apps(?:\/new)?)?[^"']*)["']/i,
    /\bcontent=["']([^"']*\/jobs\/\d+[^"']*)["']/i
  ];
  for (const pattern of patterns) {
    const match = source.match(pattern);
    if (match?.[1]) return match[1];
  }
  return "";
}

function extractCareerplugJsonLdFieldsFromObject(jobPosting) {
  if (!jobPosting) return {};
  const address = firstCareerplugJobLocationAddress(jobPosting.jobLocation);
  const city = cleanCareerplugStructuredValue(address.addressLocality);
  const state = cleanCareerplugStructuredValue(address.addressRegion);
  const countryRaw = cleanCareerplugStructuredValue(address.addressCountry);
  const country = normalizeCountryName(countryRaw) || normalizeCountryFromLocation(countryRaw) || countryRaw;
  const datePosted = cleanCareerplugStructuredValue(jobPosting.datePosted);
  const employmentType = cleanCareerplugStructuredValue(jobPosting.employmentType);
  const locationParts = [city, state, country].filter(Boolean);
  return {
    location: locationParts.length > 0 ? locationParts.join(", ") : "",
    city,
    state,
    country,
    posting_date: datePosted,
    employment_type: employmentType,
    evidence: {
      location_source: locationParts.length > 0 ? "json_ld" : "",
      location_path: locationParts.length > 0 ? "jobLocation.address" : "",
      city_source: city ? "json_ld" : "",
      city_path: city ? "jobLocation.address.addressLocality" : "",
      region_source: state ? "json_ld" : "",
      region_path: state ? "jobLocation.address.addressRegion" : "",
      country_source: country ? "json_ld" : "",
      country_path: country ? "jobLocation.address.addressCountry" : "",
      posting_date_source: datePosted ? "json_ld" : "",
      posting_date_path: datePosted ? "datePosted" : "",
      employment_type_source: employmentType ? "json_ld" : "",
      employment_type_path: employmentType ? "employmentType" : ""
    }
  };
}

function collectCareerplugJsonLdPostings(companyNameForPostings, config, sourceHtml, seenUrls) {
  const jobPosting = findCareerplugJobPostingJsonLd(sourceHtml);
  if (!jobPosting) return [];
  const rawUrl =
    cleanCareerplugStructuredValue(jobPosting.url || jobPosting.sameAs) ||
    extractCareerplugDetailJobUrlFromHtml(sourceHtml);
  const absoluteUrl = normalizeCareerplugCanonicalJobUrl(rawUrl, config);
  if (!absoluteUrl || seenUrls.has(absoluteUrl)) return [];
  const fields = extractCareerplugJsonLdFieldsFromObject(jobPosting);
  const title = cleanCareerplugStructuredValue(jobPosting.title || jobPosting.name);
  if (!title) return [];
  seenUrls.add(absoluteUrl);
  return [{
    company_name: companyNameForPostings,
    source_job_id: extractSourceIdFromPostingUrl(absoluteUrl, "careerplug"),
    position_name: title,
    job_posting_url: absoluteUrl,
    posting_date: fields.posting_date || null,
    location: fields.location || null,
    city: fields.city || null,
    state: fields.state || null,
    country: fields.country || null,
    employment_type: fields.employment_type || null,
    source_evidence: {
      route_kind: "careerplug_json_ld_detail",
      title_source: "json_ld",
      title_path: "JobPosting.title/name",
      canonical_url_source: "detail_page",
      canonical_url_path: "JobPosting.url/link/form action",
      source_job_id_source: "url",
      source_job_id_path: "/jobs/:id",
      ...(fields.evidence || {})
    }
  }];
}

function parseCareerplugPostingsFromHtml(companyNameForPostings, config, pageHtml) {
  const source = String(pageHtml || "");
  const postings = [];
  const seenUrls = new Set();
  postings.push(...collectCareerplugJsonLdPostings(companyNameForPostings, config, source, seenUrls));

  const rowPattern = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  const hrefPattern = /\bhref=["'](\/jobs\/\d+(?:[?#][^"']*)?)["']/i;
  const titlePattern = /<div[^>]*class=["'][^"']*\bjob-title\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i;
  const locationPattern = /<div[^>]*class=["'][^"']*\bjob-location\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i;
  const typePattern = /<div[^>]*class=["'][^"']*\bjob-type\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i;

  let rowMatch = rowPattern.exec(source);
  while (rowMatch) {
    const attrs = String(rowMatch[1] || "");
    const href = String(attrs.match(hrefPattern)?.[1] || "").trim();
    const rowBody = String(rowMatch[2] || "");
    const rowHtml = extractCareerplugRowHtml(source, rowMatch.index) || rowMatch[0] || rowBody;
    if (!href && !titlePattern.test(rowHtml)) {
      rowMatch = rowPattern.exec(source);
      continue;
    }
    const absoluteUrl = href ? new URL(href, `${config.baseOrigin}/`).toString() : "";
    if (!absoluteUrl || seenUrls.has(absoluteUrl)) {
      rowMatch = rowPattern.exec(source);
      continue;
    }

    const title = extractCareerplugTitleFromHtml(rowHtml.match(titlePattern)?.[1] || "", attrs);
    const locationFields = careerplugListLocationFields(rowHtml.match(locationPattern)?.[1] || "");
    const jobType = normalizeCareerplugMeta(rowHtml.match(typePattern)?.[1] || "");

    postings.push({
      company_name: companyNameForPostings,
      source_job_id: extractSourceIdFromPostingUrl(absoluteUrl, "careerplug"),
      position_name: title,
      job_posting_url: absoluteUrl,
      posting_date: null,
      location: locationFields.location || null,
      city: locationFields.city || null,
      state: locationFields.state || null,
      country: locationFields.country || null,
      employment_type: jobType || null,
      source_evidence: {
        route_kind: "careerplug_jobs_html",
        title_source: "labeled_html",
        title_path: ".job-title|aria-label",
        canonical_url_source: "labeled_html",
        canonical_url_path: "a[href*='/jobs/']",
        source_job_id_source: "url",
        source_job_id_path: "/jobs/:id",
        ...(locationFields.evidence || {}),
        employment_type_source: jobType ? "labeled_html" : "",
        employment_type_path: jobType ? ".job-type" : ""
      }
    });
    seenUrls.add(absoluteUrl);
    rowMatch = rowPattern.exec(source);
  }

  return postings;
}

function shouldFetchCareerplugDetail(posting) {
  if (!posting) return false;
  if (!cleanCareerplugText(posting.posting_date)) return true;
  if (!cleanCareerplugText(posting.location) || !cleanCareerplugText(posting.country) || !cleanCareerplugText(posting.city)) return true;
  return false;
}

function careerplugDetailLimit(options = {}) {
  const value = Number(
    options.maxCareerplugDetailFetches ??
    process.env.OPENJOBSLOTS_CAREERPLUG_DETAIL_LIMIT ??
    CAREERPLUG_DEFAULT_DETAIL_LIMIT
  );
  if (!Number.isFinite(value)) return CAREERPLUG_DEFAULT_DETAIL_LIMIT;
  return Math.max(0, Math.min(250, Math.floor(value)));
}

function careerplugDetailDelayMs(options = {}) {
  const value = Number(
    options.careerplugDetailDelayMs ??
    process.env.OPENJOBSLOTS_CAREERPLUG_DETAIL_DELAY_MS ??
    CAREERPLUG_DEFAULT_DETAIL_DELAY_MS
  );
  if (!Number.isFinite(value)) return CAREERPLUG_DEFAULT_DETAIL_DELAY_MS;
  return Math.max(0, Math.min(5000, Math.floor(value)));
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchCareerplugText(url, options = {}) {
  if (typeof options.fetcher === "function") {
    const response = await options.fetcher(url, options.target || {});
    if (typeof response === "string") return { text: response, status: 200, finalUrl: url };
    if (response && typeof response === "object") {
      if (typeof response.text === "function") {
        return {
          text: await response.text(),
          status: Number(response.status || 200),
          finalUrl: response.url || url
        };
      }
      return {
        text: String(response.html || response.body || response.text || ""),
        status: Number(response.status || 200),
        finalUrl: response.url || url
      };
    }
    return { text: String(response || ""), status: 200, finalUrl: url };
  }

  const response = await safeFetch(url, {
    ...(options.fetchOptions || {}),
    headers: {
      accept: "text/html,application/xhtml+xml,application/ld+json;q=0.8,*/*;q=0.5",
      "user-agent": "OpenJobSlotsBot/1.0 (+https://openjobslots.com)",
      ...(options.fetchOptions?.headers || {})
    }
  });
  return {
    text: await readLimitedResponseText(response, { sourceUrl: response.url || url }),
    status: Number(response.status || 200),
    finalUrl: response.url || url
  };
}

function mergeCareerplugDetailPosting(listPosting, detailPosting, detailUrl) {
  if (!detailPosting) return listPosting;
  const listEvidence = listPosting.source_evidence || {};
  const detailEvidence = detailPosting.source_evidence || {};
  return {
    ...listPosting,
    position_name: listPosting.position_name || detailPosting.position_name,
    job_posting_url: listPosting.job_posting_url || detailPosting.job_posting_url,
    source_job_id: listPosting.source_job_id || detailPosting.source_job_id,
    posting_date: detailPosting.posting_date || listPosting.posting_date || null,
    location: detailPosting.location || listPosting.location || null,
    city: detailPosting.city || listPosting.city || null,
    state: detailPosting.state || listPosting.state || null,
    country: detailPosting.country || listPosting.country || null,
    employment_type: listPosting.employment_type || detailPosting.employment_type || null,
    source_evidence: {
      ...listEvidence,
      ...detailEvidence,
      route_kind: "careerplug_jobs_html_with_json_ld_detail",
      detail_url: detailUrl || detailEvidence.detail_url || "",
      list_location_source: listEvidence.location_source || "",
      list_location_path: listEvidence.location_path || "",
      list_location_rule_name: listEvidence.location_rule_name || ""
    }
  };
}

async function fetchList(company = {}, options = {}) {
  const companyName = cleanCareerplugText(company.company_name || company.companyName || company.name);
  const boardUrl = cleanCareerplugText(company.url_string || company.company_url || company.url).replace(/\/$/, "");
  if (!boardUrl) {
    return {
      __legacyParsed: [],
      html: "",
      detail_fetch_count: 0,
      __sourceConfig: { baseOrigin: "" }
    };
  }
  const parsedBoard = new URL(boardUrl);
  const config = {
    baseOrigin: parsedBoard ? parsedBoard.origin : ""
  };
  const list = await fetchCareerplugText(boardUrl, options);
  if (list.status >= 400) {
    const error = new Error(`careerplug public jobs route failed with HTTP ${list.status}`);
    error.status = list.status;
    error.url = list.finalUrl || boardUrl;
    throw error;
  }
  const listPostings = parseCareerplugPostingsFromHtml(companyName, config, list.text);
  const maxDetails = careerplugDetailLimit(options);
  const detailDelayMs = typeof options.fetcher === "function" ? 0 : careerplugDetailDelayMs(options);
  let detailFetches = 0;
  const enriched = [];

  for (const posting of listPostings) {
    if (!shouldFetchCareerplugDetail(posting) || detailFetches >= maxDetails) {
      enriched.push(posting);
      continue;
    }
    detailFetches += 1;
    try {
      if (detailFetches > 1 && detailDelayMs > 0) await delay(detailDelayMs);
      const detailUrl = normalizeCareerplugCanonicalJobUrl(posting.job_posting_url, config);
      const detail = await fetchCareerplugText(detailUrl, options);
      if (detail.status >= 400) {
        enriched.push({
          ...posting,
          source_failure_reasons: [
            ...(posting.source_failure_reasons || []),
            detail.status === 404 || detail.status === 410 ? "detail_404_or_410" : "detail_fetch_failed"
          ]
        });
        continue;
      }
      const detailParsed = parseCareerplugPostingsFromHtml(companyName, config, detail.text)
        .find((item) => item.source_job_id === posting.source_job_id) || null;
      enriched.push(mergeCareerplugDetailPosting(posting, detailParsed, detail.finalUrl || detailUrl));
    } catch (error) {
      enriched.push({
        ...posting,
        source_failure_reasons: [
          ...(posting.source_failure_reasons || []),
          error.status === 404 || error.status === 410 ? "detail_404_or_410" : "detail_fetch_failed"
        ]
      });
    }
  }

  return {
    __legacyParsed: enriched,
    html: list.text,
    detail_fetch_count: detailFetches,
    __sourceConfig: config
  };
}


module.exports = {
  fetchList,
  parseCareerplugPostingsFromHtml
};
