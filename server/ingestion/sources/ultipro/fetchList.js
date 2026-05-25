const { safeFetch } = require("../../safeFetch");
const { buildCompanyContext, clean, createDiscover } = require("./discover");

const DEFAULT_PAGE_SIZE = 50;
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

function buildUltiProSearchPayload(top, skip) {
  return {
    opportunitySearch: {
      Top: Number(top || DEFAULT_PAGE_SIZE),
      Skip: Number(skip || 0),
      QueryString: "",
      OrderBy: [
        {
          Value: "postedDateDesc",
          PropertyName: "PostedDate",
          Ascending: false
        }
      ],
      Filters: [
        { t: "TermsSearchFilterDto", fieldName: 4, extra: null, values: [] },
        { t: "TermsSearchFilterDto", fieldName: 5, extra: null, values: [] },
        { t: "TermsSearchFilterDto", fieldName: 6, extra: null, values: [] },
        { t: "TermsSearchFilterDto", fieldName: 37, extra: null, values: [] }
      ]
    },
    matchCriteria: {
      PreferredJobs: [],
      Educations: [],
      LicenseAndCertifications: [],
      Skills: [],
      hasNoLicenses: false,
      SkippedSkills: []
    }
  };
}

function buildRequestTarget(config, top, skip) {
  return {
    method: "POST",
    source_family: "enterprise_api",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify(buildUltiProSearchPayload(top, skip)),
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
      throw makeSourceFetchError("fetch_failed", `UltiPro API request failed (${status})`, {
        status,
        url
      });
    }
    return payloadToJson(payload);
  }

  const res = await safeFetch(url, target);
  if (!res.ok) {
    const body = await res.text();
    throw makeSourceFetchError("fetch_failed", `UltiPro API request failed (${res.status}): ${body.slice(0, 180)}`, {
      status: res.status,
      url: res.url || url
    });
  }
  return res.json();
}

function addUniqueOpportunities(target, seen, opportunities) {
  for (const opportunity of Array.isArray(opportunities) ? opportunities : []) {
    const key = clean(opportunity?.Id || opportunity?.OpportunityId || opportunity?.opportunityId);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    target.push(opportunity);
  }
}

function createFetchList(dependencies = {}) {
  const discover = typeof dependencies.discover === "function" ? dependencies.discover : createDiscover();

  return async function fetchUltiProSourceList(company = {}, options = {}) {
    const context = buildCompanyContext(company);
    const discovered = discover(context);
    const config = discovered?.config || {};
    const apiUrl = clean(config.apiUrl || discovered?.list_url);
    if (!apiUrl) {
      throw makeSourceFetchError("no_public_tenant_route", "UltiPro source has no supported public JobBoard route");
    }

    const pageSize = Math.max(1, Math.min(Number(options.pageSize || DEFAULT_PAGE_SIZE) || DEFAULT_PAGE_SIZE, 100));
    const maxPages = Math.max(1, Math.min(Number(options.maxPages || DEFAULT_MAX_PAGES) || DEFAULT_MAX_PAGES, DEFAULT_MAX_PAGES));
    const opportunities = [];
    const seen = new Set();
    let firstPayload = null;

    for (let page = 0; page < maxPages; page += 1) {
      const skip = page * pageSize;
      const responseJson = await fetchJsonPayload(apiUrl, buildRequestTarget(config, pageSize, skip), options.fetcher);
      if (!firstPayload) firstPayload = responseJson;
      const pageOpportunities = Array.isArray(responseJson?.opportunities) ? responseJson.opportunities : [];
      addUniqueOpportunities(opportunities, seen, pageOpportunities);

      const totalCount = Number(responseJson?.totalCount);
      if (pageOpportunities.length === 0) break;
      if (pageOpportunities.length < pageSize) break;
      if (Number.isFinite(totalCount) && skip + pageSize >= totalCount) break;
    }

    return {
      ...(firstPayload || {}),
      opportunities,
      __sourceConfig: config
    };
  };
}

module.exports = {
  DEFAULT_MAX_PAGES,
  DEFAULT_PAGE_SIZE,
  buildUltiProSearchPayload,
  createFetchList
};
