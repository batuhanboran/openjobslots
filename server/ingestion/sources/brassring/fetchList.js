const { safeFetch } = require("../../safeFetch");
const { createDiscover } = require("./discover");
const {
  extractBrassringCompanyName,
  extractBrassringHiddenInput
} = require("./parse");

const BRASSRING_RATE_LIMIT_WAIT_MS = 60 * 1000;

function clean(value) {
  return String(value || "").trim();
}

function responseStatus(payload) {
  if (payload && typeof payload === "object" && payload.ok === false && !payload.status && !payload.statusCode) {
    return 500;
  }
  return Number(payload?.status || payload?.statusCode || 200);
}

function payloadUrl(payload, fallbackUrl = "") {
  return clean(payload?.url || payload?.finalUrl || payload?.__sourceFetchFinalUrl || fallbackUrl);
}

function payloadText(payload) {
  if (typeof payload === "string") return payload;
  if (!payload || typeof payload !== "object") return "";
  if (typeof payload.text === "function") return payload.text();
  if (typeof payload.text === "string") return payload.text;
  if (typeof payload.body === "string") return payload.body;
  if (typeof payload.html === "string") return payload.html;
  return "";
}

function stripInternalPayloadFields(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return payload || {};
  return Object.fromEntries(
    Object.entries(payload).filter(([key]) => !String(key || "").startsWith("__") && key !== "url" && key !== "finalUrl" && key !== "status" && key !== "statusCode" && key !== "headers")
  );
}

async function payloadJson(payload) {
  if (!payload) return {};
  if (typeof payload === "string") return payload.trim() ? JSON.parse(payload) : {};
  if (typeof payload !== "object") return {};
  if (typeof payload.json === "function") return payload.json();

  const text = await Promise.resolve(payloadText(payload));
  if (String(text || "").trim()) return JSON.parse(text);
  return stripInternalPayloadFields(payload);
}

function extractCookieHeaderFromResponse(response) {
  const setCookieValues =
    typeof response?.headers?.getSetCookie === "function"
      ? response.headers.getSetCookie()
      : String(response?.headers?.get("set-cookie") || "")
          .split(/,(?=[^;]+=)/g)
          .map((item) => String(item || "").trim())
          .filter(Boolean);
  const cookiePairs = [];
  const seenNames = new Set();
  for (const rawCookie of setCookieValues) {
    const cookie = String(rawCookie || "").trim();
    if (!cookie) continue;
    const firstPart = cookie.split(";")[0]?.trim() || "";
    if (!firstPart || !firstPart.includes("=")) continue;
    const name = firstPart.split("=")[0]?.trim().toLowerCase();
    if (!name || seenNames.has(name)) continue;
    seenNames.add(name);
    cookiePairs.push(firstPart);
  }
  return cookiePairs.join("; ");
}

function assertBrassringHost(urlValue, fallbackUrl = "") {
  const value = clean(urlValue || fallbackUrl);
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    parsed = null;
  }
  const host = String(parsed?.hostname || "").toLowerCase();
  if (host !== "sjobs.brassring.com" && host !== "www.sjobs.brassring.com") {
    throw new Error(`BrassRing URL redirected to unexpected host: ${value}`);
  }
}

function createFetchList(discover) {
  const discoverFn = typeof discover === "function" ? discover : createDiscover("source-brassring-v1");

  return async function fetchBrassringSourceList(company = {}, options = {}) {
    const target = discoverFn(company);
    const config = target?.config || {};
    const boardUrl = clean(config.boardUrl || target.list_url || target.listUrl || company?.url_string || "");
    if (!boardUrl || !config.apiUrl) {
      return {
        responseJson: {},
        __sourceConfig: config
      };
    }

    const boardTarget = {
      method: "GET",
      source_family: "brittle",
      headers: {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
      }
    };
    const boardPayload = options.fetcher
      ? await options.fetcher(boardUrl, boardTarget)
      : await safeFetch(boardUrl, boardTarget);
    const boardStatus = responseStatus(boardPayload);
    if (boardStatus < 200 || boardStatus >= 300) {
      const responseText = await Promise.resolve(payloadText(boardPayload)).then((value) => String(value || ""));
      throw new Error(`BrassRing board request failed (${boardStatus}): ${responseText.slice(0, 180)}`);
    }

    const finalBoardUrl = payloadUrl(boardPayload, boardUrl);
    assertBrassringHost(finalBoardUrl, boardUrl);
    const pageHtml = await Promise.resolve(payloadText(boardPayload));

    const requestVerificationToken = extractBrassringHiddenInput(pageHtml, "__RequestVerificationToken");
    const encryptedSessionValue = extractBrassringHiddenInput(pageHtml, "CookieValue");
    const rftHeaderValue = requestVerificationToken || extractBrassringHiddenInput(pageHtml, "hdRft");
    const cookieHeader = extractCookieHeaderFromResponse(boardPayload);
    const companyName = extractBrassringCompanyName(pageHtml) || config.partnerId || "";

    const apiPayload = {
      PartnerId: config.partnerId,
      SiteId: config.siteId,
      Keyword: "",
      Location: "",
      LocationCustomSolrFields: "Location",
      FacetFilterFields: null,
      TurnOffHttps: false,
      Latitude: 0,
      Longitude: 0,
      PowerSearchOptions: { PowerSearchOption: [] },
      encryptedsessionvalue: encryptedSessionValue
    };
    const apiTarget = {
      method: "POST",
      source_family: "brittle",
      headers: {
        Accept: "application/json, text/javascript, */*; q=0.01",
        "Content-Type": "application/json; charset=utf-8",
        Origin: "https://sjobs.brassring.com",
        Referer: boardUrl,
        "X-Requested-With": "XMLHttpRequest",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
      },
      body: JSON.stringify(apiPayload)
    };
    if (rftHeaderValue) apiTarget.headers.RFT = rftHeaderValue;
    if (cookieHeader) apiTarget.headers.Cookie = cookieHeader;

    const apiResponse = options.fetcher
      ? await options.fetcher(config.apiUrl, apiTarget)
      : await safeFetch(config.apiUrl, apiTarget);

    const apiStatus = responseStatus(apiResponse);
    if (apiStatus < 200 || apiStatus >= 300) {
      const apiText = await Promise.resolve(payloadText(apiResponse)).then((value) => String(value || ""));
      throw new Error(`BrassRing MatchedJobs request failed (${apiStatus}): ${apiText.slice(0, 180)}`);
    }

    const responseJson = await payloadJson(apiResponse);
    const finalMatchedJobsUrl = payloadUrl(apiResponse, config.apiUrl);
    assertBrassringHost(finalMatchedJobsUrl, config.apiUrl);
    return {
      responseJson,
      companyName,
      __sourceConfig: {
        ...config,
        boardCompanyName: clean(companyName)
      },
      __sourceFetchFinalUrl: finalMatchedJobsUrl,
      __sourceRequest: {
        boardUrl,
        finalBoardUrl,
        rateLimitMs: BRASSRING_RATE_LIMIT_WAIT_MS
      }
    };
  };
}

module.exports = {
  BRASSRING_RATE_LIMIT_WAIT_MS,
  createFetchList
};
