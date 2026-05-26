const { safeFetch } = require("../../safeFetch");
const { parseGemPublicCompany, buildCompanyContext, clean, createDiscover } = require("./discover");

const GEM_RATE_LIMIT_WAIT_MS = 60 * 1000;

function responseStatus(payload) {
  return Number(payload?.status || payload?.statusCode || 200);
}

async function payloadToJson(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === "object" && !Array.isArray(payload) && !("body" in payload) && !("html" in payload)) {
    return payload;
  }

  const raw = typeof payload === "string"
    ? payload
    : typeof payload?.text === "function"
    ? await payload.text()
    : typeof payload?.body === "string"
      ? payload.body
      : typeof payload?.html === "string"
        ? payload.html
        : "";
  if (!String(raw || "").trim()) {
    throw buildSourceError("invalid_payload", "Gem API response body is empty");
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw buildSourceError("invalid_payload", "Gem API response is not valid JSON", {
      cause: error.message
    });
  }
}

function buildSourceError(code, message, details = {}) {
  const error = new Error(message);
  error.ingestionErrorType = code;
  Object.assign(error, details);
  return error;
}

function buildJobBoardPayload(boardId) {
  return [
    {
      operationName: "JobBoardTheme",
      variables: {
        boardId
      },
      query: "query JobBoardTheme($boardId: String!) { publicBrandingTheme(externalId: $boardId) { id theme __typename } }"
    },
    {
      operationName: "JobBoardList",
      variables: {
        boardId
      },
      query: "query JobBoardList($boardId: String!) { oatsExternalJobPostings(boardId: $boardId) { jobPostings { id extId title locations { id name city isoCountry isRemote extId __typename } job { id department { id name extId __typename } locationType employmentType __typename } __typename } __typename } jobBoardExternal(vanityUrlPath: $boardId) { id teamDisplayName descriptionHtml pageTitle __typename } }"
    }
  ];
}

function assertGemHost(targetUrl, fallbackUrl) {
  const value = clean(targetUrl || fallbackUrl);
  try {
    const host = new URL(value).hostname.toLowerCase();
    if (host === "jobs.gem.com" || host === "www.jobs.gem.com") return;
  } catch {
    // fall through to error handling below
  }
  throw buildSourceError(
    "unexpected_host",
    `Gem API URL redirected to unexpected host: ${value}`,
    { url: value }
  );
}

function createFetchList(discover = createDiscover("source-gem-v1")) {
  return async function fetchGemSourceList(company = {}, options = {}) {
    const context = buildCompanyContext(company);
    const discovered = discover(context);
    const config = discovered?.config || {};
    if (!config?.apiUrl) {
      return { __sourceConfig: config || {} };
    }

    const queryPayload = buildJobBoardPayload(config.boardId);
    const target = {
      ...discovered,
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify(queryPayload)
    };
    const rawPayload = options.fetcher
      ? await options.fetcher(config.apiUrl, target)
      : await safeFetch(config.apiUrl, {
          ...target,
          headers: {
            ...target.headers,
            ...(options.headers || {})
          }
        });

    const status = responseStatus(rawPayload);
    if (status < 200 || status >= 300) {
      throw buildSourceError(
        "fetch_failed",
        `Gem API request failed (${status})`,
        { status, url: config.apiUrl }
      );
    }

    assertGemHost(rawPayload?.__sourceFetchFinalUrl || rawPayload?.url || config.apiUrl);

    const payload = await payloadToJson(rawPayload);
    if (!Array.isArray(payload)) {
      throw buildSourceError("invalid_payload", "Gem API response is not a JSON array", {
        url: config.apiUrl
      });
    }

    const result = payload.slice();
    result.__sourceConfig = config;
    result.__sourceRequest = {
      apiUrl: config.apiUrl,
      boardId: config.boardId,
      boardIdLower: config.boardIdLower,
      rateLimitMs: GEM_RATE_LIMIT_WAIT_MS
    };
    return result;
  };
}

module.exports = {
  createFetchList,
  GEM_RATE_LIMIT_WAIT_MS
};
