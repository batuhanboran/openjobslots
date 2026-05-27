const { safeFetch } = require("../../safeFetch");
const { parseSapHrCloudCompany } = require("../../sourceDiscovery");
const parser = require("./parse");
const {
  clean,
  createBasicSourceContract,
  finalUrlFromPayload,
  makeSourceFetchError,
  payloadToText,
  responseStatus
} = require("../sourceModuleHelpers");

const ATS_KEY = "saphrcloud";
const SOURCE_FAMILY = "enterprise_api";
const PARSER_VERSION = "source-saphrcloud-v1";
const SAPHRCLOUD_RATE_LIMIT_WAIT_MS = 60 * 1000;

function normalizeCompanyName(company = {}, fallback = "saphrcloud") {
  return clean(company.company_name || company.companyName || company.name || fallback) || fallback;
}

function parseSapHrCloudSourceConfig(urlString) {
  const strictConfig = parseSapHrCloudCompany(urlString);
  if (strictConfig) return strictConfig;

  try {
    const parsed = new URL(clean(urlString));
    const host = parsed.hostname.toLowerCase();
    if (host !== "jobs.sap.com" && !host.endsWith(".jobs.sap.com")) return null;
    const localeFromUrl = clean(parsed.searchParams.get("locale"));
    const baseOrigin = `${parsed.protocol}//${parsed.host}`;
    return {
      host,
      companyName: host.split(".")[0] || "sap",
      companyNameLower: host.split(".")[0] || "sap",
      baseOrigin,
      boardUrl: `${baseOrigin}/search/?createNewAlert=false&q=`,
      apiUrl: `${baseOrigin}/services/recruiting/v1/jobs`,
      localeFromUrl: localeFromUrl || ""
    };
  } catch {
    return null;
  }
}

function discover(company = {}) {
  const config = parseSapHrCloudSourceConfig(company.url_string || company.company_url || company.url);
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
    Accept: "text/html,application/xhtml+xml,application/json;q=0.7,*/*;q=0.5",
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
    if (host.endsWith(".jobs.hr.cloud.sap") && host !== "jobs.hr.cloud.sap") return;
    if (host === "jobs.sap.com" || host.endsWith(".jobs.sap.com")) return;
  } catch {
    // Fall through to source error below.
  }
  throw makeSourceFetchError("unexpected_redirect_host", `SAP HR Cloud URL redirected to unexpected host: ${value}`, {
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
      boardUrl: clean(config?.boardUrl || value)
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
    throw makeSourceFetchError("no_public_jobs_route", "SAP HR Cloud source has no supported board route", {
      url: company.url_string
    });
  }

  const request = {
    ...target,
    method: "GET",
    headers: buildHeaders(),
    source_key: ATS_KEY,
    source_family: SOURCE_FAMILY,
    rateLimitMs: SAPHRCLOUD_RATE_LIMIT_WAIT_MS
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
    html = status === 200 ? await response.text() : "";
  }

  if (status !== 200) {
    throw makeSourceFetchError("fetch_failed", `SAP HR Cloud page request failed (${status})`, {
      status,
      url: finalUrl
    });
  }
  assertFinalHost(finalUrl, boardUrl);

  return {
    html,
    __sourceConfig: withFinalConfig(target.config, finalUrl, boardUrl),
    __sourceFetchFinalUrl: finalUrl,
    __sourceRequest: {
      boardUrl,
      rateLimitMs: SAPHRCLOUD_RATE_LIMIT_WAIT_MS
    }
  };
}

function parse(rawPayload, company = {}) {
  if (rawPayload && Array.isArray(rawPayload.__legacyParsed)) return rawPayload.__legacyParsed;
  const target = discover(company);
  const config = rawPayload?.__sourceConfig || target.config || {};
  const companyName =
    normalizeCompanyName(company, "") ||
    config.companyNameLower ||
    "saphrcloud_unknown";
  const listUrl = clean(rawPayload?.__sourceFetchFinalUrl || config.boardUrl || target.list_url);
  const apiUrl = clean(config.apiUrl);

  if (rawPayload && typeof rawPayload === "object" && Array.isArray(rawPayload.jobSearchResult)) {
    return parser.parseSapHrCloudPostingsFromApi(companyName, config, rawPayload, config.localeFromUrl || "en_US").map((posting) => ({
      ...posting,
      source_evidence: {
        ...(posting.source_evidence || {}),
        list_url: apiUrl || listUrl,
        route_kind: "saphrcloud_jobs_api"
      }
    }));
  }

  const html = typeof rawPayload === "string" ? rawPayload : String(rawPayload?.html || rawPayload?.body || "");
  if (!clean(html)) return [];
  return parser.parseSapHrCloudPostingsFromHtml(companyName, config, html, listUrl).map((posting) => ({
    ...posting,
    source_evidence: {
      ...(posting.source_evidence || {}),
      list_url: listUrl,
      route_kind: "saphrcloud_public_board"
    }
  }));
}

const sourceContract = createBasicSourceContract({
  atsKey: ATS_KEY,
  sourceFamily: SOURCE_FAMILY,
  parserVersion: PARSER_VERSION,
  parserConfidence: 0.55,
  requestsPerMinute: 8
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
