"use strict";

const { safeFetch } = require("../../safeFetch");
const { buildEightfoldApiUrl, extractEightfoldDomainFromHtml } = require("./parse");
const {
  assertEightfoldFinalHost,
  buildCompanyContext,
  clean,
  createDiscover,
  parseEightfoldCompany
} = require("./discover");

const EIGHTFOLD_RATE_LIMIT_WAIT_MS = 60 * 1000;

function makeSourceFetchError(reason, message, details = {}) {
  const error = new Error(message);
  error.ingestionErrorType = reason;
  Object.assign(error, details);
  return error;
}

function responseStatus(payload) {
  return Number(payload?.status || payload?.statusCode || 200);
}

function buildBoardHeaders() {
  return {
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Cache-Control": "no-cache",
    Pragma: "no-cache",
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
  };
}

function buildApiHeaders(config) {
  return {
    Accept: "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    Referer: clean(config?.boardUrl || ""),
    Origin: clean(config?.siteBaseUrl || "")
  };
}

async function payloadToText(payload) {
  if (typeof payload === "string") return payload;
  if (typeof payload?.text === "function") return payload.text();
  if (typeof payload?.body === "string") return payload.body;
  if (typeof payload?.html === "string") return payload.html;
  return "";
}

async function payloadToJson(payload, errorPrefix) {
  if (
    payload &&
    typeof payload === "object" &&
    !Array.isArray(payload) &&
    typeof payload.text !== "function" &&
    typeof payload.json !== "function" &&
    !("body" in payload) &&
    !("html" in payload)
  ) {
    return payload;
  }
  if (typeof payload?.json === "function") {
    try {
      return await payload.json();
    } catch {
      throw makeSourceFetchError("non_json_api_response", `${errorPrefix} response was not JSON`, {});
    }
  }
  const bodyText = await payloadToText(payload);
  try {
    return JSON.parse(bodyText);
  } catch {
    throw makeSourceFetchError("non_json_api_response", `${errorPrefix} response was not JSON: ${bodyText.slice(0, 180)}`, {});
  }
}

function buildBoardTarget(config) {
  return {
    method: "GET",
    source_family: "enterprise_api",
    headers: buildBoardHeaders(),
    config
  };
}

function buildApiTarget(config, apiUrl) {
  return {
    method: "GET",
    source_family: "enterprise_api",
    headers: buildApiHeaders(config),
    config: {
      ...config,
      apiUrl
    }
  };
}

async function fetchBoardHtml(url, target, fetcher) {
  if (typeof fetcher === "function") {
    const payload = await fetcher(url, target);
    const status = responseStatus(payload);
    if (status < 200 || status >= 300) {
      const body = await payloadToText(payload);
      throw makeSourceFetchError("fetch_failed", `Eightfold careers page request failed (${status}): ${body.slice(0, 180)}`, {
        status,
        url
      });
    }
    const finalUrl = clean(payload?.url || payload?.__sourceFetchFinalUrl || url);
    assertEightfoldFinalHost(finalUrl, url);
    return {
      pageHtml: await payloadToText(payload),
      finalUrl
    };
  }

  const response = await safeFetch(url, target);
  if (!response.ok) {
    const body = await response.text();
    throw makeSourceFetchError("fetch_failed", `Eightfold careers page request failed (${response.status}): ${body.slice(0, 180)}`, {
      status: response.status,
      url: response.url || url
    });
  }
  const finalUrl = clean(response.url || url);
  assertEightfoldFinalHost(finalUrl, url);
  return {
    pageHtml: await response.text(),
    finalUrl
  };
}

async function fetchApiJson(url, target, fetcher) {
  if (typeof fetcher === "function") {
    const payload = await fetcher(url, target);
    const status = responseStatus(payload);
    if (status < 200 || status >= 300) {
      const body = await payloadToText(payload);
      throw makeSourceFetchError("fetch_failed", `Eightfold jobs API request failed (${status}): ${body.slice(0, 180)}`, {
        status,
        url
      });
    }
    const finalUrl = clean(payload?.url || payload?.__sourceFetchFinalUrl || url);
    assertEightfoldFinalHost(finalUrl, url);
    return {
      responseJson: await payloadToJson(payload, "Eightfold jobs API"),
      finalUrl
    };
  }

  const response = await safeFetch(url, target);
  if (!response.ok) {
    const body = await response.text();
    throw makeSourceFetchError("fetch_failed", `Eightfold jobs API request failed (${response.status}): ${body.slice(0, 180)}`, {
      status: response.status,
      url: response.url || url
    });
  }
  const finalUrl = clean(response.url || url);
  assertEightfoldFinalHost(finalUrl, url);
  return {
    responseJson: await payloadToJson(response, "Eightfold jobs API"),
    finalUrl
  };
}

function createFetchList(dependencies = {}) {
  const discover = typeof dependencies.discover === "function" ? dependencies.discover : createDiscover();

  return async function fetchEightfoldSourceList(company = {}, options = {}) {
    const context = buildCompanyContext(company);
    const discovered = discover(context);
    const config = discovered?.config?.boardUrl
      ? discovered.config
      : parseEightfoldCompany(context.url_string);

    if (!config?.boardUrl || !config?.siteBaseUrl) {
      throw makeSourceFetchError("no_public_jobs_route", "Eightfold source has no supported careers route", {
        url: context.url_string
      });
    }

    assertEightfoldFinalHost(config.boardUrl, config.boardUrl);
    const board = await fetchBoardHtml(config.boardUrl, buildBoardTarget(config), options.fetcher);
    const runtimeConfig = parseEightfoldCompany(board.finalUrl) || config;
    const groupId = extractEightfoldDomainFromHtml(board.pageHtml);
    if (!groupId) {
      throw makeSourceFetchError(
        "missing_group_id",
        "Eightfold window._EF_GROUP_ID value not found in careers page",
        { url: board.finalUrl || config.boardUrl }
      );
    }

    const apiConfig = {
      ...runtimeConfig,
      groupId
    };
    const apiUrl = buildEightfoldApiUrl(apiConfig, groupId);
    if (!apiUrl) {
      throw makeSourceFetchError("missing_api_url", "Eightfold API URL could not be built from careers page metadata", {
        url: board.finalUrl || config.boardUrl
      });
    }
    assertEightfoldFinalHost(apiUrl, apiUrl);

    const api = await fetchApiJson(apiUrl, buildApiTarget(apiConfig, apiUrl), options.fetcher);
    const finalConfig = {
      ...apiConfig,
      apiUrl,
      apiFinalUrl: api.finalUrl,
      boardFinalUrl: board.finalUrl
    };
    const responseJson = api.responseJson && typeof api.responseJson === "object" && !Array.isArray(api.responseJson)
      ? api.responseJson
      : {};

    return {
      ...responseJson,
      __sourceConfig: finalConfig,
      __sourceFetchFinalUrl: api.finalUrl,
      __sourceRequest: {
        boardUrl: config.boardUrl,
        boardFinalUrl: board.finalUrl,
        apiUrl,
        apiFinalUrl: api.finalUrl,
        groupId,
        rateLimitMs: EIGHTFOLD_RATE_LIMIT_WAIT_MS
      }
    };
  };
}

module.exports = {
  EIGHTFOLD_RATE_LIMIT_WAIT_MS,
  createFetchList
};
