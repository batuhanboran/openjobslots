const { safeFetch } = require("../../safeFetch");
const {
  LOXO_SOURCE_FAMILY,
  buildCompanyContext,
  clean,
  createDiscover,
  parseLoxoCompany,
  supportedLoxoHost
} = require("./discover");
const { parseLoxoPostingsFromHtml } = require("./parse");

const LOXO_RATE_LIMIT_WAIT_MS = 5 * 1000;
const LOXO_DEFAULT_DETAIL_LIMIT = 10;
const LOXO_DEFAULT_DETAIL_DELAY_MS = 150;

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

function loxoDetailLimit(options = {}) {
  const value = Number(
    options.maxLoxoDetailFetches ??
    process.env.OPENJOBSLOTS_LOXO_DETAIL_LIMIT ??
    LOXO_DEFAULT_DETAIL_LIMIT
  );
  if (!Number.isFinite(value)) return LOXO_DEFAULT_DETAIL_LIMIT;
  return Math.max(0, Math.min(100, Math.floor(value)));
}

function loxoDetailDelayMs(options = {}) {
  const value = Number(
    options.loxoDetailDelayMs ??
    process.env.OPENJOBSLOTS_LOXO_DETAIL_DELAY_MS ??
    LOXO_DEFAULT_DETAIL_DELAY_MS
  );
  if (!Number.isFinite(value)) return LOXO_DEFAULT_DETAIL_DELAY_MS;
  return Math.max(0, Math.min(5000, Math.floor(value)));
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function assertLoxoFinalHost(finalUrl, fallbackUrl) {
  const value = clean(finalUrl || fallbackUrl);
  try {
    const host = new URL(value).hostname.toLowerCase();
    if (supportedLoxoHost(host)) return;
  } catch {
    // Fall through to the source error below.
  }
  throw makeSourceFetchError("unexpected_redirect_host", `Loxo URL redirected to unexpected host: ${value}`, {
    url: value
  });
}

async function fetchLoxoPage(url, target, options = {}) {
  if (typeof options.fetcher === "function") {
    const payload = await options.fetcher(url, target);
    return {
      html: await payloadToHtml(payload),
      status: responseStatus(payload),
      finalUrl: clean(payload?.url || payload?.__sourceFetchFinalUrl || url)
    };
  }

  const response = await safeFetch(url, target);
  return {
    html: await response.text(),
    status: Number(response.status || 200),
    finalUrl: clean(response.url || url)
  };
}

function shouldFetchLoxoDetail(posting) {
  return Boolean(posting?.job_posting_url && !clean(posting?.location));
}

function withFinalConfig(config, finalUrl, fallbackUrl) {
  const value = clean(finalUrl || fallbackUrl);
  let baseOrigin = clean(config?.baseOrigin);
  try {
    const parsed = new URL(value);
    baseOrigin = `${parsed.protocol}//${parsed.host}`;
  } catch {
    // Keep the discovered origin.
  }
  return {
    ...config,
    baseOrigin,
    boardUrl: value || clean(config?.boardUrl)
  };
}

function createFetchList(dependencies = {}) {
  const discover = typeof dependencies.discover === "function" ? dependencies.discover : createDiscover();

  return async function fetchLoxoSourceList(company = {}, options = {}) {
    const context = buildCompanyContext(company);
    const discovered = discover(context);
    const config = discovered?.config?.boardUrl
      ? discovered.config
      : parseLoxoCompany(context.url_string);
    const boardUrl = clean(config?.boardUrl || discovered?.list_url);
    if (!boardUrl) {
      throw makeSourceFetchError("no_public_jobs_route", "Loxo source has no supported jobs route", {
        url: context.url_string
      });
    }

    const target = {
      method: "GET",
      headers: buildHeaders(),
      source_key: "loxo",
      source_family: LOXO_SOURCE_FAMILY,
      rateLimitMs: LOXO_RATE_LIMIT_WAIT_MS
    };

    const list = await fetchLoxoPage(boardUrl, target, options);
    if (list.status < 200 || list.status >= 300) {
      throw makeSourceFetchError("fetch_failed", `Loxo page request failed (${list.status}): ${list.html.slice(0, 180)}`, {
        status: list.status,
        url: list.finalUrl || boardUrl
      });
    }
    const finalUrl = clean(list.finalUrl || boardUrl);
    assertLoxoFinalHost(finalUrl, boardUrl);
    const finalConfig = withFinalConfig(config, finalUrl, boardUrl);
    const companyName = clean(context.company_name || finalConfig.companySlugLower || "loxo");
    const listPostings = parseLoxoPostingsFromHtml(companyName, finalConfig, list.html);
    const maxDetails = loxoDetailLimit(options);
    const detailDelayMs = typeof options.fetcher === "function" ? 0 : loxoDetailDelayMs(options);
    const detailHtmlByUrl = {};
    let detailFetches = 0;

    for (const posting of listPostings) {
      if (!shouldFetchLoxoDetail(posting) || detailFetches >= maxDetails) continue;
      detailFetches += 1;
      try {
        if (detailFetches > 1 && detailDelayMs > 0) await delay(detailDelayMs);
        const detail = await fetchLoxoPage(posting.job_posting_url, target, options);
        if (detail.status < 200 || detail.status >= 300) continue;
        assertLoxoFinalHost(detail.finalUrl, posting.job_posting_url);
        detailHtmlByUrl[posting.job_posting_url] = detail.html;
      } catch {
        // Detail pages are best-effort evidence; keep the list row conservative.
      }
    }

    return {
      html: list.html,
      __detailHtmlByUrl: detailHtmlByUrl,
      detail_fetch_count: detailFetches,
      __sourceConfig: finalConfig,
      __sourceFetchFinalUrl: finalUrl,
      __sourceRequest: {
        boardUrl,
        detailFetchCount: detailFetches,
        detailLimit: maxDetails,
        rateLimitMs: LOXO_RATE_LIMIT_WAIT_MS
      }
    };
  };
}

module.exports = {
  LOXO_RATE_LIMIT_WAIT_MS,
  loxoDetailLimit,
  createFetchList
};
