"use strict";

const { safeFetch } = require("../../safeFetch");
const { normalizePostingDate } = require("../../posting");
const {
  K12JOBSPOT_API_URL,
  K12JOBSPOT_PUBLIC_ORIGIN,
  K12JOBSPOT_SOURCE_FAMILY,
  clean,
  createDiscover,
  supportedK12jobspotApiHost
} = require("./discover");

const K12JOBSPOT_RATE_LIMIT_WAIT_MS = 60 * 1000;
const DEFAULT_PAGE_WINDOW_SIZE = 25;
const DEFAULT_MAX_PAGES = 25;
const DEFAULT_TTL_SECONDS = Math.max(1, Number(process.env.POSTING_TTL_SECONDS || 30 * 24 * 60 * 60));

function makeSourceFetchError(reason, message, details = {}) {
  const error = new Error(message);
  error.ingestionErrorType = reason;
  Object.assign(error, details);
  return error;
}

function buildK12jobspotRequestBody(pageStartIndex, pageEndIndex) {
  return {
    searchPhrase: "",
    filters: [
      { name: "positionAreas", filters: [] },
      { name: "gradeLevels", filters: [] },
      { name: "jobTypes", filters: [] }
    ],
    pageStartIndex,
    pageEndIndex
  };
}

function requestTarget(body) {
  return {
    method: "POST",
    headers: {
      Accept: "application/json, text/plain, */*",
      "Accept-Language": "en-US,en;q=0.9",
      "Content-Type": "application/json",
      Origin: K12JOBSPOT_PUBLIC_ORIGIN,
      Referer: `${K12JOBSPOT_PUBLIC_ORIGIN}/`
    },
    body: JSON.stringify(body),
    source_key: "k12jobspot",
    source_family: K12JOBSPOT_SOURCE_FAMILY,
    rateLimitMs: K12JOBSPOT_RATE_LIMIT_WAIT_MS
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
  if (payload && typeof payload === "object" && Array.isArray(payload.jobs)) return payload;
  if (typeof payload?.json === "function") return payload.json();
  const text = await payloadToText(payload);
  if (!clean(text)) {
    throw makeSourceFetchError("empty_response", "K12JobSpot API response body is empty");
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw makeSourceFetchError("invalid_json", "K12JobSpot API response is not valid JSON", {
      cause: error
    });
  }
}

function assertK12jobspotFinalHost(finalUrl, fallbackUrl) {
  const value = clean(finalUrl || fallbackUrl);
  try {
    const host = new URL(value).hostname.toLowerCase();
    if (supportedK12jobspotApiHost(host)) return;
  } catch {
    // Fall through to the source error below.
  }
  throw makeSourceFetchError("unexpected_redirect_host", `K12JobSpot API URL redirected to unexpected host: ${value}`, {
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

function shouldKeepK12jobspotJob(job, referenceEpoch) {
  const rawDate = clean(job?.postedDate || job?.datePosted || job?.postingDate);
  if (!rawDate) return true;
  const parsedEpoch = parseDateEpochSeconds(rawDate, referenceEpoch);
  if (!parsedEpoch) return false;
  return parsedEpoch >= Number(referenceEpoch) - DEFAULT_TTL_SECONDS;
}

async function fetchK12jobspotPage(url, options, target) {
  const payload = typeof options.fetcher === "function"
    ? await options.fetcher(url, target)
    : await safeFetch(url, target);
  const status = responseStatus(payload);
  if (status < 200 || status >= 300 || payload?.ok === false) {
    const body = await payloadToText(payload);
    throw makeSourceFetchError("fetch_failed", `K12JobSpot request failed (${status}): ${body.slice(0, 180)}`, {
      status,
      url: clean(payload?.url || url)
    });
  }
  const finalUrl = clean(payload?.url || payload?.__sourceFetchFinalUrl || url);
  assertK12jobspotFinalHost(finalUrl, url);
  const json = await payloadToJson(payload);
  return { finalUrl, json };
}

function getJobs(payload) {
  return Array.isArray(payload?.jobs) ? payload.jobs : [];
}

function createFetchList(dependencies = {}) {
  const discover = typeof dependencies.discover === "function" ? dependencies.discover : createDiscover();

  return async function fetchK12jobspotSourceList(company = {}, options = {}) {
    const discovered = discover(company);
    if (discovered?.ok === false) {
      throw makeSourceFetchError(discovered.reason || "unsupported_k12jobspot_source", "K12JobSpot source has no supported public API route", {
        url: company.url_string
      });
    }

    const pageWindowSize = Math.max(1, Math.min(100, Number(options.pageSize || options.pageWindowSize || DEFAULT_PAGE_WINDOW_SIZE) || DEFAULT_PAGE_WINDOW_SIZE));
    const pageLimit = Math.max(1, Math.min(100, Number(options.maxPages || DEFAULT_MAX_PAGES) || DEFAULT_MAX_PAGES));
    const referenceEpoch = Number(options.referenceEpoch || Math.floor(Date.now() / 1000));
    const jobs = [];
    const seenIds = new Set();
    let firstFinalUrl = "";
    let fetchedPages = 0;
    let pageStartIndex = 1;

    for (let page = 1; page <= pageLimit; page += 1) {
      const pageEndIndex = pageStartIndex + pageWindowSize - 1;
      const body = buildK12jobspotRequestBody(pageStartIndex, pageEndIndex);
      const target = requestTarget(body);
      const result = await fetchK12jobspotPage(discovered.list_url || K12JOBSPOT_API_URL, options, target);
      if (!firstFinalUrl) firstFinalUrl = result.finalUrl;
      fetchedPages += 1;

      const pageJobs = getJobs(result.json);
      if (pageJobs.length === 0) break;

      let hasFreshJob = false;
      for (const job of pageJobs) {
        if (!shouldKeepK12jobspotJob(job, referenceEpoch)) continue;
        hasFreshJob = true;
        const jobId = clean(job?.id);
        if (!jobId || seenIds.has(jobId)) continue;
        seenIds.add(jobId);
        jobs.push(job);
      }

      if (!hasFreshJob) break;
      pageStartIndex = pageEndIndex + 1;
    }

    return {
      jobs,
      __sourceConfig: {
        ...(discovered.config || {}),
        apiUrl: K12JOBSPOT_API_URL,
        page_size: pageWindowSize,
        fetched_pages: fetchedPages
      },
      __sourceFetchFinalUrl: firstFinalUrl || K12JOBSPOT_API_URL,
      __sourceRequest: {
        listUrl: K12JOBSPOT_API_URL,
        rateLimitMs: K12JOBSPOT_RATE_LIMIT_WAIT_MS
      }
    };
  };
}

module.exports = {
  K12JOBSPOT_RATE_LIMIT_WAIT_MS,
  buildK12jobspotRequestBody,
  createFetchList
};
