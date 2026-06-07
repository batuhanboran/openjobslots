"use strict";

const { readLimitedResponseText, safeFetch } = require("../../safeFetch");
const {
  clean,
  finalUrlFromPayload,
  makeSourceFetchError,
  payloadToText,
  responseStatus
} = require("../sourceModuleHelpers");
const { discover } = require("./discover");

function assertWorkableHost(finalUrl, fallbackUrl) {
  const value = clean(finalUrl || fallbackUrl);
  try {
    const host = new URL(value).hostname.toLowerCase();
    if (host === "www.workable.com" || host.endsWith(".workable.com")) return;
  } catch {
    // Fall through to source error.
  }
  throw makeSourceFetchError("unexpected_redirect_host", `Workable API redirected to unexpected host: ${value}`, {
    url: value
  });
}

async function payloadToJson(payload, sourceUrl) {
  if (payload && typeof payload === "object" && !Array.isArray(payload) && Array.isArray(payload.jobs)) return payload;
  const text = await payloadToText(payload);
  if (!clean(text)) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw makeSourceFetchError("invalid_json", "Workable public account API response is not valid JSON", {
      url: sourceUrl
    });
  }
}

async function fetchList(company = {}, options = {}) {
  const target = discover(company);
  const config = target.config || {};
  if (!clean(target.list_url)) {
    throw makeSourceFetchError("no_public_jobs_route", "Workable source has no supported public account API route", {
      url: company.url_string
    });
  }

  const request = {
    ...target,
    method: "GET",
    headers: {
      Accept: "application/json, text/plain, */*"
    },
    source_key: "workable",
    source_family: "direct_json"
  };

  let status = 200;
  let finalUrl = target.list_url;
  let payload;
  if (typeof options.fetcher === "function") {
    payload = await options.fetcher(target.list_url, request);
    status = responseStatus(payload);
    finalUrl = finalUrlFromPayload(payload, target.list_url);
  } else {
    const response = await safeFetch(target.list_url, request);
    status = Number(response.status || 0);
    finalUrl = clean(response.url || target.list_url);
    payload = {
      status,
      url: finalUrl,
      body: status === 200 ? await readLimitedResponseText(response, { sourceUrl: finalUrl }) : ""
    };
  }

  if (status === 404 || status === 410) {
    return {
      jobs: [],
      __sourceConfig: config,
      __sourceFetchFinalUrl: finalUrl,
      __sourceUnavailable: true,
      __sourceUnavailableReason: "workable_account_not_found"
    };
  }
  if (status < 200 || status >= 300) {
    throw makeSourceFetchError("fetch_failed", `Workable public account API request failed (${status})`, {
      status,
      url: finalUrl
    });
  }
  assertWorkableHost(finalUrl, target.list_url);

  const json = await payloadToJson(payload, finalUrl);
  return {
    ...(json && typeof json === "object" ? json : {}),
    __sourceConfig: config,
    __sourceFetchFinalUrl: finalUrl
  };
}

module.exports = {
  fetchList
};
