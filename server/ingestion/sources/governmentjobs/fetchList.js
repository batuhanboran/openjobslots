const { safeFetch } = require("../../safeFetch");
const {
  GOVERNMENTJOBS_LIST_URL,
  GOVERNMENTJOBS_SOURCE_FAMILY,
  buildCompanyContext,
  clean,
  createDiscover,
  supportedGovernmentJobsHost
} = require("./discover");
const {
  extractGovernmentJobsLastPage,
  extractGovernmentJobsViewHtmlFromResponse
} = require("./parse");

const GOVERNMENTJOBS_RATE_LIMIT_WAIT_MS = 60 * 1000;

function makeSourceFetchError(reason, message, details = {}) {
  const error = new Error(message);
  error.ingestionErrorType = reason;
  Object.assign(error, details);
  return error;
}

function buildSearchUrl(params = {}) {
  const url = new URL(GOVERNMENTJOBS_LIST_URL);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

function requestTarget() {
  return {
    method: "GET",
    headers: {
      Accept: "application/json, text/plain, */*",
      "Accept-Language": "en-US,en;q=0.9",
      "X-Requested-With": "XMLHttpRequest"
    },
    source_key: "governmentjobs",
    source_family: GOVERNMENTJOBS_SOURCE_FAMILY,
    rateLimitMs: GOVERNMENTJOBS_RATE_LIMIT_WAIT_MS
  };
}

function responseStatus(payload) {
  return Number(payload?.status || payload?.statusCode || 200);
}

async function payloadToText(payload) {
  if (typeof payload === "string") return payload;
  if (typeof payload?.text === "function") return payload.text();
  if (typeof payload?.body === "string") return payload.body;
  if (typeof payload?.view1 === "string") return payload.view1;
  if (typeof payload?.html === "string") return payload.html;
  return "";
}

async function payloadToViewHtml(payload) {
  if (typeof payload?.view1 === "string") return payload.view1;
  const text = await payloadToText(payload);
  return extractGovernmentJobsViewHtmlFromResponse(payload, text);
}

function assertGovernmentJobsFinalHost(finalUrl, fallbackUrl) {
  const value = clean(finalUrl || fallbackUrl);
  try {
    const host = new URL(value).hostname.toLowerCase();
    if (supportedGovernmentJobsHost(host)) return;
  } catch {
    // Fall through to the source error below.
  }
  throw makeSourceFetchError("unexpected_redirect_host", `GovernmentJobs URL redirected to unexpected host: ${value}`, {
    url: value
  });
}

async function fetchViewHtml(url, options, target) {
  const payload = typeof options.fetcher === "function"
    ? await options.fetcher(url, target)
    : await safeFetch(url, target);
  const status = responseStatus(payload);
  if (status < 200 || status >= 300 || payload?.ok === false) {
    const body = await payloadToText(payload);
    throw makeSourceFetchError("fetch_failed", `GovernmentJobs request failed (${status}): ${body.slice(0, 180)}`, {
      status,
      url: clean(payload?.url || url)
    });
  }
  const finalUrl = clean(payload?.url || payload?.__sourceFetchFinalUrl || url);
  assertGovernmentJobsFinalHost(finalUrl, url);
  return {
    finalUrl,
    viewHtml: await payloadToViewHtml(payload)
  };
}

function createFetchList(dependencies = {}) {
  const discover = typeof dependencies.discover === "function" ? dependencies.discover : createDiscover();

  return async function fetchGovernmentJobsSourceList(company = {}, options = {}) {
    const context = buildCompanyContext(company);
    const discovered = discover(context);
    const now = typeof options.now === "function" ? options.now : Date.now;
    const firstUrl = buildSearchUrl({
      keyword: "",
      location: "",
      daysposted: "1",
      isFiltered: "true",
      _: String(now())
    });
    const target = requestTarget();
    const first = await fetchViewHtml(firstUrl, options, target);
    const pages = [first.viewHtml];
    const lastPage = extractGovernmentJobsLastPage(first.viewHtml);
    const maxPages = Math.max(1, Number(options.maxPages || lastPage || 1));
    const pageLimit = Math.min(lastPage, maxPages);

    for (let page = 2; page <= pageLimit; page += 1) {
      const pageUrl = buildSearchUrl({
        page: String(page),
        daysPosted: "1",
        isTransfer: "False",
        isPromotional: "False",
        _: String(now())
      });
      const pageResult = await fetchViewHtml(pageUrl, options, target);
      pages.push(pageResult.viewHtml);
    }

    return {
      view_html_pages: pages,
      __sourceConfig: {
        ...(discovered.config || {}),
        first_url: firstUrl,
        last_page: lastPage,
        fetched_pages: pages.length
      },
      __sourceFetchFinalUrl: first.finalUrl,
      __sourceRequest: {
        listUrl: GOVERNMENTJOBS_LIST_URL,
        rateLimitMs: GOVERNMENTJOBS_RATE_LIMIT_WAIT_MS
      }
    };
  };
}

module.exports = {
  GOVERNMENTJOBS_RATE_LIMIT_WAIT_MS,
  buildSearchUrl,
  createFetchList
};
