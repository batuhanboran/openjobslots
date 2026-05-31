const { safeFetch } = require("../../safeFetch");
const parser = require("./parse");
const {
  clean,
  createBasicSourceContract,
  finalUrlFromPayload,
  makeSourceFetchError,
  payloadToText,
  responseStatus
} = require("../sourceModuleHelpers");

const ATS_KEY = "policeapp";
const SOURCE_FAMILY = "html_public_ajax";
const PARSER_VERSION = "source-policeapp-v1";
const POLICEAPP_RATE_LIMIT_WAIT_MS = 60 * 1000;
const POLICEAPP_ENDPOINT =
  "https://www.policeapp.com/jobs/urlrewrite_jobpostings/jobResultsAjax.ashx?j=0&r=50&s=0&p=0";
const FIXTURE_PATHS = Object.freeze([
  `server/ingestion/sources/${ATS_KEY}/fixtures/company.json`,
  `server/ingestion/sources/${ATS_KEY}/fixtures/list.json`,
  `server/ingestion/sources/${ATS_KEY}/fixtures/expected-normalized.json`,
  `server/ingestion/sources/${ATS_KEY}/fixtures/invalid-shapes.json`
]);

function discover() {
  return {
    ats_key: ATS_KEY,
    source_family: SOURCE_FAMILY,
    list_url: POLICEAPP_ENDPOINT,
    config: {
      endpoint: POLICEAPP_ENDPOINT,
      baseOrigin: "https://www.policeapp.com"
    },
    parser_version: PARSER_VERSION
  };
}

function buildHeaders() {
  return {
    Accept: "text/html, */*; q=0.01",
    "Accept-Language": "en-US,en;q=0.9",
    "X-Requested-With": "XMLHttpRequest"
  };
}

function assertFinalHost(finalUrl, fallbackUrl) {
  const value = clean(finalUrl || fallbackUrl);
  try {
    const host = new URL(value).hostname.toLowerCase();
    if (host === "www.policeapp.com" || host === "policeapp.com") return;
  } catch {
    // Fall through to source error below.
  }
  throw makeSourceFetchError("unexpected_redirect_host", `PoliceApp URL redirected to unexpected host: ${value}`, {
    url: value
  });
}

async function fetchList(company = {}, options = {}) {
  const target = discover(company);
  const endpoint = clean(target.list_url);
  const request = {
    ...target,
    method: "GET",
    headers: buildHeaders(),
    source_key: ATS_KEY,
    source_family: SOURCE_FAMILY,
    rateLimitMs: POLICEAPP_RATE_LIMIT_WAIT_MS
  };

  let status = 200;
  let finalUrl = endpoint;
  let html = "";
  if (typeof options.fetcher === "function") {
    const payload = await options.fetcher(endpoint, request);
    status = responseStatus(payload);
    finalUrl = finalUrlFromPayload(payload, endpoint);
    html = await payloadToText(payload);
  } else {
    const response = await safeFetch(endpoint, {
      method: "GET",
      headers: buildHeaders()
    });
    status = Number(response.status || 0);
    finalUrl = clean(response.url || endpoint);
    html = status === 200 ? await response.text() : "";
  }

  if (status !== 200) {
    throw makeSourceFetchError("fetch_failed", `PoliceApp request failed (${status})`, {
      status,
      url: finalUrl
    });
  }
  assertFinalHost(finalUrl, endpoint);

  return {
    html,
    __sourceConfig: target.config,
    __sourceFetchFinalUrl: finalUrl,
    __sourceRequest: {
      endpoint,
      rateLimitMs: POLICEAPP_RATE_LIMIT_WAIT_MS
    }
  };
}

function parse(rawPayload) {
  if (rawPayload && Array.isArray(rawPayload.__legacyParsed)) return rawPayload.__legacyParsed;
  const target = discover();
  const html = typeof rawPayload === "string" ? rawPayload : String(rawPayload?.html || rawPayload?.body || "");
  const listUrl = clean(rawPayload?.__sourceFetchFinalUrl || target.list_url);
  return parser.parsePoliceappPostingsFromHtml(html).map((posting) => ({
    ...posting,
    source_evidence: {
      ...(posting.source_evidence || {}),
      list_url: listUrl,
      route_kind: "policeapp_public_ajax"
    }
  }));
}

module.exports = {
  ...parser,
  ...createBasicSourceContract({
    atsKey: ATS_KEY,
    sourceFamily: SOURCE_FAMILY,
    parserVersion: PARSER_VERSION,
    parserConfidence: 0.6,
    requestsPerMinute: 6,
    fixturePaths: FIXTURE_PATHS
  }),
  atsKey: ATS_KEY,
  key: ATS_KEY,
  parserVersion: PARSER_VERSION,
  discover,
  fetchList,
  fetchDetail: async () => null,
  parse
};
