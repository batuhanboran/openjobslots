const { safeFetch } = require("../../safeFetch");
const { buildCompanyContext, clean, createDiscover } = require("./discover");

const DEFAULT_PAGE_SIZE = 20;
const DEFAULT_MAX_PAGES = 5;

function makeSourceFetchError(reason, message, details = {}) {
  const error = new Error(message);
  error.ingestionErrorType = reason;
  Object.assign(error, details);
  return error;
}

function responseStatus(payload) {
  return Number(payload?.status || payload?.statusCode || 200);
}

function buildWorkdaySearchPayload(limit, offset) {
  return {
    appliedFacets: {},
    limit: Number(limit || DEFAULT_PAGE_SIZE),
    offset: Number(offset || 0),
    searchText: ""
  };
}

function buildRequestTarget(config, limit, offset) {
  return {
    method: "POST",
    source_family: "enterprise_api",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify(buildWorkdaySearchPayload(limit, offset)),
    config
  };
}

async function payloadToJson(payload) {
  if (payload && typeof payload === "object" && !Array.isArray(payload) && !("body" in payload) && !("html" in payload)) {
    return payload;
  }
  const text = typeof payload?.text === "function"
    ? await payload.text()
    : typeof payload?.body === "string"
      ? payload.body
      : typeof payload?.html === "string"
        ? payload.html
        : "";
  return text ? JSON.parse(text) : {};
}

async function fetchJsonPayload(url, target, fetcher) {
  if (typeof fetcher === "function") {
    const payload = await fetcher(url, target);
    const status = responseStatus(payload);
    if (status < 200 || status >= 300) {
      throw makeSourceFetchError("fetch_failed", `Workday CXS request failed (${status})`, {
        status,
        url
      });
    }
    return payloadToJson(payload);
  }

  const res = await safeFetch(url, target);
  if (!res.ok) {
    const body = await res.text();
    throw makeSourceFetchError("fetch_failed", `Workday CXS request failed (${res.status}): ${body.slice(0, 180)}`, {
      status: res.status,
      url: res.url || url
    });
  }
  return res.json();
}

function extractJobPostings(payload) {
  if (Array.isArray(payload?.jobPostings)) return payload.jobPostings;
  if (Array.isArray(payload?.data?.jobPostings)) return payload.data.jobPostings;
  if (Array.isArray(payload?.data?.jobs)) return payload.data.jobs;
  if (Array.isArray(payload?.jobs)) return payload.jobs;
  return [];
}

function addUniquePostings(target, seen, postings) {
  for (const item of Array.isArray(postings) ? postings : []) {
    const key = clean(item?.jobRequisitionId || item?.jobReqId || item?.requisitionId || item?.jobId || item?.id || item?.externalPath);
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    target.push(item);
  }
}

function createFetchList(dependencies = {}) {
  const discover = typeof dependencies.discover === "function" ? dependencies.discover : createDiscover();

  return async function fetchWorkdaySourceList(company = {}, options = {}) {
    const context = buildCompanyContext(company);
    const discovered = discover(context);
    const config = discovered?.config || {};
    const listUrl = clean(config.cxsUrl || discovered?.list_url);
    if (!listUrl) {
      throw makeSourceFetchError("no_public_jobs_route", "Workday source has no public CXS jobs route", {
        url: context.url_string
      });
    }

    const envPageSize = Number(process.env.OPENJOBSLOTS_WORKDAY_SOURCE_PAGE_SIZE || DEFAULT_PAGE_SIZE);
    const envMaxPages = Number(process.env.OPENJOBSLOTS_WORKDAY_SOURCE_MAX_PAGES || DEFAULT_MAX_PAGES);
    const pageSize = Math.max(1, Math.min(100, Number(options.pageSize || envPageSize) || DEFAULT_PAGE_SIZE));
    const maxPages = Math.max(1, Math.min(25, Number(options.maxPages || envMaxPages) || DEFAULT_MAX_PAGES));
    const jobPostings = [];
    const seen = new Set();
    let firstPayload = null;

    for (let page = 0; page < maxPages; page += 1) {
      const offset = page * pageSize;
      const payload = await fetchJsonPayload(listUrl, buildRequestTarget(config, pageSize, offset), options.fetcher);
      if (!firstPayload) firstPayload = payload;
      const batch = extractJobPostings(payload);
      addUniquePostings(jobPostings, seen, batch);
      if (batch.length === 0 || batch.length < pageSize) break;
    }

    return {
      ...(firstPayload || {}),
      jobPostings,
      __sourceConfig: config
    };
  };
}

module.exports = {
  DEFAULT_MAX_PAGES,
  DEFAULT_PAGE_SIZE,
  buildWorkdaySearchPayload,
  createFetchList
};
