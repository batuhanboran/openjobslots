const { safeFetch } = require("../../safeFetch");
const { buildCompanyContext, clean, createDiscover } = require("./discover");

const DEFAULT_PAGE_SIZE = 100;
const DEFAULT_MAX_PAGES = 25;

function makeSourceFetchError(reason, message, details = {}) {
  const error = new Error(message);
  error.ingestionErrorType = reason;
  Object.assign(error, details);
  return error;
}

function responseStatus(payload) {
  return Number(payload?.status || payload?.statusCode || 200);
}

function buildCareerSiteTarget(config) {
  return {
    method: "GET",
    source_family: "enterprise_api",
    headers: {
      Accept: "application/json, text/plain, */*"
    },
    config
  };
}

function normalizeBaseUrl(value) {
  return clean(value).replace(/\/+$/, "");
}

function buildJobsRequestUrl(myadpUrl, top, skip) {
  const params = new URLSearchParams({
    $select:
      "reqId,jobTitle,publishedJobTitle,type,jobDescription,jobQualifications,workLocations,workLevelCode,clientRequisitionID,postingDate,requisitionLocations,postingLocations,organizationalUnits",
    $top: String(Math.max(1, Number(top || DEFAULT_PAGE_SIZE))),
    $skip: String(Math.max(0, Number(skip || 0))),
    $filter: "",
    radius: "25",
    tz: "America/Los_Angeles"
  });
  return `${normalizeBaseUrl(myadpUrl)}/myadp_prefix/mycareer/public/staffing/v1/job-requisitions/apply-custom-filters?${params.toString()}`;
}

function buildJobsTarget(config, careerSiteJson, top, skip) {
  const myJobsToken = clean(careerSiteJson?.myJobsToken);
  return {
    method: "GET",
    source_family: "enterprise_api",
    headers: {
      Accept: "application/json, text/plain, */*",
      "Accept-Language": "en-US,en;q=0.9",
      myjobstoken: myJobsToken,
      rolecode: "manager",
      Origin: "https://myjobs.adp.com",
      Referer: clean(config.boardUrl)
    },
    config: {
      ...config,
      myadpUrl: normalizeBaseUrl(careerSiteJson?.properties?.myadpUrl),
      pageSize: Number(top || DEFAULT_PAGE_SIZE),
      skip: Number(skip || 0)
    }
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

async function fetchJsonPayload(url, target, fetcher, label) {
  if (typeof fetcher === "function") {
    const payload = await fetcher(url, target);
    const status = responseStatus(payload);
    if (status < 200 || status >= 300) {
      throw makeSourceFetchError("fetch_failed", `ADP MyJobs ${label} request failed (${status})`, {
        status,
        url
      });
    }
    return payloadToJson(payload);
  }

  const res = await safeFetch(url, target);
  if (!res.ok) {
    const body = await res.text();
    throw makeSourceFetchError("fetch_failed", `ADP MyJobs ${label} request failed (${res.status}): ${body.slice(0, 180)}`, {
      status: res.status,
      url: res.url || url
    });
  }
  return res.json();
}

function extractJobRequisitions(payload) {
  if (Array.isArray(payload?.jobRequisitions)) return payload.jobRequisitions;
  if (Array.isArray(payload?.data?.jobRequisitions)) return payload.data.jobRequisitions;
  return [];
}

function addUniqueJobRequisitions(target, seen, rows) {
  for (const row of Array.isArray(rows) ? rows : []) {
    const key = clean(row?.reqId || row?.url || row?.jobUrl || row?.clientRequisitionID);
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    target.push(row);
  }
}

function createFetchList(dependencies = {}) {
  const discover = typeof dependencies.discover === "function" ? dependencies.discover : createDiscover();

  return async function fetchAdpMyjobsSourceList(company = {}, options = {}) {
    const context = buildCompanyContext(company);
    const discovered = discover(context);
    const config = discovered?.config || {};
    const careerSiteUrl = clean(config.careerSiteUrl || discovered?.list_url);
    if (!careerSiteUrl) {
      throw makeSourceFetchError("no_public_jobs_route", "ADP MyJobs source has no public career-site route", {
        url: context.url_string
      });
    }

    const careerSiteJson = await fetchJsonPayload(
      careerSiteUrl,
      buildCareerSiteTarget(config),
      options.fetcher,
      "career-site"
    );
    const myJobsToken = clean(careerSiteJson?.myJobsToken);
    const myadpUrl = normalizeBaseUrl(careerSiteJson?.properties?.myadpUrl);
    if (!myJobsToken || !myadpUrl) {
      return {
        count: 0,
        jobRequisitions: [],
        __sourceConfig: config,
        __careerSite: careerSiteJson
      };
    }

    const pageSize = Math.max(1, Math.min(Number(options.pageSize || DEFAULT_PAGE_SIZE) || DEFAULT_PAGE_SIZE, 100));
    const maxPages = Math.max(1, Math.min(Number(options.maxPages || DEFAULT_MAX_PAGES) || DEFAULT_MAX_PAGES, DEFAULT_MAX_PAGES));
    const jobRequisitions = [];
    const seen = new Set();
    let firstPayload = null;

    for (let page = 0; page < maxPages; page += 1) {
      const skip = page * pageSize;
      const apiUrl = buildJobsRequestUrl(myadpUrl, pageSize, skip);
      const payload = await fetchJsonPayload(
        apiUrl,
        buildJobsTarget(config, careerSiteJson, pageSize, skip),
        options.fetcher,
        "jobs"
      );
      if (!firstPayload) firstPayload = payload;
      const pageRows = extractJobRequisitions(payload);
      addUniqueJobRequisitions(jobRequisitions, seen, pageRows);

      const totalCount = Number(payload?.count);
      if (pageRows.length === 0) break;
      if (pageRows.length < pageSize) break;
      if (Number.isFinite(totalCount) && skip + pageSize >= totalCount) break;
    }

    return {
      ...(firstPayload || {}),
      jobRequisitions,
      __sourceConfig: {
        ...config,
        myadpUrl
      },
      __careerSite: careerSiteJson
    };
  };
}

module.exports = {
  DEFAULT_MAX_PAGES,
  DEFAULT_PAGE_SIZE,
  buildJobsRequestUrl,
  createFetchList
};
