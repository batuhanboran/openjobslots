"use strict";

const { safeFetch } = require("../../safeFetch");
const {
  buildTalentreefSearchPayload,
  extractTalentreefAliasData,
  parseTalentreefPostingsFromSearchResponse
} = require("./parse");
const {
  buildCompanyContext,
  createDiscover,
  parseTalentreefCompany,
  assertTalentreefHost,
  assertTalentreefApiHost,
  TALENTREEF_PARSER_VERSION
} = require("./discover");

const TALENTREEF_RATE_LIMIT_WAIT_MS = 60 * 1000;
const TALENTREEF_PAGE_SIZE = 100;
const TALENTREEF_MAX_PAGES_PER_COMPANY = 25;

function makeSourceFetchError(reason, message, details = {}) {
  const error = new Error(message);
  error.ingestionErrorType = reason;
  Object.assign(error, details);
  return error;
}

function clean(value) {
  return String(value || "").trim();
}

function responseStatus(payload) {
  if (payload && typeof payload === "object" && Number.isFinite(Number(payload.status))) return Number(payload.status);
  if (payload && typeof payload === "object" && Number.isFinite(Number(payload.statusCode))) return Number(payload.statusCode);
  return 200;
}

function payloadToText(payload) {
  if (typeof payload === "string") return payload;
  if (!payload || typeof payload !== "object") return "";
  if (typeof payload.text === "function") return payload.text();
  if (typeof payload.body === "string") return payload.body;
  if (typeof payload.html === "string") return payload.html;
  return "";
}

function makeJsonParseError(sourceLabel, payloadText) {
  return makeSourceFetchError(
    "non_json_api_response",
    `TalentReef ${sourceLabel} response was not JSON: ${clean(payloadText).slice(0, 180)}`
  );
}

async function payloadToJson(payload, sourceLabel) {
  if (
    payload &&
    typeof payload === "object" &&
    !Array.isArray(payload) &&
    typeof payload.json !== "function" &&
    !("body" in payload) &&
    !("html" in payload)
  ) {
    return payload;
  }

  const text = await payloadToText(payload);
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw makeJsonParseError(sourceLabel, text);
  }
}

function resolveFinalUrl(payload, fallbackUrl = "") {
  return clean(payload?.url || payload?.__sourceFetchFinalUrl || fallbackUrl);
}

function resolveHostGuardedFinalUrl(payload, fallbackUrl, assertHost) {
  const finalUrl = resolveFinalUrl(payload, fallbackUrl);
  assertHost(finalUrl, fallbackUrl);
  return finalUrl;
}

function makeAliasTarget(config) {
  return {
    method: "GET",
    source_family: "enterprise_api",
    source_key: "talentreef",
    headers: {
      Accept: "application/json"
    },
    config
  };
}

function makeSearchTarget(config) {
  return {
    method: "POST",
    source_family: "enterprise_api",
    source_key: "talentreef",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json"
    },
    config
  };
}

function parseSearchPagePayload(config, companyNameForPostings, searchPayload) {
  if (!searchPayload || typeof searchPayload !== "object" || Array.isArray(searchPayload)) return [];
  return parseTalentreefPostingsFromSearchResponse(companyNameForPostings, config, searchPayload);
}

async function fetchAlias(config, fetcher) {
  const aliasUrl = clean(config?.aliasApiUrl);
  if (!aliasUrl) {
    throw makeSourceFetchError("missing_alias_url", "TalentReef alias API URL is missing");
  }

  const payload = typeof fetcher === "function"
    ? await fetcher(aliasUrl, makeAliasTarget(config))
    : await safeFetch(aliasUrl, makeAliasTarget(config));
  const status = responseStatus(payload);
  if (status < 200 || status >= 300) {
    const body = clean(await payloadToText(payload));
    throw makeSourceFetchError("talentreef_alias_fetch_failed", `TalentReef alias request failed (${status}): ${body.slice(0, 180)}`, {
      status,
      url: aliasUrl
    });
  }

  const aliasFinalUrl = resolveHostGuardedFinalUrl(payload, aliasUrl, assertTalentreefApiHost);
  const aliasResponse = await payloadToJson(payload, "alias");
  const { clientId, brand } = extractTalentreefAliasData(aliasResponse);
  if (!clientId) {
    throw makeSourceFetchError("missing_client_id", "TalentReef alias response is missing clientId", {
      url: aliasFinalUrl
    });
  }

  return {
    aliasResponse,
    aliasFinalUrl,
    clientId,
    brand
  };
}

async function fetchSearch(config, clientId, brand, from, fetcher) {
  const searchUrl = clean(config?.searchApiUrl);
  if (!searchUrl) {
    throw makeSourceFetchError("missing_search_url", "TalentReef search API URL is missing");
  }

  const target = makeSearchTarget(config);
  const body = JSON.stringify(buildTalentreefSearchPayload(clientId, brand, from, TALENTREEF_PAGE_SIZE));
  const payload = typeof fetcher === "function"
    ? await fetcher(searchUrl, { ...target, body })
    : await safeFetch(searchUrl, { ...target, body });
  const status = responseStatus(payload);
  if (status < 200 || status >= 300) {
    const bodyText = clean(await payloadToText(payload));
    throw makeSourceFetchError("talentreef_search_fetch_failed", `TalentReef search request failed (${status}): ${bodyText.slice(0, 180)}`, {
      status,
      url: searchUrl
    });
  }

  const searchFinalUrl = resolveHostGuardedFinalUrl(payload, searchUrl, assertTalentreefApiHost);
  const searchPayload = await payloadToJson(payload, "search");
  return {
    searchPayload,
    searchFinalUrl
  };
}

function createFetchList(dependencies = {}) {
  const discover = typeof dependencies.discover === "function"
    ? dependencies.discover
    : createDiscover(TALENTREEF_PARSER_VERSION);

  return async function fetchTalentreefSourceList(company = {}, options = {}) {
    const context = buildCompanyContext(company);
    const discovered = discover(context);
    const configured = discovered?.config || {};
    const boardUrl = clean(configured.boardUrl || discovered.list_url || context.url_string);
    if (!boardUrl) {
      throw makeSourceFetchError("no_public_jobs_route", "TalentReef source has no supported careers route", {
        url: context.url_string
      });
    }
    assertTalentreefHost(boardUrl, context.url_string);

    const config = parseTalentreefCompany(boardUrl) || configured;
    const companyNameForPostings = clean(context.company_name || config.companyName || config.companyNameLower || "talentreef");
    const requestCount = {
      total: 0,
      aliases: 0,
      search: 0
    };

    const alias = await fetchAlias(config, options.fetcher);
    requestCount.aliases += 1;
    requestCount.total += 1;

    const collectedHits = [];
    let searchFinalUrl = "";
    let normalizedTotal = null;
    let totalHits = null;
    for (let page = 0; page < TALENTREEF_MAX_PAGES_PER_COMPANY; page += 1) {
      const from = page * TALENTREEF_PAGE_SIZE;
      const searchResult = await fetchSearch(config, alias.clientId, alias.brand, from, options.fetcher);
      const searchPayload = searchResult.searchPayload;
      searchFinalUrl = clean(searchResult.searchFinalUrl);
      requestCount.search += 1;
      requestCount.total += 1;

      const pagePosts = parseSearchPagePayload(config, companyNameForPostings, searchPayload);
      const rawHits = Array.isArray(searchPayload?.hits?.hits) ? searchPayload.hits.hits : [];
      if (rawHits.length > 0) {
        collectedHits.push(...rawHits);
      }

      const totalRaw = searchPayload?.hits?.total;
      const totalValue =
        typeof totalRaw === "number"
          ? totalRaw
          : totalRaw && typeof totalRaw === "object"
            ? Number(totalRaw?.value || 0)
            : 0;
      if (Number.isFinite(totalValue) && totalValue >= 0) {
        totalHits = totalValue;
        normalizedTotal = totalRaw;
      }

      if (pagePosts.length < TALENTREEF_PAGE_SIZE) break;
      if (Number.isFinite(totalHits) && from + TALENTREEF_PAGE_SIZE >= totalHits) break;

      if (page === TALENTREEF_MAX_PAGES_PER_COMPANY - 1) break;
    }

    return {
      hits: {
        total: normalizedTotal,
        hits: collectedHits
      },
      __sourceConfig: {
        ...config,
        boardUrl,
        aliasFinalUrl: alias.aliasFinalUrl,
        searchFinalUrl,
        requestCount,
        clientId: alias.clientId,
        brand: alias.brand
      },
      __sourceFetchFinalUrl: searchFinalUrl || alias.aliasFinalUrl,
      __sourceRequest: {
        boardUrl,
        aliasApiUrl: clean(config.aliasApiUrl),
        searchApiUrl: clean(config.searchApiUrl),
        aliasFinalUrl: alias.aliasFinalUrl,
        searchFinalUrl,
        searchRequestCount: requestCount.search,
        rateLimitMs: TALENTREEF_RATE_LIMIT_WAIT_MS
      }
    };
  };
}

module.exports = {
  TALENTREEF_PAGE_SIZE,
  TALENTREEF_RATE_LIMIT_WAIT_MS,
  TALENTREEF_MAX_PAGES_PER_COMPANY,
  createFetchList
};
