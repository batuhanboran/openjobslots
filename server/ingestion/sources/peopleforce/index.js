const { safeFetch } = require("../../safeFetch");
const { parsePeopleforceCompany } = require("../../sourceDiscovery");
const parser = require("./parse");
const {
  clean,
  createBasicSourceContract,
  finalUrlFromPayload,
  makeSourceFetchError,
  payloadToText,
  responseStatus
} = require("../sourceModuleHelpers");

const ATS_KEY = "peopleforce";
const SOURCE_FAMILY = "html_detail";
const PARSER_VERSION = "source-peopleforce-v1";
const PEOPLEFORCE_RATE_LIMIT_WAIT_MS = 60 * 1000;
const FIXTURE_PATHS = Object.freeze([
  `server/ingestion/sources/${ATS_KEY}/fixtures/company.json`,
  `server/ingestion/sources/${ATS_KEY}/fixtures/list.json`,
  `server/ingestion/sources/${ATS_KEY}/fixtures/expected-normalized.json`,
  `server/ingestion/sources/${ATS_KEY}/fixtures/invalid-shapes.json`
]);

function normalizeCompanyName(company = {}, fallback = "peopleforce") {
  return clean(company.company_name || company.companyName || company.name || fallback) || fallback;
}

function discover(company = {}) {
  const config = parsePeopleforceCompany(company.url_string || company.company_url || company.url);
  return {
    ats_key: ATS_KEY,
    source_family: SOURCE_FAMILY,
    list_url: clean(config?.jobsUrl),
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
    if (host.endsWith(".peopleforce.io") && host !== "peopleforce.io" && host !== "www.peopleforce.io") {
      return;
    }
  } catch {
    // Fall through to source error below.
  }
  throw makeSourceFetchError("unexpected_redirect_host", `Peopleforce URL redirected to unexpected host: ${value}`, {
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
      jobsUrl: value
    };
  } catch {
    return {
      ...config,
      jobsUrl: clean(config?.jobsUrl || value)
    };
  }
}

async function fetchList(company = {}, options = {}) {
  const target = discover(company);
  const jobsUrl = clean(target.list_url);
  if (!jobsUrl) {
    throw makeSourceFetchError("no_public_jobs_route", "Peopleforce source has no supported jobs route", {
      url: company.url_string
    });
  }

  const request = {
    ...target,
    method: "GET",
    headers: buildHeaders(),
    source_key: ATS_KEY,
    source_family: SOURCE_FAMILY,
    rateLimitMs: PEOPLEFORCE_RATE_LIMIT_WAIT_MS
  };

  let status = 200;
  let finalUrl = jobsUrl;
  let html = "";
  if (typeof options.fetcher === "function") {
    const payload = await options.fetcher(jobsUrl, request);
    status = responseStatus(payload);
    finalUrl = finalUrlFromPayload(payload, jobsUrl);
    html = await payloadToText(payload);
  } else {
    const response = await safeFetch(jobsUrl, {
      method: "GET",
      headers: buildHeaders()
    });
    status = Number(response.status || 0);
    finalUrl = clean(response.url || jobsUrl);
    html = status === 200 ? await response.text() : "";
  }

  if (status !== 200) {
    throw makeSourceFetchError("fetch_failed", `Peopleforce page request failed (${status})`, {
      status,
      url: finalUrl
    });
  }
  assertFinalHost(finalUrl, jobsUrl);
  if (/\bclosed career site\b/i.test(html)) {
    html = "";
  }

  return {
    html,
    __sourceConfig: withFinalConfig(target.config, finalUrl, jobsUrl),
    __sourceFetchFinalUrl: finalUrl,
    __sourceRequest: {
      jobsUrl,
      rateLimitMs: PEOPLEFORCE_RATE_LIMIT_WAIT_MS
    }
  };
}

function parse(rawPayload, company = {}) {
  if (rawPayload && Array.isArray(rawPayload.__legacyParsed)) return rawPayload.__legacyParsed;
  const target = discover(company);
  const config = rawPayload?.__sourceConfig || target.config || {};
  const html = typeof rawPayload === "string" ? rawPayload : String(rawPayload?.html || rawPayload?.body || "");
  if (!clean(html)) return [];
  const companyName =
    normalizeCompanyName(company, "") ||
    config.subdomainLower ||
    "peopleforce_unknown";
  const listUrl = clean(rawPayload?.__sourceFetchFinalUrl || config.jobsUrl || target.list_url);
  return parser.parsePeopleforcePostingsFromHtml(companyName, config, html).map((posting) => ({
    ...posting,
    source_evidence: {
      ...(posting.source_evidence || {}),
      list_url: listUrl,
      route_kind: "peopleforce_public_careers"
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
    requestsPerMinute: 8,
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
