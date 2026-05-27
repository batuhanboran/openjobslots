"use strict";

const { safeFetch } = require("../../safeFetch");
const {
  THEAPPLICANTMANAGER_SOURCE_FAMILY,
  buildCompanyContext,
  clean,
  createDiscover,
  isSupportedTheApplicantManagerHost
} = require("./discover");

const THEAPPLICANTMANAGER_RATE_LIMIT_WAIT_MS = 60 * 1000;

function makeSourceFetchError(reason, message, details = {}) {
  const error = new Error(message);
  error.ingestionErrorType = reason;
  Object.assign(error, details);
  return error;
}

function responseStatus(payload) {
  return Number(payload?.status || payload?.statusCode || 200);
}

function buildHeaders() {
  return {
    Accept: "text/html,application/xhtml+xml",
    "Accept-Language": "en-US,en;q=0.9",
    "Cache-Control": "no-cache",
    Pragma: "no-cache",
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
  };
}

async function payloadToHtml(payload) {
  if (typeof payload === "string") return payload;
  if (typeof payload?.text === "function") return payload.text();
  if (typeof payload?.body === "string") return payload.body;
  if (typeof payload?.html === "string") return payload.html;
  return "";
}

function assertTheApplicantManagerFinalHost(finalUrl, fallbackUrl) {
  const value = clean(finalUrl || fallbackUrl);
  try {
    const host = new URL(value).hostname.toLowerCase();
    if (isSupportedTheApplicantManagerHost(host)) return;
  } catch {
    // Fall through to the source error below.
  }
  throw makeSourceFetchError("unexpected_redirect_host", `TheApplicantManager URL redirected to unexpected host: ${value}`, {
    url: value
  });
}

function withFinalConfig(config, finalUrl, fallbackUrl) {
  const value = clean(finalUrl || fallbackUrl);
  let baseOrigin = clean(config?.baseOrigin);
  try {
    const parsed = new URL(value);
    baseOrigin = `${parsed.protocol}//${parsed.host}`;
  } catch {
    // Keep the discovered origin.
  }
  return {
    ...config,
    baseOrigin,
    careersUrl: value || clean(config?.careersUrl)
  };
}

function createFetchList(dependencies = {}) {
  const discover = typeof dependencies.discover === "function" ? dependencies.discover : createDiscover();

  return async function fetchTheApplicantManagerSourceList(company = {}, options = {}) {
    const context = buildCompanyContext(company);
    const discovered = discover(context);
    const config = discovered?.config || {};
    const careersUrl = clean(config.careersUrl || discovered?.list_url);
    if (!careersUrl) {
      throw makeSourceFetchError("no_public_jobs_route", "TheApplicantManager source has no supported careers route");
    }

    const target = {
      method: "GET",
      headers: buildHeaders(),
      source_key: "theapplicantmanager",
      source_family: THEAPPLICANTMANAGER_SOURCE_FAMILY,
      rateLimitMs: THEAPPLICANTMANAGER_RATE_LIMIT_WAIT_MS
    };

    if (typeof options.fetcher === "function") {
      const payload = await options.fetcher(careersUrl, target);
      const status = responseStatus(payload);
      if (status < 200 || status >= 300) {
        throw makeSourceFetchError("fetch_failed", `TheApplicantManager page request failed (${status})`, {
          status,
          url: careersUrl
        });
      }
      const finalUrl = clean(payload?.url || payload?.__sourceFetchFinalUrl || careersUrl);
      assertTheApplicantManagerFinalHost(finalUrl, careersUrl);
      return {
        html: await payloadToHtml(payload),
        __sourceConfig: withFinalConfig(config, finalUrl, careersUrl),
        __sourceFetchFinalUrl: finalUrl,
        __sourceRequest: target
      };
    }

    const res = await safeFetch(careersUrl, target);
    if (!res.ok) {
      const body = await res.text();
      throw makeSourceFetchError(
        "fetch_failed",
        `TheApplicantManager page request failed (${res.status}): ${body.slice(0, 180)}`,
        { status: Number(res.status || 0), url: careersUrl }
      );
    }
    const finalUrl = clean(res.url || careersUrl);
    assertTheApplicantManagerFinalHost(finalUrl, careersUrl);
    return {
      html: await res.text(),
      __sourceConfig: withFinalConfig(config, finalUrl, careersUrl),
      __sourceFetchFinalUrl: finalUrl,
      __sourceRequest: target
    };
  };
}

module.exports = {
  THEAPPLICANTMANAGER_RATE_LIMIT_WAIT_MS,
  createFetchList
};
