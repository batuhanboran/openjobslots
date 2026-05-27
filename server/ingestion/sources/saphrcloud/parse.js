"use strict";

const { decodeHtmlEntities } = require("../../parsers/shared/html");

function cleanSapHrCloudText(value) {
  if (value && typeof value === "object") {
    return cleanSapHrCloudText(
      value.value ||
        value.label ||
        value.name ||
        value.defaultValue ||
        value.localizedValue ||
        value.externalName ||
        ""
    );
  }
  return decodeHtmlEntities(String(value || "").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .replace(/\s*,\s*/g, ", ")
    .trim();
}

function firstSapHrCloudTextValue(value) {
  if (Array.isArray(value)) {
    for (const entry of value) {
      const cleaned = cleanSapHrCloudText(entry);
      if (cleaned) return cleaned;
    }
    return "";
  }
  return cleanSapHrCloudText(value);
}

function buildSapHrCloudJobUrl(config, item = {}, locale = "en_US") {
  const id = cleanSapHrCloudText(item?.id || "");
  if (!id) return "";

  const slugSourceRaw =
    cleanSapHrCloudText(item?.unifiedUrlTitle || "") ||
    cleanSapHrCloudText(item?.urlTitle || "") ||
    cleanSapHrCloudText(item?.unifiedStandardTitle || "") ||
    "untitled";
  let slugSource = slugSourceRaw;
  try {
    slugSource = decodeURIComponent(slugSourceRaw);
  } catch {
    slugSource = slugSourceRaw;
  }
  const slug = encodeURIComponent(
    String(slugSource || "")
      .replace(/[\\/]+/g, "-")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") || "untitled"
  );
  const localeValue = String(locale || config?.localeFromUrl || "en_US").trim() || "en_US";
  return `${config.baseOrigin}/job/${slug}/${encodeURIComponent(id)}-${encodeURIComponent(localeValue)}`;
}

function parseSapHrCloudPostingsFromApi(companyNameForPostings, config, responseJson, locale = "en_US") {
  const jobSearchResult = Array.isArray(responseJson?.jobSearchResult) ? responseJson.jobSearchResult : [];
  const postings = [];
  const seenUrls = new Set();

  for (const rawItem of jobSearchResult) {
    const item =
      rawItem && typeof rawItem === "object"
        ? rawItem.response && typeof rawItem.response === "object"
          ? rawItem.response
          : rawItem
        : {};

    const absoluteUrlRaw = String(item?.jobUrl || item?.url || item?.applyUrl || "").trim();
    const jobUrl = absoluteUrlRaw
      ? new URL(absoluteUrlRaw, `${config.baseOrigin}/`).toString()
      : buildSapHrCloudJobUrl(config, item, locale);
    if (!jobUrl || seenUrls.has(jobUrl)) continue;

    const locationFromCoordinates = Array.isArray(item?.jobLocationShortWithCoordinates)
      ? firstSapHrCloudTextValue(item.jobLocationShortWithCoordinates.map((entry) => entry?.value))
      : "";
    const location =
      firstSapHrCloudTextValue(item?.jobLocationShort) ||
      locationFromCoordinates ||
      firstSapHrCloudTextValue(item?.jobLocationState) ||
      firstSapHrCloudTextValue(item?.jobLocationCountry) ||
      null;
    const department =
      firstSapHrCloudTextValue(item?.filter8) ||
      firstSapHrCloudTextValue(item?.filter2) ||
      firstSapHrCloudTextValue(item?.businessUnit_obj) ||
      null;
    const postingDate =
      cleanSapHrCloudText(
        item?.unifiedStandardStart || item?.postedDate || item?.publishDate || item?.startDate || ""
      ) || null;

    postings.push({
      company_name: companyNameForPostings,
      source_job_id: cleanSapHrCloudText(item?.id || "") || undefined,
      id: cleanSapHrCloudText(item?.id || "") || undefined,
      position_name:
        cleanSapHrCloudText(item?.unifiedStandardTitle || item?.title || item?.urlTitle || "") || "Untitled Position",
      job_posting_url: jobUrl,
      posting_date: postingDate,
      location,
      department
    });
    seenUrls.add(jobUrl);
  }

  return postings;
}

function parseSapHrCloudPostingsFromHtml(companyNameForPostings, config, pageHtml, finalUrl = "") {
  const sourceHtml = String(pageHtml || "");
  if (!sourceHtml) return [];

  const postings = [];
  const seenUrls = new Set();
  const baseForUrls = String(finalUrl || config?.baseOrigin || "").trim() || String(config?.baseOrigin || "").trim();
  if (!baseForUrls) return [];

  const titleLinkPattern = /<a[^>]*class="[^"]*\bjobTitle-link\b[^"]*"[^>]*href="(?<href>[^"]+)"[^>]*>(?<title>[\s\S]*?)<\/a>/gi;

  for (const match of sourceHtml.matchAll(titleLinkPattern)) {
    const href = cleanSapHrCloudText(match?.groups?.href || "");
    const title = cleanSapHrCloudText(match?.groups?.title || "") || "Untitled Position";
    if (!href) continue;

    let jobUrl = "";
    try {
      jobUrl = new URL(href, baseForUrls).toString();
    } catch {
      jobUrl = "";
    }
    if (!jobUrl || seenUrls.has(jobUrl)) continue;
    const sourceIdMatch = jobUrl.match(/\/job\/[^/]+\/(?<id>[^/?#]+?)(?:-[a-z]{2}_[A-Z]{2})?(?:[?#]|$)/);
    const sourceJobId = cleanSapHrCloudText(sourceIdMatch?.groups?.id || "");

    const startIndex = Math.max(0, Number(match.index || 0) - 600);
    const endIndex = Math.min(sourceHtml.length, Number(match.index || 0) + String(match[0] || "").length + 1500);
    const context = sourceHtml.slice(startIndex, endIndex);

    const locationMatch =
      context.match(
        /<(?:span|div)[^>]*class="[^"]*\bjobLocation\b[^"]*"[^>]*>(?<value>[\s\S]*?)<\/(?:span|div)>/i
      ) ||
      context.match(/<div[^>]*id="job-\d+-desktop-section-city-value"[^>]*>(?<value>[\s\S]*?)<\/div>/i);
    const dateMatch = context.match(/<span[^>]*class="[^"]*\bjobDate\b[^"]*"[^>]*>(?<value>[\s\S]*?)<\/span>/i);
    const departmentMatch = context.match(
      /<span[^>]*class="[^"]*\bjobDepartment\b[^"]*"[^>]*>(?<value>[\s\S]*?)<\/span>/i
    );

    const location = cleanSapHrCloudText(locationMatch?.groups?.value || "") || null;
    const postingDate = cleanSapHrCloudText(dateMatch?.groups?.value || "") || null;
    const department = cleanSapHrCloudText(departmentMatch?.groups?.value || "") || null;

    postings.push({
      company_name: companyNameForPostings,
      source_job_id: sourceJobId || undefined,
      id: sourceJobId || undefined,
      position_name: title,
      job_posting_url: jobUrl,
      posting_date: postingDate,
      location,
      department
    });
    seenUrls.add(jobUrl);
  }

  return postings;
}

module.exports = {
  parseSapHrCloudPostingsFromApi,
  parseSapHrCloudPostingsFromHtml
};
