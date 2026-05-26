const { safeFetch } = require("../../safeFetch");
const {
  JOBAPS_SOURCE_FAMILY,
  buildCompanyContext,
  clean,
  createDiscover,
  parseJobApsCompany,
  supportedJobApsHost
} = require("./discover");

const JOBAPS_RATE_LIMIT_WAIT_MS = 60 * 1000;

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
    "User-Agent": "OpenJobSlotsBot/1.0 (+https://openjobslots.com)"
  };
}

async function payloadToHtml(payload) {
  if (typeof payload === "string") return payload;
  if (typeof payload?.text === "function") return payload.text();
  if (typeof payload?.body === "string") return payload.body;
  if (typeof payload?.html === "string") return payload.html;
  return "";
}

function assertJobApsFinalHost(finalUrl, fallbackUrl) {
  const value = clean(finalUrl || fallbackUrl);
  try {
    const host = new URL(value).hostname.toLowerCase();
    if (supportedJobApsHost(host)) return;
  } catch {
    // Fall through to the source error below.
  }
  throw makeSourceFetchError("unexpected_redirect_host", `JobAps URL redirected to unexpected host: ${value}`, {
    url: value
  });
}

function withFinalConfig(config, finalUrl, fallbackUrl) {
  const value = clean(finalUrl || fallbackUrl);
  const finalConfig = {
    ...config,
    boardUrl: value || clean(config?.boardUrl)
  };
  try {
    const parsed = new URL(value);
    finalConfig.host = parsed.hostname.toLowerCase();
    finalConfig.baseOrigin = `${parsed.protocol}//${parsed.host}`;
  } catch {
    // Keep the discovered host/origin.
  }
  return finalConfig;
}

function createFetchList(dependencies = {}) {
  const discover = typeof dependencies.discover === "function" ? dependencies.discover : createDiscover();

  return async function fetchJobApsSourceList(company = {}, options = {}) {
    const context = buildCompanyContext(company);
    const discovered = discover(context);
    const config = discovered?.config?.boardUrl
      ? discovered.config
      : parseJobApsCompany(context.url_string);
    const boardUrl = clean(config?.boardUrl || discovered?.list_url);
    if (!boardUrl) {
      throw makeSourceFetchError("no_public_jobs_route", "JobAps source has no supported jobs route", {
        url: context.url_string
      });
    }

    const target = {
      method: "GET",
      headers: buildHeaders(),
      source_key: "jobaps",
      source_family: JOBAPS_SOURCE_FAMILY,
      rateLimitMs: JOBAPS_RATE_LIMIT_WAIT_MS
    };

    if (typeof options.fetcher === "function") {
      const payload = await options.fetcher(boardUrl, target);
      const status = responseStatus(payload);
      if (status < 200 || status >= 300) {
        throw makeSourceFetchError("fetch_failed", `JobAps page request failed (${status})`, {
          status,
          url: boardUrl
        });
      }
      const finalUrl = clean(payload?.url || payload?.__sourceFetchFinalUrl || boardUrl);
      assertJobApsFinalHost(finalUrl, boardUrl);
      return {
        html: await payloadToHtml(payload),
        __sourceConfig: withFinalConfig(config, finalUrl, boardUrl),
        __sourceFetchFinalUrl: finalUrl,
        __sourceRequest: {
          boardUrl,
          rateLimitMs: JOBAPS_RATE_LIMIT_WAIT_MS
        }
      };
    }

    const response = await safeFetch(boardUrl, target);
    if (!response.ok) {
      const body = await response.text();
      throw makeSourceFetchError("fetch_failed", `JobAps page request failed (${response.status}): ${body.slice(0, 180)}`, {
        status: response.status,
        url: response.url || boardUrl
      });
    }
    const finalUrl = clean(response.url || boardUrl);
    assertJobApsFinalHost(finalUrl, boardUrl);
    return {
      html: await response.text(),
      __sourceConfig: withFinalConfig(config, finalUrl, boardUrl),
      __sourceFetchFinalUrl: finalUrl,
      __sourceRequest: {
        boardUrl,
        rateLimitMs: JOBAPS_RATE_LIMIT_WAIT_MS
      }
    };
  };
}

module.exports = {
  JOBAPS_RATE_LIMIT_WAIT_MS,
  createFetchList
};
