"use strict";

const { safeFetch } = require("../../safeFetch");
const { extractCaloppsNextPageUrl } = require("./parse");
const {
  CALOPPS_SOURCE_FAMILY,
  clean,
  createDiscover,
  supportedCaloppsHost
} = require("./discover");

const CALOPPS_RATE_LIMIT_WAIT_MS = 60 * 1000;

function makeSourceFetchError(reason, message, details = {}) {
  const error = new Error(message);
  error.ingestionErrorType = reason;
  Object.assign(error, details);
  return error;
}

function requestTarget() {
  return {
    method: "GET",
    headers: {
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "Cache-Control": "no-cache",
      Pragma: "no-cache"
    },
    source_key: "calopps",
    source_family: CALOPPS_SOURCE_FAMILY,
    rateLimitMs: CALOPPS_RATE_LIMIT_WAIT_MS
  };
}

function responseStatus(payload) {
  return Number(payload?.status || payload?.statusCode || 200);
}

async function payloadToText(payload) {
  if (typeof payload === "string") return payload;
  if (typeof payload?.text === "function") return payload.text();
  if (typeof payload?.body === "string") return payload.body;
  if (typeof payload?.html === "string") return payload.html;
  return "";
}

function assertCaloppsFinalHost(finalUrl, fallbackUrl) {
  const value = clean(finalUrl || fallbackUrl);
  try {
    const host = new URL(value).hostname.toLowerCase();
    if (supportedCaloppsHost(host)) return;
  } catch {
    // Fall through to the source error below.
  }
  throw makeSourceFetchError("unexpected_redirect_host", `CalOpps URL redirected to unexpected host: ${value}`, {
    url: value
  });
}

async function fetchHtml(url, options, target) {
  const payload = typeof options.fetcher === "function"
    ? await options.fetcher(url, target)
    : await safeFetch(url, target);
  const status = responseStatus(payload);
  if (status < 200 || status >= 300 || payload?.ok === false) {
    const body = await payloadToText(payload);
    throw makeSourceFetchError("fetch_failed", `CalOpps request failed (${status}): ${body.slice(0, 180)}`, {
      status,
      url: clean(payload?.url || url)
    });
  }
  const finalUrl = clean(payload?.url || payload?.__sourceFetchFinalUrl || url);
  assertCaloppsFinalHost(finalUrl, url);
  return {
    finalUrl,
    html: await payloadToText(payload)
  };
}

function createFetchList(dependencies = {}) {
  const discover = typeof dependencies.discover === "function" ? dependencies.discover : createDiscover();

  return async function fetchCaloppsSourceList(company = {}, options = {}) {
    const discovered = discover(company);
    if (discovered?.ok === false) {
      throw makeSourceFetchError(discovered.reason || "unsupported_calopps_source", "CalOpps source has no supported public list route", {
        url: company.url_string
      });
    }

    const pageLimit = Math.max(1, Math.min(100, Number(options.maxPages || options.pageLimit || 25) || 25));
    const target = requestTarget();
    const htmlPages = [];
    let nextPageUrl = clean(discovered.list_url);
    let finalUrl = nextPageUrl;
    let fetchedPages = 0;

    while (nextPageUrl && fetchedPages < pageLimit) {
      const page = await fetchHtml(nextPageUrl, options, target);
      htmlPages.push(page.html);
      finalUrl = page.finalUrl || nextPageUrl;
      fetchedPages += 1;
      nextPageUrl = extractCaloppsNextPageUrl(page.html, finalUrl);
    }

    return {
      html_pages: htmlPages,
      __sourceConfig: {
        ...(discovered.config || {}),
        listUrl: discovered.list_url,
        fetched_pages: fetchedPages,
        max_pages: pageLimit
      },
      __sourceFetchFinalUrl: finalUrl,
      __sourceRequest: {
        listUrl: discovered.list_url,
        rateLimitMs: CALOPPS_RATE_LIMIT_WAIT_MS
      }
    };
  };
}

module.exports = {
  CALOPPS_RATE_LIMIT_WAIT_MS,
  createFetchList
};
