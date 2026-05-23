"use strict";

const { decodeHtmlEntities } = require("../../parsers/shared/html");
const { isPlaceholderCompanyName } = require("../../posting");

function parseUrl(urlString) {
  if (!urlString) return null;
  try {
    return new URL(urlString);
  } catch {
    return null;
  }
}

function cleanAdpWorkforcenowText(value) {
  let text = String(value || "");
  try {
    text = decodeURIComponent(text);
  } catch {
    // Keep undecoded value when malformed.
  }
  return decodeHtmlEntities(text.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function slugToAdpWorkforcenowCompanyName(slug) {
  const cleaned = String(slug || "").trim().replace(/^[-_]+|[-_]+$/g, "");
  if (!cleaned) return "";
  const normalized = cleaned
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .trim();
  if (!normalized) return "";
  return normalized
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => (part === part.toUpperCase() && part.length <= 5 ? part : part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()))
    .join(" ");
}

function extractAdpWorkforcenowCompanyName(contentLinksJson) {
  const contentLinks = Array.isArray(contentLinksJson?.contentLinks) ? contentLinksJson.contentLinks : [];

  const parseWelcomeName = (rawText) => {
    const source = cleanAdpWorkforcenowText(rawText);
    const patterns = [
      /(?:career\s+center|career\s+portal|careers?)\s+for\s+(.{2,120}?)(?:[,.]|$)/i,
      /\bfor\s+(.{2,120}?)\s+(?:career\s+center|career\s+portal|careers?\b)/i,
      /welcome\s+to\s+(?:the\s+)?(.{2,120}?)\s+(?:career\s+center|career\s+portal|careers?\b|job\s+portal)/i,
      /choose\s+a\s+career\s+at\s+(.{2,120}?)(?:[,.]|$)/i
    ];
    for (const pattern of patterns) {
      const match = source.match(pattern);
      if (!match?.[1]) continue;
      let candidate = cleanAdpWorkforcenowText(match[1]);
      candidate = candidate
        .replace(/\b(career\s+center|career\s+portal|careers?\s+portal)\b/gi, " ")
        .replace(/\s+/g, " ")
        .trim()
        .replace(/^[-:|,\s]+|[-:|,\s]+$/g, "");
      candidate = candidate.split(/\b(choose\s+a\s+career\s+at|welcome\s+to|if\s+you\s+are|where\s+|our\s+|we\s+)/i)[0]?.trim() || "";
      if (candidate && !["our", "you", "we"].includes(candidate.toLowerCase())) {
        return candidate;
      }
    }
    return "";
  };

  for (const item of contentLinks) {
    const code = String(item?.linkTypeCode?.codeValue || "").trim();
    if (code !== "WELCOME-TXT") continue;
    const parsed = parseWelcomeName(String(item?.linkTypeCode?.longName || ""));
    if (parsed) return parsed;
  }

  for (const item of contentLinks) {
    const code = String(item?.linkTypeCode?.codeValue || "").trim();
    if (code !== "LINKS-BRND") continue;
    const links = Array.isArray(item?.contentBody?.links) ? item.contentBody.links : [];
    for (const link of links) {
      const title = cleanAdpWorkforcenowText(link?.title || "");
      const href = cleanAdpWorkforcenowText(link?.href || "");
      if (title && !["careers", "career", "home", "jobs", "apply"].includes(title.toLowerCase())) {
        return title;
      }
      if (href && !href.includes("workforcenow.adp.com") && !href.includes("jobs/apply/posting.html")) {
        const hrefWithScheme = href.includes("://") ? href : `https://${href}`;
        const parsed = parseUrl(hrefWithScheme);
        const host = String(parsed?.hostname || "").replace(/^www\./i, "").toLowerCase();
        if (host) {
          const derived = slugToAdpWorkforcenowCompanyName(host.split(".")[0] || "");
          if (derived) return derived;
        }
      }
    }
  }

  for (const item of contentLinks) {
    const code = String(item?.linkTypeCode?.codeValue || "").trim();
    if (code !== "IMG_LOGO") continue;
    const body = item?.contentBody && typeof item.contentBody === "object" ? item.contentBody : {};
    const links = Array.isArray(body?.links) ? body.links : [];
    let logoTitle = "";
    for (const link of links) {
      logoTitle = cleanAdpWorkforcenowText(link?.title || "");
      if (logoTitle) break;
    }
    if (!logoTitle) {
      logoTitle = cleanAdpWorkforcenowText(body?.contentTitle || "");
    }
    logoTitle = logoTitle
      .replace(/\.(png|jpg|jpeg|gif|svg|webp)$/i, "")
      .replace(/\b(logo|careers?|career|center|portal|hris|adp|v\d+)\b/gi, " ")
      .replace(/[_-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/^[-:|,\s]+|[-:|,\s]+$/g, "");
    if (logoTitle.length >= 3) return logoTitle;
  }

  for (const item of contentLinks) {
    const links = Array.isArray(item?.contentBody?.links) ? item.contentBody.links : [];
    for (const link of links) {
      const href = cleanAdpWorkforcenowText(link?.href || "");
      if (!href.includes("jobs/apply/posting.html")) continue;
      const parsed = parseUrl(href);
      const clientSlug = String(parsed?.searchParams?.get("client") || "").trim();
      const derived = slugToAdpWorkforcenowCompanyName(clientSlug);
      if (derived) return derived;
    }
  }

  return "";
}

function normalizeAdpWorkforcenowSourceCompanyName(value) {
  const cleaned = cleanAdpWorkforcenowText(value);
  return cleaned && !isPlaceholderCompanyName(cleaned) ? cleaned : "";
}

function resolveAdpWorkforcenowCompanyName(company, config, contentLinksJson) {
  const sourceCompanyName = normalizeAdpWorkforcenowSourceCompanyName(company?.company_name);
  if (sourceCompanyName) return sourceCompanyName;

  const inferredCompanyName = normalizeAdpWorkforcenowSourceCompanyName(
    extractAdpWorkforcenowCompanyName(contentLinksJson)
  );
  if (inferredCompanyName) return inferredCompanyName;

  const ccIdCompanyName = normalizeAdpWorkforcenowSourceCompanyName(
    slugToAdpWorkforcenowCompanyName(config?.ccId)
  );
  if (ccIdCompanyName) return ccIdCompanyName;

  return "";
}

function extractAdpWorkforcenowLocation(job) {
  const item = job && typeof job === "object" ? job : {};
  const values = [];
  const seen = new Set();
  const locations = Array.isArray(item?.requisitionLocations) ? item.requisitionLocations : [];
  for (const locationItem of locations) {
    const location = locationItem && typeof locationItem === "object" ? locationItem : {};
    const nameCode = location?.nameCode && typeof location.nameCode === "object" ? location.nameCode : {};
    const label = String(nameCode?.shortName || nameCode?.longName || "").trim();
    const address = location?.address && typeof location.address === "object" ? location.address : {};
    const city = String(address?.cityName || "").trim();
    const stateData =
      address?.countrySubdivisionLevel1 && typeof address.countrySubdivisionLevel1 === "object"
        ? address.countrySubdivisionLevel1
        : {};
    const state = String(stateData?.codeValue || stateData?.longName || "").trim();
    const countryData = address?.country && typeof address.country === "object" ? address.country : {};
    const country = String(countryData?.codeValue || countryData?.longName || "").trim();
    const addressLabel = [city, state, country].filter(Boolean).join(", ");
    const combined = [label, addressLabel].filter(Boolean).join(" - ").trim();
    const normalized = combined.toLowerCase();
    if (!combined || seen.has(normalized)) continue;
    seen.add(normalized);
    values.push(combined);
  }
  return values.length > 0 ? values.join(" / ") : null;
}

function extractAdpWorkforcenowStructuredLocation(job) {
  const item = job && typeof job === "object" ? job : {};
  const locations = Array.isArray(item?.requisitionLocations) ? item.requisitionLocations : [];
  const location = locations[0] && typeof locations[0] === "object" ? locations[0] : {};
  const address = location?.address && typeof location.address === "object" ? location.address : {};
  const stateData =
    address?.countrySubdivisionLevel1 && typeof address.countrySubdivisionLevel1 === "object"
      ? address.countrySubdivisionLevel1
      : {};
  const countryData = address?.country && typeof address.country === "object" ? address.country : {};
  return {
    city: String(address?.cityName || "").trim(),
    state: String(stateData?.codeValue || stateData?.longName || "").trim(),
    country: String(countryData?.longName || countryData?.codeValue || "").trim()
  };
}

function buildAdpWorkforcenowPostingUrl(item, config) {
  const job = item && typeof item === "object" ? item : {};
  const links = Array.isArray(job?.links) ? job.links : [];
  for (const link of links) {
    const href = String(link?.href || "").trim();
    if (!href) continue;
    const absolute = parseUrl(href) ? href : new URL(href, config.boardUrl).toString();
    if (absolute) return absolute;
  }
  const itemId = String(job?.itemID || "").trim();
  if (itemId) {
    return `${config.boardUrl}&jobId=${encodeURIComponent(itemId)}`;
  }
  return config.boardUrl;
}

function parseAdpWorkforcenowPostingsFromApi(companyNameForPostings, config, responseJson) {
  const jobs = Array.isArray(responseJson?.jobRequisitions) ? responseJson.jobRequisitions : [];
  const postings = [];
  const seenUrls = new Set();
  const seenIds = new Set();
  const effectiveCompanyName =
    normalizeAdpWorkforcenowSourceCompanyName(companyNameForPostings) ||
    normalizeAdpWorkforcenowSourceCompanyName(slugToAdpWorkforcenowCompanyName(config?.ccId));

  for (const row of jobs) {
    const item = row && typeof row === "object" ? row : {};
    const itemId = String(item?.itemID || "").trim();
    if (itemId && seenIds.has(itemId)) continue;

    const jobUrl = buildAdpWorkforcenowPostingUrl(item, config);
    if (!jobUrl || seenUrls.has(jobUrl)) continue;
    const structuredLocation = extractAdpWorkforcenowStructuredLocation(item);

    postings.push({
      company_name: effectiveCompanyName,
      source_job_id: itemId || undefined,
      id: itemId || undefined,
      position_name: String(item?.requisitionTitle || "").trim() || "Untitled Position",
      job_posting_url: jobUrl,
      posting_date: String(item?.postDate || "").trim() || null,
      location: extractAdpWorkforcenowLocation(item),
      city: structuredLocation.city || null,
      state: structuredLocation.state || null,
      country: structuredLocation.country || null,
      employment_type: String(item?.workLevelCode?.shortName || "").trim() || null,
      department: null
    });
    seenUrls.add(jobUrl);
    if (itemId) seenIds.add(itemId);
  }

  return postings;
}

module.exports = {
  extractAdpWorkforcenowCompanyName,
  parseAdpWorkforcenowPostingsFromApi,
  resolveAdpWorkforcenowCompanyName
};
