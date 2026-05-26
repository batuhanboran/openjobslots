"use strict";

const { safeFetch } = require("../../safeFetch");
const {
  SIMPLICANT_SOURCE_FAMILY,
  buildCompanyContext,
  clean,
  createDiscover,
  parseSimplicantCompany,
  supportedSimplicantHost
} = require("./discover");

const SIMPLICANT_RATE_LIMIT_WAIT_MS = 60 * 1000;

function makeSourceFetchError(reason, message, details = {}) {
  const error = new Error(message);
  error.ingestionErrorType = reason;
  Object.assign(error, details);
  return error;
}

function responseStatus(payload) {
  return Number(payload?.status || payload?.statusCode || 200);
}

function requestTarget() {
  return {
    method: "GET",
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "en-US,en;q=0.9"
    },
    source_key: "simplicant",
    source_family: SIMPLICANT_SOURCE_FAMILY,
    rateLimitMs: SIMPLICANT_RATE_LIMIT_WAIT_MS
  };
}

async function payloadToHtml(payload) {
  if (typeof payload === "string") return payload;
  if (typeof payload?.text === "function") return payload.text();
  if (typeof payload?.text === "string") return payload.text;
  if (typeof payload?.body === "string") return payload.body;
  if (typeof payload?.html === "string") return payload.html;
  return "";
}

function assertSimplicantFinalHost(finalUrl, fallbackUrl) {
  const value = clean(finalUrl || fallbackUrl);
  try {
    const host = new URL(value).hostname.toLowerCase();
    if (supportedSimplicantHost(host)) return;
  } catch {
    // Fall through to the source error below.
  }
  throw makeSourceFetchError("unexpected_redirect_host", `Simplicant URL redirected to unexpected host: ${value}`, {
    url: value
  });
}

function withFinalConfig(config, finalUrl, fallbackUrl) {
  const finalConfig = {
    ...config,
    jobsUrl: clean(finalUrl || fallbackUrl || config?.jobsUrl)
  };
  try {
    const parsed = new URL(finalConfig.jobsUrl);
    finalConfig.host = parsed.hostname.toLowerCase();
    finalConfig.baseOrigin = `${parsed.protocol}//${parsed.host}`;
  } catch {
    // Keep discovered config.
  }
  return finalConfig;
}

function createFetchList(dependencies = {}) {
  const discover = typeof dependencies.discover === "function" ? dependencies.discover : createDiscover();

  return async function fetchSimplicantSourceList(company = {}, options = {}) {
    const context = buildCompanyContext(company);
    const discovered = discover(context);
    const config = discovered?.config?.jobsUrl
      ? discovered.config
      : parseSimplicantCompany(context.url_string);
    const jobsUrl = clean(config?.jobsUrl || discovered?.list_url);
    if (!jobsUrl) {
      throw makeSourceFetchError("no_public_jobs_route", "Simplicant source has no supported public jobs route", {
        url: context.url_string
      });
    }

    const target = requestTarget();
    const payload = typeof options.fetcher === "function"
      ? await options.fetcher(jobsUrl, target)
      : await safeFetch(jobsUrl, target);
    const status = responseStatus(payload);
    if (status < 200 || status >= 300 || payload?.ok === false) {
      const body = await payloadToHtml(payload);
      throw makeSourceFetchError("fetch_failed", `Simplicant page request failed (${status}): ${body.slice(0, 180)}`, {
        status,
        url: clean(payload?.url || jobsUrl)
      });
    }
    const finalUrl = clean(payload?.url || payload?.__sourceFetchFinalUrl || jobsUrl);
    assertSimplicantFinalHost(finalUrl, jobsUrl);
    const html = await payloadToHtml(payload);
    return {
      html: /page you were looking for could not be found/i.test(html) ? "" : html,
      __sourceConfig: withFinalConfig(config, finalUrl, jobsUrl),
      __sourceFetchFinalUrl: finalUrl,
      __sourceRequest: {
        jobsUrl,
        rateLimitMs: SIMPLICANT_RATE_LIMIT_WAIT_MS
      }
    };
  };
}

module.exports = {
  SIMPLICANT_RATE_LIMIT_WAIT_MS,
  createFetchList
};
