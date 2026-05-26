const { safeFetch } = require("../../safeFetch");
const { buildHirebridgeDetailsUrl, parseHirebridgePostingsFromHtml } = require("./parse");
const {
  buildCompanyContext,
  clean,
  createDiscover,
  parseHirebridgeCompany,
  supportedHirebridgeHost
} = require("./discover");

const HIREBRIDGE_RATE_LIMIT_WAIT_MS = 60 * 1000;

function responseStatus(payload) {
  return Number(payload?.status || payload?.statusCode || 200);
}

function payloadUrl(payload, fallbackUrl = "") {
  return clean(payload?.url || payload?.finalUrl || payload?.__sourceFetchFinalUrl || fallbackUrl);
}

async function payloadToText(payload) {
  if (typeof payload === "string") return payload;
  if (!payload || typeof payload !== "object") return "";
  if (typeof payload.text === "function") return payload.text();
  if (typeof payload.text === "string") return payload.text;
  if (typeof payload.body === "string") return payload.body;
  if (typeof payload.html === "string") return payload.html;
  return "";
}

function assertHirebridgeHost(urlValue, fallbackUrl = "", scope = "URL") {
  const value = clean(urlValue || fallbackUrl);
  try {
    const host = new URL(value).hostname.toLowerCase();
    if (supportedHirebridgeHost(host)) return;
  } catch {
    // fall through
  }
  throw new Error(`Hirebridge ${scope} redirected to unexpected host: ${value}`);
}

function withFinalConfig(config, finalUrl, fallbackUrl) {
  const value = clean(finalUrl || fallbackUrl);
  const parsed = parseHirebridgeCompany(value);
  if (parsed) return parsed;
  return {
    ...(config || {}),
    boardUrl: value || clean(config?.boardUrl)
  };
}

function buildRequestHeaders() {
  return {
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Cache-Control": "no-cache",
    Pragma: "no-cache",
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
  };
}

function createFetchList(dependencies = {}) {
  const discover = typeof dependencies.discover === "function" ? dependencies.discover : createDiscover("source-hirebridge-v1");

  return async function fetchHirebridgeSourceList(company = {}, options = {}) {
    const context = buildCompanyContext(company);
    const discovered = discover(context);
    const config = discovered?.config || {};
    const boardUrl = clean(config.boardUrl || discovered?.list_url || context.url_string);
    if (!boardUrl) {
      return {
        html: "",
        __sourceConfig: config
      };
    }

    const boardTarget = {
      method: "GET",
      source_family: "html_detail",
      headers: buildRequestHeaders()
    };
    const boardPayload = options.fetcher
      ? await options.fetcher(boardUrl, boardTarget)
      : await safeFetch(boardUrl, boardTarget);
    const boardStatus = responseStatus(boardPayload);
    if (boardStatus < 200 || boardStatus >= 300) {
      const body = await Promise.resolve(payloadToText(boardPayload)).then((value) => String(value || ""));
      throw new Error(`Hirebridge page request failed (${boardStatus}): ${body.slice(0, 180)}`);
    }

    const finalBoardUrl = payloadUrl(boardPayload, boardUrl);
    assertHirebridgeHost(finalBoardUrl, boardUrl, "URL");
    const pageHtml = await Promise.resolve(payloadToText(boardPayload));
    const finalConfig = withFinalConfig(config, finalBoardUrl, boardUrl);
    const companyNameForPostings =
      clean(context.company_name) || (clean(finalConfig.cid) ? `hirebridge_${clean(finalConfig.cid)}` : "hirebridge");
    const parseConfig = {
      ...finalConfig,
      boardUrl: finalBoardUrl
    };
    const rawPostings = parseHirebridgePostingsFromHtml(companyNameForPostings, parseConfig, pageHtml);

    const detailHtmlByUrl = {};
    const detailStatusByUrl = {};
    const detailFailureByUrl = {};
    const seenUrls = new Set();

    for (const posting of rawPostings) {
      const postingUrl = clean(posting?.job_posting_url);
      if (!postingUrl || seenUrls.has(postingUrl)) continue;
      seenUrls.add(postingUrl);

      const detailsUrl = buildHirebridgeDetailsUrl(parseConfig, postingUrl);
      if (!detailsUrl) {
        detailFailureByUrl[postingUrl] = "missing_detail_url";
        continue;
      }

      const detailTarget = {
        method: "GET",
        source_family: "html_detail",
        headers: buildRequestHeaders()
      };

      try {
        const detailPayload = options.fetcher
          ? await options.fetcher(detailsUrl, detailTarget)
          : await safeFetch(detailsUrl, detailTarget);
        const detailStatus = responseStatus(detailPayload);
        detailStatusByUrl[postingUrl] = detailStatus;
        if (detailStatus < 200 || detailStatus >= 300) {
          const detailBody = await Promise.resolve(payloadToText(detailPayload)).then((value) => String(value || ""));
          detailFailureByUrl[postingUrl] = `details_request_failed_${detailStatus}`;
          if (!detailHtmlByUrl[postingUrl]) detailHtmlByUrl[postingUrl] = detailBody;
          continue;
        }

        const detailFinalUrl = payloadUrl(detailPayload, detailsUrl);
        assertHirebridgeHost(detailFinalUrl, detailsUrl, "details URL");
        detailHtmlByUrl[postingUrl] = await Promise.resolve(payloadToText(detailPayload));
      } catch (error) {
        const message = clean(error?.message || error?.ingestionErrorType || error?.code || "details_fetch_failed");
        if (/unexpected host/i.test(message)) throw error;
        detailFailureByUrl[postingUrl] = message || "details_fetch_failed";
      }
    }

    return {
      html: pageHtml,
      __detailHtmlByUrl: detailHtmlByUrl,
      __detailStatusByUrl: detailStatusByUrl,
      __detailFailureByUrl: detailFailureByUrl,
      __sourceConfig: parseConfig,
      __sourceFetchFinalUrl: finalBoardUrl,
      __sourceRequest: {
        boardUrl,
        finalBoardUrl,
        rateLimitMs: HIREBRIDGE_RATE_LIMIT_WAIT_MS,
        detailFetchCount: seenUrls.size
      }
    };
  };
}

module.exports = {
  HIREBRIDGE_RATE_LIMIT_WAIT_MS,
  createFetchList
};
