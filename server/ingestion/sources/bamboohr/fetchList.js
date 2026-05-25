const { safeFetch } = require("../../safeFetch");
const {
  asUrl,
  buildCompanyContext,
  makeSourceFetchError
} = require("./helpers");

function assertBambooHrFinalUrl(finalUrl, fallbackUrl) {
  const finalValue = String(finalUrl || fallbackUrl || "").trim();
  const parsed = asUrl(finalValue);
  const finalHost = String(parsed?.hostname || "").toLowerCase();
  if (!finalHost.endsWith(".bamboohr.com") || finalHost === "bamboohr.com" || finalHost === "www.bamboohr.com") {
    throw makeSourceFetchError("unexpected_redirect_host", `BambooHR URL redirected to unexpected host: ${finalValue}`, {
      url: finalValue
    });
  }
}

async function readJsonPayload(url, target, options = {}) {
  if (options.fetcher) {
    const response = await options.fetcher(url, target);
    if (typeof response === "string") return JSON.parse(response);
    if (response && typeof response === "object") {
      if (typeof response.json === "function") return response.json();
      if (typeof response.body === "string" || typeof response.html === "string") {
        return JSON.parse(String(response.body || response.html || ""));
      }
      return response;
    }
    return {};
  }

  const response = await safeFetch(url, {
    ...(options.fetchOptions || {}),
    headers: {
      accept: "application/json, text/plain, */*",
      ...(options.fetchOptions?.headers || {})
    }
  });

  if (!response.ok) {
    const body = await response.text();
    throw makeSourceFetchError("fetch_failed", `BambooHR API request failed (${response.status}): ${body.slice(0, 180)}`, {
      status: response.status,
      url
    });
  }

  const payload = await response.json();
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    return {
      ...payload,
      __sourceFetchFinalUrl: response.url || url
    };
  }
  return payload;
}

function createFetchList(discover) {
  return async function fetchList(company = {}, options = {}) {
    const context = buildCompanyContext(company);
    const target = options.target && options.target.list_url ? options.target : discover(context);
    const listUrl = String(target?.list_url || target?.config?.apiUrl || "").trim();
    if (!listUrl) {
      throw makeSourceFetchError("no_public_jobs_route", "BambooHR source has no public careers list route", {
        url: context.url_string
      });
    }

    const payload = await readJsonPayload(listUrl, target, options);
    assertBambooHrFinalUrl(payload?.__sourceFetchFinalUrl || listUrl, listUrl);
    if (payload && typeof payload === "object" && !Array.isArray(payload)) {
      return {
        ...payload,
        __sourceConfig: target.config || {}
      };
    }
    return payload;
  };
}

module.exports = {
  createFetchList
};
