const { safeFetch } = require("../../safeFetch");
const {
  HIBOB_SOURCE_FAMILY,
  buildCompanyContext,
  clean,
  createDiscover,
  parseHibobCompany,
  supportedHibobHost
} = require("./discover");

const HIBOB_RATE_LIMIT_WAIT_MS = 60 * 1000;

function makeSourceFetchError(reason, message, details = {}) {
  const error = new Error(message);
  error.ingestionErrorType = reason;
  Object.assign(error, details);
  return error;
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

async function payloadToJson(payload) {
  if (typeof payload?.json === "function") return payload.json();
  if (typeof payload?.body === "string") return JSON.parse(payload.body || "{}");
  if (typeof payload === "string") return JSON.parse(payload || "{}");
  return payload;
}

function assertHibobFinalHost(finalUrl, fallbackUrl) {
  const value = clean(finalUrl || fallbackUrl);
  try {
    const host = new URL(value).hostname.toLowerCase();
    if (supportedHibobHost(host)) return;
  } catch {
    // Fall through to source error.
  }
  throw makeSourceFetchError("unexpected_redirect_host", `HiBob URL redirected to unexpected host: ${value}`, {
    url: value
  });
}

function buildBoardHeaders() {
  return {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9"
  };
}

function buildApiHeaders(config, boardUrl) {
  return {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    Accept: "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    Referer: boardUrl,
    Origin: clean(config.baseOrigin)
  };
}

async function fetchPayload(url, target, options) {
  if (typeof options.fetcher === "function") return options.fetcher(url, target);
  return safeFetch(url, target);
}

function assertOk(payload, url, label) {
  const status = responseStatus(payload);
  if (status >= 200 && status < 300 && payload?.ok !== false) return;
  throw makeSourceFetchError("fetch_failed", `HiBob ${label} request failed (${status})`, {
    status,
    url: clean(payload?.url || url)
  });
}

function withFinalConfig(config, finalUrl, apiUrl) {
  return {
    ...config,
    apiUrl: clean(finalUrl || apiUrl)
  };
}

function createFetchList(dependencies = {}) {
  const discover = typeof dependencies.discover === "function" ? dependencies.discover : createDiscover();

  return async function fetchHibobSourceList(company = {}, options = {}) {
    const context = buildCompanyContext(company);
    const discovered = discover(context);
    const config = discovered?.config?.apiUrl
      ? discovered.config
      : parseHibobCompany(context.url_string);
    const boardUrl = clean(config?.boardUrl);
    const apiUrl = clean(config?.apiUrl || discovered?.list_url);
    if (!boardUrl || !apiUrl || config?.error) {
      throw makeSourceFetchError("no_public_jobs_route", "HiBob source has no supported careers board route", {
        url: context.url_string
      });
    }

    const boardTarget = {
      method: "GET",
      headers: buildBoardHeaders(),
      source_key: "hibob",
      source_family: HIBOB_SOURCE_FAMILY,
      rateLimitMs: HIBOB_RATE_LIMIT_WAIT_MS
    };
    const boardPayload = await fetchPayload(boardUrl, boardTarget, options);
    assertOk(boardPayload, boardUrl, "board");
    const finalBoardUrl = clean(boardPayload?.url || boardPayload?.__sourceFetchFinalUrl || boardUrl);
    assertHibobFinalHost(finalBoardUrl, boardUrl);
    await payloadToText(boardPayload);

    const apiTarget = {
      method: "GET",
      headers: buildApiHeaders(config, finalBoardUrl),
      source_key: "hibob",
      source_family: HIBOB_SOURCE_FAMILY,
      rateLimitMs: HIBOB_RATE_LIMIT_WAIT_MS
    };
    const apiPayload = await fetchPayload(apiUrl, apiTarget, options);
    assertOk(apiPayload, apiUrl, "API");
    const finalApiUrl = clean(apiPayload?.url || apiPayload?.__sourceFetchFinalUrl || apiUrl);
    assertHibobFinalHost(finalApiUrl, apiUrl);
    const body = await payloadToJson(apiPayload);
    const json = body && typeof body === "object" && !Array.isArray(body) ? body : { jobAdDetails: [] };

    return {
      ...json,
      __sourceConfig: withFinalConfig(config, finalApiUrl, apiUrl),
      __sourceFetchFinalUrl: finalApiUrl,
      __sourceRequest: {
        boardUrl,
        apiUrl,
        rateLimitMs: HIBOB_RATE_LIMIT_WAIT_MS
      }
    };
  };
}

module.exports = {
  HIBOB_RATE_LIMIT_WAIT_MS,
  createFetchList
};
