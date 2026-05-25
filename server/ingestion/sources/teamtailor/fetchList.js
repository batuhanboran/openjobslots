const { safeFetch } = require("../../safeFetch");
const { buildCompanyContext, clean, createDiscover } = require("./discover");

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
    Accept: "text/html,application/xhtml+xml",
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

function assertTeamtailorFinalHost(finalUrl, fallbackUrl) {
  const value = clean(finalUrl || fallbackUrl);
  try {
    const host = new URL(value).hostname.toLowerCase();
    if (host.endsWith(".teamtailor.com")) return;
  } catch {
    // Fall through to the source error below.
  }
  throw makeSourceFetchError("unexpected_redirect_host", `Teamtailor URL redirected to unexpected host: ${value}`, {
    url: value
  });
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
    jobsUrl: value || clean(config?.jobsUrl)
  };
}

function createFetchList(dependencies = {}) {
  const discover = typeof dependencies.discover === "function" ? dependencies.discover : createDiscover();

  return async function fetchTeamtailorSourceList(company = {}, options = {}) {
    const context = buildCompanyContext(company);
    const discovered = discover(context);
    const config = discovered?.config || {};
    const jobsUrl = clean(config.jobsUrl || discovered?.list_url);
    if (!jobsUrl) {
      throw makeSourceFetchError("no_public_jobs_route", "Teamtailor source has no supported jobs route");
    }

    const target = {
      method: "GET",
      headers: buildHeaders()
    };

    if (typeof options.fetcher === "function") {
      const payload = await options.fetcher(jobsUrl, target);
      const status = responseStatus(payload);
      if (status < 200 || status >= 300) {
        throw makeSourceFetchError("fetch_failed", `Teamtailor page request failed (${status})`, {
          status,
          url: jobsUrl
        });
      }
      const finalUrl = clean(payload?.url || payload?.__sourceFetchFinalUrl || jobsUrl);
      assertTeamtailorFinalHost(finalUrl, jobsUrl);
      return {
        html: await payloadToHtml(payload),
        __sourceConfig: withFinalConfig(config, finalUrl, jobsUrl),
        __sourceFetchFinalUrl: finalUrl
      };
    }

    const res = await safeFetch(jobsUrl, target);
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Teamtailor page request failed (${res.status}): ${body.slice(0, 180)}`);
    }
    const finalUrl = clean(res.url || jobsUrl);
    assertTeamtailorFinalHost(finalUrl, jobsUrl);
    return {
      html: await res.text(),
      __sourceConfig: withFinalConfig(config, finalUrl, jobsUrl),
      __sourceFetchFinalUrl: finalUrl
    };
  };
}

module.exports = {
  createFetchList
};
