"use strict";

const { safeFetch } = require("../../safeFetch");
const { normalizePostingDate } = require("../../posting");
const {
  SCHOOLSPRING_API_URL,
  SCHOOLSPRING_SOURCE_FAMILY,
  buildCompanyContext,
  clean,
  createDiscover,
  supportedSchoolspringHost
} = require("./discover");

const SCHOOLSPRING_RATE_LIMIT_WAIT_MS = 60 * 1000;
const DEFAULT_PAGE_SIZE = 25;
const DEFAULT_MAX_PAGES = 25;
const DEFAULT_TTL_SECONDS = Math.max(1, Number(process.env.POSTING_TTL_SECONDS || 30 * 24 * 60 * 60));

function makeSourceFetchError(reason, message, details = {}) {
  const error = new Error(message);
  error.ingestionErrorType = reason;
  Object.assign(error, details);
  return error;
}

function buildSchoolspringSearchUrl(page = 1, size = DEFAULT_PAGE_SIZE) {
  const endpoint = new URL(SCHOOLSPRING_API_URL);
  endpoint.searchParams.set("domainName", "");
  endpoint.searchParams.set("keyword", "");
  endpoint.searchParams.set("location", "");
  endpoint.searchParams.set("category", "");
  endpoint.searchParams.set("gradelevel", "");
  endpoint.searchParams.set("jobtype", "");
  endpoint.searchParams.set("organization", "");
  endpoint.searchParams.set("swLat", "");
  endpoint.searchParams.set("swLon", "");
  endpoint.searchParams.set("neLat", "");
  endpoint.searchParams.set("neLon", "");
  endpoint.searchParams.set("page", String(Math.max(1, Number(page) || 1)));
  endpoint.searchParams.set("size", String(Math.max(1, Number(size) || DEFAULT_PAGE_SIZE)));
  endpoint.searchParams.set("sortDateAscending", "false");
  return endpoint.toString();
}

function requestTarget() {
  return {
    method: "GET",
    headers: {
      Accept: "application/json, text/plain, */*",
      "Accept-Language": "en-US,en;q=0.9",
      Origin: "https://www.schoolspring.com",
      Referer: "https://www.schoolspring.com/"
    },
    source_key: "schoolspring",
    source_family: SCHOOLSPRING_SOURCE_FAMILY,
    rateLimitMs: SCHOOLSPRING_RATE_LIMIT_WAIT_MS
  };
}

function responseStatus(payload) {
  return Number(payload?.status || payload?.statusCode || 200);
}

async function payloadToText(payload) {
  if (typeof payload === "string") return payload;
  if (typeof payload?.text === "function") return payload.text();
  if (typeof payload?.body === "string") return payload.body;
  return "";
}

async function payloadToJson(payload) {
  if (payload && typeof payload === "object" && payload.value) return payload;
  if (typeof payload?.json === "function") return payload.json();
  const text = await payloadToText(payload);
  if (!clean(text)) {
    throw makeSourceFetchError("empty_response", "SchoolSpring API response body is empty");
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw makeSourceFetchError("invalid_json", "SchoolSpring API response is not valid JSON", {
      cause: error
    });
  }
}

function assertSchoolspringFinalHost(finalUrl, fallbackUrl) {
  const value = clean(finalUrl || fallbackUrl);
  try {
    const host = new URL(value).hostname.toLowerCase();
    if (supportedSchoolspringHost(host)) return;
  } catch {
    // Fall through to the source error below.
  }
  throw makeSourceFetchError("unexpected_redirect_host", `SchoolSpring API URL redirected to unexpected host: ${value}`, {
    url: value
  });
}

function parseDateEpochSeconds(value, referenceEpoch) {
  const raw = clean(value);
  if (!raw) return null;
  const normalized = raw.toLowerCase();
  if (normalized === "posted today" || normalized === "today") return Number(referenceEpoch);
  if (normalized === "posted yesterday" || normalized === "yesterday") return Number(referenceEpoch) - 24 * 60 * 60;

  const normalizedDate = normalizePostingDate(raw);
  if (normalizedDate.epoch) return normalizedDate.epoch;
  return null;
}

function shouldKeepSchoolSpringJob(job, referenceEpoch) {
  const rawDate = clean(job?.displayDate);
  if (!rawDate) return true;
  const parsedEpoch = parseDateEpochSeconds(rawDate, referenceEpoch);
  if (!parsedEpoch) return false;
  return parsedEpoch >= Number(referenceEpoch) - DEFAULT_TTL_SECONDS;
}

async function fetchSchoolspringPage(url, options, target) {
  const payload = typeof options.fetcher === "function"
    ? await options.fetcher(url, target)
    : await safeFetch(url, target);
  const status = responseStatus(payload);
  if (status < 200 || status >= 300 || payload?.ok === false) {
    const body = await payloadToText(payload);
    throw makeSourceFetchError("fetch_failed", `SchoolSpring request failed (${status}): ${body.slice(0, 180)}`, {
      status,
      url: clean(payload?.url || url)
    });
  }
  const finalUrl = clean(payload?.url || payload?.__sourceFetchFinalUrl || url);
  assertSchoolspringFinalHost(finalUrl, url);
  const json = await payloadToJson(payload);
  return { finalUrl, json };
}

function getJobsList(payload) {
  return Array.isArray(payload?.value?.jobsList) ? payload.value.jobsList : [];
}

function createFetchList(dependencies = {}) {
  const discover = typeof dependencies.discover === "function" ? dependencies.discover : createDiscover();

  return async function fetchSchoolspringSourceList(company = {}, options = {}) {
    const context = buildCompanyContext(company);
    const discovered = discover(context);
    const pageSize = Math.max(1, Math.min(100, Number(options.pageSize || DEFAULT_PAGE_SIZE) || DEFAULT_PAGE_SIZE));
    const pageLimit = Math.max(1, Math.min(100, Number(options.maxPages || DEFAULT_MAX_PAGES) || DEFAULT_MAX_PAGES));
    const referenceEpoch = Number(options.referenceEpoch || Math.floor(Date.now() / 1000));
    const target = requestTarget();
    const jobsList = [];
    const seenIds = new Set();
    let firstFinalUrl = "";
    let fetchedPages = 0;

    for (let page = 1; page <= pageLimit; page += 1) {
      const pageUrl = buildSchoolspringSearchUrl(page, pageSize);
      const result = await fetchSchoolspringPage(pageUrl, options, target);
      if (!firstFinalUrl) firstFinalUrl = result.finalUrl;
      fetchedPages += 1;

      const pageJobs = getJobsList(result.json);
      if (pageJobs.length === 0) break;

      let hasFreshJob = false;
      for (const job of pageJobs) {
        if (!shouldKeepSchoolSpringJob(job, referenceEpoch)) continue;
        hasFreshJob = true;
        const jobId = clean(job?.jobId);
        if (!jobId || seenIds.has(jobId)) continue;
        seenIds.add(jobId);
        jobsList.push(job);
      }

      if (!hasFreshJob || pageJobs.length < pageSize) break;
    }

    return {
      value: { jobsList },
      __sourceConfig: {
        ...(discovered.config || {}),
        apiUrl: SCHOOLSPRING_API_URL,
        page_size: pageSize,
        fetched_pages: fetchedPages
      },
      __sourceFetchFinalUrl: firstFinalUrl || buildSchoolspringSearchUrl(1, pageSize),
      __sourceRequest: {
        listUrl: SCHOOLSPRING_API_URL,
        rateLimitMs: SCHOOLSPRING_RATE_LIMIT_WAIT_MS
      }
    };
  };
}

module.exports = {
  SCHOOLSPRING_RATE_LIMIT_WAIT_MS,
  buildSchoolspringSearchUrl,
  createFetchList
};
