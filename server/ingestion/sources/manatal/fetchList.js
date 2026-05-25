const { safeFetch } = require("../../safeFetch");
const { extractManatalPageRuntimeConfig } = require("./parse");
const { buildCompanyContext, clean, createDiscover } = require("./discover");

function makeSourceFetchError(reason, message, details = {}) {
  const error = new Error(message);
  error.ingestionErrorType = reason;
  Object.assign(error, details);
  return error;
}

function responseStatus(payload) {
  return Number(payload?.status || payload?.statusCode || 200);
}

function allowedCareersPageHost(host) {
  return host === "www.careers-page.com" || (host.endsWith(".careers-page.com") && host !== "careers-page.com");
}

function assertCareersPageFinalHost(finalUrl, fallbackUrl) {
  const value = clean(finalUrl || fallbackUrl);
  try {
    const host = new URL(value).hostname.toLowerCase();
    if (allowedCareersPageHost(host)) return;
  } catch {
    // Fall through to the source error below.
  }
  throw makeSourceFetchError("unexpected_redirect_host", `Manatal URL redirected to unexpected host: ${value}`, {
    url: value
  });
}

function buildLandingHeaders() {
  return {
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Cache-Control": "no-cache",
    Pragma: "no-cache",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
  };
}

function buildApiHeaders(config) {
  return {
    Accept: "application/json, text/plain, */*",
    Referer: clean(config?.boardUrl || "")
  };
}

async function payloadToText(payload) {
  if (typeof payload === "string") return payload;
  if (typeof payload?.text === "function") return payload.text();
  if (typeof payload?.body === "string") return payload.body;
  if (typeof payload?.html === "string") return payload.html;
  return "";
}

async function payloadToJson(payload) {
  if (payload && typeof payload === "object" && !Array.isArray(payload) && !("body" in payload) && !("html" in payload)) {
    return payload;
  }
  const text = await payloadToText(payload);
  return text ? JSON.parse(text) : {};
}

async function fetchTextPayload(url, target, fetcher, label) {
  if (typeof fetcher === "function") {
    const payload = await fetcher(url, target);
    const status = responseStatus(payload);
    if (status < 200 || status >= 300) {
      throw makeSourceFetchError("fetch_failed", `${label} request failed (${status})`, {
        status,
        url
      });
    }
    assertCareersPageFinalHost(payload?.url || payload?.__sourceFetchFinalUrl || url, url);
    return {
      pageHtml: await payloadToText(payload),
      finalUrl: clean(payload?.url || payload?.__sourceFetchFinalUrl || url)
    };
  }

  const res = await safeFetch(url, target);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${label} request failed (${res.status}): ${body.slice(0, 180)}`);
  }
  assertCareersPageFinalHost(res.url || url, url);
  return {
    pageHtml: await res.text(),
    finalUrl: clean(res.url || url)
  };
}

async function fetchJsonPayload(url, target, fetcher) {
  if (typeof fetcher === "function") {
    const payload = await fetcher(url, target);
    const status = responseStatus(payload);
    if (status < 200 || status >= 300) {
      throw makeSourceFetchError("fetch_failed", `Manatal API request failed (${status})`, {
        status,
        url
      });
    }
    assertCareersPageFinalHost(payload?.url || payload?.__sourceFetchFinalUrl || url, url);
    return payloadToJson(payload);
  }

  const res = await safeFetch(url, target);
  if (!res.ok) {
    const body = await res.text();
    const error = new Error(`Manatal API request failed (${res.status}): ${body.slice(0, 180)}`);
    error.status = Number(res.status || 0);
    error.url = res.url || url;
    throw error;
  }
  assertCareersPageFinalHost(res.url || url, url);
  return res.json();
}

function buildPageUrl(jobsApiUrl, page, pageSize) {
  const query = new URLSearchParams({
    page: String(page),
    page_size: String(pageSize),
    ordering: "-is_pinned_in_career_page,-last_published_at"
  }).toString();
  return `${jobsApiUrl}${jobsApiUrl.includes("?") ? "&" : "?"}${query}`;
}

function addUniqueResults(target, seen, results) {
  for (const item of Array.isArray(results) ? results : []) {
    const key = clean(item?.hash || item?.id || item?.url || item?.position_name || item?.title || JSON.stringify(item));
    if (!key || seen.has(key)) continue;
    seen.add(key);
    target.push(item);
  }
}

function createFetchList(dependencies = {}) {
  const discover = typeof dependencies.discover === "function" ? dependencies.discover : createDiscover();

  return async function fetchManatalSourceList(company = {}, options = {}) {
    const context = buildCompanyContext(company);
    const discovered = discover(context);
    const config = discovered?.config || {};
    const boardUrl = clean(config.careersUrl || config.boardUrl || context.url_string);
    if (!boardUrl) {
      throw makeSourceFetchError("no_public_jobs_route", "Manatal source has no supported careers page route");
    }

    const landing = await fetchTextPayload(boardUrl, {
      method: "GET",
      headers: buildLandingHeaders()
    }, options.fetcher, "Manatal careers page");
    const pageHtml = String(landing?.pageHtml || "");
    const runtimeConfig = extractManatalPageRuntimeConfig(pageHtml, config, landing?.finalUrl || boardUrl);
    const jobsApiUrl = clean(runtimeConfig?.jobsApiUrl);
    if (!jobsApiUrl) {
      return {
        html: pageHtml,
        __sourceConfig: runtimeConfig,
        __sourceFetchFinalUrl: clean(landing?.finalUrl || boardUrl)
      };
    }

    const pageSize = Math.max(1, Math.min(Number(options.pageSize || 50) || 50, 100));
    const maxPages = Math.max(1, Math.min(Number(options.maxPages || 5) || 5, 20));
    const collectedResults = [];
    const seen = new Set();
    let firstPayload = null;

    for (let page = 1; page <= maxPages; page += 1) {
      const requestUrl = buildPageUrl(jobsApiUrl, page, pageSize);
      let responseJson = {};
      try {
        responseJson = await fetchJsonPayload(requestUrl, {
          method: "GET",
          headers: buildApiHeaders(runtimeConfig)
        }, options.fetcher);
      } catch (error) {
        const status = Number(error?.status || 0);
        if (status === 404) break;
        if (page > 1) break;
        throw error;
      }

      if (!firstPayload) firstPayload = responseJson;
      const results = Array.isArray(responseJson?.results) ? responseJson.results : [];
      addUniqueResults(collectedResults, seen, results);
      const totalCount = Number(responseJson?.count);
      const nextUrl = clean(responseJson?.next || "");
      if (results.length === 0) break;
      if (!nextUrl) break;
      if (Number.isFinite(totalCount) && totalCount >= 0 && collectedResults.length >= totalCount) break;
    }

    if (collectedResults.length > 0) {
      return {
        ...(firstPayload || {}),
        results: collectedResults,
        __sourceConfig: runtimeConfig,
        __sourceFetchFinalUrl: clean(landing?.finalUrl || boardUrl)
      };
    }

    return {
      html: pageHtml,
      __sourceConfig: runtimeConfig,
      __sourceFetchFinalUrl: clean(landing?.finalUrl || boardUrl)
    };
  };
}

module.exports = {
  createFetchList
};
