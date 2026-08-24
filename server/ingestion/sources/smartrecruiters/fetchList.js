"use strict";

const { safeFetch } = require("../../safeFetch");
const { parseSmartRecruitersCompany } = require("./discover");

function buildSourceError(code, message, details = {}) {
  const error = new Error(message);
  error.ingestionErrorType = code;
  Object.assign(error, details);
  return error;
}

function assertSmartRecruitersHost(targetUrl, fallbackUrl) {
  const value = String(targetUrl || fallbackUrl || "").trim();
  try {
    const host = new URL(value).hostname.toLowerCase();
    if (
      host === "api.smartrecruiters.com"
      || host === "jobs.smartrecruiters.com"
      || host === "www.jobs.smartrecruiters.com"
    ) return;
  } catch {
    // fall through to explicit error below
  }
  throw buildSourceError(
    "unexpected_host",
    `SmartRecruiters API URL redirected to unexpected host: ${value}`,
    { url: value }
  );
}

async function fetchJson(url, init = {}) {
  const response = await safeFetch(url, {
    ...init,
    headers: {
      Accept: "application/json, text/plain, */*",
      "User-Agent": "OpenJobSlotsBot/1.0 (+https://openjobslots.com)",
      ...(init.headers || {})
    }
  });
  if (!response.ok) {
    const body = await response.text();
    throw buildSourceError(
      "fetch_failed",
      `SmartRecruiters request failed (${response.status}): ${body.slice(0, 180)}`,
      { status: response.status, url }
    );
  }
  assertSmartRecruitersHost(response.url || url, url);
  const payload = await response.json();
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    return {
      ...payload,
      __sourceFetchFinalUrl: response.url || url
    };
  }
  return payload;
}

function createFetchList(discover) {
  return async function fetchList(company = {}, options = {}) {
    const target = discover(company);
    const config = target?.config?.postingsUrl
      ? target.config
      : parseSmartRecruitersCompany(company.url_string || company.company_url || company.url);
    if (!config?.postingsUrl) {
      return {
        content: [],
        __sourceConfig: config || {}
      };
    }

    const maxPages = Math.max(1, Math.min(50, Number(options.maxPages || 25) || 25));
    const content = [];
    let requestUrl = config.postingsUrl;
    let lastPayload = {};
    let pageCount = 0;

    while (requestUrl && pageCount < maxPages) {
      const requestTarget = {
        ...target,
        list_url: requestUrl,
        method: "GET",
        headers: {
          Accept: "application/json, text/plain, */*"
        }
      };
      const payload = options.fetcher
        ? await options.fetcher(requestUrl, requestTarget)
        : await fetchJson(requestUrl, { method: "GET" });

      assertSmartRecruitersHost(payload?.__sourceFetchFinalUrl || payload?.url || requestUrl, requestUrl);
      lastPayload = payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {};
      const batch = Array.isArray(lastPayload.content)
        ? lastPayload.content
        : Array.isArray(payload)
          ? payload
          : [];
      content.push(...batch);
      pageCount += 1;

      const offset = Math.max(0, Number(lastPayload.offset || 0) || 0);
      const responseLimit = Math.max(1, Number(lastPayload.limit || 100) || 100);
      const totalFound = Math.max(0, Number(lastPayload.totalFound || 0) || 0);
      const nextOffset = offset + responseLimit;
      if (batch.length === 0 || (totalFound > 0 && nextOffset >= totalFound)) break;
      if (totalFound === 0 && batch.length < responseLimit) break;
      const nextUrl = new URL(config.postingsUrl);
      nextUrl.searchParams.set("offset", String(nextOffset));
      requestUrl = nextUrl.toString();
    }

    return {
      ...lastPayload,
      content,
      offset: 0,
      totalFound: Number(lastPayload.totalFound || content.length),
      __sourceConfig: config,
      __sourcePagination: {
        maxPages,
        pagesFetched: pageCount,
        truncated: pageCount >= maxPages && content.length < Number(lastPayload.totalFound || content.length)
      }
    };
  };
}

module.exports = {
  assertSmartRecruitersHost,
  createFetchList
};
