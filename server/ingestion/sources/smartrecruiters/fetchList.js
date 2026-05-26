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
    if (host === "jobs.smartrecruiters.com" || host === "www.jobs.smartrecruiters.com") return;
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
    const config = target?.config?.searchUrl
      ? target.config
      : parseSmartRecruitersCompany(company.url_string || company.company_url || company.url);
    if (!config?.searchUrl) {
      return {
        content: [],
        __sourceConfig: config || {}
      };
    }

    const requestTarget = {
      ...target,
      method: "GET",
      headers: {
        Accept: "application/json, text/plain, */*"
      }
    };
    const payload = options.fetcher
      ? await options.fetcher(config.searchUrl, requestTarget)
      : await fetchJson(config.searchUrl, { method: "GET" });

    assertSmartRecruitersHost(payload?.__sourceFetchFinalUrl || payload?.url || config.searchUrl, config.searchUrl);
    if (payload && typeof payload === "object" && !Array.isArray(payload)) {
      return {
        ...payload,
        __sourceConfig: config
      };
    }
    return {
      content: Array.isArray(payload) ? payload : [],
      __sourceConfig: config
    };
  };
}

module.exports = {
  assertSmartRecruitersHost,
  createFetchList
};
