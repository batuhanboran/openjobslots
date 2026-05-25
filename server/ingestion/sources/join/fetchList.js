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

function buildHeaders() {
  return {
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Cache-Control": "no-cache",
    Pragma: "no-cache",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
  };
}

async function payloadToHtml(payload) {
  if (typeof payload === "string") return payload;
  if (typeof payload?.text === "function") return payload.text();
  if (typeof payload?.body === "string") return payload.body;
  if (typeof payload?.html === "string") return payload.html;
  return "";
}

function assertJoinFinalHost(finalUrl, fallbackUrl) {
  const value = clean(finalUrl || fallbackUrl);
  try {
    const host = new URL(value).hostname.toLowerCase();
    if (host === "join.com" || host === "www.join.com") return;
  } catch {
    // Fall through to the source error below.
  }
  throw makeSourceFetchError("unexpected_redirect_host", `Join URL redirected to unexpected host: ${value}`, {
    url: value
  });
}

function createFetchList(dependencies = {}) {
  const discover = typeof dependencies.discover === "function" ? dependencies.discover : createDiscover();

  return async function fetchJoinSourceList(company = {}, options = {}) {
    const context = buildCompanyContext(company);
    const discovered = discover(context);
    const config = discovered?.config || {};
    const boardUrl = clean(config.boardUrl || discovered?.list_url);
    if (!boardUrl) {
      throw makeSourceFetchError("no_public_jobs_route", "Join source has no supported company jobs route");
    }

    const target = {
      method: "GET",
      headers: buildHeaders()
    };

    if (typeof options.fetcher === "function") {
      const payload = await options.fetcher(boardUrl, target);
      const status = responseStatus(payload);
      if (status < 200 || status >= 300) {
        throw makeSourceFetchError("fetch_failed", `Join page request failed (${status})`, {
          status,
          url: boardUrl
        });
      }
      assertJoinFinalHost(payload?.url || payload?.__sourceFetchFinalUrl || boardUrl, boardUrl);
      return {
        html: await payloadToHtml(payload),
        __sourceConfig: config,
        __sourceFetchFinalUrl: clean(payload?.url || payload?.__sourceFetchFinalUrl || boardUrl)
      };
    }

    const res = await safeFetch(boardUrl, target);
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`JOIN page request failed (${res.status}): ${body.slice(0, 180)}`);
    }
    assertJoinFinalHost(res.url || boardUrl, boardUrl);
    return {
      html: await res.text(),
      __sourceConfig: config,
      __sourceFetchFinalUrl: clean(res.url || boardUrl)
    };
  };
}

module.exports = {
  createFetchList
};
