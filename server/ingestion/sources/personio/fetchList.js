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

function assertPersonioHost(finalUrl, fallbackUrl) {
  const value = clean(finalUrl || fallbackUrl);
  try {
    const host = new URL(value).hostname.toLowerCase();
    if (host.endsWith(".jobs.personio.de") || host === "api.personio.de") return;
  } catch {
    // Fall through to source error.
  }
  throw makeSourceFetchError("unexpected_redirect_host", `Personio feed redirected to unexpected host: ${value}`, {
    url: value
  });
}

async function fetchList(company = {}, options = {}) {
  const target = discover(company);
  const config = target.config || {};
  if (!clean(target.list_url)) {
    throw makeSourceFetchError("no_public_jobs_route", "Personio source has no supported XML feed route", {
      url: company.url_string
    });
  }

  const request = {
    ...target,
    method: "GET",
    headers: {
      Accept: "application/xml,text/xml,*/*;q=0.8"
    },
    source_key: "personio",
    source_family: "direct_json"
  };

  let status = 200;
  let finalUrl = target.list_url;
  let body = "";
  if (typeof options.fetcher === "function") {
    const payload = await options.fetcher(target.list_url, request);
    status = responseStatus(payload);
    finalUrl = finalUrlFromPayload(payload, target.list_url);
    body = await payloadToText(payload);
  } else {
    const response = await safeFetch(target.list_url, request);
    status = Number(response.status || 0);
    finalUrl = clean(response.url || target.list_url);
    body = status === 200 ? await readLimitedResponseText(response, { sourceUrl: finalUrl }) : "";
  }

  if (status === 404 || status === 410) {
    return {
      xml: "",
      positions: [],
      __sourceConfig: config,
      __sourceFetchFinalUrl: finalUrl,
      __sourceUnavailable: true,
      __sourceUnavailableReason: "personio_feed_not_found"
    };
  }
  if (status < 200 || status >= 300) {
    throw makeSourceFetchError("fetch_failed", `Personio XML feed request failed (${status})`, {
      status,
      url: finalUrl
    });
  }
  assertPersonioHost(finalUrl, target.list_url);

  return {
    xml: body,
    __sourceConfig: config,
    __sourceFetchFinalUrl: finalUrl
  };
}

module.exports = {
  fetchList
};
