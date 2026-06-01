"use strict";

const { decodeHtmlEntities, extractJsonLdObjectsFromHtml } = require("../../parsers/shared/html");
const { normalizeCountryName } = require("../../posting");

function parseUrl(urlString) {
  if (!urlString) return null;
  try {
    return new URL(String(urlString || ""));
  } catch {
    return null;
  }
}

function cleanTalentlyftText(value) {
  return decodeHtmlEntities(String(value || "").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function cleanTalentlyftStructuredValue(value) {
  if (Array.isArray(value)) {
    return value.map(cleanTalentlyftStructuredValue).filter(Boolean).join(", ");
  }
  if (value && typeof value === "object") {
    return cleanTalentlyftStructuredValue(value.name || value.value || value["@id"]);
  }
  return cleanTalentlyftText(value);
}

function findTalentlyftJobPostingJsonLd(sourceHtml) {
  return extractJsonLdObjectsFromHtml(sourceHtml).find((item) => {
    const type = item?.["@type"];
    return Array.isArray(type)
      ? type.some((value) => String(value || "").toLowerCase() === "jobposting")
      : String(type || "").toLowerCase() === "jobposting";
  }) || null;
}

function extractTalentlyftRemoteTypeFromValue(value) {
  const text = cleanTalentlyftStructuredValue(value).toLowerCase();
  if (!text) return "";
  if (/\bhybrid\b/.test(text)) return "hybrid";
  if (/\b(remote|telecommute|work from home|wfh|virtual)\b/.test(text)) return "remote";
  if (/\b(on[-\s]?site|onsite|in[-\s]?person|office)\b/.test(text)) return "onsite";
  return "";
}

function extractTalentlyftJsonLdFields(detailHtml) {
  const jobPosting = findTalentlyftJobPostingJsonLd(detailHtml);
  if (!jobPosting) return {};
  const locations = Array.isArray(jobPosting.jobLocation)
    ? jobPosting.jobLocation
    : jobPosting.jobLocation
      ? [jobPosting.jobLocation]
      : [];
  let address = {};
  for (const location of locations) {
    if (location?.address && typeof location.address === "object") {
      address = location.address;
      break;
    }
  }

  const city = cleanTalentlyftStructuredValue(address.addressLocality);
  const state = cleanTalentlyftStructuredValue(address.addressRegion);
  const countryRaw = cleanTalentlyftStructuredValue(address.addressCountry);
  const country = normalizeCountryName(countryRaw) || countryRaw;
  const datePosted = cleanTalentlyftStructuredValue(jobPosting.datePosted);
  const employmentType = Array.isArray(jobPosting.employmentType)
    ? jobPosting.employmentType.map(cleanTalentlyftStructuredValue).filter(Boolean).join(", ")
    : cleanTalentlyftStructuredValue(jobPosting.employmentType);
  const remoteType = extractTalentlyftRemoteTypeFromValue(jobPosting.jobLocationType);
  const locationParts = [city, city ? state : "", country].filter(Boolean);

  return {
    location: locationParts.length > 0 ? locationParts.join(", ") : "",
    city,
    state,
    country,
    posting_date: datePosted,
    employment_type: employmentType,
    remote_type: remoteType,
    evidence: {
      location_source: locationParts.length > 0 ? "json_ld" : "",
      location_path: locationParts.length > 0 ? "script[type='application/ld+json'].jobLocation.address" : "",
      city_source: city ? "json_ld" : "",
      city_path: city ? "script[type='application/ld+json'].jobLocation.address.addressLocality" : "",
      region_source: state ? "json_ld" : "",
      region_path: state ? "script[type='application/ld+json'].jobLocation.address.addressRegion" : "",
      country_source: country ? "json_ld" : "",
      country_path: country ? "script[type='application/ld+json'].jobLocation.address.addressCountry" : "",
      posting_date_source: datePosted ? "json_ld" : "",
      posting_date_path: datePosted ? "script[type='application/ld+json'].datePosted" : "",
      employment_type_source: employmentType ? "json_ld" : "",
      employment_type_path: employmentType ? "script[type='application/ld+json'].employmentType" : "",
      remote_source: remoteType ? "json_ld" : "",
      remote_path: remoteType ? "script[type='application/ld+json'].jobLocationType" : ""
    }
  };
}

function extractTalentlyftInitialConfig(pageHtml, fallbackUrl) {
  const source = String(pageHtml || "");
  const parsed = parseUrl(fallbackUrl);
  const websiteUrlDefault = parsed ? `${parsed.protocol}//${parsed.host}` : "";
  const subdomainDefault = parsed ? String(parsed.hostname || "").split(".")[0] : "";

  const pickFirst = (patterns) => {
    for (const pattern of patterns) {
      const match = source.match(pattern);
      if (match?.[1]) return String(match[1]).trim();
    }
    return "";
  };

  const layoutId = pickFirst([/layoutId\s*:\s*['"]([^'"]+)['"]/i, /layoutId\s*=\s*['"]([^'"]+)['"]/i]) || "Jobs-1";
  const themeId = pickFirst([/themeId\s*:\s*['"]([^'"]+)['"]/i, /themeId\s*=\s*['"]([^'"]+)['"]/i]) || "2";
  const language = pickFirst([/language\s*:\s*['"]([^'"]+)['"]/i, /language\s*=\s*['"]([^'"]+)['"]/i]) || "en";
  const subdomain =
    pickFirst([/subdomain\s*:\s*['"]([^'"]+)['"]/i, /subdomain\s*=\s*['"]([^'"]+)['"]/i]) || subdomainDefault;
  const websiteUrl =
    pickFirst([/websiteUrl\s*:\s*['"]([^'"]+)['"]/i, /websiteUrl\s*=\s*['"]([^'"]+)['"]/i]) || websiteUrlDefault;

  return {
    layoutId,
    themeId,
    language,
    subdomain,
    websiteUrl,
    apiUrl: websiteUrl ? `${websiteUrl}/JobList/` : ""
  };
}

function extractTalentlyftTotalPages(fragmentHtml) {
  const source = String(fragmentHtml || "");
  const matches = Array.from(source.matchAll(/data-page=['"](\d+)['"]/gi));
  const pages = matches
    .map((match) => Number(match?.[1] || 0))
    .filter((value) => Number.isFinite(value) && value > 0);
  return pages.length > 0 ? Math.max(...pages) : 1;
}

function parseTalentlyftPostingsFromFragment(companyNameForPostings, config, fragmentHtml) {
  const source = String(fragmentHtml || "");
  const postings = [];
  const seenUrls = new Set();
  const itemPattern =
    /<a[^>]*class=['"][^'"]*\bjobs__box\b[^'"]*['"][^>]*>([\s\S]*?)<\/a>/gi;

  let itemMatch = itemPattern.exec(source);
  while (itemMatch) {
    const blockHtml = String(itemMatch[0] || "");
    const bodyHtml = String(itemMatch[1] || "");

    const href = String(blockHtml.match(/\bhref=['"]([^'"]+)['"]/i)?.[1] || "").trim();
    const absoluteUrl = href ? new URL(href, `${config.baseOrigin || ""}/`).toString() : "";
    if (!absoluteUrl || seenUrls.has(absoluteUrl)) {
      itemMatch = itemPattern.exec(source);
      continue;
    }

    const id =
      String(blockHtml.match(/\bdata-job-id=['"](\d+)['"]/i)?.[1] || "").trim() ||
      String(blockHtml.match(/\bid=['"](\d+)['"]/i)?.[1] || "").trim() ||
      absoluteUrl;
    const title = cleanTalentlyftText(bodyHtml.match(/<h3[^>]*class=['"][^'"]*\bjobs__box__heading\b[^'"]*['"][^>]*>([\s\S]*?)<\/h3>/i)?.[1] || "");
    const location = cleanTalentlyftText(bodyHtml.match(/<p[^>]*class=['"][^'"]*\bjobs__box__text\b[^'"]*['"][^>]*>([\s\S]*?)<\/p>/i)?.[1] || "");

    postings.push({
      company_name: companyNameForPostings,
      position_name: title || "Untitled Position",
      job_posting_url: absoluteUrl,
      posting_date: null,
      location: location || null,
      source_job_id: id || null
    });
    seenUrls.add(absoluteUrl);
    itemMatch = itemPattern.exec(source);
  }

  return postings;
}

function canonicalTalentlyftDetailKey(urlValue) {
  try {
    const parsed = new URL(String(urlValue || ""));
    parsed.hash = "";
    return parsed.toString().replace(/\/+$/, "");
  } catch {
    return String(urlValue || "").trim().replace(/#.*$/, "").replace(/\/+$/, "");
  }
}

function lookupTalentlyftDetailMapValue(mapValue, urlValue) {
  const map = mapValue && typeof mapValue === "object" ? mapValue : {};
  const key = canonicalTalentlyftDetailKey(urlValue);
  const candidates = [
    String(urlValue || ""),
    String(urlValue || "").replace(/#.*$/, ""),
    key,
    `${key}/`
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (Object.prototype.hasOwnProperty.call(map, candidate)) return map[candidate];
  }
  return "";
}

function enrichTalentlyftPostingsWithDetailJsonLd(postings = [], detailHtmlByUrl = {}, detailStatusByUrl = {}) {
  return (Array.isArray(postings) ? postings : []).map((posting) => {
    const detailHtml = lookupTalentlyftDetailMapValue(detailHtmlByUrl, posting?.job_posting_url);
    if (!detailHtml) return posting;
    const detailFields = extractTalentlyftJsonLdFields(detailHtml);
    const evidence = detailFields.evidence || {};
    const detailStatus = Number(lookupTalentlyftDetailMapValue(detailStatusByUrl, posting?.job_posting_url) || 200);
    return {
      ...posting,
      location: posting.location || detailFields.location || null,
      city: posting.city || detailFields.city || null,
      state: posting.state || detailFields.state || null,
      country: posting.country || detailFields.country || null,
      posting_date: posting.posting_date || detailFields.posting_date || null,
      employment_type: posting.employment_type || detailFields.employment_type || null,
      remote_type: posting.remote_type && posting.remote_type !== "unknown"
        ? posting.remote_type
        : detailFields.remote_type || posting.remote_type || null,
      source_evidence: {
        ...(posting.source_evidence || {}),
        detail_url: posting.job_posting_url,
        detail_fetch_status: Number.isFinite(detailStatus) ? detailStatus : 200,
        location_source: posting.source_evidence?.location_source || evidence.location_source || "",
        location_path: posting.source_evidence?.location_path || evidence.location_path || "",
        city_source: posting.source_evidence?.city_source || evidence.city_source || "",
        city_path: posting.source_evidence?.city_path || evidence.city_path || "",
        region_source: posting.source_evidence?.region_source || evidence.region_source || "",
        region_path: posting.source_evidence?.region_path || evidence.region_path || "",
        country_source: posting.source_evidence?.country_source || evidence.country_source || "",
        country_path: posting.source_evidence?.country_path || evidence.country_path || "",
        posting_date_source: posting.source_evidence?.posting_date_source || evidence.posting_date_source || "",
        posting_date_path: posting.source_evidence?.posting_date_path || evidence.posting_date_path || "",
        employment_type_source: posting.source_evidence?.employment_type_source || evidence.employment_type_source || "",
        employment_type_path: posting.source_evidence?.employment_type_path || evidence.employment_type_path || "",
        remote_source: posting.source_evidence?.remote_source || evidence.remote_source || "",
        remote_path: posting.source_evidence?.remote_path || evidence.remote_path || ""
      }
    };
  });
}

module.exports = {
  enrichTalentlyftPostingsWithDetailJsonLd,
  extractTalentlyftJsonLdFields,
  extractTalentlyftInitialConfig,
  extractTalentlyftTotalPages,
  parseTalentlyftPostingsFromFragment
};
