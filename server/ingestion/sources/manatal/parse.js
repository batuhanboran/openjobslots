"use strict";

const { decodeHtmlEntities } = require("../../parsers/shared/html");
const { normalizeExplicitRemoteValue } = require("../../parsers/shared/remote");
const { extractSourceIdFromPostingUrl } = require("../../parsers/shared/sourceIds");

function parseUrl(urlString) {
  try {
    return new URL(String(urlString || ""));
  } catch {
    return null;
  }
}

function cleanManatalText(value) {
  return decodeHtmlEntities(String(value || "").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function extractManatalPageRuntimeConfig(pageHtml, fallbackConfig, finalUrl = "") {
  const source = String(pageHtml || "");
  const fallback = fallbackConfig && typeof fallbackConfig === "object" ? fallbackConfig : {};

  const baseUrlRaw = String(source.match(/const\s+baseUrl\s*=\s*['"]([^'"]+)['"]/i)?.[1] || "").trim();
  const publicBaseUrl = (baseUrlRaw || String(fallback.publicBaseUrl || "https://www.careers-page.com")).replace(
    /\/+$/,
    ""
  );

  const slugCandidates = [];
  const candidatePatterns = [
    /const\s+clientSlug\s*=\s*['"]([^'"]+)['"]/i,
    /data-domain_slug\s*=\s*['"]([^'"]+)['"]/i,
    /<a[^>]*class=['"][^'"]*\bnavbar-brand\b[^'"]*['"][^>]*href=['"]\/([^\/"'?#]+)/i,
    /<meta[^>]*property=['"]og:type['"][^>]*content=['"]\s*([^|'"]+?)\s*\|/i
  ];
  for (const pattern of candidatePatterns) {
    const value = String(source.match(pattern)?.[1] || "").trim();
    if (value) slugCandidates.push(value);
  }

  const finalParsed = parseUrl(finalUrl) || parseUrl(String(fallback.careersUrl || fallback.boardUrl || ""));
  const finalHost = String(finalParsed?.hostname || fallback.host || "").toLowerCase();
  if (finalHost.endsWith(".careers-page.com") && finalHost !== "www.careers-page.com") {
    const hostSubdomain = String(finalHost.split(".")[0] || "").trim();
    if (hostSubdomain) slugCandidates.push(hostSubdomain);
  }

  if (fallback.domainSlug) slugCandidates.push(String(fallback.domainSlug));

  let domainSlug = "";
  for (const candidate of slugCandidates) {
    const normalized = String(candidate || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9\-_.]/gi, "");
    if (!normalized || normalized === "job" || normalized === "jobs" || normalized === "www") continue;
    domainSlug = normalized;
    break;
  }

  const protocol = String(finalParsed?.protocol || "https:");
  const hostWithPort = String(finalParsed?.host || fallback.host || "www.careers-page.com");
  const boardUrl =
    finalHost === "www.careers-page.com"
      ? `${protocol}//${hostWithPort}/${domainSlug || String(fallback.domainSlug || "").toLowerCase()}/`
      : finalHost.endsWith(".careers-page.com")
        ? `${protocol}//${hostWithPort}/`
        : String(fallback.boardUrl || "");

  const resolvedSlug = domainSlug || String(fallback.domainSlug || "").toLowerCase();

  return {
    ...fallback,
    host: finalHost || String(fallback.host || "").toLowerCase(),
    domainSlug: resolvedSlug,
    domainSlugLower: resolvedSlug,
    publicBaseUrl: publicBaseUrl || "https://www.careers-page.com",
    boardUrl: boardUrl || String(fallback.boardUrl || ""),
    careersUrl: boardUrl || String(fallback.careersUrl || ""),
    jobsApiUrl: resolvedSlug
      ? `${publicBaseUrl || "https://www.careers-page.com"}/api/v1.0/c/${encodeURIComponent(resolvedSlug)}/jobs/`
      : String(fallback.jobsApiUrl || "")
  };
}

function buildManatalJobPostingUrl(config, item) {
  const posting = item && typeof item === "object" ? item : {};

  for (const key of ["url", "job_url", "apply_url", "public_url"]) {
    const raw = String(posting?.[key] || "").trim();
    if (!raw) continue;
    try {
      return new URL(raw, `${String(config?.boardUrl || config?.baseOrigin || "").replace(/\/+$/, "")}/`).toString();
    } catch {
      continue;
    }
  }

  const hash = String(posting?.hash || "").trim();
  const domainSlug = String(config?.domainSlug || "").trim();
  const publicBaseUrl = String(config?.publicBaseUrl || "https://www.careers-page.com").replace(/\/+$/, "");
  if (hash && domainSlug) {
    return `${publicBaseUrl}/${domainSlug}/job/${encodeURIComponent(hash)}`;
  }

  return "";
}

function parseManatalPostingsFromApi(companyNameForPostings, config, responseJson) {
  const results = Array.isArray(responseJson?.results) ? responseJson.results : [];
  const postings = [];
  const seenUrls = new Set();

  for (const job of results) {
    const item = job && typeof job === "object" ? job : {};
    const jobUrl = buildManatalJobPostingUrl(config, item);
    if (!jobUrl || seenUrls.has(jobUrl)) continue;

    const locationDisplay = cleanManatalText(item?.location_display || "");
    const city = cleanManatalText(item?.city || "");
    const state = cleanManatalText(item?.state || "");
    const country = cleanManatalText(item?.country || "");
    const locationParts = [city, state, country].filter(Boolean);
    const location = locationDisplay || locationParts.join(", ");
    const descriptionHtml = String(item?.description || "").trim();
    const department = cleanManatalText(
      item?.organization_name ||
      item?.department ||
      item?.department_name ||
      item?.team ||
      item?.job?.department?.name ||
      ""
    );
    const employmentType = cleanManatalText(
      item?.employment_type ||
      item?.employmentType ||
      item?.job_type ||
      item?.jobType ||
      item?.contract_type ||
      item?.work_type ||
      item?.type ||
      ""
    );
    const remoteType = normalizeExplicitRemoteValue([
      item?.remote === true || item?.is_remote === true ? "remote" : "",
      item?.workplace_type,
      item?.location_type,
      item?.remote_status,
      item?.position_name,
      location,
      descriptionHtml
    ].filter(Boolean).join(" "));

    let postingDate = null;
    for (const dateField of [
      "last_published_at",
      "published_at",
      "posting_date",
      "posted_date",
      "updated_at",
      "created_at"
    ]) {
      const candidate = cleanManatalText(item?.[dateField] || "");
      if (!candidate) continue;
      postingDate = candidate;
      break;
    }

    postings.push({
      company_name: companyNameForPostings,
      source_job_id: extractSourceIdFromPostingUrl(jobUrl, "manatal") || String(item?.id ?? item?.hash ?? "").trim(),
      id: String(item?.id ?? item?.hash ?? "").trim() || undefined,
      position_name: cleanManatalText(item?.position_name || item?.title || ""),
      job_posting_url: jobUrl,
      posting_date: postingDate,
      location: location || null,
      city: city || null,
      state: state || null,
      country: country || null,
      remote_type: remoteType || null,
      department: department || null,
      employment_type: employmentType || null,
      description_html: descriptionHtml || null,
      description_plain: cleanManatalText(descriptionHtml) || null
    });
    seenUrls.add(jobUrl);
  }

  return postings;
}

function parseManatalPostingsFromHtml(companyNameForPostings, config, pageHtml) {
  const source = String(pageHtml || "");
  const postings = [];
  const seenUrls = new Set();

  const cardPattern = /<article[^>]*class=['"][^'"]*\bjob-card\b[^'"]*['"][^>]*>([\s\S]*?)<\/article>/gi;
  let cardMatch = cardPattern.exec(source);
  while (cardMatch) {
    const cardHtml = String(cardMatch[1] || "");
    const href = String(
      cardHtml.match(/<a[^>]*class=['"][^'"]*\bjob-title-link\b[^'"]*['"][^>]*href=['"]([^'"]+)['"]/i)?.[1] || ""
    ).trim();
    const title = cleanManatalText(
      cardHtml.match(/<h[1-6][^>]*class=['"][^'"]*\bjob-title\b[^'"]*['"][^>]*>([\s\S]*?)<\/h[1-6]>/i)?.[1] || ""
    );
    const looksLikeTemplateHref =
      /^getJobUrl\s*\(/i.test(href) ||
      href.includes("[[") ||
      href.includes("]]") ||
      href.includes("{{") ||
      href.includes("}}");
    const looksLikeTemplateTitle = title.includes("[[") || title.includes("]]");
    if (!href || !title || looksLikeTemplateHref || looksLikeTemplateTitle) {
      cardMatch = cardPattern.exec(source);
      continue;
    }

    let jobUrl = "";
    try {
      jobUrl = new URL(href, `${String(config?.boardUrl || config?.baseOrigin || "").replace(/\/+$/, "")}/`).toString();
    } catch {
      cardMatch = cardPattern.exec(source);
      continue;
    }
    if (!jobUrl || seenUrls.has(jobUrl)) {
      cardMatch = cardPattern.exec(source);
      continue;
    }

    const location = cleanManatalText(cardHtml.match(/<li[^>]*>[\s\S]*?<span>\s*([\s\S]*?)\s*<\/span>\s*<\/li>/i)?.[1] || "");
    postings.push({
      company_name: companyNameForPostings,
      source_job_id: extractSourceIdFromPostingUrl(jobUrl, "manatal"),
      position_name: title || "Untitled Position",
      job_posting_url: jobUrl,
      posting_date: null,
      location: location || null,
      remote_type: normalizeExplicitRemoteValue([title, location].filter(Boolean).join(" ")) || null,
      department: null
    });
    seenUrls.add(jobUrl);
    cardMatch = cardPattern.exec(source);
  }

  if (postings.length > 0) return postings;

  const oldItemPattern = /<li[^>]*class=['"][^'"]*\bmedia\b[^'"]*['"][^>]*>([\s\S]*?)<\/li>/gi;
  let oldItemMatch = oldItemPattern.exec(source);
  while (oldItemMatch) {
    const itemHtml = String(oldItemMatch[1] || "");
    const href = String(itemHtml.match(/<a[^>]*href=['"]([^'"]+)['"][^>]*>/i)?.[1] || "").trim();
    const title = cleanManatalText(
      itemHtml.match(/<h[1-6][^>]*class=['"][^'"]*\bjob-position-break\b[^'"]*['"][^>]*>([\s\S]*?)<\/h[1-6]>/i)?.[1] || ""
    );
    const looksLikeTemplateHref =
      /^getJobUrl\s*\(/i.test(href) ||
      href.includes("[[") ||
      href.includes("]]") ||
      href.includes("{{") ||
      href.includes("}}");
    const looksLikeTemplateTitle = title.includes("[[") || title.includes("]]");
    if (!href || !title || looksLikeTemplateHref || looksLikeTemplateTitle) {
      oldItemMatch = oldItemPattern.exec(source);
      continue;
    }

    let jobUrl = "";
    try {
      jobUrl = new URL(href, `${String(config?.boardUrl || config?.baseOrigin || "").replace(/\/+$/, "")}/`).toString();
    } catch {
      oldItemMatch = oldItemPattern.exec(source);
      continue;
    }
    if (!jobUrl || seenUrls.has(jobUrl)) {
      oldItemMatch = oldItemPattern.exec(source);
      continue;
    }

    const location = cleanManatalText(itemHtml.match(/fa-map-marker-alt[^<]*<\/i>\s*([\s\S]*?)<\/span>/i)?.[1] || "");
    const department = cleanManatalText(itemHtml.match(/fa-building[^<]*<\/i>\s*([\s\S]*?)<\/span>/i)?.[1] || "");

    postings.push({
      company_name: companyNameForPostings,
      source_job_id: extractSourceIdFromPostingUrl(jobUrl, "manatal"),
      position_name: title || "Untitled Position",
      job_posting_url: jobUrl,
      posting_date: null,
      location: location || null,
      remote_type: normalizeExplicitRemoteValue([title, location].filter(Boolean).join(" ")) || null,
      department: department || null
    });
    seenUrls.add(jobUrl);
    oldItemMatch = oldItemPattern.exec(source);
  }

  return postings;
}

module.exports = {
  extractManatalPageRuntimeConfig,
  parseManatalPostingsFromApi,
  parseManatalPostingsFromHtml
};
