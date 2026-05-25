"use strict";

const { decodeHtmlEntities } = require("../../parsers/shared/html");

function extractJoinNextDataJsonFromHtml(pageHtml) {
  const source = String(pageHtml || "");
  const match = source.match(
    /<script[^>]*id=["']__NEXT_DATA__["'][^>]*>\s*(\{[\s\S]*?\})\s*<\/script>/i
  );
  if (!match?.[1]) return {};
  try {
    return JSON.parse(String(match[1] || "").trim());
  } catch {
    return {};
  }
}

function cleanJoinText(value) {
  return decodeHtmlEntities(String(value || ""))
    .replace(/\s+/g, " ")
    .replace(/\s*,\s*/g, ", ")
    .trim();
}

function buildJoinJobUrl(companySlug, idParam) {
  const slug = cleanJoinText(companySlug);
  const jobIdParam = cleanJoinText(idParam);
  if (!slug || !jobIdParam) return "";
  return `https://join.com/companies/${encodeURIComponent(slug)}/${encodeURIComponent(jobIdParam)}`;
}

function parseJoinPostingsFromNextData(companyNameForPostings, companySlug, nextData) {
  const props = nextData && typeof nextData === "object" ? nextData.props : {};
  const pageProps = props && typeof props === "object" ? props.pageProps : {};
  const initialState = pageProps && typeof pageProps === "object" ? pageProps.initialState : {};
  const jobsState = initialState && typeof initialState === "object" ? initialState.jobs : {};
  const items = Array.isArray(jobsState?.items) ? jobsState.items : [];

  const postings = [];
  const seenUrls = new Set();

  for (const job of items) {
    const item = job && typeof job === "object" ? job : {};
    const idParam = cleanJoinText(item?.idParam || "");
    const postingUrl = buildJoinJobUrl(companySlug, idParam);
    if (!postingUrl || seenUrls.has(postingUrl)) continue;

    const city = item?.city && typeof item.city === "object" ? item.city : {};
    const cityName = cleanJoinText(city?.cityName || "");
    const countryName = cleanJoinText(city?.countryName || "");
    const locationParts = [cityName, countryName].filter(Boolean);
    let location = locationParts.join(", ");

    const workplaceType = cleanJoinText(item?.workplaceType || "");
    const remoteType = cleanJoinText(item?.remoteType || "");
    if (!location && workplaceType.toUpperCase() === "REMOTE") {
      location = "Remote";
    } else if (!location && remoteType) {
      location = remoteType;
    }

    const category = item?.category && typeof item.category === "object" ? item.category : {};
    const employmentType = item?.employmentType && typeof item.employmentType === "object" ? item.employmentType : {};

    postings.push({
      company_name: companyNameForPostings,
      position_name: cleanJoinText(item?.title || "") || "Untitled Position",
      job_posting_url: postingUrl,
      source_job_id: idParam,
      posting_date: cleanJoinText(item?.createdAt || "") || null,
      location: location || null,
      remote_type: remoteType || workplaceType || null,
      department: cleanJoinText(category?.name || "") || null,
      employment_type: cleanJoinText(employmentType?.name || "") || null
    });
    seenUrls.add(postingUrl);
  }

  return postings;
}

module.exports = {
  extractJoinNextDataJsonFromHtml,
  parseJoinPostingsFromNextData
};
