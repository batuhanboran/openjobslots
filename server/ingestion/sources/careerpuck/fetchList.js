const { safeFetch } = require("../../safeFetch");
const {
  CAREERPUCK_SOURCE_FAMILY,
  buildCompanyContext,
  clean,
  createDiscover,
  parseCareerpuckCompany,
  supportedCareerpuckApiHost
} = require("./discover");

const CAREERPUCK_RATE_LIMIT_WAIT_MS = 60 * 1000;

function makeSourceFetchError(reason, message, details = {}) {
  const error = new Error(message);
  error.ingestionErrorType = reason;
  Object.assign(error, details);
  return error;
}

function responseStatus(payload) {
  return Number(payload?.status || payload?.statusCode || 200);
}

async function payloadToJson(payload) {
  if (typeof payload?.json === "function") return payload.json();
  if (typeof payload?.body === "string") return JSON.parse(payload.body);
  if (typeof payload === "string") return JSON.parse(payload);
  return payload;
}

function assertCareerpuckApiHost(finalUrl, fallbackUrl) {
  const value = clean(finalUrl || fallbackUrl);
  try {
    const host = new URL(value).hostname.toLowerCase();
    if (supportedCareerpuckApiHost(host)) return;
  } catch {
    // Fall through to the source error below.
  }
  throw makeSourceFetchError("unexpected_redirect_host", `CareerPuck API URL redirected to unexpected host: ${value}`, {
    url: value
  });
}

function withFinalConfig(config, finalUrl, fallbackUrl) {
  const value = clean(finalUrl || fallbackUrl);
  return {
    ...config,
    apiUrl: value || clean(config?.apiUrl)
  };
}

function createFetchList(dependencies = {}) {
  const discover = typeof dependencies.discover === "function" ? dependencies.discover : createDiscover();

  return async function fetchCareerpuckSourceList(company = {}, options = {}) {
    const context = buildCompanyContext(company);
    const discovered = discover(context);
    const config = discovered?.config?.apiUrl
      ? discovered.config
      : parseCareerpuckCompany(context.url_string);
    const apiUrl = clean(config?.apiUrl || discovered?.list_url);
    if (!apiUrl) {
      throw makeSourceFetchError("no_public_jobs_route", "CareerPuck source has no supported job-board route", {
        url: context.url_string
      });
    }

    const target = {
      method: "GET",
      headers: {
        Accept: "application/json, text/plain, */*"
      },
      source_key: "careerpuck",
      source_family: CAREERPUCK_SOURCE_FAMILY,
      rateLimitMs: CAREERPUCK_RATE_LIMIT_WAIT_MS
    };

    const payload = typeof options.fetcher === "function"
      ? await options.fetcher(apiUrl, target)
      : await safeFetch(apiUrl, target);
    const status = responseStatus(payload);
    if (status < 200 || status >= 300 || payload?.ok === false) {
      let body = "";
      if (typeof payload?.text === "function") body = await payload.text();
      if (!body && typeof payload?.body === "string") body = payload.body;
      throw makeSourceFetchError("fetch_failed", `CareerPuck API request failed (${status}): ${body.slice(0, 180)}`, {
        status,
        url: clean(payload?.url || apiUrl)
      });
    }

    const finalUrl = clean(payload?.url || payload?.__sourceFetchFinalUrl || apiUrl);
    assertCareerpuckApiHost(finalUrl, apiUrl);
    const body = await payloadToJson(payload);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return {
        jobs: [],
        __sourceConfig: withFinalConfig(config, finalUrl, apiUrl),
        __sourceFetchFinalUrl: finalUrl,
        __sourceRequest: {
          apiUrl,
          rateLimitMs: CAREERPUCK_RATE_LIMIT_WAIT_MS
        }
      };
    }

    return {
      ...body,
      __sourceConfig: withFinalConfig(config, finalUrl, apiUrl),
      __sourceFetchFinalUrl: finalUrl,
      __sourceRequest: {
        apiUrl,
        rateLimitMs: CAREERPUCK_RATE_LIMIT_WAIT_MS
      }
    };
  };
}

module.exports = {
  CAREERPUCK_RATE_LIMIT_WAIT_MS,
  createFetchList
};
