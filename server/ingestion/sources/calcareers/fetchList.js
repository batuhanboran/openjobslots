"use strict";

const { safeFetch } = require("../../safeFetch");
const {
  buildCalcareersPostPayload,
  extractCalcareersHiddenInputs,
  extractCalcareersPagerTargets
} = require("./parse");
const {
  CALCAREERS_LIST_URL,
  CALCAREERS_SOURCE_FAMILY,
  clean,
  createDiscover,
  supportedCalcareersHost
} = require("./discover");

const CALCAREERS_RATE_LIMIT_WAIT_MS = 60 * 1000;

function makeSourceFetchError(reason, message, details = {}) {
  const error = new Error(message);
  error.ingestionErrorType = reason;
  Object.assign(error, details);
  return error;
}

function requestTarget(method = "GET", body = "") {
  return {
    method,
    headers: {
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "Cache-Control": "no-cache",
      "Content-Type": "application/x-www-form-urlencoded",
      Pragma: "no-cache",
      Referer: CALCAREERS_LIST_URL
    },
    body,
    source_key: "calcareers",
    source_family: CALCAREERS_SOURCE_FAMILY,
    rateLimitMs: CALCAREERS_RATE_LIMIT_WAIT_MS
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

function assertCalcareersFinalHost(finalUrl, fallbackUrl) {
  const value = clean(finalUrl || fallbackUrl);
  try {
    const host = new URL(value).hostname.toLowerCase();
    if (supportedCalcareersHost(host)) return;
  } catch {
    // Fall through to the source error below.
  }
  throw makeSourceFetchError("unexpected_redirect_host", `CalCareers URL redirected to unexpected host: ${value}`, {
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
    throw makeSourceFetchError("fetch_failed", `CalCareers request failed (${status}): ${body.slice(0, 180)}`, {
      status,
      url: clean(payload?.url || url)
    });
  }
  const finalUrl = clean(payload?.url || payload?.__sourceFetchFinalUrl || url);
  assertCalcareersFinalHost(finalUrl, url);
  return {
    finalUrl,
    html: await payloadToText(payload)
  };
}

function postTarget(hidden, eventTarget, extra = {}) {
  const payload = buildCalcareersPostPayload(hidden, eventTarget);
  Object.assign(payload, extra);
  return requestTarget("POST", new URLSearchParams(payload).toString());
}

function createFetchList(dependencies = {}) {
  const discover = typeof dependencies.discover === "function" ? dependencies.discover : createDiscover();

  return async function fetchCalcareersSourceList(company = {}, options = {}) {
    const discovered = discover(company);
    if (discovered?.ok === false) {
      throw makeSourceFetchError(discovered.reason || "unsupported_calcareers_source", "CalCareers source has no supported public list route", {
        url: company.url_string
      });
    }

    const listUrl = clean(discovered.list_url || discovered.config?.listUrl || CALCAREERS_LIST_URL);
    const maxPages = Math.max(1, Math.min(10, Number(options.maxPages || 3) || 3));
    const htmlPages = [];

    const landing = await fetchHtml(listUrl, options, requestTarget("GET"));
    let hidden = extractCalcareersHiddenInputs(landing.html);

    const search = await fetchHtml(
      listUrl,
      options,
      postTarget(hidden, "ctl00$cphMainContent$btnSearch")
    );
    htmlPages.push(search.html);
    hidden = extractCalcareersHiddenInputs(search.html);

    if (htmlPages.length < maxPages) {
      const rowCount = await fetchHtml(
        listUrl,
        options,
        postTarget(hidden, "ctl00$cphMainContent$ddlRowCount", {
          "ctl00$cphMainContent$ddlRowCount": "100"
        })
      );
      htmlPages.push(rowCount.html);
      hidden = extractCalcareersHiddenInputs(rowCount.html);
    }

    const pendingTargets = extractCalcareersPagerTargets(htmlPages[htmlPages.length - 1] || search.html);
    const visitedTargets = new Set();
    while (htmlPages.length < maxPages && pendingTargets.length > 0) {
      const eventTarget = pendingTargets.shift();
      if (!eventTarget || visitedTargets.has(eventTarget)) continue;
      visitedTargets.add(eventTarget);

      const page = await fetchHtml(listUrl, options, postTarget(hidden, eventTarget));
      htmlPages.push(page.html);
      hidden = extractCalcareersHiddenInputs(page.html);
      for (const target of extractCalcareersPagerTargets(page.html)) {
        if (!visitedTargets.has(target) && !pendingTargets.includes(target)) {
          pendingTargets.push(target);
        }
      }
    }

    return {
      html_pages: htmlPages,
      html: htmlPages.join("\n"),
      __sourceConfig: {
        ...(discovered.config || {}),
        listUrl,
        fetched_pages: htmlPages.length
      },
      __sourceFetchFinalUrl: search.finalUrl || landing.finalUrl || listUrl,
      __sourceRequest: {
        listUrl,
        rateLimitMs: CALCAREERS_RATE_LIMIT_WAIT_MS
      }
    };
  };
}

module.exports = {
  CALCAREERS_RATE_LIMIT_WAIT_MS,
  createFetchList
};
