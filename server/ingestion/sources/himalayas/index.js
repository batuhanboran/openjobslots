"use strict";

const {
  clean,
  createBasicSourceContract
} = require("../sourceModuleHelpers");
const { readLimitedResponseText, safeFetch } = require("../../safeFetch");
const {
  finalUrlFromPayload,
  makeSourceFetchError,
  payloadToText,
  responseStatus
} = require("../sourceModuleHelpers");
const parser = require("./parse");

const ATS_KEY = "himalayas";
const SOURCE_FAMILY = "direct_json";
const PARSER_VERSION = "source-himalayas-v1";
const FIXTURE_PATHS = Object.freeze([
  `server/ingestion/sources/${ATS_KEY}/fixtures/list.json`,
  `server/ingestion/sources/${ATS_KEY}/fixtures/expected-normalized.json`,
  `server/ingestion/sources/${ATS_KEY}/fixtures/invalid-shapes.json`
]);

const sourceContract = createBasicSourceContract({
  atsKey: ATS_KEY,
  sourceFamily: SOURCE_FAMILY,
  parserVersion: PARSER_VERSION,
  parserConfidence: 0.78,
  requestsPerMinute: 6,
  rateLimitStrategy: "public-json-api-global-serialized",
  fixturePaths: FIXTURE_PATHS
});

function discover(company = {}) {
  const apiUrl = "https://himalayas.app/jobs/api?limit=20";
  return {
    ats_key: ATS_KEY,
    source_family: SOURCE_FAMILY,
    company,
    list_url: apiUrl,
    config: { apiUrl },
    parser_version: PARSER_VERSION
  };
}

function assertHimalayasHost(finalUrl, fallbackUrl) {
  const value = clean(finalUrl || fallbackUrl);
  try {
    const host = new URL(value).hostname.toLowerCase();
    if (host === "himalayas.app" || host === "www.himalayas.app") return;
  } catch {
    // Fall through to a typed source error.
  }
  throw makeSourceFetchError("unexpected_redirect_host", `Himalayas API redirected to unexpected host: ${value}`, { url: value });
}

async function payloadToJson(payload, sourceUrl) {
  if (payload && typeof payload === "object" && !Array.isArray(payload) && Array.isArray(payload.jobs)) return payload;
  const text = await payloadToText(payload);
  if (!clean(text)) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw makeSourceFetchError("invalid_json", "Himalayas API response is not valid JSON", { url: sourceUrl });
  }
}

async function fetchPage(url, target, options) {
  if (typeof options.fetcher === "function") return options.fetcher(url, target);
  const response = await safeFetch(url, target);
  const finalUrl = clean(response.url || url);
  return {
    status: Number(response.status || 0),
    url: finalUrl,
    body: await readLimitedResponseText(response, { sourceUrl: finalUrl })
  };
}

async function fetchList(company = {}, options = {}) {
  const target = discover(company);
  const maxPages = Math.max(1, Math.min(50, Number(options.maxPages || 10) || 10));
  const jobs = [];
  let requestUrl = target.list_url;
  let firstPayload = null;
  let lastPayload = {};
  let pageCount = 0;

  while (requestUrl && pageCount < maxPages) {
    const request = {
      ...target,
      list_url: requestUrl,
      method: "GET",
      headers: { Accept: "application/json, text/plain, */*" }
    };
    const rawPayload = await fetchPage(requestUrl, request, options);
    const status = responseStatus(rawPayload);
    const finalUrl = finalUrlFromPayload(rawPayload, requestUrl);
    if (status < 200 || status >= 300) {
      throw makeSourceFetchError("fetch_failed", `Himalayas API request failed (${status})`, { status, url: finalUrl });
    }
    assertHimalayasHost(finalUrl, requestUrl);
    const payload = await payloadToJson(rawPayload, finalUrl);
    if (!firstPayload) firstPayload = payload;
    lastPayload = payload;
    const batch = Array.isArray(payload.jobs) ? payload.jobs : [];
    jobs.push(...batch);
    pageCount += 1;

    const nextCursor = clean(payload.nextCursor || payload.next_cursor || "");
    if (nextCursor) {
      const nextUrl = new URL(target.list_url);
      nextUrl.searchParams.set("cursor", nextCursor);
      requestUrl = nextUrl.toString();
      continue;
    }

    const limit = Math.max(1, Number(payload.limit || 20) || 20);
    const offset = Math.max(0, Number(payload.offset || 0) || 0);
    const totalCount = Math.max(0, Number(payload.totalCount || 0) || 0);
    const nextOffset = offset + limit;
    if (totalCount > nextOffset && batch.length > 0) {
      const nextUrl = new URL(target.list_url);
      nextUrl.searchParams.set("offset", String(nextOffset));
      requestUrl = nextUrl.toString();
      continue;
    }
    requestUrl = "";
  }

  return {
    ...(firstPayload || {}),
    jobs,
    nextCursor: lastPayload.nextCursor || lastPayload.next_cursor || null,
    __sourceConfig: target.config,
    __sourcePagination: {
      maxPages,
      pagesFetched: pageCount,
      truncated: Boolean(requestUrl)
    }
  };
}

function parse(rawPayload, company = {}) {
  return parser.parseHimalayasPostingsFromApi("himalayas", {}, rawPayload);
}

function rateLimit() {
  return {
    ...sourceContract.rateLimit(),
    minimumPollIntervalMinutes: 24 * 60
  };
}

module.exports = {
  ...parser,
  ...sourceContract,
  atsKey: ATS_KEY,
  key: ATS_KEY,
  family: "direct-json-stable",
  status: "enabled",
  parserVersion: PARSER_VERSION,
  payloadShapePolicy: Object.freeze({
    empty_job_list_stems: Object.freeze(["jobs"]),
    optional_enrichment_prefixes: Object.freeze(["__legacyParsed", "__sourceConfig"])
  }),
  discover,
  fetchList,
  fetchDetail: async () => null,
  parse,
  rateLimit
};
