"use strict";

const { safeFetch } = require("../../safeFetch");
const { parseOraclePostingsFromApi } = require("./parse");
const {
  ORACLE_PAGE_SIZE,
  ORACLE_PARSER_VERSION,
  assertOracleFinalHost,
  buildCompanyContext,
  clean,
  createDiscover,
  parseOracleCompany
} = require("./discover");

const ORACLE_EXPAND_VALUE = [
  "requisitionList.workLocation",
  "requisitionList.otherWorkLocations",
  "requisitionList.secondaryLocations",
  "flexFieldsFacet.values",
  "requisitionList.requisitionFlexFields"
].join(",");

const ORACLE_RATE_LIMIT_WAIT_MS = 60 * 1000;
const ORACLE_MAX_PAGES_PER_COMPANY = 25;

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

async function payloadToJson(payload, sourceLabel) {
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

  const body = await payloadToText(payload);
  try {
    return JSON.parse(body);
  } catch {
    throw makeSourceFetchError("non_json_api_response", `${sourceLabel} response was not JSON: ${clean(body).slice(0, 180)}`);
  }
}

function makeApiTarget(config, url, apiConfig) {
  return {
    method: "GET",
    source_family: "enterprise_api",
    source_key: "oracle",
    headers: {
      Accept: "application/json, text/plain, */*",
      "Accept-Language": "en-US,en;q=0.9",
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    },
    config: {
      ...config,
      apiUrl: clean(url),
      ...(apiConfig || {})
    }
  };
}

async function fetchOraclePage(apiUrl, offset, limit, config, fetcher) {
  const safeOffset = Number.isFinite(Number(offset)) && Number(offset) >= 0 ? Math.floor(Number(offset)) : 0;
  const safeLimit = Number.isFinite(Number(limit)) && Number(limit) > 0 ? Math.floor(Number(limit)) : ORACLE_PAGE_SIZE;
  const finder = String(config?.finder || "").replace(/limit=\d+/i, `limit=${safeLimit}`);

  const url = new URL(apiUrl);
  url.searchParams.set("onlyData", "true");
  url.searchParams.set("expand", ORACLE_EXPAND_VALUE);
  if (finder) {
    url.searchParams.set("finder", finder);
  }
  url.searchParams.set("offset", String(safeOffset));
  url.searchParams.set("limit", String(safeLimit));

  const requestUrl = url.toString();
  const target = makeApiTarget(config, requestUrl);

  const response = typeof fetcher === "function"
    ? await fetcher(requestUrl, target)
    : await safeFetch(requestUrl, target);
  const status = responseStatus(response);
  if (status < 200 || status >= 300) {
    const body = await payloadToText(response);
    throw makeSourceFetchError("fetch_failed", `Oracle job requisitions request failed (${status}): ${body.slice(0, 180)}`, {
      status,
      url: requestUrl
    });
  }

  const finalUrl = clean(response?.url || response?.__sourceFetchFinalUrl || requestUrl);
  assertOracleFinalHost(finalUrl, requestUrl);

  const responseJson = await payloadToJson(response, "Oracle job requisitions API");
  return { responseJson, finalUrl, requestUrl };
}

function createFetchList(dependencies = {}) {
  const discover = typeof dependencies.discover === "function" ? dependencies.discover : createDiscover(ORACLE_PARSER_VERSION);

  return async function fetchOracleSourceList(company = {}, options = {}) {
    const context = buildCompanyContext(company);
    const discovered = discover(context);
    const config = parseOracleCompany(context.url_string) || discovered?.config || {};
    if (!config?.apiUrl) {
      throw makeSourceFetchError("no_public_jobs_route", "Oracle source has no supported CandidateExperience route", {
        url: context.url_string
      });
    }

    assertOracleFinalHost(config?.boardUrl || context.url_string);

    const requestCount = {
      total: 0,
      pages: 0
    };
    const collectedItems = [];
    const companyNameForPostings = clean(context.company_name) || `oracle_${clean(config.siteNumber).toLowerCase() || "cx"}`;

    let lastFinalUrl = clean(config.apiUrl);
    let pageCount = 0;

    for (let page = 0; page < ORACLE_MAX_PAGES_PER_COMPANY; page += 1) {
      const offset = page * ORACLE_PAGE_SIZE;
      const pageResult = await fetchOraclePage(config.apiUrl, offset, ORACLE_PAGE_SIZE, config, options.fetcher);
      const batch = parseOraclePostingsFromApi(companyNameForPostings, config, pageResult.responseJson);
      const pageItems = Array.isArray(pageResult.responseJson?.items) ? pageResult.responseJson.items : [];

      requestCount.pages += 1;
      requestCount.total += 1;
      pageCount = page + 1;
      lastFinalUrl = clean(pageResult.finalUrl || lastFinalUrl);
      if (pageItems.length > 0) collectedItems.push(...pageItems);

      if (batch.length === 0) break;
      if (!Boolean(pageResult.responseJson?.hasMore)) break;
    }

    return {
      items: collectedItems,
      __sourceConfig: {
        ...config,
        requestCount,
        pageCount
      },
      __sourceFetchFinalUrl: lastFinalUrl,
      __sourceRequest: {
        boardUrl: config.boardUrl,
        apiUrl: config.apiUrl,
        pageSize: ORACLE_PAGE_SIZE,
        pageCount,
        requestCount,
        rateLimitMs: ORACLE_RATE_LIMIT_WAIT_MS
      }
    };
  };
}

module.exports = {
  ORACLE_EXPAND_VALUE,
  ORACLE_RATE_LIMIT_WAIT_MS,
  ORACLE_MAX_PAGES_PER_COMPANY,
  ORACLE_PAGE_SIZE,
  createFetchList
};
