const { safeFetch } = require("../../safeFetch");
const { parsePaylocityCompany, createDiscover } = require("./discover");
const { extractPaylocityPageDataJson } = require("./parse");

const PAYLOCITY_RATE_LIMIT_WAIT_MS = 60 * 1000;

function clean(value) {
  return String(value || "").trim();
}

function normalizeTargetUrl(urlString, fallbackUrl = "") {
  return clean(urlString || fallbackUrl);
}

function responseStatus(payload) {
  return Number(payload?.status || payload?.statusCode || 200);
}

function resolveResponseUrl(payload, fallbackUrl = "") {
  return clean(payload?.__sourceFetchFinalUrl || payload?.url || payload?.finalUrl || fallbackUrl);
}

function payloadToText(payload) {
  if (typeof payload === "string") return payload;
  if (!payload || typeof payload !== "object") return "";

  if (typeof payload.text === "function") {
    return payload.text();
  }

  if (typeof payload.body === "string") {
    return payload.body;
  }

  if (typeof payload.html === "string") {
    return payload.html;
  }

  return "";
}

function assertPaylocityFinalHost(value, fallbackUrl = "") {
  const resolved = clean(value || fallbackUrl);
  let parsed;
  try {
    parsed = new URL(resolved);
  } catch {
    throw new Error(`Paylocity board page URL is invalid: ${resolved}`);
  }

  const host = String(parsed.hostname || "").toLowerCase();
  if (host !== "recruiting.paylocity.com" && host !== "www.recruiting.paylocity.com") {
    throw new Error(`Paylocity URL redirected to unexpected host: ${resolved}`);
  }
}

function createFetchList(dependencies = {}) {
  const discover = typeof dependencies.discover === "function" ? dependencies.discover : createDiscover("source-paylocity-v1");

  return async function fetchPaylocitySourceList(company = {}, options = {}) {
    const context = {
      ...company,
      company_name: clean(company.company_name || company.companyName || company.name),
      url_string: clean(company.url_string || company.company_url || company.url),
      ATS_name: clean(company.ATS_name || company.ats_key || "paylocity")
    };
    const discovered = discover(context);
    const config = discovered?.config || {};
    const boardUrl = normalizeTargetUrl(config.boardUrl || discovered?.list_url || context.url_string);
    if (!boardUrl) {
      return {
        __sourceConfig: config || {}
      };
    }

    const target = {
      method: "GET",
      headers: {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Cache-Control": "no-cache",
        Pragma: "no-cache",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
      },
      source_family: "enterprise_api"
    };

    const rawPayload = options.fetcher
      ? await options.fetcher(boardUrl, target)
      : await safeFetch(boardUrl, target);
    const status = responseStatus(rawPayload);
    if (status < 200 || status >= 300) {
      const responseText = typeof rawPayload?.text === "function" ? await rawPayload.text() : String(rawPayload?.text || "");
      throw new Error(`Paylocity board request failed (${status}): ${responseText.slice(0, 180)}`);
    }

    const responseUrl = resolveResponseUrl(rawPayload, boardUrl);
    assertPaylocityFinalHost(responseUrl, boardUrl);
    const pageHtml = await Promise.resolve(payloadToText(rawPayload));
    const pageData = extractPaylocityPageDataJson(pageHtml);
    const finalConfig = parsePaylocityCompany(responseUrl) || config;

    if (Object.keys(pageData || {}).length === 0 && String(pageHtml || "").trim()) {
      // keep empty payloads as a valid signal; parser decides whether rows exist
    }

    return {
      ...pageData,
      __sourceConfig: finalConfig || config || {},
      __sourceFetchFinalUrl: responseUrl,
      __sourceRequest: {
        boardUrl,
        finalUrl: responseUrl,
        rateLimitMs: PAYLOCITY_RATE_LIMIT_WAIT_MS
      }
    };
  };
}

module.exports = {
  PAYLOCITY_RATE_LIMIT_WAIT_MS,
  createFetchList
};
