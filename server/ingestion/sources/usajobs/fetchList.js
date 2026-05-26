const { safeFetch } = require("../../safeFetch");
const {
  USAJOBS_LIST_URL,
  USAJOBS_SOURCE_FAMILY,
  buildCompanyContext,
  clean,
  createDiscover,
  supportedUsajobsHost
} = require("./discover");

const USAJOBS_RATE_LIMIT_WAIT_MS = 60 * 1000;

function makeSourceFetchError(reason, message, details = {}) {
  const error = new Error(message);
  error.ingestionErrorType = reason;
  Object.assign(error, details);
  return error;
}

function getUsajobsApiConfig(env = process.env) {
  const authorizationKey = clean(
    env.OPENJOBSLOTS_USAJOBS_AUTHORIZATION_KEY ||
    env.USAJOBS_AUTHORIZATION_KEY ||
    env.USAJOBS_API_KEY
  );
  if (!authorizationKey) {
    throw makeSourceFetchError(
      "auth_missing",
      "USAJobs official API key is not configured; set OPENJOBSLOTS_USAJOBS_AUTHORIZATION_KEY"
    );
  }
  const userAgent = clean(
    env.OPENJOBSLOTS_USAJOBS_USER_AGENT ||
    env.USAJOBS_USER_AGENT ||
    env.OPENJOBSLOTS_CONTACT_EMAIL ||
    "openjobslots.com"
  );
  return { authorizationKey, userAgent };
}

function buildSearchUrl(page = 1, resultsPerPage = 25) {
  const url = new URL(USAJOBS_LIST_URL);
  url.searchParams.set("HiringPath", "public");
  url.searchParams.set("DatePosted", "30");
  url.searchParams.set("SortField", "DatePosted");
  url.searchParams.set("SortDirection", "Desc");
  url.searchParams.set("ResultsPerPage", String(resultsPerPage));
  url.searchParams.set("Page", String(page));
  return url.toString();
}

function buildHeaders(config) {
  return {
    Accept: "application/json",
    Host: "data.usajobs.gov",
    "User-Agent": config.userAgent,
    "Authorization-Key": config.authorizationKey
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
  if (typeof payload?.json === "function") return payload.json();
  if (typeof payload?.body === "string") return JSON.parse(payload.body || "{}");
  if (typeof payload === "string") return JSON.parse(payload || "{}");
  return payload;
}

function assertUsajobsFinalHost(finalUrl, fallbackUrl) {
  const value = clean(finalUrl || fallbackUrl);
  try {
    const host = new URL(value).hostname.toLowerCase();
    if (supportedUsajobsHost(host)) return;
  } catch {
    // Fall through to the source error below.
  }
  throw makeSourceFetchError("unexpected_redirect_host", `USAJobs URL redirected to unexpected host: ${value}`, {
    url: value
  });
}

async function fetchPage(url, target, options = {}) {
  const payload = typeof options.fetcher === "function"
    ? await options.fetcher(url, target)
    : await safeFetch(url, target);
  const status = responseStatus(payload);
  if (status < 200 || status >= 300 || payload?.ok === false) {
    const body = await payloadToText(payload);
    throw makeSourceFetchError("fetch_failed", `USAJobs official search request failed (${status}): ${body.slice(0, 180)}`, {
      status,
      url: clean(payload?.url || url)
    });
  }
  const finalUrl = clean(payload?.url || payload?.__sourceFetchFinalUrl || url);
  assertUsajobsFinalHost(finalUrl, url);
  return {
    finalUrl,
    json: await payloadToJson(payload)
  };
}

function numberOfPages(payload) {
  const value = Number(payload?.SearchResult?.UserArea?.NumberOfPages || payload?.Pager?.NumberOfPages || 1);
  return Number.isFinite(value) && value > 0 ? value : 1;
}

function createFetchList(dependencies = {}) {
  const discover = typeof dependencies.discover === "function" ? dependencies.discover : createDiscover();

  return async function fetchUsajobsSourceList(company = {}, options = {}) {
    const context = buildCompanyContext(company);
    const discovered = discover(context);
    const apiConfig = getUsajobsApiConfig(options.env || process.env);
    const maxPages = Math.max(1, Math.min(20, Number(options.maxPages || 2)));
    const resultsPerPage = Math.max(1, Math.min(500, Number(options.resultsPerPage || 25)));
    const target = {
      method: "GET",
      headers: buildHeaders(apiConfig),
      source_key: "usajobs",
      source_family: USAJOBS_SOURCE_FAMILY,
      rateLimitMs: USAJOBS_RATE_LIMIT_WAIT_MS
    };

    const pages = [];
    let firstFinalUrl = "";
    let totalPages = 1;

    for (let page = 1; page <= Math.min(maxPages, totalPages); page += 1) {
      const url = buildSearchUrl(page, resultsPerPage);
      const result = await fetchPage(url, target, options);
      if (!firstFinalUrl) firstFinalUrl = result.finalUrl;
      pages.push(result.json && typeof result.json === "object" ? result.json : {});
      totalPages = Math.max(totalPages, numberOfPages(result.json));
    }

    return {
      ...(pages[0] || {}),
      pages,
      __sourceConfig: {
        ...(discovered.config || {}),
        listUrl: USAJOBS_LIST_URL,
        fetched_pages: pages.length,
        results_per_page: resultsPerPage
      },
      __sourceFetchFinalUrl: firstFinalUrl || USAJOBS_LIST_URL,
      __sourceRequest: {
        listUrl: USAJOBS_LIST_URL,
        rateLimitMs: USAJOBS_RATE_LIMIT_WAIT_MS
      }
    };
  };
}

module.exports = {
  USAJOBS_RATE_LIMIT_WAIT_MS,
  buildSearchUrl,
  createFetchList,
  getUsajobsApiConfig
};
