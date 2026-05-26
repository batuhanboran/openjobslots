"use strict";

const { safeFetch } = require("../../safeFetch");
const {
  buildStatejobsnyWindowUrl,
  parseStatejobsnyPostingsFromHtml
} = require("./parse");
const {
  STATEJOBSNY_SOURCE_FAMILY,
  clean,
  createDiscover,
  supportedStatejobsnyHost
} = require("./discover");

const STATEJOBSNY_RATE_LIMIT_WAIT_MS = 60 * 1000;

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
    source_key: "statejobsny",
    source_family: STATEJOBSNY_SOURCE_FAMILY,
    rateLimitMs: STATEJOBSNY_RATE_LIMIT_WAIT_MS
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

function assertStatejobsnyFinalHost(finalUrl, fallbackUrl) {
  const value = clean(finalUrl || fallbackUrl);
  try {
    const host = new URL(value).hostname.toLowerCase();
    if (supportedStatejobsnyHost(host)) return;
  } catch {
    // Fall through to the source error below.
  }
  throw makeSourceFetchError("unexpected_redirect_host", `StateJobsNY URL redirected to unexpected host: ${value}`, {
    url: value
  });
}

function resolveReferenceDate(options = {}) {
  if (options.referenceDate) return new Date(options.referenceDate);
  if (typeof options.now === "function") return new Date(options.now());
  return new Date();
}

async function fetchHtml(url, options, target) {
  const payload = typeof options.fetcher === "function"
    ? await options.fetcher(url, target)
    : await safeFetch(url, target);
  const status = responseStatus(payload);
  if (status < 200 || status >= 300 || payload?.ok === false) {
    const body = await payloadToText(payload);
    throw makeSourceFetchError("fetch_failed", `StateJobsNY request failed (${status}): ${body.slice(0, 180)}`, {
      status,
      url: clean(payload?.url || url)
    });
  }
  const finalUrl = clean(payload?.url || payload?.__sourceFetchFinalUrl || url);
  assertStatejobsnyFinalHost(finalUrl, url);
  return {
    finalUrl,
    html: await payloadToText(payload)
  };
}

function createFetchList(dependencies = {}) {
  const discover = typeof dependencies.discover === "function" ? dependencies.discover : createDiscover();

  return async function fetchStatejobsnySourceList(company = {}, options = {}) {
    const discovered = discover(company);
    if (discovered?.ok === false) {
      throw makeSourceFetchError(discovered.reason || "unsupported_statejobsny_source", "StateJobsNY source has no supported public list route", {
        url: company.url_string
      });
    }

    const listUrl = buildStatejobsnyWindowUrl(resolveReferenceDate(options));
    const target = requestTarget();
    const list = await fetchHtml(listUrl, options, target);
    const detailLimit = Math.max(0, Math.min(25, Number(options.detailLimit || 0) || 0));
    const detailHtmlBySourceJobId = {};
    let detailFetchCount = 0;

    if (detailLimit > 0) {
      const listPostings = parseStatejobsnyPostingsFromHtml(list.html, list.finalUrl || listUrl);
      for (const posting of listPostings.slice(0, detailLimit)) {
        const detailUrl = clean(posting.job_posting_url);
        const sourceJobId = clean(posting.source_job_id);
        if (!detailUrl || !sourceJobId) continue;
        const detail = await fetchHtml(detailUrl, options, target);
        detailHtmlBySourceJobId[sourceJobId] = detail.html;
        detailFetchCount += 1;
      }
    }

    return {
      html: list.html,
      detail_html_by_source_job_id: detailHtmlBySourceJobId,
      __sourceConfig: {
        ...(discovered.config || {}),
        listUrl,
        detail_fetch_count: detailFetchCount
      },
      __sourceFetchFinalUrl: list.finalUrl || listUrl,
      __sourceRequest: {
        listUrl,
        rateLimitMs: STATEJOBSNY_RATE_LIMIT_WAIT_MS
      }
    };
  };
}

module.exports = {
  STATEJOBSNY_RATE_LIMIT_WAIT_MS,
  createFetchList
};
