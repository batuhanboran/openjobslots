"use strict";

const { safeFetch, readLimitedResponseText } = require("../../safeFetch");
const { clean, makeSourceFetchError } = require("./helpers");
const { extractApplicantProDomainId } = require("./parse");

async function readTextResponse(response, url) {
  if (typeof response === "string") return response;
  if (response && typeof response === "object") {
    const status = Number(response.status || 200);
    if (response.ok === false || status >= 400) {
      throw makeSourceFetchError(
        status === 404 || status === 410 ? "detail_404_or_410" : "fetch_failed",
        `ApplicantPro page request failed with HTTP ${status}`,
        { status, url: response.url || url }
      );
    }
    if (typeof response.text === "function") return response.text();
    if (typeof response.html === "string" || typeof response.body === "string") {
      return String(response.html || response.body || "");
    }
  }
  return String(response || "");
}

async function readJsonResponse(response, url) {
  if (response && typeof response === "object" && typeof response.json !== "function" && typeof response.text !== "function") {
    const status = Number(response.status || 200);
    if (response.ok === false || status >= 400) {
      throw makeSourceFetchError("fetch_failed", `ApplicantPro jobs request failed with HTTP ${status}`, {
        status,
        url: response.url || url
      });
    }
    return response;
  }

  const status = Number(response?.status || 200);
  if (response?.ok === false || status >= 400) {
    throw makeSourceFetchError("fetch_failed", `ApplicantPro jobs request failed with HTTP ${status}`, {
      status,
      url: response?.url || url
    });
  }
  if (response && typeof response.json === "function") return response.json();
  if (response && typeof response.text === "function") {
    const body = await response.text();
    return body ? JSON.parse(body) : {};
  }
  if (typeof response === "string") return response ? JSON.parse(response) : {};
  return {};
}

async function fetchApplicantProJobsPage(url, target, options = {}) {
  if (options.fetcher) {
    return readTextResponse(await options.fetcher(url, { ...target, method: "GET" }), url);
  }
  const response = await safeFetch(url, {
    method: "GET",
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "User-Agent": "OpenJobSlotsBot/1.0 (+https://openjobslots.com)"
    }
  });
  if (!response.ok) {
    throw makeSourceFetchError("fetch_failed", `ApplicantPro page request failed with HTTP ${response.status}`, {
      status: response.status,
      url
    });
  }
  return readLimitedResponseText(response, { sourceUrl: response.url || url });
}

async function fetchApplicantProJobsList(apiUrl, target, options = {}) {
  const response = options.fetcher
    ? await options.fetcher(apiUrl, { ...target, method: "GET" })
    : await safeFetch(apiUrl, {
        method: "GET",
        headers: {
          Accept: "application/json",
          "User-Agent": "OpenJobSlotsBot/1.0 (+https://openjobslots.com)"
        }
      });
  const payload = await readJsonResponse(response, apiUrl);
  if (payload && typeof payload === "object" && payload.success === false) {
    const message = clean(payload?.message || "Unknown ApplicantPro API error");
    throw makeSourceFetchError(
      "source_quality",
      `ApplicantPro jobs API returned success=false: ${message}`,
      { url: apiUrl }
    );
  }
  return payload;
}

function buildApplicantProJobsApiUrl(config, domainId) {
  const apiUrl = new URL(`${clean(config?.origin).replace(/\/+$/, "")}/core/jobs/${encodeURIComponent(domainId)}`);
  apiUrl.searchParams.set("getParams", "{}");
  return apiUrl.toString();
}

function createFetchList(discover) {
  return async function fetchList(company = {}, options = {}) {
    const target = discover(company);
    if (!target.list_url || !target.config?.origin) {
      return { data: { jobs: [] }, __sourceConfig: target.config || {} };
    }

    const jobsPageHtml = await fetchApplicantProJobsPage(target.list_url, target, options);
    const domainId = extractApplicantProDomainId(jobsPageHtml);
    if (!domainId) {
      throw makeSourceFetchError("parser_bug", "ApplicantPro domain_id was not found on the jobs page", {
        url: target.list_url
      });
    }

    const apiUrl = buildApplicantProJobsApiUrl(target.config, domainId);
    const payload = await fetchApplicantProJobsList(apiUrl, { ...target, domain_id: domainId }, options);
    if (payload && typeof payload === "object" && !Array.isArray(payload)) {
      return {
        ...payload,
        __sourceConfig: {
          ...target.config,
          domainId,
          apiUrl
        }
      };
    }
    return {
      data: { jobs: [] },
      __sourceConfig: {
        ...target.config,
        domainId,
        apiUrl
      }
    };
  };
}

module.exports = {
  buildApplicantProJobsApiUrl,
  createFetchList
};
