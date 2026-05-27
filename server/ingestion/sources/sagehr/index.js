const { safeFetch } = require("../../safeFetch");
const { parseSagehrCompany } = require("../../sourceDiscovery");
const parser = require("./parse");
const {
  clean,
  createBasicSourceContract,
  finalUrlFromPayload,
  makeSourceFetchError,
  payloadToText,
  responseStatus
} = require("../sourceModuleHelpers");

const ATS_KEY = "sagehr";
const SOURCE_FAMILY = "html_detail";
const PARSER_VERSION = "source-sagehr-v1";
const SAGEHR_RATE_LIMIT_WAIT_MS = 60 * 1000;

function normalizeCompanyName(company = {}, fallback = "sagehr") {
  return clean(company.company_name || company.companyName || company.name || fallback) || fallback;
}

function discover(company = {}) {
  const config = parseSagehrCompany(company.url_string || company.company_url || company.url);
  return {
    ats_key: ATS_KEY,
    source_family: SOURCE_FAMILY,
    list_url: clean(config?.boardUrl),
    config: config || {},
    parser_version: PARSER_VERSION
  };
}

function buildHeaders() {
  return {
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Cache-Control": "no-cache",
    Pragma: "no-cache",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
  };
}

function assertFinalHost(finalUrl, fallbackUrl) {
  const value = clean(finalUrl || fallbackUrl);
  try {
    const host = new URL(value).hostname.toLowerCase();
    if (host === "talent.sage.hr" || host === "www.talent.sage.hr") return;
  } catch {
    // Fall through to source error below.
  }
  throw makeSourceFetchError("unexpected_redirect_host", `SageHR URL redirected to unexpected host: ${value}`, {
    url: value
  });
}

function withFinalConfig(config, finalUrl, fallbackUrl) {
  const value = clean(finalUrl || fallbackUrl);
  try {
    const parsed = new URL(value);
    return {
      ...config,
      baseOrigin: `${parsed.protocol}//${parsed.host}`,
      boardUrl: value
    };
  } catch {
    return {
      ...config,
      boardUrl: clean(config?.boardUrl || value)
    };
  }
}

async function fetchList(company = {}, options = {}) {
  const target = discover(company);
  const boardUrl = clean(target.list_url);
  if (!boardUrl) {
    throw makeSourceFetchError("no_public_jobs_route", "SageHR source has no supported jobs route", {
      url: company.url_string
    });
  }

  const request = {
    ...target,
    method: "GET",
    headers: buildHeaders(),
    source_key: ATS_KEY,
    source_family: SOURCE_FAMILY,
    rateLimitMs: SAGEHR_RATE_LIMIT_WAIT_MS,
    allowStatuses: [403]
  };

  let status = 200;
  let finalUrl = boardUrl;
  let html = "";
  if (typeof options.fetcher === "function") {
    const payload = await options.fetcher(boardUrl, request);
    status = responseStatus(payload);
    finalUrl = finalUrlFromPayload(payload, boardUrl);
    html = await payloadToText(payload);
  } else {
    const response = await safeFetch(boardUrl, {
      method: "GET",
      headers: buildHeaders()
    });
    status = Number(response.status || 0);
    finalUrl = clean(response.url || boardUrl);
    html = await response.text();
  }

  if (status !== 200 && status !== 403) {
    throw makeSourceFetchError("fetch_failed", `SageHR page request failed (${status})`, {
      status,
      url: finalUrl
    });
  }
  assertFinalHost(finalUrl, boardUrl);
  if (!clean(html)) {
    throw makeSourceFetchError("empty_payload", `SageHR page response was empty (${status})`, {
      status,
      url: finalUrl
    });
  }
  const lowered = html.toLowerCase();
  if (status === 403 && !lowered.includes("title-wrap") && !lowered.includes("other-jobs")) {
    throw makeSourceFetchError("blocked_or_rate_limited", "SageHR page request failed (403)", {
      status,
      url: finalUrl
    });
  }

  return {
    html,
    __sourceConfig: withFinalConfig(target.config, finalUrl, boardUrl),
    __sourceFetchFinalUrl: finalUrl,
    __sourceRequest: {
      boardUrl,
      rateLimitMs: SAGEHR_RATE_LIMIT_WAIT_MS
    }
  };
}

function parse(rawPayload, company = {}) {
  if (rawPayload && Array.isArray(rawPayload.__legacyParsed)) return rawPayload.__legacyParsed;
  const target = discover(company);
  const config = rawPayload?.__sourceConfig || target.config || {};
  const html = typeof rawPayload === "string" ? rawPayload : String(rawPayload?.html || rawPayload?.body || "");
  const inferredCompanyName = parser.extractSagehrCompanyNameFromHtml(html);
  const companyName =
    normalizeCompanyName(company, "") ||
    (inferredCompanyName !== "Unknown Company" ? inferredCompanyName : "") ||
    `sagehr_${config.companySlugLower || "unknown"}`;
  const listUrl = clean(rawPayload?.__sourceFetchFinalUrl || config.boardUrl || target.list_url);
  return parser.parseSagehrPostingsFromHtml(companyName, config, html).map((posting) => ({
    ...posting,
    source_evidence: {
      ...(posting.source_evidence || {}),
      list_url: listUrl,
      route_kind: "sagehr_public_vacancies"
    }
  }));
}

module.exports = {
  ...parser,
  ...createBasicSourceContract({
    atsKey: ATS_KEY,
    sourceFamily: SOURCE_FAMILY,
    parserVersion: PARSER_VERSION,
    parserConfidence: 0.62,
    requestsPerMinute: 8
  }),
  atsKey: ATS_KEY,
  key: ATS_KEY,
  parserVersion: PARSER_VERSION,
  discover,
  fetchList,
  fetchDetail: async () => null,
  parse
};
