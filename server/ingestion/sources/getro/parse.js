"use strict";

function extractGetroNextDataJsonFromHtml(pageHtml) {
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

function parseGetroPostingsFromHtml(companyNameForPostings, _config, pageHtml) {
  const nextData = extractGetroNextDataJsonFromHtml(pageHtml);
  const pageProps = nextData?.props?.pageProps && typeof nextData.props.pageProps === "object"
    ? nextData.props.pageProps
    : {};
  const initialState = pageProps?.initialState && typeof pageProps.initialState === "object"
    ? pageProps.initialState
    : {};
  const jobsState = initialState?.jobs && typeof initialState.jobs === "object"
    ? initialState.jobs
    : {};
  const foundJobs = Array.isArray(jobsState?.found) ? jobsState.found : [];

  const postings = [];
  const seenUrls = new Set();

  for (const job of foundJobs) {
    const item = job && typeof job === "object" ? job : {};
    const jobUrl = String(item?.url || "").trim();
    if (!jobUrl || seenUrls.has(jobUrl)) continue;

    const searchableLocations = Array.isArray(item?.searchableLocations) ? item.searchableLocations : [];
    const locations = Array.isArray(item?.locations) ? item.locations : [];
    const locationValue = String(searchableLocations[0] || locations[0] || "").trim();

    const createdAtRaw = item?.createdAt;
    let postingDate = null;
    if (Number.isFinite(Number(createdAtRaw)) && Number(createdAtRaw) > 0) {
      postingDate = String(Math.floor(Number(createdAtRaw)));
    } else if (typeof createdAtRaw === "string" && createdAtRaw.trim()) {
      postingDate = createdAtRaw.trim();
    }

    postings.push({
      company_name: companyNameForPostings,
      position_name: String(item?.title || "").trim() || "Untitled Position",
      job_posting_url: jobUrl,
      posting_date: postingDate,
      location: locationValue || null,
      source_job_id: String(item?.id || item?.jobId || item?._id || "").trim() || jobUrl
    });
    seenUrls.add(jobUrl);
  }

  return postings;
}

module.exports = {
  parseGetroPostingsFromHtml
};
