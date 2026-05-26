const { safeFetch } = require("../../safeFetch");
const {
  GETRO_SOURCE_FAMILY,
  buildCompanyContext,
  clean,
  createDiscover,
  parseGetroCompany,
  supportedGetroHost
} = require("./discover");

const GETRO_RATE_LIMIT_WAIT_MS = 60 * 1000;

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
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Cache-Control": "no-cache",
    Pragma: "no-cache",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
  };
}

async function payloadToHtml(payload) {
  if (typeof payload === "string") return payload;
  if (typeof payload?.text === "function") return payload.text();
  if (typeof payload?.body === "string") return payload.body;
  if (typeof payload?.html === "string") return payload.html;
  return "";
}

function assertGetroFinalHost(finalUrl, fallbackUrl) {
  const value = clean(finalUrl || fallbackUrl);
  try {
    const host = new URL(value).hostname.toLowerCase();
    if (supportedGetroHost(host)) return;
  } catch {
    // Fall through to the source error below.
  }
  throw makeSourceFetchError("unexpected_redirect_host", `Getro URL redirected to unexpected host: ${value}`, {
    url: value
  });
}

function withFinalConfig(config, finalUrl, fallbackUrl) {
  const value = clean(finalUrl || fallbackUrl);
  const finalConfig = {
    ...config,
    jobsUrl: value || clean(config?.jobsUrl)
  };
  try {
    const parsed = new URL(value);
    finalConfig.host = parsed.hostname.toLowerCase();
    finalConfig.baseOrigin = `${parsed.protocol}//${parsed.host}`;
  } catch {
    // Keep discovered config.
  }
  return finalConfig;
}

function createFetchList(dependencies = {}) {
  const discover = typeof dependencies.discover === "function" ? dependencies.discover : createDiscover();

  return async function fetchGetroSourceList(company = {}, options = {}) {
    const context = buildCompanyContext(company);
    const discovered = discover(context);
    const config = discovered?.config?.jobsUrl
      ? discovered.config
      : parseGetroCompany(context.url_string);
    const jobsUrl = clean(config?.jobsUrl || discovered?.list_url);
    if (!jobsUrl) {
      throw makeSourceFetchError("no_public_jobs_route", "Getro source has no supported jobs route", {
        url: context.url_string
      });
    }

    const target = {
      method: "GET",
      headers: buildHeaders(),
      source_key: "getro",
      source_family: GETRO_SOURCE_FAMILY,
      rateLimitMs: GETRO_RATE_LIMIT_WAIT_MS
    };

    if (typeof options.fetcher === "function") {
      const payload = await options.fetcher(jobsUrl, target);
      const status = responseStatus(payload);
      if (status < 200 || status >= 300) {
        throw makeSourceFetchError("fetch_failed", `Getro page request failed (${status})`, {
          status,
          url: jobsUrl
        });
      }
      const finalUrl = clean(payload?.url || payload?.__sourceFetchFinalUrl || jobsUrl);
      assertGetroFinalHost(finalUrl, jobsUrl);
      return {
        html: await payloadToHtml(payload),
        __sourceConfig: withFinalConfig(config, finalUrl, jobsUrl),
        __sourceFetchFinalUrl: finalUrl,
        __sourceRequest: {
          jobsUrl,
          rateLimitMs: GETRO_RATE_LIMIT_WAIT_MS
        }
      };
    }

    const response = await safeFetch(jobsUrl, target);
    if (!response.ok) {
      const body = await response.text();
      throw makeSourceFetchError("fetch_failed", `Getro page request failed (${response.status}): ${body.slice(0, 180)}`, {
        status: response.status,
        url: response.url || jobsUrl
      });
    }
    const finalUrl = clean(response.url || jobsUrl);
    assertGetroFinalHost(finalUrl, jobsUrl);
    return {
      html: await response.text(),
      __sourceConfig: withFinalConfig(config, finalUrl, jobsUrl),
      __sourceFetchFinalUrl: finalUrl,
      __sourceRequest: {
        jobsUrl,
        rateLimitMs: GETRO_RATE_LIMIT_WAIT_MS
      }
    };
  };
}

module.exports = {
  GETRO_RATE_LIMIT_WAIT_MS,
  createFetchList
};
