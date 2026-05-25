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

function assertRipplingFinalHost(finalUrl, fallbackUrl) {
  const value = clean(finalUrl || fallbackUrl);
  try {
    const host = new URL(value).hostname.toLowerCase();
    if (host === "ats.rippling.com") return;
  } catch {
    // Fall through to the source error below.
  }
  throw makeSourceFetchError("unexpected_redirect_host", `Rippling URL redirected to unexpected host: ${value}`, {
    url: value
  });
}

function buildHeaders() {
  return {
    Accept: "application/json, text/plain, */*"
  };
}

function buildPageUrl(apiUrl, page, pageSize) {
  if (page <= 0) return apiUrl;
  const url = new URL(apiUrl);
  url.searchParams.set("page", String(page));
  url.searchParams.set("pageSize", String(pageSize));
  return url.toString();
}

function addUniqueItems(target, seen, items) {
  for (const item of Array.isArray(items) ? items : []) {
    const key = clean(item?.id || item?.url || item?.name || JSON.stringify(item));
    if (!key || seen.has(key)) continue;
    seen.add(key);
    target.push(item);
  }
}

async function fetchJson(requestUrl, target, fetcher) {
  if (typeof fetcher === "function") {
    const payload = await fetcher(requestUrl, target);
    const status = responseStatus(payload);
    if (status < 200 || status >= 300) {
      throw makeSourceFetchError("fetch_failed", `Rippling API request failed (${status})`, {
        status,
        url: requestUrl
      });
    }
    assertRipplingFinalHost(payload?.url || payload?.__sourceFetchFinalUrl || requestUrl, requestUrl);
    return payloadToJson(payload);
  }

  const res = await safeFetch(requestUrl, target);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Rippling API request failed (${res.status}): ${body.slice(0, 180)}`);
  }
  assertRipplingFinalHost(res.url || requestUrl, requestUrl);
  return res.json();
}

function createFetchList(dependencies = {}) {
  const discover = typeof dependencies.discover === "function" ? dependencies.discover : createDiscover();

  return async function fetchRipplingSourceList(company = {}, options = {}) {
    const context = buildCompanyContext(company);
    const discovered = discover(context);
    const config = discovered?.config || {};
    const apiUrl = clean(config.apiUrl || discovered?.list_url);
    if (!apiUrl) {
      throw makeSourceFetchError("no_public_jobs_route", "Rippling source has no supported board API route");
    }

    const pageSize = Math.max(1, Math.min(Number(options.pageSize || 100) || 100, 250));
    const maxPages = Math.max(1, Math.min(Number(options.maxPages || 5) || 5, 20));
    const target = {
      method: "GET",
      headers: buildHeaders()
    };
    const seen = new Set();
    const collectedItems = [];
    let firstPayload = null;

    for (let page = 0; page < maxPages; page += 1) {
      const requestUrl = buildPageUrl(apiUrl, page, pageSize);
      const pagePayload = await fetchJson(requestUrl, target, options.fetcher);
      if (!firstPayload) firstPayload = pagePayload;
      const items = Array.isArray(pagePayload?.items) ? pagePayload.items : [];
      addUniqueItems(collectedItems, seen, items);

      const totalPagesRaw = Number(pagePayload?.totalPages || pagePayload?.pagination?.totalPages);
      const totalPages = Number.isFinite(totalPagesRaw) && totalPagesRaw > 0 ? totalPagesRaw : page + 1;
      if (page + 1 >= totalPages) break;
      if (items.length === 0) break;
    }

    return {
      ...(firstPayload || {}),
      items: collectedItems,
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
