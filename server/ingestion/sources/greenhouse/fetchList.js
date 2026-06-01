"use strict";

const { readLimitedResponseText, safeFetch } = require("../../safeFetch");
const {
  GREENHOUSE_SOURCE_FAMILY,
  buildCompanyContext,
  clean,
  createDiscover,
  greenhouseListUrl,
  parseGreenhouseCompany
} = require("./discover");

const GREENHOUSE_RATE_LIMIT_WAIT_MS = 60 * 1000;
const GREENHOUSE_API_HOST = "boards-api.greenhouse.io";

function makeSourceFetchError(reason, message, details = {}) {
  const error = new Error(message);
  error.ingestionErrorType = reason;
  if (details.status) error.status = details.status;
  if (details.url) error.url = details.url;
  return error;
}

function responseStatus(payload) {
  const value = Number(payload?.status || payload?.statusCode || 200);
  return Number.isFinite(value) ? value : 200;
}

async function responseToText(payload) {
  if (typeof payload === "string") return payload;
  if (!payload || typeof payload !== "object") return "";
  if (typeof payload.text === "function") return payload.text();
  if (typeof payload.text === "string") return payload.text;
  if (typeof payload.body === "string") return payload.body;
  if (typeof payload.html === "string") return payload.html;
  return "";
}

async function parseJsonPayload(payload, finalUrl, label = "Greenhouse jobs API") {
  if (
    payload &&
    typeof payload === "object" &&
    !Array.isArray(payload) &&
    !("body" in payload) &&
    !("html" in payload) &&
    typeof payload.text !== "function"
  ) {
    return payload;
  }

  const body = await responseToText(payload);
  try {
    return JSON.parse(body || "{}");
  } catch {
    throw makeSourceFetchError(
      "non_json_api_response",
      `${label} response was not JSON: ${String(body).slice(0, 180)}`,
      { url: finalUrl }
    );
  }
}

function parseUrl(value) {
  try {
    return new URL(clean(value));
  } catch {
    return null;
  }
}

function assertGreenhouseHost(value, fallbackUrl) {
  const target = clean(value || fallbackUrl || "");
  const parsed = parseUrl(target);
  if (!parsed || String(parsed.hostname || "").toLowerCase() !== GREENHOUSE_API_HOST) {
    throw makeSourceFetchError(
      "unexpected_redirect_host",
      `Greenhouse API URL redirected to unexpected host: ${target}`,
      { url: target }
    );
  }
}

function isResponseTooLargeError(error) {
  return error?.ingestionErrorType === "response_too_large" || error?.code === "response_too_large";
}

function createFetchList(dependencies = {}) {
  const discover = typeof dependencies.discover === "function"
    ? dependencies.discover
    : createDiscover();

  return async function fetchGreenhouseSourceList(company = {}, options = {}) {
    const context = buildCompanyContext(company);
    const discovered = discover(context);
    const config = parseGreenhouseCompany(context.url_string) || discovered.config || {};

    if (!discovered.list_url) {
      throw makeSourceFetchError(
        "no_public_jobs_route",
        "Greenhouse company URL does not expose a usable public board token",
        { url: context.url_string }
      );
    }

    const requestTarget = {
      ...(options.target || {}),
      method: "GET",
      source_family: GREENHOUSE_SOURCE_FAMILY,
      source_key: "greenhouse",
      headers: {
        Accept: "application/json"
      }
    };

    async function fetchApiPayload(requestUrl) {
      const response = typeof options.fetcher === "function"
        ? await options.fetcher(requestUrl, requestTarget)
        : await safeFetch(requestUrl, {
          ...requestTarget,
          ...(options.fetchOptions || {})
        });

      const status = responseStatus(response);
      if (status < 200 || status >= 300) {
        const body = await responseToText(response);
        throw makeSourceFetchError(
          "fetch_failed",
          `Greenhouse jobs API request failed (${status}): ${String(body).slice(0, 180)}`,
          { status, url: clean(response?.url || requestUrl) }
        );
      }

      const finalUrl = clean(response?.url || response?.__sourceFetchFinalUrl || requestUrl);
      assertGreenhouseHost(finalUrl, requestUrl);

      let payload;
      try {
        payload = await parseJsonPayload(response, finalUrl);
      } catch (error) {
        if (typeof response.text === "function") {
          throw error;
        }

        if (typeof response?.body === "string" || typeof response?.html === "string") {
          throw error;
        }

        const text = await readLimitedResponseText(response, { sourceUrl: finalUrl }).catch(() => "");
        throw makeSourceFetchError(
          "non_json_api_response",
          `Greenhouse jobs API response was not JSON: ${String(text).slice(0, 180)}`,
          { url: finalUrl }
        );
      }

      return { payload, finalUrl };
    }

    let requestedListUrl = discovered.list_url;
    let contentIncluded = true;
    let result;
    try {
      result = await fetchApiPayload(requestedListUrl);
    } catch (error) {
      const fallbackListUrl = greenhouseListUrl(config, { includeContent: false });
      if (!isResponseTooLargeError(error) || !fallbackListUrl || fallbackListUrl === requestedListUrl) {
        throw error;
      }
      requestedListUrl = fallbackListUrl;
      contentIncluded = false;
      result = await fetchApiPayload(requestedListUrl);
    }

    const { payload, finalUrl } = result;
    const listUrl = greenhouseListUrl(config);
    const requestCount = {
      payloadFetches: contentIncluded ? 1 : 2,
      total: contentIncluded ? 1 : 2
    };

    return {
      ...(payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {}),
      __companyNameForPostings: config.boardToken || clean(context.company_name),
      __sourceConfig: {
        ...config,
        boardUrl: listUrl,
        companyNameForPostings: clean(context.company_name) || clean(config.boardTokenLower)
      },
      __sourceFetchFinalUrl: finalUrl,
      __sourceRequest: {
        boardUrl: listUrl,
        requestedUrl: requestedListUrl,
        finalUrl,
        requestCount,
        contentIncluded,
        rateLimitMs: GREENHOUSE_RATE_LIMIT_WAIT_MS
      }
    };
  };
}

module.exports = {
  GREENHOUSE_RATE_LIMIT_WAIT_MS,
  createFetchList,
  parseJsonPayload,
  responseToText
};
