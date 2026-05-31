const { safeFetch } = require("../../safeFetch");
const { parseTalexioCompany } = require("../../sourceDiscovery");
const parser = require("./parse");
const {
  clean,
  createBasicSourceContract,
  finalUrlFromPayload,
  makeSourceFetchError,
  payloadToText,
  responseStatus
} = require("../sourceModuleHelpers");

const ATS_KEY = "talexio";
const SOURCE_FAMILY = "direct_json";
const PARSER_VERSION = "source-talexio-v1";
const TALEXIO_RATE_LIMIT_WAIT_MS = 60 * 1000;
const MAX_PAGES_PER_COMPANY = 25;
const PAGE_SIZE = 10;
const FIXTURE_PATHS = Object.freeze([
  `server/ingestion/sources/${ATS_KEY}/fixtures/company.json`,
  `server/ingestion/sources/${ATS_KEY}/fixtures/list.json`,
  `server/ingestion/sources/${ATS_KEY}/fixtures/expected-normalized.json`,
  `server/ingestion/sources/${ATS_KEY}/fixtures/invalid-shapes.json`
]);

function normalizeCompanyName(company = {}, fallback = "talexio") {
  return clean(company.company_name || company.companyName || company.name || fallback) || fallback;
}

function discover(company = {}) {
  const config = parseTalexioCompany(company.url_string || company.company_url || company.url);
  return {
    ats_key: ATS_KEY,
    source_family: SOURCE_FAMILY,
    list_url: clean(config?.apiUrl),
    config: config || {},
    parser_version: PARSER_VERSION
  };
}

function buildListUrl(config = {}, page = 1, limit = PAGE_SIZE) {
  const apiUrl = clean(config.apiUrl);
  if (!apiUrl) return "";
  const url = new URL(apiUrl);
  url.searchParams.set("search", "");
  url.searchParams.set("sortBy", "relevance");
  url.searchParams.set("page", String(page));
  url.searchParams.set("limit", String(limit));
  return url.toString();
}

function buildHeaders() {
  return {
    Accept: "application/json"
  };
}

function assertFinalHost(finalUrl, fallbackUrl) {
  const value = clean(finalUrl || fallbackUrl);
  try {
    const host = new URL(value).hostname.toLowerCase();
    if (host.endsWith(".talexio.com") && host !== "talexio.com" && host !== "www.talexio.com") return;
  } catch {
    // Fall through to source error below.
  }
  throw makeSourceFetchError("unexpected_redirect_host", `Talexio API URL redirected to unexpected host: ${value}`, {
    url: value
  });
}

async function parseJsonPayload(payload, sourceUrl) {
  if (payload && typeof payload === "object" && !Array.isArray(payload) && Array.isArray(payload.vacancies)) {
    return payload;
  }
  const text = await payloadToText(payload);
  if (!clean(text)) {
    throw makeSourceFetchError("empty_response", "Talexio API response body is empty", {
      url: sourceUrl
    });
  }
  try {
    return JSON.parse(text);
  } catch {
    throw makeSourceFetchError("invalid_json", "Talexio API response is not valid JSON", {
      url: sourceUrl
    });
  }
}

async function fetchJsonPage(urlString, request, options = {}) {
  let status = 200;
  let finalUrl = urlString;
  let payload;
  if (typeof options.fetcher === "function") {
    payload = await options.fetcher(urlString, request);
    status = responseStatus(payload);
    finalUrl = finalUrlFromPayload(payload, urlString);
  } else {
    const response = await safeFetch(urlString, {
      method: "GET",
      headers: buildHeaders()
    });
    status = Number(response.status || 0);
    finalUrl = clean(response.url || urlString);
    payload = {
      status,
      url: finalUrl,
      body: status === 200 ? await response.text() : ""
    };
  }

  if (status !== 200) {
    throw makeSourceFetchError("fetch_failed", `Talexio API request failed (${status})`, {
      status,
      url: finalUrl
    });
  }
  assertFinalHost(finalUrl, urlString);
  const json = await parseJsonPayload(payload, finalUrl);
  return {
    json,
    finalUrl
  };
}

async function fetchList(company = {}, options = {}) {
  const target = discover(company);
  const config = target.config || {};
  if (!clean(target.list_url)) {
    throw makeSourceFetchError("no_public_jobs_route", "Talexio source has no supported API route", {
      url: company.url_string
    });
  }

  const pages = [];
  let lastFinalUrl = target.list_url;
  let collectedCount = 0;
  let totalVacancies = null;
  for (let page = 1; page <= MAX_PAGES_PER_COMPANY; page += 1) {
    const urlString = buildListUrl(config, page, PAGE_SIZE);
    const request = {
      ...target,
      method: "GET",
      headers: buildHeaders(),
      source_key: ATS_KEY,
      source_family: SOURCE_FAMILY,
      page,
      limit: PAGE_SIZE,
      rateLimitMs: TALEXIO_RATE_LIMIT_WAIT_MS
    };
    const { json, finalUrl } = await fetchJsonPage(urlString, request, options);
    pages.push(json);
    lastFinalUrl = finalUrl;

    const vacancies = Array.isArray(json?.vacancies) ? json.vacancies : [];
    collectedCount += vacancies.length;
    const totalRaw = Number(json?.totalVacancies);
    if (Number.isFinite(totalRaw) && totalRaw >= 0) totalVacancies = totalRaw;
    if (vacancies.length < PAGE_SIZE) break;
    if (Number.isFinite(totalVacancies) && collectedCount >= totalVacancies) break;
  }

  return {
    pages,
    __sourceConfig: config,
    __sourceFetchFinalUrl: lastFinalUrl,
    __sourceRequest: {
      apiUrl: target.list_url,
      pageSize: PAGE_SIZE,
      maxPages: MAX_PAGES_PER_COMPANY,
      rateLimitMs: TALEXIO_RATE_LIMIT_WAIT_MS
    }
  };
}

function parse(rawPayload, company = {}) {
  if (rawPayload && Array.isArray(rawPayload.__legacyParsed)) return rawPayload.__legacyParsed;
  const target = discover(company);
  const config = rawPayload?.__sourceConfig || target.config || {};
  const companyName = normalizeCompanyName(company, config.subdomainLower || "talexio_unknown");
  const listUrl = clean(rawPayload?.__sourceRequest?.apiUrl || config.apiUrl || target.list_url);
  const payloads = Array.isArray(rawPayload?.pages)
    ? rawPayload.pages
    : [rawPayload && typeof rawPayload === "object" ? rawPayload : {}];
  const postings = [];
  const seenUrls = new Set();

  for (const payload of payloads) {
    const batch = parser.parseTalexioPostingsFromApi(companyName, config, payload);
    for (const posting of batch) {
      const postingUrl = clean(posting.job_posting_url);
      if (!postingUrl || seenUrls.has(postingUrl)) continue;
      seenUrls.add(postingUrl);
      postings.push({
        ...posting,
        source_evidence: {
          ...(posting.source_evidence || {}),
          list_url: listUrl,
          route_kind: "talexio_public_jobs_api"
        }
      });
    }
  }

  return postings;
}

const sourceContract = createBasicSourceContract({
  atsKey: ATS_KEY,
  sourceFamily: SOURCE_FAMILY,
  parserVersion: PARSER_VERSION,
  parserConfidence: 0.58,
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
  parserVersion: PARSER_VERSION,
  discover,
  fetchList,
  fetchDetail: async () => null,
  parse,
  validate
};
