"use strict";

const { readLimitedResponseText, safeFetch } = require("../../safeFetch");
const parser = require("./parse");
const {
  clean,
  createBasicSourceContract,
  finalUrlFromPayload,
  makeSourceFetchError,
  payloadToText,
  responseStatus
} = require("../sourceModuleHelpers");

const ATS_KEY = "dayforcehcm";
const SOURCE_FAMILY = "enterprise_api";
const PARSER_VERSION = "source-dayforcehcm-v1";
const DAYFORCE_RATE_LIMIT_WAIT_MS = 60 * 1000;
const DEFAULT_MAX_PAGES_PER_COMPANY = 8;
const FIXTURE_PATHS = Object.freeze([
  `server/ingestion/sources/${ATS_KEY}/fixtures/company.json`,
  `server/ingestion/sources/${ATS_KEY}/fixtures/list.json`,
  `server/ingestion/sources/${ATS_KEY}/fixtures/expected-normalized.json`,
  `server/ingestion/sources/${ATS_KEY}/fixtures/invalid-shapes.json`
]);

function normalizeCompanyName(company = {}, fallback = "dayforcehcm") {
  return clean(company.company_name || company.companyName || company.name || fallback) || fallback;
}

function decodePathPart(value) {
  try {
    return decodeURIComponent(String(value || ""));
  } catch {
    return String(value || "");
  }
}

function parseDayforceBoardUrl(value) {
  const raw = clean(value);
  if (!raw) return {};
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return {};
  }
  const host = parsed.hostname.toLowerCase();
  if (host !== "jobs.dayforcehcm.com" && host !== "careers.dayforcehcm.com") return {};
  const parts = parsed.pathname.split("/").map(decodePathPart).filter(Boolean);
  const cultureCode = clean(parts[0] || "en-US");
  const clientNamespace = clean(parts[1] || "");
  const jobBoardCode = clean(parts[2] || "candidateportal");
  if (!clientNamespace || !jobBoardCode) return {};
  const origin = `${parsed.protocol}//${parsed.host}`;
  return {
    origin,
    cultureCode,
    clientNamespace,
    clientNamespaceLower: clientNamespace.toLowerCase(),
    jobBoardCode,
    boardUrl: `${origin}/${cultureCode}/${clientNamespace}/${jobBoardCode}`,
    apiUrl: `${origin}/api/geo/${encodeURIComponent(clientNamespace)}/jobposting/search`
  };
}

function discover(company = {}) {
  const config = parseDayforceBoardUrl(company.url_string || company.company_url || company.url);
  return {
    ats_key: ATS_KEY,
    source_family: SOURCE_FAMILY,
    list_url: clean(config.apiUrl),
    config: config || {},
    parser_version: PARSER_VERSION
  };
}

function buildSearchRequestBody(config = {}, paginationStart = 0) {
  return {
    clientNamespace: config.clientNamespace,
    jobBoardCode: config.jobBoardCode,
    cultureCode: config.cultureCode || "en-US",
    distanceUnit: 0,
    paginationStart
  };
}

function buildHeaders(config = {}) {
  return {
    Accept: "application/json, text/plain, */*",
    "Content-Type": "application/json",
    Referer: config.boardUrl || "https://jobs.dayforcehcm.com/",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
  };
}

function assertFinalHost(finalUrl, fallbackUrl) {
  const value = clean(finalUrl || fallbackUrl);
  try {
    const host = new URL(value).hostname.toLowerCase();
    if (host === "jobs.dayforcehcm.com" || host === "careers.dayforcehcm.com") return;
  } catch {
    // Fall through to the source error below.
  }
  throw makeSourceFetchError("unexpected_redirect_host", `Dayforce URL redirected to unexpected host: ${value}`, {
    url: value
  });
}

async function parseJsonPayload(payload, sourceUrl) {
  if (payload && typeof payload === "object" && !Array.isArray(payload) && Array.isArray(payload.jobPostings)) {
    return payload;
  }
  const text = await payloadToText(payload);
  if (!clean(text)) {
    throw makeSourceFetchError("empty_response", "Dayforce API response body is empty", {
      url: sourceUrl
    });
  }
  try {
    return JSON.parse(text);
  } catch {
    throw makeSourceFetchError("invalid_json", "Dayforce API response is not valid JSON", {
      url: sourceUrl
    });
  }
}

function classifyDayforceStatus(status) {
  const value = Number(status || 0);
  if (value === 401 || value === 403 || value === 429) return "blocked_or_rate_limited";
  if (value === 404 || value === 410) return "source_quality";
  return "fetch_failed";
}

async function fetchJsonPage(urlString, request, body, options = {}) {
  let status = 200;
  let finalUrl = urlString;
  let payload;

  if (typeof options.fetcher === "function") {
    payload = await options.fetcher(urlString, request);
    status = responseStatus(payload);
    finalUrl = finalUrlFromPayload(payload, urlString);
  } else {
    const response = await safeFetch(urlString, {
      method: "POST",
      headers: request.headers,
      body: request.body
    });
    status = Number(response.status || 0);
    finalUrl = clean(response.url || urlString);
    payload = {
      status,
      url: finalUrl,
      body: status === 200 ? await readLimitedResponseText(response, { sourceUrl: finalUrl }) : ""
    };
  }

  if (status !== 200) {
    throw makeSourceFetchError(classifyDayforceStatus(status), `Dayforce API request failed (${status})`, {
      status,
      url: finalUrl
    });
  }
  assertFinalHost(finalUrl, urlString);
  const json = await parseJsonPayload(payload, finalUrl);
  return {
    json,
    finalUrl,
    requestBody: body
  };
}

function maxPagesFromOptions(options = {}) {
  const raw = Number(options.maxDayforcePages || options.maxPages || process.env.OPENJOBSLOTS_DAYFORCE_MAX_PAGES_PER_COMPANY || DEFAULT_MAX_PAGES_PER_COMPANY);
  return Math.max(1, Math.min(10, Number.isFinite(raw) ? raw : DEFAULT_MAX_PAGES_PER_COMPANY));
}

async function fetchList(company = {}, options = {}) {
  const target = discover(company);
  const config = target.config || {};
  if (!clean(target.list_url)) {
    throw makeSourceFetchError("no_public_jobs_route", "Dayforce source has no supported public job-posting search route", {
      url: company.url_string
    });
  }

  const pages = [];
  let lastFinalUrl = target.list_url;
  let nextStart = 0;
  let maxCount = null;
  const maxPages = maxPagesFromOptions(options);

  for (let page = 1; page <= maxPages; page += 1) {
    const body = buildSearchRequestBody(config, nextStart);
    const request = {
      ...target,
      method: "POST",
      headers: buildHeaders(config),
      body: JSON.stringify(body),
      source_key: ATS_KEY,
      source_family: SOURCE_FAMILY,
      page,
      paginationStart: nextStart,
      rateLimitMs: DAYFORCE_RATE_LIMIT_WAIT_MS
    };
    const result = await fetchJsonPage(target.list_url, request, body, options);
    pages.push(result.json);
    lastFinalUrl = result.finalUrl;

    const batch = Array.isArray(result.json?.jobPostings) ? result.json.jobPostings : [];
    const responseOffset = Number(result.json?.offset);
    const responseCount = Number(result.json?.count || batch.length);
    const responseMax = Number(result.json?.maxCount);
    if (Number.isFinite(responseMax) && responseMax >= 0) maxCount = responseMax;
    if (!batch.length) break;
    nextStart = (Number.isFinite(responseOffset) ? responseOffset : nextStart) + (Number.isFinite(responseCount) && responseCount > 0 ? responseCount : batch.length);
    if (Number.isFinite(maxCount) && nextStart >= maxCount) break;
  }

  return {
    pages,
    __sourceConfig: config,
    __sourceFetchFinalUrl: lastFinalUrl,
    __sourceRequest: {
      apiUrl: target.list_url,
      boardUrl: config.boardUrl,
      maxPages,
      rateLimitMs: DAYFORCE_RATE_LIMIT_WAIT_MS
    }
  };
}

function parse(rawPayload, company = {}) {
  if (rawPayload && Array.isArray(rawPayload.__legacyParsed)) return rawPayload.__legacyParsed;
  const target = discover(company);
  const config = rawPayload?.__sourceConfig || target.config || {};
  const companyName = normalizeCompanyName(company, config.clientNamespace || "dayforcehcm_unknown");
  const payloads = Array.isArray(rawPayload?.pages)
    ? rawPayload.pages
    : [rawPayload && typeof rawPayload === "object" ? rawPayload : {}];
  const postings = [];
  const seenIds = new Set();

  for (const payload of payloads) {
    const batch = parser.parseDayforceHcmPostingsFromApi(companyName, config, payload);
    for (const posting of batch) {
      const sourceJobId = clean(posting.source_job_id).toLowerCase();
      if (!sourceJobId || seenIds.has(sourceJobId)) continue;
      seenIds.add(sourceJobId);
      postings.push(posting);
    }
  }

  return postings;
}

const sourceContract = createBasicSourceContract({
  atsKey: ATS_KEY,
  sourceFamily: SOURCE_FAMILY,
  parserVersion: PARSER_VERSION,
  parserConfidence: 0.62,
  requestsPerMinute: 8,
  fixturePaths: FIXTURE_PATHS
});

function validate(posting) {
  const basic = sourceContract.validate(posting);
  if (!basic.ok) return basic;
  if (!clean(posting?.source_job_id)) {
    return { ok: false, error: "missing source_job_id", status: "quarantined" };
  }
  return basic;
}

module.exports = {
  ...parser,
  ...sourceContract,
  atsKey: ATS_KEY,
  key: ATS_KEY,
  family: "enterprise-direct",
  status: "disabled",
  parserVersion: PARSER_VERSION,
  discover,
  fetchList,
  fetchDetail: async () => null,
  parse,
  validate
};
