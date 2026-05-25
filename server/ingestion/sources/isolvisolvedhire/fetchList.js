const { safeFetch } = require("../../safeFetch");
const { extractIsolvisolvedhireDomainId } = require("./parse");
const { buildCompanyContext, clean, createDiscover, parseIsolvisolvedhireCompany } = require("./discover");

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
  return String(payload || "");
}

async function payloadToJson(payload) {
  if (payload && typeof payload === "object" && !Array.isArray(payload) && !("body" in payload) && !("html" in payload)) {
    return payload;
  }
  const text = await payloadToText(payload);
  return text ? JSON.parse(text) : {};
}

function assertIsolvisolvedhireFinalHost(finalUrl, fallbackUrl) {
  const value = clean(finalUrl || fallbackUrl);
  try {
    const host = new URL(value).hostname.toLowerCase();
    if (host.endsWith(".isolvedhire.com") && host !== "isolvedhire.com" && host !== "www.isolvedhire.com") {
      return;
    }
  } catch {
    // Fall through to the source error below.
  }
  throw makeSourceFetchError("unexpected_redirect_host", `isolvisolvedhire URL redirected to unexpected host: ${value}`, {
    url: value
  });
}

function buildBoardTarget(config) {
  return {
    method: "GET",
    source_family: "direct_json",
    headers: {
      "User-Agent":
        process.env.OPENJOBSLOTS_BROWSER_USER_AGENT ||
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9"
    },
    config
  };
}

function buildApiUrl(config, domainId) {
  return `${clean(config.baseOrigin).replace(/\/+$/, "")}/core/jobs/${encodeURIComponent(domainId)}?getParams=%7B%7D`;
}

function buildApiTarget(config, apiUrl) {
  return {
    method: "GET",
    source_family: "direct_json",
    headers: {
      "User-Agent":
        process.env.OPENJOBSLOTS_BROWSER_USER_AGENT ||
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36",
      Accept: "application/json, text/plain, */*",
      "Accept-Language": "en-US,en;q=0.9",
      Referer: clean(config.boardUrl),
      Origin: clean(config.baseOrigin)
    },
    config: {
      ...config,
      apiUrl
    }
  };
}

async function fetchBoardHtml(url, target, fetcher) {
  if (typeof fetcher === "function") {
    const payload = await fetcher(url, target);
    const status = responseStatus(payload);
    if (status < 200 || status >= 300) {
      throw makeSourceFetchError("fetch_failed", `isolvisolvedhire board request failed (${status})`, {
        status,
        url
      });
    }
    if (payload?.url || payload?.__sourceFetchFinalUrl) {
      assertIsolvisolvedhireFinalHost(payload.url || payload.__sourceFetchFinalUrl, url);
    }
    return payloadToText(payload);
  }

  const response = await safeFetch(url, target);
  if (!response.ok) {
    const body = await response.text();
    throw makeSourceFetchError("fetch_failed", `isolvisolvedhire board request failed (${response.status}): ${body.slice(0, 180)}`, {
      status: response.status,
      url: response.url || url
    });
  }
  assertIsolvisolvedhireFinalHost(response.url || url, url);
  return response.text();
}

async function fetchApiJson(url, target, fetcher) {
  if (typeof fetcher === "function") {
    const payload = await fetcher(url, target);
    const status = responseStatus(payload);
    if (status < 200 || status >= 300) {
      throw makeSourceFetchError("fetch_failed", `isolvisolvedhire API request failed (${status})`, {
        status,
        url
      });
    }
    if (payload?.url || payload?.__sourceFetchFinalUrl) {
      assertIsolvisolvedhireFinalHost(payload.url || payload.__sourceFetchFinalUrl, url);
    }
    return payloadToJson(payload);
  }

  const response = await safeFetch(url, target);
  if (!response.ok) {
    const body = await response.text();
    throw makeSourceFetchError("fetch_failed", `isolvisolvedhire API request failed (${response.status}): ${body.slice(0, 180)}`, {
      status: response.status,
      url: response.url || url
    });
  }
  assertIsolvisolvedhireFinalHost(response.url || url, url);
  return response.json();
}

function createFetchList(dependencies = {}) {
  const discover = typeof dependencies.discover === "function" ? dependencies.discover : createDiscover();

  return async function fetchIsolvisolvedhireSourceList(company = {}, options = {}) {
    const context = buildCompanyContext(company);
    const discovered = discover(context);
    const config = discovered?.config?.boardUrl
      ? discovered.config
      : parseIsolvisolvedhireCompany(context.url_string);
    if (!config?.boardUrl || !config?.baseOrigin) {
      throw makeSourceFetchError("no_public_jobs_route", "isolvisolvedhire source has no supported public board route", {
        url: context.url_string
      });
    }

    const boardHtml = await fetchBoardHtml(config.boardUrl, buildBoardTarget(config), options.fetcher);
    const domainId = extractIsolvisolvedhireDomainId(boardHtml);
    if (!domainId) {
      throw makeSourceFetchError("missing_domain_id", "isolvisolvedhire domain_id not found in board HTML", {
        url: config.boardUrl
      });
    }

    const apiUrl = buildApiUrl(config, domainId);
    const payload = await fetchApiJson(apiUrl, buildApiTarget(config, apiUrl), options.fetcher);
    if (payload && typeof payload === "object" && !Array.isArray(payload)) {
      return {
        ...payload,
        __sourceConfig: {
          ...config,
          domainId,
          apiUrl
        }
      };
    }
    return {
      data: { jobs: [] },
      __sourceConfig: {
        ...config,
        domainId,
        apiUrl
      }
    };
  };
}

module.exports = {
  buildApiUrl,
  createFetchList
};
