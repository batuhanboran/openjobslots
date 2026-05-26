"use strict";

const { safeFetch } = require("../../safeFetch");
const {
  extractPageupCompanyNameFromTitle,
  extractPageupPostingDateFromDetailHtml,
  parsePageupPostingsFromResults
} = require("./parse");
const {
  buildCompanyContext,
  clean,
  createDiscover,
  extractPageupRouteConfigFromUrl,
  parsePageupCompany,
  supportedPageupHost
} = require("./discover");

const PAGEUP_RATE_LIMIT_WAIT_MS = 60 * 1000;
const DEFAULT_DETAIL_FETCH_LIMIT = 50;

function responseStatus(payload) {
  return Number(payload?.status || payload?.statusCode || (payload?.ok === false ? 500 : 200));
}

function payloadUrl(payload, fallbackUrl = "") {
  return clean(payload?.url || payload?.finalUrl || payload?.__sourceFetchFinalUrl || fallbackUrl);
}

async function payloadToText(payload) {
  if (typeof payload === "string") return payload;
  if (!payload || typeof payload !== "object") return "";
  if (typeof payload.text === "function") return payload.text();
  if (typeof payload.text === "string") return payload.text;
  if (typeof payload.body === "string") return payload.body;
  if (typeof payload.html === "string") return payload.html;
  if (payload.json && typeof payload.json === "object") return JSON.stringify(payload.json);
  if (typeof payload.json === "function") return JSON.stringify(await payload.json());
  return "";
}

function assertPageupHost(urlValue, fallbackUrl = "", scope = "URL") {
  const value = clean(urlValue || fallbackUrl);
  try {
    const host = new URL(value).hostname.toLowerCase();
    if (supportedPageupHost(host)) return;
  } catch {
    // fall through
  }
  throw new Error(`PageUp ${scope} redirected to unexpected host: ${value}`);
}

function buildRequestHeaders(extra = {}) {
  return {
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Cache-Control": "no-cache",
    Pragma: "no-cache",
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    ...extra
  };
}

function withFinalConfig(config, finalUrl, fallbackUrl) {
  const parsed = parsePageupCompany(clean(finalUrl || fallbackUrl));
  if (!parsed) return config || {};
  const route = extractPageupRouteConfigFromUrl(finalUrl, config?.routeType, config?.locale);
  return {
    ...parsed,
    routeType: route.routeType,
    locale: route.locale,
    searchUrl: `${parsed.baseOrigin}/${encodeURIComponent(parsed.boardId)}/${route.routeType}/${route.locale}/search/`
  };
}

function detailLimit(options = {}) {
  const requested = Number(options.detailFetchLimit || options.maxDetailPages || DEFAULT_DETAIL_FETCH_LIMIT);
  if (!Number.isFinite(requested) || requested < 0) return DEFAULT_DETAIL_FETCH_LIMIT;
  return Math.floor(requested);
}

function parseSearchJson(bodyText) {
  try {
    return JSON.parse(String(bodyText || ""));
  } catch {
    throw new Error(`PageUp search response was not JSON: ${String(bodyText || "").slice(0, 180)}`);
  }
}

function createFetchList(dependencies = {}) {
  const discover = typeof dependencies.discover === "function" ? dependencies.discover : createDiscover("source-pageup-v1");

  return async function fetchPageupSourceList(company = {}, options = {}) {
    const context = buildCompanyContext(company);
    const discovered = discover(context);
    const config = discovered?.config || {};
    const boardUrl = clean(config.boardUrl || discovered?.list_url || context.url_string);
    if (!boardUrl || !clean(config.boardId)) {
      return {
        html: "",
        __sourceConfig: config
      };
    }
    assertPageupHost(boardUrl, boardUrl, "URL");

    const boardTarget = {
      method: "GET",
      source_family: "html_detail",
      headers: buildRequestHeaders()
    };
    const boardPayload = options.fetcher
      ? await options.fetcher(boardUrl, boardTarget)
      : await safeFetch(boardUrl, boardTarget);
    const boardStatus = responseStatus(boardPayload);
    if (boardStatus < 200 || boardStatus >= 300) {
      const body = await payloadToText(boardPayload);
      throw new Error(`PageUp board request failed (${boardStatus}): ${body.slice(0, 180)}`);
    }

    const finalBoardUrl = payloadUrl(boardPayload, boardUrl);
    assertPageupHost(finalBoardUrl, boardUrl, "URL");
    const pageHtml = await payloadToText(boardPayload);
    const finalConfig = withFinalConfig(config, finalBoardUrl, boardUrl);
    const searchUrl = clean(finalConfig.searchUrl);
    if (!searchUrl) {
      return {
        html: "",
        __boardHtml: pageHtml,
        __sourceConfig: finalConfig,
        __sourceFetchFinalUrl: finalBoardUrl,
        __sourceRequest: {
          boardUrl,
          finalBoardUrl,
          rateLimitMs: PAGEUP_RATE_LIMIT_WAIT_MS,
          detailFetchLimit: detailLimit(options),
          detailFetchCount: 0
        }
      };
    }
    const inferredCompanyName = extractPageupCompanyNameFromTitle(pageHtml);
    const companyNameForPostings =
      clean(context.company_name) ||
      (inferredCompanyName !== "Unknown Company" ? inferredCompanyName : "") ||
      `pageup_${clean(finalConfig.boardId).toLowerCase() || "source"}`;

    const searchTarget = {
      method: "POST",
      source_family: "html_detail",
      headers: buildRequestHeaders({
        Accept: "application/json, text/plain, */*",
        Referer: clean(finalConfig.boardUrl || finalBoardUrl),
        "X-Requested-With": "XMLHttpRequest"
      })
    };
    const searchPayload = options.fetcher
      ? await options.fetcher(searchUrl, searchTarget)
      : await safeFetch(searchUrl, searchTarget);
    const searchStatus = responseStatus(searchPayload);
    if (searchStatus < 200 || searchStatus >= 300) {
      const body = await payloadToText(searchPayload);
      throw new Error(`PageUp search request failed (${searchStatus}): ${body.slice(0, 180)}`);
    }

    const finalSearchUrl = payloadUrl(searchPayload, searchUrl);
    assertPageupHost(finalSearchUrl, searchUrl, "search URL");
    const responseJson = parseSearchJson(await payloadToText(searchPayload));
    const resultsHtml = String(responseJson?.results || "");
    const rawPostings = parsePageupPostingsFromResults(companyNameForPostings, finalConfig, resultsHtml);
    const detailPostingDateByUrl = {};
    const detailFailureByUrl = {};
    const seenUrls = new Set();
    const maxDetails = detailLimit(options);

    for (const posting of rawPostings) {
      const postingUrl = clean(posting?.job_posting_url);
      if (!postingUrl || seenUrls.has(postingUrl) || seenUrls.size >= maxDetails) continue;
      assertPageupHost(postingUrl, finalBoardUrl, "details URL");
      seenUrls.add(postingUrl);

      const detailTarget = {
        method: "GET",
        source_family: "html_detail",
        headers: buildRequestHeaders()
      };

      try {
        const detailPayload = options.fetcher
          ? await options.fetcher(postingUrl, detailTarget)
          : await safeFetch(postingUrl, detailTarget);
        const detailStatus = responseStatus(detailPayload);
        if (detailStatus < 200 || detailStatus >= 300) {
          detailFailureByUrl[postingUrl] = `details_request_failed_${detailStatus}`;
          continue;
        }
        const finalDetailUrl = payloadUrl(detailPayload, postingUrl);
        assertPageupHost(finalDetailUrl, postingUrl, "details URL");
        const detailsHtml = await payloadToText(detailPayload);
        const postingDate = clean(extractPageupPostingDateFromDetailHtml(detailsHtml));
        if (postingDate) detailPostingDateByUrl[postingUrl] = postingDate;
      } catch (error) {
        const message = clean(error?.message || error?.ingestionErrorType || error?.code || "details_fetch_failed");
        if (/unexpected host/i.test(message)) throw error;
        detailFailureByUrl[postingUrl] = message || "details_fetch_failed";
      }
    }

    return {
      html: resultsHtml,
      __boardHtml: pageHtml,
      __detailPostingDateByUrl: detailPostingDateByUrl,
      __detailFailureByUrl: detailFailureByUrl,
      __companyNameForPostings: companyNameForPostings,
      __sourceConfig: finalConfig,
      __sourceFetchFinalUrl: finalBoardUrl,
      __sourceSearchFinalUrl: finalSearchUrl,
      __sourceRequest: {
        boardUrl,
        finalBoardUrl,
        searchUrl,
        finalSearchUrl,
        rateLimitMs: PAGEUP_RATE_LIMIT_WAIT_MS,
        detailFetchLimit: maxDetails,
        detailFetchCount: seenUrls.size
      }
    };
  };
}

module.exports = {
  DEFAULT_DETAIL_FETCH_LIMIT,
  PAGEUP_RATE_LIMIT_WAIT_MS,
  createFetchList
};
