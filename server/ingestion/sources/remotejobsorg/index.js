"use strict";

const { readLimitedResponseText, safeFetch } = require("../../safeFetch");
const {
  clean,
  createBasicSourceContract,
  finalUrlFromPayload,
  makeSourceFetchError,
  payloadToText,
  responseStatus
} = require("../sourceModuleHelpers");
const parser = require("./parse");

const ATS_KEY = "remotejobsorg";
const SOURCE_FAMILY = "direct_json";
const PARSER_VERSION = "source-remotejobsorg-v1";
const API_URL = "https://remotejobs.org/api/v1/jobs?limit=50";
const FIXTURE_PATHS = Object.freeze([
  `server/ingestion/sources/${ATS_KEY}/fixtures/company.json`,
  `server/ingestion/sources/${ATS_KEY}/fixtures/list.json`,
  `server/ingestion/sources/${ATS_KEY}/fixtures/expected-normalized.json`,
  `server/ingestion/sources/${ATS_KEY}/fixtures/invalid-shapes.json`
]);

const sourceContract = createBasicSourceContract({
  atsKey: ATS_KEY,
  sourceFamily: SOURCE_FAMILY,
  parserVersion: PARSER_VERSION,
  parserConfidence: 0.82,
  requestsPerMinute: 1 / 1440,
  rateLimitStrategy: "public-json-api-global-cache-minimum-24-hours",
  fixturePaths: FIXTURE_PATHS
});

function discover(company = {}) {
  return {
    ats_key: ATS_KEY,
    source_family: SOURCE_FAMILY,
    docs_url: "https://remotejobs.org/api-access",
    company,
    list_url: API_URL,
    config: {
      apiUrl: API_URL,
      attribution: "Powered by RemoteJobs.org",
      minimumPollIntervalMinutes: 1440
    },
    parser_version: PARSER_VERSION
  };
}

function assertRemoteJobsOrgHost(finalUrl, fallbackUrl) {
  const value = clean(finalUrl || fallbackUrl);
  try {
    const host = new URL(value).hostname.toLowerCase();
    if (host === "remotejobs.org" || host === "www.remotejobs.org") return;
  } catch {
    // Fall through to a typed fetch error.
  }
  throw makeSourceFetchError("unexpected_redirect_host", `RemoteJobs.org API redirected to unexpected host: ${value}`, { url: value });
}

async function payloadToJson(payload, sourceUrl) {
  if (payload && typeof payload === "object" && !Array.isArray(payload) && Array.isArray(payload.data)) return payload;
  const text = await payloadToText(payload);
  if (!clean(text)) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw makeSourceFetchError("invalid_json", "RemoteJobs.org API response is not valid JSON", { url: sourceUrl });
  }
}

async function fetchList(company = {}, options = {}) {
  const target = discover(company);
  const request = {
    ...target,
    method: "GET",
    headers: { Accept: "application/json, text/plain, */*" },
    source_key: ATS_KEY,
    source_family: SOURCE_FAMILY
  };
  let rawPayload;
  if (typeof options.fetcher === "function") {
    rawPayload = await options.fetcher(target.list_url, request);
  } else {
    const response = await safeFetch(target.list_url, request);
    const finalUrl = clean(response.url || target.list_url);
    rawPayload = {
      status: Number(response.status || 0),
      url: finalUrl,
      body: await readLimitedResponseText(response, { sourceUrl: finalUrl })
    };
  }

  const status = responseStatus(rawPayload);
  const finalUrl = finalUrlFromPayload(rawPayload, target.list_url);
  if (status < 200 || status >= 300) {
    throw makeSourceFetchError("fetch_failed", `RemoteJobs.org API request failed (${status})`, { status, url: finalUrl });
  }
  assertRemoteJobsOrgHost(finalUrl, target.list_url);
  const payload = await payloadToJson(rawPayload, finalUrl);
  return {
    ...(payload && typeof payload === "object" ? payload : {}),
    __sourceConfig: target.config,
    __sourceFetchFinalUrl: finalUrl
  };
}

function parse(rawPayload, company = {}) {
  return parser.parseRemoteJobsOrgPostingsFromApi(rawPayload, clean(company.company_name));
}

function validate(posting) {
  const basic = sourceContract.validate(posting);
  if (!basic.ok) return basic;
  if (!clean(posting?.source_job_id)) {
    return { ok: false, error: "missing source_job_id", status: "quarantined" };
  }
  if (/^https?:\/\//i.test(clean(posting.source_job_id))) {
    return { ok: false, error: "source_job_id must be a source-issued non-URL id", status: "quarantined" };
  }
  return basic;
}

function rateLimit() {
  return {
    ...sourceContract.rateLimit(),
    minimumPollIntervalMinutes: 1440
  };
}

module.exports = {
  ...parser,
  ...sourceContract,
  atsKey: ATS_KEY,
  key: ATS_KEY,
  family: "direct-json-stable",
  status: "canary",
  parserVersion: PARSER_VERSION,
  payloadShapePolicy: Object.freeze({
    empty_job_list_stems: Object.freeze(["data"]),
    optional_enrichment_prefixes: Object.freeze(["__sourceConfig"])
  }),
  discover,
  fetchList,
  fetchDetail: async () => null,
  parse,
  validate,
  rateLimit
};
