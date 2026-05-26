const { safeFetch } = require("../../safeFetch");
const { buildCompanyContext, createDiscover, clean } = require("./discover");
const { resolveAdpWorkforcenowCompanyName } = require("./parse");

const ADP_WORKFORCENOW_RATE_LIMIT_WAIT_MS = 60 * 1000;

function makeSourceFetchError(reason, message, details = {}) {
  const error = new Error(message);
  error.ingestionErrorType = reason;
  if (details.status) error.status = details.status;
  if (details.url) error.url = details.url;
  return error;
}

function parseUrl(value) {
  try {
    return new URL(clean(value));
  } catch {
    return null;
  }
}

function asTextResponse(response) {
  if (typeof response === "string") return Promise.resolve(response);
  if (!response || typeof response !== "object") return Promise.resolve("");

  if (typeof response.text === "function") {
    return response.text();
  }

  if (typeof response.body === "string") return Promise.resolve(response.body);
  if (typeof response.html === "string") return Promise.resolve(response.html);
  return Promise.resolve("");
}

async function readResponseAsJson(response, responseLabel, finalUrl) {
  if (response && typeof response === "object" && typeof response.json === "function" && !("body" in response) && !("html" in response)) {
    const body = await asTextResponse(response);
    if (!body) return {};
    try {
      return JSON.parse(body);
    } catch {
      throw makeSourceFetchError(
        "non_json_api_response",
        `${responseLabel} response was not JSON: ${String(body).slice(0, 180)}`,
        { url: finalUrl }
      );
    }
  }

  if (response && typeof response === "object" && !response.text && !response.body && !response.html && !response.json) {
    return response;
  }

  const body = await asTextResponse(response);
  if (!body) return {};

  try {
    return JSON.parse(body);
  } catch {
    throw makeSourceFetchError(
      "non_json_api_response",
      `${responseLabel} response was not JSON: ${String(body).slice(0, 180)}`,
      { url: finalUrl }
    );
  }
}

function assertAdpWorkforcenowHost(finalUrl, fallbackUrl, stageLabel) {
  const target = clean(finalUrl || fallbackUrl || "");
  const parsed = parseUrl(target);
  const host = String(parsed?.hostname || "").toLowerCase();
  if (host !== "workforcenow.adp.com" && host !== "www.workforcenow.adp.com") {
    throw makeSourceFetchError(
      "unexpected_redirect_host",
      `${stageLabel} URL redirected to unexpected host: ${target}`,
      { url: target }
    );
  }
}

async function fetchJsonPayload(url, target, responseLabel, options = {}) {
  const response = typeof options.fetcher === "function"
    ? await options.fetcher(url, target)
    : await safeFetch(url, target);

  const finalUrl = clean(response?.url || response?.__sourceFetchFinalUrl || url);
  const status = Number(response?.status || response?.statusCode || 200);
  if (status < 200 || status >= 300) {
    const body = await asTextResponse(response);
    throw makeSourceFetchError(
      "fetch_failed",
      `${responseLabel} request failed (${status}): ${String(body).slice(0, 180)}`,
      { status, url: finalUrl }
    );
  }

  return { payload: await readResponseAsJson(response, responseLabel, finalUrl), finalUrl };
}

function createFetchList(dependencies = {}) {
  const discover = typeof dependencies.discover === "function" ? dependencies.discover : createDiscover();

  return async function fetchAdpWorkforcenowSourceList(company = {}, options = {}) {
    const context = buildCompanyContext(company);
    const discovered = discover(context);
    const config = discovered.config || {};

    const cid = clean(config.cid);
    const ccId = clean(config.ccId);
    if (!cid || !ccId) {
      throw makeSourceFetchError("no_public_jobs_route", "ADP Workforce Now company URL must contain cid and ccId");
    }

    const timestamp = Number(typeof options.now === "function" ? options.now() : Date.now());
    const contentLinksUrl =
      `${clean(config.contentLinksBaseUrl)}?cid=${encodeURIComponent(cid)}` +
      `&timeStamp=${timestamp}&ccId=${encodeURIComponent(ccId)}&locale=en_US&lang=en_US`;

    const requestCount = {
      contentLinks: 0,
      jobRequisitions: 0,
      total: 0
    };

    const contentTarget = {
      method: "GET",
      source_family: discovered.source_family || "enterprise_api",
      headers: {
        Accept: "application/json, text/plain, */*"
      }
    };
    const contentLinksResult = await fetchJsonPayload(
      contentLinksUrl,
      contentTarget,
      "ADP Workforce Now content-links",
      options
    );
    requestCount.contentLinks += 1;
    requestCount.total += 1;
    assertAdpWorkforcenowHost(contentLinksResult.finalUrl, contentLinksUrl, "ADP Workforce Now content-links");

    const companyNameForPostings = resolveAdpWorkforcenowCompanyName(context, config, contentLinksResult.payload);
    const jobResult = await fetchJsonPayload(
      clean(config.jobRequisitionsUrl),
      {
        method: "GET",
        source_family: discovered.source_family || "enterprise_api",
        headers: {
          Accept: "application/json, text/plain, */*"
        }
      },
      "ADP Workforce Now job-requisitions",
      options
    );
    requestCount.jobRequisitions += 1;
    requestCount.total += 1;
    assertAdpWorkforcenowHost(jobResult.finalUrl, config.jobRequisitionsUrl, "ADP Workforce Now job-requisitions");

    return {
      ...(jobResult.payload && typeof jobResult.payload === "object" ? jobResult.payload : {}),
      __companyNameForPostings: clean(companyNameForPostings),
      __sourceConfig: {
        ...config,
        companyNameForPostings: clean(companyNameForPostings),
        boardUrl: clean(config.boardUrl)
      },
      __sourceFetchFinalUrl: jobResult.finalUrl,
      __sourceRequest: {
        boardUrl: clean(config.boardUrl),
        contentLinksUrl,
        contentLinksFinalUrl: contentLinksResult.finalUrl,
        jobRequisitionsUrl: clean(config.jobRequisitionsUrl),
        jobRequisitionsFinalUrl: jobResult.finalUrl,
        companyNameForPostings: clean(companyNameForPostings),
        requestCount,
        rateLimitMs: ADP_WORKFORCENOW_RATE_LIMIT_WAIT_MS
      }
    };
  };
}

module.exports = {
  ADP_WORKFORCENOW_RATE_LIMIT_WAIT_MS,
  createFetchList
};
