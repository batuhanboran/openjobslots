const { safeFetch } = require("../../safeFetch");
const { buildCompanyContext, clean, createDiscover } = require("./discover");

function makeSourceFetchError(reason, message, details = {}) {
  const error = new Error(message);
  error.ingestionErrorType = reason;
  Object.assign(error, details);
  return error;
}

function responseStatus(payload) {
  return Number(payload?.status || payload?.statusCode || 200);
}

async function payloadToJson(payload) {
  if (payload && typeof payload === "object" && !Array.isArray(payload) && !("body" in payload) && !("html" in payload)) {
    return payload;
  }
  const text = typeof payload?.text === "function"
    ? await payload.text()
    : typeof payload?.body === "string"
      ? payload.body
      : typeof payload?.html === "string"
        ? payload.html
        : "";
  return text ? JSON.parse(text) : {};
}

function assertPinpointFinalHost(finalUrl, fallbackUrl) {
  const value = clean(finalUrl || fallbackUrl);
  try {
    const host = new URL(value).hostname.toLowerCase();
    if (host.endsWith(".pinpointhq.com") && host !== "pinpointhq.com" && host !== "www.pinpointhq.com") {
      return;
    }
  } catch {
    // Fall through to the source error below.
  }
  throw makeSourceFetchError("unexpected_redirect_host", `PinpointHQ URL redirected to unexpected host: ${value}`, {
    url: value
  });
}

function createFetchList(dependencies = {}) {
  const discover = typeof dependencies.discover === "function" ? dependencies.discover : createDiscover();

  return async function fetchPinpointHqSourceList(company = {}, options = {}) {
    const context = buildCompanyContext(company);
    const discovered = discover(context);
    const config = discovered?.config || {};
    const apiUrl = clean(config.apiUrl || discovered?.list_url);
    if (!apiUrl) {
      throw makeSourceFetchError("no_public_jobs_route", "PinpointHQ source has no supported postings JSON route");
    }

    const now = typeof options.now === "function" ? options.now() : Date.now();
    const queryGlue = apiUrl.includes("?") ? "&" : "?";
    const requestUrl = `${apiUrl}${queryGlue}_=${encodeURIComponent(String(now))}`;
    const target = {
      method: "GET",
      headers: {
        Accept: "application/json, text/plain, */*"
      }
    };

    if (typeof options.fetcher === "function") {
      const payload = await options.fetcher(requestUrl, target);
      const status = responseStatus(payload);
      if (status < 200 || status >= 300) {
        throw makeSourceFetchError("fetch_failed", `PinpointHQ API request failed (${status})`, {
          status,
          url: requestUrl
        });
      }
      if (payload?.url || payload?.__sourceFetchFinalUrl) {
        assertPinpointFinalHost(payload.url || payload.__sourceFetchFinalUrl, requestUrl);
      }
      return {
        ...(await payloadToJson(payload)),
        __sourceConfig: {
          ...config,
          apiUrl
        }
      };
    }

    const res = await safeFetch(requestUrl, target);
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`PinpointHQ API request failed (${res.status}): ${body.slice(0, 180)}`);
    }
    assertPinpointFinalHost(res.url || requestUrl, requestUrl);
    return {
      ...(await res.json()),
      __sourceConfig: {
        ...config,
        apiUrl
      }
    };
  };
}

module.exports = {
  createFetchList
};
